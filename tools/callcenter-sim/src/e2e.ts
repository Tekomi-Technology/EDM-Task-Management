/**
 * End-to-end check of the sample flow against the running stack (Keycloak, API, database, storage):
 * Call Center complaint → team manager assigns → field staff accept, start, upload a photo, resolve →
 * Call Center confirms with the customer → closed.
 * Then phase 2: automatic assignment to staff on duty, decline, pause/resume, cancel, and account management
 * (create, block, unblock) through the real Keycloak; then phase 2 batch 2: push device registration and
 * replaying actions the app did offline. Phase 4: stock synced from EDM's stock system, a new customer
 * from survey to activation through the Sales system, help requests, and material taken off the van.
 * Run with `pnpm e2e` while `pnpm infra:up` and the API are running.
 */
// The API's contract is CommonJS: values come through its default export, types are erased.
import contract, {
  type AdminUser,
  type CreatedTicketView,
  type CustomerMatch,
  type HelpRequestView,
  type Inbox,
  type IntegrationsOverview,
  type MyVan,
  type Report,
  type TicketPreview,
  type TeamView,
  type TicketDetail
} from '../../../apps/api/src/contract/index.js';
import {
  API_URL,
  call,
  callCenterToken,
  nmsToken,
  salesToken,
  signInError,
  stockToken,
  userToken
} from './client.js';

const { OCCURRED_AT_HEADER } = contract;

