#!/bin/bash
# R161: Persistent dev server restart loop for the 4GB sandbox.
# next dev occasionally OOMs during heavy webpack compilation; this loop
# restarts it automatically and keeps dev.log fresh.
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=3072"
export NEXT_TELEMETRY_DISABLED=1

echo "[restart-loop] started at $(date)" >> /home/z/my-project/watchdog.out

while true; do
  rm -f /home/z/my-project/dev.log
  /home/z/my-project/node_modules/.bin/next dev --webpack -p 3000 > /home/z/my-project/dev.log 2>&1
  code=$?
  echo "[restart-loop] next dev exited (code=$code) at $(date) — restarting in 3s" >> /home/z/my-project/watchdog.out
  sleep 3
done
