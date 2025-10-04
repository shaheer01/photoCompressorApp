const axios = require('axios');
const logger = require('./logger');

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL || 'http://localhost:8000';

/**
 * Track an event in the analytics dashboard
 */
async function trackEvent(eventType, userId, sessionId, properties = {}) {
    if (!ANALYTICS_API_URL) {
        logger.warn('Analytics API URL not configured');
        return;
    }

    try {
        const event = {
            event_type: eventType,
            user_id: userId || 'anonymous',
            session_id: sessionId || `backend_${Date.now()}`,
            page_url: null,
            country: properties.country || 'Unknown',
            properties: {
                ...properties,
                source: 'backend',
                timestamp: new Date().toISOString()
            }
        };

        const response = await axios.post(`${ANALYTICS_API_URL}/api/events`, event, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        logger.info(`Analytics event tracked: ${eventType} for user ${userId}`);
        return response.data;
    } catch (error) {
        // Don't fail the main operation if analytics fails
        logger.error('Failed to track analytics event:', error.message);
    }
}

/**
 * Track a conversion (premium subscription)
 */
async function trackConversion(userId, subscriptionType, amount, metadata = {}) {
    return trackEvent('conversion', userId, null, {
        subscription_type: subscriptionType,
        amount: amount / 100, // Convert cents to dollars
        currency: 'USD',
        payment_method: 'stripe',
        ...metadata
    });
}

/**
 * Track user registration
 */
async function trackRegistration(userId, email, method = 'email') {
    return trackEvent('registration', userId, null, {
        email: email,
        registration_method: method
    });
}

/**
 * Track user login
 */
async function trackLogin(userId, email, method = 'email') {
    return trackEvent('login', userId, null, {
        email: email,
        login_method: method
    });
}

/**
 * Track subscription cancellation
 */
async function trackSubscriptionCancellation(userId, subscriptionType, reason = null) {
    return trackEvent('subscription_cancelled', userId, null, {
        subscription_type: subscriptionType,
        cancellation_reason: reason
    });
}

module.exports = {
    trackEvent,
    trackConversion,
    trackRegistration,
    trackLogin,
    trackSubscriptionCancellation
};
