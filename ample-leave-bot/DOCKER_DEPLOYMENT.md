# Docker Deployment Guide

This guide covers deploying the Ample Leave Policy Bot using Docker with data persistence and PM2 process management.

## 🚀 Quick Start

### 1. Setup Environment
```bash
# Copy environment template
cp production.env.example .env

# Edit .env with your actual values
# Required: POSTGRES_PASSWORD, OPENAI_API_KEY, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN, ADMIN_TOKEN
```

### 2. Deploy with Data Backup
```bash
# Make scripts executable
chmod +x scripts/*.sh

# Deploy (will backup existing data if any)
./scripts/deploy.sh

# Or deploy and restore existing data
./scripts/deploy.sh --restore-data
```

## 📋 What's Included

### Services
- **PostgreSQL** with pgvector extension for document embeddings
- **Redis** for caching and rate limiting  
- **Application** running with PM2 (API server + Slack bot)

### Data Persistence
- Database data: `./data/postgres`
- Redis data: `./data/redis`
- Application logs: `./data/logs`
- Backups: `./backups`

### Process Management
- **PM2** runs both API server and Slack bot with auto-restart
- **2 instances** of API server (load balanced)
- **2 instances** of Slack bot (high availability)

## 🛠 Management Commands

### Service Management
```bash
# View all services
docker-compose -f docker-compose.simple.yml ps

# View logs
docker-compose -f docker-compose.simple.yml logs -f app

# Restart services
docker-compose -f docker-compose.simple.yml restart

# Stop services
docker-compose -f docker-compose.simple.yml down
```

### PM2 Management
```bash
# View PM2 status
docker-compose -f docker-compose.simple.yml exec app pm2 list

# View PM2 logs
docker-compose -f docker-compose.simple.yml exec app pm2 logs

# Restart specific app
docker-compose -f docker-compose.simple.yml exec app pm2 restart ample-leave-api
```

### Database Management
```bash
# Backup database
./scripts/backup-database.sh

# Restore from backup
./scripts/restore-database.sh <backup-file>

# Connect to database
docker-compose -f docker-compose.simple.yml exec db psql -U postgres -d ample_leave_bot
```

## 🔧 Configuration

### Environment Variables
Key variables in `.env`:
```bash
# Database
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=ample_leave_bot

# OpenAI
OPENAI_API_KEY=sk-...

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...

# Admin
ADMIN_TOKEN=your-admin-token

# Performance
API_INSTANCES=2          # API server instances
SLACK_INSTANCES=2        # Slack bot instances
```

### Port Configuration
- **Application**: http://localhost:3000
- **Database**: localhost:5432
- **Redis**: localhost:6379

## 📊 Monitoring

### Health Checks
- Application: http://localhost:3000/health
- Admin Dashboard: http://localhost:3000/admin

### Logs
- Application logs: `./data/logs/`
- PM2 logs: `docker-compose -f docker-compose.simple.yml exec app pm2 logs`
- Service logs: `docker-compose -f docker-compose.simple.yml logs`

## 🔄 Data Migration

### From Development to Production
1. Backup development database: `./scripts/backup-database.sh`
2. Deploy production: `./scripts/deploy.sh`
3. Restore data: `./scripts/restore-database.sh latest_backup.sql.gz`

### Updating Application
```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose -f docker-compose.simple.yml down
docker-compose -f docker-compose.simple.yml build --no-cache
docker-compose -f docker-compose.simple.yml up -d
```

## 🚨 Troubleshooting

### Common Issues
1. **Port conflicts**: Change `APP_PORT` in `.env`
2. **Database connection**: Check `POSTGRES_PASSWORD` in `.env`
3. **Memory issues**: Reduce `API_INSTANCES` and `SLACK_INSTANCES`

### Debug Commands
```bash
# Check service status
docker-compose -f docker-compose.simple.yml ps

# View application logs
docker-compose -f docker-compose.simple.yml logs app

# Check PM2 status
docker-compose -f docker-compose.simple.yml exec app pm2 list

# Database health
docker-compose -f docker-compose.simple.yml exec db pg_isready -U postgres
```

## 📁 File Structure
```
ample-leave-bot/
├── docker-compose.simple.yml   # Main deployment file
├── Dockerfile.production        # Production Docker image
├── ecosystem.production.config.js  # PM2 configuration
├── scripts/
│   ├── deploy.sh               # Main deployment script
│   ├── backup-database.sh      # Database backup
│   └── restore-database.sh     # Database restore
├── data/                       # Persistent data (created on deploy)
│   ├── postgres/
│   ├── redis/
│   └── logs/
└── backups/                    # Database backups
```

## ✅ Production Checklist

- [ ] Set strong `POSTGRES_PASSWORD`
- [ ] Set secure `ADMIN_TOKEN`
- [ ] Configure all Slack tokens
- [ ] Set valid `OPENAI_API_KEY`
- [ ] Run initial backup
- [ ] Test health endpoints
- [ ] Verify PM2 processes
- [ ] Check logs for errors
