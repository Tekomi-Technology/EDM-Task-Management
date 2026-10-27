import { parseArgs } from 'node:util';
import { PROBLEM_TYPE_KEYS } from '@edm/shared';
import { call, callCenterToken } from './client.js';

const HELP = `Call Center simulator: behaves like the Call Center system calling the EDM Tasks API.

  pnpm sim complaint --contract 40217735 --problem no_power_single --text "No power since 07:15" [--ref CC-123]
  pnpm sim status <ref>
  pnpm sim check <ref> fixed|not_fixed [--note "Customer confirms"]

Problem types: ${PROBLEM_TYPE_KEYS.join(', ')}
Sample contracts: 40217735 (Matola), 40188210 (Maputo Central), 40999999 (outside the pilot areas)`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      contract: { type: 'string' },
      problem: { type: 'string', default: 'no_power_single' },
      text: { type: 'string' },
      ref: { type: 'string' },
      note: { type: 'string' }
    }
  });
  const [command, ...rest] = positionals;
  const token = await callCenterToken();

  if (command === 'complaint') {
    if (!values.contract || !values.text) throw new Error('--contract and --text are required');
    const res = await call(token, 'POST', '/intake/call-center/complaints', {
      externalRef: values.ref ?? `CC-${Date.now()}`,
      contractNo: values.contract,
      problemType: values.problem,
      description: values.text
    });
    console.log(res.status, JSON.stringify(res.body, null, 2));
  } else if (command === 'status' && rest[0]) {
    const res = await call(token, 'GET', `/intake/call-center/tickets/${encodeURIComponent(rest[0])}`);
    console.log(res.status, JSON.stringify(res.body, null, 2));
  } else if (command === 'check' && rest[0] && (rest[1] === 'fixed' || rest[1] === 'not_fixed')) {
    const res = await call(
      token,
      'POST',
      `/intake/call-center/tickets/${encodeURIComponent(rest[0])}/check-result`,
      {
        result: rest[1],
        note: values.note
      }
    );
    console.log(res.status, JSON.stringify(res.body, null, 2));
  } else {
    console.log(HELP);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
