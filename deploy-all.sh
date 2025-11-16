#!/bin/bash

# Photo Compressor - Complete Deployment Script
# Deploys both backend (VM) and frontend (Netlify)

set -e

echo "🚀 Photo Compressor - Complete Deployment"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}This script will:${NC}"
echo "  1. Deploy backend to GCP VM (pulse-point-dashboard01)"
echo "  2. Deploy frontend to Netlify"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

# Deploy Backend
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}Step 1/2: Deploying Backend to VM${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""

if [ -f "./deploy-backend-vm.sh" ]; then
    ./deploy-backend-vm.sh
    BACKEND_STATUS=$?

    if [ $BACKEND_STATUS -ne 0 ]; then
        echo -e "${RED}❌ Backend deployment failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ deploy-backend-vm.sh not found${NC}"
    exit 1
fi

# Deploy Frontend
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}Step 2/2: Deploying Frontend to Netlify${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""

if [ -f "./deploy-netlify.sh" ]; then
    ./deploy-netlify.sh
    FRONTEND_STATUS=$?

    if [ $FRONTEND_STATUS -ne 0 ]; then
        echo -e "${RED}❌ Frontend deployment failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ deploy-netlify.sh not found${NC}"
    exit 1
fi

# Success Summary
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}✅ Complete Deployment Successful!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${YELLOW}🌐 URLs:${NC}"
echo "  Frontend: https://compressphotos.cloud"
echo "  Backend API: https://api.compressphotos.cloud"
echo "  VISA Generator: https://compressphotos.cloud/schengen-visa-photo.html"
echo ""
echo -e "${YELLOW}📝 Post-deployment checklist:${NC}"
echo "  ☐ Test image compression"
echo "  ☐ Test VISA photo generator"
echo "  ☐ Verify background removal works"
echo "  ☐ Check all pages load correctly"
echo "  ☐ Monitor application logs"
echo ""
echo -e "${YELLOW}📊 Monitoring:${NC}"
echo "  Backend logs: gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command='sudo pm2 logs photo-compressor-backend'"
echo "  Frontend logs: netlify logs --prod"
echo ""
