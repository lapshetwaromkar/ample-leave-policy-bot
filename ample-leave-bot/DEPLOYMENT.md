# 🚀 VM Deployment Guide for Ample Leave Policy Bot

## Prerequisites
- Ubuntu/Debian VM (recommended: Ubuntu 20.04 LTS or newer)
- SSH access to your VM
- Domain name (optional but recommended)

## Step 1: VM Setup

### 1.1 Install Node.js and npm
```bash
# Update package list
sudo apt update

# Install Node.js 18.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 1.2 Install PM2 (Process Manager)
```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify PM2 installation
pm2 --version
```

### 1.3 Install Git
```bash
sudo apt install git
```

## Step 2: Clone and Setup Project

### 2.1 Clone your repository
```bash
# Navigate to your preferred directory
cd /home/ubuntu

# Clone your repository
git clone https://github.com/lapshetwaromkar/ample-leave-policy-bot.git
cd ample-leave-policy-bot
```

### 2.2 Install dependencies
```bash
npm install
```

### 2.3 Create environment file
```bash
# Create .env file
nano .env
```

Add your environment variables:
```env
OPENAI_API_KEY=your_openai_api_key_here
SLACK_BOT_TOKEN=xoxb-your_slack_bot_token_here
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_APP_TOKEN=xapp-your_slack_app_token_here
PORT=3000
NODE_ENV=production
```

## Step 3: Configure PM2

### 3.1 Create PM2 ecosystem file
```bash
# Create ecosystem.config.js
nano ecosystem.config.js
```

Add this content:
```javascript
module.exports = {
  apps: [{
    name: 'ample-leave-bot',
    script: 'slack-server.js',
    cwd: '/home/ubuntu/ample-leave-policy-bot',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### 3.2 Create logs directory
```bash
mkdir logs
```

## Step 4: Start the Application

### 4.1 Start with PM2
```bash
# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 4.2 Verify the application is running
```bash
# Check status
pm2 status

# Check logs
pm2 logs ample-leave-bot
```

## Step 5: Configure Firewall (Optional)

### 5.1 Allow SSH and HTTP traffic
```bash
# Allow SSH
sudo ufw allow ssh

# Allow HTTP (if you want to expose web interface)
sudo ufw allow 3000

# Enable firewall
sudo ufw enable
```

## Step 6: Update Slack App Configuration

### 6.1 Update your Slack app settings
1. Go to [Slack API Console](https://api.slack.com/apps)
2. Select your app
3. Go to "Socket Mode" settings
4. Enable Socket Mode (this eliminates need for public URL)
5. Save changes

## Step 7: Monitoring and Maintenance

### 7.1 Useful PM2 commands
```bash
# View all processes
pm2 list

# Monitor processes
pm2 monit

# View logs
pm2 logs

# Restart application
pm2 restart ample-leave-bot

# Stop application
pm2 stop ample-leave-bot

# Delete application from PM2
pm2 delete ample-leave-bot
```

### 7.2 Update deployment
```bash
# Pull latest changes
git pull origin main

# Install new dependencies (if any)
npm install

# Restart the application
pm2 restart ample-leave-bot
```

## Troubleshooting

### Common Issues:

1. **Port already in use**
   ```bash
   # Check what's using port 3000
   sudo netstat -tulpn | grep :3000
   
   # Kill the process if needed
   sudo kill -9 <PID>
   ```

2. **Permission denied**
   ```bash
   # Fix file permissions
   sudo chown -R ubuntu:ubuntu /home/ubuntu/ample-leave-policy-bot
   ```

3. **Environment variables not loading**
   ```bash
   # Check if .env file exists
   ls -la .env
   
   # Restart PM2 to reload environment
   pm2 restart ample-leave-bot
   ```

4. **Slack connection issues**
   ```bash
   # Check logs for Slack errors
   pm2 logs ample-leave-bot --lines 50
   ```

## Security Considerations

1. **Keep your VM updated**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Secure SSH access**
   ```bash
   # Use key-based authentication instead of passwords
   # Disable root login
   # Change default SSH port
   ```

3. **Regular backups**
   ```bash
   # Backup your .env file and logs
   tar -czf backup-$(date +%Y%m%d).tar.gz .env logs/
   ```

## Performance Monitoring

### 7.3 Monitor system resources
```bash
# Install htop for better monitoring
sudo apt install htop

# Monitor system resources
htop
```

### 7.4 Check application health
```bash
# Check if bot is responding
curl http://localhost:3000/health

# Monitor memory usage
pm2 monit
```

## Next Steps

1. **Set up monitoring** (optional)
   - Install monitoring tools like New Relic or DataDog
   - Set up alerts for downtime

2. **Set up CI/CD** (optional)
   - Configure GitHub Actions for automatic deployment
   - Set up automated testing

3. **Scale if needed**
   - Add load balancer if you have multiple instances
   - Consider containerization with Docker

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs ample-leave-bot`
2. Check system logs: `sudo journalctl -u pm2-ubuntu`
3. Verify environment variables are set correctly
4. Ensure Slack app configuration is correct 