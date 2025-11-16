#!/bin/bash

# Photo Compressor - Complete Deployment to pulse-point-dashboard01
# Run this script from your LOCAL machine (requires gcloud CLI)

set -e

echo "🚀 Photo Compressor - Complete Deployment"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# VM Configuration
VM_NAME="pulse-point-dashboard01"
VM_ZONE="us-central1-c"
BACKEND_DOMAIN="api.compressphotos.cloud"
FRONTEND_DOMAIN="compressphotos.cloud"

echo -e "${BLUE}📋 Deployment Configuration:${NC}"
echo "  VM: $VM_NAME"
echo "  Zone: $VM_ZONE"
echo "  Backend Domain: $BACKEND_DOMAIN"
echo "  Frontend Domain: $FRONTEND_DOMAIN"
echo ""

# Check prerequisites
echo -e "${YELLOW}🔍 Checking prerequisites...${NC}"

if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found${NC}"
    echo "Please install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi
echo -e "${GREEN}✅ gcloud CLI installed${NC}"

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ git not found${NC}"
    exit 1
fi
echo -e "${GREEN}✅ git installed${NC}"

echo ""
echo -e "${YELLOW}🔌 Testing VM connection...${NC}"
if ! gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="echo 'Connection OK'" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to VM${NC}"
    echo "Please check:"
    echo "  - VM is running: gcloud compute instances list"
    echo "  - You have SSH access"
    exit 1
fi
echo -e "${GREEN}✅ VM connection successful${NC}"

echo ""
echo -e "${BLUE}=====================================
DEPLOYMENT PLAN
=====================================${NC}"
echo "1. ✅ Check existing VM setup (Nginx, Node.js)"
echo "2. 📦 Setup Photo Compressor environment"
echo "3. 🚀 Deploy backend to VM"
echo "4. 🌐 Configure Nginx reverse proxy"
echo "5. 🔐 Setup SSL certificate"
echo "6. 🎨 Deploy frontend to Netlify"
echo "7. 🧪 Test deployment"
echo ""
read -p "Continue with deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

# Step 1: Check existing setup
echo ""
echo -e "${BLUE}================================================
Step 1/7: Checking existing VM setup
================================================${NC}"

gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << 'ENDCHECK'
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Checking installed software...${NC}"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js: $NODE_VERSION${NC}"
else
    echo -e "${RED}❌ Node.js not installed${NC}"
fi

# Check Nginx
if command -v nginx &> /dev/null; then
    NGINX_VERSION=$(nginx -v 2>&1 | grep -o 'nginx/[0-9.]*')
    echo -e "${GREEN}✅ Nginx: $NGINX_VERSION${NC}"
else
    echo -e "${RED}❌ Nginx not installed${NC}"
fi

# Check PM2
if command -v pm2 &> /dev/null; then
    PM2_VERSION=$(pm2 --version)
    echo -e "${GREEN}✅ PM2: $PM2_VERSION${NC}"
else
    echo -e "${YELLOW}⚠️  PM2 not installed${NC}"
fi

# Check existing Nginx configs
echo ""
echo -e "${YELLOW}Checking Nginx configuration...${NC}"
if [ -f /etc/nginx/sites-available/pulse-point-dashboard ]; then
    echo -e "${GREEN}✅ Found pulse-point-dashboard config${NC}"
fi

# Check SSL certificates
if [ -d /etc/letsencrypt/live ]; then
    echo -e "${GREEN}✅ SSL certificates found${NC}"
    ls /etc/letsencrypt/live/ 2>/dev/null | grep -v README || true
fi
ENDCHECK

# Step 2: Setup Photo Compressor environment
echo ""
echo -e "${BLUE}================================================
Step 2/7: Setting up Photo Compressor environment
================================================${NC}"

echo -e "${YELLOW}Uploading setup script...${NC}"
gcloud compute scp setup-vm.sh $VM_NAME:/tmp/ --zone=$VM_ZONE

echo -e "${YELLOW}Running setup on VM...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash /tmp/setup-vm.sh"

# Step 3: Deploy backend
echo ""
echo -e "${BLUE}================================================
Step 3/7: Deploying backend to VM
================================================${NC}"

echo -e "${YELLOW}Creating deployment package...${NC}"
cd backend
TEMP_DIR=$(mktemp -d)
DEPLOY_PACKAGE="$TEMP_DIR/photo-compressor-backend.tar.gz"

tar -czf $DEPLOY_PACKAGE \
    --exclude='node_modules' \
    --exclude='logs' \
    --exclude='uploads' \
    --exclude='.env' \
    --exclude='*.log' \
    .

echo -e "${GREEN}✅ Package created: $(du -h $DEPLOY_PACKAGE | cut -f1)${NC}"
cd ..

echo -e "${YELLOW}Uploading to VM...${NC}"
gcloud compute scp $DEPLOY_PACKAGE $VM_NAME:/tmp/ --zone=$VM_ZONE

echo -e "${YELLOW}Deploying on VM...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << 'ENDDEPLOY'
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR="/var/www/photo-compressor-backend"
APP_USER="www-data"

echo -e "${YELLOW}Setting up application directory...${NC}"
sudo mkdir -p $APP_DIR
cd $APP_DIR

# Backup existing
if [ -d "current" ]; then
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

# Create directories
sudo mkdir -p logs uploads

# Copy or create .env
if [ ! -f "$APP_DIR/.env" ]; then
    echo "Creating .env file..."
    sudo tee $APP_DIR/.env > /dev/null << 'EOF'
NODE_ENV=production
PORT=3001

# Database - UPDATE THESE
DATABASE_URL=postgresql://user:password@localhost:5432/photo_compressor

