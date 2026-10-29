import { Injectable } from '@nestjs/common';
import type {
  IntegrationDocField,
  IntegrationDocOperation,
  IntegrationDocs,
  IntegrationDocSystem,
  IntegrationDocWebhook,
  IntegrationSystem
} from '../contract';

/** The part of an OpenAPI 3.0 schema this screen reads. */
interface Schema {
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  example?: unknown;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  exclusiveMinimum?: boolean;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: Schema }[];
  requestBody?: { content?: { 'application/json'?: { schema?: Schema } } };
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
}

/** Swagger tag of each system that calls EDM Tasks (each calls with its own API key). */
const SYSTEMS: { system: IntegrationSystem; tag: string }[] = [
  { system: 'call_center', tag: 'intake: call center' },
  { system: 'sales', tag: 'intake: sales' },
  { system: 'nms', tag: 'intake: NMS' },
  { system: 'stock', tag: 'intake: stock system' }
];

const PATH_PARAMS: Record<string, string> = {
  externalRef: 'The externalRef you sent when you created the request.'
};

/** What the Sales system receives at SALES_WEBHOOK_URL (see TicketsService and NotificationsService). */
const SALES_WEBHOOKS: IntegrationDocWebhook[] = [
  {
    event: 'survey_completed',
    description: 'The survey is done. The survey ticket is closed.',
    example: {
      event: 'survey_completed',
      externalRef: 'KS-2026-0001',
      code: 'TK-26-00102',
      sentAt: '2026-10-28T10:20:00.000Z',
      data: {
        result: 'feasible_with_works',
        distanceToNetworkM: 80,
        nearestElement: 'PT-4471',
        worksNeeded: 'One new pole',
        estimatedMaterials: [{ code: 'CAB-ABC-16', name: 'ABC cable 2x16 mm²', unit: 'm', quantity: 90 }],
        surveyedBy: 'Armando Cossa',
        note: null
      }
    }
  },
  {
    event: 'connection_installed',
    description:
      'The connection is built and the customer confirmed it. Activate the service, then send the activation result.',
    example: {
      event: 'connection_installed',
      externalRef: 'DN-2026-0001',
      code: 'TK-26-00131',
      sentAt: '2026-11-02T15:05:00.000Z',
      data: {
        meterNumber: '04188210377',
        sealNumber: 'S-55120',
        confirmedBy: 'sms_code',
        installedAt: '2026-11-02T15:04:10.000Z'
      }
    }
  },
  {
    event: 'request_cancelled',
    description: 'EDM cancelled the survey or the connection.',
    example: {
      event: 'request_cancelled',
      externalRef: 'DN-2026-0001',
      code: 'TK-26-00131',
      sentAt: '2026-10-30T09:00:00.000Z',
      data: { reason: 'Customer withdrew the request.' }
    }
  }
];

/**
 * Builds the "API documentation" screen from the same description Swagger shows, so it always matches the API.
 * It is kept even when the Swagger page is off (production): the screen needs signing in as an administrator.
 */
@Injectable()
export class IntegrationDocsService {
  private document: OpenApiDocument = { paths: {} };

  use(document: OpenApiDocument): void {
    this.document = document;
  }

  docs(): IntegrationDocs {
    return { systems: SYSTEMS.map((s) => this.system(s)) };
  }

  private system({ system, tag }: (typeof SYSTEMS)[number]): IntegrationDocSystem {
    const operations: IntegrationDocOperation[] = [];
    for (const [path, methods] of Object.entries(this.document.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!op.tags?.includes(tag)) continue;
        const body = op.requestBody?.content?.['application/json']?.schema;
        operations.push({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? '',
          description: op.description ?? null,
          fields: [
            ...(op.parameters ?? [])
              .filter((p) => p.in === 'path' || p.in === 'query')
              .map((p) =>
                field(
                  p.name,
                  p.in as 'path' | 'query',
                  p.schema ?? {},
                  p.required ?? false,
                  p.description ?? PATH_PARAMS[p.name]
                )
              ),
            ...(body ? flatten(body, '') : [])
          ],
          example: body ? example(body) : null
        });
      }
    }
    return { system, operations, webhooks: system === 'sales' ? SALES_WEBHOOKS : [] };
  }
}

function field(
  name: string,
  where: IntegrationDocField['in'],
  s: Schema,
  required: boolean,
  description?: string
): IntegrationDocField {
  return {
    name,
    in: where,
    type: s.type ?? 'any',
    format: s.format ?? null,
    required,
    description: s.description ?? description ?? null,
    values: s.enum ? s.enum.map(String) : null,
    min: s.minLength ?? s.minimum ?? s.minItems ?? null,
    max: s.maxLength ?? s.maximum ?? s.maxItems ?? null,
    minExclusive: s.exclusiveMinimum === true
  };
}

/** Every body field, parents before their children. */
function flatten(s: Schema, prefix: string): IntegrationDocField[] {
  const out: IntegrationDocField[] = [];
  for (const [key, child] of Object.entries(s.properties ?? {})) {
    const name = prefix + key;
    out.push(field(name, 'body', child, s.required?.includes(key) ?? false));
    if (child.properties) out.push(...flatten(child, `${name}.`));
    if (child.type === 'array' && child.items?.properties) out.push(...flatten(child.items, `${name}[].`));
  }
  return out;
}

/** A body that passes validation: required fields, and optional ones that carry an example. */
function example(s: Schema): unknown {
  if (s.example !== undefined) return s.example;
  if (s.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(s.properties)) {
      if (s.required?.includes(key) || child.example !== undefined) out[key] = example(child);
    }
    return out;
  }
  if (s.type === 'array') return s.items ? [example(s.items)] : [];
  if (s.enum?.length) return s.enum[0];
  if (s.default !== undefined) return s.default;
  if (s.type === 'boolean') return true;
  if (s.type === 'number' || s.type === 'integer') return s.minimum ?? 1;
  if (s.format === 'date-time') return new Date().toISOString();
  return 'text';
}
