// Insight+ for Firefish - Background Service Worker
// Handles extension lifecycle, message routing, and API interactions

// Extension configuration
const CONFIG = {
    name: 'Insight+ for Firefish',
    version: '1.1.0',
    coingeckoApi: 'https://api.coingecko.com/api/v3',
    cacheExpiry: 5 * 60 * 1000, // 5 minutes
    maxCacheSize: 100
};

// Cache management for API responses
const apiCache = new Map();

// Cache utility functions
const cacheUtils = {
    set: function(key, value, expiry = CONFIG.cacheExpiry) {
        // Clean up old entries if cache is too large
        if (apiCache.size >= CONFIG.maxCacheSize) {
            const oldestKey = apiCache.keys().next().value;
            apiCache.delete(oldestKey);
        }
        
        apiCache.set(key, {
            value: value,
            expiry: Date.now() + expiry,
            timestamp: Date.now()
        });
    },
    
    get: function(key) {
        const item = apiCache.get(key);
        if (item && Date.now() < item.expiry) {
            return item.value;
        }
        if (item) {
            apiCache.delete(key);
        }
        return null;
    },
    
    clear: function() {
        apiCache.clear();
    },
    
    getStats: function() {
        return {
            size: apiCache.size,
            maxSize: CONFIG.maxCacheSize,
            entries: Array.from(apiCache.entries()).map(([key, item]) => ({
                key: key,
                age: Date.now() - item.timestamp,
                expiresIn: item.expiry - Date.now()
            }))
        };
    }
};

// CoinGecko API service
const coingeckoService = {
    async fetchWithCache(url, cacheKey, expiry = CONFIG.cacheExpiry) {
        // Check cache first
        const cached = cacheUtils.get(cacheKey);
        if (cached) {
            console.log(`[Insight+ Firefish] Cache hit for: ${cacheKey}`);
            return cached;
        }
        
        try {
            console.log(`[Insight+ Firefish] Fetching from API: ${url}`);
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Cache the response
            cacheUtils.set(cacheKey, data, expiry);
            
            return data;
        } catch (error) {
            console.error(`[Insight+ Firefish] API fetch error:`, error);
            throw error;
        }
    },
    
    async getTopCoins(limit = 10, currency = 'usd') {
        const url = `${CONFIG.coingeckoApi}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;
        const cacheKey = `top_coins_${limit}_${currency}`;
        
        return await this.fetchWithCache(url, cacheKey);
    },
    
    async getCoinPrice(coinId, currency = 'usd') {
        const url = `${CONFIG.coingeckoApi}/simple/price?ids=${coinId}&vs_currencies=${currency}`;
        const cacheKey = `price_${coinId}_${currency}`;
        
        return await this.fetchWithCache(url, cacheKey, 2 * 60 * 1000); // 2 minutes for prices
    },
    
    async searchCoins(query) {
        const url = `${CONFIG.coingeckoApi}/search?query=${encodeURIComponent(query)}`;
        const cacheKey = `search_${query.toLowerCase()}`;
        
        return await this.fetchWithCache(url, cacheKey, 10 * 60 * 1000); // 10 minutes for search
    },
    
    async getCoinInfo(coinId) {
        const url = `${CONFIG.coingeckoApi}/coins/${coinId}`;
        const cacheKey = `info_${coinId}`;
        
        return await this.fetchWithCache(url, cacheKey, 30 * 60 * 1000); // 30 minutes for coin info
    }
};

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`[Insight+ Firefish] Received message:`, request);
    
    switch (request.action) {
        case 'getTopCoins':
            handleGetTopCoins(request, sendResponse);
            return true; // Keep message channel open for async response
            
        case 'getCoinPrice':
            handleGetCoinPrice(request, sendResponse);
            return true;
            
        case 'searchCoins':
            handleSearchCoins(request, sendResponse);
            return true;
            
        case 'getCoinInfo':
            handleGetCoinInfo(request, sendResponse);
            return true;
            
        case 'clearCache':
            handleClearCache(sendResponse);
            break;
            
        case 'getCacheStats':
            handleGetCacheStats(sendResponse);
            break;
            
        case 'openPopup':
            handleOpenPopup();
            break;
            
        default:
            console.warn(`[Insight+ Firefish] Unknown action: ${request.action}`);
            sendResponse({ error: 'Unknown action' });
            break;
    }
});

// Message handlers
async function handleGetTopCoins(request, sendResponse) {
    try {
        const limit = request.limit || 10;
        const currency = request.currency || 'usd';
        const coins = await coingeckoService.getTopCoins(limit, currency);
        sendResponse({ success: true, data: coins });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGetCoinPrice(request, sendResponse) {
    try {
        const coinId = request.coinId;
        const currency = request.currency || 'usd';
        
        if (!coinId) {
            throw new Error('Coin ID is required');
        }
        
        const price = await coingeckoService.getCoinPrice(coinId, currency);
        sendResponse({ success: true, data: price });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleSearchCoins(request, sendResponse) {
    try {
        const query = request.query;
        
        if (!query) {
            throw new Error('Search query is required');
        }
        
        const results = await coingeckoService.searchCoins(query);
        sendResponse({ success: true, data: results });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleGetCoinInfo(request, sendResponse) {
    try {
        const coinId = request.coinId;
        
        if (!coinId) {
            throw new Error('Coin ID is required');
        }
        
        const info = await coingeckoService.getCoinInfo(coinId);
        sendResponse({ success: true, data: info });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

function handleClearCache(sendResponse) {
    try {
        cacheUtils.clear();
        console.log(`[Insight+ Firefish] Cache cleared`);
        sendResponse({ success: true, message: 'Cache cleared successfully' });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

function handleGetCacheStats(sendResponse) {
    try {
        const stats = cacheUtils.getStats();
        sendResponse({ success: true, data: stats });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

function handleOpenPopup() {
    // This will be handled by the popup interface
    console.log(`[Insight+ Firefish] Popup requested`);
}

// Extension lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[Insight+ Firefish] Extension ${details.reason}:`, CONFIG.name, CONFIG.version);
    
    if (details.reason === 'install') {
        // First time installation
        console.log(`[Insight+ Firefish] Welcome to ${CONFIG.name}!`);
        
        // Set default settings
        chrome.storage.local.set({
            settings: {
                enabled: true,
                autoRefresh: true,
                refreshInterval: 5,
                theme: 'auto',
                notifications: true
            },
            lastUpdated: Date.now()
        });
    } else if (details.reason === 'update') {
        // Extension updated
        console.log(`[Insight+ Firefish] Updated to version ${CONFIG.version}`);
    }
});

chrome.runtime.onStartup.addListener(() => {
    console.log(`[Insight+ Firefish] Extension started`);
    
    // Clear expired cache entries
    const now = Date.now();
    for (const [key, item] of apiCache.entries()) {
        if (now >= item.expiry) {
            apiCache.delete(key);
        }
    }
});

// Periodic cache cleanup
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, item] of apiCache.entries()) {
        if (now >= item.expiry) {
            apiCache.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[Insight+ Firefish] Cleaned ${cleaned} expired cache entries`);
    }
}, 60 * 1000); // Check every minute

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
    console.log(`[Insight+ Firefish] Extension icon clicked on tab:`, tab.id);
    
    // Send message to content script to show quick actions
    chrome.tabs.sendMessage(tab.id, { action: 'showQuickActions' }).catch(() => {
        // Content script not available, open popup instead
        console.log(`[Insight+ Firefish] Content script not available, opening popup`);
    });
});

console.log(`[Insight+ Firefish] Background service worker initialized`);
