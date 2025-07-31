# ImageOptim Production Deployment Guide

This guide will walk you through deploying ImageOptim to production with a complete backend system, database, and API integration.

## 📋 Prerequisites

- **Server Requirements**: 2+ CPU cores, 4GB+ RAM, 20GB+ storage
- **Domain**: Registered domain name with DNS access
- **SSL Certificate**: Let's Encrypt or commercial SSL certificate
- **Accounts Needed**:
  - Stripe account for payments
  - Google AdSense account for ads
  - SMTP service for emails (Gmail/SendGrid/etc.)
  - PostgreSQL database (local or cloud)

## 🚀 Deployment Methods

### Method 1: Docker Deployment (Recommended)

#### Step 1: Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Nginx for SSL termination
sudo apt install nginx certbot python3-certbot-nginx -y
```

#### Step 2: Configure Environment
```bash
# Clone repository
git clone <your-repo-url> imageoptim
cd imageoptim

# Copy and configure environment
cp .env.production .env
nano .env  # Edit with your actual values
```

#### Step 3: Configure Nginx
```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/imageoptim

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/imageoptim /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### Step 4: SSL Certificate
```bash
# Get SSL certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal
sudo systemctl enable certbot.timer
```

#### Step 5: Deploy with Docker
```bash
# Start services
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f

# Run database migration
docker-compose exec backend node scripts/migrate.js full
```

### Method 2: Manual Deployment

#### Step 1: Database Setup
```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Create database and user
sudo -u postgres psql
CREATE DATABASE imageoptim_db;
CREATE USER imageoptim_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE imageoptim_db TO imageoptim_user;
\q

# Run schema migration
psql -h localhost -U imageoptim_user -d imageoptim_db -f backend/database/schema.sql
```

#### Step 2: Backend Setup
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Setup backend
cd backend
npm install --production

# Configure environment
cp .env.example .env
nano .env  # Edit with your values

# Start backend with PM2
pm2 start server.js --name imageoptim-api
pm2 startup
pm2 save
```

#### Step 3: Frontend Setup
```bash
# Copy frontend files to web directory
sudo mkdir -p /var/www/imageoptim
sudo cp -r *.html *.css *.js /var/www/imageoptim/
sudo chown -R www-data:www-data /var/www/imageoptim

# Configure Nginx
sudo cp nginx/nginx.conf /etc/nginx/sites-available/imageoptim
sudo ln -s /etc/nginx/sites-available/imageoptim /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

## 🔧 Configuration

### 1. Environment Variables
```bash
# Essential configurations in .env file:

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/imageoptim_db

# JWT Secrets (generate with: openssl rand -base64 32)
JWT_SECRET=your_32_character_jwt_secret
JWT_REFRESH_SECRET=your_refresh_token_secret

# Stripe Keys (from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_live_your_stripe_secret
STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Email (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### 2. Stripe Configuration
```bash
# 1. Create products in Stripe Dashboard
# 2. Get price IDs and update .env:
STRIPE_MONTHLY_PRICE_ID=price_your_monthly_id
STRIPE_YEARLY_PRICE_ID=price_your_yearly_id

# 3. Configure webhook endpoint:
# URL: https://your-domain.com/api/webhooks/stripe
# Events: customer.subscription.*, invoice.payment_*, checkout.session.completed
```

### 3. Google AdSense Setup
```bash
# 1. Apply for AdSense approval
# 2. Create ad units in AdSense dashboard
# 3. Update .env with your IDs:
ADSENSE_PUBLISHER_ID=ca-pub-your_publisher_id
ADSENSE_BANNER_SLOT_ID=your_banner_slot_id
ADSENSE_SIDEBAR_SLOT_ID=your_sidebar_slot_id
ADSENSE_RESULTS_SLOT_ID=your_results_slot_id

# 4. Update frontend HTML files with your AdSense IDs
```

## 📊 Data Migration

### From localStorage to Database
```bash
# 1. Export existing user data (run in browser console on old site):
migrationHelper.downloadExportedData()

# 2. Upload data to server and migrate:
node backend/scripts/migrate.js localStorage '{"registeredUsers":"[...]"}'

# 3. Verify migration:
node backend/scripts/migrate.js test-data
```

### Database Backup
```bash
# Create backup
pg_dump -h localhost -U imageoptim_user imageoptim_db > backup.sql

