#!/bin/bash

# Photo Compressor Backend - Deploy to GCP VM
# Deploys backend to pulse-point-dashboard01 VM

set -e

echo "🚀 Photo Compressor Backend - Deploy to GCP VM"
echo "================================================"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# VM Configuration
VM_NAME="pulse-point-dashboard01"
VM_ZONE="us-central1-c"
APP_DIR="/var/www/photo-compressor-backend"
APP_USER="www-data"

echo -e "${YELLOW}📋 Deployment Configuration${NC}"
echo "VM Name: $VM_NAME"
echo "Zone: $VM_ZONE"
echo "Deploy Directory: $APP_DIR"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Google Cloud SDK (gcloud) is not installed${NC}"
    echo "Please install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}⚠️  No active GCP project${NC}"
    read -p "Enter your GCP Project ID: " PROJECT_ID
    gcloud config set project $PROJECT_ID
fi

echo -e "${GREEN}Using project: $PROJECT_ID${NC}"
echo ""

# Test VM connection
echo -e "${YELLOW}🔌 Testing connection to VM...${NC}"
if ! gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="echo 'Connection successful'" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to VM: $VM_NAME${NC}"
    echo "Please check:"
    echo "  1. VM is running: gcloud compute instances list"
    echo "  2. You have SSH access"
    echo "  3. VM name and zone are correct"
    exit 1
fi
echo -e "${GREEN}✅ VM connection successful${NC}"
echo ""

# Create deployment package
echo -e "${YELLOW}📦 Creating deployment package...${NC}"
TEMP_DIR=$(mktemp -d)
DEPLOY_PACKAGE="$TEMP_DIR/photo-compressor-backend.tar.gz"

cd backend
tar -czf $DEPLOY_PACKAGE \
    --exclude='node_modules' \
    --exclude='logs' \
    --exclude='uploads' \
    --exclude='.env' \
    --exclude='*.log' \
    .

echo -e "${GREEN}✅ Package created: $(du -h $DEPLOY_PACKAGE | cut -f1)${NC}"
cd ..

# Upload package to VM
echo -e "${YELLOW}📤 Uploading to VM...${NC}"
gcloud compute scp $DEPLOY_PACKAGE $VM_NAME:/tmp/ --zone=$VM_ZONE

# Deploy on VM
echo -e "${YELLOW}🚀 Deploying on VM...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << 'ENDSSH'
set -e

# Colors for remote output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR="/var/www/photo-compressor-backend"
APP_USER="www-data"

echo -e "${YELLOW}Setting up application directory...${NC}"

# Create app directory if it doesn't exist
sudo mkdir -p $APP_DIR
cd $APP_DIR

# Backup existing installation
if [ -d "$APP_DIR/current" ]; then
    echo "Backing up current installation..."
    sudo cp -r current current.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
fi

# Extract new version
echo "Extracting new version..."
sudo rm -rf current.new
sudo mkdir -p current.new
sudo tar -xzf /tmp/photo-compressor-backend.tar.gz -C current.new

# Install dependencies
echo "Installing dependencies..."
cd current.new
sudo npm install --production

# Create necessary directories
sudo mkdir -p logs uploads

# Check if .env exists, if not create from template
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env file from template..."
    sudo cp .env.production .env || true
    echo -e "${YELLOW}⚠️  Please edit $APP_DIR/.env with your configuration${NC}"
fi

# Copy .env to new installation
sudo cp $APP_DIR/.env .env 2>/dev/null || true

# Set permissions
sudo chown -R $APP_USER:$APP_USER $APP_DIR
sudo chmod -R 755 $APP_DIR

# Switch to new version
cd $APP_DIR
sudo rm -rf current.old
[ -d current ] && sudo mv current current.old
sudo mv current.new current

# Restart application using PM2 or systemd
echo "Restarting application..."

# Try PM2 first
if command -v pm2 &> /dev/null; then
    echo "Using PM2 to restart..."
    cd current

    # Stop existing process
    sudo pm2 stop photo-compressor-backend 2>/dev/null || true
    sudo pm2 delete photo-compressor-backend 2>/dev/null || true

    # Start new process
    sudo pm2 start server.js --name photo-compressor-backend
    sudo pm2 save

    echo -e "${GREEN}✅ Application restarted with PM2${NC}"

# Try systemd
elif systemctl is-active --quiet photo-compressor-backend; then
    echo "Using systemd to restart..."
    sudo systemctl restart photo-compressor-backend
    echo -e "${GREEN}✅ Application restarted with systemd${NC}"
else
    echo -e "${YELLOW}⚠️  No process manager found${NC}"
    echo "Please manually start the application:"
    echo "  cd $APP_DIR/current && node server.js"
fi

# Cleanup
rm -f /tmp/photo-compressor-backend.tar.gz

echo -e "${GREEN}✅ Deployment complete!${NC}"
ENDSSH

# Cleanup local temp files
rm -rf $TEMP_DIR

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ Backend deployed successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""

# Get application status
echo -e "${YELLOW}📊 Checking application status...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << 'ENDSTATUS'
if command -v pm2 &> /dev/null; then
    echo "PM2 Status:"
    sudo pm2 list | grep photo-compressor || echo "Not running in PM2"
elif systemctl is-active --quiet photo-compressor-backend; then
    echo "Systemd Status:"
    sudo systemctl status photo-compressor-backend --no-pager -l
else
    echo "Application status unknown - no process manager detected"
fi

# Check if app is listening
echo ""
echo "Checking if app is responding..."
curl -s http://localhost:3001/health || echo "Health check failed"
ENDSTATUS

echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo "1. Configure nginx reverse proxy (if needed)"
echo "2. Set up SSL with certbot"
echo "3. Update frontend config with backend URL"
echo "4. Test the deployment"
echo ""
echo "Useful commands:"
echo "  View logs: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 logs photo-compressor-backend'"
echo "  Restart:   gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 restart photo-compressor-backend'"
echo "  Status:    gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 status'"
echo ""
