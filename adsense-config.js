/**
 * Google AdSense Configuration for CompressPhotos
 * 
 * Instructions:
 * 1. Replace ADSENSE_PUBLISHER_ID with your real Google AdSense Publisher ID
 * 2. Replace all ad slot IDs with your actual ad unit IDs from AdSense dashboard
 * 3. Test ads in development, then switch to production values
 */

// AdSense Configuration
const ADSENSE_CONFIG = {
    // IMPORTANT: Replace with your actual Google AdSense Publisher ID
    // Format: ca-pub-XXXXXXXXXXXXXXXX
    publisherId: 'ca-pub-0000000000000000', // REPLACE WITH REAL ID
    
    // Ad Unit IDs - Create these in your AdSense dashboard
    adUnits: {
        // Header banner ad (728x90 leaderboard or responsive)
        headerBanner: '0000000000', // REPLACE WITH REAL ID
        
        // Sidebar ad (300x250 medium rectangle or responsive)
        sidebar: '1111111111', // REPLACE WITH REAL ID
        
        // Results page ad (after compression results)
        results: '2222222222', // REPLACE WITH REAL ID
        
        // Analytics dashboard ad
        analytics: '3333333333', // REPLACE WITH REAL ID
        
        // Mobile banner (320x100 or responsive)
        mobileBanner: '4444444444' // REPLACE WITH REAL ID
    },
    
    // Ad settings
    settings: {
        testMode: true, // Set to false for production
        enableLazyLoading: true,
        enableDarkModeAds: true
    }
};

// Initialize Google AdSense
function initializeAdSense() {
    if (typeof window !== 'undefined' && window.document) {
        // Load AdSense script
        const adsenseScript = document.createElement('script');
        adsenseScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CONFIG.publisherId}`;
        adsenseScript.async = true;
        adsenseScript.crossOrigin = 'anonymous';
        
        // Add error handling
        adsenseScript.onerror = function() {
            console.warn('Failed to load Google AdSense script');
        };
        
        adsenseScript.onload = function() {
            console.log('✅ Google AdSense script loaded successfully');
            
            // Initialize ads after script loads
            setTimeout(initializeAds, 1000);
        };
        
        document.head.appendChild(adsenseScript);
    }
}

// Initialize individual ads
function initializeAds() {
    try {
        // Push all ads to AdSense queue
        const ads = document.querySelectorAll('.adsbygoogle');
        ads.forEach(ad => {
            if (!ad.dataset.initialized) {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
                ad.dataset.initialized = 'true';
            }
        });
        
        console.log(`✅ Initialized ${ads.length} AdSense ad units`);
    } catch (error) {
        console.error('Error initializing AdSense ads:', error);
    }
}

// Create ad unit HTML
function createAdUnit(slotId, style = '', className = '') {
    return `
        <ins class="adsbygoogle ${className}"
             style="display:block;${style}"
             data-ad-client="${ADSENSE_CONFIG.publisherId}"
             data-ad-slot="${slotId}"
             data-ad-format="auto"
             data-full-width-responsive="true"></ins>
    `;
}

// Responsive ad units with different sizes for different breakpoints
function createResponsiveAdUnit(slotId, adType = 'banner') {
    const adTypes = {
        banner: {
            style: 'width:100%;height:90px;',
            className: 'header-banner-ad'
        },
        sidebar: {
            style: 'width:300px;height:250px;',
            className: 'sidebar-ad'
        },
        results: {
            style: 'width:100%;height:280px;',
            className: 'results-ad'
        },
        analytics: {
            style: 'width:100%;height:200px;',
            className: 'analytics-ad'
        },
        mobile: {
            style: 'width:100%;height:100px;',
            className: 'mobile-ad'
        }
    };
    
    const config = adTypes[adType] || adTypes.banner;
    return createAdUnit(slotId, config.style, config.className);
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if we have a valid publisher ID
    if (ADSENSE_CONFIG.publisherId && ADSENSE_CONFIG.publisherId !== 'ca-pub-0000000000000000') {
        console.log('🚀 Initializing Google AdSense...');
        initializeAdSense();
    } else {
        console.warn('⚠️  Please configure your Google AdSense Publisher ID in adsense-config.js');
    }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ADSENSE_CONFIG,
        initializeAdSense,
        createAdUnit,
        createResponsiveAdUnit
    };
}