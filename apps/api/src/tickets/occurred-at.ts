import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { OCCURRED_AT_HEADER } from '@edm/shared';

const MAX_AGE_MS = 7 * 24 * 3600_000;
const CLOCK_SKEW_MS = 2 * 60_000;

/**
 * When an action done offline really happened, from the X-Occurred-At header. Only kept when it is clearly
 * earlier than now and not older than a week; a phone with a wrong clock must not block the upload, so
 * anything else is ignored rather than refused.
 */
export function parseOccurredAt(raw: string | undefined, now = Date.now()): Date | undefined {
  if (!raw) return undefined;
  const at = Date.parse(raw);
  if (Number.isNaN(at) || at > now + CLOCK_SKEW_MS || now - at > MAX_AGE_MS) return undefined;
  return now - at > 60_000 ? new Date(at) : undefined;
}

export const OccurredAt = createParamDecorator((_: unknown, ctx: ExecutionContext): Date | undefined => {
  const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
  return parseOccurredAt(req.headers[OCCURRED_AT_HEADER]);
});
