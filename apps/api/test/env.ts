// Test configuration: separate database, Redis db and bucket, so tests never touch development data.
// Tokens are signed by a key generated in test/helpers.ts, so Keycloak does not need to be running.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://edm:edm_dev_password@localhost:55432/edm_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/1',
  KEYCLOAK_URL: 'http://keycloak.test',
  KEYCLOAK_REALM: 'edm',
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:59000',
  S3_ACCESS_KEY: 'edm',
  S3_SECRET_KEY: 'edm_dev_password',
  S3_BUCKET: 'edm-test-attachments',
  RUN_WORKERS: 'true',
  SMS_PROVIDER: 'log',
  // Push goes to a stand-in for Expo that test/push.test.ts starts on this port.
  PUSH_PROVIDER: 'expo',
  EXPO_PUSH_URL: 'http://localhost:59871/push',
  STAFF_ALERTS: 'push_or_sms',
  // Webhooks to the Sales system go to a stand-in that test/sales.test.ts starts on this port.
  SALES_WEBHOOK_URL: 'http://localhost:59873/sales',
  SALES_WEBHOOK_SECRET: 'test-webhook-secret',
  // Address lookups go to a stand-in for Nominatim that test/places.test.ts starts on this port.
  GEOCODER_URL: 'http://localhost:59874'
});
