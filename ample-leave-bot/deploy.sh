#!/bin/bash

# 🚀 Ample Leave Policy Bot - VM Deployment Script
# This script automates the deployment process on your VM

set -e  # Exit on any error

echo "🚀 Starting Ample Leave Policy Bot deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root. Please run as a regular user."
   exit 1
fi

# Update system
print_status "Updating system packages..."
sudo apt update

# Install Node.js 18.x
print_status "Installing Node.js 18.x..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    print_warning "Node.js is already installed: $(node --version)"
fi

# Install PM2
print_status "Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    print_warning "PM2 is already installed: $(pm2 --version)"
fi

# Install Git
print_status "Installing Git..."
sudo apt install -y git

# Clone repository
print_status "Cloning repository..."
if [ ! -d "ample-leave-policy-bot" ]; then
    git clone https://github.com/lapshetwaromkar/ample-leave-policy-bot.git
    cd ample-leave-policy-bot
else
    print_warning "Repository already exists, updating..."
    cd ample-leave-policy-bot
    git pull origin main
fi

# Install dependencies
print_status "Installing npm dependencies..."
npm install

# Create logs directory
print_status "Creating logs directory..."
mkdir -p logs

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning "Creating .env file template..."
    cat > .env << EOF
# Add your environment variables here
OPENAI_API_KEY=your_openai_api_key_here
SLACK_BOT_TOKEN=xoxb-your_slack_bot_token_here
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_APP_TOKEN=xapp-your_slack_app_token_here
PORT=3000
NODE_ENV=production
EOF
    print_warning "Please edit .env file with your actual credentials before starting the bot."
else
    print_status ".env file already exists."
fi

# Start the application with PM2
print_status "Starting application with PM2..."
pm2 start ecosystem.config.js

# Save PM2 configuration
print_status "Saving PM2 configuration..."
pm2 save

# Setup PM2 to start on boot
print_status "Setting up PM2 to start on boot..."
pm2 startup

print_status "Deployment completed successfully! 🎉"
echo ""
print_status "Next steps:"
echo "1. Edit .env file with your actual credentials"
echo "2. Restart the application: pm2 restart ample-leave-bot"
echo "3. Check status: pm2 status"
echo "4. View logs: pm2 logs ample-leave-bot"
echo ""
print_status "Useful commands:"
echo "- Check status: pm2 status"
echo "- View logs: pm2 logs"
echo "- Restart: pm2 restart ample-leave-bot"
echo "- Stop: pm2 stop ample-leave-bot"
echo "- Monitor: pm2 monit" 