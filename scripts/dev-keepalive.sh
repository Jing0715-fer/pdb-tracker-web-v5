#!/bin/bash
# Dev server auto-restart wrapper — keeps `bun run dev` alive if it crashes
# (OOM, unhandled exception, etc.). Restarts up to 10 times with a 5s cooldown.
# Used to avoid "page frequently refreshes" caused by server crashes during eval.

LOG_FILE="/home/z/my-project/dev.log"
MAX_RESTARTS=10
COOLDOWN=5
COUNT=0

cd /home/z/my-project

while [ $COUNT -lt $MAX_RESTARTS ]; do
  COUNT=$((COUNT + 1))
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [dev-keepalive] Starting dev server (attempt $COUNT/$MAX_RESTARTS)" >> "$LOG_FILE"

  # Run dev server in foreground; when it exits, the loop continues.
  # stdout/stderr go to dev.log via the dev script's `tee`.
  bun run dev >/dev/null 2>&1
  EXIT_CODE=$?

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [dev-keepalive] Dev server exited (code $EXIT_CODE), restarting in ${COOLDOWN}s..." >> "$LOG_FILE"
  sleep $COOLDOWN
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [dev-keepalive] Max restarts ($MAX_RESTARTS) reached, giving up." >> "$LOG_FILE"
