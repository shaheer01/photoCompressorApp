// Client-side migration helper for ImageOptim
// This script helps users export their localStorage data for migration

class MigrationHelper {
    constructor() {
        this.exportedData = null;
    }

    // Export localStorage data
    exportLocalStorageData() {
        const data = {
            registeredUsers: localStorage.getItem('registeredUsers') || '[]',
            currentUser: localStorage.getItem('currentUser') || null,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        this.exportedData = data;
        return data;
    }

    // Download exported data as JSON file
    downloadExportedData() {
        if (!this.exportedData) {
            this.exportLocalStorageData();
        }

        const jsonString = JSON.stringify(this.exportedData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `imageoptim-data-export-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('✅ Data exported successfully!');
        return jsonString;
    }

    // Check if user has data to migrate
    hasDataToMigrate() {
        const registeredUsers = localStorage.getItem('registeredUsers');
        const currentUser = localStorage.getItem('currentUser');
        
        return !!(registeredUsers || currentUser);
    }

    // Get migration statistics
    getMigrationStats() {
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
        
        return {
            totalUsers: registeredUsers.length,
            hasCurrentUser: !!currentUser,
            currentUserEmail: currentUser?.email || null,
            premiumUsers: registeredUsers.filter(user => user.isPremium).length,
            oldestUser: registeredUsers.length > 0 ? 
                registeredUsers.reduce((oldest, user) => 
                    new Date(user.registrationDate || 0) < new Date(oldest.registrationDate || 0) ? user : oldest
                ) : null
        };
    }

    // Clear localStorage after successful migration
    clearLocalStorageData() {
        const confirmed = confirm(
            '⚠️ This will permanently delete all local user data.\n\n' +
            'Only proceed if you have successfully migrated to the production system.\n\n' +
            'Are you sure you want to continue?'
        );

        if (confirmed) {
            localStorage.removeItem('registeredUsers');
            localStorage.removeItem('currentUser');
            console.log('✅ Local storage data cleared');
            return true;
        }

        return false;
    }

    // Show migration instructions
    showMigrationInstructions() {
        const stats = this.getMigrationStats();
        
        console.log('📋 ImageOptim Data Migration Instructions');
        console.log('========================================');
        console.log('');
        console.log('📊 Migration Statistics:');
        console.log(`  • Total users to migrate: ${stats.totalUsers}`);
        console.log(`  • Premium users: ${stats.premiumUsers}`);
        console.log(`  • Current user: ${stats.currentUserEmail || 'None'}`);
        console.log('');
        console.log('🚀 Steps to migrate:');
        console.log('1. Run: migrationHelper.downloadExportedData()');
        console.log('2. Send the downloaded file to your server administrator');
        console.log('3. Administrator runs: node migrate.js localStorage \'<file-content>\'');
        console.log('4. Test login on the new production system');
        console.log('5. Run: migrationHelper.clearLocalStorageData() (after confirming migration works)');
        console.log('');
        console.log('⚠️ Important: Do not clear local data until you verify the migration worked!');
    }

    // Test API connectivity
    async testAPIConnection() {
        try {
            const response = await fetch('/api/stats/global');
            const data = await response.json();
            
            console.log('✅ API connection successful');
            console.log('📊 Server statistics:', data);
            return true;
        } catch (error) {
            console.error('❌ API connection failed:', error);
            console.log('Please ensure the production API server is running');
            return false;
        }
    }

    // Migrate user account via API (alternative to admin migration)
    async migrateUserAccount(email, password) {
        try {
            console.log('🔄 Attempting to create account via API...');
            
            // Find user in localStorage
            const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            const user = registeredUsers.find(u => u.email === email);
            
            if (!user) {
                throw new Error('User not found in localStorage');
            }

            // Try to register via API
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    password: password
                })
            });

            const result = await response.json();
            
            if (response.ok) {
                console.log('✅ Account migrated successfully via API');
                console.log('🔑 You can now log in with your credentials');
                return result;
            } else {
                console.error('❌ API migration failed:', result.error);
                return null;
            }
            
        } catch (error) {
            console.error('❌ Migration error:', error);
            return null;
        }
    }
}

// Create global instance
window.migrationHelper = new MigrationHelper();

// Auto-check for migration data on page load
document.addEventListener('DOMContentLoaded', () => {
    if (window.migrationHelper.hasDataToMigrate()) {
        console.log('📦 Local user data detected');
        console.log('Run migrationHelper.showMigrationInstructions() for migration help');
    }
});

// Export for use in other files
window.MigrationHelper = MigrationHelper;