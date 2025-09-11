# Insight+ for Firefish - Chrome Extension

A professional Chrome extension that enhances the user experience on Firefish.io with Bitcoin integration and advanced UI features. **v1.1.0 introduces Portfolio Overview Dashboard for comprehensive loan portfolio analysis.**

## 🚀 Features

### Core Functionality
- **Enhanced User Experience**: Improved UI elements and interactions on Firefish.io
- **Bitcoin Integration**: Real-time Bitcoin prices and market data via CoinGecko API
- **Smart Caching**: Efficient data caching with automatic expiration
- **Firefish.io Focus**: Optimized specifically for Firefish.io with enhanced user experience

### 🆕 v1.1.0 Major Features
- **Portfolio Overview Dashboard**: Comprehensive portfolio performance summary
- **Aggregated Performance Metrics**: Total theoretical gain/loss across all loans
- **Portfolio Value Tracking**: Sum of loan amounts for analyzed loans
- **Performance Statistics**: Count of outperforming vs underperforming loans
- **Real-time Dashboard Updates**: Live updates as individual loan analyses complete
- **Professional Portfolio UI**: Clean, responsive dashboard with tooltips and explanations

### v1.0.0 Features
- **Bitcoin Performance Analysis**: Comprehensive BTC vs loan interest comparison
- **Real-time BTC Price Analysis**: Historical vs current price assessment
- **Investment Strategy Comparison**: "What if I bought BTC instead of taking the loan?"
- **Theoretical Gain/Loss Calculation**: Net outcome analysis of BTC strategy
- **Immediate Visual Feedback**: Instant loading states and processing indicators
- **Professional Tooltips**: Educational explanations and calculation formulas

### User Interface
- **Professional Popup**: Modern, responsive popup interface with tabbed navigation
- **Dashboard**: Quick stats, cache management, and system information
- **Bitcoin Tab**: Real-time Bitcoin prices and market data
- **Portfolio Dashboard**: In-page portfolio overview with aggregated performance metrics

### Technical Features
- **Manifest V3**: Latest Chrome extension standards for security and performance
- **Service Worker**: Background processing with efficient resource management
- **Content Scripts**: Enhanced page interactions and UI improvements
- **Storage API**: Persistent settings and data management
- **Message Passing**: Secure communication between extension components

## 📁 File Structure

```
firefish-ux-extension/
├── manifest.json          # Extension manifest (v3, v1.1.0)
├── content.js            # Content script for page enhancement
├── background.js         # Service worker background script
├── popup.html           # Popup interface HTML
├── popup.js             # Popup functionality JavaScript
├── popup.css            # Popup styling and themes
├── icons/               # Extension icons
│   ├── icon16.png       # 16x16 icon
│   ├── icon48.png       # 48x48 icon
│   └── icon128.png      # 128x128 icon
└── README.md            # This file
```

## 🆕 What's New in v1.1.0

### Portfolio Overview Dashboard
The major new feature in v1.1.0 is the Portfolio Overview Dashboard, which provides a comprehensive summary of your entire loan portfolio's Bitcoin performance. This dashboard aggregates all individual loan analyses into a single, easy-to-understand overview.

#### How the Portfolio Dashboard Works
1. **Automatic Detection**: Monitors all loan cards on the Firefish.io page
2. **Real-time Aggregation**: Collects data from individual loan analyses as they complete
3. **Portfolio Metrics**: Calculates total theoretical gain/loss across all loans
4. **Performance Summary**: Shows how many loans are outperforming vs underperforming
5. **Portfolio Value**: Displays total loan amount value being analyzed
6. **Live Updates**: Dashboard updates in real-time as new analyses complete

#### Key Portfolio Metrics
- **Total Theoretical Gain/Loss**: Sum of net BTC strategy results across all analyzed loans
- **Loan Count Summary**: Number of outperforming loans vs total analyzed loans
- **Portfolio Value**: Total sum of loan amounts for analyzed loans
- **Performance Status**: Visual indicators for positive/negative overall performance

## v1.0.0 Features

### Bitcoin Performance Analysis
The major feature in v1.0.0 is comprehensive Bitcoin performance analysis for Firefish.io loan collateral. This feature helps users understand whether their BTC collateral strategy is outperforming traditional loan interest costs.

#### How the BTC Analyzer Works
1. **Loan Detection**: Automatically detects Firefish.io loan cards on the page
2. **Price Fetching**: Retrieves historical BTC prices from CoinGecko API for loan provision dates
3. **Current Prices**: Gets real-time BTC prices for comparison
4. **Investment Comparison**: Calculates what if the loan amount was used to buy BTC instead
5. **Performance Analysis**: Shows whether BTC investment would outperform loan interest costs
6. **Visual Results**: Displays comprehensive analysis with tooltips and explanations

