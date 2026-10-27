/**
 * The API contract shared by the API, the web app and the field staff app. The app lives in the EDM-Mobile
 * repository, which copies these files with `pnpm sync-shared`: after changing them, the app must copy them again.
 */
export * from './roles.js';
export * from './ticket.js';
export * from './schemas.js';
export * from './api-types.js';
