// Frontend API Client for ImageOptim Production
// This file replaces localStorage-based authentication with real API calls

class ImageOptimAPI {
    constructor() {
        this.baseURL = window.location.hostname === 'localhost' 
            ? 'http://localhost:3001/api' 
            : '/api';
        this.token = localStorage.getItem('accessToken');
        this.user = null;
        
        // Initialize user from token if available
        if (this.token) {
            this.verifyToken();
        }
    }

    // Helper method for making API requests
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        // Add authorization header if token exists
        if (this.token && !config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, config);
            
            // Handle token expiration
            if (response.status === 401) {
                this.handleTokenExpiration();
                throw new Error('Authentication required');
            }

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    }

    // Authentication Methods
    async register(userData) {
        const response = await this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });

        if (response.tokens) {
            this.setTokens(response.tokens);
            this.user = response.user;
        }

        return response;
    }

    async login(credentials) {
        const response = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });

        if (response.tokens) {
            this.setTokens(response.tokens);
            this.user = response.user;
        }

        return response;
    }

    async logout() {
        try {
            await this.request('/auth/logout', { method: 'POST' });
        } catch (error) {
            console.warn('Logout request failed:', error);
        } finally {
            this.clearTokens();
        }
    }

    async logoutAll() {
        try {
            await this.request('/auth/logout-all', { method: 'POST' });
        } catch (error) {
            console.warn('Logout all request failed:', error);
        } finally {
            this.clearTokens();
        }
    }

    async verifyToken() {
        try {
            const response = await this.request('/auth/verify');
            if (response.valid) {
                this.user = response.user;
                return true;
            } else {
                this.clearTokens();
                return false;
            }
        } catch (error) {
            this.clearTokens();
            return false;
        }
    }

    async refreshToken() {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
            this.clearTokens();
            throw new Error('No refresh token available');
        }

        try {
            const response = await this.request('/auth/refresh', {
                method: 'POST',
                body: JSON.stringify({ refreshToken })
            });

            this.token = response.accessToken;
            localStorage.setItem('accessToken', this.token);
            return response;
        } catch (error) {
            this.clearTokens();
            throw error;
        }
    }

    // User Management Methods
    async getProfile() {
        return await this.request('/users/profile');
    }

    async updateProfile(updates) {
        const response = await this.request('/users/profile', {
            method: 'PUT',
            body: JSON.stringify(updates)
        });

        if (response.user) {
            this.user = response.user;
        }

        return response;
    }

    async changePassword(passwordData) {
        return await this.request('/users/password', {
            method: 'PUT',
            body: JSON.stringify(passwordData)
        });
    }

    async getSessions() {
        return await this.request('/users/sessions');
    }

    async revokeSession(sessionId) {
        return await this.request(`/users/sessions/${sessionId}`, {
            method: 'DELETE'
        });
    }

    async getUsageHistory(days = 30) {
        return await this.request(`/users/usage-history?days=${days}`);
    }

    async deleteAccount(confirmation) {
        return await this.request('/users/account', {
            method: 'DELETE',
            body: JSON.stringify(confirmation)
        });
    }

    // Subscription Methods
    async getPlans() {
        return await this.request('/subscriptions/plans');
    }

    async createCheckoutSession(planId, successUrl, cancelUrl) {
        return await this.request('/subscriptions/create-checkout-session', {
            method: 'POST',
            body: JSON.stringify({ planId, successUrl, cancelUrl })
        });
    }

    async createPortalSession(returnUrl) {
        return await this.request('/subscriptions/create-portal-session', {
            method: 'POST',
            body: JSON.stringify({ returnUrl })
        });
    }

    async getCurrentSubscription() {
        return await this.request('/subscriptions/current');
    }

    async getUsageLimits() {
        return await this.request('/subscriptions/usage-limits');
    }

    async getInvoices() {
        return await this.request('/subscriptions/invoices');
    }

    // Image Processing Methods
    async compressImages(files, options = {}) {
        const formData = new FormData();
        
        // Add files
        files.forEach(file => {
            formData.append('images', file);
        });

        // Add options
        if (options.quality) {
            formData.append('quality', options.quality);
        }
        if (options.sessionId) {
            formData.append('sessionId', options.sessionId);
        }

        return await this.request('/images/compress', {
            method: 'POST',
            headers: {
                // Don't set Content-Type - let browser set it with boundary for FormData
                ...(this.token && { Authorization: `Bearer ${this.token}` })
            },
            body: formData
        });
    }

    async getImageLimits() {
        return await this.request('/images/limits');
    }

    async getCompressionHistory(page = 1, limit = 20) {
        return await this.request(`/images/history?page=${page}&limit=${limit}`);
    }

    // Statistics Methods
    async getGlobalStats() {
        return await this.request('/stats/global');
    }

    async getUserStats(period = 30) {
        return await this.request(`/stats/user?period=${period}`);
    }

    async getLeaderboard() {
        return await this.request('/stats/leaderboard');
    }

    async getTrends(days = 30) {
        return await this.request(`/stats/trends?days=${days}`);
    }

    async getAdminStats(period = 30) {
        return await this.request(`/stats/admin?period=${period}`);
    }

    // Token Management
    setTokens(tokens) {
        this.token = tokens.accessToken;
        localStorage.setItem('accessToken', tokens.accessToken);
        
        if (tokens.refreshToken) {
            localStorage.setItem('refreshToken', tokens.refreshToken);
        }
    }

    clearTokens() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
    }

    handleTokenExpiration() {
        console.warn('Token expired, clearing session');
        this.clearTokens();
        
        // Redirect to login or show login modal
        if (typeof openLoginModal === 'function') {
            openLoginModal();
        }
    }

    // Utility Methods
    isAuthenticated() {
        return !!this.token && !!this.user;
    }

    isPremium() {
        return this.user?.isPremium || false;
    }

    getCurrentUser() {
        return this.user;
    }
}

