/**
 * The API's data formats: roles, ticket states and rules, request schemas (checked here) and response types.
 * This is the reference; the web app (apps/web/src/types.ts) and the field staff app (EDM-Mobile, src/types.ts)
 * keep their own copy of the types they use, so a change here must be made there too.
 */
export * from './roles.js';
export * from './ticket.js';
export * from './schemas.js';
export * from './api-types.js';
