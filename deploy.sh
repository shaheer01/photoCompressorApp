#!/bin/bash

# ImageOptim Production Deployment Script
# This script helps deploy the ImageOptim application with Docker

set -e

echo "🚀 ImageOptim Production Deployment"
echo "======================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.production .env
    echo "📝 Please edit .env file with your configuration values:"
    echo "   - Database credentials"
    echo "   - JWT secrets"
    echo "   - Stripe keys"
    echo "   - Email settings"
    echo ""
    echo "After editing .env, run this script again."
    exit 0
fi

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p logs/nginx
mkdir -p backend/logs
mkdir -p backend/uploads

# Check if this is first time setup
if [ "$1" = "init" ]; then
    echo "🔧 Initial setup mode..."
    
    # Build and start services
    echo "🏗️  Building containers..."
    docker-compose build
    
    echo "🚀 Starting services..."
    docker-compose up -d
    
    # Wait for database to be ready
    echo "⏳ Waiting for database to be ready..."
    sleep 10
    
    # Run database migration
    echo "📊 Running database migration..."
    docker-compose exec backend node scripts/migrate.js full
    
    echo "✅ Initial setup complete!"
    
elif [ "$1" = "update" ]; then
    echo "🔄 Update mode..."
    
    # Pull latest changes and rebuild
    docker-compose down
    docker-compose build
    docker-compose up -d
    
    echo "✅ Update complete!"
    
elif [ "$1" = "migrate" ]; then
    echo "📊 Running database migration..."
    docker-compose exec backend node scripts/migrate.js schema
    echo "✅ Migration complete!"
    
elif [ "$1" = "backup" ]; then
    echo "💾 Creating database backup..."
    timestamp=$(date +%Y%m%d_%H%M%S)
    docker-compose exec postgres pg_dump -U imageoptim_user imageoptim_db > "backup_${timestamp}.sql"
    echo "✅ Backup created: backup_${timestamp}.sql"
    
elif [ "$1" = "logs" ]; then
    echo "📋 Showing application logs..."
    docker-compose logs -f
    
elif [ "$1" = "status" ]; then
    echo "📊 System Status:"
    echo "=================="
    docker-compose ps
    echo ""
    echo "🌐 Health Checks:"
    echo "Frontend: http://localhost"
    echo "Backend API: http://localhost/api/health"
    echo "Database: $(docker-compose exec postgres pg_isready -U imageoptim_user -d imageoptim_db 2>/dev/null && echo "✅ Connected" || echo "❌ Not available")"
    
elif [ "$1" = "stop" ]; then
    echo "🛑 Stopping services..."
    docker-compose down
    echo "✅ Services stopped!"
    
elif [ "$1" = "restart" ]; then
    echo "🔄 Restarting services..."
    docker-compose restart
    echo "✅ Services restarted!"
    
elif [ "$1" = "clean" ]; then
    echo "⚠️  This will remove all containers and data. Are you sure? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo "🧹 Cleaning up..."
        docker-compose down -v
        docker system prune -f
        echo "✅ Cleanup complete!"
    else
        echo "❌ Cleanup cancelled."
    fi
    
else
    echo "📋 Usage: $0 [command]"
    echo ""
    echo "Available commands:"
    echo "  init     - Initial setup and deployment"
    echo "  update   - Update and redeploy"
    echo "  migrate  - Run database migration"
    echo "  backup   - Create database backup"
    echo "  logs     - Show application logs"
    echo "  status   - Show system status"
    echo "  stop     - Stop all services"
    echo "  restart  - Restart all services"
    echo "  clean    - Remove all containers and data"
    echo ""
    echo "Examples:"
    echo "  $0 init      # First time setup"
    echo "  $0 status    # Check if everything is running"
    echo "  $0 logs      # View application logs"
    echo "  $0 backup    # Create a database backup"
    
fi

echo ""
echo "🎉 Done!"