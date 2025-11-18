#!/bin/bash

# Photo Compressor Backend - VM Setup Script
# Run this ONCE on the VM to set up the environment

set -e

echo "🔧 Photo Compressor Backend - VM Setup"
echo "========================================"

# This script should be run ON the VM
# Upload and run: gcloud compute scp setup-vm.sh pulse-point-dashboard01:/tmp/ --zone=us-central1-c
# Then: gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="bash /tmp/setup-vm.sh"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
APP_DIR="/var/www/photo-compressor-backend"
APP_USER="www-data"
NODE_VERSION="18"

echo -e "${YELLOW}This script will:${NC}"
echo "  1. Install Node.js $NODE_VERSION"
echo "  2. Install PM2 process manager"
echo "  3. Install system dependencies (Sharp, ImageMagick)"
echo "  4. Set up application directory"
echo "  5. Configure firewall"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup cancelled"
    exit 0
fi

echo ""
echo -e "${YELLOW}📦 Updating system packages...${NC}"
sudo apt-get update

echo -e "${YELLOW}📦 Installing Node.js $NODE_VERSION...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✅ Node.js installed: $(node --version)${NC}"
else
    echo -e "${GREEN}✅ Node.js already installed: $(node --version)${NC}"
fi

echo -e "${YELLOW}📦 Installing build dependencies...${NC}"
sudo apt-get install -y \
    build-essential \
    python3 \
    libvips-dev \
    libheif-dev \
    imagemagick \
    curl \
    git

echo -e "${YELLOW}📦 Installing PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 installed${NC}"
else
    echo -e "${GREEN}✅ PM2 already installed${NC}"
fi

# Setup PM2 to start on boot
echo -e "${YELLOW}🔧 Configuring PM2 startup...${NC}"
sudo pm2 startup systemd -u $USER --hp $HOME
sudo pm2 save

echo -e "${YELLOW}📁 Creating application directory...${NC}"
sudo mkdir -p $APP_DIR
sudo chown -R $APP_USER:$APP_USER $APP_DIR
echo -e "${GREEN}✅ Created: $APP_DIR${NC}"

echo -e "${YELLOW}🔥 Configuring firewall...${NC}"
# Allow port 3001 for the backend
if command -v ufw &> /dev/null; then
    sudo ufw allow 3001/tcp comment 'Photo Compressor Backend'
    echo -e "${GREEN}✅ Firewall rule added for port 3001${NC}"
else
    echo -e "${YELLOW}⚠️  UFW not installed, skipping firewall setup${NC}"
fi

echo -e "${YELLOW}🌐 Setting up Nginx (if not already configured)...${NC}"
if command -v nginx &> /dev/null; then
    echo -e "${GREEN}✅ Nginx already installed${NC}"

    # Create nginx config for photo compressor
    NGINX_CONFIG="/etc/nginx/sites-available/photo-compressor"
    if [ ! -f "$NGINX_CONFIG" ]; then
        echo "Creating Nginx configuration..."
        sudo tee $NGINX_CONFIG > /dev/null << 'EOF'
server {
    listen 80;
    server_name api.compressphotos.cloud;

    # Increase upload size for images
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeout settings for image processing
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

        # Enable the site
        sudo ln -sf /etc/nginx/sites-available/photo-compressor /etc/nginx/sites-enabled/

        # Test nginx config
        sudo nginx -t

        # Reload nginx
        sudo systemctl reload nginx

        echo -e "${GREEN}✅ Nginx configured for photo-compressor${NC}"
    else
        echo -e "${YELLOW}⚠️  Nginx config already exists: $NGINX_CONFIG${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Nginx not installed${NC}"
    echo "To install Nginx:"
    echo "  sudo apt-get install nginx"
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ VM Setup Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Deploy the backend: ./deploy-backend-vm.sh"
echo "2. Configure .env file on the VM"
echo "3. Set up SSL with certbot (recommended)"
echo "4. Configure your domain DNS"
echo ""
echo "Useful commands:"
echo "  PM2 status:  sudo pm2 status"
echo "  PM2 logs:    sudo pm2 logs"
echo "  Nginx test:  sudo nginx -t"
echo "  Nginx reload: sudo systemctl reload nginx"
echo ""
echo -e "${YELLOW}🔐 For SSL (HTTPS):${NC}"
echo "  sudo apt-get install certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d api.compressphotos.cloud"
echo ""
