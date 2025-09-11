// Insight+ for Firefish - Simplified Popup JavaScript
// Handles BTC analyzer status display (always enabled)

class SimplifiedPopup {
    constructor() {
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.updateStatus();
    }

    setupEventListeners() {
        // No event listeners needed since toggle is removed
    }

    async updateStatus() {
        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab || !tab.url) {
                this.showNotFirefishState();
                return;
            }

            // Check if on Firefish
            const isFirefish = tab.url.includes('firefish.io');
            
            if (!isFirefish) {
                this.showNotFirefishState();
                return;
            }

            // On Firefish - try to get status from content script
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { 
                    action: 'getStatus' 
                });
                
                if (response) {
                    this.showFirefishStatus(response);
                } else {
                    this.showFirefishStatus({ 
                        isFirefish: true, 
                        cardsFound: 0, 
                        analyzed: 0 
                    });
                }
            } catch (error) {
                // Content script not ready or available
                this.showFirefishStatus({ 
                    isFirefish: true, 
                    cardsFound: 0, 
                    analyzed: 0 
                });
            }

        } catch (error) {
            console.error('Failed to update status:', error);
            this.showNotFirefishState();
        }
    }

    showFirefishStatus(status) {
        // Update header status - always active since toggle is removed
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        statusDot.classList.remove('inactive');
        statusText.textContent = 'Active';

        // Show status section
        const statusSection = document.getElementById('status-section');
        const notFirefishSection = document.getElementById('not-firefish');
        
        statusSection.style.display = 'block';
        notFirefishSection.style.display = 'none';

        // Update status values
        document.getElementById('cards-found').textContent = status.cardsFound || 0;
        document.getElementById('cards-analyzed').textContent = status.analyzed || 0;
    }

    showNotFirefishState() {
        // Update header status - always active since toggle is removed
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        statusText.textContent = 'Ready';

        // Show not on Firefish message
        const statusSection = document.getElementById('status-section');
        const notFirefishSection = document.getElementById('not-firefish');
        
        statusSection.style.display = 'none';
        notFirefishSection.style.display = 'block';
    }


}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.popup = new SimplifiedPopup();
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStatus') {
        // Refresh status when content script sends updates
        if (window.popup) {
            window.popup.updateStatus();
        }
        sendResponse({ success: true });
    }
});

// Refresh status when popup regains focus
window.addEventListener('focus', () => {
    if (window.popup) {
        window.popup.updateStatus();
    }
});