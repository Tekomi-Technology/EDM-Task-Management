import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  KEYCLOAK_URL: z.string().url(),
  KEYCLOAK_REALM: z.string().default('edm'),
  KEYCLOAK_AUDIENCE: z.string().default('edm-api'),
  /** Confidential client the API uses to create, block and reset accounts in Keycloak (admin screens). */
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('edm-api-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET: z.string().default('edm-attachments'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** The API description at /api/docs. Off in production unless asked for, so the API is not mapped for strangers. */
  API_DOCS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /**
   * SMS: "log" only writes messages to the log (development); "http" sends them through any HTTP gateway,
   * described by the SMS_HTTP_* settings so a provider can be chosen later without code changes.
   */
  SMS_PROVIDER: z.enum(['log', 'http']).default('log'),
  /** Gateway address. May contain {{to}}, {{to_digits}}, {{from}} and {{text}} for gateways that take a GET. */
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_METHOD: z.enum(['GET', 'POST']).default('POST'),
  /** How the body is encoded: json or form (application/x-www-form-urlencoded). */
  SMS_HTTP_CONTENT_TYPE: z.enum(['json', 'form']).default('json'),
  /** Body template with the same placeholders, e.g. {"to":"{{to}}","from":"{{from}}","message":"{{text}}"}. */
  SMS_HTTP_BODY: z.string().default('{"to":"{{to}}","from":"{{from}}","text":"{{text}}"}'),
  /** Extra headers as JSON, e.g. {"Authorization":"Bearer abc"}. */
  SMS_HTTP_HEADERS: z
    .string()
    .default('{}')
    .transform((v, ctx) => {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          return parsed as Record<string, string>;
      } catch {
        // reported below
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a JSON object of header names to values'
      });
      return z.NEVER;
    }),
  /** Some gateways answer 200 even on failure; when set, the answer must contain this text to count as sent. */
  SMS_HTTP_SUCCESS_TEXT: z.string().optional(),
  SMS_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Sender name or number shown on the phone. */
  SMS_SENDER_ID: z.string().default('EDM'),
  /** Country code added to local numbers such as 84 123 4567. */
  SMS_DEFAULT_COUNTRY_CODE: z
    .string()
    .regex(/^\d{1,3}$/)
    .default('258'),
  /** Push notifications through Expo: "expo" sends them, "log" only writes them to the log. */
  PUSH_PROVIDER: z.enum(['expo', 'log']).default('expo'),
  EXPO_PUSH_URL: z.string().url().default('https://exp.host/--/api/v2/push/send'),
  /**
   * Finds the address of a point marked on the map (Nominatim API). The public OpenStreetMap server allows light use
   * only (one request a second); point it at EDM's own Nominatim for heavy use. Empty turns the feature off.
   */
  GEOCODER_URL: z.union([z.string().url(), z.literal('')]).default('https://nominatim.openstreetmap.org'),
  /** Optional; required only if "enhanced push security" is switched on in the Expo account. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /**
   * How field staff are told about jobs: push_or_sms = push to the app, SMS only if they have no app registered
   * or the push fails; push_and_sms = both; sms_only = SMS only.
   */
  STAFF_ALERTS: z.enum(['push_or_sms', 'push_and_sms', 'sms_only']).default('push_or_sms'),
  /** Days the Connected systems screen keeps each request and delivery in its log. */
  INTEGRATION_LOG_DAYS: z.coerce.number().int().min(1).default(90),
  /** Days the alerts under the bell in the web app are kept. */
  NOTIFICATION_DAYS: z.coerce.number().int().min(1).default(90),
  /** No-power complaints within this distance of an open network incident are linked to it (metres). */
  INCIDENT_LINK_RADIUS_M: z.coerce.number().int().min(0).default(2000),
  /** A staff member on duty whose last position is older than this is shown as offline (minutes). */
  STAFF_OFFLINE_AFTER_MIN: z.coerce.number().int().min(1).default(15),
  /** How often time limits are checked for reminders and escalations (seconds). */
  ESCALATION_CHECK_SECONDS: z.coerce.number().int().min(5).default(60),
  /** Where survey results and connection updates are sent to the Sales system (webhook). Empty = Sales asks. */
  SALES_WEBHOOK_URL: z.string().url().optional(),
  /** Shared secret; each webhook carries X-EDM-Signature: sha256=HMAC of the body. */
  SALES_WEBHOOK_SECRET: z.string().optional(),
  /** Set to "false" to run the API without processing background jobs (e.g. a separate worker process). */
  /** Give new, declined and reopened tickets to the least busy field staff on duty without waiting for a manager. */
  AUTO_ASSIGN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RUN_WORKERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true')
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Reads the repository-root .env once (if present), then validates process.env. */
export function loadEnv(): Env {
  if (cached) return cached;
  const rootEnv = resolve(__dirname, '../../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const parsed = envSchema
    .refine((e) => e.SMS_PROVIDER !== 'http' || !!e.SMS_HTTP_URL, {
      message: 'SMS_HTTP_URL is required when SMS_PROVIDER=http',
      path: ['SMS_HTTP_URL']
    })
    // An empty value (e.g. "SMS_HTTP_URL=" in .env or docker compose) means "not set", so defaults apply.
    .safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
