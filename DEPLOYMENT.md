# 🚀 Photo Compressor - Deployment Guide

This guide explains how to deploy the Photo Compressor application to GCP Cloud Run (backend) and Netlify (frontend).

## 📋 Prerequisites

### For GCP Deployment
- [ ] Google Cloud SDK (gcloud) installed
- [ ] GCP Project ID (same as pulse-point-dashboard)
- [ ] Billing enabled on your GCP project
- [ ] Permissions to deploy to Cloud Run

### For Netlify Deployment
- [ ] Netlify account
- [ ] Netlify CLI installed (`npm install -g netlify-cli`)
- [ ] Netlify Site ID (or create a new site)

---

## 🎯 Quick Start - Automated Deployment

### Option 1: GitHub Actions (Recommended)

1. **Set up GitHub Secrets:**
   Go to your repository → Settings → Secrets and add:

   ```
   GCP_SA_KEY              - Your GCP service account JSON key
   GCP_PROJECT_ID          - Your GCP project ID (e.g., pulse-point-dashboard)
   NETLIFY_AUTH_TOKEN      - Your Netlify personal access token
   NETLIFY_SITE_ID         - Your Netlify site ID
   ```

2. **Deploy:**
   ```bash
   git push origin main
   ```

   GitHub Actions will automatically:
   - Build and deploy backend to GCP Cloud Run
   - Deploy frontend to Netlify
   - Show deployment URLs in the Actions log

### Option 2: Manual Deployment Scripts

#### Deploy Backend to GCP
```bash
./deploy-gcp.sh
```

This script will:
1. Prompt for your GCP Project ID
2. Ask you to select a region
3. Build Docker image using Cloud Build
4. Deploy to Cloud Run
5. Return the backend URL

#### Deploy Frontend to Netlify
```bash
./deploy-netlify.sh
```

This script will:
1. Prepare deployment files
2. Deploy to Netlify (production)
3. Confirm deployment URL

---

## 🔧 Detailed Manual Deployment

### Backend Deployment (GCP Cloud Run)

#### Step 1: Set up GCP Project

```bash
# Set your project ID (same as pulse-point-dashboard)
export PROJECT_ID="your-gcp-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

#### Step 2: Build and Deploy

```bash
cd backend

# Build using Cloud Build
gcloud builds submit --tag gcr.io/$PROJECT_ID/photo-compressor-backend

# Deploy to Cloud Run
gcloud run deploy photo-compressor-backend \
  --image gcr.io/$PROJECT_ID/photo-compressor-backend \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --port 3001 \
  --set-env-vars NODE_ENV=production
```

#### Step 3: Get Backend URL

```bash
gcloud run services describe photo-compressor-backend \
  --region us-central1 \
  --format 'value(status.url)'
```

Save this URL - you'll need it for frontend configuration.

### Frontend Deployment (Netlify)

#### Step 1: Prepare Files

```bash
# Create deployment directory
mkdir -p netlify-deploy

# Copy files
cp index.html netlify-deploy/
cp schengen-visa-photo.html netlify-deploy/
cp styles.css netlify-deploy/
cp config.js netlify-deploy/
cp frontend-api.js netlify-deploy/
cp analytics-client.js netlify-deploy/
cp netlify.toml netlify-deploy/
```

#### Step 2: Update Configuration

Edit `netlify-deploy/config.js` and update the backend URL:

```javascript
CONFIG.backendApiUrl = 'YOUR_GCP_CLOUD_RUN_URL';
```

#### Step 3: Deploy to Netlify

```bash
cd netlify-deploy

# Login to Netlify (first time only)
netlify login

# Deploy
netlify deploy --prod --dir .
```

Or if you have a site ID:

```bash
export NETLIFY_SITE_ID="your-site-id"
netlify deploy --prod --dir . --site $NETLIFY_SITE_ID
```

---

## 🔐 Environment Variables & Secrets

### Backend Environment Variables

These need to be set in Cloud Run:

**Required:**
- `NODE_ENV=production`
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT secret key
- `JWT_REFRESH_SECRET` - Refresh token secret

**Optional:**
- `STRIPE_SECRET_KEY` - Stripe API key
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` - Email configuration

