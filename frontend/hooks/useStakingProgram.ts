import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { getProgram, getPDAs, PROGRAM_ID } from "@/lib/anchor-program";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Sync stake to database via API (verifies on-chain before saving)
async function syncStakeToDb(userWallet: string, tokenMint: string, poolId: number) {
  try {
    const res = await fetch('/api/stakes/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userWallet, tokenMint, poolId }),
    });
    const data = await res.json();
    console.log('DB sync result:', data);
  } catch (e) {
    console.error('DB sync failed (non-critical):', e);
  }
}

// Log activity to database (for activity feed)
async function logActivity(
  userWallet: string, 
  tokenMint: string, 
  poolId: number, 
  type: 'stake' | 'unstake' | 'claim',
  amount: number,
  stakePda: string
) {
  try {
    await fetch('/api/activity-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userWallet, tokenMint, poolId, type, amount, stakePda }),
    });
  } catch (e) {
    console.error('Activity log failed (non-critical):', e);
  }
}

const SECONDS_PER_YEAR = 31_536_000;

/**
 * Poll for transaction confirmation using HTTP (no WebSocket)
 */
export async function pollForConfirmation(
  connection: any,
  signature: string,
  maxAttempts: number = 30
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status.value) {
        // ✅ Check for errors FIRST
        if (status.value.err) {
          const errStr = JSON.stringify(status.value.err);
          console.error("❌ Transaction failed on-chain:", errStr);
          
          // Parse common errors for better UX
          if (errStr.includes("InsufficientFunds") || errStr.includes("insufficient")) {
            throw new Error("Transaction failed: Insufficient SOL for fees. Please add more SOL to your wallet.");
          }
          if (errStr.includes("0x1")) {
            throw new Error("Transaction failed: Insufficient token balance.");
          }
          throw new Error(`Transaction failed: ${errStr}`);
        }
        
        // ✅ Only return success if confirmed/finalized AND no error
        if (status.value.confirmationStatus === 'confirmed' || 
            status.value.confirmationStatus === 'finalized') {
          console.log(`✅ Transaction ${status.value.confirmationStatus}: ${signature}`);
          return true;
        }
      }
    } catch (e: any) {
      if (e.message?.includes('Transaction failed')) throw e;
      // Continue polling on network errors
      console.log(`⏳ Polling attempt ${i + 1}/${maxAttempts}...`);
    }
  }
  
  // ✅ Timeout - but don't assume success
  throw new Error(`Transaction confirmation timeout. Check explorer: https://solscan.io/tx/${signature}`);
}

/**
 * Hook for user staking functions - Updated for New Contract
 * Uses token mint addresses instead of pool IDs
 */
export function useStakingProgram() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, wallet: walletAdapter } = useWallet();
  const wallet = walletAdapter?.adapter as any;

  /**
   * Get platform config data including fee collector
   */
  const waitForConfirmation = async (signature: string, timeoutMs: number = 30000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await connection.getSignatureStatuses([signature]);
        const status = res?.value?.[0];
        if (status?.err) return false;
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return true;
      } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  };

  const getPlatformConfig = async (program: any) => {
    try {
      const [platformConfigPDA] = getPDAs.platformConfig();
      const platformConfig = await program.account.platform.fetch(platformConfigPDA, "confirmed");
      return platformConfig;
    } catch (error) {
      console.error("Error fetching platform config:", error);
      return null;
    }
  };

  /**
   * Stake tokens to a pool
   * @param tokenMint - The token mint address (NOT poolId!)
   * @param amount - Amount in token decimals
   * @param referrerCode - Optional referrer wallet address
   */
  const stake = async (
    tokenMint: string,
    amount: string | number,
    poolId: number = 0,
    referrerCode?: string,
    engine: string = 'legacy'
  ) => {
    console.log("🔍🔍🔍 STAKE FUNCTION CALLED WITH:");
    console.log("   amount:", amount);
    console.log("   typeof amount:", typeof amount);
    console.log("   tokenMint:", tokenMint);
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    // ✅ PRE-FLIGHT CHECK: Verify SOL balance for fees BEFORE doing anything
    const solBalance = await connection.getBalance(publicKey);
    const MINIMUM_SOL_FOR_FEES = 0.02 * 1_000_000_000;
    if (solBalance < MINIMUM_SOL_FOR_FEES) {
      throw new Error(`Insufficient SOL for transaction fees. You have ${(solBalance / 1_000_000_000).toFixed(4)} SOL but need at least 0.02 SOL.`);
    }
    console.log(`✅ SOL balance check passed: ${(solBalance / 1_000_000_000).toFixed(4)} SOL`);

    const program = getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    
    // ✅ DETECT THE TOKEN PROGRAM TYPE
    const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
    if (!mintInfo) {
      throw new Error("Token mint not found");
    }
    
    // Check if it's Token-2022 or SPL Token
    const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    
    const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) 
      ? TOKEN_2022_PROGRAM_ID 
      : SPL_TOKEN_PROGRAM_ID;

    console.log(`✅ Token program detected for staking: ${tokenProgramId.toString()}`);
    
    // Get platform config to fetch fee collector
    const platformConfig = await getPlatformConfig(program);
    if (!platformConfig) {
      throw new Error("Platform not initialized");
    }

    const feeCollector = platformConfig.feeCollector;
    
    // Get PDAs based on engine
    const [platformConfigPDA] = getPDAs.platformConfig();
    const [projectPDA] = engine === 'current' 
      ? getPDAs.project1(tokenMintPubkey, poolId) 
      : getPDAs.project(tokenMintPubkey, poolId);
    const [stakingVaultPDA] = engine === 'current'
      ? getPDAs.stakingVault1(tokenMintPubkey, poolId)
      : getPDAs.stakingVault(tokenMintPubkey, poolId);
    const [userStakePDA] = engine === 'current'
      ? getPDAs.userStake1(projectPDA, publicKey)
      : getPDAs.userStake(projectPDA, publicKey);

    // ✅ Handle Native SOL vs SPL tokens differently
    const NATIVE_SOL = "So11111111111111111111111111111111111111112";
    const isNativeSOL = tokenMint === NATIVE_SOL;

    let userTokenAccount: PublicKey;

    if (isNativeSOL) {
      // ✅ For Native SOL, use the wallet itself (no ATA)
      userTokenAccount = publicKey;
      console.log("✅ Native SOL: Using wallet directly as token account");
    } else {
      // ✅ For SPL tokens, get the ATA
      userTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        publicKey,
        false, // allowOwnerOffCurve
        tokenProgramId  // Use detected token program
      );
      console.log("✅ SPL Token: Using ATA as token account");
    }

    // ✅ For Native SOL, fee collector account is the wallet itself
    // For SPL tokens, it's the ATA
    let feeCollectorTokenAccount: PublicKey;

    if (isNativeSOL) {
      // ✅ For Native SOL, use fee collector wallet directly
      feeCollectorTokenAccount = feeCollector;
      console.log("✅ Native SOL: Using fee collector wallet directly");
    } else {
      // ✅ For SPL tokens, get the ATA
      feeCollectorTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        feeCollector,
        false, // allowOwnerOffCurve
        tokenProgramId
      );
      console.log("✅ SPL Token: Using fee collector ATA");
    }

    // Check if fee collector token account exists, create if not
    const feeCollectorAccountInfo = await connection.getAccountInfo(feeCollectorTokenAccount);
    const needsInit = !feeCollectorAccountInfo;

    if (needsInit) {
      console.log("⚠️ Fee collector token account doesn't exist, will create it");
    }

    console.log("🔍 RAW AMOUNT RECEIVED:", amount, typeof amount);

    // ✅ Amount is already in token units (pre-multiplied by UI)
    const amountBN = new BN(amount.toString());
    console.log(`✅ Using pre-calculated amount: ${amountBN.toString()} units`);

    // ✅ Final validation before transaction
    if (amountBN.isZero()) {
      throw new Error("Cannot stake 0 tokens. Please enter a valid amount.");
    }

    // Get project info to check for reflection vault and referrer
    const project = engine === 'current'
      ? await program.account.project1.fetch(projectPDA, "confirmed")
      : await program.account.project.fetch(projectPDA, "confirmed");
    const reflectionVault = project.reflectionVault;
    const projectReferrer = project.referrer;

    console.log("🔍 DEBUG reflection vault:");
    console.log("   project.reflectionVault:", reflectionVault?.toString());
    console.log("   projectPDA:", projectPDA.toString());
    console.log("   stakingVaultPDA:", stakingVaultPDA.toString());
    console.log("   Are they equal?", reflectionVault?.toString() === projectPDA.toString());

    // Determine referrer: use provided code, project referrer, or fallback to user
    let finalReferrer: PublicKey;
    if (referrerCode) {
      finalReferrer = new PublicKey(referrerCode);
    } else if (projectReferrer) {
      finalReferrer = projectReferrer;
    } else {
      // Default to user's public key if no referrer (Anchor client requires this field)
      finalReferrer = publicKey;
    }

    // Build accounts object - REMOVE referrer (will use remainingAccounts instead)
        const accounts: any = {
          platform: platformConfigPDA,
          project: projectPDA,
          stake: userStakePDA,
          stakingVault: stakingVaultPDA,
          userTokenAccount: userTokenAccount,
          feeCollectorTokenAccount: feeCollectorTokenAccount,
          feeCollector: feeCollector,
          reflectionVault: (reflectionVault && reflectionVault.toString() !== projectPDA.toString()) 
            ? reflectionVault 
            : null,
          tokenMintAccount: tokenMintPubkey,
          user: publicKey,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        };
    
    // ✅ Build remainingAccounts for referrer with explicit isWritable: true
    const remainingAccounts = [];
    if (projectReferrer && !projectReferrer.equals(PublicKey.default)) {
      remainingAccounts.push({
        pubkey: projectReferrer,
        isWritable: true,
        isSigner: false
      });
      console.log("✅ Adding referrer to remainingAccounts:", projectReferrer.toString());
    }
    
    console.log("🔍 All accounts being passed:");
    Object.entries(accounts).forEach(([key, value]) => {
      console.log(`  ${key}: ${value instanceof PublicKey ? value.toString() : value}`);
    });
    
    console.log("🔍 Final accounts for deposit:", {
      accountKeys: Object.keys(accounts),
      hasReflectionVault: !!reflectionVault,
      tokenProgram: tokenProgramId.toString(),
    });

    console.log("🔍 Deposit Accounts:", {
      platform: platformConfigPDA.toString(),
      project: projectPDA.toString(),
      stake: userStakePDA.toString(),
      stakingVault: stakingVaultPDA.toString(),
      user: publicKey.toString(),
      amount: amountBN.toString(),
      needsInit,
    });

    try {
      // ✅ ALWAYS build transaction manually and use sendTransaction (Phantom secure API)
      const transaction = new Transaction();
      
      // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));

      // If fee collector ATA doesn't exist, create it first
      if (needsInit) {
        console.log("🔧 Adding fee collector ATA creation instruction...");
        const createATAIx = createAssociatedTokenAccountInstruction(
          publicKey,
          feeCollectorTokenAccount,
          feeCollector,
          tokenMintPubkey,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }
      
      // Add stake instruction
      console.log("🔧 Building deposit instruction...");
      const stakeIx = engine === 'current'
        ? await program.methods
            .deposit1(tokenMintPubkey, new BN(poolId), amountBN)
            .accountsPartial(accounts)
            .remainingAccounts(remainingAccounts)
            .instruction()
        : await program.methods
            .deposit(tokenMintPubkey, new BN(poolId), amountBN)
            .accountsPartial(accounts)
            .remainingAccounts(remainingAccounts)
            .instruction();
      transaction.add(stakeIx);
      
      // ✅ ALWAYS use sendTransaction (avoids Phantom malicious warning)
      const tx = await sendTransaction(transaction, connection, {
        skipPreflight: false,
      });
      
      console.log("✅ Transaction signature:", tx);

      console.log("✅ Transaction signature:", tx);
      
      // Wait for confirmation using polling (no WebSocket)
      await pollForConfirmation(connection, tx, 60);
      console.log("✅ Transaction confirmed!");
      
      // Sync to database
      await syncStakeToDb(publicKey.toString(), tokenMint, poolId);
      
      // Log activity for feed - use actual mint decimals
      const decimals = mintInfo!.data[44];
      const amountForLog = Number(BigInt(amount.toString()) / BigInt(10 ** decimals)) + Number(BigInt(amount.toString()) % BigInt(10 ** decimals)) / (10 ** decimals);
      await logActivity(publicKey.toString(), tokenMint, poolId, 'stake', amountForLog, userStakePDA.toBase58());
      
      return tx;
      
    } catch (error: any) {
      console.error("❌❌❌ FULL STAKE ERROR DETAILS:");
      console.error("Error type:", error.constructor.name);
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);
      console.error("Transaction logs:", error.logs);
      console.error("Simulation error:", error.simulationError);
      
      // Try to get detailed Anchor error
      if (error.error) {
        console.error("Anchor error:", error.error);
      }
      
      // Full stringified error
      console.error("Full error object:", JSON.stringify(error, null, 2));
          
      // Check if error message indicates the transaction actually succeeded
      if (error.message?.includes("already been processed") || 
          error.message?.includes("AlreadyProcessed")) {
        console.log("⚠️ Transaction was already processed - likely succeeded");
        // Try to get the signature from the error or logs
        const signature = error.signature || error.txSignature;
        if (signature) {
          console.log("✅ Found signature:", signature);
          
          // Try to sync to database even on "already processed" error
          await syncStakeToDb(publicKey.toString(), tokenMint, poolId);
          
          return signature;
        }
        // If we can't get signature, throw a more friendly error
        throw new Error("Transaction may have succeeded. Please refresh to check your balance.");
      }
      
      // Re-throw other errors
      throw error;
    }
  };

 /**
 * Unstake tokens from a pool
 * @param tokenMint - The token mint address
 */
