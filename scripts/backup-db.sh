#!/usr/bin/env bash
#
# scripts/backup-db.sh
#
# Copies the active SQLite database (`db/pdb-tracker.db`) to a timestamped file
# under `db/backups/`, prunes the directory to the 7 most recent backups, and
# appends a single line per run to `db/backups/backup.log`.
#
# Designed to be run from cron:
#
#     0 2 * * * /home/z/my-project/scripts/backup-db.sh
#
# Exit codes:
#   0  success (or source file missing — treated as a no-op so cron stays quiet)
#   1  backup failed (disk full, permissions, …)
#
# The script is intentionally dependency-free (POSIX-ish bash + `cp` + `ls`)
# so it runs on any minimal container / VM image.

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_DB="${PROJECT_ROOT}/db/pdb-tracker.db"
BACKUP_DIR="${PROJECT_ROOT}/db/backups"
BACKUP_LOG="${BACKUP_DIR}/backup.log"
KEEP_COUNT=7

# ─── Helpers ────────────────────────────────────────────────────────────────
now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
now_stamp() { date -u +"%Y%m%d-%H%M%S"; }

log() {
  # Append a single ISO-timestamped line to the backup log AND echo it so cron
  # captures the message in its own mail/log if redirection is set up.
  local line="[$(now_iso)] $*"
  printf '%s\n' "${line}" >>"${BACKUP_LOG}" 2>/dev/null || true
  printf '%s\n' "${line}"
}

# ─── Main ───────────────────────────────────────────────────────────────────
# Ensure the backup directory exists (create it even before the first backup
# so `backup.log` has a home).
mkdir -p "${BACKUP_DIR}"

# If the source database does not exist, log + exit 0. This is expected on a
# fresh install where the user has not yet created `pdb-tracker.db`; we do not
# want cron to spam root with failure emails in that case.
if [[ ! -f "${SOURCE_DB}" ]]; then
  log "SKIP source database not found: ${SOURCE_DB}"
  exit 0
fi

DEST_DB="${BACKUP_DIR}/pdb-tracker-$(now_stamp).db"

# Copy with `.bak` swap semantics: `cp -a` preserves mode + mtime. We copy to a
# temp name first and atomically `mv` into place so a crashed run never leaves
# a half-written backup file that the prune step might later keep.
TMP_DEST="${DEST_DB}.tmp"
if ! cp -a "${SOURCE_DB}" "${TMP_DEST}"; then
  log "FAIL could not copy ${SOURCE_DB} → ${TMP_DEST}"
  rm -f "${TMP_DEST}" 2>/dev/null || true
  exit 1
fi
mv -f "${TMP_DEST}" "${DEST_DB}"

SOURCE_SIZE="$(stat -c '%s' "${SOURCE_DB}" 2>/dev/null || stat -f '%z' "${SOURCE_DB}" 2>/dev/null || echo 0)"
DEST_SIZE="$(stat -c '%s' "${DEST_DB}" 2>/dev/null || stat -f '%z' "${DEST_DB}" 2>/dev/null || echo 0)"

log "BACKUP ok src=${SOURCE_DB} dest=${DEST_DB} src_bytes=${SOURCE_SIZE} dest_bytes=${DEST_SIZE}"

# ─── Prune: keep only the ${KEEP_COUNT} most recent backups ─────────────────
# List backup files matching the pattern, oldest first, then delete everything
# after the first (KEEP_COUNT) entries. We deliberately exclude `backup.log`
# and any `.tmp` files from the candidate set.
mapfile -t BACKUPS < <(
  ls -1t "${BACKUP_DIR}"/pdb-tracker-*.db 2>/dev/null || true
)

if (( ${#BACKUPS[@]} > KEEP_COUNT )); then
  PRUNE_COUNT=$(( ${#BACKUPS[@]} - KEEP_COUNT ))
  # The `ls -1t` output is newest-first, so the tail is what we delete.
  for f in "${BACKUPS[@]:KEEP_COUNT}"; do
    [[ -z "${f:-}" ]] && continue
    if rm -f "${f}" 2>/dev/null; then
      log "PRUNE removed old backup: ${f}"
    else
      log "WARN could not remove old backup: ${f}"
    fi
  done
  log "PRUNE kept=${KEEP_COUNT} removed=${PRUNE_COUNT}"
fi

exit 0
