/**
 * Frontend Configuration
 *
 * This file contains configuration values for the frontend.
 * Update these values for different environments (development, staging, production).
 */

const CONFIG = {
    // Analytics Dashboard API URL
    // For local testing, use: 'http://localhost:8000'
    // For production, deploy analytics backend and use: 'https://analytics.compressphotos.cloud'
    //analyticsApiUrl: 'http://localhost:8000',
    analyticsApiUrl: 'https://cb4db0cf3662.ngrok-free.app',

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
if (window.location.hostname === 'compressphotos.cloud' ||
    window.location.hostname === 'www.compressphotos.cloud') {
    // IMPORTANT: Update this URL to your deployed analytics backend
    // For testing with ngrok: 'https://your-ngrok-url.ngrok-free.app'
    // For production: 'https://analytics.compressphotos.cloud'
    CONFIG.analyticsApiUrl = 'http://localhost:8000'; // ⚠️ UPDATE THIS!
    CONFIG.backendApiUrl = 'https://api.compressphotos.cloud';
    CONFIG.analyticsDebug = false;
    CONFIG.analyticsEnabled = true;
    CONFIG.environment = 'production';
}

// Make config available globally
window.APP_CONFIG = CONFIG;