# Restore backup
psql -h localhost -U imageoptim_user imageoptim_db < backup.sql
```

## 🔍 Monitoring & Maintenance

### Health Checks
```bash
# Check API health
curl https://your-domain.com/api/health

# Check database connection
docker-compose exec backend node -e "require('./config/database').connectDB().then(() => console.log('DB OK'))"

# Check logs
docker-compose logs -f backend
tail -f /var/log/nginx/access.log
```

### Performance Monitoring
```bash
# Monitor system resources
htop
df -h
free -h

# Monitor database
psql -U imageoptim_user -d imageoptim_db -c "SELECT * FROM pg_stat_activity;"

# Monitor API performance
curl -w "@curl-format.txt" -o /dev/null https://your-domain.com/api/stats/global
```

### Backup Strategy
```bash
# Automated database backup (add to crontab)
0 2 * * * pg_dump -h localhost -U imageoptim_user imageoptim_db | gzip > /backups/imageoptim_$(date +\%Y\%m\%d).sql.gz

# Cleanup old backups (keep 30 days)
find /backups -name "imageoptim_*.sql.gz" -mtime +30 -delete
```

## 🔒 Security

### SSL/HTTPS
```bash
# Force HTTPS redirect in Nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### Firewall Setup
```bash
# Basic firewall rules
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### Database Security
```bash
# Restrict PostgreSQL access
sudo nano /etc/postgresql/14/main/postgresql.conf
# Set: listen_addresses = 'localhost'

sudo nano /etc/postgresql/14/main/pg_hba.conf
# Use md5 authentication for all connections
```

## 📈 Scaling Considerations

### Horizontal Scaling
```yaml
# docker-compose.scale.yml for multiple backend instances
version: '3.8'
services:
  backend:
    scale: 3
  
  nginx:
    image: nginx:alpine
    depends_on:
      - backend
```

### Database Optimization
```sql
-- Add indexes for better performance
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY idx_image_logs_user_date ON image_processing_logs(user_id, created_at);
```

### CDN Integration
```bash
# Configure CDN for static assets
# Update nginx.conf to set proper cache headers
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 🚨 Troubleshooting

### Common Issues

#### Backend Won't Start
```bash
# Check logs
docker-compose logs backend

# Common causes:
# - Database connection failed
# - Missing environment variables
# - Port already in use
```

#### Database Connection Issues
```bash
# Test connection
psql -h localhost -U imageoptim_user -d imageoptim_db

# Check if PostgreSQL is running
sudo systemctl status postgresql
```

#### Stripe Webhook Issues
```bash
# Test webhook endpoint
curl -X POST https://your-domain.com/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check webhook logs in Stripe Dashboard
```

#### High Memory Usage
```bash
# Monitor memory usage
docker stats

# Restart services if needed
docker-compose restart

# Add swap if running out of memory
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## 📞 Support

### Log Collection
```bash
# Collect all logs for debugging
mkdir debug-logs
docker-compose logs > debug-logs/docker.log
sudo journalctl -u nginx > debug-logs/nginx.log
cp /var/log/nginx/*.log debug-logs/
tar -czf debug-logs.tar.gz debug-logs/
```

### Performance Analysis
```bash
# API performance test
ab -n 100 -c 10 https://your-domain.com/api/stats/global

# Database performance
EXPLAIN ANALYZE SELECT * FROM image_processing_logs WHERE created_at > NOW() - INTERVAL '7 days';
```

## ✅ Post-Deployment Checklist

- [ ] SSL certificate installed and working
- [ ] All environment variables configured
- [ ] Database migration completed successfully
- [ ] Stripe webhooks configured and tested
- [ ] Google AdSense ads displaying
- [ ] Email notifications working
- [ ] Backup system configured
- [ ] Monitoring alerts set up
- [ ] Performance tests passed
- [ ] Security scan completed
- [ ] DNS configured correctly
- [ ] CDN configured (if applicable)

## 📋 Maintenance Schedule

### Daily
- Monitor error logs
- Check system resources
- Verify backup completion

### Weekly  
- Update dependencies
- Review performance metrics
- Clean up old logs

### Monthly
- Security updates
- Database optimization
- SSL certificate renewal check
- Cost analysis and optimization

---

🎉 **Congratulations!** Your ImageOptim application is now running in production with full database backend, payment processing, and professional infrastructure.

For additional support, please check the logs and refer to the troubleshooting section above.