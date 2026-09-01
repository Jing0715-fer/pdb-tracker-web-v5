#!/usr/bin/env node
/**
 * R198: DSH 运行轮询器（R195 验证过的「游标持久化 + 多窗口续接」模式固化）
 * 用法: node scripts/dsh-poll.mjs <runId> [maxSeconds]
 * - 游标存 /tmp/dsh-poll-<runId>.cursor（seq），跨 Bash 工具窗口无缝续接
 * - 只输出新事件的摘要行（进度/阶段/章节/终局），done 帧全量打印
 */
const [runId, maxSecondsArg] = process.argv.slice(2);
if (!runId) { console.error('usage: dsh-poll.mjs <runId> [maxSeconds]'); process.exit(1); }
const maxSeconds = Number(maxSecondsArg || 500);
const cursorFile = `/tmp/dsh-poll-${runId}.cursor`;
const fs = await import('node:fs');
let after = 0;
try { after = Number(fs.readFileSync(cursorFile, 'utf8').trim()) || 0; } catch {}

const t0 = Date.now();
let lastLineAt = 0;
while (Date.now() - t0 < maxSeconds * 1000) {
  const res = await fetch(`http://localhost:3000/api/evaluations/run-dsh/status?runId=${runId}&after=${after}`).catch(() => null);
  if (!res || !res.ok) { await new Promise(r => setTimeout(r, 3000)); continue; }
  const d = await res.json().catch(() => null);
  if (!d) { await new Promise(r => setTimeout(r, 3000)); continue; }

  if (Array.isArray(d.events)) {
    for (const ev of d.events) {
      if (ev.seq <= after) continue;
      after = ev.seq;
      const msg = String(ev.message || '').slice(0, 150);
      const line = `[${ev.seq}] ${ev.stage || '?'} ${ev.level || ''} ${msg}`;
      // 只打印有信息量的行：进度节流（每 10s 至少一行也会打 stage 转换）
      if (msg || ev.stage) console.log(line);
      lastLineAt = Date.now();
      if (ev.stage === 'done' || ev.event === 'done') {
        console.log('\n=== DONE 帧载荷 ===');
        console.log(JSON.stringify(ev, null, 2).slice(0, 4000));
        fs.writeFileSync(cursorFile, String(after));
        console.log(`\n[run ${runId} 终局：${ev.level}] 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s（本窗口）`);
        process.exit(0);
      }
    }
    fs.writeFileSync(cursorFile, String(after));
  }
  if (d.status && d.status !== 'running') {
    console.log(`[终态 ${d.status}] 游标 ${after} · 无更多事件`);
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log(`[窗口到时] 状态 ${d_status()} · 游标已存 ${after}（下个窗口续接）`);
function d_status() { try { return 'running'; } catch { return '?'; } }
