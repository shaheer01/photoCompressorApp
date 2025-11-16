#!/bin/bash

# Photo Compressor Backend - GCP Cloud Run Deployment Script
# This script deploys the backend to Google Cloud Run

set -e

echo "🚀 Photo Compressor Backend - GCP Cloud Run Deployment"
echo "========================================================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Google Cloud SDK (gcloud) is not installed${NC}"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get GCP Project ID from pulse-point-dashboard or prompt user
echo -e "${YELLOW}📝 GCP Configuration${NC}"
read -p "Enter your GCP Project ID (e.g., pulse-point-dashboard): " PROJECT_ID

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}❌ Project ID is required${NC}"
    exit 1
fi

# Set the project
echo -e "${GREEN}Setting GCP project to: $PROJECT_ID${NC}"
gcloud config set project $PROJECT_ID

# Choose region
echo -e "${YELLOW}Select deployment region:${NC}"
echo "1) us-central1 (Iowa)"
echo "2) us-east1 (South Carolina)"
echo "3) europe-west1 (Belgium)"
echo "4) asia-northeast1 (Tokyo)"
read -p "Enter choice (1-4) [default: 1]: " REGION_CHOICE

case $REGION_CHOICE in
    2) REGION="us-east1" ;;
    3) REGION="europe-west1" ;;
    4) REGION="asia-northeast1" ;;
    *) REGION="us-central1" ;;
esac

echo -e "${GREEN}Using region: $REGION${NC}"

# Service name
SERVICE_NAME="photo-compressor-backend"

# Enable required APIs
echo -e "${YELLOW}🔧 Enabling required Google Cloud APIs...${NC}"
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Build and deploy using Cloud Build
echo -e "${YELLOW}🏗️  Building and deploying with Cloud Build...${NC}"
cd backend

gcloud builds submit \
    --tag gcr.io/$PROJECT_ID/$SERVICE_NAME \
    --project $PROJECT_ID

# Deploy to Cloud Run
echo -e "${YELLOW}🚀 Deploying to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --max-instances 10 \
    --port 3001 \
    --set-env-vars NODE_ENV=production \
    --project $PROJECT_ID

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --format 'value(status.url)' \
    --project $PROJECT_ID)

echo ""
echo -e "${GREEN}✅ Deployment successful!${NC}"
echo ""
echo "================================================"
echo -e "${GREEN}📍 Backend URL: $SERVICE_URL${NC}"
echo "================================================"
echo ""
echo "📝 Next steps:"
echo "1. Test your API: curl $SERVICE_URL/health"
echo "2. Update your frontend config.js with this URL"
echo "3. Deploy frontend to Netlify using ./deploy-netlify.sh"
echo ""
echo "🔐 To set up secrets (database, JWT, etc.):"
echo "   gcloud secrets create photo-compressor-db-url --data-file=- --project=$PROJECT_ID"
echo "   gcloud secrets create photo-compressor-jwt-secret --data-file=- --project=$PROJECT_ID"
echo ""

# Save URL for reference
echo "$SERVICE_URL" > backend-url.txt
echo -e "${GREEN}Backend URL saved to backend-url.txt${NC}"
