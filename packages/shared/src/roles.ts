/** Keycloak realm roles. People log in with the first group; other EDM systems use the integration roles. */
export const USER_ROLES = [
  'admin',
  /** Senior technical manager: sees everything and is told when tickets are badly late (third escalation). */
  'technical_manager',
  'team_manager',
  'noc',
  'network_team',
  'bo_support',
  'field_staff'
] as const;
export const INTEGRATION_ROLES = [
  'integration_call_center',
  'integration_sales',
  'integration_nms',
  'integration_stock'
] as const;
export const ROLES = [...USER_ROLES, ...INTEGRATION_ROLES] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type IntegrationRole = (typeof INTEGRATION_ROLES)[number];
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