let step = 0;
function ok(condition: unknown, message: string): void {
  step += 1;
  if (!condition) {
    console.error(`✗ ${step}. ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${step}. ${message}`);
}

async function main(): Promise<void> {
  const ref = `CC-E2E-${Date.now()}`;
  const [cc, helena, armando, ana, admin] = await Promise.all([
    callCenterToken(),
    userToken('helena.mondlane'),
    userToken('armando.cossa'),
    userToken('ana.sitoe'),
    userToken('admin.edm')
  ]);
  // Start with nobody on duty, so the sample flow is assigned by the manager.
  await call(armando, 'POST', '/me/duty', { onDuty: false });
  await call(ana, 'POST', '/me/duty', { onDuty: false });

  const created = await call<{ ticketId: string; code: string; status: string }>(
    cc,
    'POST',
    '/intake/call-center/complaints',
    {
      externalRef: ref,
      contractNo: '40217735',
      problemType: 'prepaid_meter',
      // A meter problem, so it is never linked to a network incident that happens to be open on the dev system.
      description: 'Bought credit at 07:15 but the meter does not accept the code.'
    }
  );
  ok(created.status === 201, `Call Center sends a complaint → ticket ${created.body.code} created`);
  const id = created.body.ticketId;

  const me = await call<{ teamId: string }>(helena, 'GET', '/me');
  const staff = await call<{ id: string; fullName: string }[]>(
    helena,
    'GET',
    `/teams/${me.body.teamId}/staff`
  );
  const armandoRow = staff.body.find((s) => s.fullName === 'Armando Cossa');
  ok(armandoRow, 'Team manager Helena sees Armando in her team');

  const assigned = await call<TicketDetail>(helena, 'POST', `/tickets/${id}/assign`, {
    assigneeId: armandoRow!.id
  });
  ok(assigned.body.status === 'assigned', 'Helena assigns the ticket to Armando');

  const jobs = await call<{ id: string }[]>(armando, 'GET', '/me/jobs');
  ok(
    jobs.body.some((j) => j.id === id),
    'The job appears in Armando’s list'
  );

  ok(
    (await call<TicketDetail>(armando, 'POST', `/tickets/${id}/accept`)).body.status === 'accepted',
    'Armando accepts the job'
  );
  ok(
    (await call<TicketDetail>(armando, 'POST', `/tickets/${id}/start`)).body.status === 'in_progress',
    'Armando starts work'
  );

  const upload = await call<{ attachmentId: string; uploadUrl: string; headers: Record<string, string> }>(
    armando,
    'POST',
    `/tickets/${id}/attachments`,
    { fileName: 'pole-p4471.jpg', contentType: 'image/jpeg', size: 4 }
  );
  const put = await fetch(upload.body.uploadUrl, {
    method: 'PUT',
    headers: upload.body.headers,
    body: 'jpeg'
  });
  ok(put.ok, 'Armando uploads a photo');

  const resolved = await call<TicketDetail>(armando, 'POST', `/tickets/${id}/resolve`, {
    note: 'Replaced 12 m of service cable at pole P-4471. Power back at 10:05.',
    attachmentIds: [upload.body.attachmentId]
  });
  ok(
    resolved.body.status === 'resolved' && resolved.body.attachments.length === 1,
    'Armando reports the job done with the photo'
  );

  const status = await call<{ status: string; resolutionNote: string }>(
    cc,
    'GET',
    `/intake/call-center/tickets/${ref}`
  );
  ok(
    status.body.status === 'resolved' && status.body.resolutionNote.includes('P-4471'),
    'Call Center sees the job is waiting for its check'
  );

  const closed = await call<{ status: string }>(
    cc,
    'POST',
    `/intake/call-center/tickets/${ref}/check-result`,
    {
      result: 'fixed',
      note: 'Customer confirms the power is back'
    }
  );
  ok(closed.body.status === 'closed', 'Call Center confirms with the customer → ticket closed');

  const detail = await call<TicketDetail>(helena, 'GET', `/tickets/${id}`);
  const history = detail.body.events.map((e) => e.type).join(' → ');
  ok(history === 'created → assign → accept → start → resolve → close', `History: ${history}`);

  console.log(`\nSample flow passed for ${created.body.code}.\n`);

  await phase2({ cc, helena, armando, admin });
  await offlineAndPush({ cc, helena });
  await networkAndField({ cc });
  await stockAndNewCustomers();
  await reportsAndSystems();
}

async function reportsAndSystems(): Promise<void> {
  const [carla, helena, cc] = await Promise.all([
    userToken('carla.manhica'),
    userToken('helena.mondlane'),
    callCenterToken()
  ]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Maputo' });
  const report = await call<Report>(carla, 'GET', `/reports?from=${today}&to=${today}`);
  ok(
    report.status === 200 && report.body.closed > 0 && report.body.perDay.length === 1,
    `Reports: ${report.body.closed} tickets closed today, ${report.body.onTimePct ?? '—'}% on time, ` +
      `${report.body.firstTimePct ?? '—'}% fixed the first time`
  );
  const csv = await fetch(`${API_URL}/reports/tickets.csv?from=${today}&to=${today}`, {
    headers: { Authorization: `Bearer ${helena}` }
  });
  const lines = (await csv.text()).trim().split('\r\n');
  ok(
    csv.ok && lines[0]!.includes('Code,Type,Source') && lines.length > 1,
    `Helena downloads today’s tickets of her team as a spreadsheet (${lines.length - 1} rows)`
  );

  const systems = await call<IntegrationsOverview>(carla, 'GET', '/integrations');
  const callCenter = systems.body.systems.find((s) => s.system === 'call_center');
  ok(
    callCenter?.status === 'connected' && callCenter.lastOkAt !== null,
    `Connected systems: the Call Center is connected (today: ${callCenter?.today})`
  );
  const test = await call<{ ok: boolean; message: string }>(carla, 'POST', '/integrations/call_center/test');
  ok(test.body.ok, `Test connection checks the Call Center’s account in Keycloak: “${test.body.message}”`);
  const refused = await call<{ code: string }>(cc, 'GET', '/stock/items');
  ok(refused.status === 403, 'Another system’s account cannot read anything outside its own /intake routes');

  // New ticket screen: BO takes a call themselves.
  const paulo = await userToken('paulo.bo');
  const [rosa] = (await call<CustomerMatch[]>(paulo, 'GET', '/customers/lookup?q=84%20111%200001')).body;
  const preview = await call<TicketPreview>(paulo, 'POST', '/tickets/preview', {
    caller: 'customer',
    customerId: rosa!.id,
    problemType: 'low_voltage'
  });
  const made = await call<CreatedTicketView>(paulo, 'POST', '/tickets', {
    caller: 'customer',
    customerId: rosa!.id,
    problemType: 'low_voltage',
    description: 'Lights flicker every evening'
  });
  ok(
    rosa?.fullName === 'Rosa Chissano' && preview.body.team?.name === 'South 1' && made.status === 201,
    `BO finds the caller by phone, sees team ${preview.body.team?.name} will get it, and creates ${made.body.code}`
  );
  const bell = await call<Inbox>(helena, 'GET', '/me/notifications');
  ok(
    bell.status === 200 && Array.isArray(bell.body.items),
    `Helena’s bell shows ${bell.body.unread} unread alerts`
  );

  console.log('\nPhase 5 checks passed.');
}

async function stockAndNewCustomers(): Promise<void> {
  const [sales, stock, helena, armando, ana, paulo] = await Promise.all([
    salesToken(),
    stockToken(),
    userToken('helena.mondlane'),
    userToken('armando.cossa'),
    userToken('ana.sitoe'),
    userToken('paulo.bo')
  ]);
  const stamp = Date.now();
  const since = new Date(stamp - 1000).toISOString();

  const receipt = {
    externalRef: `E2E-GR-${stamp}`,
    depotCode: 'DEP-MATOLA',
    lines: [{ itemCode: 'MTR-P1', quantity: 3 }]
  };
  const first = await call<{ result: string }>(stock, 'POST', '/intake/stock/receipts', receipt);
  const again = await call<{ result: string }>(stock, 'POST', '/intake/stock/receipts', receipt);
  ok(
    first.body.result === 'received' && again.body.result === 'duplicate',
    'EDM’s stock system books a delivery to the Matola depot; sending it twice books it once'
  );

  const vanBefore = await call<MyVan>(armando, 'GET', '/me/van');
  const meter = vanBefore.body.catalog.find((i) => i.code === 'MTR-P1')!;
  const cable = vanBefore.body.catalog.find((i) => i.code === 'CAB-216')!;
  const depots = await call<{ id: string; code: string }[]>(helena, 'GET', '/stock/locations');
  // Earlier runs may have left the van short (stock can go below zero when staff use more than was booked).
  const vanStock = await call<{ code: string; quantity: number }[]>(
    helena,
    'GET',
    `/stock/locations/${vanBefore.body.vehicle!.locationId}`
  );
  const onBoard = vanStock.body.find((l) => l.code === 'MTR-P1')?.quantity ?? 0;
  const given = await call(helena, 'POST', '/stock/transfer', {
    fromLocationId: depots.body.find((l) => l.code === 'DEP-MATOLA')!.id,
    toLocationId: vanBefore.body.vehicle!.locationId,
    lines: [{ itemId: meter.id, quantity: Math.max(1, 1 - onBoard) }]
  });
  const van = await call<MyVan>(armando, 'GET', '/me/van');
  const metersBefore = van.body.lines.find((l) => l.code === 'MTR-P1')?.quantity ?? 0;
  ok(
    given.status < 300 && van.body.vehicle?.plate === 'MPT-24-17' && metersBefore >= 1,
    `Helena gives a meter from the Matola depot to Armando’s van ${van.body.vehicle?.plate}; his app shows it`
  );

  await call(ana, 'POST', '/me/duty', { onDuty: false });
  await call(armando, 'POST', '/me/duty', { onDuty: true });
  const surveyRef = `E2E-S-${stamp}`;
  const survey = await call<{ ticketId: string; code: string; assigneeName: string | null }>(
    sales,
    'POST',
    '/intake/sales/survey-requests',
    {
      externalRef: surveyRef,
      customer: {
        fullName: 'Loja E2E',
        address: 'Matola Gare, Rua 4',
        location: { lat: -25.931, lng: 32.471 }
      },
      premises: 'shop',
      supply: 'single_phase',
      requestedLoadKw: 6
    }
  );
  ok(
    survey.status === 201 && survey.body.assigneeName === 'Armando Cossa',
    `Sales asks for a survey → job ${survey.body.code} goes to Armando`
  );
  const surveyId = survey.body.ticketId;
  await call(armando, 'POST', `/tickets/${surveyId}/accept`);
  await call(armando, 'POST', `/tickets/${surveyId}/start`);
  const surveyed = await call<TicketDetail>(armando, 'POST', `/tickets/${surveyId}/resolve`, {
    note: 'Pole P-77 at 35 m',
    survey: {
      result: 'feasible',
      distanceToNetworkM: 35,
      nearestElement: 'P-77',
      estimatedMaterials: [
        { itemId: cable.id, quantity: 30 },
        { itemId: meter.id, quantity: 1 }
      ]
    }
  });
  ok(surveyed.body.status === 'closed', 'Armando sends the survey report; the survey closes by itself');
  const surveyStatus = await call<{ status: string; survey: { result: string } | null }>(
    sales,
    'GET',
    `/intake/sales/requests/${surveyRef}`
  );
  ok(surveyStatus.body.survey?.result === 'feasible', 'Sales reads the result back: feasible');

  const connRef = `E2E-C-${stamp}`;
  const contractNo = `E2E${stamp}`;
  const conn = await call<{ ticketId: string; code: string }>(
    sales,
    'POST',
    '/intake/sales/connection-requests',
    {
      externalRef: connRef,
      contractNo,
      surveyRef,
      supply: 'single_phase'
    }
  );
  const connId = conn.body.ticketId;
  const planned = await call<TicketDetail>(helena, 'GET', `/tickets/${connId}`);
  ok(
    planned.body.type === 'new_connection' &&
      planned.body.customer?.contractNo === contractNo &&
      planned.body.reservations.some((r) => r.code === 'CAB-216' && r.quantity === 30),
    `Contract signed → connection ${conn.body.code}, with the surveyed material set aside in the depot`
  );
  if (planned.body.assignee?.fullName !== 'Armando Cossa') {
    await call(helena, 'POST', `/tickets/${connId}/assign`, {
      assigneeId: (await call<{ id: string }>(armando, 'GET', '/me')).body.id
    });
  }
  await call(armando, 'POST', `/tickets/${connId}/accept`);
  await call(armando, 'POST', `/tickets/${connId}/start`);

  const help = await call<HelpRequestView>(armando, 'POST', '/help-requests', {
    kind: 'second_person',
    message: 'Need a second person to lift the meter box',
    ticketId: connId
  });
  ok(help.status === 201 && help.body.status === 'new', 'Armando asks the office for help from the job');
  const reply = await call<HelpRequestView>(paulo, 'POST', `/help-requests/${help.body.id}/messages`, {
    body: 'João is on his way, 20 minutes'
  });
  ok(reply.body.status === 'in_progress', 'Back office (Paulo) answers; the request is being handled');
  const mine = await call<HelpRequestView[]>(armando, 'GET', '/me/help-requests');
  ok(
    mine.body.find((h) => h.id === help.body.id)?.messages.some((m) => m.body.includes('João')),
    'Armando reads the answer in the app'
  );
  await call(paulo, 'POST', `/help-requests/${help.body.id}/messages`, { body: 'Done', status: 'solved' });

  const noPhone = await call<{ code: string }>(armando, 'POST', `/tickets/${connId}/handover-code`);
  ok(noPhone.body.code === 'NO_CUSTOMER_PHONE', 'The customer has no phone, so no code can be texted');
  const upload = await call<{ attachmentId: string; uploadUrl: string; headers: Record<string, string> }>(
    armando,
    'POST',
    `/tickets/${connId}/attachments`,
    { fileName: 'handover-form.jpg', contentType: 'image/jpeg', size: 4 }
  );
  await fetch(upload.body.uploadUrl, { method: 'PUT', headers: upload.body.headers, body: 'jpeg' });
  const installed = await call<TicketDetail>(armando, 'POST', `/tickets/${connId}/resolve`, {
    note: 'Meter installed and tested',
    attachmentIds: [upload.body.attachmentId],
    materials: [{ itemId: meter.id, quantity: 1 }],
    installation: { meterNumber: `MP-${stamp}`, signedFormAttachmentId: upload.body.attachmentId }
  });
  ok(
    installed.body.status === 'resolved' &&
      installed.body.newCustomer?.installation?.confirmedBy === 'signed_form',
    'Armando reports the connection done, with the signed handover form and the meter he used'
  );

  const activated = await call<{ status: string }>(
    sales,
    'POST',
    `/intake/sales/connections/${connRef}/activation`,
    {
      activated: true
    }
  );
  ok(activated.body.status === 'closed', 'Sales activates the service → the connection closes');
  const closed = await call<TicketDetail>(helena, 'GET', `/tickets/${connId}`);
  const vanAfter = await call<MyVan>(armando, 'GET', '/me/van');
  const metersAfter = vanAfter.body.lines.find((l) => l.code === 'MTR-P1')?.quantity ?? 0;
  ok(
    closed.body.materials.every((m) => m.posted) &&
      closed.body.reservations.length === 0 &&
      metersAfter === metersBefore - 1,
    `The meter comes off Armando’s van (${metersBefore} → ${metersAfter}) and the set-aside material is released`
  );
  const used = await call<{ itemCode: string; ticketCode: string | null }[]>(
    stock,
    'GET',
    `/intake/stock/consumption?since=${encodeURIComponent(since)}`
  );
  ok(
    used.body.some((u) => u.itemCode === 'MTR-P1'),
    'EDM’s stock system reads the consumption back'
  );
  await call(armando, 'POST', '/me/duty', { onDuty: false });

  console.log('\nPhase 4 checks passed.');
}

async function networkAndField(t: { cc: string }): Promise<void> {
  const { cc } = t;
  const [nms, nadia, carlos, carla] = await Promise.all([
    nmsToken(),
    userToken('nadia.mussa'),
    userToken('carlos.nhantumbo'),
    userToken('carla.manhica')
  ]);
  const armando = await userToken('armando.cossa');
  const ana = await userToken('ana.sitoe');
  await call(ana, 'POST', '/me/duty', { onDuty: false });
  await call(armando, 'POST', '/me/duty', { onDuty: true });
  const located = await call<{ accepted: number }>(armando, 'POST', '/me/locations', {
    points: [{ lat: -25.932, lng: 32.47, accuracy: 10, recordedAt: new Date().toISOString() }]
  });
  ok(located.body.accepted === 1, 'Armando’s phone shares his position while on duty');

  const stamp = Date.now();
  const where = { lat: -25.931, lng: 32.471 };
  const raised = await call<{ results: { result: string; ticketId: string; code: string }[] }>(
    nms,
    'POST',
    '/intake/nms/alarms',
    {
      alarms: [
        {
          alarmId: `E2E-CB-${stamp}`,
          event: 'raise',
          elementCode: `F-E2E-${stamp}`,
          elementName: 'Feeder E2E',
          alarmType: 'Breaker trip, overcurrent',
          severity: 'critical',
          occurredAt: new Date().toISOString(),
          location: where,
          customersAffected: 800
        },
        {
          alarmId: `E2E-RMU-${stamp}`,
          event: 'raise',
          elementCode: `RMU-E2E-${stamp}`,
          parentElementCode: `F-E2E-${stamp}`,
          alarmType: 'Voltage loss downstream',
          severity: 'major',
          occurredAt: new Date().toISOString(),
          location: where
        }
      ]
    }
  );
  const [first, second] = raised.body.results;
  ok(
    first?.result === 'created' && second?.result === 'grouped' && second.ticketId === first.ticketId,
    `NMS sends two alarms of one fault → one incident ${first?.code}`
  );
  const incidentId = first!.ticketId;

  const incident = await call<TicketDetail>(nadia, 'GET', `/tickets/${incidentId}`);
  const autoAssign = incident.body.events.find((e) => e.type === 'assign');
  ok(
    incident.body.assignee?.fullName === 'Armando Cossa' && typeof autoAssign?.data.distanceM === 'number',
    `The incident goes to the nearest staff on duty (Armando, ${String(autoAssign?.data.distanceM)} m away)`
  );

  const ack = await call<TicketDetail>(nadia, 'POST', `/tickets/${incidentId}/acknowledge`);
  ok(ack.body.network?.acknowledgedBy === 'Nádia Mussa', 'NOC acknowledges the incident');

  const complaint = await call<{ ticketId: string }>(cc, 'POST', '/intake/call-center/complaints', {
    externalRef: `CC-E2E4-${stamp}`,
    contractNo: '40217735',
    problemType: 'no_power_single',
    description: 'No power since the morning'
  });
  const linked = await call<TicketDetail>(nadia, 'GET', `/tickets/${complaint.body.ticketId}`);
  ok(
    linked.body.incident?.id === incidentId && !linked.body.assignee,
    'A no-power call nearby is linked to the incident; nobody else is sent'
  );

  for (const step of ['accept', 'start']) await call(armando, 'POST', `/tickets/${incidentId}/${step}`);
  await call(armando, 'POST', `/tickets/${incidentId}/resolve`, {
    note: 'Replaced the blown fuse at the feeder breaker'
  });
  const cleared = await call<{ results: { result: string }[] }>(nms, 'POST', '/intake/nms/alarms', {
    alarms: [
      {
        alarmId: `E2E-CB-${stamp}`,
        event: 'clear',
        elementCode: `F-E2E-${stamp}`,
        alarmType: '-',
        severity: 'critical',
        occurredAt: new Date().toISOString()
      },
      {
        alarmId: `E2E-RMU-${stamp}`,
        event: 'clear',
        elementCode: `RMU-E2E-${stamp}`,
        alarmType: '-',
        severity: 'major',
        occurredAt: new Date().toISOString()
      }
    ]
  });
  ok(
    cleared.body.results.every((r) => r.result === 'cleared'),
    'The NMS reports both alarms cleared'
  );
  const closed = await call<TicketDetail>(nadia, 'POST', `/tickets/${incidentId}/close`, {
    note: 'Feeder back in service'
  });
  const customer = await call<TicketDetail>(nadia, 'GET', `/tickets/${complaint.body.ticketId}`);
  ok(
    closed.body.status === 'closed' && customer.body.status === 'closed',
    'NOC closes the incident; the linked customer ticket closes with it'
  );

  const teams = await call<{ teams: { id: string; name: string }[] }>(nadia, 'GET', '/lookups');
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const planned = await call<TicketDetail>(carlos, 'POST', '/planned-work', {
    kind: 'maintenance',
    title: `Inspect transformer PT-E2E-${stamp}`,
    element: 'PT-E2E · Matola',
    teamId: teams.body.teams.find((x) => x.name === 'South 1')!.id,
    scheduledStart: `${day}T06:00:00Z`,
    scheduledEnd: `${day}T09:00:00Z`,
    outage: true,
    customersAffected: 120
  });
  const outages = await call<{ code: string }[]>(cc, 'GET', '/intake/call-center/planned-outages');
  ok(
    planned.status === 201 && outages.body.some((o) => o.code === planned.body.code),
    `The network team plans work ${planned.body.code}; the Call Center sees the planned power cut`
  );
  await call(nadia, 'POST', `/tickets/${planned.body.id}/cancel`, { reason: 'End-to-end test' });

  const staff = await call<{ fullName: string; state: string; jobsDone: number }[]>(
    carla,
    'GET',
    '/field-staff?days=1'
  );
  const armandoRow = staff.body.find((s) => s.fullName === 'Armando Cossa');
  ok(
    ['free', 'on_job'].includes(armandoRow?.state ?? '') && (armandoRow?.jobsDone ?? 0) >= 1,
    `The technical manager sees Armando on duty (${armandoRow?.state}), with ${armandoRow?.jobsDone} jobs done today`
  );
  await call(armando, 'POST', '/me/duty', { onDuty: false });

  console.log('\nNetwork and field checks passed.');
}

async function offlineAndPush(t: { cc: string; helena: string }): Promise<void> {
  const { cc, helena } = t;
  // Armando was blocked and unblocked above, which ended his sessions: sign in again.
  const armando = await userToken('armando.cossa');
  const token = `ExponentPushToken[e2e-${Date.now()}]`;
  const registered = await call(armando, 'POST', '/me/devices', { token, platform: 'android' });
  ok(registered.status === 204, 'The app registers Armando’s phone for push notifications');

  const ref = `CC-E2E3-${Date.now()}`;
  const created = await call<{ ticketId: string }>(cc, 'POST', '/intake/call-center/complaints', {
    externalRef: ref,
    contractNo: '40217735',
    problemType: 'prepaid_meter',
    description: 'Meter shows an error'
  });
  const id = created.body.ticketId;
  const armandoId = (await call<{ id: string }>(armando, 'GET', '/me')).body.id;
  await call(helena, 'POST', `/tickets/${id}/assign`, { assigneeId: armandoId });

  // The app sends "accept", the answer is lost on a bad connection, and the queue sends it again.
  await call(armando, 'POST', `/tickets/${id}/accept`);
  const replay = await call<{ code: string }>(armando, 'POST', `/tickets/${id}/accept`);
  const now = await call<TicketDetail>(armando, 'GET', `/tickets/${id}`);
  ok(
    replay.status === 409 && now.body.status === 'accepted' && now.body.assignee?.id === armandoId,
    'A repeated "accept" is refused, and the ticket shows it already went through (the app drops it)'
  );

  const pressedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  const started = await call<TicketDetail>(armando, 'POST', `/tickets/${id}/start`, undefined, {
    [OCCURRED_AT_HEADER]: pressedAt
  });
  const start = started.body.events.find((e) => e.type === 'start');
  ok(
    start?.data.occurredAt === pressedAt,
    'Work started offline 20 minutes ago is recorded with its real time'
  );

  await call(cc, 'POST', `/intake/call-center/tickets/${ref}/cancel`, { reason: 'Test finished' });
  const removed = await call(armando, 'POST', '/me/devices/remove', { token });
  ok(removed.status === 204, 'Signing out of the app stops push notifications to that phone');

  console.log('\nOffline and push checks passed.');
}

async function phase2(t: { cc: string; helena: string; armando: string; admin: string }): Promise<void> {
  const { cc, helena, armando, admin } = t;
  const ref = `CC-E2E2-${Date.now()}`;

  const duty = await call<{ onDuty: boolean }>(armando, 'POST', '/me/duty', { onDuty: true });
  ok(duty.body.onDuty, 'Armando switches on duty in the app');

  const created = await call<{ ticketId: string; code: string; status: string; assigneeName: string }>(
    cc,
    'POST',
    '/intake/call-center/complaints',
    {
      externalRef: ref,
      contractNo: '40217735',
      problemType: 'prepaid_meter',
      description: 'Meter rejects the credit code'
    }
  );
  ok(
    created.body.status === 'assigned' && created.body.assigneeName === 'Armando Cossa',
    `New ticket ${created.body.code} goes to Armando automatically`
  );
  const id = created.body.ticketId;

  const declined = await call<{ status: string }>(armando, 'POST', `/tickets/${id}/decline`, {
    reason: 'Out of fuel'
  });
  ok(declined.body.status === 'new', 'Armando declines; nobody else is on duty, so it waits for Helena');

  await call(helena, 'POST', `/tickets/${id}/assign`, {
    assigneeId: (await call<{ id: string }>(armando, 'GET', '/me')).body.id
  });
  await call(armando, 'POST', `/tickets/${id}/accept`);
  await call(armando, 'POST', `/tickets/${id}/start`);
  const held = await call<TicketDetail>(armando, 'POST', `/tickets/${id}/hold`, {
    reason: 'Waiting for a fuse'
  });
  ok(held.body.status === 'on_hold', 'Helena assigns it back; Armando starts, then pauses with a reason');
  const resumed = await call<TicketDetail>(armando, 'POST', `/tickets/${id}/resume`);
  ok(resumed.body.status === 'in_progress', 'Armando resumes work');

  const cancelled = await call<{ status: string }>(cc, 'POST', `/intake/call-center/tickets/${ref}/cancel`, {
    reason: 'Customer called: it was a fault inside the house'
  });
  ok(cancelled.body.status === 'cancelled', 'Call Center cancels the ticket');
  await call(armando, 'POST', '/me/duty', { onDuty: false });

  // Accounts, through the real Keycloak.
  const teams = await call<TeamView[]>(admin, 'GET', '/admin/teams');
  const south1 = teams.body.find((x) => x.code === 'SOUTH_1')!;
  const username = `e2e.${Date.now()}`;
  const made = await call<{ user: AdminUser; temporaryPassword: string }>(admin, 'POST', '/admin/users', {
    username,
    fullName: 'Teste Automático',
    roles: ['field_staff'],
    teamId: south1.id
  });
  ok(made.status === 201 && made.body.temporaryPassword, `Admin creates account ${username}`);
  const firstSignIn = await signInError(username, made.body.temporaryPassword);
  ok(firstSignIn?.includes('not fully set up'), 'The temporary password works but must be changed first');

  const armandoId = (await call<{ id: string }>(armando, 'GET', '/me')).body.id;
  const blocked = await call<AdminUser>(admin, 'POST', `/admin/users/${armandoId}/block`);
  ok(blocked.body.status === 'blocked', 'Admin blocks Armando');
  const stillValidToken = await call<{ code: string }>(armando, 'GET', '/me');
  ok(stillValidToken.body.code === 'ACCOUNT_DISABLED', 'Armando’s existing session is refused at once');
  ok((await signInError('armando.cossa'))?.includes('disabled'), 'Armando cannot sign in again');

  await call(admin, 'POST', `/admin/users/${armandoId}/unblock`);
  const back = await call<{ username: string }>(await userToken('armando.cossa'), 'GET', '/me');
  ok(back.body.username === 'armando.cossa', 'Admin unblocks Armando; he can sign in again');

  const removed = await call<AdminUser>(admin, 'POST', `/admin/users/${made.body.user.id}/cancel`);
  ok(removed.body.status === 'cancelled', 'Admin cancels the test account');

  console.log('\nPhase 2 checks passed.');
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