const unstake = async (tokenMint: string, poolId: number = 0, amount?: number, engine: string = 'legacy') => {
  console.log("🔵 UNSTAKE START");
  
  if (!wallet || !publicKey) {
    throw new Error("Wallet not connected");
  }
  console.log("✅ Wallet connected");

  // ✅ PRE-FLIGHT CHECK: Verify SOL balance for fees
  const solBalance = await connection.getBalance(publicKey);
  const MINIMUM_SOL_FOR_FEES = 0.02 * 1_000_000_000;
  if (solBalance < MINIMUM_SOL_FOR_FEES) {
    throw new Error(`Insufficient SOL for transaction fees. You have ${(solBalance / 1_000_000_000).toFixed(4)} SOL but need at least 0.02 SOL.`);
  }
  console.log(`✅ SOL balance check passed: ${(solBalance / 1_000_000_000).toFixed(4)} SOL`);

  const program = getProgram(wallet, connection);
  const tokenMintPubkey = new PublicKey(tokenMint);
  console.log("✅ Program initialized, tokenMint:", tokenMint);

  // ✅ DETECT THE TOKEN PROGRAM TYPE
  const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
  if (!mintInfo) {
    throw new Error("Token mint not found");
  }
  
  // Check if it's Token-2022 or SPL Token
  const TOKEN_2022_PROGRAM_ID_UNSTAKE = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const SPL_TOKEN_PROGRAM_ID_UNSTAKE = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  
  const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID_UNSTAKE) 
    ? TOKEN_2022_PROGRAM_ID_UNSTAKE 
    : SPL_TOKEN_PROGRAM_ID_UNSTAKE;

  console.log(`✅ Token program detected for unstaking: ${tokenProgramId.toString()}`);

  // Get platform config
  const platformConfig = await getPlatformConfig(program);
  if (!platformConfig) {
    throw new Error("Platform not initialized");
  }
  console.log("✅ Platform config fetched");

  const feeCollector = platformConfig.feeCollector;

  // Get PDAs based on engine
  const [platformConfigPDA] = getPDAs.platformConfig();
  const [projectPDA] = engine === 'current'
    ? getPDAs.project1(tokenMintPubkey, poolId)
    : getPDAs.project(tokenMintPubkey, poolId);
  const [stakingVaultPDA] = engine === 'current'
    ? getPDAs.stakingVault1(tokenMintPubkey, poolId)
    : getPDAs.stakingVault(tokenMintPubkey, poolId);
  const [userStakePDA] = engine === 'current'
    ? getPDAs.userStake1(projectPDA, publicKey)
    : getPDAs.userStake(projectPDA, publicKey);
  console.log("✅ PDAs generated");

  // Get user stake data to find withdrawal wallet
  const userStake = engine === 'current'
    ? await program.account.stake1.fetch(userStakePDA, "confirmed")
    : await program.account.stake.fetch(userStakePDA, "confirmed");
  console.log("✅ User stake fetched, amount:", userStake.amount.toString());
  
  const withdrawalWallet = userStake.withdrawalWallet || publicKey;
  console.log("✅ Withdrawal wallet:", withdrawalWallet.toBase58());

  // ✅ Handle Native SOL vs SPL tokens differently
  const NATIVE_SOL_UNSTAKE = "So11111111111111111111111111111111111111112";
  const isNativeSOLUnstake = tokenMint === NATIVE_SOL_UNSTAKE;

  let withdrawalTokenAccount: PublicKey;

  if (isNativeSOLUnstake) {
    // ✅ For Native SOL, use the wallet itself (no ATA)
    withdrawalTokenAccount = withdrawalWallet;
    console.log("✅ Native SOL Unstake: Using wallet directly as token account");
  } else {
    // ✅ For SPL tokens, get the ATA
    withdrawalTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      withdrawalWallet,
      false, // allowOwnerOffCurve
      tokenProgramId  // Use detected token program
    );
    console.log("✅ SPL Token Unstake: Using ATA as token account");
  }
  console.log("✅ Withdrawal token account:", withdrawalTokenAccount.toBase58());

  // ✅ For Native SOL, fee collector account is the wallet itself
  // For SPL tokens, it's the ATA
  const NATIVE_SOL_UNSTAKE_FEE = "So11111111111111111111111111111111111111112";
  const isNativeSOLUnstakeFee = tokenMint === NATIVE_SOL_UNSTAKE_FEE;

  let feeCollectorTokenAccount: PublicKey;

  if (isNativeSOLUnstakeFee) {
    // ✅ For Native SOL, use fee collector wallet directly
    feeCollectorTokenAccount = feeCollector;
    console.log("✅ Native SOL Unstake: Using fee collector wallet for fees");
  } else {
    // ✅ For SPL tokens, get the ATA
    feeCollectorTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      feeCollector,
      false, // allowOwnerOffCurve
      tokenProgramId
    );
    console.log("✅ SPL Token Unstake: Using fee collector ATA for fees");
  }
  console.log("✅ Fee collector token account:", feeCollectorTokenAccount.toBase58());

  // Get project info to check for referrer AND reflection vault
  const project = engine === 'current'
    ? await program.account.project1.fetch(projectPDA, "confirmed")
    : await program.account.project.fetch(projectPDA, "confirmed");
  const projectReferrer = project.referrer;
  const reflectionVault = project.reflectionVault;
  
  console.log("✅ Project fetched");
  console.log("   - projectReferrer:", projectReferrer?.toBase58() || "null");
  console.log("   - reflectionVault:", reflectionVault?.toBase58() || "null");

  // ✅ REPLACE THESE 2 LINES WITH THE SECTION BELOW
  // If amount not specified, unstake all - with 99% buffer for Native SOL
  const isNativeSOL = tokenMint === "So11111111111111111111111111111111111111112";
  
  let amountBN: BN;
  if (amount) {
    // Partial unstake - apply 99% buffer for Native SOL only
    const adjustedAmount = isNativeSOL ? Math.floor(amount * 0.99) : amount;
    amountBN = new BN(adjustedAmount);
    console.log("✅ Partial unstake amount:", {
      original: amount,
      adjusted: adjustedAmount,
      isNativeSOL,
      buffer: isNativeSOL ? "99%" : "100%"
    });
  } else {
    // Full unstake - apply 99% buffer for Native SOL only
    const fullAmount = userStake.amount.toString();
    const adjustedAmount = isNativeSOL 
      ? new BN(userStake.amount.muln(99).divn(100))
      : new BN(fullAmount);
    amountBN = adjustedAmount;
    console.log("✅ Full unstake amount:", {
      original: fullAmount,
      adjusted: adjustedAmount,
      isNativeSOL,
      buffer: isNativeSOL ? "99%" : "100%"
    });
  }

  console.log("🔍 ACCOUNT CHECK:");
console.log("  User wallet:", wallet.publicKey.toString());
console.log("  Withdrawal token account:", withdrawalTokenAccount.toString());
console.log("  Fee collector token account:", feeCollectorTokenAccount.toString());
console.log("  Staking vault:", stakingVaultPDA.toString());

// Check if withdrawal token account exists
try {
  const accountInfo = await connection.getAccountInfo(withdrawalTokenAccount);
  if (!accountInfo) {
    console.log("⚠️ WITHDRAWAL TOKEN ACCOUNT DOES NOT EXIST - needs to be created");
  } else {
    console.log("✅ Withdrawal token account exists");
  }
} catch (e) {
  console.log("⚠️ Error checking withdrawal token account:", e);
}

