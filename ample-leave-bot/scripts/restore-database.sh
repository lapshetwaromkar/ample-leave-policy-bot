#!/bin/bash
set -e

# Database restore script
# This script restores your PostgreSQL database from a backup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"

if [ $# -eq 0 ]; then
    echo "Usage: $0 <backup_file>"
    echo "Available backups:"
    ls -la "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "No backups found in $BACKUP_DIR"
    exit 1
fi

BACKUP_FILE="$1"

# If relative path, look in backup directory
if [[ ! "$BACKUP_FILE" = /* ]]; then
    BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "🔄 Starting database restore..."
echo "📁 Backup file: $BACKUP_FILE"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Extract database connection details
if [ -n "$DATABASE_URL" ]; then
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

echo "📊 Restoring to database: $DB_NAME on $DB_HOST:$DB_PORT"

# Set password for psql
export PGPASSWORD="$DB_PASS"

# Check if backup file is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo "📦 Decompressing backup file..."
    RESTORE_CMD="gunzip -c '$BACKUP_FILE'"
else
    RESTORE_CMD="cat '$BACKUP_FILE'"
fi

# Warn user about destructive operation
echo "⚠️  WARNING: This will replace all existing data in database '$DB_NAME'"
read -p "Are you sure you want to continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Restore cancelled"
    exit 1
fi

# Stop any running applications that might be using the database
echo "🛑 Stopping any running services..."
if command -v docker-compose &> /dev/null; then
    docker-compose down 2>/dev/null || true
fi

# Wait a moment for connections to close
sleep 2

# Restore the database
echo "🔄 Restoring database..."
eval $RESTORE_CMD | psql \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --dbname="postgres" \
    --quiet

echo "✅ Database restore completed successfully!"
echo "🎉 Your data has been restored from: $BACKUP_FILE"
echo "💡 You can now start your application services"
