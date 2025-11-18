#!/bin/bash

# Configure Photo Compressor Backend Environment
# This script helps set up the .env file using pulse-point-dashboard credentials

set -e

echo "🔧 Photo Compressor - Environment Configuration"
echo "================================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PULSE_POINT_DIR="/Users/shaheer.m/Downloads/PersonalRepo/pulse-point-dashboard"
PULSE_POINT_ENV="$PULSE_POINT_DIR/backend/.env"
PHOTO_COMPRESSOR_ENV="/var/www/photo-compressor-backend/.env"

echo -e "${YELLOW}Step 1: Extracting database credentials from pulse-point-dashboard${NC}"
echo ""

if [ ! -f "$PULSE_POINT_ENV" ]; then
    echo -e "${RED}❌ pulse-point-dashboard .env not found at: $PULSE_POINT_ENV${NC}"
    echo ""
    echo "Please manually configure the .env file on the VM:"
    echo "  gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-a"
    echo "  sudo nano $PHOTO_COMPRESSOR_ENV"
    exit 1
fi

echo -e "${GREEN}✅ Found pulse-point-dashboard .env${NC}"
echo ""

# Extract database credentials
echo -e "${YELLOW}Step 2: Reading database configuration...${NC}"

DB_HOST=$(grep "^DB_HOST=" "$PULSE_POINT_ENV" | cut -d '=' -f2 || echo "localhost")
DB_PORT=$(grep "^DB_PORT=" "$PULSE_POINT_ENV" | cut -d '=' -f2 || echo "3306")
DB_USER=$(grep "^DB_USER=" "$PULSE_POINT_ENV" | cut -d '=' -f2 || echo "")
DB_PASSWORD=$(grep "^DB_PASSWORD=" "$PULSE_POINT_ENV" | cut -d '=' -f2 || echo "")
DB_NAME="photo_compressor"

if [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo -e "${RED}❌ Could not extract database credentials${NC}"
    echo "Please check the pulse-point-dashboard .env file"
    exit 1
fi

echo -e "${GREEN}✅ Database credentials extracted${NC}"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

# Generate JWT secrets
echo -e "${YELLOW}Step 3: Generating JWT secrets...${NC}"

JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
JWT_REFRESH_SECRET=$(openssl rand -base64 64 | tr -d '\n')

echo -e "${GREEN}✅ JWT secrets generated${NC}"
echo ""

# Create .env content
echo -e "${YELLOW}Step 4: Creating .env file...${NC}"

ENV_CONTENT="# Photo Compressor Backend - Production Environment
NODE_ENV=production
PORT=3001

# Frontend URL
FRONTEND_URL=https://compressphotos.cloud

# Database Configuration (shared with pulse-point-dashboard)
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME

# JWT Configuration
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Security
BCRYPT_SALT_ROUNDS=12

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
"

# Upload to VM
echo -e "${YELLOW}Step 5: Uploading .env to VM...${NC}"

# Create temporary file
TMP_ENV=$(mktemp)
echo "$ENV_CONTENT" > "$TMP_ENV"

# Upload to VM
gcloud compute scp "$TMP_ENV" pulse-point-dashboard01:/tmp/photo-compressor.env --zone=us-central1-a

# Move to correct location on VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-a --command="sudo mv /tmp/photo-compressor.env $PHOTO_COMPRESSOR_ENV && sudo chown www-data:www-data $PHOTO_COMPRESSOR_ENV"

rm "$TMP_ENV"

echo -e "${GREEN}✅ .env file uploaded to VM${NC}"
echo ""

# Create database if it doesn't exist
echo -e "${YELLOW}Step 6: Creating photo_compressor database...${NC}"

gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-a --command="bash -s" << ENDSQL
mysql -u$DB_USER -p$DB_PASSWORD -e "CREATE DATABASE IF NOT EXISTS photo_compressor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || {
    echo "Database creation failed or already exists"
}
ENDSQL

echo -e "${GREEN}✅ Database setup complete${NC}"
echo ""

# Restart backend
echo -e "${YELLOW}Step 7: Restarting photo-compressor-backend...${NC}"

gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-a --command="sudo pm2 restart photo-compressor-backend"

echo ""
echo -e "${YELLOW}Waiting for application to start...${NC}"
sleep 3

# Check health
echo -e "${YELLOW}Step 8: Checking health...${NC}"

gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-a --command="curl -s http://localhost:3001/health || echo 'Health check failed'"

echo ""
echo -e "${GREEN}================================================"
echo "✅ Configuration Complete!"
echo "================================================${NC}"
echo ""
echo "Next steps:"
echo "1. Configure Nginx: ./configure-nginx.sh"
echo "2. Deploy frontend: ./deploy-netlify.sh"
echo ""
