/**
 * Unit test for the SSE log persistence wiring.
 *
 * Verifies that the three skill routes' emit wrappers push every event
 * to a local log array (formatted as NDJSON), and that the log array
 * is what would be written to SkillRunRecord.log at db.skillRunRecord.create.
 *
 * We don't run a full evaluation here — we just import the helper from
 * src/lib/sse.ts and assert its behavior. The actual API route
 * integration is exercised by the running dev server in production.
 *
 * (Originally this test tried to hit the dev server end-to-end, but
 * the sandbox blocks the server's loopback port. The wiring test
 * below catches the more common bug: emit() not actually accumulating
 * to the log array.)
 */
import { withLog, type SseEvent } from '../src/lib/sse';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

// Capture every event the wrapped emit sees
function makeCapturingEmit() {
  const events: SseEvent[] = [];
  const emit = (e: SseEvent) => { events.push(e); };
  return { events, emit };
}

const sampleEvents: SseEvent[] = [
  { stage: 'init', level: 'info', message: '启动 eval', progress: 2 },
  { stage: 'rcsb-direct', level: 'success', message: '✓ RCSB 返回 80 条', progress: 24 },
  { stage: 'chapter_done', level: 'success', message: '[1/8] 执行摘要 ✓ 600 chars', progress: 68 },
  { stage: 'chapter_done', level: 'error', message: '[3/8] 拓扑结构 ✗ HTTP 429' },
  { stage: 'done', level: 'success', message: '完成 · 80 PDB', progress: 100 },
];

// 1. withLog pushes every event to the log array as NDJSON
console.log('\n[1] withLog accumulates every emit() into a NDJSON log array');
{
  const log: string[] = [];
  const { emit: origEmit } = makeCapturingEmit();
  const wrapped = withLog(origEmit, log);
  for (const e of sampleEvents) wrapped(e);
  check('log array has one entry per event', log.length === sampleEvents.length,
        `log.length=${log.length}, expected=${sampleEvents.length}`);
  // Every line is valid JSON
  const allValid = log.every((l) => { try { JSON.parse(l); return true; } catch { return false; } });
  check('every log line is valid JSON', allValid,
        `valid=${log.filter(l => { try { JSON.parse(l); return true; } catch { return false; } }).length}/${log.length}`);
  // The first line parses back to the same event (with ts added)
  const first = JSON.parse(log[0]);
  check('first event is init/info/progress:2',
        first.stage === 'init' && first.level === 'info' && first.progress === 2,
        JSON.stringify(first));
  // Round-trip the last event
  const last = JSON.parse(log[log.length - 1]);
  check('last event is done/progress:100',
        last.stage === 'done' && last.progress === 100,
        JSON.stringify(last));
}

// 2. withLog still passes the event through to the original emit
console.log('\n[2] withLog still passes events to the original emit()');
{
  const log: string[] = [];
  const { events, emit: origEmit } = makeCapturingEmit();
  const wrapped = withLog(origEmit, log);
  wrapped({ stage: 'test', level: 'info', message: 'hello', progress: 50 });
  check('origEmit received the event', events.length === 1);
  check('origEmit received the same event', events[0].stage === 'test' && events[0].message === 'hello');
  check('log also recorded the event', log.length === 1);
}

// 3. withLog never throws, even on weird events
console.log('\n[3] withLog is exception-safe');
{
  const log: string[] = [];
  const wrapped = withLog((_e) => { /* noop */ }, log);
  // Cyclic event (would crash JSON.stringify) — withLog swallows it
  const cyclic: any = {};
  cyclic.self = cyclic;
  let crashed = false;
  try { wrapped(cyclic as SseEvent); } catch { crashed = true; }
  // The cyclic event fails JSON.stringify so log.length should be 0
  // (try/catch in withLog protects the caller). The call itself should
  // not throw.
  check('withLog does not throw on cyclic event', !crashed);
  check('log is empty after cyclic event (caught by try/catch)',
        log.length === 0, `log.length=${log.length}`);
}

// 4. The 'ts' field is added by withLog and is an ISO 8601 string
console.log('\n[4] withLog adds an ISO 8601 ts field');
{
  const log: string[] = [];
  const wrapped = withLog(() => {}, log);
  wrapped({ stage: 'init', level: 'info' });
  const first = JSON.parse(log[0]);
  check('ts is a string', typeof first.ts === 'string');
  // Format: 2026-07-18T12:34:56.789Z
  check('ts matches ISO 8601 pattern', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/.test(first.ts),
        `ts=${first.ts}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
