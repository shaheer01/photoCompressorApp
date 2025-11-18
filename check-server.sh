#!/bin/bash

# Check server status for pulse-point-dashboard01
# Run this on your Mac

echo "🔍 Checking pulse-point-dashboard01 server status..."
echo "=================================================="
echo ""

gcloud compute ssh pulse-point-dashboard01 --zone=us-central1-a --command="bash -s" << 'EOF'
echo "=== Server Status Check ==="
echo ""
echo "1. Node.js Version:"
node --version 2>&1 || echo "❌ Not installed"
echo ""
echo "2. PM2 Version:"
pm2 --version 2>&1 || echo "❌ Not installed"
echo ""
echo "3. Nginx Version:"
nginx -v 2>&1 || echo "❌ Not installed"
echo ""
echo "4. PM2 Running Processes:"
sudo pm2 list 2>&1 || echo "❌ PM2 not running"
echo ""
echo "5. Applications in /var/www/:"
ls -la /var/www/ 2>&1 || echo "❌ Directory not found"
echo ""
echo "6. Port 3001 Status:"
sudo netstat -tlnp | grep 3001 || echo "ℹ️  Nothing running on port 3001"
echo ""
echo "7. Nginx Enabled Sites:"
ls -la /etc/nginx/sites-enabled/ 2>&1 || echo "❌ Nginx not configured"
echo ""
echo "8. Photo Compressor Backend:"
if [ -d /var/www/photo-compressor-backend ]; then
    echo "✅ Directory exists:"
    ls -la /var/www/photo-compressor-backend/
else
    echo "❌ Not deployed yet"
fi
echo ""
echo "9. Pulse Point Dashboard:"
if [ -d /var/www/pulse-point-dashboard ]; then
    echo "✅ Directory exists"
    ls -la /var/www/pulse-point-dashboard/ | head -5
else
    echo "ℹ️  Directory not found"
fi
echo ""
echo "10. System Resources:"
free -h
echo ""
echo "11. Disk Usage:"
df -h / | tail -1
EOF

echo ""
echo "✅ Server check complete!"
