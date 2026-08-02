#!/bin/bash
# P0-1: Server Watchdog — monitors API server health and auto-restarts on crash.
# Runs in background, checks every 15s, restarts if API is unresponsive.
# Also monitors memory and restarts API server if it's consuming too much.

WATCHDOG_PID_FILE="/tmp/pdb-watchdog.pid"
HEALTH_CHECK_URL="http://localhost:3001/api/db-config"
MAX_API_RSS_MB=800  # Restart API server if RSS exceeds this
RESTART_COOLDOWN=30 # Seconds between restart attempts
LOG_FILE="/home/z/my-project/dev.log"

# Prevent duplicate watchdog instances
if [ -f "$WATCHDOG_PID_FILE" ] && kill -0 "$(cat $WATCHDOG_PID_FILE)" 2>/dev/null; then
  echo "[$(date)] Watchdog already running (PID $(cat $WATCHDOG_PID_FILE)), exiting."
  exit 0
fi
echo $$ > "$WATCHDOG_PID_FILE"
trap "rm -f $WATCHDOG_PID_FILE; exit 0" SIGTERM SIGINT

LAST_RESTART=0

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [watchdog] $1" >> "$LOG_FILE"
}

restart_api_server() {
  local now=$(date +%s)
  local elapsed=$((now - LAST_RESTART))
  if [ "$elapsed" -lt "$RESTART_COOLDOWN" ]; then
    log "Restart cooldown ($((RESTART_COOLDOWN - elapsed))s remaining), skipping"
    return
  fi
  LAST_RESTART=$now

  log "API server unresponsive, restarting..."

  # Kill existing API server processes
  pkill -f 'node.*api-server' 2>/dev/null
  sleep 2

  # Check if standalone directory exists
  if [ ! -f /home/z/my-project/.next/standalone/api-server.js ]; then
    log "Standalone missing, rebuilding..."
    cd /home/z/my-project
    NODE_OPTIONS="--max-old-space-size=3072" bun run build >> "$LOG_FILE" 2>&1
    cp -r .next/static .next/standalone/.next/static 2>/dev/null
  fi

  # Ensure DB exists
  if [ ! -s /home/z/my-project/db/pdb-tracker.db ]; then
    log "DB missing, restoring from custom.db..."
    cp /home/z/my-project/db/custom.db /home/z/my-project/db/pdb-tracker.db 2>/dev/null
    cd /home/z/my-project
    DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" node scripts/seed-batch-data.mjs >> "$LOG_FILE" 2>&1
  fi

  # Copy server scripts
  cp -f /home/z/my-project/server-scripts/custom-server.js /home/z/my-project/.next/standalone/custom-server.js 2>/dev/null
  cp -f /home/z/my-project/server-scripts/api-server.js /home/z/my-project/.next/standalone/api-server.js 2>/dev/null

  # Ensure DB config
  mkdir -p /home/z/my-project/.next/standalone/.hermes /home/z/my-project/.next/standalone/db /home/z/my-project/.next/standalone/prisma
  cp /home/z/my-project/.hermes/db-config.json /home/z/my-project/.next/standalone/.hermes/db-config.json 2>/dev/null
  cp /home/z/my-project/db/pdb-tracker.db /home/z/my-project/.next/standalone/db/pdb-tracker.db 2>/dev/null
  cp /home/z/my-project/prisma/schema.prisma /home/z/my-project/.next/standalone/prisma/schema.prisma 2>/dev/null
  echo 'DATABASE_URL=file:/home/z/my-project/db/pdb-tracker.db' > /home/z/my-project/.next/standalone/.env

  # Start API server
  cd /home/z/my-project/.next/standalone
  nohup env NODE_ENV=production PORT=3001 \
    DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" \
    node --expose-gc --max-old-space-size=384 api-server.js >> "$LOG_FILE" 2>&1 &
  disown
  log "API server restarted (PID $!)"

  # Also restart static server if it's down
  if ! pgrep -f 'node.*custom-server' > /dev/null 2>&1; then
    log "Static server also down, restarting..."
    nohup bash -c 'cd /home/z/my-project/.next/standalone && exec node --max-old-space-size=128 custom-server.js' >> "$LOG_FILE" 2>&1 &
    disown
    log "Static server restarted (PID $!)"
  fi

  sleep 5
  log "Restart complete, verifying..."
}

check_memory() {
  # Find the API server worker process (not the cluster master)
  local api_pid=$(pgrep -f 'node.*api-server' | tail -1)
  if [ -z "$api_pid" ]; then
    return 1  # No process, will be caught by health check
  fi
  local rss=$(ps -p "$api_pid" -o rss= 2>/dev/null | tr -d ' ')
  if [ -n "$rss" ]; then
    local rss_mb=$((rss / 1024))
    if [ "$rss_mb" -gt "$MAX_API_RSS_MB" ]; then
      log "API server RSS ${rss_mb}MB > ${MAX_API_RSS_MB}MB limit, restarting"
      restart_api_server
    fi
  fi
}

check_health() {
  # Try health check with 5s timeout
  local http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_CHECK_URL" 2>/dev/null)
  if [ "$http_code" != "200" ]; then
    log "Health check failed (HTTP $http_code), API server may be down"
    return 1
  fi
  return 0
}

log "Watchdog started (PID $$), checking every 15s"

while true; do
  if ! check_health; then
    restart_api_server
  else
    check_memory
  fi
  sleep 15
done
