#!/bin/bash
# Start the PDB Tracker standalone production server + watchdog.
# The watchdog monitors API health and auto-restarts on crash.

cd /home/z/my-project/.next/standalone

# Ensure custom server scripts are present
cp -f /home/z/my-project/server-scripts/custom-server.js ./custom-server.js 2>/dev/null
cp -f /home/z/my-project/server-scripts/api-server.js ./api-server.js 2>/dev/null
cat > ./server-wrap.js << 'WRAPPER'
process.on('uncaughtException', (err) => { console.error('[FATAL] uncaughtException:', err); });
process.on('unhandledRejection', (err) => { console.error('[FATAL] unhandledRejection:', err); });
process.on('SIGTERM', () => { console.error('[FATAL] SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.error('[FATAL] SIGINT'); process.exit(0); });
require('./server.js');
WRAPPER

# ── Ensure DB is set up ────────────────────────────────────────────────────
mkdir -p .hermes db prisma
if [ -f /home/z/my-project/.hermes/db-config.json ]; then
  cp /home/z/my-project/.hermes/db-config.json .hermes/db-config.json
else
  cat > .hermes/db-config.json << 'CFG'
{
  "dbPath": "file:/home/z/my-project/db/pdb-tracker.db",
  "confirmed": true,
  "updatedAt": "2026-07-15T00:00:00.000Z"
}
CFG
fi

# Restore DB if missing
MAIN_DB="/home/z/my-project/db/pdb-tracker.db"
CUSTOM_DB="/home/z/my-project/db/custom.db"
STANDALONE_DB="./db/pdb-tracker.db"

if [ ! -f "$MAIN_DB" ] || [ ! -s "$MAIN_DB" ]; then
  if [ -f "$CUSTOM_DB" ] && [ -s "$CUSTOM_DB" ]; then
    cp "$CUSTOM_DB" "$MAIN_DB"
    cd /home/z/my-project
    DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" node scripts/seed-batch-data.mjs >> /home/z/my-project/dev.log 2>&1
    cd /home/z/my-project/.next/standalone
  fi
fi
if [ -f "$MAIN_DB" ] && [ -s "$MAIN_DB" ]; then
  cp "$MAIN_DB" "$STANDALONE_DB"
fi

echo 'DATABASE_URL=file:/home/z/my-project/db/pdb-tracker.db' > .env
cp /home/z/my-project/prisma/schema.prisma prisma/schema.prisma 2>/dev/null

# ── Start API server on port 3001 ──────────────────────────────────────────
nohup env NODE_ENV=production PORT=3001 \
  DATABASE_URL="file:/home/z/my-project/db/pdb-tracker.db" \
  node --expose-gc --max-old-space-size=384 api-server.js > /home/z/my-project/dev.log 2>&1 &
APIPID=$!
disown $APIPID
echo "API server PID: $APIPID (port 3001)"

sleep 5

# ── Start static file server on port 3000 ──────────────────────────────────
nohup bash -c 'cd /home/z/my-project/.next/standalone && exec node --max-old-space-size=128 custom-server.js' >> /home/z/my-project/dev.log 2>&1 &
STATICPID=$!
disown $STATICPID
echo "Static server PID: $STATICPID (port 3000)"

# ── Start watchdog ─────────────────────────────────────────────────────────
nohup bash /home/z/my-project/scripts/watchdog.sh >> /home/z/my-project/dev.log 2>&1 &
WATCHDOGPID=$!
disown $WATCHDOGPID
echo "Watchdog PID: $WATCHDOGPID (checks every 15s)"

sleep 2
echo "All services started. Access via http://localhost:81 (Caddy gateway)"
