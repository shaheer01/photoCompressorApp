/**
 * Analytics Client for PulsePoint Dashboard Integration
 * Tracks user events and sends them to the analytics dashboard
 */

class AnalyticsClient {
    constructor(config = {}) {
        this.apiUrl = config.apiUrl || 'http://localhost:8000';
        this.apiKey = config.apiKey; // NEW: API key for authentication
        this.enabled = config.enabled !== false;
        this.debug = config.debug || false;
        this.appName = config.appName || 'unknown-app';
        this.appVersion = config.appVersion || '1.0.0';
        this.userId = this.getUserId();
        this.sessionId = this.getSessionId();
        this.country = 'Unknown';
        this.eventQueue = [];
        this.isProcessing = false;
        this.countryDetected = false;

        // Validate API key
        if (!this.apiKey) {
            console.warn('[Analytics] No API key provided. Events will not be tracked.');
            this.enabled = false;
        }

        // Initialize country detection and auto-track page view after
        this.init(config);

        // Log initialization
        this.log('Analytics Client initialized', { userId: this.userId, sessionId: this.sessionId, apiKey: this.apiKey ? '***' : 'missing' });
    }

    /**
     * Initialize analytics - detect country then track page view
     */
    async init(config) {
        // Detect country first
        await this.detectCountry();

        // Auto-track page views after country is detected
        if (config.autoPageView !== false) {
            this.trackPageView();
        }
    }

    /**
     * Get or create a unique user ID
     */
    getUserId() {
        let userId = localStorage.getItem('analytics_user_id');
        if (!userId) {
            userId = 'user_' + this.generateId();
            localStorage.setItem('analytics_user_id', userId);
        }
        return userId;
    }

    /**
     * Get or create a session ID (expires after 30 minutes of inactivity)
     */
    getSessionId() {
        const now = Date.now();
        const sessionData = localStorage.getItem('analytics_session');

        if (sessionData) {
            try {
                const { id, timestamp } = JSON.parse(sessionData);
                // Session expires after 30 minutes
                if (now - timestamp < 30 * 60 * 1000) {
                    // Update timestamp
                    localStorage.setItem('analytics_session', JSON.stringify({ id, timestamp: now }));
                    return id;
                }
            } catch (e) {
                // Invalid session data
            }
        }

        // Create new session
        const sessionId = 'session_' + this.generateId();
        localStorage.setItem('analytics_session', JSON.stringify({ id: sessionId, timestamp: now }));
        return sessionId;
    }

