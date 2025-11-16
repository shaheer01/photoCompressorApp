# 🚀 Photo Compressor - VM Deployment Guide

Complete guide for deploying Photo Compressor to your existing GCP VM (`pulse-point-dashboard01`)

---

## 📋 Prerequisites

- [x] GCP VM running (`pulse-point-dashboard01` in `us-central1-c`)
- [x] SSH access to the VM
- [x] `gcloud` CLI installed locally
- [x] Netlify account for frontend deployment

---

## 🎯 Quick Start (3 Steps)

### **Step 1: Setup VM (One-Time)**

```bash
# Upload setup script to VM
gcloud compute scp setup-vm.sh pulse-point-dashboard01:/tmp/ --zone=us-central1-c

# Run setup on VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="bash /tmp/setup-vm.sh"
```

This installs:
- Node.js 18
- PM2 process manager
- System dependencies (Sharp, ImageMagick)
- Nginx configuration
- Firewall rules

### **Step 2: Deploy Backend**

```bash
./deploy-backend-vm.sh
```

This will:
- Package your backend code
- Upload to VM
- Install dependencies
- Restart the application with PM2

### **Step 3: Deploy Frontend**

```bash
./deploy-netlify.sh
```

**Done!** Your app is deployed. 🎉

---

## 📦 Deployment Scripts Overview

### **setup-vm.sh** (Run once)
- Prepares the VM environment
- Installs all required software
- Configures Nginx reverse proxy
- Sets up PM2 for process management

### **deploy-backend-vm.sh** (Run on each update)
- Packages backend code
- Deploys to VM via SSH
- Restarts application
- Checks health status

### **deploy-netlify.sh** (Run on each frontend update)
- Prepares frontend files
- Deploys to Netlify
- Updates configuration

### **deploy-all.sh** (Convenience script)
- Deploys both backend and frontend
- One command deployment

---

## 🔧 Detailed Setup Instructions

### **1. VM Setup (First Time Only)**

#### Option A: Automated Script

```bash
# Make script executable
chmod +x setup-vm.sh

# Upload to VM
gcloud compute scp setup-vm.sh pulse-point-dashboard01:/tmp/ --zone=us-central1-c

# Run on VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="bash /tmp/setup-vm.sh"
```

#### Option B: Manual Setup

Connect to VM:
```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c
```

Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Install dependencies:
```bash
sudo apt-get install -y build-essential python3 libvips-dev imagemagick
```

Install PM2:
```bash
sudo npm install -g pm2
sudo pm2 startup systemd
```

Create app directory:
```bash
sudo mkdir -p /var/www/photo-compressor-backend
sudo chown -R www-data:www-data /var/www/photo-compressor-backend
```

### **2. Configure Environment Variables**

After first deployment, configure the `.env` file on the VM:

```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c
sudo nano /var/www/photo-compressor-backend/.env
```

Add your configuration:
```env
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://user:password@host:port/database

# JWT
JWT_SECRET=your_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# Stripe (optional)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`)

### **3. Deploy Backend**

```bash
# Make script executable
chmod +x deploy-backend-vm.sh

# Deploy
./deploy-backend-vm.sh
```

The script will:
1. Test connection to VM
2. Create deployment package
3. Upload to VM
4. Extract and install
5. Restart with PM2
6. Check health status

### **4. Configure Nginx (Optional but Recommended)**

If using a custom domain (e.g., `api.compressphotos.cloud`):

```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c
```

Create Nginx config:
```bash
sudo nano /etc/nginx/sites-available/photo-compressor
```

Add configuration:
```nginx
server {
    listen 80;
    server_name api.compressphotos.cloud;

    client_max_body_size 100M;

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
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/photo-compressor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### **5. Set up SSL/HTTPS**

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d api.compressphotos.cloud

# Auto-renewal is configured automatically
```

### **6. Deploy Frontend**

```bash
chmod +x deploy-netlify.sh
./deploy-netlify.sh
```

Follow the prompts to authenticate and deploy.

---

## 🔄 Regular Updates

### **Update Backend Only**

