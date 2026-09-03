#!/bin/bash
# R211 E2E: 基础评估模式（无科学问题）—— 验证 web 配图回退查询集触发 web 图源。
# sparse 收上限（maxPdb=3/skipBlast/maxLit=2）控时长；关键观测点：
# ① SSE 出现「web 配图：基础评估口径…标准回退查询」公告
# ② 出现 z-ai image-search 搜索事件（沙箱图源；本地部署为 MiniMax web_search）
# ③ 报告落库 web 图 > 0。
LOG=/tmp/r211-e2e-launcher.log
BODY='{"uniprot":"P69905","question":"","maxPdb":3,"skipBlast":true,"maxLitCount":2}'
echo "$(date +%H:%M) r211 e2e launcher start" >> "$LOG"
for i in $(seq 1 12); do
  RESP=$(curl -s -X POST http://localhost:3000/api/evaluations/run-dsh/start \
    -H 'Content-Type: application/json' -d "$BODY" --max-time 60 2>/dev/null)
  RUNID=$(echo "$RESP" | rg -o '"runId":"dsh-[a-zA-Z0-9-]+"' | head -1 | rg -o 'dsh-[a-zA-Z0-9-]+')
  if [ -n "$RUNID" ]; then
    echo "$(date +%H:%M) LAUNCHED $RUNID (attempt $i)" >> "$LOG"
    echo "$RUNID" > /tmp/r211-e2e-runid.txt
    exit 0
  fi
  echo "$(date +%H:%M) blocked (attempt $i): $(echo "$RESP" | head -c 120)" >> "$LOG"
  sleep 300
done
echo "$(date +%H:%M) gave up" >> "$LOG"
