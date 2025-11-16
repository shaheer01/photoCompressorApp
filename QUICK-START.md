# 🚀 Photo Compressor - Quick Start Deployment

**Deploy in 1 command!** Everything you need to deploy Photo Compressor to your existing VM.

---

## ⚡ Super Quick Deploy (1 Command)

```bash
./deploy-complete.sh
```

**That's it!** The script handles everything:
- ✅ Checks VM connection
- ✅ Sets up environment
- ✅ Deploys backend
- ✅ Configures Nginx & SSL
- ✅ Deploys frontend
- ✅ Tests deployment

---

## 📋 Prerequisites

- [x] VM `pulse-point-dashboard01` is running
- [x] You have `gcloud` CLI installed locally
- [x] SSH access to the VM
- [x] Nginx already configured on VM (for pulse-point-dashboard)

---

## 🎯 What Gets Deployed

### **Backend → VM**
- Deployed to: `/var/www/photo-compressor-backend`
- Running on: `localhost:3001` (PM2)
- Proxied via: Nginx
- Domain: `https://api.compressphotos.cloud`

### **Frontend → Netlify**
- Domain: `https://compressphotos.cloud`
- CDN: Netlify global CDN
- SSL: Automatic HTTPS

---

## 🔧 After Deployment

### **1. Configure Environment Variables**

```bash
# SSH to VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c

# Edit .env
sudo nano /var/www/photo-compressor-backend/.env
```

**Important variables to update:**
```env
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=your_random_secret_here
JWT_REFRESH_SECRET=another_random_secret_here
```

### **2. Restart Backend**

```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 restart photo-compressor-backend"
```

### **3. Test Everything**

```bash
# Test backend
curl https://api.compressphotos.cloud/health

# Visit frontend
open https://compressphotos.cloud

# Test VISA generator
open https://compressphotos.cloud/schengen-visa-photo.html
```

---

## 📊 Useful Commands

### **View Logs**
```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 logs photo-compressor-backend"
```

### **Check Status**
```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 status"
```

### **Restart App**
```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 restart photo-compressor-backend"
```

### **SSH to VM**
```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c
```

### **View Nginx Logs**
```bash
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo tail -f /var/log/nginx/photo-compressor-error.log"
```

---

## 🔄 Regular Updates

### **Update Backend**
```bash
./deploy-backend-vm.sh
```

### **Update Frontend**
```bash
./deploy-netlify.sh
```

### **Update Both**
```bash
./deploy-complete.sh
```

---

## 🆘 Troubleshooting

### **Backend not responding**

```bash
# Check if app is running
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 list"

# Check logs
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 logs photo-compressor-backend --lines 50"

# Restart
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo pm2 restart photo-compressor-backend"
```

### **Nginx errors**

```bash
# Test config
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo nginx -t"

# Reload nginx
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo systemctl reload nginx"

# Check error logs
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c \
  --command="sudo tail -f /var/log/nginx/error.log"
```

### **SSL certificate issues**

```bash
# SSH to VM
gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-c

# Manually run certbot
sudo certbot --nginx -d api.compressphotos.cloud

# Check certificate status
sudo certbot certificates
```

---

## 📁 File Structure on VM

```
/var/www/photo-compressor-backend/
├── current/              # Active deployment
│   ├── server.js
│   ├── routes/
│   ├── package.json
│   ├── logs/
│   └── uploads/
├── current.old/          # Previous version (backup)
├── .env                  # Environment variables
└── current.backup.*/     # Timestamped backups
```

---

## ✅ Post-Deployment Checklist

- [ ] Backend health check passes: `curl https://api.compressphotos.cloud/health`
- [ ] Frontend loads: `https://compressphotos.cloud`
- [ ] Image compression works
- [ ] VISA photo generator works
- [ ] Background removal works
- [ ] All pages load correctly
- [ ] SSL certificate is valid
- [ ] Environment variables configured
- [ ] PM2 process is running
- [ ] Logs are accessible

---

## 🎉 Success!

Your Photo Compressor is now live!

**URLs:**
- Backend: https://api.compressphotos.cloud
- Frontend: https://compressphotos.cloud
- VISA: https://compressphotos.cloud/schengen-visa-photo.html

---

## 📚 More Documentation

- **Complete Guide:** `DEPLOYMENT-VM.md`
- **Cloud Run Option:** `DEPLOYMENT.md`
- **Scripts:**
  - `deploy-complete.sh` - Full deployment
  - `deploy-backend-vm.sh` - Backend only
  - `deploy-netlify.sh` - Frontend only
  - `setup-vm.sh` - Initial VM setup