    /**
     * Generate a unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Detect user's country using IP geolocation API with fallbacks
     */
    async detectCountry() {
        try {
            // Try to get country from cache first
            const cachedCountry = localStorage.getItem('analytics_country');
            if (cachedCountry && cachedCountry !== 'Unknown') {
                this.country = cachedCountry;
                this.countryDetected = true;
                this.log('Country loaded from cache:', this.country);
                return;
            }

            // Try multiple geolocation APIs in order
            const apis = [
                {
                    url: 'https://ipapi.co/json/',
                    extract: (data) => data.country_name
                },
                {
                    url: 'https://ip-api.com/json/',
                    extract: (data) => data.country
                },
                {
                    url: 'https://ipwho.is/',
                    extract: (data) => data.country
                }
            ];

            for (const api of apis) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);

                    const response = await fetch(api.url, {
                        signal: controller.signal,
                        headers: { 'Accept': 'application/json' }
                    });

                    clearTimeout(timeoutId);

                    if (response.ok) {
                        const data = await response.json();
                        const country = api.extract(data);

                        if (country && country !== 'Unknown') {
                            this.country = country;
                            this.countryDetected = true;
                            localStorage.setItem('analytics_country', this.country);
                            this.log('Country detected from', api.url, ':', this.country);
                            return;
                        }
                    }
                } catch (apiError) {
                    this.log('Failed to detect country from', api.url, apiError.message);
                    // Continue to next API
                }
            }

            // If all APIs failed, keep Unknown
            this.log('All country detection APIs failed, using Unknown');
            this.countryDetected = true;

        } catch (error) {
            this.log('Country detection failed, using default', error);
            this.countryDetected = true;
        }
    }

    /**
     * Track a custom event
     */
    async track(eventType, properties = {}) {
        if (!this.enabled) {
            return;
        }

        const event = {
            event_type: eventType,
            user_id: this.userId,
            session_id: this.sessionId,
            page_url: window.location.href,
            country: this.country,
            properties: {
                ...properties,
                app_name: this.appName,
                app_version: this.appVersion,
                domain: window.location.hostname,
                protocol: window.location.protocol,
                path: window.location.pathname,
                user_agent: navigator.userAgent,
                screen_resolution: `${window.screen.width}x${window.screen.height}`,
                timestamp: new Date().toISOString()
            }
        };

        this.log('Tracking event:', event);

        // Add to queue
        this.eventQueue.push(event);

        // Process queue
        this.processQueue();
    }

    /**
     * Process the event queue
     */
    async processQueue() {
        if (this.isProcessing || this.eventQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.eventQueue.length > 0) {
            const event = this.eventQueue[0];

            try {
                const response = await fetch(`${this.apiUrl}/api/events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': this.apiKey, // NEW: Include API key
                        'ngrok-skip-browser-warning': 'true', // Skip ngrok warning page
                    },
                    body: JSON.stringify(event)
                });

                if (response.ok) {
                    // Remove from queue on success
                    this.eventQueue.shift();
                    this.log('Event sent successfully:', event.event_type);
                } else {
                    // Log error but remove from queue to prevent infinite retries
                    this.log('Event send failed with status:', response.status);
                    this.eventQueue.shift();
                }
            } catch (error) {
                this.log('Event send error:', error);
                // Remove from queue after failure to prevent blocking
                this.eventQueue.shift();
            }

            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isProcessing = false;
    }

    /**
     * Track a page view
     */
    trackPageView() {
        this.track('pageview', {
            title: document.title,
            referrer: document.referrer,
            path: window.location.pathname
        });
    }

    /**
     * Track image upload
     */
    trackImageUpload(fileCount, totalSize) {
        this.track('image_upload', {
            file_count: fileCount,
            total_size_bytes: totalSize
        });
    }

    /**
     * Track image compression
     */
    trackImageCompress(originalSize, compressedSize, quality, compressionTime) {
        this.track('image_compress', {
            original_size_bytes: originalSize,
            compressed_size_bytes: compressedSize,
            compression_ratio: ((1 - compressedSize / originalSize) * 100).toFixed(1),
            quality: quality,
            processing_time_ms: compressionTime,
            savings_bytes: originalSize - compressedSize
        });
    }

    /**
     * Track image download
     */
    trackImageDownload(fileSize, format) {
        this.track('image_download', {
            file_size_bytes: fileSize,
            format: format || 'jpeg'
        });
    }

    /**
     * Track conversion (premium subscription)
     */
    trackConversion(subscriptionType, amount) {
        this.track('conversion', {
            subscription_type: subscriptionType,
            amount: amount,
            currency: 'USD'
        });
    }

    /**
     * Track user registration
     */
    trackRegistration(method = 'email') {
        this.track('registration', {
            method: method
        });
    }

    /**
     * Track user login
     */
    trackLogin(method = 'email') {
        this.track('login', {
            method: method
        });
    }

    /**
     * Track feature click
     */
    trackFeatureClick(featureName, elementId = null) {
        this.track('feature_click', {
            feature_name: featureName,
            element_id: elementId
        });
    }

    /**
     * Track button click
     */
    trackButtonClick(buttonName, buttonId = null) {
        this.track('button_click', {
            button_name: buttonName,
            button_id: buttonId
        });
    }

    /**
     * Track form submission
     */
    trackFormSubmit(formName, formId = null) {
        this.track('form_submit', {
            form_name: formName,
            form_id: formId
        });
    }

    /**
     * Track error
     */
    trackError(errorMessage, errorType = 'general') {
        this.track('error', {
            error_message: errorMessage,
            error_type: errorType
        });
    }

    /**
     * Debug logging
     */
    log(...args) {
        if (this.debug) {
            console.log('[Analytics]', ...args);
        }
    }

    /**
     * Enable tracking
     */
    enable() {
        this.enabled = true;
        this.log('Analytics tracking enabled');
    }

    /**
     * Disable tracking
     */
    disable() {
        this.enabled = false;
        this.log('Analytics tracking disabled');
    }

    /**
     * Check if tracking is enabled
     */
    isEnabled() {
        return this.enabled;
    }
}

// Export for use in modules or make available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalyticsClient;
}

// Make available globally in browser
if (typeof window !== 'undefined') {
    window.AnalyticsClient = AnalyticsClient;
}
