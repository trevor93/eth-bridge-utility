const { ethers } = require('ethers');
const { Connection, PublicKey } = require('@solana/web3.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const { sleep } = require('./utils');

// Known contract addresses to scan
const ERC20_TOKENS = config.erc20Tokens;
const SOLANA_TOKENS = config.solanaSPLTokens;

// Threshold in wei — only report wallets with balance >= this
const ETH_THRESHOLD = ethers.parseEther('0.001');
const SOL_THRESHOLD = 0.001; // SOL

// Local storage file for discovered wallets with balances
const DISCOVERED_WALLETS_FILE = path.join(__dirname, '..', 'data', 'discovered-wallets.json');

async function ensureDataDir() {
    const dataDir = path.join(__dirname, '..', 'data');
    await fs.mkdir(dataDir, { recursive: true });
}

async function loadDiscoveredWallets() {
    try {
        const data = await fs.readFile(DISCOVERED_WALLETS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveDiscoveredWallets(wallets) {
    await ensureDataDir();
    await fs.writeFile(DISCOVERED_WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

// Check ETH balance via RPC
async function checkEthBalance(provider, address) {
    try {
        const balance = await provider.getBalance(address);
        if (balance >= ETH_THRESHOLD) {
            return {
                address,
                chain: 'ethereum',
                type: 'eth',
                balance: ethers.formatEther(balance),
                balanceWei: balance.toString(),
                timestamp: new Date().toISOString()
            };
        }
    } catch (err) {
        console.error(`[ETH] Error checking ${address}:`, err.message);
    }
    return null;
}

// Check ERC-20 token balances via contract calls
async function checkErc20Balances(provider, address) {
    const results = [];
    for (const token of ERC20_TOKENS) {
        try {
            const contract = new ethers.Contract(token.address, [
                'function balanceOf(address owner) view returns (uint256)'
            ], provider);
            const rawBalance = await contract.balanceOf(address);
            const decimals = token.decimals || 18;
            const formattedBalance = ethers.formatUnits(rawBalance, decimals);

            // Report if >= 0.01 tokens
            const numericBalance = parseFloat(formattedBalance);
            if (numericBalance >= 0.01) {
                results.push({
                    address: address,
                    chain: 'ethereum',
                    type: 'erc20',
                    token: token.symbol,
                    tokenAddress: token.address,
                    balance: formattedBalance,
                    rawBalance: rawBalance.toString(),
                    decimals,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (err) {
            // Token contract may not support balanceOf or address is invalid
        }
    }
    return results;
}

// Check Solana balance
async function checkSolBalance(connection, address) {
    try {
        const pubKey = new PublicKey(address);
        const balance = await connection.getBalance(pubKey);
        const solBalance = balance / 1e9;
        if (solBalance >= SOL_THRESHOLD) {
            return {
                address,
                chain: 'solana',
                type: 'sol',
                balance: solBalance.toFixed(6),
                balanceLamports: balance.toString(),
                timestamp: new Date().toISOString()
            };
        }
    } catch (err) {
        console.error(`[SOL] Error checking ${address}:`, err.message);
    }
    return null;
}

// Check SPL token accounts for a Solana address
async function checkSolSplBalances(connection, address) {
    const results = [];
    try {
        const pubKey = new PublicKey(address);
        const tokenAccounts = await connection.getTokenAccountsByOwner(pubKey, {
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvx9QpR77sM6pU')
        });

        for (const account of tokenAccounts.value) {
            const mintAddress = account.account.data.parsed.info.mint;

            // Check if this mint is in our tracked list
            const trackedToken = SOLANA_TOKENS.find(t => t.mint.toLowerCase() === mintAddress.toLowerCase());
            if (trackedToken) {
                const rawBalance = account.account.data.parsed.info.tokenAmount.uiAmountString;
                const uiAmount = account.account.data.parsed.info.tokenAmount.uiAmount || 0;

                if (uiAmount >= 0.01) {
                    results.push({
                        address,
                        chain: 'solana',
                        type: 'spl',
                        token: trackedToken.symbol,
                        mintAddress: mintAddress,
                        balance: rawBalance,
                        rawBalance: account.account.data.parsed.info.tokenAmount.amount,
                        decimals: trackedToken.decimals,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }
    } catch (err) {
        // Invalid address or no token accounts
    }
    return results;
}

// Scan a batch of addresses on Ethereum
async function scanEthereumBatch(addresses, batchIndex) {
    const provider = new ethers.JsonRpcProvider(config.etherscanRpc);
    const foundWallets = [];
    const batchSize = Math.ceil(addresses.length / 3);
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, addresses.length);
    const batch = addresses.slice(start, end);

    console.log(`[ETH] Scanning batch ${batchIndex + 1} (${batch.length} addresses)...`);

    // Check ETH balance
    const ethResults = await Promise.allSettled(
        batch.map(addr => checkEthBalance(provider, addr))
    );
    for (const result of ethResults) {
        if (result.status === 'fulfilled' && result.value) {
            foundWallets.push(result.value);
        }
    }

    // Check ERC-20 tokens
    const erc20Results = await Promise.allSettled(
        batch.map(addr => checkErc20Balances(provider, addr))
    );
    for (const result of erc20Results) {
        if (result.status === 'fulfilled' && result.value) {
            foundWallets.push(...result.value);
        }
    }

    await sleep(1000); // Rate limit
    return foundWallets;
}

// Scan a batch of addresses on Solana
async function scanSolanaBatch(addresses, batchIndex) {
    const connection = new Connection(config.solanaRpc, 'confirmed');
    const foundWallets = [];
    const batchSize = Math.ceil(addresses.length / 3);
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, addresses.length);
    const batch = addresses.slice(start, end);

    console.log(`[SOL] Scanning batch ${batchIndex + 1} (${batch.length} addresses)...`);

    const solResults = await Promise.allSettled(
        batch.map(addr => checkSolBalance(connection, addr))
    );
    for (const result of solResults) {
        if (result.status === 'fulfilled' && result.value) {
            foundWallets.push(result.value);
        }
    }

    const splResults = await Promise.allSettled(
        batch.map(addr => checkSolSplBalances(connection, addr))
    );
    for (const result of splResults) {
        if (result.status === 'fulfilled' && result.value) {
            foundWallets.push(...result.value);
        }
    }

    await sleep(1000);
    return foundWallets;
}

// Run a full scan cycle across all chains
async function scan() {
    console.log('\n=== Wallet Scanner Started ===');
    console.log(`Scanning ${config.scanAddresses.length} addresses across ${config.chains.join(', ')}\n`);

    const allFound = [];

    // EVM scans
    if (config.chains.includes('ethereum')) {
        const numBatches = Math.ceil(config.scanAddresses.length / 3);
        for (let i = 0; i < numBatches; i++) {
            const batchResults = await scanEthereumBatch(config.scanAddresses, i);
            allFound.push(...batchResults);
        }
    }

    // Solana scans
    if (config.chains.includes('solana')) {
        const numBatches = Math.ceil(config.scanAddresses.length / 3);
        for (let i = 0; i < numBatches; i++) {
            const batchResults = await scanSolanaBatch(config.scanAddresses, i);
            allFound.push(...batchResults);
        }
    }

    // Persist results
    const existingWallets = await loadDiscoveredWallets();
    // Merge: keep only wallets with newer timestamps or new entries
    const existingMap = new Map(existingWallets.map(w => [`${w.address}-${w.token || w.chain}-${w.type}`, w]));
    for (const wallet of allFound) {
        const key = `${wallet.address}-${wallet.token || wallet.chain}-${wallet.type}`;
        existingMap.set(key, wallet);
    }
    const merged = Array.from(existingMap.values());
    await saveDiscoveredWallets(merged);

    // Report
    console.log(`\n=== Scan Complete ===`);
    console.log(`Found ${allFound.length} wallets with balances >= threshold`);
    if (allFound.length > 0) {
        console.log('\nDiscovered wallets:');
        for (const w of allFound) {
            const token = w.token ? ` [${w.token}]` : '';
            console.log(`  ${w.chain} | ${w.address} | ${w.type}${token}: ${w.balance}`);
        }
    }

    return allFound;
}

module.exports = {
    scan,
    checkEthBalance,
    checkErc20Balances,
    checkSolBalance,
    checkSolSplBalances,
    loadDiscoveredWallets,
    saveDiscoveredWallets,
    ETH_THRESHOLD,
    SOL_THRESHOLD
};
