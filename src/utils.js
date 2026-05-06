// Utility functions

function formatBalance(balance) {
    // Format balance to human readable
}

function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

function isEvmAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/i.test(address);
}

function isSolanaAddress(address) {
    if (typeof address !== 'string') return false;
    const bs58 = require('bs58');
    try {
        bs58.decode(address);
        return address.length >= 32 && address.length <= 44;
    } catch {
        return false;
    }
}

module.exports = { formatBalance, log, isEvmAddress, isSolanaAddress };
