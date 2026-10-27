import Keycloak from 'keycloak-js';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:58080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? 'edm',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'edm-web'
});

/** Sends the user to the Keycloak sign-in page if needed; resolves once signed in. */
export async function initAuth(): Promise<void> {
  await keycloak.init({ onLoad: 'login-required', pkceMethod: 'S256', checkLoginIframe: false });
}

/** A valid access token, refreshed when it expires within 30 seconds. */
export async function accessToken(): Promise<string> {
  try {
    await keycloak.updateToken(30);
  } catch {
    await keycloak.login();
  }
  return keycloak.token!;
}

export function signOut(): void {
  void keycloak.logout({ redirectUri: window.location.origin });
}
