/**
 * Load test (k6): a large storm. While the NMS sends bursts of alarms and the Call Center sends a flood of
 * no-power complaints, managers and NOC keep their screens open (counts, Overview, ticket lists, reports)
 * and field staff send their positions.
 *
 * Run against the load database (tools/loadtest/prepare.sh, then `pnpm loadtest:api`):
 *   pnpm loadtest                       # default storm, about 4 minutes
 *   PEAK=20 OFFICE=80 pnpm loadtest     # harder
 * Every rate can be changed with an environment variable (see CONFIG).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const CONFIG = {
  api: __ENV.API_URL || 'http://localhost:3001/api',
  keycloak: __ENV.KEYCLOAK_URL || 'http://localhost:58080',
  realm: __ENV.KEYCLOAK_REALM || 'edm',
  /** Complaints per second at the peak of the storm (36,000 an hour at 10). */
  peak: Number(__ENV.PEAK || 10),
  /** Alarm batches per second from the NMS, ALARMS alarms each. */
  alarmBatches: Number(__ENV.ALARM_BATCHES || 2),
  alarms: Number(__ENV.ALARMS || 5),
  /** People with an office screen open (each refreshes every few seconds). */
  office: Number(__ENV.OFFICE || 40),
  /** Phones sending positions. */
  phones: Number(__ENV.PHONES || 20),
  customers: Number(__ENV.LOAD_CUSTOMERS || 20000),
  minutes: Number(__ENV.MINUTES || 3)
};

const PROBLEMS = [
  'no_power_single',
  'no_power_single',
  'no_power_street',
  'low_voltage',
  'cable_down',
  'prepaid_meter'
];
const SEVERITIES = ['critical', 'major', 'major', 'minor'];
const hold = `${CONFIG.minutes}m`;

export const options = {
  scenarios: {
    complaints: {
      executor: 'ramping-arrival-rate',
      exec: 'complaint',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { target: CONFIG.peak, duration: '30s' },
        { target: CONFIG.peak, duration: hold },
        { target: 0, duration: '15s' }
      ]
    },
    nms: {
      executor: 'constant-arrival-rate',
      exec: 'alarmBurst',
      rate: CONFIG.alarmBatches,
      timeUnit: '1s',
      duration: hold,
      startTime: '15s',
      preAllocatedVUs: 10,
      maxVUs: 100
    },
    office: {
      executor: 'constant-vus',
      exec: 'officeScreens',
      vus: CONFIG.office,
      duration: hold,
      startTime: '10s'
    },
    phones: { executor: 'constant-vus', exec: 'phone', vus: CONFIG.phones, duration: hold, startTime: '10s' }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:intake}': ['p(95)<1000'],
    'http_req_duration{kind:alarms}': ['p(95)<1500'],
    'http_req_duration{kind:office}': ['p(95)<1500'],
    'http_req_duration{kind:report}': ['p(95)<3000'],
    'http_req_duration{kind:phone}': ['p(95)<800'],
    checks: ['rate>0.99']
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max']
};

