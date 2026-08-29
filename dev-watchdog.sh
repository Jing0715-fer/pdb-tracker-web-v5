#!/bin/bash
# Robust dev server watchdog: continuously polls HTTP health and restarts
# `next dev` whenever it dies (OOM during heavy compile in 4GB sandbox).
# Runs forever; restarts up to MAX_RESTARTS times within a sliding window.

cd /home/z/my-project
export MALLOC_ARENA_MAX=2
export NODE_OPTIONS="--max-old-space-size=2560"

MAX_RESTARTS=40
restart_count=0
pid=0

start_server() {
  rm -f dev.log
  ./node_modules/.bin/next dev --webpack -p 3000 > dev.log 2>&1 &
  pid=$!
  echo "[watchdog] started pid=$pid (restart #$restart_count)"
}

is_alive() {
  kill -0 "$pid" 2>/dev/null
}

is_healthy() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/ 2>/dev/null)
  [ "$code" = "200" ]
}

# Wait for server to become healthy (up to 150s), polling every 3s.
wait_healthy() {
  for i in $(seq 1 50); do
    if ! is_alive; then
      echo "[watchdog] process died during startup"
      return 1
    fi
    if is_healthy; then
      echo "[watchdog] healthy after ${i} polls"
      return 0
    fi
    sleep 3
  done
  echo "[watchdog] never became healthy"
  return 1
}

start_server
wait_healthy

# Continuous monitor loop.
while true; do
  sleep 5
  if ! is_alive; then
    echo "[watchdog] process $pid exited — restarting"
    restart_count=$((restart_count + 1))
    if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
      echo "[watchdog] hit MAX_RESTARTS=$MAX_RESTARTS — giving up"
      exit 1
    fi
    start_server
    wait_healthy
  fi
done
