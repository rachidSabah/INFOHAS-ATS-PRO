#!/usr/bin/env bash
# ResumeAI Pro — backup script
# Backs up Cloudflare D1 database and R2 bucket to a local directory.
# Schedule via cron or GitHub Actions.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATABASE_NAME="${DATABASE_NAME:-resumeai-pro-db}"
R2_BUCKET="${R2_BUCKET:-resumeai-pro-storage}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEST="$BACKUP_DIR/$TIMESTAMP"
mkdir -p "$DEST"

echo "→ Backing up D1 database: $DATABASE_NAME"
wrangler d1 export "$DATABASE_NAME" --output="$DEST/d1.sql" --remote

echo "→ Backing up R2 bucket: $R2_BUCKET"
if command -v rclone >/dev/null 2>&1; then
  rclone copy ":r2:$R2_BUCKET" "$DEST/r2/" --progress
else
  echo "  rclone not installed — skipping R2 download. Install rclone and configure :r2 remote."
fi

echo "→ Compressing backup"
tar -czf "$DEST.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP"
rm -rf "$DEST"

# Retention: keep last 14 backups
ls -1d "$BACKUP_DIR"/*.tar.gz 2>/dev/null | sort -r | tail -n +15 | xargs -r rm

echo "✓ Backup complete: $DEST.tar.gz"
