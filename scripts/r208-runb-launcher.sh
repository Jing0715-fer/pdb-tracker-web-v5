#!/bin/bash
# R208: zai 配额窗口恢复后自动发射 abundant 档验证运行（run B）。
# 与 run A（sparse：maxPdb=3/skipBlast/maxLit=2）同蛋白同问题对照 ——
# 放开数据上限 → 预期评级 8/8 数据海量 · 深挖章 3-8 · 字数 ×1.3 · 更长报告。
# 发射判定：start 端点 200 JSON 含 runId（配额预检通过 = 配额恢复）。
# 发射后 curl 断开（R195 语义：客户端断开不终止运行），runId 落盘供监控。
LOG=/tmp/r208-runb-launcher.log
BODY='{"uniprot":"P69905","question":"血红蛋白如何结合氧气并实现变构调节？","maxPdb":80,"maxBlastHits":50,"maxLitCount":20}'
echo "$(date +%H:%M) r208 runB launcher start" >> "$LOG"
for i in $(seq 1 60); do
  RESP=$(curl -s -X POST http://localhost:3000/api/evaluations/run-dsh/start \
    -H 'Content-Type: application/json' -d "$BODY" --max-time 60 2>/dev/null)
  RUNID=$(echo "$RESP" | rg -o '"runId":"dsh-[a-zA-Z0-9-]+"' | head -1 | rg -o 'dsh-[a-zA-Z0-9-]+')
  if [ -n "$RUNID" ]; then
    echo "$(date +%H:%M) LAUNCHED $RUNID (attempt $i)" >> "$LOG"
    echo "$RUNID" > /tmp/r208-runb-runid.txt
    exit 0
  fi
  echo "$(date +%H:%M) blocked (attempt $i): $(echo "$RESP" | head -c 120)" >> "$LOG"
  sleep 600
done
echo "$(date +%H:%M) gave up after 60 attempts" >> "$LOG"
