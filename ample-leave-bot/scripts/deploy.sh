#!/bin/bash
set -e

# Production deployment script
# This script handles the complete deployment process with data preservation

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_PATH="${DATA_PATH:-$PROJECT_DIR/data}"

echo "🚀 Starting Ample Leave Policy Bot Deployment"
echo "📁 Project directory: $PROJECT_DIR"
echo "💾 Data directory: $DATA_PATH"

# Function to create directory structure
create_directories() {
    echo "📁 Creating directory structure..."
    mkdir -p "$DATA_PATH"/{postgres,redis,logs}
    mkdir -p "$PROJECT_DIR/backups"
    
    # Set proper permissions
    chmod 755 "$DATA_PATH"
    chmod 755 "$PROJECT_DIR/backups"
    echo "✅ Directory structure created"
}

# Function to backup current database if exists
backup_existing_data() {
    if [ -f "$PROJECT_DIR/.env" ] && docker-compose -f docker-compose.yml ps db 2>/dev/null | grep -q "Up"; then
        echo "💾 Backing up existing database..."
        ./scripts/backup-database.sh
        echo "✅ Backup completed"
    else
        echo "ℹ️  No existing database found to backup"
    fi
}

# Function to check environment file
check_environment() {
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        echo "⚠️  No .env file found. Creating from template..."
        cp "$PROJECT_DIR/production.env.example" "$PROJECT_DIR/.env"
        echo "❗ Please edit .env file with your actual values before continuing"
        echo "📝 Required variables:"
        echo "   - POSTGRES_PASSWORD"
        echo "   - OPENAI_API_KEY" 
        echo "   - SLACK_BOT_TOKEN"
        echo "   - SLACK_SIGNING_SECRET"
        echo "   - SLACK_APP_TOKEN"
        echo "   - ADMIN_TOKEN"
        read -p "Press Enter after updating .env file..."
    fi
    
    # Validate required environment variables
    source "$PROJECT_DIR/.env"
    REQUIRED_VARS=("POSTGRES_PASSWORD" "OPENAI_API_KEY" "SLACK_BOT_TOKEN" "ADMIN_TOKEN")
    
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            echo "❌ Required environment variable $var is not set"
            exit 1
        fi
    done
    
    echo "✅ Environment configuration validated"
}

# Function to stop existing services gracefully
stop_existing_services() {
    echo "🛑 Stopping existing services..."
    
    # Stop development/old services
    docker-compose down 2>/dev/null || true
    docker-compose -f docker-compose.simple.yml down 2>/dev/null || true
    
    # Stop any PM2 processes
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
    
    echo "✅ Existing services stopped"
}

# Function to build and start production services
start_production_services() {
    echo "🔨 Building production Docker images..."
    docker-compose -f docker-compose.simple.yml build --no-cache
    
    echo "🚀 Starting production services..."
    docker-compose -f docker-compose.simple.yml up -d
    
    echo "⏳ Waiting for services to start..."
    sleep 30
    
    # Check service health
    echo "🔍 Checking service health..."
    docker-compose -f docker-compose.simple.yml ps
    
    # Test application endpoints
    if curl -f http://localhost:3000/health >/dev/null 2>&1; then
        echo "✅ Application is healthy"
    else
        echo "❌ Application health check failed"
        docker-compose -f docker-compose.simple.yml logs app
        exit 1
    fi
}

# Function to restore data if backup exists
restore_data_if_needed() {
    LATEST_BACKUP="$PROJECT_DIR/backups/latest_backup.sql.gz"
    
    if [ -f "$LATEST_BACKUP" ] && [ "$1" = "--restore-data" ]; then
        echo "🔄 Restoring data from latest backup..."
        ./scripts/restore-database.sh "$LATEST_BACKUP"
        echo "✅ Data restored"
    elif [ -f "$LATEST_BACKUP" ]; then
        echo "💡 Latest backup found: $LATEST_BACKUP"
        echo "💡 To restore data, run: ./scripts/restore-database.sh latest_backup.sql.gz"
    fi
}

# Function to setup monitoring and logging
setup_monitoring() {
    echo "📊 Setting up monitoring..."
    
    # Create log rotation script
    cat > "$PROJECT_DIR/scripts/rotate-logs.sh" << 'EOF'
#!/bin/bash
find /app/logs -name "*.log" -size +100M -exec gzip {} \;
find /app/logs -name "*.log.gz" -mtime +30 -delete
EOF
    
    chmod +x "$PROJECT_DIR/scripts/rotate-logs.sh"
    
    echo "✅ Monitoring setup completed"
}

# Function to display deployment summary
show_deployment_summary() {
    echo ""
    echo "🎉 Deployment completed successfully!"
    echo ""
    echo "📋 Service URLs:"
    echo "   • Application: http://localhost:3000"
    echo "   • Health Check: http://localhost:3000/health"
    echo "   • Admin Dashboard: http://localhost:3000/admin (requires ADMIN_TOKEN)"
    echo ""
    echo "📊 Management Commands:"
    echo "   • View logs: docker-compose -f docker-compose.simple.yml logs -f"
    echo "   • Restart services: docker-compose -f docker-compose.simple.yml restart"
    echo "   • Stop services: docker-compose -f docker-compose.simple.yml down"
    echo "   • View PM2 status: docker-compose -f docker-compose.simple.yml exec app pm2 list"
    echo ""
    echo "💾 Data Management:"
    echo "   • Backup database: ./scripts/backup-database.sh"
    echo "   • Restore database: ./scripts/restore-database.sh <backup-file>"
    echo "   • Data location: $DATA_PATH"
    echo ""
    echo "🔧 Troubleshooting:"
    echo "   • Check service status: docker-compose -f docker-compose.simple.yml ps"
    echo "   • View application logs: docker-compose -f docker-compose.simple.yml logs app"
    echo "   • Debug database: docker-compose -f docker-compose.simple.yml exec db psql -U postgres -d ample_leave_bot"
}

# Main deployment flow
main() {
    echo "🏁 Starting deployment process..."
    
    # Change to project directory
    cd "$PROJECT_DIR"
    
    # Make scripts executable
    chmod +x scripts/*.sh
    
    # Create directory structure
    create_directories
    
    # Check environment configuration
    check_environment
    
    # Backup existing data
    backup_existing_data
    
    # Stop existing services
    stop_existing_services
    
    # Start production services
    start_production_services
    
    # Restore data if requested
    restore_data_if_needed "$1"
    
    # Setup monitoring
    setup_monitoring
    
    # Show summary
    show_deployment_summary
}

# Parse command line arguments
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0 [--restore-data]"
    echo ""
    echo "Options:"
    echo "  --restore-data    Restore database from latest backup after deployment"
    echo "  --help, -h        Show this help message"
    exit 0
fi

# Run main deployment
main "$@"