// Global API instance
const api = new ImageOptimAPI();

// Migration helper functions to replace localStorage calls
function migrateToAPI() {
    // Update global currentUser reference
    window.currentUser = api.getCurrentUser();
    
    // Re-implement authentication functions to use API
    window.handleRegister = async function(formData) {
        try {
            showNotification('Creating account...', 'info');
            
            const response = await api.register({
                firstName: formData.firstName,
                lastName: formData.lastName,
                email: formData.email,
                password: formData.password
            });

            window.currentUser = response.user;
            updateAuthUI();
            closeModal();
            showNotification('Account created successfully! Welcome to ImageOptim.', 'success');
            
        } catch (error) {
            console.error('Registration error:', error);
            showNotification(error.message || 'Registration failed. Please try again.', 'error');
        }
    };

    window.handleLogin = async function(formData) {
        try {
            showNotification('Logging in...', 'info');
            
            const response = await api.login({
                email: formData.email,
                password: formData.password
            });

            window.currentUser = response.user;
            updateAuthUI();
            closeModal();
            showNotification(`Welcome back, ${response.user.firstName}!`, 'success');
            
        } catch (error) {
            console.error('Login error:', error);
            showNotification(error.message || 'Login failed. Please check your credentials.', 'error');
        }
    };

    window.logout = async function() {
        try {
            await api.logout();
            window.currentUser = null;
            updateAuthUI();
            showNotification('Logged out successfully', 'info');
            
        } catch (error) {
            console.error('Logout error:', error);
            // Still clear local state even if API call fails
            window.currentUser = null;
            updateAuthUI();
        }
    };

    // Update compression function to use API
    window.compressImagesAPI = async function(files, quality = 80) {
        try {
            const response = await api.compressImages(files, { quality });
            
            // Update usage statistics if user is authenticated
            if (api.isAuthenticated()) {
                // Refresh user data to get updated stats
                try {
                    const profileData = await api.getProfile();
                    window.currentUser = profileData.user;
                } catch (error) {
                    console.warn('Failed to refresh user profile:', error);
                }
            }
            
            return response;
            
        } catch (error) {
            console.error('API compression error:', error);
            throw error;
        }
    };

    // Update premium upgrade function
    window.initializePayment = async function(planId) {
        if (!api.isAuthenticated()) {
            showNotification('Please log in to upgrade to premium', 'info');
            openLoginModal();
            return;
        }

        try {
            showNotification('Redirecting to payment...', 'info');
            
            const currentUrl = window.location.origin;
            const response = await api.createCheckoutSession(
                planId,
                `${currentUrl}?payment=success`,
                `${currentUrl}?payment=cancelled`
            );

            // Redirect to Stripe Checkout
            window.location.href = response.url;
            
        } catch (error) {
            console.error('Payment initialization error:', error);
            showNotification(error.message || 'Payment initialization failed', 'error');
        }
    };

    // Check for payment result in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
        showNotification('🎉 Payment successful! Welcome to Premium!', 'success');
        // Refresh user data
        if (api.isAuthenticated()) {
            api.verifyToken();
        }
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('payment') === 'cancelled') {
        showNotification('Payment was cancelled', 'info');
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    console.log('✅ Migrated to production API successfully');
}

// Initialize API migration when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', migrateToAPI);
} else {
    migrateToAPI();
}

// Export for use in other files
window.ImageOptimAPI = ImageOptimAPI;
window.api = api;