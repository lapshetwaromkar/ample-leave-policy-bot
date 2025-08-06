#!/bin/bash

# 🖥️ VM Remote Development Setup Script
# This script prepares your VM for remote development with Cursor/VS Code

set -e

echo "🖥️ Setting up VM for remote development..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

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

# Install SSH server
print_status "Installing and configuring SSH server..."
sudo apt install -y openssh-server

# Enable and start SSH service
print_status "Enabling SSH service..."
sudo systemctl enable ssh
sudo systemctl start ssh

# Configure firewall
print_status "Configuring firewall for SSH..."
sudo ufw allow ssh
sudo ufw --force enable

# Install development tools
print_status "Installing development tools..."
sudo apt install -y git curl wget htop nano

# Install Node.js (if not already installed)
if ! command -v node &> /dev/null; then
    print_status "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    print_status "Installing PM2..."
    sudo npm install -g pm2
fi

# Get system information
print_status "System information:"
echo "Hostname: $(hostname)"
echo "IP Address: $(hostname -I | awk '{print $1}')"
echo "SSH Status: $(sudo systemctl is-active ssh)"
echo "Node.js Version: $(node --version)"
echo "NPM Version: $(npm --version)"
echo "PM2 Version: $(pm2 --version)"

# Create development directory
print_status "Setting up development directory..."
mkdir -p ~/development
cd ~/development

# Clone the repository (if not already done)
if [ ! -d "ample-leave-policy-bot" ]; then
    print_status "Cloning repository..."
    git clone https://github.com/lapshetwaromkar/ample-leave-policy-bot.git
else
    print_status "Repository already exists, updating..."
    cd ample-leave-policy-bot
    git pull origin main
    cd ..
fi

# Set proper permissions
print_status "Setting proper permissions..."
sudo chown -R $USER:$USER ~/development

print_status "Remote development setup completed! 🎉"
echo ""
print_status "Next steps:"
echo "1. Get your VM's IP address: $(hostname -I | awk '{print $1}')"
echo "2. In Cursor, install 'Remote - SSH' extension"
echo "3. Connect using: ssh $USER@$(hostname -I | awk '{print $1}')"
echo "4. Open folder: ~/development/ample-leave-policy-bot"
echo ""
print_status "Useful commands:"
echo "- Check SSH status: sudo systemctl status ssh"
echo "- View SSH logs: sudo journalctl -u ssh"
echo "- Test SSH connection: ssh $USER@$(hostname -I | awk '{print $1}')"
echo "- Monitor system: htop" 