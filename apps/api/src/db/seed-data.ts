/**
 * Sample data for development and tests, matching the approved mockup. Areas are simplified rectangles around
 * Maputo and Matola. Never loaded on a production server.
 */
export const SEED_AREAS = [
  {
    code: 'MATOLA',
    name: 'Matola',
    wkt: 'MULTIPOLYGON(((32.40 -26.00, 32.52 -26.00, 32.52 -25.88, 32.40 -25.88, 32.40 -26.00)))'
  },
  {
    code: 'MAPUTO_CENTRAL',
    name: 'Maputo Central',
    wkt: 'MULTIPOLYGON(((32.52 -26.00, 32.62 -26.00, 32.62 -25.90, 32.52 -25.90, 32.52 -26.00)))'
  }
] as const;

export const SEED_TEAMS = [
  { code: 'SOUTH_1', name: 'South 1', areaCode: 'MATOLA' },
  { code: 'SOUTH_2', name: 'South 2', areaCode: 'MAPUTO_CENTRAL' }
] as const;

/** Every sample person signs in with this password (argon2id hash below). */
export const SEED_PASSWORD = 'Edm@2026';
export const SEED_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$tF89W+sGYNVNT0BkYTC+pQ$w7GDotpSWCtL1CTaXsh3NGAhcqvel/VneDGQc/YQCeU';

/**
 * API keys of the other systems for development and tests.
 * On a server, administrators make real keys in the admin area (/admin → API keys).
 */
export const SEED_API_KEYS = [
  { system: 'call_center', name: 'Call Center (development)', key: 'edm_dev-call-center-key-000000000000' },
  { system: 'sales', name: 'Sales system (development)', key: 'edm_dev-sales-key-00000000000000000000' },
  { system: 'nms', name: 'NMS (development)', key: 'edm_dev-nms-key-000000000000000000000000' },
  { system: 'stock', name: 'Stock system (development)', key: 'edm_dev-stock-key-0000000000000000000000' }
] as const;

export const SEED_USERS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin.edm',
    fullName: 'Admin EDM',
    phone: null,
    team: null,
    roles: ['admin']
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    username: 'helena.mondlane',
    fullName: 'Helena Mondlane',
    phone: '+258840000002',
    team: 'SOUTH_1',
    roles: ['team_manager']
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    username: 'nadia.mussa',
    fullName: 'Nádia Mussa',
    phone: '+258840000003',
    team: null,
    roles: ['noc']
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    username: 'carlos.nhantumbo',
    fullName: 'Carlos Nhantumbo',
    phone: '+258840000004',
    team: null,
    roles: ['network_team']
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    username: 'paulo.bo',
    fullName: 'Paulo Machava',
    phone: '+258840000005',
    team: null,
    roles: ['bo_support']
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    username: 'armando.cossa',
    fullName: 'Armando Cossa',
    phone: '+258840000006',
    team: 'SOUTH_1',
    roles: ['field_staff']
  },
  {
    id: '00000000-0000-4000-8000-000000000007',
    username: 'joao.matsinhe',
    fullName: 'João Matsinhe',
    phone: '+258840000007',
    team: 'SOUTH_2',
    roles: ['team_manager']
  },
  {
    id: '00000000-0000-4000-8000-000000000008',
    username: 'ofelia.tembe',
    fullName: 'Ofélia Tembe',
    phone: '+258840000008',
    team: 'SOUTH_2',
    roles: ['field_staff']
  },
  {
    id: '00000000-0000-4000-8000-000000000009',
    username: 'ana.sitoe',
    fullName: 'Ana Sitoe',
    phone: '+258840000009',
    team: 'SOUTH_1',
    roles: ['field_staff']
  },
  {
    id: '00000000-0000-4000-8000-000000000010',
    username: 'carla.manhica',
    fullName: 'Carla Manhiça',
    phone: '+258840000011',
    team: null,
    roles: ['technical_manager']
  }
] as const;

