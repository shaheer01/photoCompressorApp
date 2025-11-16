#!/bin/bash

# Photo Compressor Frontend - Netlify Deployment Script
# This script deploys the frontend to Netlify

set -e

echo "🚀 Photo Compressor Frontend - Netlify Deployment"
echo "==================================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo -e "${YELLOW}⚠️  Netlify CLI not found. Installing...${NC}"
    npm install -g netlify-cli
fi

# Prepare deployment directory
echo -e "${YELLOW}📦 Preparing deployment files...${NC}"
rm -rf netlify-deploy
mkdir -p netlify-deploy

# Copy all necessary files
echo "Copying frontend files..."
cp index.html netlify-deploy/
cp schengen-visa-photo.html netlify-deploy/
cp styles.css netlify-deploy/
cp config.js netlify-deploy/
cp frontend-api.js netlify-deploy/
cp analytics-client.js netlify-deploy/
cp netlify.toml netlify-deploy/

# Copy other HTML files if they exist
cp *.html netlify-deploy/ 2>/dev/null || true

# Copy any other necessary files
[ -f privacy-policy.html ] && cp privacy-policy.html netlify-deploy/
[ -f terms-of-service.html ] && cp terms-of-service.html netlify-deploy/
[ -f contact.html ] && cp contact.html netlify-deploy/

# Create timestamp file
date > netlify-deploy/deploy-timestamp.txt

# Add headers file if not exists
if [ ! -f netlify-deploy/_headers ]; then
    cat > netlify-deploy/_headers << 'EOF'
/*
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  X-Content-Type-Options: nosniff
EOF
fi

cd netlify-deploy

echo ""
echo -e "${YELLOW}🌐 Netlify Deployment Options:${NC}"
echo "1) Deploy with existing site ID (requires NETLIFY_SITE_ID)"
echo "2) Create new site"
echo "3) Link to existing site interactively"
read -p "Enter choice (1-3) [default: 1]: " DEPLOY_CHOICE

case $DEPLOY_CHOICE in
    2)
        echo -e "${YELLOW}Creating new Netlify site...${NC}"
        netlify deploy --prod --dir .
        ;;
    3)
        echo -e "${YELLOW}Linking to existing site...${NC}"
        netlify link
        netlify deploy --prod --dir .
        ;;
    *)
        if [ -z "$NETLIFY_SITE_ID" ]; then
            echo -e "${YELLOW}⚠️  NETLIFY_SITE_ID not set${NC}"
            read -p "Enter your Netlify Site ID: " SITE_ID
            export NETLIFY_SITE_ID=$SITE_ID
        fi

        if [ -z "$NETLIFY_AUTH_TOKEN" ]; then
            echo -e "${YELLOW}⚠️  NETLIFY_AUTH_TOKEN not set${NC}"
            echo "Authenticating with Netlify..."
            netlify login
        fi

        echo -e "${GREEN}Deploying to Netlify...${NC}"
        netlify deploy --prod --dir . --site $NETLIFY_SITE_ID
        ;;
esac

cd ..

echo ""
echo -e "${GREEN}✅ Frontend deployment complete!${NC}"
echo ""
echo "================================================"
echo -e "${GREEN}📍 Site URL: https://compressphotos.cloud${NC}"
echo "================================================"
echo ""
echo "📝 Next steps:"
echo "1. Verify deployment at your Netlify dashboard"
echo "2. Test the site: https://compressphotos.cloud"
echo "3. Check VISA photo generator: https://compressphotos.cloud/schengen-visa-photo.html"
echo ""
