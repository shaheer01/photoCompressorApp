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
    analyticsApiUrl: 'https://8abf226584ec.ngrok-free.app',

    // Analytics API Key
    analyticsApiKey: 'pk_7a56835f65ca448298a67af7b164b84b',

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
    CONFIG.analyticsApiUrl = 'https://8abf226584ec.ngrok-free.app'; // Using ngrok tunnel
    CONFIG.analyticsApiKey = 'pk_7a56835f65ca448298a67af7b164b84b'; // API key for event tracking
    CONFIG.backendApiUrl = 'https://api.compressphotos.cloud';
    CONFIG.analyticsDebug = false;
    CONFIG.analyticsEnabled = true; // Enabled with ngrok
    CONFIG.environment = 'production';
}

// Make config available globally
window.APP_CONFIG = CONFIG;