// Check if fee collector token account exists
try {
  const feeAccountInfo = await connection.getAccountInfo(feeCollectorTokenAccount);
  if (!feeAccountInfo) {
    console.log("⚠️ FEE COLLECTOR TOKEN ACCOUNT DOES NOT EXIST");
  } else {
    console.log("✅ Fee collector token account exists");
  }
} catch (e) {
  console.log("⚠️ Error checking fee collector account:", e);
}

  // Build the accounts object
  const accounts = {
    platform: platformConfigPDA,
    project: projectPDA,
    stake: userStakePDA,
    stakingVault: stakingVaultPDA,
    withdrawalWallet: withdrawalWallet,
    withdrawalTokenAccount: withdrawalTokenAccount,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    feeCollector: feeCollector,
    reflectionVault: reflectionVault || stakingVaultPDA,
    tokenMintAccount: tokenMintPubkey,
    user: publicKey,
    tokenProgram: tokenProgramId,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  // Build remainingAccounts for referrer
  const remainingAccountsUnstake: any[] = [];
  if (projectReferrer && !projectReferrer.equals(PublicKey.default)) {
    remainingAccountsUnstake.push({
      pubkey: projectReferrer,
      isWritable: true,
      isSigner: false
    });
  }

  console.log("🔵 Accounts prepared for withdraw:", {
    platform: accounts.platform.toString(),
    project: accounts.project.toString(),
    stake: accounts.stake.toString(),
    stakingVault: accounts.stakingVault.toString(),
    withdrawalWallet: accounts.withdrawalWallet.toString(),
    withdrawalTokenAccount: accounts.withdrawalTokenAccount.toString(),
    user: accounts.user.toString(),
  });

  try {
    // Check if fee collector ATA needs creation
    const feeCollectorNeedsInit = !isNativeSOLUnstakeFee && !feeCollectorTokenAccount.equals(withdrawalTokenAccount) && !(await connection.getAccountInfo(feeCollectorTokenAccount));

    // Check if withdrawal token account exists; create if it doesn't
    const accountInfo = await connection.getAccountInfo(withdrawalTokenAccount);
    
    if (!accountInfo) {
      console.log("⚠️ Creating withdrawal token account...");
      
      // Create the token account instruction
      const createATAIx = createAssociatedTokenAccountInstruction(
        publicKey,              // payer
        withdrawalTokenAccount, // ata
        withdrawalWallet,       // owner
        tokenMintPubkey,        // mint
        tokenProgramId,         // ✅ Token program (SPL or Token-2022)
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Build transaction with ATA creation + withdraw
      const transaction = new Transaction();
      // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      transaction.add(createATAIx);
      if (feeCollectorNeedsInit) {
        transaction.add(createAssociatedTokenAccountInstruction(
          publicKey, feeCollectorTokenAccount, feeCollector, tokenMintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID
        ));
      }
      
      // Add withdraw instruction
      const withdrawIx = engine === 'current'
        ? await program.methods
            .withdraw1(tokenMintPubkey, new BN(poolId), amountBN)
            .accountsPartial(accounts)
            .remainingAccounts(remainingAccountsUnstake)
            .instruction()
        : await program.methods
            .withdraw(tokenMintPubkey, new BN(poolId), amountBN)
            .accountsPartial(accounts)
            .remainingAccounts(remainingAccountsUnstake)
            .instruction();
      
      transaction.add(withdrawIx);
      
      // Send as a single transaction
      const tx = await sendTransaction(transaction, connection);
      console.log("✅ Transaction signature (with ATA creation):", tx);
      
      await pollForConfirmation(connection, tx);
      console.log("✅ Transaction confirmed!");
      
      // Log activity for feed - use actual mint decimals
      const uDecimals = mintInfo!.data[44];
      const uRaw = BigInt(amountBN.toString());
      const uDiv = BigInt(10 ** uDecimals);
      const unstakeForLog = Number(uRaw / uDiv) + Number(uRaw % uDiv) / Number(uDiv);
      await logActivity(publicKey.toString(), tokenMint, poolId, 'unstake', unstakeForLog, userStakePDA.toBase58());
      
      return tx;
    } else {
      console.log("✅ Withdrawal token account exists, proceeding with withdraw...");
      
      // Normal withdraw without ATA creation
      const transaction = new Transaction();
      // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      if (feeCollectorNeedsInit) {
        transaction.add(createAssociatedTokenAccountInstruction(
          publicKey, feeCollectorTokenAccount, feeCollector, tokenMintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID
        ));
      }
      const withdrawIx = engine === 'current'
        ? await program.methods
            .withdraw1(tokenMintPubkey, new BN(poolId), amountBN)
            .accountsPartial(accounts)
            .remainingAccounts(remainingAccountsUnstake)
            .instruction()
        : await program.methods
            .withdraw(tokenMintPubkey, new BN(poolId), amountBN)
            .accountsPartial(accounts)
            .remainingAccounts(remainingAccountsUnstake)
            .instruction();
      transaction.add(withdrawIx);
      
      const tx = await sendTransaction(transaction, connection);
      console.log("✅ Transaction signature:", tx);
      
      await pollForConfirmation(connection, tx, 60);
      console.log("✅ Transaction confirmed!");
      
      // Sync to database
      await syncStakeToDb(publicKey.toString(), tokenMint, poolId);
      
      // Log activity for feed - use actual mint decimals
      const uDecimals2 = mintInfo!.data[44];
      const uRaw2 = BigInt(amountBN.toString());
      const uDiv2 = BigInt(10 ** uDecimals2);
      const amountForLog = Number(uRaw2 / uDiv2) + Number(uRaw2 % uDiv2) / Number(uDiv2);
      await logActivity(publicKey.toString(), tokenMint, poolId, 'unstake', amountForLog, userStakePDA.toBase58());
      
      return tx;
    }
  } catch (error: any) {
    console.error("❌ Unstake transaction error:", error);
    
    if (error.message?.includes("already been processed") || 
        error.message?.includes("AlreadyProcessed")) {
      console.log("⚠️ Transaction was already processed - likely succeeded");
      const signature = error.signature || error.txSignature;
      if (signature) {
        console.log("✅ Found signature:", signature);
        
         // Try to sync to database even on "already processed" error
        await syncStakeToDb(publicKey.toString(), tokenMint, poolId);
        
        return signature;
      }
      throw new Error("Transaction may have succeeded. Please refresh to check your balance.");
    }
    
    throw error;
  }
};

  /**
   * Claim rewards from a pool
   * @param tokenMint - The token mint address
   */
  const claimRewards = async (tokenMint: string, poolId: number = 0, displayAmount?: number, engine: string = 'legacy') => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    // ✅ PRE-FLIGHT CHECK: Verify SOL balance for fees
    const solBalance = await connection.getBalance(publicKey);
    const MINIMUM_SOL_FOR_FEES = 0.02 * 1_000_000_000;
    if (solBalance < MINIMUM_SOL_FOR_FEES) {
      throw new Error(`Insufficient SOL for transaction fees. You have ${(solBalance / 1_000_000_000).toFixed(4)} SOL but need at least 0.02 SOL.`);
    }

    const program = getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    // ✅ DETECT THE TOKEN PROGRAM TYPE
    const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
    if (!mintInfo) {
      throw new Error("Token mint not found");
    }
    
    const TOKEN_2022_PROGRAM_ID_CLAIM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const SPL_TOKEN_PROGRAM_ID_CLAIM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    
    const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID_CLAIM) 
      ? TOKEN_2022_PROGRAM_ID_CLAIM 
      : SPL_TOKEN_PROGRAM_ID_CLAIM;

    console.log(`✅ Token program detected for claiming: ${tokenProgramId.toString()}`);

    // Get platform config
    const platformConfig = await getPlatformConfig(program);
    if (!platformConfig) {
      throw new Error("Platform not initialized");
    }

    const feeCollector = platformConfig.feeCollector;

    // Get PDAs based on engine
    const [platformConfigPDA] = getPDAs.platformConfig();
    const [projectPDA] = engine === 'current'
      ? getPDAs.project1(tokenMintPubkey, poolId)
      : getPDAs.project(tokenMintPubkey, poolId);
    const [stakingVaultPDA] = engine === 'current'
      ? getPDAs.stakingVault1(tokenMintPubkey, poolId)
      : getPDAs.stakingVault(tokenMintPubkey, poolId);
    const [rewardVaultPDA] = engine === 'current'
      ? getPDAs.rewardVault1(tokenMintPubkey, poolId)
      : getPDAs.rewardVault(tokenMintPubkey, poolId);
    const [userStakePDA] = engine === 'current'
      ? getPDAs.userStake1(projectPDA, publicKey)
      : getPDAs.userStake(projectPDA, publicKey);

    // Get user stake data to find withdrawal wallet
    const userStake = engine === 'current'
      ? await program.account.stake1.fetch(userStakePDA, "confirmed")
      : await program.account.stake.fetch(userStakePDA, "confirmed");
    const withdrawalWallet = userStake.withdrawalWallet || publicKey;

    // ✅ Handle Native SOL vs SPL tokens differently
    const NATIVE_SOL_CLAIM = "So11111111111111111111111111111111111111112";
    const isNativeSOLClaim = tokenMint === NATIVE_SOL_CLAIM;

    let withdrawalTokenAccount: PublicKey;

    if (isNativeSOLClaim) {
      // ✅ For Native SOL, use the wallet itself (no ATA)
      withdrawalTokenAccount = withdrawalWallet;
      console.log("✅ Native SOL Claim: Using wallet directly as token account");
    } else {
      // ✅ For SPL tokens, get the ATA
      withdrawalTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        withdrawalWallet,
        false, // allowOwnerOffCurve
        tokenProgramId  // Use detected token program
      );
      console.log("✅ SPL Token Claim: Using ATA as token account");
    }

    // ✅ For Native SOL, fee collector account is the wallet itself
    // For SPL tokens, it's the ATA
    const NATIVE_SOL_CLAIM_FEE = "So11111111111111111111111111111111111111112";
    const isNativeSOLClaimFee = tokenMint === NATIVE_SOL_CLAIM_FEE;

    let feeCollectorTokenAccount: PublicKey;

    if (isNativeSOLClaimFee) {
      // ✅ For Native SOL, use fee collector wallet directly
      feeCollectorTokenAccount = feeCollector;
      console.log("✅ Native SOL Claim: Using fee collector wallet for fees");
    } else {
      // ✅ For SPL tokens, get the ATA
      feeCollectorTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        feeCollector,
        false, // allowOwnerOffCurve
        tokenProgramId
      );
      console.log("✅ SPL Token Claim: Using fee collector ATA for fees");
    }

    // Get project info to check for referrer and reflection vault
    let projectReferrer: any;
    let reflectionVault: any;
    let rewardTokenMint: PublicKey | null = null;

    if (engine === 'current') {
      const p1 = await program.account.project1.fetch(projectPDA, "confirmed");
      projectReferrer = p1.referrer;
      reflectionVault = p1.reflectionVault;
      rewardTokenMint = p1.rewardTokenMint ?? null;
    } else {
      const p0 = await program.account.project.fetch(projectPDA, "confirmed");
      projectReferrer = p0.referrer;
      reflectionVault = p0.reflectionVault;
    }

    // For V2 dual staking: use reward token mint instead of staking token mint
    let claimMintPubkey = tokenMintPubkey;
    let claimTokenProgramId = tokenProgramId;
    if (rewardTokenMint) {
      claimMintPubkey = rewardTokenMint;
      const rewardMintInfo = await connection.getAccountInfo(claimMintPubkey);
      if (rewardMintInfo) {
        claimTokenProgramId = rewardMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID_CLAIM)
          ? TOKEN_2022_PROGRAM_ID_CLAIM
          : SPL_TOKEN_PROGRAM_ID_CLAIM;
      }
      // Re-derive user's ATA for the reward token
      withdrawalTokenAccount = await getAssociatedTokenAddress(
        claimMintPubkey,
        withdrawalWallet,
        false,
        claimTokenProgramId
      );
      console.log("✅ V2 Dual Staking: Claiming reward token:", claimMintPubkey.toString());
    }

    const accounts: any = {
      platform: platformConfigPDA,
      project: projectPDA,
      stake: userStakePDA,
      rewardVault: rewardVaultPDA,
      userTokenAccount: withdrawalTokenAccount,
      feeCollector: feeCollector,
      reflectionVault: reflectionVault || stakingVaultPDA,
      tokenMintAccount: claimMintPubkey,
      user: publicKey,
      tokenProgram: engine === 'current' ? claimTokenProgramId : tokenProgramId,
      rewardTokenProgram: engine === 'current' ? claimTokenProgramId : undefined,
      systemProgram: SystemProgram.programId,
    };

    // ✅ Build remainingAccounts for referrer
    const remainingAccountsClaim = [];
    if (projectReferrer && !projectReferrer.equals(PublicKey.default)) {
      remainingAccountsClaim.push({
        pubkey: projectReferrer,
        isWritable: true,
        isSigner: false
      });
    }

    try {
      // Check if fee collector ATA needs creation
      const feeCollectorNeedsInitClaim = !isNativeSOLClaimFee && !feeCollectorTokenAccount.equals(withdrawalTokenAccount) && !(await connection.getAccountInfo(feeCollectorTokenAccount));

      // Check if withdrawal token account exists; create if it doesn't
      const accountInfo = await connection.getAccountInfo(withdrawalTokenAccount);
      
      if (!accountInfo) {
        console.log("⚠️ Creating withdrawal token account for claim...");
        
        const createATAIx = createAssociatedTokenAccountInstruction(
          publicKey,
          withdrawalTokenAccount,
          withdrawalWallet,
          claimMintPubkey,
          claimTokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        
        const transaction = new Transaction();
        // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
        transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
        transaction.add(createATAIx);
        if (feeCollectorNeedsInitClaim) {
          transaction.add(createAssociatedTokenAccountInstruction(
            publicKey, feeCollectorTokenAccount, feeCollector, claimMintPubkey, claimTokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID
          ));
        }
        
        const claimIx = engine === 'current'
          ? await program.methods
              .claim1(tokenMintPubkey, new BN(poolId))
              .accountsPartial(accounts)
              .remainingAccounts(remainingAccountsClaim)
              .instruction()
          : await program.methods
              .claim(tokenMintPubkey, new BN(poolId))
              .accountsPartial(accounts)
              .remainingAccounts(remainingAccountsClaim)
              .instruction();
        
        transaction.add(claimIx);

        const tx = await sendTransaction(transaction, connection);
        console.log("✅ Claim transaction signature (with ATA creation):", tx);

        await pollForConfirmation(connection, tx);
        console.log("✅ Transaction confirmed!");
        
        // Log activity for feed
        await logActivity(publicKey.toString(), tokenMint, poolId, 'claim', displayAmount || 0, userStakePDA.toBase58());

        return tx;
         } else {
       const transaction = new Transaction();
       // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
       transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
       transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
       if (feeCollectorNeedsInitClaim) {
         transaction.add(createAssociatedTokenAccountInstruction(
           publicKey, feeCollectorTokenAccount, feeCollector, tokenMintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID
         ));
       }
       const claimIx = engine === 'current'
         ? await program.methods
             .claim1(tokenMintPubkey, new BN(poolId))
             .accountsPartial(accounts)
             .remainingAccounts(remainingAccountsClaim)
             .instruction()
         : await program.methods
             .claim(tokenMintPubkey, new BN(poolId))
             .accountsPartial(accounts)
             .remainingAccounts(remainingAccountsClaim)
             .instruction();
       transaction.add(claimIx);
       
       const tx = await sendTransaction(transaction, connection);
        console.log("✅ Claim rewards transaction signature:", tx);
        
        await pollForConfirmation(connection, tx);
        console.log("✅ Transaction confirmed!");
        
        // Log activity for feed
        await logActivity(publicKey.toString(), tokenMint, poolId, 'claim', displayAmount || 0, userStakePDA.toBase58());
        
        return tx;
      }
    } catch (error: any) {
      console.error("Claim rewards error:", error);
      
      if (error.message?.includes("already been processed") || 
          error.message?.includes("AlreadyProcessed")) {
        console.log("⚠️ Transaction was already processed - likely succeeded");
        const signature = error.signature || error.txSignature;
        if (signature) {
          return signature;
        }
        throw new Error("Transaction may have succeeded. Please refresh to check your rewards.");
      }
      
      throw error;
    }
  };

  /**
   * Claim reflections from a pool
   * @param tokenMint - The token mint address (staking token)
   */
  const extendLock = async (
    tokenMint: string,
    poolId: number,
    newLockupSeconds: number
  ) => {
    if (!wallet || !publicKey || !sendTransaction) {
      throw new Error("Wallet not connected");
    }

    const program = getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);

    const ix = await program.methods
      .extendLock(tokenMintPubkey, new BN(poolId), new BN(newLockupSeconds))
      .accountsPartial({
        project: projectPDA,
        stake: userStakePDA,
        user: publicKey,
      })
      .instruction();

    const transaction = new Transaction();
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
    transaction.add(ix);

    transaction.feePayer = publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const signature = await sendTransaction(transaction, connection);
    await pollForConfirmation(connection, signature);

    return signature;
  };

  const claimExtraReward = async (
    tokenMint: string,
    poolId: number,
    extraMint: string
  ) => {
    if (!wallet || !publicKey || !sendTransaction) {
      throw new Error("Wallet not connected");
    }

    const program = getProgram(wallet, connection);

    const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const TOKEN_CLASSIC = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

    const tokenMintPubkey = new PublicKey(tokenMint);
    const extraMintPubkey = new PublicKey(extraMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);

    const [extraRewardPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra_reward"), projectPDA.toBuffer(), extraMintPubkey.toBuffer()],
      program.programId
    );

    const extraMintInfo = await connection.getAccountInfo(extraMintPubkey);
    if (!extraMintInfo) throw new Error("Extra reward mint not found");
    const extraTokenProgram = extraMintInfo.owner.equals(TOKEN_2022) ? TOKEN_2022 : TOKEN_CLASSIC;

    // Vault is the project's own ATA for the extra mint
    const extraVault = await getAssociatedTokenAddress(
      extraMintPubkey,
      projectPDA,
      true,
      extraTokenProgram
    );

    // Destination is the claimer's ATA, created here if missing
    const destination = await getAssociatedTokenAddress(
      extraMintPubkey,
      publicKey,
      false,
      extraTokenProgram
    );

    const transaction = new Transaction();
    transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));

    const destInfo = await connection.getAccountInfo(destination);
    if (!destInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          destination,
          publicKey,
          extraMintPubkey,
          extraTokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    const claimIx = await program.methods
      .claimExtraReward(tokenMintPubkey, new BN(poolId), extraMintPubkey)
      .accountsPartial({
        project: projectPDA,
        extraReward: extraRewardPDA,
        stake: userStakePDA,
        extraVault: extraVault,
        destination: destination,
        extraMintAccount: extraMintPubkey,
        beneficiary: publicKey,
        tokenProgram: extraTokenProgram,
      })
      .instruction();

    transaction.add(claimIx);

    transaction.feePayer = publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const signature = await sendTransaction(transaction, connection);
    await pollForConfirmation(connection, signature);

    return signature;
  };

  const claimReflections = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.02 * 1_000_000_000) {
      throw new Error(`Insufficient SOL for transaction fees. You have ${(solBalance / 1_000_000_000).toFixed(4)} SOL but need at least 0.02 SOL.`);
    }

    const program = getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    // ✅ DETECT THE TOKEN PROGRAM TYPE
    const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
    if (!mintInfo) {
      throw new Error("Token mint not found");
    }
    
    const TOKEN_2022_PROGRAM_ID_REFL = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const SPL_TOKEN_PROGRAM_ID_REFL = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    
    const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID_REFL) 
      ? TOKEN_2022_PROGRAM_ID_REFL 
      : SPL_TOKEN_PROGRAM_ID_REFL;

    console.log(`✅ Token program detected for reflections: ${tokenProgramId.toString()}`);

    // Get PDAs
    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);
    const [stakingVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, poolId);

    // ✅ FIX 1: Fetch project data to get the reflection vault and reflection token
    const project = await program.account.project.fetch(projectPDA, "confirmed");
    
    if (!project.reflectionVault) {
      throw new Error("Reflections not enabled for this pool");
    }
    
    if (!project.reflectionToken) {
      throw new Error("Reflection token not configured");
    }

    const reflectionVaultPubkey = project.reflectionVault;
    const reflectionTokenMint = project.reflectionToken;

    // ✅ Detect the token program for the REFLECTION token (might be different from staking token)
    const reflectionMintInfo = await connection.getAccountInfo(reflectionTokenMint);
    if (!reflectionMintInfo) {
      throw new Error("Reflection token mint not found");
    }
    
    const TOKEN_2022_PROGRAM_ID_REFL_MINT = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const reflectionTokenProgramId = reflectionMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID_REFL_MINT)
      ? TOKEN_2022_PROGRAM_ID_REFL_MINT
      : new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    
    console.log(`✅ Reflection token program detected: ${reflectionTokenProgramId.toString()}`);

    // Get user stake to find withdrawal wallet
    const userStake = await program.account.stake.fetch(userStakePDA, "confirmed");
    const withdrawalWallet = userStake.withdrawalWallet || publicKey;

    // ✅ Check if reflection token is Native SOL
    const isNativeSOL = reflectionTokenMint.toString() === "So11111111111111111111111111111111111111112";

    console.log("✅ Reflection claim details:", {
      reflectionTokenMint: reflectionTokenMint.toString(),
      isNativeSOL,
      buffer: isNativeSOL ? "99% (rent-exempt protection)" : "100%"
    });

    let userReflectionAccount: PublicKey;

    if (isNativeSOL) {
      // For Native SOL, use the user's wallet directly (no ATA needed)
      userReflectionAccount = withdrawalWallet;
      console.log("✅ Using wallet directly for Native SOL reflections:", withdrawalWallet.toString());
    } else {
      // For SPL tokens, get the ATA
      userReflectionAccount = await getAssociatedTokenAddress(
        reflectionTokenMint,
        withdrawalWallet,
        false,
        reflectionTokenProgramId
      );
      console.log("✅ Using ATA for SPL token reflections:", userReflectionAccount.toString());
    }

    // ✅ FIX: Determine which vault to pass based on Native SOL vs SPL token
    const isNativeSOLReflections = reflectionTokenMint.toString() === "So11111111111111111111111111111111111111112";

    let actualReflectionVault: PublicKey;
    if (isNativeSOLReflections) {
      // For Native SOL, use the Project PDA (where SOL lamports are stored)
      actualReflectionVault = projectPDA;
      console.log("✅ Using Project PDA for Native SOL reflections:", actualReflectionVault.toString());
    } else {
      // For SPL tokens, use the stored reflection vault ATA
      actualReflectionVault = reflectionVaultPubkey;
      console.log("✅ Using reflection vault ATA for SPL reflections:", actualReflectionVault.toString());
    }

    console.log("🔍 Claim Reflections Accounts:", {
      project: projectPDA.toString(),
      stake: userStakePDA.toString(),
      stakingVault: stakingVaultPDA.toString(),
      reflectionVault: actualReflectionVault.toString(),
      reflectionTokenMint: reflectionTokenMint.toString(),
      userReflectionAccount: userReflectionAccount.toString(),
      withdrawalWallet: withdrawalWallet.toString(),
      user: publicKey.toString(),
    });

    try {
      // Check if user's reflection token account exists
      const accountInfo = await connection.getAccountInfo(userReflectionAccount);
      
      if (!accountInfo) {
        console.log("⚠️ Creating reflection token account for user...");
        
        // ✅ Create ATA for reflection token
        const createATAIx = createAssociatedTokenAccountInstruction(
          publicKey,              // payer
          userReflectionAccount,  // ata
          withdrawalWallet,       // owner
          reflectionTokenMint,    // mint (reflection token!)
          reflectionTokenProgramId,  // ✅ Use reflection token's program
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        
        const transaction = new Transaction();
        // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
        transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
        transaction.add(createATAIx);
        
        const claimIx = await program.methods
          .claimReflections(tokenMintPubkey, new BN(poolId))
          .accountsPartial({
          project: projectPDA,
          stake: userStakePDA,
          reflectionVault: actualReflectionVault,
          userReflectionAccount: userReflectionAccount,
          reflectionTokenMint: reflectionTokenMint,
          user: publicKey,
          tokenProgram: reflectionTokenProgramId,
          systemProgram: SystemProgram.programId,
        })
          .instruction();
        
        transaction.add(claimIx);
        transaction.feePayer = publicKey;

        console.log("🧪 Simulating claim reflections transaction...");
        const simulation = await connection.simulateTransaction(transaction);
        console.log("🧪 Simulation result:", JSON.stringify(simulation, null, 2));

        if (simulation.value.err) {
          console.error("❌ SIMULATION ERROR:", simulation.value.err);
          console.error("📋 SIMULATION LOGS:", simulation.value.logs);
          throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
        }
                
        const signature = await sendTransaction(transaction, connection);
        console.log("✅ Claim reflections signature (with ATA creation):", signature);
        
        await pollForConfirmation(connection, signature);
        console.log("✅ Transaction confirmed!");
        
        return signature;
      } else {
      // Build transaction manually so we can simulate
      const transaction = new Transaction();
      // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      const claimIx = await program.methods
        .claimReflections(tokenMintPubkey, new BN(poolId))
        .accountsPartial({
        project: projectPDA,
        stake: userStakePDA,
        reflectionVault: actualReflectionVault,
        userReflectionAccount: userReflectionAccount,
        reflectionTokenMint: reflectionTokenMint,
        user: publicKey,
        tokenProgram: reflectionTokenProgramId,
        systemProgram: SystemProgram.programId,
      })
        .instruction();
      
      transaction.add(claimIx);
      transaction.feePayer = publicKey;
      
      console.log("🧪 Simulating claim reflections transaction (no ATA path)...");
      const simulation = await connection.simulateTransaction(transaction);
      console.log("🧪 Simulation result:", JSON.stringify(simulation, null, 2));
      
      if (simulation.value.err) {
        console.error("❌ SIMULATION ERROR:", simulation.value.err);
        console.error("📋 SIMULATION LOGS:", simulation.value.logs);
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }
      
      const tx = await sendTransaction(transaction, connection);
      
       console.log("✅ Claim reflections transaction signature:", tx);
      
      await pollForConfirmation(connection, tx);
      console.log("✅ Transaction confirmed!");
      return tx;
    }
    } catch (error: any) {
      console.error("Claim reflections error:", error);
      
      if (error.message?.includes("already been processed") || 
          error.message?.includes("AlreadyProcessed")) {
        console.log("⚠️ Transaction was already processed - likely succeeded");
        const signature = error.signature || error.txSignature;
        if (signature) {
          return signature;
        }
        throw new Error("Transaction may have succeeded. Please refresh to check your reflections.");
      }
      
      throw error;
    }
  };

  /**
   * Refresh reflections calculation
   * @param tokenMint - The token mint address
   */
  const refreshReflections = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.02 * 1_000_000_000) {
      throw new Error(`Insufficient SOL for transaction fees. You have ${(solBalance / 1_000_000_000).toFixed(4)} SOL but need at least 0.02 SOL.`);
    }

    const program = getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    // Get PDAs
    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);

    // ✅ Fetch the project data to get the EXACT reflection vault address stored on-chain
    const project = await program.account.project.fetch(projectPDA, "confirmed");

    if (!project.reflectionVault) {
      throw new Error("Reflections not enabled for this pool");
    }

    // ✅ USE THE EXACT ADDRESS STORED IN project.reflectionVault!
    const reflectionVaultPubkey = new PublicKey(project.reflectionVault.toString());

    console.log("🔄 Refreshing reflections...");
    console.log("   Project:", projectPDA.toString());
    console.log("   User Stake:", userStakePDA.toString());
    console.log("   Reflection Vault (from blockchain):", reflectionVaultPubkey.toString());

    // Add random padding to compute units to make transaction unique
    const timestamp = Date.now();
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 200_000 + (timestamp % 10_000),
    });

    console.log("🎲 Unique compute units:", 200_000 + (timestamp % 10_000));

    const transaction = new Transaction();
    transaction.add(computeBudgetIx);
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
    
    const refreshIx = await program.methods
      .refreshReflections(tokenMintPubkey, new BN(poolId))
      .accountsPartial({
        project: projectPDA,
        stake: userStakePDA,
        reflectionVault: reflectionVaultPubkey,
        user: publicKey,
      })
      .instruction();
    transaction.add(refreshIx);
    
    const tx = await sendTransaction(transaction, connection, { skipPreflight: true });

    console.log("✅ Refresh reflections transaction signature:", tx);
    console.log("⏳ Confirming transaction...");

    await pollForConfirmation(connection, tx);
    console.log("✅ Transaction confirmed successfully!");

    // ✅ FIX: Fetch and return the updated stake account
    console.log("📥 Fetching updated stake account...");
    const updatedStake = await program.account.stake.fetch(userStakePDA, "confirmed");
    console.log("✅ Updated reflections_pending:", updatedStake.reflectionsPending.toNumber());

    // Return the reflections balance in lamports
    return updatedStake.reflectionsPending.toNumber();
  };

  /* REMOVED_MARKER
  } else {
    // For SPL tokens, get the ATA
    adminTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      project.admin,
      false,
      tokenProgramId
    );
    console.log("✅ SPL Token: Using admin ATA");
  }

  // Get project vault (where unclaimed tokens are stored)
  const [projectVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, poolId);

  console.log("🔑 Claim Unclaimed Tokens:", {
    project: projectPDA.toString(),
    projectVault: projectVaultPDA.toString(),
    tokenMint: tokenMintPubkey.toString(),
    adminTokenAccount: adminTokenAccount.toString(),
    admin: project.admin.toString(),
  });

  try {
    // Check if admin token account exists; create if not
    const accountInfo = await connection.getAccountInfo(adminTokenAccount);
    
    if (!accountInfo && !isNativeSOL) {
      console.log("⚠️ Creating admin token account...");
      
      const createATAIx = createAssociatedTokenAccountInstruction(
        publicKey,
        adminTokenAccount,
        project.admin,
        tokenMintPubkey,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      const transaction = new Transaction();
      // ✅ ADD COMPUTE BUDGET FIRST (Phantom checklist requirement)
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
      transaction.add(createATAIx);
      
      const claimIx = await program.methods
        .claimUnclaimedTokens(tokenMintPubkey, new BN(poolId))
        .accounts({
          project: projectPDA,
          projectVault: projectVaultPDA,
          tokenMint: tokenMintPubkey,
          adminTokenAccount: adminTokenAccount,
          admin: project.admin,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      
      transaction.add(claimIx);
      
      const signature = await sendTransaction(transaction, connection);
      console.log("✅ Claim unclaimed tokens (with ATA creation):", signature);
      
      await pollForConfirmation(connection, signature);
      console.log("✅ Transaction confirmed!");
      
      return signature;
    } else {
       // Admin account exists, claim directly
      const transaction = new Transaction();
      const claimIx = await program.methods
        .claimUnclaimedTokens(tokenMintPubkey, new BN(poolId))
        .accounts({
          project: projectPDA,
          projectVault: projectVaultPDA,
          tokenMint: tokenMintPubkey,
          adminTokenAccount: adminTokenAccount,
          admin: project.admin,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      transaction.add(claimIx);
      
      const tx = await sendTransaction(transaction, connection);
      console.log("✅ Claim unclaimed tokens signature:", tx);
      
      await pollForConfirmation(connection, tx);
      console.log("✅ Transaction confirmed!");
      return tx;
    }
  } catch (error: any) {
    console.error("❌ Claim unclaimed error:", error);
    
    if (error.message?.includes("already been processed") || 
        error.message?.includes("AlreadyProcessed")) {
      console.log("⚠️ Transaction already processed - likely succeeded");
      const signature = error.signature || error.txSignature;
      if (signature) {
        return signature;
      }
      throw new Error("Transaction may have succeeded. Please refresh.");
    }
    
    throw error;
  }
};
  */

  /**
   * Get user stake info
   * @param tokenMint - The token mint address
   */
  const getUserStake = async (tokenMint: string, poolId: number = 0, engine: string = 'legacy') => {
    if (!wallet || !publicKey) {
      return null;
    }

    try {
      const program = getProgram(wallet, connection);
      const tokenMintPubkey = new PublicKey(tokenMint);
      const [projectPDA] = engine === 'current'
        ? getPDAs.project1(tokenMintPubkey, poolId)
        : getPDAs.project(tokenMintPubkey, poolId);
      const [userStakePDA] = engine === 'current'
        ? getPDAs.userStake1(projectPDA, publicKey)
        : getPDAs.userStake(projectPDA, publicKey);

      const userStake = engine === 'current'
        ? await program.account.stake1.fetch(userStakePDA, "confirmed")
        : await program.account.stake.fetch(userStakePDA, "confirmed");
      return userStake;
    } catch (error) {
      // User hasn't staked yet
      return null;
    }
  };

  /**
   * Get project/pool info
   * @param tokenMint - The token mint address
   */
  const getProjectInfo = async (tokenMint: string, poolId: number = 0, engine: string = 'legacy') => {
    // Use read-only program - no wallet connection required for public data
    const { getReadOnlyProgram } = await import("@/lib/anchor-program");
    const program = getReadOnlyProgram(connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const [projectPDA] = engine === 'current'
      ? getPDAs.project1(tokenMintPubkey, poolId)
      : getPDAs.project(tokenMintPubkey, poolId);

    const projectData = engine === 'current'
      ? await program.account.project1.fetch(projectPDA, "confirmed")
      : await program.account.project.fetch(projectPDA, "confirmed");
    return {
      ...projectData,
      address: projectPDA,
    };
  };

  /**
   * Calculate dynamic APR for variable pools
   * @param tokenMint - The token mint address
   * @returns APR as percentage (e.g., 15.5 for 15.5%)
   */
  const calculateDynamicAPR = async (tokenMint: string, poolId: number = 0, preloadedProject?: any): Promise<number> => {
    try {
      console.log(`🔍 calculateDynamicAPR called for: ${tokenMint}`);
      
      const project = preloadedProject || await getProjectInfo(tokenMint, poolId);
      
      if (!project) {
        console.log(`❌ No project data found`);
        return 0;
      }
      
      console.log(`📦 Project data:`, {
        rateMode: project.rateMode,
        rateBpsPerYear: project.rateBpsPerYear.toString(),
        rewardRatePerSecond: project.rewardRatePerSecond.toString(),
        totalStaked: project.totalStaked.toString(),
        poolDuration: project.poolDurationSeconds?.toString() || 'undefined',
      });
      
      // For locked pools (rate_mode = 0), return the static APY from rate_bps_per_year
      if (project.rateMode === 0) {
        const apy = project.rateBpsPerYear.toNumber() / 100;
        console.log(`📊 Locked pool - returning static APY: ${apy}%`);
        return apy;
      }
      
      // For variable pools, calculate dynamic APR using BigInt for large numbers
      const rewardRatePerSecond = BigInt(project.rewardRatePerSecond?.toString() || '0');
      const totalStaked = BigInt(project.totalStaked?.toString() || '0');

      console.log(`🔢 Calculation values:`, {
        rewardRatePerSecond: rewardRatePerSecond.toString(),
        totalStaked: totalStaked.toString(),
        SECONDS_PER_YEAR,
      });

      // If no one has staked or no rewards, APR is 0
      if (totalStaked === 0n) {
        console.log(`⚠️ Total staked is 0 - APR = 0`);
        return 0;
      }

      if (rewardRatePerSecond === 0n) {
        console.log(`⚠️ Reward rate per second is 0 - APR = 0`);
        return 0;
      }

      // Calculate APR using BigInt
      const annualRewards = rewardRatePerSecond * BigInt(SECONDS_PER_YEAR);
      const apr = Number((annualRewards * 10000n) / totalStaked) / 100;

      console.log(`✅ Calculated APR: ${apr.toFixed(2)}%`);

      return apr;
    } catch (error) {
      console.error("❌ Error calculating APR:", error);
      return 0;
    }
  };

  /**
   * Get pool rate (APY for locked, APR for variable)
   * @param tokenMint - The token mint address
   * @returns Object with rate, type, and rate_mode
   */
  const getPoolRate = async (tokenMint: string, poolId: number = 0, engine: string = 'legacy') => {
    try {
      console.log(`🎯 getPoolRate called for: ${tokenMint} engine=${engine}`);
      
      const project = await getProjectInfo(tokenMint, poolId, engine);
      
      if (!project) {
        console.log(`❌ getPoolRate: No project found`);
        return { rate: 0, type: "apy", rateMode: 0, project: null };
      }
      
      const rateMode = project.rateMode;
      console.log(`📋 getPoolRate: rateMode = ${rateMode}`);
      
      if (rateMode === 0) {
        // Locked pool - static APY
        const apy = project.rateBpsPerYear.toNumber() / 100;
        console.log(`🔒 getPoolRate: Locked pool, APY = ${apy}%`);
        return { rate: apy, type: "apy", rateMode: 0, project };
      } else {
        // Variable pool - dynamic APR
        console.log(`🔓 getPoolRate: Variable pool, calling calculateDynamicAPR...`);
        const apr = await calculateDynamicAPR(tokenMint, poolId, project);
        console.log(`✅ getPoolRate: Calculated APR = ${apr}%`);
        return { rate: apr, type: "apr", rateMode: 1, project };
      }
    } catch (error: any) {
      console.error("❌❌❌ Error in getPoolRate:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        tokenMint
      });
      return { rate: 0, type: "apy", rateMode: 0, project: null };
    }
  };

  /**
   * Calculate estimated rewards
   * @param tokenMint - The token mint address
   */
  const calculateRewards = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      return 0;
    }

    try {
      const userStake = await getUserStake(tokenMint, poolId);
      const project = await getProjectInfo(tokenMint, poolId);

      if (!userStake || !project) return 0;

      // Get pending rewards from the smart contract
      const pendingRewards = userStake.rewardsPending.toNumber();
      
      return pendingRewards;
    } catch (error) {
      console.error("Error calculating rewards:", error);
      return 0;
    }
  };

  // ============================================
  // BATCH FUNCTIONS WITH ADDRESS LOOKUP TABLE
  // Replace the existing batch functions in useStakingProgram.ts
  // ============================================

  /**
   * Get or create Address Lookup Table for batched transactions
   */
  const getOrCreateALT = async (): Promise<PublicKey | null> => {
    if (!publicKey) return null;
    
    try {
      // Check localStorage for existing ALT
      const storedALT = typeof window !== 'undefined' 
        ? localStorage.getItem(`stakepoint_alt_${publicKey.toString().slice(0, 8)}`) 
        : null;
      
      if (storedALT) {
        const altPubkey = new PublicKey(storedALT);
        const altAccount = await connection.getAddressLookupTable(altPubkey);
        
        if (altAccount.value && altAccount.value.state.addresses.length > 0) {
          console.log("✅ Using existing ALT:", altPubkey.toString());
          return altPubkey;
        }
      }
      
      return null; // Will create on first batch operation
    } catch (e) {
      console.warn("ALT lookup failed:", e);
      return null;
    }
  };

  /**
   * Create Address Lookup Table with common addresses
   */
  const createALT = async (feeCollector: PublicKey): Promise<PublicKey | null> => {
    if (!publicKey || !sendTransaction) return null;
    
    try {
      const { AddressLookupTableProgram } = await import("@solana/web3.js");
      
      const slot = await connection.getSlot();
      
      const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: publicKey,
        payer: publicKey,
        recentSlot: slot - 1,
      });
      
      // Common addresses
      const [platformConfigPDA] = getPDAs.platformConfig();
      const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
      const ASSOCIATED_TOKEN = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
      const SYSTEM = new PublicKey("11111111111111111111111111111111");
      
      const addresses = [
        platformConfigPDA,
        feeCollector,
        TOKEN_PROGRAM,
        TOKEN_2022,
        ASSOCIATED_TOKEN,
        SYSTEM,
        publicKey, // User's wallet
      ];
      
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: publicKey,
        authority: publicKey,
        lookupTable: lookupTableAddress,
        addresses: addresses,
      });
      
      const { blockhash } = await connection.getLatestBlockhash();
      
      const message = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [createIx, extendIx],
      }).compileToV0Message();
      
      const tx = new VersionedTransaction(message);
      
      const signature = await sendTransaction(tx, connection, { skipPreflight: false });
      console.log("✅ ALT created:", lookupTableAddress.toString());
      
      await pollForConfirmation(connection, signature);
      
      // Store for future use
      if (typeof window !== 'undefined') {
        localStorage.setItem(`stakepoint_alt_${publicKey.toString().slice(0, 8)}`, lookupTableAddress.toString());
      }
      
      // Wait for ALT to become active
      await new Promise(r => setTimeout(r, 2000));
      
      return lookupTableAddress;
    } catch (e) {
      console.error("ALT creation failed:", e);
      return null;
    }
  };

  /**
   * Extend ALT with pool-specific addresses
   */
  const extendALT = async (
    altAddress: PublicKey,
    newAddresses: PublicKey[]
  ): Promise<boolean> => {
    if (!publicKey || !sendTransaction || newAddresses.length === 0) return false;
    
    try {
      const { AddressLookupTableProgram } = await import("@solana/web3.js");
      
      // Filter duplicates
      const altAccount = await connection.getAddressLookupTable(altAddress);
      if (!altAccount.value) return false;
      
      const existing = new Set(altAccount.value.state.addresses.map(a => a.toString()));
      const toAdd = newAddresses.filter(a => !existing.has(a.toString()));
      
      if (toAdd.length === 0) return true;
      
      // ALT can only add 30 addresses at a time
      const chunks = [];
      for (let i = 0; i < toAdd.length; i += 30) {
        chunks.push(toAdd.slice(i, i + 30));
      }
      
      for (const chunk of chunks) {
        const extendIx = AddressLookupTableProgram.extendLookupTable({
          payer: publicKey,
          authority: publicKey,
          lookupTable: altAddress,
          addresses: chunk,
        });
        
        const { blockhash } = await connection.getLatestBlockhash();
        
        const message = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [extendIx],
        }).compileToV0Message();
        
        const tx = new VersionedTransaction(message);
        const sig = await sendTransaction(tx, connection);
        await pollForConfirmation(connection, sig);
      }
      
      // Wait for extension to activate
      await new Promise(r => setTimeout(r, 1500));
      
      console.log(`✅ Extended ALT with ${toAdd.length} addresses`);
      return true;
    } catch (e) {
      console.error("ALT extension failed:", e);
      return false;
    }
  };

  /**
   * Build a claim instruction without sending (for batching)
   */
  const buildClaimInstruction = async (tokenMint: string, poolId: number = 0, engine: string = 'legacy') => {
    if (!wallet || !publicKey) return null;

    try {
      const program = getProgram(wallet, connection);
      const tokenMintPubkey = new PublicKey(tokenMint);
      const isV2 = engine === 'current';

      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!mintInfo) return null;
      
      const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
      const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022) ? TOKEN_2022 : SPL_TOKEN;

      const platformConfig = await getPlatformConfig(program);
      if (!platformConfig) return null;
      const feeCollector = platformConfig.feeCollector;

      const [platformConfigPDA] = getPDAs.platformConfig();
      const [projectPDA] = isV2 ? getPDAs.project1(tokenMintPubkey, poolId) : getPDAs.project(tokenMintPubkey, poolId);
      const [rewardVaultPDA] = isV2 ? getPDAs.rewardVault1(tokenMintPubkey, poolId) : getPDAs.rewardVault(tokenMintPubkey, poolId);
      const [userStakePDA] = isV2 ? getPDAs.userStake1(projectPDA, publicKey) : getPDAs.userStake(projectPDA, publicKey);
      const [stakingVaultPDA] = isV2 ? getPDAs.stakingVault1(tokenMintPubkey, poolId) : getPDAs.stakingVault(tokenMintPubkey, poolId);

      const userStake = isV2
        ? await program.account.stake1.fetch(userStakePDA, "confirmed")
        : await program.account.stake.fetch(userStakePDA, "confirmed");
      const withdrawalWallet = userStake.withdrawalWallet || publicKey;

      const NATIVE_SOL = "So11111111111111111111111111111111111111112";
      const isNativeSOL = tokenMint === NATIVE_SOL;

      let withdrawalTokenAccount = isNativeSOL 
        ? withdrawalWallet 
        : await getAssociatedTokenAddress(tokenMintPubkey, withdrawalWallet, false, tokenProgramId);

      const project: any = isV2
        ? await program.account.project1.fetch(projectPDA, "confirmed")
        : await program.account.project.fetch(projectPDA, "confirmed");

      // V2 dual staking: claim reward token, not staking token
      let claimMintPubkey = tokenMintPubkey;
      let claimTokenProgramId = tokenProgramId;
      if (isV2 && project.rewardTokenMint) {
        claimMintPubkey = project.rewardTokenMint;
        const rewardMintInfo = await connection.getAccountInfo(claimMintPubkey);
        if (rewardMintInfo) {
          claimTokenProgramId = rewardMintInfo.owner.equals(TOKEN_2022) ? TOKEN_2022 : SPL_TOKEN;
        }
        withdrawalTokenAccount = await getAssociatedTokenAddress(claimMintPubkey, withdrawalWallet, false, claimTokenProgramId);
      }

      const accounts: any = {
        platform: platformConfigPDA,
        project: projectPDA,
        stake: userStakePDA,
        rewardVault: rewardVaultPDA,
        userTokenAccount: withdrawalTokenAccount,
        feeCollector: feeCollector,
        reflectionVault: project.reflectionVault || stakingVaultPDA,
        tokenMintAccount: claimMintPubkey,
        user: publicKey,
        tokenProgram: isV2 ? claimTokenProgramId : tokenProgramId,
        rewardTokenProgram: isV2 ? claimTokenProgramId : undefined,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      };

      const remainingAccounts: any[] = [];
      if (project.referrer && !project.referrer.equals(PublicKey.default)) {
        remainingAccounts.push({ pubkey: project.referrer, isWritable: true, isSigner: false });
      }

      const instruction = isV2
        ? await program.methods.claim1(tokenMintPubkey, new BN(poolId)).accountsPartial(accounts).remainingAccounts(remainingAccounts).instruction()
        : await program.methods.claim(tokenMintPubkey, new BN(poolId)).accountsPartial(accounts).remainingAccounts(remainingAccounts).instruction();

      return {
        instruction,
        addresses: [
          tokenMintPubkey,
          claimMintPubkey,
          projectPDA,
          rewardVaultPDA,
          userStakePDA,
          stakingVaultPDA,
          withdrawalTokenAccount,
          project.reflectionVault || stakingVaultPDA,
        ].filter(Boolean)
      };
    } catch (error) {
      console.error(`Error building claim instruction for ${tokenMint}:`, error);
      return null;
    }
  };

  /**
   * Build a stake instruction without sending (for batching)
   */
  const buildStakeInstruction = async (tokenMint: string, amount: number, poolId: number = 0, engine: string = 'legacy') => {
    if (!wallet || !publicKey) return null;

    try {
      const program = getProgram(wallet, connection);
      const tokenMintPubkey = new PublicKey(tokenMint);
      const isV2 = engine === 'current';

      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!mintInfo) return null;
      
      const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
      const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022) ? TOKEN_2022 : SPL_TOKEN;

      const platformConfig = await getPlatformConfig(program);
      if (!platformConfig) return null;
      const feeCollector = platformConfig.feeCollector;

      const [platformConfigPDA] = getPDAs.platformConfig();
      const [projectPDA] = isV2 ? getPDAs.project1(tokenMintPubkey, poolId) : getPDAs.project(tokenMintPubkey, poolId);
      const [stakingVaultPDA] = isV2 ? getPDAs.stakingVault1(tokenMintPubkey, poolId) : getPDAs.stakingVault(tokenMintPubkey, poolId);
      const [userStakePDA] = isV2 ? getPDAs.userStake1(projectPDA, publicKey) : getPDAs.userStake(projectPDA, publicKey);

      const NATIVE_SOL = "So11111111111111111111111111111111111111112";
      const isNativeSOL = tokenMint === NATIVE_SOL;

      const userTokenAccount = isNativeSOL 
        ? publicKey 
        : await getAssociatedTokenAddress(tokenMintPubkey, publicKey, false, tokenProgramId);
      
      const feeCollectorTokenAccount = isNativeSOL 
        ? feeCollector 
        : await getAssociatedTokenAddress(tokenMintPubkey, feeCollector, false, tokenProgramId);

      const project = isV2
        ? await program.account.project1.fetch(projectPDA, "confirmed")
        : await program.account.project.fetch(projectPDA, "confirmed");

      const accounts: any = {
        platform: platformConfigPDA,
        project: projectPDA,
        stake: userStakePDA,
        stakingVault: stakingVaultPDA,
        userTokenAccount,
        feeCollectorTokenAccount,
        feeCollector,
        reflectionVault: (project.reflectionVault && project.reflectionVault.toString() !== projectPDA.toString()) 
          ? project.reflectionVault : null,
        tokenMintAccount: tokenMintPubkey,
        user: publicKey,
        tokenProgram: tokenProgramId,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      };

      const remainingAccounts: any[] = [];
      if (project.referrer && !project.referrer.equals(PublicKey.default)) {
        remainingAccounts.push({ pubkey: project.referrer, isWritable: true, isSigner: false });
      }

      const instruction = isV2
        ? await program.methods.deposit1(tokenMintPubkey, new BN(poolId), new BN(amount)).accountsPartial(accounts).remainingAccounts(remainingAccounts).instruction()
        : await program.methods.deposit(tokenMintPubkey, new BN(poolId), new BN(amount)).accountsPartial(accounts).remainingAccounts(remainingAccounts).instruction();

      return {
        instruction,
        addresses: [
          tokenMintPubkey,
          projectPDA,
          stakingVaultPDA,
          userStakePDA,
          userTokenAccount,
          feeCollectorTokenAccount,
          project.reflectionVault,
        ].filter(Boolean)
      };
    } catch (error) {
      console.error(`Error building stake instruction for ${tokenMint}:`, error);
      return null;
    }
  };

  /**
   * Batch claim reflections across multiple locks/pools in fewer transactions.
   * Each lock is an independent project PDA, so we build one claim_reflections
   * instruction per lock and pack several into a single transaction.
   */
  const batchClaimReflections = async (
    locks: { tokenMint: string; poolId: number; symbol: string }[],
    onProgress?: (batchIndex: number, totalBatches: number, status: 'building' | 'signing' | 'confirming' | 'done', txSignature?: string) => void
  ) => {
    if (!wallet || !publicKey || !sendTransaction) {
      throw new Error("Wallet not connected");
    }
 
    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.02 * 1_000_000_000) {
      throw new Error(`Insufficient SOL for transaction fees. You have ${(solBalance / 1_000_000_000).toFixed(4)} SOL but need at least 0.02 SOL.`);
    }
 
    const program = getProgram(wallet, connection);
 
    const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const TOKEN_CLASSIC = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const NATIVE_SOL = "So11111111111111111111111111111111111111112";
 
    // Reflection claims touch more accounts than reward claims, so pack fewer
    const MAX_CLAIMS_PER_TX = 3;
 
    const results: { success: boolean; txSignature?: string; locksInBatch: string[]; error?: string }[] = [];
 
    // ── Build every instruction up front so a bad lock fails early ──
    type BuiltClaim = {
      symbol: string;
      claimIx: any;
      ataIx: any | null;
    };
 
    const built: BuiltClaim[] = [];
 
    for (const lock of locks) {
      try {
        const tokenMintPubkey = new PublicKey(lock.tokenMint);
 
        const [projectPDA] = getPDAs.project(tokenMintPubkey, lock.poolId);
        const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);
 
        const project = await program.account.project.fetch(projectPDA, "confirmed");
        if (!project.reflectionVault || !project.reflectionToken) {
          console.warn(`⏭️ Skipping ${lock.symbol}: reflections not enabled`);
          continue;
        }
 
        const reflectionTokenMint = project.reflectionToken as PublicKey;
        const isNativeSOL = reflectionTokenMint.toString() === NATIVE_SOL;
 
        const reflectionMintInfo = await connection.getAccountInfo(reflectionTokenMint);
        if (!reflectionMintInfo) {
          console.warn(`⏭️ Skipping ${lock.symbol}: reflection mint not found`);
          continue;
        }
        const reflectionTokenProgramId = reflectionMintInfo.owner.equals(TOKEN_2022)
          ? TOKEN_2022
          : TOKEN_CLASSIC;
 
        const userStake = await program.account.stake.fetch(userStakePDA, "confirmed");
        const withdrawalWallet = (userStake.withdrawalWallet as PublicKey) || publicKey;
 
        let userReflectionAccount: PublicKey;
        let ataIx: any = null;
 
        if (isNativeSOL) {
          userReflectionAccount = withdrawalWallet;
        } else {
          userReflectionAccount = await getAssociatedTokenAddress(
            reflectionTokenMint,
            withdrawalWallet,
            false,
            reflectionTokenProgramId
          );
 
          const accountInfo = await connection.getAccountInfo(userReflectionAccount);
          if (!accountInfo) {
            ataIx = createAssociatedTokenAccountInstruction(
              publicKey,
              userReflectionAccount,
              withdrawalWallet,
              reflectionTokenMint,
              reflectionTokenProgramId,
              ASSOCIATED_TOKEN_PROGRAM_ID
            );
          }
        }
 
        const actualReflectionVault = isNativeSOL
          ? projectPDA
          : (project.reflectionVault as PublicKey);

        // The program claims stake.reflections_pending, so skip any lock where
        // this staker has nothing accrued. Otherwise the whole batch is
        // rejected with NoReflectionsToClaim.
        const pending = Number((userStake as any).reflectionsPending ?? 0);
        if (!pending || pending <= 0) {
          console.warn(`⏭️ Skipping ${lock.symbol}: no reflections pending`);
          continue;
        }
 
        const claimIx = await program.methods
          .claimReflections(tokenMintPubkey, new BN(lock.poolId))
          .accountsPartial({
            project: projectPDA,
            stake: userStakePDA,
            reflectionVault: actualReflectionVault,
            userReflectionAccount: userReflectionAccount,
            reflectionTokenMint: reflectionTokenMint,
            user: publicKey,
            tokenProgram: reflectionTokenProgramId,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
 
        built.push({ symbol: lock.symbol, claimIx, ataIx });
      } catch (err: any) {
        console.error(`❌ Could not build claim for ${lock.symbol}:`, err);
      }
    }
 
    if (built.length === 0) {
      throw new Error("No claimable reflections found across your locks.");
    }
 
    const totalBatches = Math.ceil(built.length / MAX_CLAIMS_PER_TX);
 
    // ── Send each batch ──
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const start = batchIdx * MAX_CLAIMS_PER_TX;
      const batch = built.slice(start, start + MAX_CLAIMS_PER_TX);
      const symbols = batch.map(b => b.symbol);
 
      try {
        onProgress?.(batchIdx, totalBatches, 'building');
 
        const transaction = new Transaction();
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 * batch.length }));
        transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
 
        for (const b of batch) {
          if (b.ataIx) transaction.add(b.ataIx);
          transaction.add(b.claimIx);
        }
 
        transaction.feePayer = publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
 
        const simulation = await connection.simulateTransaction(transaction);
        if (simulation.value.err) {
          console.error("❌ Batch simulation failed:", simulation.value.err, simulation.value.logs);
          throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
        }
 
        onProgress?.(batchIdx, totalBatches, 'signing');
        const signature = await sendTransaction(transaction, connection);
 
        onProgress?.(batchIdx, totalBatches, 'confirming', signature);
        await pollForConfirmation(connection, signature);
 
        onProgress?.(batchIdx, totalBatches, 'done', signature);
        results.push({ success: true, txSignature: signature, locksInBatch: symbols });
 
        if (batchIdx < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err: any) {
        console.error(`❌ Reflection batch ${batchIdx + 1} failed:`, err);
        results.push({
          success: false,
          locksInBatch: symbols,
          error: err.message?.slice(0, 120) || "Batch failed",
        });
      }
    }
 
    return results;
  };

  /**
   * Batch claim rewards using Address Lookup Table for smaller transactions
   */
  const batchClaimRewards = async (
    pools: { tokenMint: string; poolId: number; symbol: string; engine?: string }[],
    onProgress?: (batchIndex: number, totalBatches: number, status: 'building' | 'signing' | 'confirming' | 'done', txSignature?: string) => void
  ) => {
    if (!wallet || !publicKey || !sendTransaction) {
      throw new Error("Wallet not connected");
    }

    const program = getProgram(wallet, connection);
    const platformConfig = await getPlatformConfig(program);
    if (!platformConfig) throw new Error("Platform not initialized");

    // With ALT, we can fit more instructions per transaction
    const MAX_PER_TX_WITH_ALT = 6;
    const MAX_PER_TX_WITHOUT_ALT = 4;
    
    const results: { success: boolean; txSignature?: string; poolsInBatch: string[]; error?: string }[] = [];

    // Try to get/create ALT
    let altAddress = await getOrCreateALT();
    let altAccount: AddressLookupTableAccount | null = null;
    
    if (!altAddress) {
      // Create ALT on first use
      console.log("📦 Creating Address Lookup Table...");
      onProgress?.(0, 1, 'building');
      altAddress = await createALT(platformConfig.feeCollector);
    }

    if (altAddress) {
      // Collect all addresses for ALT
      const allAddresses: PublicKey[] = [];
      
      for (const pool of pools) {
        const result = await buildClaimInstruction(pool.tokenMint, pool.poolId, pool.engine || 'legacy');
        if (result?.addresses) {
          allAddresses.push(...result.addresses);
        }
      }
      
      // Extend ALT with pool addresses
      await extendALT(altAddress, allAddresses);
      
      // Fetch updated ALT
      const altResult = await connection.getAddressLookupTable(altAddress);
      altAccount = altResult.value;
    }

    const maxPerTx = altAccount ? MAX_PER_TX_WITH_ALT : MAX_PER_TX_WITHOUT_ALT;
    
    // Split into batches
    const batches: typeof pools[] = [];
    for (let i = 0; i < pools.length; i += maxPerTx) {
      batches.push(pools.slice(i, i + maxPerTx));
    }

    console.log(`🔄 Batching ${pools.length} claims into ${batches.length} transaction(s) ${altAccount ? '(with ALT)' : '(no ALT)'}`);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const symbols = batch.map(p => p.symbol);
      
      onProgress?.(batchIdx, batches.length, 'building');
      
      try {
        const instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ];

        for (const pool of batch) {
          const result = await buildClaimInstruction(pool.tokenMint, pool.poolId, pool.engine || 'legacy');
          if (result?.instruction) {
            instructions.push(result.instruction);
          }
        }

        if (instructions.length <= 2) {
          results.push({ success: false, poolsInBatch: symbols, error: "No valid instructions" });
          continue;
        }

        const { blockhash } = await connection.getLatestBlockhash();
        
        let tx: VersionedTransaction | Transaction;
        
        if (altAccount) {
          // Use versioned transaction with ALT
          const message = new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: blockhash,
            instructions: instructions,
          }).compileToV0Message([altAccount]);
          
          tx = new VersionedTransaction(message);
          console.log(`📦 Batch ${batchIdx + 1}: Using ALT (versioned tx)`);
        } else {
          // Fallback to legacy transaction
          tx = new Transaction();
          tx.recentBlockhash = blockhash;
          tx.feePayer = publicKey;
          instructions.forEach(ix => (tx as Transaction).add(ix));
          console.log(`📦 Batch ${batchIdx + 1}: Legacy tx (no ALT)`);
        }

        onProgress?.(batchIdx, batches.length, 'signing');
        
        const txSig = await sendTransaction(tx, connection, { skipPreflight: false });
        console.log(`✅ Batch ${batchIdx + 1} signature:`, txSig);
        
        onProgress?.(batchIdx, batches.length, 'confirming', txSig);
        await pollForConfirmation(connection, txSig);
        
        onProgress?.(batchIdx, batches.length, 'done', txSig);
        results.push({ success: true, txSignature: txSig, poolsInBatch: symbols });
        
        if (batchIdx < batches.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (error: any) {
        console.error(`❌ Batch ${batchIdx + 1} error:`, error);
        results.push({ success: false, poolsInBatch: symbols, error: error.message?.slice(0, 100) });
      }
    }

    return results;
  };

  /**
   * Batch compound (claim + stake) using Address Lookup Table
   */
  const batchCompound = async (
    pools: { tokenMint: string; poolId: number; symbol: string; rewardAmount: number; decimals: number; engine?: string }[],
    onProgress?: (batchIndex: number, totalBatches: number, status: 'building' | 'signing' | 'confirming' | 'done', txSignature?: string) => void
  ) => {
    if (!wallet || !publicKey || !sendTransaction) {
      throw new Error("Wallet not connected");
    }

    const program = getProgram(wallet, connection);
    const platformConfig = await getPlatformConfig(program);
    if (!platformConfig) throw new Error("Platform not initialized");

    // With ALT, we can fit more compound operations per transaction
    const MAX_PER_TX_WITH_ALT = 4; // 8 instructions (2 per pool)
    const MAX_PER_TX_WITHOUT_ALT = 2; // 4 instructions (2 per pool)
    
    const results: { success: boolean; txSignature?: string; poolsInBatch: string[]; error?: string }[] = [];

    // Try to get/create ALT
    let altAddress = await getOrCreateALT();
    let altAccount: AddressLookupTableAccount | null = null;
    
    if (!altAddress) {
      console.log("📦 Creating Address Lookup Table...");
      onProgress?.(0, 1, 'building');
      altAddress = await createALT(platformConfig.feeCollector);
    }

    if (altAddress) {
      // Collect all addresses for ALT
      const allAddresses: PublicKey[] = [];
      
      for (const pool of pools) {
        const claimResult = await buildClaimInstruction(pool.tokenMint, pool.poolId, pool.engine || 'legacy');
        if (claimResult?.addresses) {
          allAddresses.push(...claimResult.addresses);
        }
        
        const rewardsInUnits = Math.floor(pool.rewardAmount * Math.pow(10, pool.decimals));
        if (rewardsInUnits > 0) {
          const stakeResult = await buildStakeInstruction(pool.tokenMint, rewardsInUnits, pool.poolId, pool.engine || 'legacy');
          if (stakeResult?.addresses) {
            allAddresses.push(...stakeResult.addresses);
          }
        }
      }
      
      // Extend ALT with pool addresses
      await extendALT(altAddress, allAddresses);
      
      // Fetch updated ALT
      const altResult = await connection.getAddressLookupTable(altAddress);
      altAccount = altResult.value;
    }

    const maxPerTx = altAccount ? MAX_PER_TX_WITH_ALT : MAX_PER_TX_WITHOUT_ALT;
    
    const batches: typeof pools[] = [];
    for (let i = 0; i < pools.length; i += maxPerTx) {
      batches.push(pools.slice(i, i + maxPerTx));
    }

    console.log(`🔄 Batching ${pools.length} compounds into ${batches.length} transaction(s) ${altAccount ? '(with ALT)' : '(no ALT)'}`);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const symbols = batch.map(p => p.symbol);
      
      onProgress?.(batchIdx, batches.length, 'building');
      
      try {
        const instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 800000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        ];

        for (const pool of batch) {
          // Add claim
          const claimResult = await buildClaimInstruction(pool.tokenMint, pool.poolId, pool.engine || 'legacy');
          if (claimResult?.instruction) {
            instructions.push(claimResult.instruction);
          }
          
          // Add stake
          const rewardsInUnits = Math.floor(pool.rewardAmount * Math.pow(10, pool.decimals));
          if (rewardsInUnits > 0) {
            const stakeResult = await buildStakeInstruction(pool.tokenMint, rewardsInUnits, pool.poolId, pool.engine || 'legacy');
            if (stakeResult?.instruction) {
              instructions.push(stakeResult.instruction);
            }
          }
        }

        if (instructions.length <= 2) {
          results.push({ success: false, poolsInBatch: symbols, error: "No valid instructions" });
          continue;
        }

        const { blockhash } = await connection.getLatestBlockhash();
        
        let tx: VersionedTransaction | Transaction;
        
        if (altAccount) {
          const message = new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: blockhash,
            instructions: instructions,
          }).compileToV0Message([altAccount]);
          
          tx = new VersionedTransaction(message);
          console.log(`📦 Batch ${batchIdx + 1}: Using ALT (versioned tx) - ${instructions.length - 2} instructions`);
        } else {
          tx = new Transaction();
          tx.recentBlockhash = blockhash;
          tx.feePayer = publicKey;
          instructions.forEach(ix => (tx as Transaction).add(ix));
          console.log(`📦 Batch ${batchIdx + 1}: Legacy tx - ${instructions.length - 2} instructions`);
        }

        onProgress?.(batchIdx, batches.length, 'signing');
        
        const txSig = await sendTransaction(tx, connection, { skipPreflight: false });
        console.log(`✅ Batch ${batchIdx + 1} signature:`, txSig);
        
        onProgress?.(batchIdx, batches.length, 'confirming', txSig);
        await pollForConfirmation(connection, txSig);
        
        onProgress?.(batchIdx, batches.length, 'done', txSig);
        results.push({ success: true, txSignature: txSig, poolsInBatch: symbols });
        
        if (batchIdx < batches.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (error: any) {
        console.error(`❌ Batch ${batchIdx + 1} error:`, error);
        results.push({ success: false, poolsInBatch: symbols, error: error.message?.slice(0, 100) });
      }
    }

    return results;
  };

  // ============================================
  // END OF BATCH FUNCTIONS WITH ALT
  // ============================================

  return {
    // Core Functions
    stake,
    unstake,
    claimRewards,
    claimReflections,
    refreshReflections,

    // Batch Functions
    batchClaimRewards,
    batchClaimReflections,
    claimExtraReward,
    extendLock,
    batchCompound,
    
    // Query Functions
    getUserStake,
    getProjectInfo,
    calculateRewards,
    calculateDynamicAPR,
    getPoolRate,
    
    // Status
    waitForConfirmation,
    connected: !!wallet && !!publicKey,
  };
}
