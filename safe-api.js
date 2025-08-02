// Safe API client - won't break if backend is unavailable
class SafeAPIClient {
    constructor() {
        this.baseURL = 'http://localhost:3001/api';
        this.available = false;
        this.token = localStorage.getItem('accessToken');
        this.connectionTested = false;
        
        // Test if API is available
        this.testConnection();
    }
    
    async testConnection() {
        try {
            console.log('🔍 Testing API connection to http://localhost:3001/health...');
            const response = await fetch('http://localhost:3001/health', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                mode: 'cors'
            });
            this.available = response.ok;
            this.connectionTested = true;
            console.log('✅ API availability test result:', this.available);
        } catch (error) {
            this.available = false;
            this.connectionTested = true;
            console.log('⚠️ API not available, using localStorage only:', error.message);
        }
    }
    
    async ensureConnectionTested() {
        // Wait for connection test to complete if it hasn't yet
        let attempts = 0;
        while (!this.connectionTested && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        // If still not tested after 2 seconds, assume unavailable
        if (!this.connectionTested) {
            console.log('⚠️ Connection test timeout, assuming API unavailable');
            this.available = false;
            this.connectionTested = true;
        }
    }
    
    async safeRequest(endpoint, options = {}) {
        if (!this.available) {
            throw new Error('API not available');
        }
        
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };
        
        if (this.token) {
            config.headers.Authorization = `Bearer ${this.token}`;
        }
        
        const response = await fetch(`${this.baseURL}${endpoint}`, config);
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
    }
    
    async register(userData) {
        try {
            // Ensure connection test is complete
            await this.ensureConnectionTested();
            
            console.log('🚀 Attempting MySQL registration for:', userData.email, 'API available:', this.available);
            
            const response = await this.safeRequest('/auth/register', {
                method: 'POST',
                body: JSON.stringify(userData)
            });
            
            if (response.tokens) {
                this.token = response.tokens.accessToken;
                localStorage.setItem('accessToken', this.token);
            }
            
            console.log('✅ MySQL registration successful for:', response.user.email);
            return { success: true, user: response.user };
        } catch (error) {
            console.log('❌ Registration API failed:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    async login(email, password) {
        try {
            // Ensure connection test is complete
            await this.ensureConnectionTested();
            
            console.log('🚀 Attempting MySQL login for:', email, 'API available:', this.available);
            
            const response = await this.safeRequest('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            
            if (response.tokens) {
                this.token = response.tokens.accessToken;
                localStorage.setItem('accessToken', this.token);
            }
            
            console.log('✅ MySQL login successful for:', response.user.email);
            return { success: true, user: response.user };
        } catch (error) {
            console.log('❌ Login API failed:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Create global instance
window.safeAPI = new SafeAPIClient();