#### Key Calculations
- **BTC Value Change**: `Loan Amount × (Current BTC Price / Historical BTC Price - 1)`
- **Loan Interest Cost**: `Loan Amount × Interest Rate`
- **Theoretical Gain/Loss**: `BTC Value Change - Loan Interest Cost`
- **Performance Status**: Outperforming if BTC gain > loan interest cost

## 🔧 Installation

### For Chrome Web Store (Recommended)
1. Visit the Chrome Web Store and search for "Insight+ for Firefish"
2. Click "Add to Chrome" to install the extension
3. The extension will be automatically installed and ready to use on Firefish.io

### For Developers
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `firefish-ux-extension` folder
5. The extension will be installed and ready to use on Firefish.io

## 🎯 Usage

### Basic Usage
1. Click the extension icon in your Chrome toolbar
2. Use the popup interface to access features and settings
3. Navigate between Dashboard, Bitcoin, and Settings tabs
4. Enjoy enhanced experience on Firefish.io

### Bitcoin Features
- View Bitcoin prices in real-time
- Monitor BTC price changes and market trends
- Automatic price refresh with configurable intervals
- Portfolio performance analysis and aggregation

## ⚙️ Configuration

### Permissions
- **Storage**: For saving settings and caching data
- **Active Tab**: For current tab access
- **Tabs**: For tab management and navigation
- **Host Permissions**: For CoinGecko API and Firefish.io

### API Integration
- **CoinGecko API**: Free Bitcoin data and market information
- **Rate Limiting**: Built-in caching to respect API limits
- **Error Handling**: Graceful fallbacks for API failures

## 📱 Browser Compatibility

- **Chrome**: 88+ (Manifest V3 support)
- **Edge**: 88+ (Chromium-based)
- **Other Chromium browsers**: Should work with Manifest V3 support

## 🔒 Security & Privacy

- **No Data Collection**: Extension doesn't collect personal information
- **Local Storage**: All data stored locally in your browser
- **Secure APIs**: Only communicates with trusted CoinGecko API
- **Permission Minimal**: Requests only necessary permissions

## 🚨 Troubleshooting

### Common Issues
1. **Extension not working**: Check if it's enabled in Chrome extensions
2. **Bitcoin data not loading**: Verify internet connection and API status
3. **UI not updating**: Try refreshing the page or reloading the extension
4. **Settings not saving**: Check Chrome storage permissions

### Debug Mode
1. Open Chrome DevTools
2. Go to Console tab
3. Look for `[Insight+ Firefish]` log messages
4. Check for any error messages

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Guidelines
- Follow existing code style and patterns
- Add appropriate error handling
- Include comments for complex logic
- Test thoroughly before submitting

## 📞 Support

For support, questions, or feature requests:
- Open an issue on GitHub
- Check the troubleshooting section above
- Review the code comments for implementation details

## 🔄 Version History

### v1.1.0 (Current)
- **Major Feature**: Portfolio Overview Dashboard for comprehensive portfolio analysis
- **Aggregated Performance Metrics**: Total theoretical gain/loss across all loans
- **Portfolio Value Tracking**: Sum of loan amounts for analyzed loans
- **Performance Statistics**: Count of outperforming vs underperforming loans
- **Real-time Dashboard Updates**: Live updates as individual loan analyses complete
- **Professional Portfolio UI**: Clean, responsive dashboard with tooltips and explanations

### v1.0.0
- **Major Feature**: Bitcoin Performance Analysis for loan collateral
- **Investment Strategy Comparison**: BTC vs loan interest analysis
- **Real-time Price Analysis**: Historical and current BTC price comparison
- **Immediate Visual Feedback**: Instant loading states and processing indicators
- **Professional Tooltips**: Educational explanations and calculation formulas
- **Enhanced User Experience**: Improved loan card analysis and display

## 📊 Performance

- **Memory Usage**: Minimal memory footprint
- **CPU Usage**: Efficient background processing
- **Network**: Smart caching reduces API calls
- **Storage**: Optimized local storage usage

## 🌟 Future Features

- [ ] Advanced portfolio analytics and trends
- [ ] Price alerts and notifications
- [ ] Advanced charting and analytics
- [ ] Export portfolio data functionality
- [ ] Social features and sharing
- [ ] Mobile app companion

---

**Made with ❤️ for the Firefish.io community**

*This extension enhances your browsing experience while maintaining privacy and performance.*


