#!/bin/bash

# Install HEIC/HEIF Support on Photo Compressor Backend VM
# Run this script to add HEIC support to an existing installation

set -e

echo "📦 Installing HEIC/HEIF Support"
echo "================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

VM_NAME="pulse-point-dashboard01"
VM_ZONE="us-central1-a"

echo -e "${YELLOW}Installing libheif on VM...${NC}"

gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="bash -s" << 'ENDINSTALL'
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Updating package list...${NC}"
sudo apt-get update

echo -e "${YELLOW}Installing libheif for HEIC/HEIF support...${NC}"
sudo apt-get install -y libheif-dev libheif1

echo -e "${YELLOW}Checking Sharp capabilities...${NC}"
cd /var/www/photo-compressor-backend/current
node -e "
const sharp = require('sharp');
sharp.format.heif ?
  console.log('✅ HEIC/HEIF support: ENABLED') :
  console.log('❌ HEIC/HEIF support: DISABLED')
"

echo -e "${GREEN}✅ HEIC/HEIF support installed${NC}"
ENDINSTALL

echo ""
echo -e "${YELLOW}Restarting backend...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="sudo pm2 restart photo-compressor-backend"

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ HEIC/HEIF Support Installation Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "Your backend now supports:"
echo "  - JPEG, PNG, WebP (as before)"
echo "  - HEIC/HEIF (Apple iPhone photos)"
echo ""
