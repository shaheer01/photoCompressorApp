#!/bin/bash

# Photo Compressor - Local Deployment Commands
# Copy and paste these commands in your Mac terminal

echo "🚀 Photo Compressor Deployment Guide"
echo "====================================="
echo ""
echo "Run these commands on your Mac:"
echo ""

cat << 'EOF'

# Step 1: Navigate to your project
cd /Users/shaheer.m/Downloads/PersonalRepo/photoCompressorApp

# Step 2: Pull latest changes from GitHub
git fetch origin
git checkout claude/improve-compression-accuracy-019cMQUdhBF47ZsxbjKhmQfs
git pull origin claude/improve-compression-accuracy-019cMQUdhBF47ZsxbjKhmQfs

# Step 3: Make scripts executable (if needed)
chmod +x deploy-complete.sh deploy-backend-vm.sh deploy-netlify.sh setup-vm.sh

# Step 4: Run the complete deployment
./deploy-complete.sh

# That's it! The script will:
# - Check VM connection
# - Setup environment
# - Deploy backend to pulse-point-dashboard01
# - Configure Nginx & SSL
# - Deploy frontend to Netlify
# - Test deployment

EOF

echo ""
echo "Copy the commands above and run them in your Mac terminal!"
echo ""