function token(form) {
  const res = http.post(`${CONFIG.keycloak}/realms/${CONFIG.realm}/protocol/openid-connect/token`, form);
  if (res.status !== 200) throw new Error(`Keycloak refused ${form.client_id}: ${res.status} ${res.body}`);
  return res.json('access_token');
}
const client = (id, secret) =>
  token({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
const person = (username) =>
  token({
    grant_type: 'password',
    client_id: 'edm-dev-cli',
    username,
    password: __ENV.PASSWORD || 'Edm@2026'
  });

function retry(request, times = 5) {
  for (let i = 0; i < times; i++) {
    const res = request();
    if (res.status === 200) return true;
    sleep(2);
  }
  return false;
}

export function setup() {
  if (!retry(() => http.get(`${CONFIG.api}/health`, { timeout: '10s' }), 10)) {
    throw new Error(`The API at ${CONFIG.api} does not answer`);
  }
  const tokens = {
    callCenter: client('call-center-system', __ENV.CALLCENTER_CLIENT_SECRET || 'call-center-dev-secret'),
    nms: client('nms-system', __ENV.NMS_CLIENT_SECRET || 'nms-dev-secret'),
    office: ['nadia.mussa', 'helena.mondlane', 'carla.manhica', 'joao.matsinhe'].map(person),
    staff: ['armando.cossa', 'ana.sitoe', 'ofelia.tembe'].map(person)
  };
  // Staff on duty, so the storm is assigned automatically as it would be. A first connection through Docker's
  // network can be slow, so try a few times, and stop rather than test something else than intended.
  for (const t of tokens.staff) {
    const ok = retry(() => http.post(`${CONFIG.api}/me/duty`, JSON.stringify({ onDuty: true }), json(t)));
    if (!ok) throw new Error('Could not put the field staff on duty');
  }
  return tokens;
}

function json(tok, kind = 'setup') {
  return { headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, tags: { kind } };
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const matola = () => ({ lat: -25.99 + Math.random() * 0.08, lng: 32.42 + Math.random() * 0.2 });

export function complaint(t) {
  const n = 1 + Math.floor(Math.random() * CONFIG.customers);
  const res = http.post(
    `${CONFIG.api}/intake/call-center/complaints`,
    JSON.stringify({
      externalRef: `LOAD-${__VU}-${__ITER}-${Date.now()}`,
      contractNo: `5${String(n).padStart(7, '0')}`,
      problemType: pick(PROBLEMS),
      description: 'No power since the storm'
    }),
    json(t.callCenter, 'intake')
  );
  check(res, { 'complaint accepted': (r) => r.status === 201 });
}

export function alarmBurst(t) {
  // About 300 feeders: the first alarm on a feeder opens an incident, later ones join it.
  const feeder = `F-LOAD-${Math.floor(Math.random() * 300)}`;
  const where = matola();
  const alarms = Array.from({ length: CONFIG.alarms }, (_, i) => ({
    alarmId: `LOAD-${__VU}-${__ITER}-${i}-${Date.now()}`,
    event: 'raise',
    elementCode: i === 0 ? feeder : `${feeder}-RMU-${i}`,
    parentElementCode: i === 0 ? undefined : feeder,
    alarmType: i === 0 ? 'Breaker trip' : 'Voltage loss downstream',
    severity: pick(SEVERITIES),
    occurredAt: new Date().toISOString(),
    location: where,
    customersAffected: i === 0 ? 200 + Math.floor(Math.random() * 2000) : undefined
  }));
  const res = http.post(`${CONFIG.api}/intake/nms/alarms`, JSON.stringify({ alarms }), json(t.nms, 'alarms'));
  check(res, { 'alarms accepted': (r) => r.status === 200 });
}

export function officeScreens(t) {
  const tok = t.office[__VU % t.office.length];
  const get = (path, kind = 'office') => http.get(`${CONFIG.api}${path}`, json(tok, kind));
  const results = [get('/tickets/counts'), get('/overview'), get('/tickets?view=active&limit=25')];
  if (__ITER % 5 === 0) results.push(get('/incidents'));
  if (__ITER % 10 === 0) {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
    results.push(get(`/reports?from=${from}&to=${to}`, 'report'));
  }
  check(results, { 'screens load': (rs) => rs.every((r) => r.status === 200) });
  sleep(5 + Math.random() * 5);
}

export function phone(t) {
  const tok = t.staff[__VU % t.staff.length];
  const res = http.post(
    `${CONFIG.api}/me/locations`,
    JSON.stringify({ points: [{ ...matola(), accuracy: 12, recordedAt: new Date().toISOString() }] }),
    json(tok, 'phone')
  );
  const jobs = http.get(`${CONFIG.api}/me/jobs`, json(tok, 'phone'));
  check([res, jobs], { 'phone syncs': (rs) => rs.every((r) => r.status === 200) });
  sleep(10);
}