```bash
./deploy-backend-vm.sh
```

### **Update Frontend Only**

```bash
./deploy-netlify.sh
```

### **Update Both**

```bash
./deploy-all.sh
```

---

## 📊 Monitoring & Logs

### **View Backend Logs**

```bash
# Real-time logs
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 logs photo-compressor-backend"

# Recent logs
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 logs photo-compressor-backend --lines 100"
```

### **Check Application Status**

```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 status"
```

### **Restart Application**

```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 restart photo-compressor-backend"
```

### **View System Resources**

```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 monit"
```

---

## 🧪 Testing Deployment

### **Test Backend Health**

```bash
# From your local machine
curl https://api.compressphotos.cloud/health

# Expected response:
# {"status":"ok"}
```

### **Test Image Compression**

```bash
curl -X POST https://api.compressphotos.cloud/api/images/compress \
  -F "images=@test-image.jpg" \
  -F "quality=80"
```

### **Test Frontend**

1. Visit: `https://compressphotos.cloud`
2. Upload an image
3. Compress it
4. Check browser console for errors
5. Test VISA generator: `https://compressphotos.cloud/schengen-visa-photo.html`

---

## 🔐 Security Checklist

- [ ] SSL/HTTPS enabled (certbot)
- [ ] Firewall configured (UFW)
- [ ] Environment variables secured (.env not in git)
- [ ] PM2 running as non-root user
- [ ] Nginx security headers configured
- [ ] Database credentials secured
- [ ] Regular backups enabled

---

## 🆘 Troubleshooting

### **Cannot connect to VM**

```bash
# Check if VM is running
gcloud compute instances list

# Start VM if stopped
gcloud compute instances start pulse-point-dashboard01 --zone=us-central1-c
```

### **Application not starting**

```bash
# SSH into VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c

# Check PM2 logs
sudo pm2 logs photo-compressor-backend

# Check for errors
sudo pm2 describe photo-compressor-backend
```

### **Port 3001 not accessible**

```bash
# Check firewall
sudo ufw status

# Allow port if needed
sudo ufw allow 3001/tcp

# Check if app is running
sudo netstat -tlnp | grep 3001
```

### **Nginx errors**

```bash
# Test config
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log

# Restart nginx
sudo systemctl restart nginx
```

### **Out of memory**

```bash
# Check memory usage
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="free -h"

# Increase swap if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 📁 VM Directory Structure

```
/var/www/photo-compressor-backend/
├── current/              # Active deployment
│   ├── server.js
│   ├── package.json
│   ├── routes/
│   ├── middleware/
│   ├── logs/
│   └── uploads/
├── current.old/          # Previous deployment (backup)
├── .env                  # Environment variables
└── current.backup.*/     # Timestamped backups
```

---

## 🔗 Useful Commands Reference

```bash
# Deploy backend
./deploy-backend-vm.sh

# Deploy frontend
./deploy-netlify.sh

# Deploy both
./deploy-all.sh

# SSH to VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c

# View logs
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="sudo pm2 logs"

# Restart app
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="sudo pm2 restart photo-compressor-backend"

# Check status
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="sudo pm2 status"

# Update .env
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="sudo nano /var/www/photo-compressor-backend/.env"
```

---

## 💰 Cost Considerations

**GCP Compute Engine VM:**
- Running cost depends on VM size
- Use `gcloud compute instances list` to see machine type
- Consider stopping VM when not in use for development

**Netlify:**
- Free tier: 100GB bandwidth/month
- Free automatic HTTPS
- Free continuous deployment

---

## 🎉 Success!

Your Photo Compressor is now deployed!

- **Frontend:** https://compressphotos.cloud
- **Backend API:** https://api.compressphotos.cloud
- **VISA Generator:** https://compressphotos.cloud/schengen-visa-photo.html

---

## 📞 Support

- Check logs first: `gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c --command="sudo pm2 logs"`
- Review this guide: `DEPLOYMENT-VM.md`
- Check nginx logs: `sudo tail -f /var/log/nginx/error.log`
