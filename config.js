/**
 * Frontend Configuration
 *
 * This file contains configuration values for the frontend.
 * Update these values for different environments (development, staging, production).
 */

const CONFIG = {
    // Analytics Dashboard API URL
    analyticsApiUrl: 'http://localhost:8000',

    // Enable/disable analytics tracking
    analyticsEnabled: true,

    // Enable debug mode for analytics
    analyticsDebug: true,

    // Backend API URL
    backendApiUrl: 'http://localhost:3001',

    // Environment
    environment: 'development'
};

// Production configuration (when deployed)
if (window.location.hostname === 'compressphotos.cloud') {
    CONFIG.analyticsApiUrl = 'https://analytics.compressphotos.cloud';
    CONFIG.backendApiUrl = 'https://api.compressphotos.cloud';
    CONFIG.analyticsDebug = false;
    CONFIG.environment = 'production';
}

// Make config available globally
window.APP_CONFIG = CONFIG;