export const SEED_CUSTOMERS = [
  {
    contractNo: '40217735',
    meterNumber: '04217735901',
    fullName: 'Rosa Chissano',
    phone: '+258841110001',
    address: 'Rua da Machava 1142, Matola',
    lng: 32.47,
    lat: -25.93
  },
  {
    contractNo: '40188210',
    meterNumber: '04188210377',
    fullName: 'Manuel Sitoe',
    phone: '+258841110002',
    address: 'Av. Paulo Samuel Kankhomba 512, Malhangalene',
    lng: 32.585,
    lat: -25.955
  },
  {
    contractNo: '40999999',
    meterNumber: null,
    fullName: 'Lurdes Macamo',
    phone: '+258841110003',
    address: 'Inhambane (outside the pilot areas)',
    lng: 35.38,
    lat: -23.86
  }
] as const;

/** Stock catalogue from the approved mockup (W14). Levels are on what is free in the depots. */
export const SEED_ITEMS = [
  { code: 'CAB-216', name: 'Service cable 2×16 mm²', unit: 'm', lowLevel: 200, watchLevel: 500 },
  { code: 'CON-PC1', name: 'Piercing connector', unit: 'pcs', lowLevel: 40, watchLevel: 100 },
  { code: 'MTR-P1', name: 'Prepaid meter, single-phase', unit: 'pcs', lowLevel: 10, watchLevel: 20 },
  { code: 'TRF-250', name: 'Transformer 250 kVA', unit: 'pcs', lowLevel: 1, watchLevel: 2 },
  { code: 'FUS-160', name: 'LV fuse 160 A', unit: 'pcs', lowLevel: 10, watchLevel: 20 },
  { code: 'POL-W9', name: 'Wooden pole 9 m', unit: 'pcs', lowLevel: 4, watchLevel: 8 },
  { code: 'JNT-MV', name: 'Cable joint kit MV', unit: 'set', lowLevel: 2, watchLevel: 4 }
] as const;

/** One depot per area. */
export const SEED_DEPOTS = [
  { code: 'DEP-MATOLA', name: 'Matola depot', areaCode: 'MATOLA' },
  { code: 'DEP-MAPUTO', name: 'Maputo Central depot', areaCode: 'MAPUTO_CENTRAL' }
] as const;

/** Vans, each with its own stock, and who drives it. */
export const SEED_VANS = [
  { plate: 'MPT-24-17', label: 'Toyota Hilux', team: 'SOUTH_1', driver: 'armando.cossa' },
  { plate: 'MPT-24-18', label: 'Toyota Hilux', team: 'SOUTH_1', driver: 'ana.sitoe' },
  { plate: 'MPC-24-03', label: 'Nissan NP200', team: 'SOUTH_2', driver: 'ofelia.tembe' }
] as const;

/** Opening stock: [depot or van plate, item code, quantity]. */
export const SEED_STOCK: [string, string, number][] = [
  ['DEP-MATOLA', 'CAB-216', 1240],
  ['DEP-MATOLA', 'CON-PC1', 86],
  ['DEP-MATOLA', 'MTR-P1', 34],
  ['DEP-MATOLA', 'TRF-250', 1],
  ['DEP-MATOLA', 'FUS-160', 18],
  ['DEP-MATOLA', 'POL-W9', 12],
  ['DEP-MATOLA', 'JNT-MV', 2],
  ['DEP-MAPUTO', 'CAB-216', 600],
  ['DEP-MAPUTO', 'MTR-P1', 20],
  ['DEP-MAPUTO', 'FUS-160', 12],
  ['MPT-24-17', 'CAB-216', 150],
  ['MPT-24-17', 'CON-PC1', 60],
  ['MPT-24-17', 'MTR-P1', 6],
  ['MPT-24-17', 'FUS-160', 10],
  ['MPT-24-18', 'CAB-216', 120],
  ['MPT-24-18', 'CON-PC1', 40],
  ['MPT-24-18', 'MTR-P1', 4],
  ['MPC-24-03', 'CAB-216', 100],
  ['MPC-24-03', 'MTR-P1', 5],
  ['MPC-24-03', 'FUS-160', 6]
];
