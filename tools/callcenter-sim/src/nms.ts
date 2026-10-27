/**
 * Pretend network management system (NMS): sends alarm events to the API, as the real NMS will.
 *
 *   pnpm nms scenario feeder-trip     4 alarms of one fault (grouped into one incident) + 1 unrelated alarm
 *   pnpm nms raise <element> "<alarm type>" [critical|major|minor|warning] [--parent X] [--lat -25.93 --lng 32.47]
 *   pnpm nms clear <alarmId>
 *   pnpm nms clear-scenario           clears every alarm of the last feeder-trip scenario
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { call, nmsToken } from './client.js';

const STATE = fileURLToPath(new URL('../.nms-last-scenario.json', import.meta.url));

interface AlarmEvent {
  alarmId: string;
  event: 'raise' | 'clear';
  elementCode: string;
  elementName?: string;
  parentElementCode?: string;
  correlationId?: string;
  alarmType: string;
  severity: 'critical' | 'major' | 'minor' | 'warning';
  occurredAt: string;
  location?: { lat: number; lng: number };
  customersAffected?: number;
  details?: string;
}

async function send(alarms: AlarmEvent[]): Promise<void> {
  const res = await call<{ results: { alarmId: string; result: string; code: string | null }[] }>(
    await nmsToken(),
    'POST',
    '/intake/nms/alarms',
    { alarms }
  );
  if (res.status !== 200) {
    console.error(`API answered ${res.status}:`, JSON.stringify(res.body));
    process.exit(1);
  }
  for (const r of res.body.results)
    console.log(`${r.alarmId.padEnd(24)} ${r.result.padEnd(8)} ${r.code ?? ''}`);
}

const now = () => new Date().toISOString();
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const stamp = Date.now().toString(36);

  if (command === 'scenario' && args[0] === 'feeder-trip') {
    // Feeder F-12 trips in Matola: the breaker, a relay and two ring main units downstream all raise alarms.
    const where = { lat: -25.935, lng: 32.468 };
    const alarms: AlarmEvent[] = [
      {
        alarmId: `CB-F12-${stamp}`,
        event: 'raise',
        elementCode: 'F-12',
        elementName: 'Feeder F-12 (SE Machava)',
        correlationId: `F12-${stamp}`,
        alarmType: 'Breaker trip, overcurrent',
        severity: 'critical',
        occurredAt: now(),
        location: where,
        customersAffected: 1900,
        details: 'CB-F12 opened on overcurrent at SE Machava.'
      },
      {
        alarmId: `R12A-${stamp}`,
        event: 'raise',
        elementCode: 'R-12A',
        correlationId: `F12-${stamp}`,
        alarmType: 'Earth fault detected',
        severity: 'major',
        occurredAt: now(),
        location: where
      },
      {
        alarmId: `RMU207-${stamp}`,
        event: 'raise',
        elementCode: 'RMU-207',
        parentElementCode: 'F-12',
        alarmType: 'Voltage loss downstream',
        severity: 'major',
        occurredAt: now(),
        location: { lat: -25.93, lng: 32.474 }
      },
      {
        alarmId: `RMU211-${stamp}`,
        event: 'raise',
        elementCode: 'RMU-211',
        parentElementCode: 'F-12',
        alarmType: 'Voltage loss downstream',
        severity: 'major',
        occurredAt: now(),
        location: { lat: -25.94, lng: 32.462 }
      },
      {
        alarmId: `SE-COMMS-${stamp}`,
        event: 'raise',
        elementCode: 'SE-MATOLA-3',
        elementName: 'Substation SE Matola 3',
        alarmType: 'Communication lost',
        severity: 'minor',
        occurredAt: now(),
        location: { lat: -25.97, lng: 32.45 }
      }
    ];
    await send(alarms);
    writeFileSync(STATE, JSON.stringify(alarms));
    console.log(
      '\nThe first four are one fault (one incident); the communication alarm is a separate incident.'
    );
    return;
  }
  if (command === 'clear-scenario') {
    if (!existsSync(STATE)) throw new Error('Run "pnpm nms scenario feeder-trip" first.');
    const alarms = JSON.parse(readFileSync(STATE, 'utf8')) as AlarmEvent[];
    await send(alarms.map((a) => ({ ...a, event: 'clear', occurredAt: now() })));
    return;
  }
  if (command === 'raise' && args[0] && args[1]) {
    const lat = flag('lat');
    const lng = flag('lng');
    await send([
      {
        alarmId: `${args[0]}-${stamp}`,
        event: 'raise',
        elementCode: args[0],
        alarmType: args[1],
        severity: (args[2] as AlarmEvent['severity'] | undefined) ?? 'major',
        parentElementCode: flag('parent'),
        occurredAt: now(),
        location: lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined
      }
    ]);
    return;
  }
  if (command === 'clear' && args[0]) {
    await send([
      {
        alarmId: args[0],
        event: 'clear',
        elementCode: '-',
        alarmType: '-',
        severity: 'minor',
        occurredAt: now()
      }
    ]);
    return;
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
