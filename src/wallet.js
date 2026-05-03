// Wallet detection and connection module

class Wallet {
    constructor() {
        this.provider = null;
        this.account = null;
    }

    async connect() {
        // Detect wallet provider
        if (window.ethereum) {
            this.provider = window.ethereum;
            await this.provider.request({ method: 'eth_requestAccounts' });
            this.account = await this.provider.request({ method: 'eth_accounts' });
            console.log('Connected to wallet:', this.account);
        }
    }

    async getBalance() {
        // Get wallet balance
    }

    async signTransaction(tx) {
        // Sign transaction
    }
}

module.exports = Wallet;
