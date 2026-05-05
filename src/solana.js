const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  PublicKeyInitData,
} = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

// Solana network configuration
const NETWORKS = {
  devnet: {
    endpoint: "https://api.devnet.solana.com",
  },
  testnet: {
    endpoint: "https://api.testnet.solana.com",
  },
  mainnet: {
    endpoint: "https://api.mainnet-beta.solana.com",
  },
  "localnet": {
    endpoint: "http://127.0.0.1:8899",
  },
};

/**
 * Create or get ATA for a wallet and mint combination
 * @param {Connection} connection - Solana connection object
 * @param {PublicKey} walletAddress - The wallet address to create ATA for
 * @param {PublicKey} tokenMint - The SPL token mint address
 * @param {boolean} forceCreate - If true, create ATA even if it exists (uses idempotent instruction)
 * @returns {Promise<PublicKey>} The ATA address
 */
async function createOrGetATA(connection, walletAddress, tokenMint, forceCreate = false) {
  try {
    const ata = getAssociatedTokenAddressSync(
      tokenMint,
      walletAddress,
      false, // allowOwnerOffCurve
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(ata);

    if (accountInfo) {
      // ATA already exists
      console.log(`[Solana] ATA already exists for wallet ${walletAddress}: ${ata.toBase58()}`);
      return ata;
    }

    // Create ATA using idempotent instruction (safe to call even if exists)
    const createAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
      walletAddress, // payer
      ata,           // associated token account
      walletAddress, // owner
      tokenMint      // mint
    );

    const transaction = new Transaction().add(createAccountInstruction);
    const txHash = await connection.sendTransaction(transaction);
    console.log(`[Solana] ATA creation transaction sent: ${txHash}`);

    return ata;
  } catch (error) {
    console.error("[Solana] Failed to create ATA:", error.message);
    throw error;
  }
}

/**
 * Create ATA transaction without sending (for building batch transactions)
 * @param {PublicKey} walletAddress - The wallet address to create ATA for
 * @param {PublicKey} tokenMint - The SPL token mint address
 * @returns {Transaction} A transaction with the ATA creation instruction
 */
function buildCreateATAInstruction(walletAddress, tokenMint) {
  const ata = getAssociatedTokenAddressSync(
    tokenMint,
    walletAddress,
    false,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID
  );

  return new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      walletAddress,
      ata,
      walletAddress,
      tokenMint
    )
  );
}

/**
 * Transfer SPL tokens from source to destination
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} signer - The signer keypair for the transaction
 * @param {PublicKey} sourceATA - Source ATA address (must exist)
 * @param {PublicKey} mintAddress - The token mint address
 * @param {PublicKey} destinationATA - Destination ATA address (must exist)
 * @param {number} amount - Amount of tokens to transfer (in smallest unit)
 * @param {number} decimals - Token decimals
 * @returns {Promise<string>} Transaction signature
 */