#### Setting Secrets in GCP

```bash
# Create secrets
echo -n "your-database-url" | gcloud secrets create photo-compressor-db-url --data-file=-
echo -n "your-jwt-secret" | gcloud secrets create photo-compressor-jwt-secret --data-file=-

# Update Cloud Run to use secrets
gcloud run services update photo-compressor-backend \
  --region us-central1 \
  --set-secrets DATABASE_URL=photo-compressor-db-url:latest,JWT_SECRET=photo-compressor-jwt-secret:latest
```

---

## 🧪 Testing Deployment

### Test Backend

```bash
# Health check
curl https://your-backend-url/health

# Should return: {"status": "ok"}
```

### Test Frontend

1. Visit `https://compressphotos.cloud`
2. Upload an image and compress it
3. Check browser console for any errors
4. Test VISA photo generator: `https://compressphotos.cloud/schengen-visa-photo.html`

---

## 📊 Monitoring & Logs

### Backend Logs (GCP)

```bash
# View recent logs
gcloud run services logs read photo-compressor-backend \
  --region us-central1 \
  --limit 50

# Stream logs
gcloud run services logs tail photo-compressor-backend \
  --region us-central1
```

### Frontend Logs (Netlify)

```bash
# View deployment logs
netlify logs --prod

# Or visit Netlify dashboard
```

---

## 🔄 Updating Deployments

### Update Backend

```bash
cd backend
gcloud builds submit --tag gcr.io/$PROJECT_ID/photo-compressor-backend
gcloud run deploy photo-compressor-backend \
  --image gcr.io/$PROJECT_ID/photo-compressor-backend \
  --region us-central1
```

### Update Frontend

```bash
./deploy-netlify.sh
```

Or with GitHub Actions: just push to main branch.

---

## 🆘 Troubleshooting

### Backend won't deploy
- Check if APIs are enabled: `gcloud services list --enabled`
- Verify billing is enabled
- Check Dockerfile builds locally: `docker build -t test .`

### Frontend deployment fails
- Ensure all required files are in `netlify-deploy/`
- Check Netlify build logs
- Verify `netlify.toml` is correct

### CORS errors
- Update backend CORS configuration in `backend/server.js`
- Add frontend domain to allowed origins

### Environment variables not working
- Check Cloud Run service configuration: `gcloud run services describe photo-compressor-backend --region us-central1`
- Verify secrets exist: `gcloud secrets list`

---

## 📝 Post-Deployment Checklist

- [ ] Backend health check passes
- [ ] Frontend loads correctly
- [ ] Image compression works
- [ ] VISA photo generator works
- [ ] Background removal works
- [ ] Analytics tracking works
- [ ] All pages load (privacy, terms, contact)
- [ ] SSL certificates are valid
- [ ] Custom domain configured (if applicable)

---

## 🔗 Useful Commands

```bash
# Check Cloud Run services
gcloud run services list

# Describe specific service
gcloud run services describe photo-compressor-backend --region us-central1

# Update service with new environment variable
gcloud run services update photo-compressor-backend \
  --region us-central1 \
  --set-env-vars NEW_VAR=value

# Delete service (careful!)
gcloud run services delete photo-compressor-backend --region us-central1

# Netlify status
netlify status

# Netlify sites list
netlify sites:list
```

---

## 💰 Cost Optimization

### Cloud Run
- Uses pay-per-use pricing
- Free tier: 2 million requests/month
- Optimize by setting `--max-instances` to limit concurrent instances

### Netlify
- Free tier includes:
  - 100 GB bandwidth
  - 300 build minutes
  - Automatic HTTPS

---

## 🎉 Success!

Your Photo Compressor app is now deployed!

- **Frontend:** https://compressphotos.cloud
- **Backend:** https://your-cloud-run-url
- **VISA Generator:** https://compressphotos.cloud/schengen-visa-photo.html

For support, check the logs or create an issue in the repository.
