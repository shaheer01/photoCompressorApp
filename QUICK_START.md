# ImageOptim Quick Start Guide

## 🚀 Deploy in 5 Minutes

### Step 1: Configure Environment
```bash
# Copy environment template
cp .env.production .env

# Edit with your values (minimum required):
nano .env
```

**Essential settings to change in .env:**
```bash
# Database (change password!)
DB_PASSWORD=your_very_secure_password_here

# JWT Secrets (generate with: openssl rand -base64 32)
JWT_SECRET=your_32_character_secret_here
JWT_REFRESH_SECRET=another_32_character_secret_here

# Your domain
FRONTEND_URL=https://your-domain.com
BACKEND_URL=https://your-domain.com/api
```

### Step 2: Deploy
```bash
# Run initial deployment
./deploy.sh init
```

That's it! Your application should now be running at:
- **Frontend**: http://localhost
- **API**: http://localhost/api/health
- **Database**: PostgreSQL on localhost:5432

## 🧪 Test the Deployment

### Test API Connection
```bash
curl http://localhost/api/health
# Should return: {"status":"healthy"}
```

### Test User Registration
```bash
curl -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User", 
    "email": "test@example.com",
    "password": "Test123!@#"
  }'
```

### Test Image Compression
```bash
# Upload a test image
curl -X POST http://localhost/api/images/compress \
  -F "images=@test-image.jpg" \
  -F "quality=80"
```

## 📊 Check Status
```bash
./deploy.sh status
```

## 📋 Common Commands

```bash
# View logs
./deploy.sh logs

# Create database backup
./deploy.sh backup

# Restart services
./deploy.sh restart

# Stop everything
./deploy.sh stop
```

## 🔧 Production Configuration

### For Stripe Payments
1. Get your Stripe keys from https://dashboard.stripe.com/apikeys
2. Update `.env` with real keys:
```bash
STRIPE_SECRET_KEY=sk_live_your_real_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_real_key
```

### For Google AdSense
1. Apply for AdSense at https://www.google.com/adsense/
2. Create ad units and update `index.html` with your publisher ID
3. Replace all instances of `ca-pub-XXXXXXXXXXXXXXXX`

### For Email Notifications
```bash
# Gmail example
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### For SSL/HTTPS
```bash
# Install certbot
sudo apt install certbot

# Get SSL certificate
sudo certbot certonly --standalone -d your-domain.com

# Update nginx configuration for HTTPS
```

## 🚨 Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose logs backend
docker-compose logs postgres

# Common fixes:
# 1. Check .env file has correct values
# 2. Ensure ports aren't already in use
# 3. Check Docker daemon is running
```

### Database Connection Failed
```bash
# Test database connection
docker-compose exec postgres psql -U imageoptim_user -d imageoptim_db

# Reset database
docker-compose down -v
docker-compose up -d
./deploy.sh migrate
```

### API Returns 500 Errors
```bash
# Check backend logs
docker-compose logs backend

# Common causes:
# - Missing environment variables
# - Database not migrated
# - Invalid JWT secrets
```

## 🎯 Next Steps

1. **Domain Setup**: Point your domain to the server
2. **SSL Certificate**: Set up HTTPS with Let's Encrypt
3. **Stripe Setup**: Configure real payment processing
4. **AdSense Setup**: Add your real publisher IDs
5. **Monitoring**: Set up log monitoring and alerts
6. **Backups**: Configure automated backups

## 📞 Support

- **Logs**: `./deploy.sh logs`
- **Status**: `./deploy.sh status`  
- **Documentation**: See `PRODUCTION_DEPLOYMENT.md` for detailed guide
- **Migration**: See `MIGRATION_GUIDE.md` for data migration

---

🎉 **Your ImageOptim application is now running!** Visit http://localhost to start using it.