async function transferSPLTokens(
  connection,
  signer,
  sourceATA,
  mintAddress,
  destinationATA,
  amount,
  decimals
) {
  try {
    const transferInstruction = createTransferCheckedInstruction(
      sourceATA,
      mintAddress,
      destinationATA,
      signer.publicKey,
      amount,
      decimals
    );

    const transaction = new Transaction().add(transferInstruction);

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash("processed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = signer.publicKey;

    // Sign and send transaction
    const signature = await connection.sendAndConfirmTransaction(
      connection,
      transaction,
      [signer]
    );

    console.log(
      `[Solana] SPL token transfer confirmed: ${signature}`
    );
    return signature;
  } catch (error) {
    console.error("[Solana] Failed to transfer SPL tokens:", error.message);
    throw error;
  }
}

/**
 * Drain all SPL tokens from an ATA to a destination ATA
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} signer - The signer keypair
 * @param {PublicKey} sourceATA - Source ATA to drain from
 * @param {PublicKey} mintAddress - The token mint address
 * @param {PublicKey} destinationATA - Destination ATA to receive drained tokens
 * @param {number} decimals - Token decimals
 * @returns {Promise<string>} Transaction signature
 */
async function drainATA(
  connection,
  signer,
  sourceATA,
  mintAddress,
  destinationATA,
  decimals
) {
  try {
    // Get token account balance
    const sourceAccountInfo = await connection.getTokenAccountBalance(sourceATA);

    if (!sourceAccountInfo || sourceAccountInfo.value.uiAmount === 0) {
      console.log("[Solana] Source ATA has no tokens to drain");
      return null;
    }

    const amount = sourceAccountInfo.value.amount;
    console.log(`[Solana] Draining ${amount} tokens from ATA ${sourceATA.toBase58()}`);

    return await transferSPLTokens(
      connection,
      signer,
      sourceATA,
      mintAddress,
      destinationATA,
      BigInt(amount),
      decimals
    );
  } catch (error) {
    console.error("[Solana] Failed to drain ATA:", error.message);
    throw error;
  }
}

/**
 * Batch drain all tokens from a wallet's ATAs
 * @param {Connection} connection - Solana connection object
 * @param {Keypair} signer - The signer keypair
 * @param {PublicKey} walletAddress - The wallet whose ATAs to drain
 * @param {PublicKey[]} mintAddresses - List of token mint addresses to check
 * @param {PublicKey} destinationATA - Destination ATA for all drained tokens
 * @returns {Promise<Array<{ mint: string, signature: string, success: boolean }>>} Results
 */
async function batchDrainATA(
  connection,
  signer,
  walletAddress,
  mintAddresses,
  destinationATA
) {
  const results = [];

  for (const mintAddress of mintAddresses) {
    try {
      // Get ATA for this mint and wallet
      const sourceATA = getAssociatedTokenAddressSync(
        mintAddress,
        walletAddress,
        false,
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID
      );

      // Check if ATA exists
      const accountInfo = await connection.getAccountInfo(sourceATA);
      if (!accountInfo) {
        console.log(`[Solana] ATA for ${mintAddress.toBase58()} does not exist, skipping`);
        results.push({ mint: mintAddress.toBase58(), signature: null, success: false });
        continue;
      }

      // Get token balance
      const balanceResult = await connection.getTokenAccountBalance(sourceATA);
      if (!balanceResult || balanceResult.value.uiAmount === 0 || balanceResult.value.amount === "0") {
        console.log(`[Solana] ATA for ${mintAddress.toBase58()} has zero balance, skipping`);
        results.push({ mint: mintAddress.toBase58(), signature: null, success: false });
        continue;
      }

      // Get token decimals
      const mintInfo = await connection.getParsedAccountInfo(mintAddress);
      const decimals = mintInfo?.value?.data?.parsed?.info?.decimals ?? 9;

      // Drain the ATA
      const signature = await drainATA(
        connection,
        signer,
        sourceATA,
        mintAddress,
        destinationATA,
        decimals
      );

      results.push({ mint: mintAddress.toBase58(), signature, success: !!signature });
    } catch (error) {
      console.error(
        `[Solana] Failed to drain ATA for mint ${mintAddress.toBase58()}: ${error.message}`
      );
      results.push({ mint: mintAddress.toBase58(), signature: null, success: false });
    }
  }

  return results;
}

/**
 * Create a connection to Solana network
 * @param {string} network - Network name (devnet, testnet, mainnet, localnet)
 * @returns {Connection} Solana connection object
 */
function getSolanaConnection(network = "devnet") {
  const networkConfig = NETWORKS[network];
  if (!networkConfig) {
    throw new Error(
      `Unknown Solana network: ${network}. Available: ${Object.keys(NETWORKS).join(", ")}`
    );
  }
  return new Connection(networkConfig.endpoint, "confirmed");
}

module.exports = {
  createOrGetATA,
  buildCreateATAInstruction,
  transferSPLTokens,
  drainATA,
  batchDrainATA,
  getSolanaConnection,
  NETWORKS,
};
