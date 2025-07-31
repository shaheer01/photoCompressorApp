const fs = require('fs');
const path = require('path');
const { query, connectDB, closeDB } = require('../config/database');
const logger = require('../utils/logger');

async function runMigration() {
    try {
        console.log('🚀 Starting database migration...');
        
        // Connect to database
        await connectDB();
        console.log('✅ Connected to database');

        // Read and execute schema
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📋 Executing database schema...');
        await query(schema);
        console.log('✅ Schema applied successfully');

        // Check if tables exist
        const tablesResult = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);

        console.log('📊 Created tables:');
        tablesResult.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });

        // Insert default admin settings if they don't exist
        const settingsCount = await query('SELECT COUNT(*) FROM admin_settings');
        if (parseInt(settingsCount.rows[0].count) === 0) {
            console.log('⚙️ Inserting default admin settings...');
            await query(`
                INSERT INTO admin_settings (setting_key, setting_value, description) VALUES
                ('max_file_size_free_mb', '10', 'Maximum file size for free users in MB'),
                ('max_file_size_premium_mb', '100', 'Maximum file size for premium users in MB'),
                ('max_files_per_batch_free', '5', 'Maximum files per batch for free users'),
                ('max_files_per_batch_premium', '50', 'Maximum files per batch for premium users'),
                ('stripe_monthly_price_id', 'price_monthly_placeholder', 'Stripe price ID for monthly subscription'),
                ('stripe_yearly_price_id', 'price_yearly_placeholder', 'Stripe price ID for yearly subscription'),
                ('monthly_price_cents', '999', 'Monthly subscription price in cents'),
                ('yearly_price_cents', '9999', 'Yearly subscription price in cents')
            `);
            console.log('✅ Default settings inserted');
        } else {
            console.log('⚙️ Admin settings already exist, skipping...');
        }

        console.log('🎉 Migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await closeDB();
    }
}

// Data migration from localStorage to database
async function migrateLocalStorageData(localStorageData) {
    try {
        console.log('🔄 Starting localStorage data migration...');
        
        if (!localStorageData || !localStorageData.registeredUsers) {
            console.log('⚠️ No localStorage data provided for migration');
            return;
        }

        const bcrypt = require('bcryptjs');
        const users = JSON.parse(localStorageData.registeredUsers);
        
        console.log(`📊 Found ${users.length} users to migrate`);

        for (const user of users) {
            try {
                // Check if user already exists
                const existingUser = await query(
                    'SELECT id FROM users WHERE email = $1',
                    [user.email]
                );

                if (existingUser.rows.length > 0) {
                    console.log(`⚠️ User ${user.email} already exists, skipping...`);
                    continue;
                }

                // Hash password if not already hashed
                let passwordHash = user.password;
                if (!passwordHash.startsWith('$2')) {
                    passwordHash = await bcrypt.hash(user.password, 12);
                }

                // Insert user
                const userResult = await query(
                    `INSERT INTO users 
                     (first_name, last_name, email, password_hash, is_premium, 
                      subscription_type, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                     RETURNING id`,
                    [
                        user.firstName || user.first_name,
                        user.lastName || user.last_name,
                        user.email,
                        passwordHash,
                        user.isPremium || false,
                        user.subscriptionType || null,
                        user.registrationDate || new Date()
                    ]
                );

                const userId = userResult.rows[0].id;

                // Initialize usage statistics
                await query(
                    `INSERT INTO usage_statistics 
                     (user_id, date, images_processed, total_original_size_mb, 
                      total_compressed_size_mb, total_savings_mb)
                     VALUES ($1, CURRENT_DATE, 0, 0, 0, 0)
                     ON CONFLICT (user_id, date) DO NOTHING`,
                    [userId]
                );

                console.log(`✅ Migrated user: ${user.email}`);

            } catch (userError) {
                console.error(`❌ Failed to migrate user ${user.email}:`, userError.message);
            }
        }

        console.log('🎉 localStorage data migration completed!');

    } catch (error) {
        console.error('❌ localStorage migration failed:', error);
        throw error;
    }
}

// Create test data
async function createTestData() {
    try {
        console.log('🧪 Creating test data...');
        
        const bcrypt = require('bcryptjs');
        
        // Create test user
        const testEmail = 'test@imageoptim.com';
        const existingUser = await query(
            'SELECT id FROM users WHERE email = $1',
            [testEmail]
        );

        if (existingUser.rows.length === 0) {
            const passwordHash = await bcrypt.hash('Test123!@#', 12);
            
            const userResult = await query(
                `INSERT INTO users 
                 (first_name, last_name, email, password_hash, is_premium, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 RETURNING id`,
                ['Test', 'User', testEmail, passwordHash, false]
            );

            const userId = userResult.rows[0].id;

            // Add some test usage statistics
            await query(
                `INSERT INTO usage_statistics 
                 (user_id, date, images_processed, total_original_size_mb, 
                  total_compressed_size_mb, total_savings_mb)
                 VALUES 
                 ($1, CURRENT_DATE, 5, 25.5, 12.3, 13.2),
                 ($1, CURRENT_DATE - INTERVAL '1 day', 3, 15.2, 8.1, 7.1),
                 ($1, CURRENT_DATE - INTERVAL '2 days', 8, 42.1, 20.5, 21.6)`,
                [userId]
            );

            console.log(`✅ Created test user: ${testEmail} / Test123!@#`);
        } else {
            console.log('⚠️ Test user already exists, skipping...');
        }

        console.log('🎉 Test data creation completed!');

    } catch (error) {
        console.error('❌ Test data creation failed:', error);
        throw error;
    }
}

// Main migration function
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'schema':
            await runMigration();
            break;
            
        case 'test-data':
            await connectDB();
            await createTestData();
            await closeDB();
            break;
            
        case 'localStorage':
            if (!args[1]) {
                console.error('❌ Please provide localStorage data as JSON string');
                console.log('Usage: node migrate.js localStorage \'{"registeredUsers":"[...]"}\'');
                process.exit(1);
            }
            
            try {
                const localStorageData = JSON.parse(args[1]);
                await connectDB();
                await migrateLocalStorageData(localStorageData);
                await closeDB();
            } catch (parseError) {
                console.error('❌ Invalid JSON data provided');
                process.exit(1);
            }
            break;
            
        case 'full':
            await runMigration();
            await connectDB();
            await createTestData();
            await closeDB();
            break;
            
        default:
            console.log('📋 Available migration commands:');
            console.log('  schema      - Run database schema migration');
            console.log('  test-data   - Create test data');
            console.log('  localStorage - Migrate localStorage data (requires JSON data)');
            console.log('  full        - Run schema migration and create test data');
            console.log('');
            console.log('Examples:');
            console.log('  node migrate.js schema');
            console.log('  node migrate.js test-data');
            console.log('  node migrate.js full');
            console.log('  node migrate.js localStorage \'{"registeredUsers":"[...]"}\'');
            break;
    }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

// Run migration
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    });
}

module.exports = {
    runMigration,
    migrateLocalStorageData,
    createTestData
};