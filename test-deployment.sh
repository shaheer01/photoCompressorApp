#!/bin/bash

# Test deployment script for ImageOptim
# This script tests the deployment before running it

set -e

echo "🧪 ImageOptim Deployment Test"
echo "=============================="

# Test 1: Check Docker and Docker Compose
echo "🐳 Testing Docker installation..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi
echo "✅ Docker: $(docker --version)"

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi
echo "✅ Docker Compose: $(docker-compose --version)"

# Test 2: Check if .env file exists
echo ""
echo "⚙️  Testing environment configuration..."
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating test environment..."
    cat > .env << EOF
NODE_ENV=development
DB_NAME=imageoptim_db
DB_USER=imageoptim_user
DB_PASSWORD=test_password_123
JWT_SECRET=test_jwt_secret_32_characters_long
JWT_REFRESH_SECRET=test_refresh_secret_32_chars_long
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
SMTP_HOST=smtp.gmail.com
SMTP_USER=test@example.com
SMTP_PASS=test_password
FRONTEND_URL=http://localhost
BACKEND_URL=http://localhost:3001
EOF
    echo "✅ Test .env file created"
else
    echo "✅ .env file exists"
fi

# Test 3: Build backend image
echo ""
echo "🏗️  Testing backend Docker build..."
if docker build -f backend/Dockerfile backend/ -t imageoptim-backend-test -q > /dev/null; then
    echo "✅ Backend Docker build successful"
    docker rmi imageoptim-backend-test > /dev/null 2>&1
else
    echo "❌ Backend Docker build failed"
    exit 1
fi

# Test 4: Build frontend image
echo ""
echo "🌐 Testing frontend Docker build..."
if docker build -f Dockerfile.frontend . -t imageoptim-frontend-test -q > /dev/null; then
    echo "✅ Frontend Docker build successful" 
    docker rmi imageoptim-frontend-test > /dev/null 2>&1
else
    echo "❌ Frontend Docker build failed"
    exit 1
fi

# Test 5: Check required files
echo ""
echo "📁 Testing required files..."
required_files=(
    "index.html"
    "styles.css" 
    "script.js"
    "frontend-api.js"
    "docker-compose.yml"
    "backend/server.js"
    "backend/package.json"
    "backend/package-lock.json"
    "nginx/nginx.conf"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

# Test 6: Check network ports
echo ""
echo "🌐 Testing network ports..."
if lsof -i :80 > /dev/null 2>&1; then
    echo "⚠️  Port 80 is already in use"
    echo "   You may need to stop the service using port 80"
fi

if lsof -i :3001 > /dev/null 2>&1; then
    echo "⚠️  Port 3001 is already in use"
    echo "   You may need to stop the service using port 3001"
fi

if lsof -i :5432 > /dev/null 2>&1; then
    echo "⚠️  Port 5432 is already in use"
    echo "   You may need to stop PostgreSQL or change the port"
fi

# Test 7: Check available disk space
echo ""
echo "💾 Testing disk space..."
available_space=$(df . | tail -1 | awk '{print $4}')
if [ "$available_space" -lt 2000000 ]; then
    echo "⚠️  Low disk space. You may need at least 2GB free space"
else
    echo "✅ Sufficient disk space available"
fi

echo ""
echo "🎉 All tests passed!"
echo ""
echo "🚀 Ready to deploy! Run:"
echo "   ./deploy.sh init"
echo ""
echo "📊 After deployment, check status with:"
echo "   ./deploy.sh status"