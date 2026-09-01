#!/bin/bash
# R206: zai 配额窗口恢复后自动发射 Commons 验证运行（run #2）。
# 服务器进程已带 PDB_FIGURES_FORCE_COMMONS=1（重启注入）。
# 发射判定：POST 响应头出现 x-run-id（预启动 LLM 探测通过 = 配额恢复）。
# 发射后 curl 断开（R195 语义：客户端断开不终止运行），runId 落盘供监控。
LOG=/tmp/commons-run2-launcher.log
BODY='{"uniprot":"P69905","question":"该蛋白作为小分子药物靶点的成药性如何？现有结构覆盖哪些状态？"}'
echo "$(date +%H:%M) launcher start" >> "$LOG"
for i in $(seq 1 60); do
  HDRS=$(mktemp)
  curl -sN -D "$HDRS" -X POST http://localhost:3000/api/evaluations/run-dsh \
    -H 'Content-Type: application/json' -d "$BODY" --max-time 15 2>/dev/null >/dev/null
  RUNID=$(rg -i -o "dsh-[a-zA-Z0-9-]+" "$HDRS" 2>/dev/null | head -1)
  rm -f "$HDRS"
  if [ -n "$RUNID" ]; then
    echo "$(date +%H:%M) LAUNCHED $RUNID (attempt $i)" >> "$LOG"
    echo "$RUNID" > /tmp/commons-run2-runid.txt
    exit 0
  fi
  echo "$(date +%H:%M) blocked (attempt $i)" >> "$LOG"
  sleep 600
done
echo "$(date +%H:%M) gave up after 60 attempts" >> "$LOG"
