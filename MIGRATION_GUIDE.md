# ImageOptim Migration Guide: localStorage to Production Database

This guide helps you migrate from the current localStorage-based system to the production database-backed system.

## 🎯 Overview

The current ImageOptim application stores user data in browser localStorage. The production version uses:
- **PostgreSQL database** for persistent user storage
- **JWT authentication** for secure sessions
- **Stripe integration** for real payment processing
- **Real API backend** instead of browser-only functionality

## 📋 Pre-Migration Checklist

### For Users
- [ ] Export your current user data
- [ ] Note down your login credentials
- [ ] List any premium subscriptions
- [ ] Document your usage history (if important)

### For Administrators
- [ ] Production server ready
- [ ] Database configured
- [ ] API endpoints tested
- [ ] Stripe account configured
- [ ] Backup strategy in place

## 🔄 Migration Process

### Step 1: Export Current Data

#### For Users (Browser Console)
```javascript
// 1. Open your current ImageOptim application
// 2. Open browser Developer Tools (F12)
// 3. Go to Console tab
// 4. Run this command:

migrationHelper.showMigrationInstructions()

// 5. Export your data:
migrationHelper.downloadExportedData()

// This will download a JSON file with your user data
```

#### What Gets Exported
```json
{
  "registeredUsers": "[{\"firstName\":\"John\",\"lastName\":\"Doe\",\"email\":\"john@example.com\",...}]",
  "currentUser": "{\"firstName\":\"John\",\"lastName\":\"Doe\",\"email\":\"john@example.com\",...}",
  "exportDate": "2024-01-15T10:30:00.000Z",
  "version": "1.0"
}
```

### Step 2: Server-Side Migration

#### For Administrators
```bash
# 1. Ensure production environment is ready
cd /path/to/imageoptim
cp .env.production .env
# Edit .env with your production values

# 2. Start the production system
docker-compose up -d

# 3. Run database migration
docker-compose exec backend node scripts/migrate.js schema

# 4. Import user data (using exported JSON file)
docker-compose exec backend node scripts/migrate.js localStorage '{"registeredUsers":"[...]","currentUser":"..."}'

# 5. Verify migration
docker-compose exec backend node scripts/migrate.js test-data
```

### Step 3: Update Frontend

#### Include Production API Client
```html
<!-- Add to your index.html before script.js -->
<script src="frontend-api.js"></script>
<script src="migration-helper.js"></script>
```

#### Test API Connection
```javascript
// Test if the API is working
migrationHelper.testAPIConnection()
```

## 🔧 Migration Scenarios

### Scenario 1: Individual User Migration

**For users who want to migrate their own account:**

```javascript
// 1. In browser console on old site:
const userData = migrationHelper.exportLocalStorageData()

// 2. On new production site, create account manually:
// - Go to registration page
// - Use same email and set new password
// - Data will be fresh (no history migrated)

// 3. Clear old data (after confirming new account works):
migrationHelper.clearLocalStorageData()
```

### Scenario 2: Bulk Admin Migration

**For administrators migrating all users:**

```bash
# 1. Collect all user export files
mkdir user-exports
# Users send their exported JSON files

# 2. Merge all exports into single file
cat > merged-export.json << 'EOF'
{
  "registeredUsers": [
    // Merge all user arrays here
  ]
}
EOF

# 3. Run bulk migration
docker-compose exec backend node scripts/migrate.js localStorage "$(cat merged-export.json)"

# 4. Notify users their accounts are ready
```

### Scenario 3: Gradual Migration

**For phased rollout:**

```javascript
// Phase 1: Both systems running in parallel
// - Old site: localStorage-based
// - New site: API-based
// - Users can test new system while keeping old accounts

// Phase 2: Data migration
// - Export from old system
// - Import to new system
// - Users verify accounts work

// Phase 3: Switch over
// - Update DNS to point to new system
// - Old system becomes read-only
// - Clear old localStorage data
```

## 🔍 Data Mapping

### User Data Structure

#### localStorage Format (Old)
```javascript
{
  firstName: "John",
  lastName: "Doe", 
  email: "john@example.com",
  password: "hashed_password",
  isPremium: false,
  subscriptionType: null,
  registrationDate: "2024-01-01T00:00:00.000Z"
}
```

#### Database Format (New)
```sql
-- users table
id, first_name, last_name, email, password_hash, 
is_premium, subscription_type, subscription_start_date,
subscription_end_date, stripe_customer_id, created_at, updated_at
```

### Subscription Data

#### localStorage (Old)
```javascript
{
  isPremium: true,
  subscriptionType: "monthly",
  subscriptionDate: "2024-01-01T00:00:00.000Z"
}
```

#### Database (New)
```sql
-- Linked to Stripe for real billing
subscription_id, subscription_type, subscription_start_date,
subscription_end_date, stripe_customer_id
```

