/**
 * Fills the development system with tickets in every state, so the screens have something to show.
 * Run with `pnpm --filter @edm/callcenter-sim demo-data` while the stack and the API are running.
 */
import { call, callCenterToken, userToken } from './client.js';

const complaints = [
  {
    contractNo: '40217735',
    problemType: 'no_power_single',
    description: 'Whole house without power since 07:15.'
  },
  {
    contractNo: '40188210',
    problemType: 'prepaid_meter',
    description: 'Bought credit but the meter does not accept the code.'
  },
  {
    contractNo: '40217735',
    problemType: 'cable_down',
    description: 'Cable hanging low over the road near the school.'
  },
  { contractNo: '40188210', problemType: 'low_voltage', description: 'Lights flicker every evening.' },
  { contractNo: '40217735', problemType: 'no_power_street', description: 'The whole street is dark.' },
  { contractNo: '40999999', problemType: 'other', description: 'Sparks from the meter box.' }
];

async function main(): Promise<void> {
  const [cc, helena, joao, armando, ana, ofelia] = await Promise.all([
    callCenterToken(),
    userToken('helena.mondlane'),
    userToken('joao.matsinhe'),
    userToken('armando.cossa'),
    userToken('ana.sitoe'),
    userToken('ofelia.tembe')
  ]);
  // Assign by hand so each ticket ends up in a chosen state.
  for (const staff of [armando, ana, ofelia]) await call(staff, 'POST', '/me/duty', { onDuty: false });
  const ids: string[] = [];
  for (const [i, c] of complaints.entries()) {
    const res = await call<{ ticketId: string; code: string }>(cc, 'POST', '/intake/call-center/complaints', {
      externalRef: `DEMO-${Date.now()}-${i}`,
      ...c
    });
    ids.push(res.body.ticketId);
    console.log(`created ${res.body.code}`);
  }
  const id = (n: number) => ids[n]!;
  const me = async (token: string) => (await call<{ id: string }>(token, 'GET', '/me')).body.id;
  const [armandoId, anaId, ofeliaId] = [await me(armando), await me(ana), await me(ofelia)];

  // 0: being fixed by Armando, with a note from the office.
  await call(helena, 'POST', `/tickets/${id(0)}/assign`, { assigneeId: armandoId });
  await call(armando, 'POST', `/tickets/${id(0)}/accept`);
  await call(armando, 'POST', `/tickets/${id(0)}/start`);
  await call(helena, 'POST', `/tickets/${id(0)}/notes`, {
    text: 'Customer called again, she is at home until 12:00.',
    notifyAssignee: true
  });
  // 1: done by Ofélia, waiting for the Call Center check.
  await call(joao, 'POST', `/tickets/${id(1)}/assign`, { assigneeId: ofeliaId });
  await call(ofelia, 'POST', `/tickets/${id(1)}/accept`);
  await call(ofelia, 'POST', `/tickets/${id(1)}/start`);
  await call(ofelia, 'POST', `/tickets/${id(1)}/resolve`, {
    note: 'Meter keypad was locked. Reset the meter and entered the code with the customer.'
  });
  // 2: assigned to Ana, not accepted yet. 3 and 4: nobody yet. 5: outside every area.
  await call(helena, 'POST', `/tickets/${id(2)}/assign`, { assigneeId: anaId });
  for (const staff of [armando, ana, ofelia]) await call(staff, 'POST', '/me/duty', { onDuty: true });
  // Where they are, for the live map and distance-based assignment.
  const at = (lat: number, lng: number) => ({
    points: [{ lat, lng, accuracy: 12, recordedAt: new Date().toISOString() }]
  });
  await call(armando, 'POST', '/me/locations', at(-25.928, 32.462));
  await call(ana, 'POST', '/me/locations', at(-25.952, 32.49));
  await call(ofelia, 'POST', '/me/locations', at(-25.958, 32.58));
  console.log('Demo data ready.');
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
