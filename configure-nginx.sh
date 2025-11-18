#!/bin/bash

# Configure Nginx for Photo Compressor Backend
# Run this script from your LOCAL machine

set -e

echo "🌐 Photo Compressor - Nginx Configuration"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

VM_NAME="pulse-point-dashboard01"
VM_ZONE="us-central1-a"
BACKEND_DOMAIN="api.compressphotos.cloud"

echo -e "${BLUE}Configuration:${NC}"
echo "  VM: $VM_NAME"
echo "  Zone: $VM_ZONE"
echo "  Domain: $BACKEND_DOMAIN"
echo ""

# Step 1: Create Nginx configuration
echo -e "${YELLOW}Step 1: Creating Nginx configuration...${NC}"

gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << 'ENDNGINX'
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

NGINX_CONFIG="/etc/nginx/sites-available/photo-compressor"
BACKEND_DOMAIN="api.compressphotos.cloud"

echo -e "${YELLOW}Creating Nginx config for photo-compressor...${NC}"
sudo tee $NGINX_CONFIG > /dev/null << 'EOF'
server {
    listen 80;
    server_name api.compressphotos.cloud;

    # Increase upload size for images
    client_max_body_size 100M;

    # Logging
    access_log /var/log/nginx/photo-compressor-access.log;
    error_log /var/log/nginx/photo-compressor-error.log;

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

        # Timeout for image processing
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# Enable site
echo -e "${YELLOW}Enabling site...${NC}"
sudo ln -sf /etc/nginx/sites-available/photo-compressor /etc/nginx/sites-enabled/

# Test config
echo -e "${YELLOW}Testing Nginx configuration...${NC}"
sudo nginx -t

# Reload Nginx
echo -e "${YELLOW}Reloading Nginx...${NC}"
sudo systemctl reload nginx

echo -e "${GREEN}✅ Nginx configured and reloaded${NC}"
ENDNGINX

echo -e "${GREEN}✅ Nginx configuration complete${NC}"
echo ""

# Step 2: Setup SSL with Let's Encrypt
echo -e "${YELLOW}Step 2: Setting up SSL certificate...${NC}"
echo ""
echo -e "${BLUE}⚠️  Important:${NC}"
echo "  Make sure $BACKEND_DOMAIN points to your VM IP: 34.9.155.122"
echo ""
read -p "Press Enter when DNS is ready, or Ctrl+C to skip SSL setup..."

gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << ENDSSL
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo -e "\${YELLOW}Installing certbot...\${NC}"
    sudo apt-get update
    sudo apt-get install -y certbot python3-certbot-nginx
fi

echo -e "\${YELLOW}Obtaining SSL certificate for $BACKEND_DOMAIN...\${NC}"

# Try to get certificate
sudo certbot --nginx -d $BACKEND_DOMAIN --non-interactive --agree-tos --email admin@$BACKEND_DOMAIN --redirect || {
    echo -e "\${YELLOW}⚠️  Auto SSL setup failed. Running manual mode...\${NC}"
    sudo certbot --nginx -d $BACKEND_DOMAIN
}

echo -e "\${GREEN}✅ SSL configuration complete\${NC}"
ENDSSL

echo ""
echo -e "${GREEN}================================================"
echo "✅ Nginx Configuration Complete!"
echo "================================================${NC}"
echo ""
echo "Your backend is now available at:"
echo "  https://$BACKEND_DOMAIN"
echo ""
echo "Test it:"
echo "  curl https://$BACKEND_DOMAIN/health"
echo ""
echo "Next step:"
echo "  ./deploy-netlify.sh"
echo ""
