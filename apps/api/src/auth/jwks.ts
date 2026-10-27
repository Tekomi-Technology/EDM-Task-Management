import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { Env } from '../config/env';

/** Key set used to check token signatures; tests replace it with a local key. */
export const JWKS = Symbol('JWKS');

export function keycloakIssuer(env: Env): string {
  return `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}`;
}

export function createKeycloakJwks(env: Env): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${keycloakIssuer(env)}/protocol/openid-connect/certs`));
}
