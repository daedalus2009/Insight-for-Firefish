// Insight+ for Firefish - Content Script
// Enhanced user experience for Firefish.io with Bitcoin analysis
// 
// CHANGELOG:
// - Fixed issue where pending loans were causing performance analysis to fail
// - Added filtering to skip pending loans (containing "PENDING" text in ant-card-body)
// - Only process active/completed loans that have complete structure
// - Added retry limit to prevent infinite retry loops
// - Enhanced logging for better debugging of pending loan scenarios

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        firefishDomain: 'app.firefish.io',
        coingeckoApi: 'https://api.coingecko.com/api/v3',
        cacheExpiry: 5 * 60 * 1000, // 5 minutes
        features: {
            cryptoPrices: true,
            enhancedUI: true,
            quickActions: true,
            btcAnalysis: true
        },
        selectors: {
            loanCards: '._activeCard_fvh4n_5',
            loanAmount: '._amount_148t9_34',
            interestRate: '._value_148t9_59[title*="%"]',
            detailsSection: '._details_1gfcb_5._details_gxzzy_12',
            // Additional selectors based on actual HTML structure
            provisionDate: '._fieldValue_1gfcb_41[title*="Nov"], ._fieldValue_1gfcb_41[title*="Dec"], ._fieldValue_1gfcb_41[title*="Jan"], ._fieldValue_1gfcb_41[title*="Feb"], ._fieldValue_1gfcb_41[title*="Mar"], ._fieldValue_1gfcb_41[title*="Apr"], ._fieldValue_1gfcb_41[title*="May"], ._fieldValue_1gfcb_41[title*="Jun"], ._fieldValue_1gfcb_41[title*="Jul"], ._fieldValue_1gfcb_41[title*="Aug"], ._fieldValue_1gfcb_41[title*="Sep"], ._fieldValue_1gfcb_41[title*="Oct"]',
            collateralBTC: 'a[href*="mempool.space"]'
        }
    };

    // Cache management
    const cache = {
        data: new Map(),
        set: function(key, value, expiry = CONFIG.cacheExpiry) {
            this.data.set(key, {
                value: value,
                expiry: Date.now() + expiry
            });
        },
        get: function(key) {
            const item = this.data.get(key);
            if (item && Date.now() < item.expiry) {
                return item.value;
            }
            this.data.delete(key);
            return null;
        },
        clear: function() {
            this.data.clear();
        }
    };

    // Utility functions
    const utils = {
        log: function(message, type = 'info') {
            // Debug logging to see what's being passed
            console.log('[Firefish-BTC] utils.log called with:', { message, type, typeType: typeof type });
            
            // Ensure type is a string before calling toUpperCase
            const safeType = typeof type === 'string' ? type : 'info';
            console.log(`[Firefish-BTC] ${safeType.toUpperCase()}:`, message);
        },
        
        isFirefish: function() {
            return window.location.hostname === CONFIG.firefishDomain;
        },
        
        isFirefishLoansTabPage: function() {
            return window.location.hostname === CONFIG.firefishDomain && 
                   window.location.pathname === '/loans/tab/active';
        },
        
        debounce: function(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        
        formatCurrency: function(amount, currency = 'USD') {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency
            }).format(amount);
        },
        
        // Format plain numbers with thousands separators and configurable decimals
        formatNumber: function(value, fractionDigits = 2) {
            try {
                const num = typeof value === 'number' ? value : Number(value);
                if (!isFinite(num)) return fractionDigits === 0 ? '0' : '0.' + '0'.repeat(fractionDigits);
                return new Intl.NumberFormat('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(num);
            } catch (e) {
                return String(value ?? '');
            }
        },
        
        // Parse numbers from text like "€3,732.68", "EUR 15,000", "-1.234,56", "185.000,00"
        parseNumberFromText: function(text) {
            if (!text) return NaN;
            let s = String(text).trim();
            // Keep digits, separators, minus
            s = s.replace(/[^0-9.,-]/g, '');
            if (!s) return NaN;

            const count = (str, ch) => (str.match(new RegExp(`\\${ch}`, 'g')) || []).length;
            const commas = count(s, ',');
            const dots = count(s, '.');

            // Helper: remove thousands for given sep
            const stripThousands = (str, sep) => str.split(sep).join('');

            // Case 1: both separators exist → use rightmost as decimal
            if (commas > 0 && dots > 0) {
                const lastComma = s.lastIndexOf(',');
                const lastDot = s.lastIndexOf('.');
                const decimalSep = lastComma > lastDot ? ',' : '.';
                const thousandsSep = decimalSep === ',' ? '.' : ',';
                s = stripThousands(s, thousandsSep);
                // Collapse multiple decimals to last
                const parts = s.split(decimalSep);
                const decimalPart = parts.pop();
                s = parts.join('') + decimalSep + decimalPart;
                if (decimalSep === ',') s = s.replace(/,/g, '.');
                s = s.replace(/(?!^)-/g, '');
                const n = parseFloat(s);
                return isNaN(n) ? NaN : n;
            }

            // Case 2: only commas
            if (commas > 0 && dots === 0) {
                const last = s.lastIndexOf(',');
                const trailing = s.length - last - 1;
                // If exactly 3 digits trail the only/last comma → thousands, not decimal
                if (trailing === 3) {
                    s = stripThousands(s, ',');
                    s = s.replace(/(?!^)-/g, '');
                    const n = parseFloat(s);
                    return isNaN(n) ? NaN : n;
                }
                // Otherwise treat comma as decimal
                // If multiple commas but last group length is 2 → decimal with thousands
                if (commas > 1) {
                    const parts = s.split(',');
                    const dec = parts.pop();
                    if (dec.length === 2) {
                        s = parts.join('') + '.' + dec;
                        s = s.replace(/(?!^)-/g, '');
                        const n = parseFloat(s);
                        return isNaN(n) ? NaN : n;
                    }
                }
                s = s.replace(/,/g, '.');
                s = s.replace(/(?!^)-/g, '');
                const n = parseFloat(s);
                return isNaN(n) ? NaN : n;
            }

            // Case 3: only dots
            if (dots > 0 && commas === 0) {
                const last = s.lastIndexOf('.');
                const trailing = s.length - last - 1;
                if (trailing === 3) {
                    s = stripThousands(s, '.');
                    s = s.replace(/(?!^)-/g, '');
                    const n = parseFloat(s);
                    return isNaN(n) ? NaN : n;
                }
                // default: dot is decimal
                s = s.replace(/(?!^)-/g, '');
                const n = parseFloat(s);
                return isNaN(n) ? NaN : n;
            }

            // Case 4: no separators
            s = s.replace(/(?!^)-/g, '');
            const n = parseFloat(s);
            return isNaN(n) ? NaN : n;
        },

        safeQuerySelector: function(element, selector) {
            try {
                return element.querySelector(selector);
            } catch (error) {
                utils.log(`Error querying selector "${selector}": ${error.message}`, 'error');
                return null;
            }
        }
    };
    // Firefish loan card detection
    const firefishDetector = {
        isInitialized: false,
        loanCards: [],
        observer: null,

        detectFirefishLoanCards() {
            try {
                const loanCards = document.querySelectorAll(CONFIG.selectors.loanCards);
                
                if (loanCards.length === 0) {
                    return [];
                }
                
                // Filter out pending loans and only keep active/completed loans
                const validLoanCards = Array.from(loanCards).filter(card => {
                    // Check if this is a pending loan by looking for "PENDING" text in any ant-card-body
                    const pendingElements = card.querySelectorAll('.ant-card-body');
                    let isPending = false;
                    
                    pendingElements.forEach(element => {
                        if (element.textContent && element.textContent.includes('PENDING')) {
                            isPending = true;
                        }
                    });
                    
                    if (isPending) {
                        utils.log('Skipping pending loan card', 'info');
                        return false;
                    }
                    
                    // Validate this is actually a complete Firefish loan by checking for required structure
                    const hasFirefishStructure = (
                        utils.safeQuerySelector(card, CONFIG.selectors.loanAmount) &&
                        utils.safeQuerySelector(card, CONFIG.selectors.interestRate) &&
                        utils.safeQuerySelector(card, CONFIG.selectors.detailsSection)
                    );
                    
                    if (!hasFirefishStructure) {
                        utils.log('Skipping incomplete loan card (missing required structure)', 'info');
                        return false;
                    }
                    
                    return true;
                });
                
                if (validLoanCards.length > 0) {
                    utils.log(`Found ${validLoanCards.length} valid Firefish loan cards (${loanCards.length - validLoanCards.length} pending/incomplete cards skipped)`);
                    return validLoanCards;
                } else {
                    utils.log('No valid (non-pending) Firefish loan cards found', 'info');
                }
                
                return [];
            } catch (error) {
                utils.log(`Error detecting loan cards: ${error.message}`, 'error');
                return [];
            }
        },

        validateFirefishPage() {
            if (!utils.isFirefishLoansTabPage()) {
                utils.log('Not on Firefish loans tab page (/loans/tab/active), skipping validation', 'info');
                return false;
            }

            utils.log('Validating Firefish loans tab page structure', 'info');
            const loanCards = this.detectFirefishLoanCards();
            if (loanCards.length === 0) {
                // Check if there are any loan cards at all (including pending ones)
                const allLoanCards = document.querySelectorAll(CONFIG.selectors.loanCards);
                if (allLoanCards.length > 0) {
                    utils.log(`Found ${allLoanCards.length} loan cards but ${allLoanCards.length - loanCards.length} are pending/incomplete - skipping analysis`);
                } else {
                    utils.log('No Firefish loan cards detected at all');
                }
                return false;
            }

            utils.log(`Valid Firefish page detected with ${loanCards.length} active loan cards ready for analysis`);
            this.loanCards = loanCards;
            return true;
        },

        setupMutationObserver() {
            if (this.observer) {
                this.observer.disconnect();
            }

            this.observer = new MutationObserver(utils.debounce((mutations) => {
                let shouldUpdate = false;
                
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if new loan cards were added
                                if (node.matches && node.matches(CONFIG.selectors.loanCards)) {
                                    shouldUpdate = true;
                                }
                                // Check if any child elements contain loan cards
                                if (node.querySelectorAll && node.querySelectorAll(CONFIG.selectors.loanCards).length > 0) {
                                    shouldUpdate = true;
                                }
                            }
                        });
                    }
                });

                if (shouldUpdate) {
                    utils.log('DOM changes detected, updating loan card detection', 'info');
                    this.updateLoanCards();
                }
            }, 500));

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            utils.log('MutationObserver setup complete');
        },

        updateLoanCards() {
            const newLoanCards = this.detectFirefishLoanCards();
            if (newLoanCards.length !== this.loanCards.length) {
                utils.log(`Loan card count changed: ${this.loanCards.length} → ${newLoanCards.length}`);
                this.loanCards = newLoanCards;
                
                // Notify other components about the change
                if (this.isInitialized) {
                    this.notifyLoanCardUpdate();
                }
            }
        },

        notifyLoanCardUpdate() {
            // Send message to popup about status update
            try {
                chrome.runtime.sendMessage({
                    action: 'updateStatus',
                    data: {
                        cardsFound: this.loanCards.length,
                        analyzed: this.loanCards.length // All detected cards are considered analyzed
                    }
                });
            } catch (error) {
                utils.log('Failed to send status update: ' + error.message, 'warn');
            }
        },

        getStatus() {
            return {
                isFirefish: utils.isFirefish(),
                cardsFound: this.loanCards.length,
                analyzed: this.loanCards.length,
                isInitialized: this.isInitialized
            };
        },

                extractFirefishLoanData(loanCard) {
            try {
                console.log('[Firefish-BTC] Starting loan data extraction...');
                
                // Double-check this isn't a pending loan
                const pendingElements = loanCard.querySelectorAll('.ant-card-body');
                let isPending = false;
                
                pendingElements.forEach(element => {
                    if (element.textContent && element.textContent.includes('PENDING')) {
                        isPending = true;
                    }
                });
                
                if (isPending) {
                    console.log('[Firefish-BTC] Skipping pending loan during extraction');
                    return null;
                }
                
                // Extract currency and amount from "EUR 10,000" format in ._amount_148t9_34
                const amountElement = loanCard.querySelector('._amount_148t9_34');
                console.log('[Firefish-BTC] Amount element found:', !!amountElement);
                
                const amountText = amountElement ? amountElement.textContent.trim() : '';
                console.log('[Firefish-BTC] Amount text:', amountText);
                
                const currencyMatch = amountText.match(/^([A-Z]{3})\s+([\d,]+)/);
                console.log('[Firefish-BTC] Currency match:', currencyMatch);
                
                if (!currencyMatch) {
                    console.warn('[Firefish-BTC] Could not extract currency and amount from:', amountText);
                    return null;
                }
                const currency = currencyMatch[1]; // EUR, USD, CHF, CZK
                const loanAmount = parseFloat(currencyMatch[2].replace(/,/g, '')); // 10000
                
                console.log('[Firefish-BTC] Extracted amount:', { currency, loanAmount });
                
                // Extract interest rate from title attribute "12.5%" in ._value_148t9_59
                const interestElements = loanCard.querySelectorAll('._value_148t9_59[title*="%"]');
                console.log('[Firefish-BTC] Interest elements found:', interestElements.length);
                
                let interestRate = null;
                interestElements.forEach((el, index) => {
                    const title = el.getAttribute('title');
                    console.log(`[Firefish-BTC] Interest element ${index} title:`, title);
                    if (title && title.includes('%')) {
                        interestRate = parseFloat(title.replace('%', ''));
                        console.log('[Firefish-BTC] Found interest rate:', interestRate);
                    }
                });
                
                // Extract provision date from title attribute "24 Nov 2024" in ._fieldValue_1gfcb_41
                let provisionDate = null;
                const dateElements = loanCard.querySelectorAll('._fieldValue_1gfcb_41[title]');
                console.log('[Firefish-BTC] Date elements found:', dateElements.length);
                
                dateElements.forEach((element, index) => {
                    const dateText = element.getAttribute('title');
                    console.log(`[Firefish-BTC] Date element ${index} title:`, dateText);
                    if (dateText && /\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(dateText)) {
                        provisionDate = dateText.trim(); // "24 Nov 2024"
                        console.log('[Firefish-BTC] Found provision date:', provisionDate);
                    }
                });
                
                // Extract BTC collateral from mempool.space link "0.25891 BTC"
                const collateralLink = loanCard.querySelector('a[href*="mempool.space"]');
                console.log('[Firefish-BTC] Collateral link found:', !!collateralLink);
                
                let collateralBTC = null;
                if (collateralLink) {
                    const collateralText = collateralLink.textContent.trim();
                    console.log('[Firefish-BTC] Collateral text:', collateralText);
                    const btcMatch = collateralText.match(/([\d.]+)\s+BTC/);
                    collateralBTC = btcMatch ? parseFloat(btcMatch[1]) : null;
                    console.log('[Firefish-BTC] Found BTC collateral:', collateralBTC);
                }
                
                // Alternative: BTC amount might be in ._fieldValue_1gfcb_41 containing "BTC"
                if (!collateralBTC) {
                    console.log('[Firefish-BTC] Trying alternative BTC extraction...');
                    const btcElements = loanCard.querySelectorAll('._fieldValue_1gfcb_41');
                    btcElements.forEach((el, index) => {
                        const text = el.textContent.trim();
                        console.log(`[Firefish-BTC] BTC element ${index} text:`, text);
                        const btcMatch = text.match(/([\d.]+)\s+BTC/);
                        if (btcMatch) {
                            collateralBTC = parseFloat(btcMatch[1]);
                            console.log('[Firefish-BTC] Found BTC collateral (alternative):', collateralBTC);
                        }
                    });
                }
                
                // Validation - all required fields must be present
                console.log('[Firefish-BTC] Validation check:', {
                    currency, loanAmount, interestRate, provisionDate, collateralBTC
                });
                if (!currency || !loanAmount || !interestRate || !provisionDate || !collateralBTC) {
                    console.warn('[Firefish-BTC] Missing required data:', {
                        currency, loanAmount, interestRate, provisionDate, collateralBTC
                    });
                    return null;
                }
                
                console.log('[Firefish-BTC] Successfully extracted all loan data:', {
                    currency, loanAmount, interestRate, provisionDate, collateralBTC
                });
                
                return {
                    currency,
                    loanAmount,
                    interestRate,
                    provisionDate,
                    collateralBTC,
                    isValid: true
                };
                
            } catch (error) {
                console.error('[Firefish-BTC] Error extracting loan data:', error);
                console.error('[Firefish-BTC] Error stack:', error.stack);
                return null;
            }
        },

        getAllLoanData() {
            const loanData = [];
            
            this.loanCards.forEach((card, index) => {
                const data = this.extractFirefishLoanData(card);
                if (data) {
                    data.cardIndex = index;
                    loanData.push(data);
                }
            });
            
            return loanData;
        },

        debugLoanCard(cardIndex = 0) {
            if (cardIndex >= this.loanCards.length) {
                utils.log(`Card index ${cardIndex} out of range. Total cards: ${this.loanCards.length}`, 'error');
                return null;
            }

            const card = this.loanCards[cardIndex];
            const data = this.extractFirefishLoanData(card);
            
            utils.log(`Debug info for card ${cardIndex}:`, 'info');
                            utils.log('Raw card element:', 'info', card);
                utils.log('Extracted data:', 'info', data);
            
            return {
                cardElement: card,
                extractedData: data,
                cardIndex: cardIndex
            };
        }
    };

    // Optimized CoinGecko client for Firefish loan analysis
    const BTC_CACHE_CONFIG = {
        CURRENT_PRICE_DURATION: 15 * 60 * 1000, // 15 minutes
        HISTORICAL_PRICE_DURATION: Infinity,    // Never expires (historical data doesn't change)
        RATE_LIMIT_COOLDOWN: 60 * 1000,        // 60 seconds when blocked
        MAX_RETRIES: 3,
        RETRY_DELAY: 60000 // 1 minute
    };

    const priceCache = {
        current: {
            data: null,
            timestamp: null,
            currencies: new Set() // Track which currencies we have
        },
        historical: new Map(), // key: "date_currency", value: {price, timestamp}
        apiBlocked: false,
        blockedUntil: null
    };

    // Enhanced rate limit state tracking
    const rateLimitState = {
        isRateLimited: false,
        rateLimitedAt: null,
        retryTimeout: null,
        pendingCards: new Set(), // Cards waiting for retry
        countdownInterval: null,
        retryQueue: [], // Queue of cards to retry after wait
        onRateLimitResolved: null // Callback when rate limit is resolved
    };
    class FirefishBTCApiClient {
        constructor() {
            this.lastRequest = 0;
            this.minInterval = 4000; // 4 seconds between requests for CoinGecko free tier
            this.requestHistory = []; // Track recent requests for rate limit detection
        }

        // Enhanced rate limit management
        setRateLimitCallback(callback) {
            rateLimitState.onRateLimitResolved = callback;
        }

        // Start rate limit countdown and show visual feedback
        startRateLimitCountdown() {
            if (rateLimitState.countdownInterval) {
                clearInterval(rateLimitState.countdownInterval);
            }

            rateLimitState.isRateLimited = true;
            rateLimitState.rateLimitedAt = Date.now();
            const waitTime = BTC_CACHE_CONFIG.RATE_LIMIT_COOLDOWN;

            console.log(`[Firefish-BTC] Rate limited (429) - starting ${waitTime/1000}s countdown`);

            // Update all pending cards with countdown
            this.updateRateLimitDisplay();

            // Start countdown interval
            rateLimitState.countdownInterval = setInterval(() => {
                const elapsed = Date.now() - rateLimitState.rateLimitedAt;
                const remaining = Math.max(0, waitTime - elapsed);
                const remainingSeconds = Math.ceil(remaining / 1000);

                if (remaining <= 0) {
                    this.resolveRateLimit();
                } else {
                    this.updateRateLimitDisplay(remainingSeconds);
                }
            }, 1000);

            // Set timeout to resolve rate limit
            rateLimitState.retryTimeout = setTimeout(() => {
                this.resolveRateLimit();
            }, waitTime);
        }

        // Update visual feedback on rate-limited cards
        updateRateLimitDisplay(remainingSeconds = null) {
            const cards = Array.from(rateLimitState.pendingCards);
            
            cards.forEach(card => {
                let message = 'BTC price API rate limited - retrying in ';
                
                if (remainingSeconds !== null) {
                    message += `${remainingSeconds}s...`;
                } else {
                    message += '60s...';
                }

                this.showRateLimitMessage(card, message);
            });
        }

        // Show rate limit message on a card
        showRateLimitMessage(loanCard, message) {
            // Remove existing displays
            const existingDisplays = loanCard.querySelectorAll('.firefish-btc-loading, .firefish-btc-results, .firefish-btc-error');
            existingDisplays.forEach(display => display.remove());

            // Create rate limit message
            const rateLimitDiv = document.createElement('div');
            rateLimitDiv.className = 'firefish-btc-rate-limited';
            rateLimitDiv.innerHTML = `
                <div class="firefish-btc-loading">
                    <span class="firefish-loading-spinner">⏳</span> ${message}
                </div>
            `;

            // Find injection point and add message
            const existingDetails = loanCard.querySelector('._details_1gfcb_5._details_gxzzy_12');
            if (existingDetails) {
                existingDetails.parentNode.insertBefore(rateLimitDiv, existingDetails.nextSibling);
            }
        }
        // Resolve rate limit and restart processing
        resolveRateLimit() {
            console.log('[Firefish-BTC] Rate limit resolved - restarting processing');
            
            // Clear countdown
            if (rateLimitState.countdownInterval) {
                clearInterval(rateLimitState.countdownInterval);
                rateLimitState.countdownInterval = null;
            }

            // Clear timeout
            if (rateLimitState.retryTimeout) {
                clearTimeout(rateLimitState.retryTimeout);
                rateLimitState.retryTimeout = null;
            }

            // Reset rate limit state
            rateLimitState.isRateLimited = false;
            rateLimitState.rateLimitedAt = null;

            // Clear pending cards display
            rateLimitState.pendingCards.forEach(card => {
                const rateLimitDiv = card.querySelector('.firefish-btc-rate-limited');
                if (rateLimitDiv) {
                    rateLimitDiv.remove();
                }
            });

            // Call callback to restart processing
            if (rateLimitState.onRateLimitResolved) {
                rateLimitState.onRateLimitResolved();
            }
        }

        // Add card to pending queue
        addPendingCard(loanCard) {
            rateLimitState.pendingCards.add(loanCard);
            if (rateLimitState.isRateLimited) {
                this.showRateLimitMessage(loanCard, 'BTC price API rate limited - retrying in 60s...');
            }
        }

        // Remove card from pending queue
        removePendingCard(loanCard) {
            rateLimitState.pendingCards.delete(loanCard);
        }
        
        // Convert "24 Nov 2024" to "24-11-2024" for CoinGecko API
        convertFirefishDateToCoinGecko(firefishDate) {
            const months = {
                'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
            };
            
            const parts = firefishDate.split(' '); // ["24", "Nov", "2024"]
            if (parts.length !== 3) return null;
            
            const day = parts[0].padStart(2, '0');
            const month = months[parts[1]];
            const year = parts[2];
            
            return month ? `${day}-${month}-${year}` : null;
        }
        
        async getCurrentPriceForAllCurrencies() {
            // THE FIRST API call - gets current prices for EUR, USD, CHF, CZK
            if (this.isCurrentPriceCacheValid()) {
                return priceCache.current.data;
            }
            await this.checkRateLimit();
            // Add delay to prevent rate limiting
            await this.addRequestDelay();
            
            try {
                // Record this request
                this.recordRequest();
                
                const response = await fetch(
                    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur,usd,chf,czk'
                );
                
                if (!response.ok) {
                    if (response.status === 429) {
                        console.log('[Firefish-BTC] Rate limited (429) for current prices');
                        
                        // Start rate limit countdown
                        this.startRateLimitCountdown();
                        
                        // Return null to indicate rate limit
                        return null;
                    }
                    
                    if (this.handleRateLimit({status: response.status})) {
                        return await this.getCurrentPriceForAllCurrencies();
                    }
                    throw new Error(`API request failed: ${response.status}`);
                }
                
                const data = await response.json();
                priceCache.current = {
                    data: data.bitcoin,
                    timestamp: Date.now(),
                    currencies: new Set(['eur', 'usd', 'chf', 'czk'])
                };
                
                utils.log('Current BTC prices cached for all currencies');
                return data.bitcoin;
                
            } catch (error) {
                // Enhanced error detection for rate limiting
                const errorMessage = error.message || error.toString();
                const isRateLimited = this.detectRateLimitFromError(errorMessage, 'current', 'prices');
                
                if (isRateLimited) {
                    console.log('[Firefish-BTC] Rate limited detected from error for current prices');
                    
                    // Start rate limit countdown if not already started
                    if (!rateLimitState.isRateLimited) {
                        this.startRateLimitCountdown();
                    }
                    
                    // Return null to indicate rate limit
                    return null;
                }
                
                utils.log(`Failed to fetch current prices: ${errorMessage}`, 'error');
                return null;
            }
        }
        
                async getHistoricalPrice(firefishDate, currency, loanCard = null) {
            const coinGeckoDate = this.convertFirefishDateToCoinGecko(firefishDate);
            if (!coinGeckoDate) return null;
            
            const cacheKey = `${coinGeckoDate}_${(currency || '').toLowerCase()}`;
            
            // Check permanent cache first
            if (priceCache.historical.has(cacheKey)) {
                return priceCache.historical.get(cacheKey).price;
            }
            
            await this.checkRateLimit();
            
            // Add delay to prevent rate limiting
            await this.addRequestDelay();
            
            try {
                // Record this request
                this.recordRequest();
                
                const response = await fetch(
                    `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${coinGeckoDate}`
                );
                
                if (!response.ok) {
                    if (response.status === 429) {
                        console.log(`[Firefish-BTC] Rate limited (429) for historical price: ${firefishDate} ${currency}`);
                        
                        // Add card to pending queue if provided
                        if (loanCard) {
                            this.addPendingCard(loanCard);
                        }
                        
                        // Start rate limit countdown
                        this.startRateLimitCountdown();
                        
                        // Return null to indicate rate limit - card will be retried later
                        return null;
                    }
                    
                    if (this.handleRateLimit({status: response.status})) {
                        return await this.getHistoricalPrice(firefishDate, currency, loanCard);
                    }
                    throw new Error(`Historical API request failed: ${response.status}`);
                }
                
                const data = await response.json();
                const price = data.market_data.current_price[(currency || '').toLowerCase()];
                
                // Cache permanently (historical data never changes)
                priceCache.historical.set(cacheKey, {
                    price: price,
                    timestamp: Date.now()
                });
                
                // Remove card from pending queue if it was there
                if (loanCard) {
                    this.removePendingCard(loanCard);
                }
                
                utils.log(`Historical price cached: ${firefishDate} ${currency} = ${price}`);
                return price;
            } catch (error) {
                // Enhanced error detection for rate limiting
                const errorMessage = error.message || error.toString();
                const isRateLimited = this.detectRateLimitFromError(errorMessage, firefishDate, currency);
                
                if (isRateLimited) {
                    console.log(`[Firefish-BTC] Rate limited detected from error for: ${firefishDate} ${currency}`);
                    
                    // Add card to pending queue if provided
                    if (loanCard) {
                        this.addPendingCard(loanCard);
                    }
                    
                    // Start rate limit countdown if not already started
                    if (!rateLimitState.isRateLimited) {
                        this.startRateLimitCountdown();
                    }
                    
                    // Return null to indicate rate limit - card will be retried later
                    return null;
                }
                
                utils.log(`Failed to fetch historical price for ${firefishDate}: ${errorMessage}`, 'error');
                return null;
            }
        }

        // Detect rate limiting from various error types
        detectRateLimitFromError(errorMessage, firefishDate, currency) {
            const errorLower = errorMessage.toLowerCase();
            
            // Check for common rate limit indicators
            const rateLimitIndicators = [
                '429',
                'too many requests',
                'rate limit',
                'quota exceeded',
                'failed to fetch', // Generic network error that could be rate limiting
                'network error',
                'cors policy'
            ];
            
            // Check if any rate limit indicators are present
            const hasRateLimitIndicator = rateLimitIndicators.some(indicator => 
                errorLower.includes(indicator)
            );
            
            // Additional check: if we've made multiple requests recently, it's likely rate limiting
            const recentRequests = this.getRecentRequestCount();
            const likelyRateLimited = recentRequests > 3; // If we've made more than 3 requests recently
            
            // Check if we're making requests too fast (CoinGecko free tier limit is ~50 calls/minute)
            const isRequestingTooFast = this.isRequestingTooFast();
            
            if (hasRateLimitIndicator || likelyRateLimited || isRequestingTooFast) {
                console.log(`[Firefish-BTC] Rate limit detected from error: "${errorMessage}" (recent requests: ${recentRequests}, too fast: ${isRequestingTooFast})`);
                return true;
            }
            
            return false;
        }
        // Check if we're making requests too fast for CoinGecko's rate limits
        isRequestingTooFast() {
            if (this.requestHistory.length < 2) return false;
            
            const now = Date.now();
            const recentRequests = this.requestHistory.slice(-5); // Last 5 requests
            
            // Check if we've made more than 5 requests in the last 30 seconds
            const thirtySecondsAgo = now - 30000;
            const requestsInLast30s = recentRequests.filter(timestamp => timestamp > thirtySecondsAgo).length;
            
            if (requestsInLast30s > 5) {
                console.log(`[Firefish-BTC] Requesting too fast: ${requestsInLast30s} requests in last 30s`);
                return true;
            }
            
            return false;
        }
        // Add delay between requests to prevent rate limiting
        async addRequestDelay() {
            if (this.lastRequest === 0) return; // First request, no delay needed
            
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequest;
            const minDelay = 50; // 50ms between requests (small delay to prevent rate limiting)
            
            if (timeSinceLastRequest < minDelay) {
                const delayNeeded = minDelay - timeSinceLastRequest;
                console.log(`[Firefish-BTC] Adding ${delayNeeded}ms delay to prevent rate limiting`);
                await new Promise(resolve => setTimeout(resolve, delayNeeded));
            }
        }

        // Track recent API requests to help detect rate limiting
        getRecentRequestCount() {
            const now = Date.now();
            const recentThreshold = 60000; // 1 minute
            
            // Clean old requests from history
            this.requestHistory = this.requestHistory.filter(timestamp => 
                (now - timestamp) < recentThreshold
            );
            
            return this.requestHistory.length;
        }

        // Record a new API request
        recordRequest() {
            const now = Date.now();
            this.lastRequest = now;
            this.requestHistory.push(now);
            
            // Keep only last 10 requests to prevent memory bloat
            if (this.requestHistory.length > 10) {
                this.requestHistory.shift();
            }
        }
        
        isCurrentPriceCacheValid() {
            return priceCache.current.data && 
                   priceCache.current.timestamp && 
                   (Date.now() - priceCache.current.timestamp) < BTC_CACHE_CONFIG.CURRENT_PRICE_DURATION;
        }
        
        async checkRateLimit() {
            if (priceCache.apiBlocked && Date.now() < priceCache.blockedUntil) {
                const waitTime = priceCache.blockedUntil - Date.now();
                utils.log(`API blocked, waiting ${Math.ceil(waitTime/1000)}s`, 'warn');
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        handleRateLimit(error) {
            if (error.status === 429 || error.message.includes('rate limit')) {
                utils.log('Rate limited, waiting 60s', 'warn');
                priceCache.apiBlocked = true;
                priceCache.blockedUntil = Date.now() + BTC_CACHE_CONFIG.RATE_LIMIT_COOLDOWN;
                return true;
            }
            return false;
        }
    }

    // Initialize the BTC API client
    const btcApiClient = new FirefishBTCApiClient();

    // Enhanced cryptocurrency price fetching with BTC analysis
    const cryptoService = {
        async getPrice(symbol) {
            const cacheKey = `price_${symbol}`;
            const cached = cache.get(cacheKey);
            if (cached) return cached;

            try {
                const response = await fetch(`${CONFIG.coingeckoApi}/simple/price?ids=${symbol}&vs_currencies=usd`);
                const data = await response.json();
                
                if (data[symbol] && data[symbol].usd) {
                    const price = data[symbol].usd;
                    cache.set(cacheKey, price);
                    return price;
                }
            } catch (error) {
                utils.log(`Failed to fetch price for ${symbol}: ${error.message}`, 'error');
            }
            return null;
        },

        async getTopCoins(limit = 10) {
            const cacheKey = `top_coins_${limit}`;
            const cached = cache.get(cacheKey);
            if (cached) return cached;

            try {
                const response = await fetch(`${CONFIG.coingeckoApi}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`);
                const data = await response.json();
                
                const coins = data.map(coin => ({
                    id: coin.id,
                    symbol: (coin.symbol || '').toUpperCase(),
                    name: coin.name,
                    price: coin.current_price,
                    change24h: coin.price_change_percentage_24h
                }));
                
                cache.set(cacheKey, coins);
                return coins;
            } catch (error) {
                utils.log(`Failed to fetch top coins: ${error.message}`, 'error');
                return [];
            }
        },

        // New BTC analysis methods
        async getBTCAnalysis(loanData) {
            try {
                // CRITICAL: Always call current prices first
                const currentPrices = await btcApiClient.getCurrentPriceForAllCurrencies();
                if (!currentPrices) {
                    utils.log('Failed to get current BTC prices for analysis', 'error');
                    return null;
                }

                const analysis = {
                    loanData: loanData,
                    currentBTCPrice: currentPrices.usd, // Base price in USD
                    analysis: []
                };

                for (const loan of loanData) {
                    const historicalPrice = await btcApiClient.getHistoricalPrice(loan.provisionDate, loan.currency);
                    if (!historicalPrice) continue;

                    const currentPrice = currentPrices[(loan.currency || '').toLowerCase()];
                    if (!currentPrice) continue;

                    const btcValueAtProvision = loan.collateralBTC * historicalPrice;
                    const btcValueNow = loan.collateralBTC * currentPrice;
                    const priceChange = ((currentPrice - historicalPrice) / historicalPrice) * 100;
                    const valueChange = btcValueNow - btcValueAtProvision;

                                         // Calculate performance using exact Firefish formulas
                     const performance = this.calculateFirefishBTCPerformance(loan, currentPrice, historicalPrice);
                     
                     analysis.analysis.push({
                         cardIndex: loan.cardIndex,
                         currency: loan.currency,
                         loanAmount: loan.loanAmount,
                         collateralBTC: loan.collateralBTC,
                         provisionDate: loan.provisionDate,
                         btcPriceAtProvision: historicalPrice,
                         btcPriceNow: currentPrice,
                         btcValueAtProvision: btcValueAtProvision,
                         btcValueNow: btcValueNow,
                         priceChangePercent: priceChange,
                         valueChange: valueChange,
                         loanToValueRatio: loan.loanAmount / btcValueNow,
                         riskLevel: this.calculateRiskLevel(loan.loanAmount, btcValueNow, priceChange),
                         // Add performance analysis
                         performance: performance
                     });
                }

                return analysis;

            } catch (error) {
                utils.log(`BTC analysis failed: ${error.message}`, 'error');
                return null;
            }
        },

        calculateRiskLevel(loanAmount, btcValueNow, priceChange) {
            const ltv = loanAmount / btcValueNow;
            
            if (ltv > 0.8) return 'HIGH';
            if (ltv > 0.6) return 'MEDIUM';
            if (priceChange < -20) return 'ELEVATED';
            return 'LOW';
        },
        // EXACT Firefish BTC performance calculation using precise formulas
        calculateFirefishBTCPerformance(loanData, currentPrice, historicalPrice) {
            try {
                const { currency, loanAmount, interestRate, provisionDate, collateralBTC } = loanData;
                
                // NEW FORMULA: BTC value change if loan amount was used to buy BTC at provision date
                // Investment performance comparison: buying BTC vs taking loan
                const btcValueChange = loanAmount * (currentPrice / historicalPrice - 1);
                const btcPercentageChange = ((currentPrice - historicalPrice) / historicalPrice) * 100;
                
                // Calculate loan interest cost (the cost of borrowing)
                const loanInterestCost = loanAmount * (interestRate / 100);
                
                // Performance comparison: Is BTC investment gain > loan interest cost?
                const isOutperforming = btcValueChange > loanInterestCost;
                
                // Calculate theoretical gain/loss: BTC Value Change - Loan Interest Cost
                const theoreticalResult = btcValueChange - loanInterestCost;
                const theoreticalLabel = theoreticalResult > 0 ? 'Theoretical Gain' : 'Theoretical Loss';
                const theoreticalValue = Math.abs(theoreticalResult);
                
                // Format currency values using Intl.NumberFormat
                const formatCurrency = (value) => {
                    return new Intl.NumberFormat('en-DE', {
                        style: 'currency',
                        currency: currency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }).format(value);
                };
                
                // Format percentage values with + sign for positive
                const formatPercentage = (value) => {
                    const sign = value >= 0 ? '+' : '';
                    return `${sign}${value.toFixed(1)}%`;
                };
                
                const performance = {
                    // Main comparison values
                    btcValueChange: formatCurrency(btcValueChange),
                    btcPercentageChange: formatPercentage(btcPercentageChange), 
                    loanInterestCost: formatCurrency(loanInterestCost),
                    loanInterestRate: formatPercentage(interestRate),
                    
                    // Theoretical gain/loss
                    theoreticalResult: formatCurrency(theoreticalValue),
                    theoreticalLabel,
                    
                    // Price data for display
                    initialBTCPrice: formatCurrency(historicalPrice),
                    currentBTCPrice: formatCurrency(currentPrice),
                    
                    // Performance status
                    isOutperforming,
                    
                    // Display data
                    provisionDate,
                    currency,
                    collateralBTC,
                    
                    // Raw values for further calculations
                    raw: {
                        btcValueChange,
                        btcPercentageChange, 
                        loanInterestCost,
                        historicalPrice,
                        currentPrice,
                        theoreticalResult
                    }
                };
                
                utils.log(`Performance: ${performance.isOutperforming ? 'OUT' : 'UNDER'}PERFORMING - BTC Investment: ${performance.btcValueChange} vs Interest: ${performance.loanInterestCost}`);
                
                return performance;
                
            } catch (error) {
                utils.log(`Error calculating performance: ${error.message}`, 'error');
                return null;
            }
        },

        async getBTCPriceHistory(currency = 'usd', days = 30) {
            const cacheKey = `btc_history_${currency}_${days}`;
            const cached = cache.get(cacheKey);
            if (cached) return cached;

            try {
                const response = await fetch(
                    `${CONFIG.coingeckoApi}/coins/bitcoin/market_chart?vs_currency=${currency}&days=${days}`
                );
                
                if (!response.ok) {
                    throw new Error(`BTC history API failed: ${response.status}`);
                }

                const data = await response.json();
                const prices = data.prices.map(([timestamp, price]) => ({
                    date: new Date(timestamp),
                    price: price
                }));

                cache.set(cacheKey, prices);
                return prices;

            } catch (error) {
                utils.log(`Failed to fetch BTC price history: ${error.message}`, 'error');
                return [];
            }
        }
    };

    // UI enhancements
    const uiEnhancer = {
        init() {
            if (!CONFIG.features.enhancedUI) return;
            
            // Only proceed if we have valid Firefish loan cards
            if (!firefishDetector.validateFirefishPage()) {
                utils.log('Skipping UI enhancement - no valid Firefish loan cards');
                return;
            }

            this.addStyles();
            this.enhanceFirefishUI();
        },

        addStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .uxplus-enhanced {
                    border-radius: 8px !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
                    transition: all 0.2s ease !important;
                }
                
                .uxplus-crypto-price {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-weight: 600;
                    margin: 4px;
                    display: inline-block;
                }
                
                .uxplus-quick-action {
                    background: #f8f9fa;
                    border: 1px solid #dee2e6;
                    border-radius: 6px;
                    padding: 8px 12px;
                    margin: 4px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .uxplus-quick-action:hover {
                    background: #e9ecef;
                    border-color: #adb5bd;
                }

                .uxplus-btc-analysis {
                    background: linear-gradient(135deg, #f7931a 0%, #ff9500 100%);
                    color: white;
                    padding: 12px;
                    border-radius: 8px;
                    margin: 8px 0;
                    font-weight: 500;
                }
            `;
            document.head.appendChild(style);
            
            // Inject Firefish BTC styles
            this.injectFirefishBTCStyles();
        },
        // CSS injection for Firefish BTC results
        injectFirefishBTCStyles() {
            if (document.getElementById('firefish-btc-styles')) return;
            
            const styles = `
                <style id="firefish-btc-styles">
                .firefish-btc-loading {
                    border-left: 3px solid #1890ff !important;
                    background: #f6f9ff;
                    animation: fadeIn 0.3s ease-in;
                }
                
                .firefish-loading-spinner {
                    display: inline-block;
                    animation: spin 1s linear infinite;
                    margin-right: 5px;
                    color: #1890ff;
                    font-size: 16px;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .firefish-btc-results {
                    border-left: 3px solid #52c41a !important;
                    animation: fadeIn 0.5s ease-in;
                }
                
                .firefish-btc-outperforming {
                    border-left-color: #52c41a !important;
                }
                
                .firefish-btc-underperforming {
                    border-left-color: #ff4d4f !important;
                }
                
                .tooltip-icon {
                    margin-left: 5px;
                    opacity: 0.7;
                    cursor: help;
                    font-size: 12px;
                    transition: opacity 0.2s ease;
                }
                
                .tooltip-icon:hover {
                    opacity: 1.0;
                }
                
                @keyframes fadeIn {
                    0% { opacity: 0; transform: translateY(-10px); }
                    100% { opacity: 1; transform: translateY(0); }
                }
                
                /* Portfolio Summary Dashboard (global injection to ensure it loads) */
                .ant-card.portfolio-summary-card {
                    margin-bottom: 12px !important;
                    border-radius: 8px !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
                    transition: all 0.2s ease !important;
                    background: #ffffff !important;
                    border: 1px solid #d9d9d9 !important;
                }
                .ant-card.portfolio-summary-card .ant-card-body {
                    padding: 16px !important;
                    border-radius: 8px !important;
                }
                .ant-card.portfolio-summary-card h3 {
                    margin: 0 0 16px 0 !important;
                    font-size: 16px !important;
                    font-weight: 600 !important;
                    color: #262626 !important;
                }
                .ant-card.portfolio-summary-card .portfolio-metrics {
                    display: grid !important;
                    grid-template-columns: repeat(2, minmax(0,1fr)) !important;
                    gap: 12px !important;
                    margin-top: 8px !important;
                }
                .ant-card.portfolio-summary-card .portfolio-metric {
                    background: #f8f9fa !important;
                    border: 1px solid #e9ecef !important;
                    border-radius: 6px !important;
                    padding: 12px !important;
                    text-align: center !important;
                }
                .ant-card.portfolio-summary-card .portfolio-metric-label {
                    font-size: 12px !important;
                    color: #6c757d !important;
                    margin-bottom: 4px !important;
                    font-weight: 500 !important;
                }
                .ant-card.portfolio-summary-card .portfolio-metric-value {
                    font-size: 16px !important;
                    font-weight: 600 !important;
                    color: #262626 !important;
                }
                .ant-card.portfolio-summary-card.portfolio-summary-complete .positive { color: #52c41a !important; font-weight: 600 !important; }
                .ant-card.portfolio-summary-card.portfolio-summary-complete .negative { color: #ff4d4f !important; font-weight: 600 !important; }
                @media (max-width: 768px) {
                    .ant-card.portfolio-summary-card .portfolio-metrics { grid-template-columns: 1fr !important; }
                }
                </style>
            `;
            
            document.head.insertAdjacentHTML('beforeend', styles);
        },

        // Enhanced loading state function for Firefish BTC analysis
        showFirefishLoadingState(loanCard) {
            // Skip if already has loading or results
            if (loanCard.querySelector('.firefish-btc-loading, .firefish-btc-results')) return;
            
            // Remove any existing displays
            const existingDisplays = loanCard.querySelectorAll('.firefish-btc-loading, .firefish-btc-results, .firefish-btc-error');
            existingDisplays.forEach(display => display.remove());
            
            // Create prominent loading div
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'firefish-btc-loading';
            loadingDiv.style.cssText = 'border-left: 3px solid #1890ff !important; padding: 12px; margin: 8px 0; background: #f6f9ff;';
            loadingDiv.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; font-weight: bold; color: #1890ff;">
                    <span class="firefish-loading-spinner" style="font-size: 16px; margin-right: 8px;">⟳</span>
                    Analyzing BTC Performance...
                </div>
            `;
            
            // Find injection point and add loading
            const existingDetails = loanCard.querySelector('._details_1gfcb_5._details_gxzzy_12');
            if (existingDetails) {
                existingDetails.parentNode.insertBefore(loadingDiv, existingDetails.nextSibling);
            }
            if (typeof uiEnhancer?.updatePortfolioDashboard === 'function') {
                uiEnhancer.updatePortfolioDashboard();
            }
        },

        // Results display function for Firefish BTC analysis
        showFirefishBTCResults(loanCard, performance) {
            // Remove any existing displays
            const existingDisplays = loanCard.querySelectorAll('.firefish-btc-loading, .firefish-btc-results');
            existingDisplays.forEach(display => display.remove());
            
            const performanceClass = performance.isOutperforming ? 
                'firefish-btc-outperforming' : 'firefish-btc-underperforming';
            
            const statusIcon = performance.isOutperforming ? '✅' : '❌';
            const statusText = performance.isOutperforming ? 'Outperforming' : 'Underperforming';
            
            const resultsHTML = `
                <div class="_details_1gfcb_5 _details_gxzzy_12 firefish-btc-results ${performanceClass}">
                    <div class="ant-row _field_1gfcb_21" style="margin-bottom: 8px;">
                        <div class="ant-col ant-col-24" style="text-align: center; font-weight: bold; font-size: 14px;">
                            BTC Performance Analysis
                            <span class="tooltip-icon" title="Comprehensive analysis comparing Bitcoin investment strategy vs loan interest costs. Shows whether buying Bitcoin with your loan amount would have outperformed paying the loan interest. Includes historical and current BTC prices, value changes, and net theoretical gain or loss from the BTC strategy.">ℹ️</span>
                        </div>
                    </div>
                    <div class="ant-row _field_1gfcb_21">
                        <div class="ant-col ant-col-13 _fieldTitle_1gfcb_40">BTC Performance Analysis</div>
                        <div class="ant-col ant-col-11 _fieldValue_1gfcb_41">${statusIcon} ${statusText}</div>
                    </div>
                    <div class="ant-row _field_1gfcb_21">
                        <div class="ant-col ant-col-13 _fieldTitle_1gfcb_40">
                            BTC Price Provision Date
                            <span class="tooltip-icon" title="Historical BTC price pulled from API for ${performance.provisionDate}. This is the BTC price on your specific loan provision date.">ℹ️</span>
                        </div>
                        <div class="ant-col ant-col-11 _fieldValue_1gfcb_41">${performance.initialBTCPrice}</div>
                    </div>
                    <div class="ant-row _field_1gfcb_21">
                        <div class="ant-col ant-col-13 _fieldTitle_1gfcb_40">
                            BTC Price Now
                            <span class="tooltip-icon" title="Current BTC price from API. Price is cached for 15 minutes to avoid excessive API calls.">ℹ️</span>
                        </div>
                        <div class="ant-col ant-col-11 _fieldValue_1gfcb_41">${performance.currentBTCPrice}</div>
                    </div>
                    <div class="ant-row _field_1gfcb_21">
                        <div class="ant-col ant-col-13 _fieldTitle_1gfcb_40">
                            BTC Value Change
                            <span class="tooltip-icon" title="How much you would have gained/lost if you used the loan amount to buy BTC instead of taking the loan. Formula: Loan Amount × (Current BTC Price / BTC Price at Loan Date - 1)">ℹ️</span>
                        </div>
                        <div class="ant-col ant-col-11 _fieldValue_1gfcb_41">${performance.btcValueChange}</div>
                    </div>
                    <div class="ant-row _field_1gfcb_21">
                        <div class="ant-col ant-col-13 _fieldTitle_1gfcb_40">
                            Loan Interest Cost
                            <span class="tooltip-icon" title="The total interest you pay for this loan over its duration. Loan Amount × Interest Rate">ℹ️</span>
                        </div>
                        <div class="ant-col ant-col-11 _fieldValue_1gfcb_41">${performance.loanInterestCost}</div>
                    </div>
                    <div class="ant-row _field_1gfcb_21">
                        <div class="ant-col ant-col-13 _fieldTitle_1gfcb_40">
                            ${performance.theoreticalLabel}
                            <span class="tooltip-icon" title="Net profit or loss from choosing BTC investment strategy over loan strategy. Formula: BTC Value Change - Loan Interest Cost">ℹ️</span>
                        </div>
                        <div class="ant-col ant-col-11 _fieldValue_1gfcb_41">${performance.theoreticalResult}</div>
                    </div>
                </div>
            `;
            
            const existingDetails = loanCard.querySelector('._details_1gfcb_5._details_gxzzy_12');
            if (existingDetails) {
                existingDetails.insertAdjacentHTML('afterend', resultsHTML);
            }
            // Mark result shown and update dashboard
            try { loanCard.dataset.firefishBtcResultShown = 'true'; } catch(e) {}
            if (typeof uiEnhancer?.updatePortfolioDashboard === 'function') {
                uiEnhancer.updatePortfolioDashboard();
            }
        },

        // Portfolio Dashboard: inject above card stack/content
        injectPortfolioDashboard() {
            if (document.querySelector('.portfolio-summary-card')) return;
            const loadingHtml = `
                <div class="ant-card ant-card-bordered portfolio-summary-card">
                  <div class="ant-card-body">
                    <div style="text-align: center; padding: 20px;">
                      <span class="firefish-loading-spinner">⟳</span>
                      Calculating portfolio performance... (<span class="pf-analyzed">0</span> of <span class="pf-total">0</span> loans analyzed)
                    </div>
                  </div>
                </div>`;
            const content = document.querySelector('._content_pndzt_5') || document.querySelector('main') || document.body;
            const cardStack = content?.querySelector('._cardStack_jcnfb_5') || document.querySelector('._cardStack_jcnfb_5');
            if (cardStack && cardStack.parentNode) {
                cardStack.parentNode.insertBefore(document.createRange().createContextualFragment(loadingHtml), cardStack);
                return;
            }
            // Fallback: insert before first loan card
            const firstCard = document.querySelector('._activeCard_fvh4n_5');
            if (firstCard && firstCard.parentNode) {
                firstCard.parentNode.insertBefore(document.createRange().createContextualFragment(loadingHtml), firstCard);
                return;
            }
            // Final fallback: prepend to content
            content?.insertAdjacentHTML('afterbegin', loadingHtml);
        },

        // Aggregate and update portfolio dashboard state
        updatePortfolioDashboard() {
            // Ensure injected
            if (typeof uiEnhancer?.injectPortfolioDashboard === 'function') uiEnhancer.injectPortfolioDashboard();
            const dashboard = document.querySelector('.portfolio-summary-card');
            if (!dashboard) return;

            const totals = uiEnhancer.aggregatePortfolioData();
            // Update loading state counts if not complete
            const isComplete = totals.analyzedCount >= totals.totalLoans && totals.totalLoans > 0;
            if (!isComplete) {
                const analyzedEl = dashboard.querySelector('.pf-analyzed');
                const totalEl = dashboard.querySelector('.pf-total');
                if (analyzedEl) analyzedEl.textContent = String(totals.analyzedCount);
                if (totalEl) totalEl.textContent = String(totals.totalLoans);
                return;
            }

            const statusClass = totals.totalTheoretical >= 0 ? 'positive' : 'negative';
            const html = `
                <div class="ant-card ant-card-bordered portfolio-summary-card portfolio-summary-complete">
                  <div class="ant-card-body">
                    <div class="ant-row _container_148t9_5">
                      <div class="ant-col ant-col-24">
                        <h3>Portfolio BTC Performance Summary</h3>
                        <div class="portfolio-metrics">
                          <div class="portfolio-metric">
                            <div class="portfolio-metric-label">Total Theoretical Gain/Loss <span class="tooltip-icon" title="Sum of net BTC strategy results across analyzed loans">ℹ️</span></div>
                            <div class="portfolio-metric-value ${statusClass}">€${utils.formatNumber(totals.totalTheoretical)}</div>
                          </div>
                          <div class="portfolio-metric">
                            <div class="portfolio-metric-label">Loan Count Summary</div>
                            <div class="portfolio-metric-value">${totals.outperformingCount} of ${totals.analyzedCount} loans outperforming</div>
                          </div>
                          <div class="portfolio-metric">
                            <div class="portfolio-metric-label">Portfolio Value <span class="tooltip-icon" title="Sum of loan amounts for analyzed loans">ℹ️</span></div>
                            <div class="portfolio-metric-value">€${utils.formatNumber(totals.totalLoanAmount, 0)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>`;
            dashboard.outerHTML = html;
        },
        // Compute aggregated metrics from rendered results
        aggregatePortfolioData() {
            const allCards = Array.from(document.querySelectorAll('._activeCard_fvh4n_5'));
            const isPending = (card) => {
                try {
                    const bodies = card.querySelectorAll('.ant-card-body');
                    for (const el of bodies) {
                        if (el.textContent && el.textContent.toUpperCase().includes('PENDING')) return true;
                    }
                } catch (e) {}
                return false;
            };
            const validCards = allCards.filter(card => !isPending(card));
            const totalLoans = validCards.length;

            const resultEls = Array.from(document.querySelectorAll('.firefish-btc-results'))
                .filter(res => {
                    const card = res.closest('._activeCard_fvh4n_5');
                    return card && !isPending(card);
                });
            const errorEls = Array.from(document.querySelectorAll('.firefish-btc-error'))
                .filter(err => {
                    const card = err.closest('._activeCard_fvh4n_5');
                    return card && !isPending(card);
                });

            let totalTheoretical = 0;
            let outperformingCount = 0;
            let totalLoanAmount = 0;

            resultEls.forEach(res => {
                // Check if this result is outperforming or underperforming
                const isOutperforming = res.classList.contains('firefish-btc-outperforming');
                if (isOutperforming) outperformingCount++;
                
                // Find the theoretical gain/loss value (last monetary value in the result)
                const valueFields = res.querySelectorAll('._fieldValue_1gfcb_41');
                if (valueFields.length > 0) {
                    const lastText = valueFields[valueFields.length - 1].textContent || '';
                    const num = utils.parseNumberFromText(lastText);
                    if (!isNaN(num)) {
                        // Apply correct sign based on performance status
                        // Underperforming loans should contribute negative values
                        totalTheoretical += isOutperforming ? num : -num;
                    }
                }
                
                // Extract loan amount for portfolio value
                const card = res.closest('._activeCard_fvh4n_5');
                const amountEl = card?.querySelector('._amount_148t9_34');
                if (amountEl) {
                    const amt = utils.parseNumberFromText(amountEl.textContent || '');
                    if (!isNaN(amt)) totalLoanAmount += amt;
                }
            });

            const analyzedCount = resultEls.length + errorEls.length;
            return { totalLoans, analyzedCount, totalTheoretical, outperformingCount, totalLoanAmount };
        },

        enhanceFirefishUI() {
            if (!firefishDetector.isInitialized) return;

            // Add crypto price widget to dashboard
            this.addCryptoPriceWidget();
            
            // Add quick action buttons
            this.addQuickActions();
            
            // Enhance existing UI elements
            this.enhanceExistingElements();

            // Add BTC analysis to loan cards
            this.addBTCAnalysis();
        },

        async addCryptoPriceWidget() {
            const dashboard = document.querySelector('[data-testid="dashboard"], .dashboard, main');
            if (!dashboard) return;

            const widget = document.createElement('div');
            widget.className = 'uxplus-crypto-widget';
            widget.innerHTML = `
                <h3>🪙 Crypto Prices</h3>
                <div id="crypto-prices"></div>
            `;

            dashboard.insertBefore(widget, dashboard.firstChild);
            
            // Fetch and display prices
            const topCoins = await cryptoService.getTopCoins(5);
            const pricesContainer = document.getElementById('crypto-prices');
            
            topCoins.forEach(coin => {
                const priceElement = document.createElement('div');
                priceElement.className = 'uxplus-crypto-price';
                priceElement.innerHTML = `
                    ${coin.symbol}: ${utils.formatCurrency(coin.price)}
                    <small style="opacity: 0.8; margin-left: 8px;">
                        ${coin.change24h > 0 ? '+' : ''}${coin.change24h.toFixed(2)}%
                    </small>
                `;
                pricesContainer.appendChild(priceElement);
            });
        },

        addQuickActions() {
            const header = document.querySelector('header, .header, nav');
            if (!header) return;

            const actionsContainer = document.createElement('div');
            actionsContainer.className = 'uxplus-quick-actions';
            actionsContainer.innerHTML = `
                <button class="uxplus-quick-action" onclick="window.uxplusQuickAction('refresh')">
                    🔄 Refresh
                </button>
                <button class="uxplus-quick-action" onclick="window.uxplusQuickAction('crypto')">
                    💰 Crypto
                </button>
                <button class="uxplus-quick-action" onclick="window.uxplusQuickAction('btc-analysis')">
                    ₿ BTC Analysis
                </button>
                <button class="uxplus-quick-action" onclick="window.uxplusQuickAction('btc-analysis-run')" style="background: linear-gradient(135deg, #f7931a 0%, #ff9500 100%); color: white;">
                    🚀 Run Analysis
                </button>
                <button class="uxplus-quick-action" onclick="window.uxplusQuickAction('performance-analysis')" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white;">
                    📊 Performance
                </button>
            `;

            header.appendChild(actionsContainer);
        },

        enhanceExistingElements() {
            // Add enhanced styling to existing elements
            const elements = document.querySelectorAll('.card, .panel, .widget');
            elements.forEach(el => {
                el.classList.add('uxplus-enhanced');
            });
        },

        addBTCAnalysis() {
            if (!CONFIG.features.btcAnalysis) return;

            firefishDetector.loanCards.forEach((card, index) => {
                try {
                    // Check if BTC analysis already exists
                    if (card.querySelector('.uxplus-btc-analysis')) return;

                    const btcAnalysis = document.createElement('div');
                    btcAnalysis.className = 'uxplus-btc-analysis';
                    btcAnalysis.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>₿ Bitcoin Analysis</span>
                            <span style="font-size: 12px;">Card ${index + 1}</span>
                        </div>
                        <div style="margin-top: 8px; font-size: 11px; opacity: 0.9;">
                            Enhanced with UX+ extension
                        </div>
                    `;

                    // Insert after the card's main content
                    const cardContent = card.querySelector(CONFIG.selectors.detailsSection);
                    if (cardContent) {
                        cardContent.appendChild(btcAnalysis);
                    }
                } catch (error) {
                    utils.log(`Error adding BTC analysis to card ${index}: ${error.message}`, 'error');
                }
            });
        }
    };
    // Global debug function for development
    window.firefishBTC = {
        getStatus: () => firefishDetector.getStatus(),
        getLoanData: () => firefishDetector.getAllLoanData(),
        debugCard: (index) => firefishDetector.debugLoanCard(index),
        getCards: () => firefishDetector.loanCards,
        // BTC Analysis methods
        getBTCAnalysis: async () => await cryptoService.getBTCAnalysis(firefishDetector.getAllLoanData()),
        getBTCPriceHistory: async (currency = 'usd', days = 30) => await cryptoService.getBTCPriceHistory(currency, days),
        getCurrentBTCPrices: async () => await btcApiClient.getCurrentPriceForAllCurrencies(),
        clearBTCCache: () => {
            priceCache.current = { data: null, timestamp: null, currencies: new Set() };
            priceCache.historical.clear();
            priceCache.apiBlocked = false;
            priceCache.blockedUntil = null;
            utils.log('BTC price cache cleared');
        },
        // Performance Analysis methods
        getPerformanceAnalysis: async (cardIndex = 0) => {
            const loanData = firefishDetector.getAllLoanData();
            if (cardIndex >= loanData.length) return null;
            
            const loan = loanData[cardIndex];
            const currentPrices = await btcApiClient.getCurrentPriceForAllCurrencies();
            const historicalPrice = await btcApiClient.getHistoricalPrice(loan.provisionDate, loan.currency);
            
            if (!currentPrices || !historicalPrice) return null;
            
            const currentPrice = currentPrices[(loan.currency || '').toLowerCase()];
            return cryptoService.calculateFirefishBTCPerformance(loan, currentPrice, historicalPrice);
        }
    };

    // Quick action handler
    window.uxplusQuickAction = function(action) {
        switch(action) {
            case 'refresh':
                location.reload();
                break;
            case 'crypto':
                // Toggle crypto widget
                const widget = document.querySelector('.uxplus-crypto-widget');
                if (widget) {
                    widget.style.display = widget.style.display === 'none' ? 'block' : 'none';
                }
                break;
            case 'btc-analysis':
                // Toggle BTC analysis
                const btcElements = document.querySelectorAll('.uxplus-btc-analysis');
                btcElements.forEach(el => {
                    el.style.display = el.style.display === 'none' ? 'block' : 'none';
                });
                break;
                
            case 'btc-analysis-run':
                // Run BTC analysis and display results
                (async () => {
                    try {
                        utils.log('Running BTC analysis...');
                        const analysis = await cryptoService.getBTCAnalysis(firefishDetector.getAllLoanData());
                        if (analysis) {
                            utils.log('BTC Analysis completed:', 'info', analysis);
                            // You can add UI display logic here
                            alert(`BTC Analysis Complete!\nAnalyzed ${analysis.analysis.length} loans\nCurrent BTC Price: $${analysis.currentBTCPrice.toLocaleString()}`);
                        } else {
                            utils.log('BTC Analysis failed', 'error');
                            alert('BTC Analysis failed. Check console for details.');
                        }
                    } catch (error) {
                        utils.log(`BTC Analysis error: ${error.message}`, 'error');
                        alert(`BTC Analysis error: ${error.message}`);
                    }
                })();
                break;
                
            case 'performance-analysis':
                // Run detailed performance analysis for first loan card
                (async () => {
                    try {
                        utils.log('Running performance analysis...');
                        const performance = await firefishBTC.getPerformanceAnalysis(0);
                        if (performance) {
                            utils.log('Performance analysis completed:', 'info', performance);
                            const status = performance.isOutperforming ? 'OUTPERFORMING' : 'UNDERPERFORMING';
                            alert(`Performance Analysis Complete!\n\nStatus: ${status}\nBTC Value Change: ${performance.btcValueChange}\nBTC % Change: ${performance.btcPercentageChange}\nLoan Interest Cost: ${performance.loanInterestCost}\n\nBTC is ${performance.isOutperforming ? 'outperforming' : 'underperforming'} the loan interest cost.`);
                        } else {
                            utils.log('Performance analysis failed', 'error');
                            alert('Performance analysis failed. Check console for details.');
                        }
                    } catch (error) {
                        utils.log(`Performance analysis error: ${error.message}`, 'error');
                        alert(`Performance analysis error: ${error.message}`);
                    }
                })();
                break;
            case 'settings':
                // Open extension popup or show settings
                chrome.runtime.sendMessage({ action: 'openPopup' });
                break;
        }
    };
    // Message handling
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch(request.action) {
            case 'getStatus':
                sendResponse(firefishDetector.getStatus());
                break;
                
            case 'getLoanData':
                const loanData = firefishDetector.getAllLoanData();
                sendResponse({ 
                    success: true, 
                    data: loanData,
                    totalCards: firefishDetector.loanCards.length,
                    validCards: loanData.length
                });
                break;
                
            case 'debugLoanCard':
                const cardIndex = request.cardIndex || 0;
                const debugInfo = firefishDetector.debugLoanCard(cardIndex);
                sendResponse({ 
                    success: true, 
                    debugInfo: debugInfo
                });
                break;
                
            case 'getBTCAnalysis':
                (async () => {
                    try {
                        const loanData = firefishDetector.getAllLoanData();
                        if (loanData.length === 0) {
                            sendResponse({ 
                                success: false, 
                                error: 'No valid loan data found' 
                            });
                            return;
                        }
                        
                        const analysis = await cryptoService.getBTCAnalysis(loanData);
                        sendResponse({ 
                            success: true, 
                            analysis: analysis 
                        });
                    } catch (error) {
                        sendResponse({ 
                            success: false, 
                            error: error.message 
                        });
                    }
                })();
                return true; // Keep message channel open for async response
                
            case 'getBTCPriceHistory':
                (async () => {
                    try {
                        const currency = request.currency || 'usd';
                        const days = request.days || 30;
                        const history = await cryptoService.getBTCPriceHistory(currency, days);
                        sendResponse({ 
                            success: true, 
                            history: history 
                        });
                    } catch (error) {
                        sendResponse({ 
                            success: false, 
                            error: error.message 
                        });
                    }
                })();
                return true; // Keep message channel open for async response
            case 'getPerformanceAnalysis':
                (async () => {
                    try {
                        const cardIndex = request.cardIndex || 0;
                        const loanData = firefishDetector.getAllLoanData();
                        
                        if (cardIndex >= loanData.length) {
                            sendResponse({ 
                                success: false, 
                                error: `Card index ${cardIndex} out of range. Total cards: ${loanData.length}` 
                            });
                            return;
                        }
                        
                        const loan = loanData[cardIndex];
                        const currentPrices = await btcApiClient.getCurrentPriceForAllCurrencies();
                        const historicalPrice = await btcApiClient.getHistoricalPrice(loan.provisionDate, loan.currency);
                        
                        if (!currentPrices || !historicalPrice) {
                            sendResponse({ 
                                success: false, 
                                error: 'Failed to fetch BTC prices for analysis' 
                            });
                            return;
                        }
                        
                        const currentPrice = currentPrices[(loan.currency || '').toLowerCase()];
                        const performance = cryptoService.calculateFirefishBTCPerformance(loan, currentPrice, historicalPrice);
                        
                        sendResponse({ 
                            success: true, 
                            performance: performance,
                            loanData: loan,
                            prices: {
                                current: currentPrice,
                                historical: historicalPrice
                            }
                        });
                    } catch (error) {
                        sendResponse({ 
                            success: false, 
                            error: error.message 
                        });
                    }
                })();
                return true; // Keep message channel open for async response
                

                
            case 'getCryptoPrice':
                cryptoService.getPrice(request.symbol).then(price => {
                    sendResponse({ price: price });
                });
                return true; // Keep message channel open for async response
                
            case 'getTopCoins':
                cryptoService.getTopCoins(request.limit).then(coins => {
                    sendResponse({ coins: coins });
                });
                return true;
                
            case 'clearCache':
                cache.clear();
                sendResponse({ success: true });
                break;
        }
    });
    

    // Initialize extension
    function init() {
        utils.log('Initializing Insight+ for Firefish extension');
        
        // Only proceed if we're on the specific Firefish loans tab page
        if (!utils.isFirefishLoansTabPage()) {
            utils.log('Not on Firefish loans tab page, skipping BTC analysis', 'info');
            return;
        }
        
        utils.log('On Firefish loans tab page, proceeding with BTC analysis initialization', 'info');

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeFirefish);
        } else {
            initializeFirefish();
        }
    }
    // Track retry attempts to prevent infinite loops
    let retryCount = 0;
    const MAX_RETRIES = 10; // Maximum 10 retries (20 seconds total)
    
    function initializeFirefish() {
        // Validate Firefish page structure
        if (!firefishDetector.validateFirefishPage()) {
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                utils.log(`Maximum retry attempts (${MAX_RETRIES}) reached. Stopping retry loop.`, 'warn');
                return;
            }
            utils.log(`Firefish page validation failed, retrying in 2 seconds... (attempt ${retryCount}/${MAX_RETRIES})`, 'info');
            setTimeout(initializeFirefish, 2000);
            return;
        }
        
        // Reset retry count on success
        retryCount = 0;

        // Setup mutation observer for dynamic content
        firefishDetector.setupMutationObserver();
        
        // Initialize UI enhancements
        uiEnhancer.init();
        
        // Mark as initialized
        firefishDetector.isInitialized = true;
        
        utils.log('Insight+ for Firefish extension initialized successfully');
        
        // Send initial status update
        firefishDetector.notifyLoanCardUpdate();
    }

    // Firefish BTC Analyzer - Complete processing pipeline
    class FirefishBTCAnalyzer {
        constructor() {
            this.apiClient = btcApiClient;
            this.observer = null;
            this.processingQueue = new Set();
        }
        
        async processFirefishLoanCard(loanCard) {
            try {
                // Mark as processing to prevent duplicate analysis
                if (loanCard.dataset.firefishBtcProcessed === 'true') return;
                loanCard.dataset.firefishBtcProcessed = 'true';
                
                // Step 1: Show loading state immediately
                uiEnhancer.showFirefishLoadingState(loanCard);
                
                // Step 2: Extract loan data using Firefish selectors
                const loanData = firefishDetector.extractFirefishLoanData(loanCard);
                if (!loanData || !loanData.isValid) {
                    this.showFirefishError(loanCard, 'Could not extract loan data');
                    return;
                }
                
                utils.log('Processing loan:', 'info', {
                    amount: `${loanData.currency} ${loanData.loanAmount}`,
                    rate: `${loanData.interestRate}%`,
                    date: loanData.provisionDate,
                    btc: loanData.collateralBTC
                });
                
                // Step 3: Get current BTC price (cached if available)
                const currentPrices = await this.apiClient.getCurrentPriceForAllCurrencies();
                if (!currentPrices) {
                    this.showFirefishError(loanCard, 'Failed to fetch current BTC prices');
                    return;
                }
                
                const currency = (loanData.currency || '').toLowerCase();
                const currentPrice = currentPrices[currency];
                
                // Step 4: Get historical BTC price for provision date
                const historicalPrice = await this.apiClient.getHistoricalPrice(
                    loanData.provisionDate, 
                    loanData.currency,
                    loanCard // Pass loan card for rate limit handling
                );
                
                if (!historicalPrice) {
                    // Check if this was due to rate limiting
                    if (rateLimitState.isRateLimited) {
                        console.log('[Firefish-BTC] Card queued for retry after rate limit');
                        return; // Card will be retried after rate limit resolves
                    }
                    
                    this.showFirefishError(loanCard, `Failed to fetch BTC price for ${loanData.provisionDate}`);
                    return;
                }
                
                // Step 5: Calculate performance using exact formula
                const performance = cryptoService.calculateFirefishBTCPerformance(
                    loanData, 
                    currentPrice, 
                    historicalPrice
                );
                
                if (!performance) {
                    this.showFirefishError(loanCard, 'Performance calculation failed');
                    return;
                }
                
                // Step 6: Display results
                uiEnhancer.showFirefishBTCResults(loanCard, performance);
                
                utils.log(`Analysis complete: ${performance.isOutperforming ? 'OUTPERFORMING' : 'UNDERPERFORMING'}`);
                
            } catch (error) {
                utils.log(`Processing error: ${error.message}`, 'error');
                this.showFirefishError(loanCard, 'Processing error occurred');
            }
        }
        showFirefishError(loanCard, errorMessage) {
            // Remove existing displays
            const existingDisplays = loanCard.querySelectorAll('.firefish-btc-loading, .firefish-btc-results');
            existingDisplays.forEach(display => display.remove());
            
            // Create error div
            const errorDiv = document.createElement('div');
            errorDiv.className = 'firefish-btc-error';
            errorDiv.innerHTML = `<span style="color: #ff4d4f;">❌ ${errorMessage}</span>`;
            
            // Find injection point and add error
            const existingDetails = loanCard.querySelector('._details_1gfcb_5._details_gxzzy_12');
            if (existingDetails) {
                existingDetails.parentNode.insertBefore(errorDiv, existingDetails.nextSibling);
            }
            if (typeof uiEnhancer?.updatePortfolioDashboard === 'function') {
                uiEnhancer.updatePortfolioDashboard();
            }
        }
        initializeFirefishObserver() {
            this.observer = new MutationObserver((mutations) => {
                let newCardsFound = false;
                
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Look for new Firefish loan cards
                                const newLoanCards = node.querySelectorAll('._activeCard_fvh4n_5:not([data-firefish-btc-processed])');
                                newLoanCards.forEach(card => {
                                    if (!this.processingQueue.has(card)) {
                                        this.processingQueue.add(card);
                                        newCardsFound = true;
                                    }
                                });
                                
                                // Check if the node itself is a loan card
                                if (node.matches && node.matches('._activeCard_fvh4n_5') && 
                                    !node.dataset.firefishBtcProcessed) {
                                    if (!this.processingQueue.has(node)) {
                                        this.processingQueue.add(node);
                                        newCardsFound = true;
                                    }
                                }
                            }
                        });
                    }
                });
                
                if (newCardsFound) {
                    // Process new cards with small delay to batch them
                    setTimeout(() => {
                        this.processQueuedCards();
                    }, 500);
                }
            });
            
            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            utils.log('MutationObserver initialized for Firefish loan cards');
        }
        async processQueuedCards() {
            const cardsToProcess = Array.from(this.processingQueue);
            this.processingQueue.clear();
            
            utils.log(`Processing ${cardsToProcess.length} queued cards`);
            
            // ENSURE LOADING IS VISIBLE for all cards before processing
            cardsToProcess.forEach(card => {
                if (!card.querySelector('.firefish-btc-loading') && typeof uiEnhancer?.showFirefishLoadingState === 'function') {
                    uiEnhancer.showFirefishLoadingState(card);
                }
            });
            
            for (const card of cardsToProcess) {
                // Check if we're rate limited
                if (rateLimitState.isRateLimited) {
                    console.log('[Firefish-BTC] Rate limited - adding card to pending queue');
                    rateLimitState.pendingCards.add(card);
                    continue;
                }
                
                await this.processFirefishLoanCard(card);
                // Small delay between cards to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Process pending cards after rate limit resolves
        async processPendingCards() {
            const pendingCards = Array.from(rateLimitState.pendingCards);
            if (pendingCards.length === 0) return;
            
            console.log(`[Firefish-BTC] Processing ${pendingCards.length} pending cards after rate limit resolution`);
            
            // Clear pending cards set
            rateLimitState.pendingCards.clear();
            
            // Add cards back to processing queue
            pendingCards.forEach(card => {
                // Reset processed flag to allow retry
                card.removeAttribute('data-firefish-btc-processed');
                this.processingQueue.add(card);
            });
            
            // Process the queue
            await this.processQueuedCards();
        }
        
        async initialize() {
            utils.log('Initializing Firefish BTC Performance Analyzer...');
            
            // Check if we're on a Firefish page
            const firefishCards = firefishDetector.detectFirefishLoanCards();
            if (firefishCards.length === 0) {
                // Check if there are any loan cards at all (including pending ones)
                const allLoanCards = document.querySelectorAll(CONFIG.selectors.loanCards);
                if (allLoanCards.length > 0) {
                    utils.log(`${allLoanCards.length} loan cards found but ${allLoanCards.length - firefishCards.length} are pending/incomplete - extension will not activate`);
                } else {
                    utils.log('No Firefish loan cards detected - extension will not activate');
                }
                return;
            }
            
            utils.log(`Found ${firefishCards.length} Firefish loan cards`);
            
            // Start observer for dynamic content
            this.initializeFirefishObserver();
            
            // Process existing cards
            for (const card of firefishCards) {
                this.processingQueue.add(card);
            }
            
            await this.processQueuedCards();
            
            utils.log('Initialization complete');
        }
    }

    // CSS Injection Function
function injectFirefishBTCStyles() {
    if (document.getElementById('firefish-btc-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'firefish-btc-styles';
    styles.textContent = `
        .firefish-btc-loading {
            border-left: 3px solid #1890ff !important;
        }
        
        .firefish-loading-spinner {
            display: inline-block;
            animation: spin 1s linear infinite;
            margin-right: 5px;
            color: #1890ff;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .firefish-btc-results {
            border-left: 3px solid #52c41a !important;
            animation: fadeIn 0.5s ease-in;
        }
        
        .firefish-btc-outperforming {
            border-left-color: #52c41a !important;
        }
        
        .firefish-btc-underperforming {
            border-left-color: #ff4d4f !important;
        }
        
        .firefish-btc-rate-limited {
            border-left: 3px solid #faad14 !important;
        }
        
        .firefish-btc-rate-limited .firefish-loading-spinner {
            color: #faad14;
            animation: none;
        }
        
        @keyframes fadeIn {
            0% { opacity: 0; transform: translateY(-10px); }
            100% { opacity: 1; transform: translateY(0); }
        }
        
        /* Portfolio Summary Dashboard (global injection to ensure it loads) */
        .ant-card.portfolio-summary-card {
            margin-bottom: 12px !important;
            border-radius: 8px !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
            transition: all 0.2s ease !important;
            background: #ffffff !important;
            border: 1px solid #d9d9d9 !important;
        }
        .ant-card.portfolio-summary-card .ant-card-body {
            padding: 16px !important;
            border-radius: 8px !important;
        }
        .ant-card.portfolio-summary-card h3 {
            margin: 0 0 16px 0 !important;
            font-size: 16px !important;
            font-weight: 600 !important;
            color: #262626 !important;
        }
        .ant-card.portfolio-summary-card .portfolio-metrics {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0,1fr)) !important;
            gap: 12px !important;
            margin-top: 8px !important;
        }
        .ant-card.portfolio-summary-card .portfolio-metric {
            background: #f8f9fa !important;
            border: 1px solid #e9ecef !important;
            border-radius: 6px !important;
            padding: 12px !important;
            text-align: center !important;
        }
        .ant-card.portfolio-summary-card .portfolio-metric-label {
            font-size: 12px !important;
            color: #6c757d !important;
            margin-bottom: 4px !important;
            font-weight: 500 !important;
        }
        .ant-card.portfolio-summary-card .portfolio-metric-value {
            font-size: 16px !important;
            font-weight: 600 !important;
            color: #262626 !important;
        }
        .ant-card.portfolio-summary-card.portfolio-summary-complete .positive { color: #52c41a !important; font-weight: 600 !important; }
        .ant-card.portfolio-summary-card.portfolio-summary-complete .negative { color: #ff4d4f !important; font-weight: 600 !important; }
        @media (max-width: 768px) {
            .ant-card.portfolio-summary-card .portfolio-metrics { grid-template-columns: 1fr !important; }
        }
    `;
    
    document.head.appendChild(styles);
}
// Defensive Firefish BTC Analyzer System
(function() {
    'use strict';
    
    console.log('[Firefish-BTC] Initializing defensive system...');
    
    // Global state management
    let firefishBTCAnalyzer = null;
    let healthCheckInterval = null;
    let isInitializing = false;
    let lastHealthCheck = Date.now();
    let defensiveSystemRunning = false;
    let navigationListenerSetup = false;
    
    // 1. Ensure FirefishBTC interface exists
    function ensureFirefishBTC() {
        if (!window.firefishBTC) {
            console.log('[Firefish-BTC] Recreating firefishBTC interface...');
            window.firefishBTC = {};
        }
        
        // Ensure all required methods exist
        if (typeof window.firefishBTC.status !== 'function') {
            window.firefishBTC.status = () => {
                console.group('🎯 Firefish BTC Analyzer Status');
                console.log('Current URL:', window.location.href);
                console.log('Is loans tab page:', utils.isFirefishLoansTabPage());
                console.log('Defensive system running:', defensiveSystemRunning);
                console.log('Navigation listener setup:', navigationListenerSetup);
                console.log('Cards detected:', document.querySelectorAll('._activeCard_fvh4n_5').length);
                console.log('Cards processed:', document.querySelectorAll('[data-firefish-btc-processed]').length);
                console.log('Loading states:', document.querySelectorAll('.firefish-btc-loading').length);
                console.log('Results displayed:', document.querySelectorAll('.firefish-btc-results').length);
                console.log('Errors:', document.querySelectorAll('.firefish-btc-error').length);
                console.log('Analyzer exists:', !!firefishBTCAnalyzer);
                console.log('Last health check:', new Date(lastHealthCheck).toLocaleTimeString());
                console.groupEnd();
            };
        }
        
        if (typeof window.firefishBTC.reprocess !== 'function') {
            window.firefishBTC.reprocess = () => {
                console.log('[Firefish-BTC] Manual reprocess triggered');
                document.querySelectorAll('[data-firefish-btc-processed]').forEach(card => {
                    card.removeAttribute('data-firefish-btc-processed');
                    card.querySelectorAll('.firefish-btc-loading, .firefish-btc-results, .firefish-btc-error').forEach(el => el.remove());
                });
                initializeDefensively();
            };
        }
        
        if (typeof window.firefishBTC.debugSelectors !== 'function') {
            window.firefishBTC.debugSelectors = () => {
                console.group('🔍 Firefish Selector Debug');
                const cards = document.querySelectorAll('._activeCard_fvh4n_5');
                console.log('Total cards found:', cards.length);
                
                if (cards.length > 0) {
                    const firstCard = cards[0];
                    console.log('First card element:', firstCard);
                    
                    // Test each selector
                    const amountEl = firstCard.querySelector('._amount_148t9_34');
                    console.log('Amount element:', amountEl, 'Text:', amountEl?.textContent);
                    
                    const interestEls = firstCard.querySelectorAll('._value_148t9_59[title*="%"]');
                    console.log('Interest elements:', interestEls);
                    interestEls.forEach((el, i) => {
                        console.log(`Interest ${i}:`, el.getAttribute('title'));
                    });
                    
                    const dateEls = firstCard.querySelectorAll('._fieldValue_1gfcb_41[title]');
                    console.log('Date elements:', dateEls);
                    dateEls.forEach((el, i) => {
                        console.log(`Date ${i}:`, el.getAttribute('title'));
                    });
                    
                    const btcLink = firstCard.querySelector('a[href*="mempool.space"]');
                    console.log('BTC link:', btcLink, 'Text:', btcLink?.textContent);
                    
                    const detailsSection = firstCard.querySelector('._details_1gfcb_5._details_gxzzy_12');
                    console.log('Details section:', detailsSection);
                }
                console.groupEnd();
            };
        }
        
        if (typeof window.firefishBTC.testExtraction !== 'function') {
            window.firefishBTC.testExtraction = () => {
                const cards = document.querySelectorAll('._activeCard_fvh4n_5');
                if (cards.length > 0) {
                    const data = firefishDetector.extractFirefishLoanData(cards[0]);
                    console.log('Extracted data:', data);
                    return data;
                }
                console.log('No cards found to test');
                return null;
            };
        }
        if (typeof window.firefishBTC.manualAnalysis !== 'function') {
            window.firefishBTC.manualAnalysis = async () => {
                console.log('🚀 Starting manual analysis...');
                const cards = document.querySelectorAll('._activeCard_fvh4n_5');
                if (cards.length > 0) {
                    console.log(`Found ${cards.length} cards, analyzing first one...`);
                    if (firefishBTCAnalyzer && typeof firefishBTCAnalyzer.processFirefishLoanCard === 'function') {
                        await firefishBTCAnalyzer.processFirefishLoanCard(cards[0]);
                    } else {
                        console.error('[Firefish-BTC] Analyzer not available for manual analysis');
                    }
                } else {
                    console.log('No cards found for manual analysis');
                }
            };
        }
        
        if (typeof window.firefishBTC.analyzer !== 'object') {
            window.firefishBTC.analyzer = firefishBTCAnalyzer;
        }
        
        if (typeof window.firefishBTC.rateLimitStatus !== 'function') {
            window.firefishBTC.rateLimitStatus = () => {
                console.group('⏳ Rate Limit Status');
                console.log('Is rate limited:', rateLimitState.isRateLimited);
                if (rateLimitState.isRateLimited) {
                    const elapsed = Date.now() - rateLimitState.rateLimitedAt;
                    const remaining = Math.max(0, BTC_CACHE_CONFIG.RATE_LIMIT_COOLDOWN - elapsed);
                    const remainingSeconds = Math.ceil(remaining / 1000);
                    console.log('Rate limited at:', new Date(rateLimitState.rateLimitedAt).toLocaleTimeString());
                    console.log('Remaining wait time:', remainingSeconds + 's');
                }
                console.log('Pending cards:', rateLimitState.pendingCards.size);
                console.log('Retry queue length:', rateLimitState.retryQueue.length);
                console.groupEnd();
            };
        }
        
        if (typeof window.firefishBTC.forceRetry !== 'function') {
            window.firefishBTC.forceRetry = () => {
                if (rateLimitState.isRateLimited) {
                    console.log('[Firefish-BTC] Force resolving rate limit...');
                    if (firefishBTCAnalyzer?.apiClient) {
                        firefishBTCAnalyzer.apiClient.resolveRateLimit();
                    }
                } else {
                    console.log('[Firefish-BTC] Not currently rate limited');
                }
            };
        }
        
        if (typeof window.firefishBTC.forceStart !== 'function') {
            window.firefishBTC.forceStart = () => {
                console.log('[Firefish-BTC] Force starting defensive system...');
                if (utils.isFirefishLoansTabPage()) {
                    startDefensiveSystem();
                } else {
                    console.log('[Firefish-BTC] Cannot force start - not on loans tab page');
                }
            };
        }
        
        console.log('[Firefish-BTC] firefishBTC interface ensured');
    }
    // 2. Safe loan card processing with error handling
    async function processLoanCardDefensively(loanCard) {
        try {
            if (!loanCard || !loanCard.nodeType) {
                console.warn('[Firefish-BTC] Invalid loan card element');
                return false;
            }
            
            // SHOW LOADING IMMEDIATELY - before any checks or processing
            if (typeof uiEnhancer?.showFirefishLoadingState === 'function') {
                uiEnhancer.showFirefishLoadingState(loanCard);
            }
            
            // Check if already processed
            if (loanCard.dataset.firefishBtcProcessed === 'true') {
                return true;
            }
            
            // Mark as processing
            loanCard.dataset.firefishBtcProcessed = 'true';
            
            // Extract loan data safely
            if (typeof firefishDetector?.extractFirefishLoanData !== 'function') {
                console.error('[Firefish-BTC] extractFirefishLoanData function not available');
                return false;
            }
            
            const loanData = firefishDetector.extractFirefishLoanData(loanCard);
            if (!loanData || !loanData.isValid) {
                console.warn('[Firefish-BTC] Failed to extract valid loan data');
                return false;
            }
            
            console.log('[Firefish-BTC] Processing loan:', {
                amount: `${loanData.currency} ${loanData.loanAmount}`,
                rate: `${loanData.interestRate}%`,
                date: loanData.provisionDate,
                btc: loanData.collateralBTC
            });
            
            // Get current BTC prices safely
            if (!firefishBTCAnalyzer?.apiClient?.getCurrentPriceForAllCurrencies) {
                console.error('[Firefish-BTC] BTC API client not available');
                return false;
            }
            
            const currentPrices = await firefishBTCAnalyzer.apiClient.getCurrentPriceForAllCurrencies();
            if (!currentPrices) {
                console.error('[Firefish-BTC] Failed to fetch current BTC prices');
                return false;
            }
            
            const currency = (loanData.currency || '').toLowerCase();
            const currentPrice = currentPrices[currency];
            
            // Get historical BTC price safely
            const historicalPrice = await firefishBTCAnalyzer.apiClient.getHistoricalPrice(
                loanData.provisionDate,
                loanData.currency,
                loanCard // Pass loan card for rate limit handling
            );
            
            if (!historicalPrice) {
                // Check if this was due to rate limiting
                if (rateLimitState.isRateLimited) {
                    console.log('[Firefish-BTC] Card queued for retry after rate limit');
                    return false; // Card will be retried after rate limit resolves
                }
                
                console.error('[Firefish-BTC] Failed to fetch historical BTC price');
                return false;
            }
            
            // Calculate performance safely
            if (typeof cryptoService?.calculateFirefishBTCPerformance !== 'function') {
                console.error('[Firefish-BTC] calculateFirefishBTCPerformance function not available');
                return false;
            }
            
            const performance = cryptoService.calculateFirefishBTCPerformance(
                loanData,
                currentPrice,
                historicalPrice
            );
            
            if (!performance) {
                console.error('[Firefish-BTC] Performance calculation failed');
                return false;
            }
            
            // Display results safely
            if (typeof showFirefishBTCResults === 'function') {
                showFirefishBTCResults(loanCard, performance);
                console.log(`[Firefish-BTC] Analysis complete: ${performance.isOutperforming ? 'OUTPERFORMING' : 'UNDERPERFORMING'}`);
                return true;
            } else {
                console.error('[Firefish-BTC] showFirefishBTCResults function not available');
                return false;
            }
            
        } catch (error) {
            console.error('[Firefish-BTC] Error processing loan card:', error);
            return false;
        }
    }
    // 3. Resilient MutationObserver that recreates if disconnected
    function startResilientObserver() {
        try {
            if (firefishBTCAnalyzer?.observer) {
                // Disconnect existing observer
                firefishBTCAnalyzer.observer.disconnect();
            }
            
            console.log('[Firefish-BTC] Starting resilient MutationObserver...');
            
            const observer = new MutationObserver((mutations) => {
                let newCardsFound = false;
                const newCards = [];
                
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Look for new Firefish loan cards
                                const newLoanCards = node.querySelectorAll('._activeCard_fvh4n_5:not([data-firefish-btc-processed])');
                                newLoanCards.forEach(card => {
                                    if (!firefishBTCAnalyzer.processingQueue.has(card)) {
                                        firefishBTCAnalyzer.processingQueue.add(card);
                                        newCards.push(card);
                                        newCardsFound = true;
                                    }
                                });
                                
                                // Check if the node itself is a loan card
                                if (node.matches && node.matches('._activeCard_fvh4n_5') && !node.dataset.firefishBtcProcessed) {
                                    if (!firefishBTCAnalyzer.processingQueue.has(node)) {
                                        firefishBTCAnalyzer.processingQueue.add(node);
                                        newCards.push(node);
                                        newCardsFound = true;
                                    }
                                }
                            }
                        });
                    }
                });
                
                if (newCardsFound) {
                    // SHOW LOADING IMMEDIATELY for all detected cards
                    newCards.forEach(card => {
                        if (typeof uiEnhancer?.showFirefishLoadingState === 'function') {
                            uiEnhancer.showFirefishLoadingState(card);
                        }
                    });
                    
                    // THEN process with minimal delay
                    setTimeout(() => {
                        if (firefishBTCAnalyzer && typeof firefishBTCAnalyzer.processQueuedCards === 'function') {
                            firefishBTCAnalyzer.processQueuedCards();
                        }
                    }, 100);
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // Store observer reference
            if (firefishBTCAnalyzer) {
                firefishBTCAnalyzer.observer = observer;
            }
            
            console.log('[Firefish-BTC] Resilient MutationObserver started');
            return observer;
            
        } catch (error) {
            console.error('[Firefish-BTC] Error starting resilient observer:', error);
            return null;
        }
    }
    // 4. Self-healing initialization
    async function initializeDefensively() {
        if (isInitializing) {
            console.log('[Firefish-BTC] Initialization already in progress, skipping...');
            return;
        }
        
        try {
            isInitializing = true;
            console.log('[Firefish-BTC] Starting defensive initialization...');
            
            // Ensure FirefishBTC interface exists
            ensureFirefishBTC();
            
            // Check if we're on the specific Firefish loans tab page
            if (!utils.isFirefishLoansTabPage()) {
                console.log('[Firefish-BTC] Not on Firefish loans tab page (/loans/tab/active), skipping defensive initialization');
                return;
            }
            
            // Check if we're on a Firefish page
            if (typeof firefishDetector?.detectFirefishLoanCards !== 'function') {
                console.error('[Firefish-BTC] firefishDetector not available');
                return;
            }
            
            const firefishCards = firefishDetector.detectFirefishLoanCards();
            if (firefishCards.length === 0) {
                // Check if there are any loan cards at all (including pending ones)
                const allLoanCards = document.querySelectorAll(CONFIG.selectors.loanCards);
                if (allLoanCards.length > 0) {
                    console.log(`[Firefish-BTC] ${allLoanCards.length} loan cards found but ${allLoanCards.length - firefishCards.length} are pending/incomplete - extension will not activate`);
                } else {
                    console.log('[Firefish-BTC] No Firefish loan cards detected - extension will not activate');
                }
                return;
            }
            
            console.log(`[Firefish-BTC] Found ${firefishCards.length} Firefish loan cards`);
            
            // Inject CSS safely
            if (typeof injectFirefishBTCStyles === 'function') {
                injectFirefishBTCStyles();
            } else {
                console.warn('[Firefish-BTC] injectFirefishBTCStyles function not available');
            }
            
            // Create analyzer if it doesn't exist
            if (!firefishBTCAnalyzer) {
                console.log('[Firefish-BTC] Creating new FirefishBTCAnalyzer...');
                firefishBTCAnalyzer = new FirefishBTCAnalyzer();
            }
            
            // Set up rate limit callback to restart processing
            if (firefishBTCAnalyzer.apiClient) {
                firefishBTCAnalyzer.apiClient.setRateLimitCallback(() => {
                    console.log('[Firefish-BTC] Rate limit resolved - restarting processing');
                    // Restart processing of pending cards
                    setTimeout(() => {
                        firefishBTCAnalyzer.processPendingCards();
                    }, 1000); // Small delay to ensure API is ready
                });
            }
            
            // Start resilient observer
            startResilientObserver();
            
            // Process existing cards with immediate loading
            console.log('[Firefish-BTC] Processing existing cards with immediate loading...');
            
            // FIRST: Show loading for all detected cards immediately
            firefishCards.forEach(card => {
                if (!card.dataset.firefishBtcProcessed) {
                    if (typeof uiEnhancer?.showFirefishLoadingState === 'function') {
                        uiEnhancer.showFirefishLoadingState(card);
                    }
                    firefishBTCAnalyzer.processingQueue.add(card);
                }
            });
            
            // THEN: Process with staggered delays to respect API rate limits
            await firefishBTCAnalyzer.processQueuedCards();
            
            // Process queued cards
            if (firefishBTCAnalyzer && typeof firefishBTCAnalyzer.processQueuedCards === 'function') {
                await firefishBTCAnalyzer.processQueuedCards();
            }
            
            console.log('[Firefish-BTC] Defensive initialization complete');
            
        } catch (error) {
            console.error('[Firefish-BTC] Error during defensive initialization:', error);
        } finally {
            isInitializing = false;
        }
    }
    // 5. Periodic health check
    function startHealthCheck() {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
        }
        
        healthCheckInterval = setInterval(() => {
            try {
                lastHealthCheck = Date.now();
                
                // Only run health checks on the correct page
                if (!utils.isFirefishLoansTabPage()) {
                    return; // Skip health checks on wrong pages
                }
                
                // Check if critical objects exist
                const needsReinitialization = (
                    !firefishBTCAnalyzer ||
                    !window.firefishBTC ||
                    !firefishBTCAnalyzer.observer ||
                    firefishBTCAnalyzer.observer.disconnected
                );
                
                if (needsReinitialization) {
                    console.log('[Firefish-BTC] Health check: Critical objects missing, reinitializing...');
                    initializeDefensively();
                } else {
                    console.log('[Firefish-BTC] Health check: System healthy');
                }
                
            } catch (error) {
                console.error('[Firefish-BTC] Health check error:', error);
                // Force reinitialization on health check errors
                initializeDefensively();
            }
        }, 2000); // Check every 2 seconds
        
        console.log('[Firefish-BTC] Health check started (2s interval)');
    }
    
    // 6. Focus event listener for tab switching
    function setupFocusListener() {
        window.addEventListener('focus', () => {
            console.log('[Firefish-BTC] Tab focused, checking system health...');
            setTimeout(() => {
                // Only reinitialize if we're on the correct page
                if (!utils.isFirefishLoansTabPage()) {
                    console.log('[Firefish-BTC] Tab focused but not on correct page, skipping reinitialization');
                    return;
                }
                
                if (!firefishBTCAnalyzer || !window.firefishBTC) {
                    console.log('[Firefish-BTC] Objects missing on focus, reinitializing...');
                    initializeDefensively();
                }
            }, 1000); // Small delay to let page settle
        });
        
        console.log('[Firefish-BTC] Focus listener setup complete');
    }
    // 7. Navigation detection for SPA routing
    function setupNavigationListener() {
        if (navigationListenerSetup) {
            console.log('[Firefish-BTC] Navigation listener already setup, skipping...');
            return;
        }
        
        navigationListenerSetup = true;
        let currentPath = window.location.pathname;
        
        // Function to check if navigation occurred
        const checkNavigation = () => {
            const newPath = window.location.pathname;
            if (newPath !== currentPath) {
                console.log(`[Firefish-BTC] Navigation detected: ${currentPath} → ${newPath}`);
                console.log(`[Firefish-BTC] Current hostname: ${window.location.hostname}`);
                console.log(`[Firefish-BTC] Is loans tab page: ${utils.isFirefishLoansTabPage()}`);
                currentPath = newPath;
                
                // If we navigated to the loans tab page, start the defensive system
                if (utils.isFirefishLoansTabPage()) {
                    console.log('[Firefish-BTC] Navigated to loans tab page, starting defensive system...');
                    startDefensiveSystem();
                } else {
                    console.log('[Firefish-BTC] Navigated away from loans tab page, stopping defensive system...');
                    stopDefensiveSystem();
                }
            }
        };
        
        // Check for navigation using multiple methods
        // Method 1: History API changes
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            originalPushState.apply(this, args);
            setTimeout(checkNavigation, 100); // Small delay to ensure DOM updates
        };
        
        history.replaceState = function(...args) {
            originalReplaceState.apply(this, args);
            setTimeout(checkNavigation, 100);
        };
        
        // Method 2: Popstate event (back/forward navigation)
        window.addEventListener('popstate', () => {
            setTimeout(checkNavigation, 100);
        });
        
        // Method 3: Periodic path checking for SPA frameworks that don't use History API
        setInterval(checkNavigation, 1000);
        
        // Method 4: DOM change detection for content updates
        const domObserver = new MutationObserver((mutations) => {
            // Check if the main content area has changed significantly
            let significantChange = false;
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if new loan cards were added (indicating we're on the loans page)
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.querySelector && node.querySelector('._activeCard_fvh4n_5')) {
                                significantChange = true;
                            }
                        }
                    });
                }
            });
            
            if (significantChange && utils.isFirefishLoansTabPage()) {
                console.log('[Firefish-BTC] DOM change detected on loans page, checking if defensive system should start...');
                if (!defensiveSystemRunning) {
                    console.log('[Firefish-BTC] Starting defensive system due to DOM change...');
                    startDefensiveSystem();
                }
            }
        });
        
        // Observe the body for significant DOM changes
        domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('[Firefish-BTC] Navigation listener setup complete');
    }
    
    // 8. Stop defensive system when navigating away
    function stopDefensiveSystem() {
        if (!defensiveSystemRunning) {
            return;
        }
        
        console.log('[Firefish-BTC] Stopping defensive system...');
        
        // Clear health check interval
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
        }
        
        // Disconnect observer if exists
        if (firefishBTCAnalyzer?.observer) {
            firefishBTCAnalyzer.observer.disconnect();
        }
        
        // Reset state
        defensiveSystemRunning = false;
        isInitializing = false;
        
        console.log('[Firefish-BTC] Defensive system stopped');
    }
    // 9. Main initialization
    function startDefensiveSystem() {
        console.log('[Firefish-BTC] Starting defensive Firefish BTC system...');
        
        // Check if we're on the correct page before starting the system
        if (!utils.isFirefishLoansTabPage()) {
            console.log('[Firefish-BTC] Not on Firefish loans tab page (/loans/tab/active), defensive system will not start');
            return;
        }
        
        // Check if defensive system is already running
        if (defensiveSystemRunning) {
            console.log('[Firefish-BTC] Defensive system already running, skipping startup');
            return;
        }
        
        console.log('[Firefish-BTC] On correct page, starting defensive system...');
        
        // Mark as running
        defensiveSystemRunning = true;
        
        // Initial setup
        ensureFirefishBTC();
        setupFocusListener();
        
        // Start health monitoring
        startHealthCheck();
        
        // Initial initialization
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initializeDefensively, 1000); // Small delay for page stability
            });
        } else {
            setTimeout(initializeDefensively, 1000); // Small delay for page stability
        }
        
        console.log('[Firefish-BTC] Defensive system startup complete');
    }
    
    // Start the navigation listener first to detect SPA routing
    setupNavigationListener();
    
    // Then start the defensive system if we're on the correct page
    startDefensiveSystem();
    
})();

    // Start the extension
    init();

})();