#!/bin/bash
set -e

# Database backup script
# This script creates a full backup of your PostgreSQL database

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="ample_leave_bot_backup_$TIMESTAMP.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "🗄️  Starting database backup..."

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Extract database connection details from DATABASE_URL or use defaults
if [ -n "$DATABASE_URL" ]; then
    # Parse DATABASE_URL (postgresql://user:pass@host:port/db)
    DB_USER=$(echo $DATABASE_URL | sed 's/.*:\/\/\([^:]*\):.*/\1/')
    DB_PASS=$(echo $DATABASE_URL | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/')
    DB_HOST=$(echo $DATABASE_URL | sed 's/.*@\([^:]*\):.*/\1/')
    DB_PORT=$(echo $DATABASE_URL | sed 's/.*:\([0-9]*\)\/.*/\1/')
    DB_NAME=$(echo $DATABASE_URL | sed 's/.*\/\([^?]*\).*/\1/')
else
    DB_USER=${POSTGRES_USER:-postgres}
    DB_PASS=${POSTGRES_PASSWORD:-postgres}
    DB_HOST=${POSTGRES_HOST:-localhost}
    DB_PORT=${POSTGRES_PORT:-5432}
    DB_NAME=${POSTGRES_DB:-ample_leave_bot}
fi

echo "📊 Database: $DB_NAME on $DB_HOST:$DB_PORT"
echo "💾 Backup file: $BACKUP_FILE"

# Set password for pg_dump
export PGPASSWORD="$DB_PASS"

# Create the backup
pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --verbose \
    --clean \
    --if-exists \
    --create \
    --format=plain \
    --file="$BACKUP_DIR/$BACKUP_FILE"

# Compress the backup
gzip "$BACKUP_DIR/$BACKUP_FILE"
COMPRESSED_FILE="$BACKUP_FILE.gz"

echo "✅ Database backup completed successfully!"
echo "📁 Backup saved to: $BACKUP_DIR/$COMPRESSED_FILE"
echo "📏 File size: $(du -h "$BACKUP_DIR/$COMPRESSED_FILE" | cut -f1)"

# Clean up old backups (keep last 10)
echo "🧹 Cleaning up old backups..."
ls -t "$BACKUP_DIR"/ample_leave_bot_backup_*.sql.gz | tail -n +11 | xargs -r rm
echo "📁 Keeping $(ls -1 "$BACKUP_DIR"/ample_leave_bot_backup_*.sql.gz | wc -l) most recent backups"

# Create a "latest" symlink for easy access
cd "$BACKUP_DIR"
ln -sf "$COMPRESSED_FILE" "latest_backup.sql.gz"

echo "🎉 Backup process completed!"
echo "💡 To restore: ./scripts/restore-database.sh $COMPRESSED_FILE"