## ⚠️ Important Considerations

### Password Security
- **Old system**: Passwords stored with basic hashing
- **New system**: Bcrypt with salt rounds for enhanced security
- **Migration**: Users will need to reset passwords or use new secure hashing

### Premium Subscriptions
- **Old system**: Premium status stored locally (not real billing)
- **New system**: Real Stripe subscriptions required
- **Migration**: Previous "premium" users need to subscribe again via Stripe

### Data Loss Prevention
```bash
# Always backup before migration
docker-compose exec postgres pg_dump -U imageoptim_user imageoptim_db > backup_before_migration.sql

# Test migration on copy first
docker-compose exec postgres createdb -U imageoptim_user imageoptim_db_test
docker-compose exec postgres psql -U imageoptim_user imageoptim_db_test < backup_before_migration.sql
```

## 🧪 Testing Migration

### Pre-Migration Tests
```bash
# 1. Test database connection
docker-compose exec backend node -e "require('./config/database').connectDB().then(() => console.log('✅ DB Connected'))"

# 2. Test API endpoints
curl http://localhost:3001/api/health
curl http://localhost:3001/api/stats/global

# 3. Test Stripe integration
curl -X POST http://localhost:3001/api/subscriptions/plans
```

### Post-Migration Tests
```bash
# 1. Verify user count
docker-compose exec postgres psql -U imageoptim_user imageoptim_db -c "SELECT COUNT(*) FROM users;"

# 2. Test user login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# 3. Test image compression
curl -X POST http://localhost:3001/api/images/compress \
  -F "images=@test-image.jpg" \
  -F "quality=80"
```

### Rollback Plan
```bash
# If migration fails, rollback:
# 1. Stop new system
docker-compose down

# 2. Restore database backup
docker-compose exec postgres psql -U imageoptim_user imageoptim_db < backup_before_migration.sql

# 3. Keep old system running until issues resolved
```

## 📊 Migration Monitoring

### User Communication
```markdown
## Migration Notice Template

Subject: ImageOptim System Upgrade - Action Required

Dear ImageOptim User,

We're upgrading to a more powerful system with:
✅ Real payment processing
✅ Better performance  
✅ Enhanced security
✅ Cloud backup

**Action Required:**
1. Export your data: [link to guide]
2. Create new account on: [new URL]
3. Contact support if you need help

Timeline: [dates]
Support: [contact info]
```

### Progress Tracking
```bash
# Monitor migration progress
echo "Users in localStorage exports: $(grep -o '"email"' exports/*.json | wc -l)"
echo "Users in database: $(docker-compose exec postgres psql -U imageoptim_user imageoptim_db -t -c 'SELECT COUNT(*) FROM users;')"
echo "Active sessions: $(docker-compose exec postgres psql -U imageoptim_user imageoptim_db -t -c 'SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW();')"
```

## 🔧 Troubleshooting

### Common Migration Issues

#### Duplicate Email Errors
```bash
# Check for duplicate emails in export
jq -r '.registeredUsers | fromjson | .[].email' export.json | sort | uniq -d

# Resolution: Manual cleanup before migration
```

#### Password Hash Issues
```bash
# Users may need to reset passwords
# Provide password reset functionality:
curl -X POST /api/auth/forgot-password -d '{"email":"user@example.com"}'
```

#### Premium Status Confusion
```bash
# Communicate clearly about premium status:
# - Old premium was local-only
# - New premium requires real Stripe subscription
# - Offer migration discount/trial period
```

## ✅ Post-Migration Cleanup

### User Cleanup
```javascript
// After confirming migration worked:
// 1. Clear localStorage on old domain
localStorage.clear()

// 2. Update bookmarks to new domain
// 3. Inform users to use new URL
```

### Server Cleanup
```bash
# Clean up migration files
rm -rf user-exports/
rm merged-export.json
rm backup_before_migration.sql

# Archive old data
tar -czf migration-archive-$(date +%Y%m%d).tar.gz migration-logs/
```

## 📞 Support During Migration

### User Support Checklist
- [ ] Migration guide published
- [ ] Support email available
- [ ] FAQ updated with migration info
- [ ] Video tutorial created (optional)
- [ ] Timeline communicated clearly

### Technical Support
```bash
# Common support commands
docker-compose logs backend | grep ERROR
docker-compose exec postgres psql -U imageoptim_user imageoptim_db -c "SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 10;"
```

---

## 🎉 Migration Complete!

Once migration is finished:
1. ✅ All users can log in to new system
2. ✅ Premium subscriptions working via Stripe  
3. ✅ Image compression using backend API
4. ✅ All data properly migrated and backed up
5. ✅ Old localStorage data cleared

**Congratulations!** You've successfully migrated from localStorage to a production-grade database system.

For ongoing maintenance, refer to the [Production Deployment Guide](PRODUCTION_DEPLOYMENT.md).