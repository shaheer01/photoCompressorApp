#!/bin/bash

# CompressPhotos Backend - GCP Cloud Run Deployment
# Deploys to project: project-ccb583ea-1e35-47be-ac7
# Region: me-central1

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
PROJECT_ID="project-ccb583ea-1e35-47be-ac7"
REGION="me-central1"
SERVICE_NAME="compressphotos-backend"
MEMORY="1Gi"
CPU="2"
MAX_INSTANCES="5"
PORT="3001"

echo -e "${GREEN}CompressPhotos Backend - GCP Cloud Run Deployment${NC}"
echo "Project: $PROJECT_ID | Region: $REGION"
echo "=================================================="

# Check gcloud
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}gcloud CLI not installed. Install from: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

# Verify auth
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)
if [ -z "$ACCOUNT" ]; then
    echo -e "${RED}Not authenticated. Run: gcloud auth login${NC}"
    exit 1
fi
echo -e "${GREEN}Authenticated as: $ACCOUNT${NC}"

# Set project
gcloud config set project $PROJECT_ID

# Enable APIs
echo -e "${YELLOW}Enabling required APIs...${NC}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --quiet

# Create Artifact Registry repo if it doesn't exist
gcloud artifacts repositories describe docker-repo \
    --location=$REGION \
    --project=$PROJECT_ID 2>/dev/null || \
gcloud artifacts repositories create docker-repo \
    --repository-format=docker \
    --location=$REGION \
    --project=$PROJECT_ID \
    --description="Docker images for CompressPhotos"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/docker-repo"

# Build image
echo -e "${YELLOW}Building Docker image...${NC}"
cd backend
gcloud builds submit \
    --tag "${REGISTRY}/${SERVICE_NAME}:latest" \
    --project $PROJECT_ID \
    --timeout=600s

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"

# Check if .env.production exists for env vars
ENV_VARS="NODE_ENV=production"

if [ -f "../.env.production" ]; then
    echo -e "${YELLOW}Loading production environment from .env.production...${NC}"
    while IFS= read -r line; do
        # Skip comments, empty lines, and PORT (reserved by Cloud Run)
        [[ "$line" =~ ^#.*$ ]] && continue
        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^PORT= ]] && continue
        ENV_VARS="${ENV_VARS},${line}"
    done < "../.env.production"
fi

gcloud run deploy $SERVICE_NAME \
    --image "${REGISTRY}/${SERVICE_NAME}:latest" \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --memory $MEMORY \
    --cpu $CPU \
    --max-instances $MAX_INSTANCES \
    --min-instances 0 \
    --port $PORT \
    --timeout 120 \
    --concurrency 50 \
    --set-env-vars "$ENV_VARS" \
    --project $PROJECT_ID

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --format 'value(status.url)' \
    --project $PROJECT_ID)

echo ""
echo "=================================================="
echo -e "${GREEN}Deployment successful!${NC}"
echo -e "${GREEN}Backend URL: $SERVICE_URL${NC}"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Test: curl $SERVICE_URL/health"
echo "2. Test readiness: curl $SERVICE_URL/health/ready"
echo "3. Update config.js with backend URL"
echo "4. Map custom domain: gcloud run domain-mappings create --service=$SERVICE_NAME --domain=api.compressphotos.cloud --region=$REGION"
echo ""

echo "$SERVICE_URL" > backend-url.txt
echo -e "${GREEN}URL saved to backend-url.txt${NC}"
