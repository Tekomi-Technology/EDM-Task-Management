/** People sign in with the first group of roles; other EDM systems call the API with a key that has one integration role. */
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

/** The other EDM systems that call this one with an API key, and the role each key gives. */
export const API_KEY_SYSTEMS = ['call_center', 'sales', 'nms', 'stock'] as const;
export type ApiKeySystem = (typeof API_KEY_SYSTEMS)[number];
export const API_KEY_ROLE: Record<ApiKeySystem, IntegrationRole> = {
  call_center: 'integration_call_center',
  sales: 'integration_sales',
  nms: 'integration_nms',
  stock: 'integration_stock'
};

export type UserRole = (typeof USER_ROLES)[number];
export type IntegrationRole = (typeof INTEGRATION_ROLES)[number];
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
