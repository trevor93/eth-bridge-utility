const { ethers } = require('ethers');
const { Connection, PublicKey, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const config = require('./config');

class Wallet {
  constructor(network = 'ethereum') {
    this.network = network;
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.solanaConnection = null;
    this.solanaKeypair = null;
    this.connected = false;
    this.detectedWallet = null;
  }

  /**
   * Auto-detect available wallet provider (MetaMask, Phantom, etc.)
   */
  detectProvider() {
    // Browser injected providers
    if (typeof window !== 'undefined') {
      if (window.ethereum) {
        this.detectedWallet = 'metamask';
        return 'ethereum';
      }
      if (window.solana) {
        this.detectedWallet = 'phantom';
        return 'solana';
      }
    }
    // Node.js: fallback to RPC
    return null;
  }

  /**
   * Connect to the wallet for the specified network
   */
  async connect() {
    // Try to detect injected provider
    const detectedNetwork = this.detectProvider();

    if (this.detectedWallet === 'ethereum') {
      await this._connectEthereum(window.ethereum);
    } else if (this.detectedWallet === 'phantom') {
      await this._connectSolana(window.solana);
    } else {
      // Node.js mode: use RPC
      await this._connectRpc();
    }

    this.connected = true;
    return {
      address: this.address,
      network: this.network,
      wallet: this.detectedWallet || 'rpc',
    };
  }

  /**
   * Connect via Ethereum RPC (Node.js mode)
   */
  async _connectRpc() {
    const netConfig = config.networks[this.network];
    if (!netConfig) {
      throw new Error(`Network '${this.network}' not configured`);
    }

    // Use private key from environment or generate random one for testing
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not set in .env (required for Node.js mode)');
    }

    this.provider = new ethers.JsonRpcProvider(netConfig.rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.address = this.signer.address;

    // Solana mode
    if (this.network === 'solana') {
      const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
      if (!solanaPrivateKey) {
        throw new Error('SOLANA_PRIVATE_KEY not set in .env');
      }
      this.solanaConnection = new Connection(netConfig.rpcUrl);
      const secretKey = Uint8Array.from(Buffer.from(solanaPrivateKey, 'base64'));
      this.solanaKeypair = Keypair.fromSecretKey(secretKey);
      this.address = this.solanaKeypair.publicKey.toBase58();
    }
  }

  /**
   * Connect via injected Ethereum provider (browser mode)
   */
  async _connectEthereum(ethereumProvider) {
    this.provider = new ethers.BrowserProvider(ethereumProvider);
    this.signer = await this.provider.getSigner();
    this.address = await this.signer.getAddress();
    this.detectedWallet = 'metamask';

    // Request account access
    await ethereumProvider.request({
      method: 'eth_requestAccounts',
    });
  }

  /**
   * Connect via injected Solana provider (Phantom wallet)
   */
  async _connectSolana(solanaProvider) {
    const netConfig = config.networks.solana;
    this.solanaConnection = new Connection(netConfig.rpcUrl);
    this.solanaAdapter = solanaProvider;

    // Phantom: use connected public key
    if (solanaProvider.isConnected) {
      const publicKey = solanaProvider.publicKey;
      this.address = publicKey.toBase58();
    }
  }

  /**
   * Get native token balance for the connected wallet
   */
  async getBalance() {
    if (this.network === 'solana') {
      return this._getSolanaBalance();
    }
    return this._getEthBalance();
  }

  /**
   * Get balance via ethers.js
   */
  async _getEthBalance() {
    if (!this.provider) throw new Error('Provider not connected');
    const balance = await this.provider.getBalance(this.address);
    return Number(ethers.formatEther(balance));
  }

  /**
   * Get balance via Solana web3
   */
  async _getSolanaBalance() {
    if (!this.solanaConnection) throw new Error('Solana connection not established');
    const publicKey = new PublicKey(this.address);
    const lamports = await this.solanaConnection.getBalance(publicKey);
    return lamports / 1e9;
  }

  /**
   * Sign and send a transaction (Ethereum)
   */
  async signTransaction(toAddress, amount) {
    if (!this.signer) throw new Error('No signer available');
    const tx = await this.signer.sendTransaction({
      to: toAddress,
      value: ethers.parseEther(amount.toString()),
    });
    const receipt = await tx.wait();
    return {
      hash: receipt.hash,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
    };
  }

  /**
   * Sign and send a transaction (Solana)
   */
  async signSolanaTransaction(toAddress, amount) {
    if (!this.solanaKeypair) throw new Error('Solana keypair not available');
    const publicKey = new PublicKey(this.address);
    const destination = new PublicKey(toAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: destination,
        lamports: Math.floor(amount * 1e9),
      })
    );

    const { blockhash } = await this.solanaConnection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = publicKey;

    const signed = await this.solanaAdapter.signTransaction(transaction);
    const signature = await this.solanaConnection.sendRawTransaction(signed.serialize());
    await this.solanaConnection.confirmTransaction(signature);

    return { hash: signature, status: 'confirmed' };
  }

  /**
   * Disconnect wallet
   */
  disconnect() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.connected = false;
  }
}

module.exports = { Wallet };