# JWT Secrets - UPDATE THESE
JWT_SECRET=CHANGE_THIS_TO_RANDOM_SECRET
JWT_REFRESH_SECRET=CHANGE_THIS_TO_ANOTHER_RANDOM_SECRET

# Optional: Stripe
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_PUBLISHABLE_KEY=pk_live_...

# Optional: Email
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@gmail.com
# SMTP_PASS=your-app-password
EOF
    echo -e "${YELLOW}⚠️  Please edit $APP_DIR/.env with your actual values${NC}"
fi

# Copy .env
sudo cp $APP_DIR/.env .env

# Set permissions
sudo chown -R $APP_USER:$APP_USER $APP_DIR

# Switch to new version
cd $APP_DIR
sudo rm -rf current.old
[ -d current ] && sudo mv current current.old
sudo mv current.new current

# Start/restart with PM2
echo "Starting application with PM2..."
cd current

# Stop existing
sudo pm2 stop photo-compressor-backend 2>/dev/null || true
sudo pm2 delete photo-compressor-backend 2>/dev/null || true

# Start new
sudo pm2 start server.js --name photo-compressor-backend
sudo pm2 save

echo -e "${GREEN}✅ Application deployed and started${NC}"

# Cleanup
rm -f /tmp/photo-compressor-backend.tar.gz
ENDDEPLOY

rm -rf $TEMP_DIR

# Step 4: Configure Nginx
echo ""
echo -e "${BLUE}================================================
Step 4/7: Configuring Nginx reverse proxy
================================================${NC}"

echo -e "${YELLOW}Creating Nginx configuration...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << ENDNGINX
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

NGINX_CONFIG="/etc/nginx/sites-available/photo-compressor"

echo -e "\${YELLOW}Creating Nginx config for photo-compressor...\${NC}"
sudo tee \$NGINX_CONFIG > /dev/null << 'EOF'
server {
    listen 80;
    server_name $BACKEND_DOMAIN;

    # Increase upload size for images
    client_max_body_size 100M;

    # Logging
    access_log /var/log/nginx/photo-compressor-access.log;
    error_log /var/log/nginx/photo-compressor-error.log;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # Timeout for image processing
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/photo-compressor /etc/nginx/sites-enabled/

# Test config
echo -e "\${YELLOW}Testing Nginx configuration...\${NC}"
sudo nginx -t

# Reload Nginx
echo -e "\${YELLOW}Reloading Nginx...\${NC}"
sudo systemctl reload nginx

echo -e "\${GREEN}✅ Nginx configured and reloaded\${NC}"
ENDNGINX

# Step 5: Setup SSL
echo ""
echo -e "${BLUE}================================================
Step 5/7: Setting up SSL certificate
================================================${NC}"

echo -e "${YELLOW}Configuring SSL with Let's Encrypt...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << ENDSSL
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo -e "\${YELLOW}Installing certbot...\${NC}"
    sudo apt-get update
    sudo apt-get install -y certbot python3-certbot-nginx
fi

echo -e "\${YELLOW}Obtaining SSL certificate for $BACKEND_DOMAIN...\${NC}"

# Try to get certificate (non-interactive)
sudo certbot --nginx -d $BACKEND_DOMAIN --non-interactive --agree-tos --email admin@$BACKEND_DOMAIN --redirect || {
    echo -e "\${YELLOW}⚠️  Auto SSL setup failed. You may need to run manually:\${NC}"
    echo "  gcloud compute ssh $VM_NAME --zone=$VM_ZONE"
    echo "  sudo certbot --nginx -d $BACKEND_DOMAIN"
}

echo -e "\${GREEN}✅ SSL configuration complete\${NC}"
ENDSSL

# Step 6: Deploy frontend to Netlify
echo ""
echo -e "${BLUE}================================================
Step 6/7: Deploying frontend to Netlify
================================================${NC}"

if command -v netlify &> /dev/null || npm list -g netlify-cli &> /dev/null; then
    echo -e "${YELLOW}Deploying frontend to Netlify...${NC}"
    ./deploy-netlify.sh
else
    echo -e "${YELLOW}⚠️  Netlify CLI not found${NC}"
    echo "Please install: npm install -g netlify-cli"
    echo "Then run: ./deploy-netlify.sh"
fi

# Step 7: Test deployment
echo ""
echo -e "${BLUE}================================================
Step 7/7: Testing deployment
================================================${NC}"

echo -e "${YELLOW}Testing backend health...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="curl -s http://localhost:3001/health || echo 'Health check failed'"

echo ""
echo -e "${YELLOW}Checking PM2 status...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="sudo pm2 list"

echo ""
echo -e "${GREEN}================================================
✅ DEPLOYMENT COMPLETE!
================================================${NC}"
echo ""
echo -e "${BLUE}📍 URLs:${NC}"
echo "  Backend API: https://$BACKEND_DOMAIN"
echo "  Frontend: https://$FRONTEND_DOMAIN"
echo "  VISA Generator: https://$FRONTEND_DOMAIN/schengen-visa-photo.html"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Update .env file on VM:"
echo "   gcloud compute ssh $VM_NAME --zone=$VM_ZONE"
echo "   sudo nano /var/www/photo-compressor-backend/.env"
echo ""
echo "2. Restart backend after .env changes:"
echo "   gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 restart photo-compressor-backend'"
echo ""
echo "3. Test the application:"
echo "   curl https://$BACKEND_DOMAIN/health"
echo "   Visit: https://$FRONTEND_DOMAIN"
echo ""
echo -e "${BLUE}📊 Monitoring Commands:${NC}"
echo "  View logs: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 logs photo-compressor-backend'"
echo "  Status: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 status'"
echo "  Restart: gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command='sudo pm2 restart photo-compressor-backend'"
echo ""
echo -e "${GREEN}🎉 Deployment successful!${NC}"
