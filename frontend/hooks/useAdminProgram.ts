import { confirmTransactionPolling } from "@/lib/confirmTransaction";
import * as anchor from "@coral-xyz/anchor";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram, getPDAs, PROGRAM_ID } from "@/lib/anchor-program";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync 
} from "@solana/spl-token";

/**
 * Hook for admin functions - Version 4.3 (FIXED: poolId bug on line 240)
 */
export function useAdminProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { publicKey, sendTransaction: walletSendTransaction, signTransaction: walletSignTransaction } = useWallet();

  /**
   * Helper: Get fresh blockhash for transaction
   */
  const getFreshBlockhash = async () => {
    return await connection.getLatestBlockhash('finalized');
  };

 /**
 * Helper: Send transaction with fresh blockhash using wallet adapter
 */
const sendTransactionWithFreshBlockhash = async (
  program: any,
  method: any
) => {
  if (!wallet || !publicKey || !walletSignTransaction) {
    throw new Error("Wallet not properly connected");
  }

  const instruction = await method.instruction();
  const transaction = new anchor.web3.Transaction();
  
  // ✅ Add compute budget to prevent warnings
  const { ComputeBudgetProgram } = await import("@solana/web3.js");
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
  );
  
  transaction.add(instruction);
  
  // ✅ Set blockhash and feePayer (prevents Phantom warnings)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = publicKey;

  // Sign with wallet, then send raw through our connection (avoids adapter simulation/websocket)
  const signed = await walletSignTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  await confirmTransactionPolling(connection, signature);

  return signature;
};

  /**
   * Helper: Get associated token address
   */
  const getTokenAccount = async (mint: PublicKey, owner: PublicKey) => {
    return await getAssociatedTokenAddress(mint, owner);
  };

  /**
   * NEW: Get comprehensive vault information for admin panel display
   * Returns addresses and balances for staking, reward, and reflection vaults
   */
  const getVaultInfo = async (tokenMint: string, poolId: number = 0, engine: string = 'legacy') => {
    if (!wallet) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    // Derive PDAs based on engine
    const isV2 = engine === 'current';
    const [projectPDA] = isV2 ? getPDAs.project1(tokenMintPubkey, poolId) : getPDAs.project(tokenMintPubkey, poolId);
    const [stakingVaultPDA] = isV2 ? getPDAs.stakingVault1(tokenMintPubkey, poolId) : getPDAs.stakingVault(tokenMintPubkey, poolId);
    const [rewardVaultPDA] = isV2 ? getPDAs.rewardVault1(tokenMintPubkey, poolId) : getPDAs.rewardVault(tokenMintPubkey, poolId);

    // Get project data
    const projectData = isV2 ? await program.account.project1.fetch(projectPDA) : await program.account.project.fetch(projectPDA);

    // Fetch staking vault balance
    let stakingBalance = 0;
    let stakingExists = false;
    let stakingDecimals = 9;
    try {
      const balance = await connection.getTokenAccountBalance(stakingVaultPDA);
      stakingBalance = balance.value.uiAmount ?? (Number(balance.value.amount) / Math.pow(10, balance.value.decimals));
      stakingDecimals = balance.value.decimals;
      stakingExists = true;
    } catch (e) {
      console.log("Staking vault not initialized");
    }

    // Fetch reward vault balance
    let rewardBalance = 0;
    let rewardExists = false;
    let rewardDecimals = 9;
    try {
      const balance = await connection.getTokenAccountBalance(rewardVaultPDA);
      rewardBalance = balance.value.uiAmount ?? (Number(balance.value.amount) / Math.pow(10, balance.value.decimals));
      rewardDecimals = balance.value.decimals;
      rewardExists = true;
    } catch (e) {
      console.log("Reward vault not initialized");
    }

    // ✅ FETCH REFLECTION VAULT - CALCULATE ADDRESS, DON'T READ FROM PROJECT
    let reflectionInfo = null;
    if (projectData.reflectionToken) {
      const reflectionTokenMint = projectData.reflectionToken as PublicKey;

    // ✅ Check if Native SOL
    const NATIVE_SOL = "So11111111111111111111111111111111111111112";
    const reflectionMintStr = reflectionTokenMint.toString();

    console.log("🔍 [REFLECTION TYPE CHECK]");
    console.log("   Mint from blockchain:", reflectionMintStr);
    console.log("   Native SOL constant:", NATIVE_SOL);
    console.log("   Are they equal?", reflectionMintStr === NATIVE_SOL);

    const isNativeSOL = reflectionMintStr === NATIVE_SOL;
      
      let reflectionBalance = 0;
      let reflectionExists = false;
      let reflectionDecimals = 9;
      let reflectionSymbol = null;
      let reflectionTokenAccount: PublicKey;

      if (isNativeSOL) {
        // ✅ NATIVE SOL = Project PDA lamports
        reflectionTokenAccount = projectPDA;
        
        try {
          const accountInfo = await connection.getAccountInfo(projectPDA);
          if (accountInfo) {
            // Get rent-exempt minimum
            const rent = await connection.getMinimumBalanceForRentExemption(accountInfo.data.length);
            const buffer = 3_000_000; // 0.003 SOL buffer
            const distributableLamports = accountInfo.lamports - rent - buffer;
            
            reflectionBalance = Math.max(0, distributableLamports) / 1_000_000_000;
            reflectionExists = true;
            reflectionSymbol = 'SOL';
            reflectionDecimals = 9;
            
            console.log('✅ Native SOL reflections - Project PDA lamports:', {
              total: accountInfo.lamports,
              rent,
              buffer,
              distributable: distributableLamports,
            });
          }
        } catch (e) {
          console.log("Native SOL reflection vault check failed:", e);
        }
      } else {
        // ✅ SPL/Token-2022 = Project PDA's standard ATA
        // Detect token program
        const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
        const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        
        const mintInfo = await connection.getAccountInfo(reflectionTokenMint);
        const tokenProgramId = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) 
          ? TOKEN_2022_PROGRAM_ID 
          : SPL_TOKEN_PROGRAM_ID;
        
        // Calculate standard ATA owned by Project PDA
        reflectionTokenAccount = getAssociatedTokenAddressSync(
          reflectionTokenMint,
          projectPDA,  // ✅ Owned by Project PDA!
          true,        // allowOwnerOffCurve
          tokenProgramId
        );
        
        try {
          const balance = await connection.getTokenAccountBalance(reflectionTokenAccount);
          reflectionBalance = balance.value.uiAmount ?? (Number(balance.value.amount) / Math.pow(10, balance.value.decimals));
          reflectionDecimals = balance.value.decimals;
          reflectionExists = true;

          // Try to get token symbol from metadata
          try {
            const metadataPDA = PublicKey.findProgramAddressSync(
              [
                Buffer.from('metadata'),
                new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
                reflectionTokenMint.toBuffer(),
              ],
              new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
            )[0];

            const metadataAccount = await connection.getAccountInfo(metadataPDA);
            if (metadataAccount) {
              const data = metadataAccount.data;
              let nameLength = data[65];
              let symbolStart = 65 + 4 + nameLength;
              let symbolLength = data[symbolStart];
              let symbolBytes = data.slice(symbolStart + 4, symbolStart + 4 + symbolLength);
              reflectionSymbol = new TextDecoder().decode(symbolBytes).replace(/\0/g, '').trim();
            }
          } catch (metaErr) {
            console.log('Could not fetch reflection token metadata:', metaErr);
          }
        } catch (e) {
          console.log("SPL reflection vault not initialized");
        }
        
        console.log('✅ SPL reflection vault calculated:', {
          address: reflectionTokenAccount.toString(),
          mint: reflectionTokenMint.toString(),
          owner: 'Project PDA',
          balance: reflectionBalance,
        });
      }

      reflectionInfo = {
        tokenMint: reflectionTokenMint.toString(),
        tokenAccount: reflectionTokenAccount.toString(),
        balance: reflectionBalance,
        decimals: reflectionDecimals,
        symbol: reflectionSymbol || (isNativeSOL ? 'SOL' : null),
        exists: reflectionExists,
      };
    }

    return {
      stakingVault: {
        address: stakingVaultPDA.toString(),
        balance: stakingBalance,
        decimals: stakingDecimals,
        exists: stakingExists,
      },
      rewardVault: {
        address: rewardVaultPDA.toString(),
        balance: rewardBalance,
        decimals: rewardDecimals,
        exists: rewardExists,
      },
      reflectionVault: reflectionInfo || {
        tokenMint: null,
        tokenAccount: "Not Configured",
        balance: 0,
        decimals: 9,
        symbol: null,
        exists: false,
      },
      projectData,
    };
  };

  /**
   * ONE-TIME: Initialize the platform (call once after deployment)
   */
  const initializePlatform = async (params: {
    tokenFeeBps: number;
    solFee: number;
    feeCollector: string;
  }) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();
    const feeCollectorPubkey = new PublicKey(params.feeCollector);

    const method = program.methods
      .initialize(
        new BN(params.tokenFeeBps),
        new BN(params.solFee)
      )
      .accounts({
        platform: platformPDA,
        feeCollector: feeCollectorPubkey,
        admin: publicKey,
        systemProgram: SystemProgram.programId,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  // Admin: migrate a legacy stake to a new wallet
  const adminMigrateStake = async (
    tokenMint: string,
    poolId: number,
    oldUser: string,
    newUser: string
  ) => {
    if (!wallet || !publicKey) throw new Error("Wallet not connected");
    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();
    const tokenMintPubkey = new PublicKey(tokenMint);
    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const oldUserPk = new PublicKey(oldUser);
    const newUserPk = new PublicKey(newUser);

    const [oldStakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), projectPDA.toBuffer(), oldUserPk.toBuffer()],
      PROGRAM_ID
    );
    const [newStakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), projectPDA.toBuffer(), newUserPk.toBuffer()],
      PROGRAM_ID
    );
    const [platformForFee] = getPDAs.platformConfig();
    const platformAcct: any = await program.account.platform.fetch(platformForFee);
    const feeCollector = new PublicKey((platformAcct.fee_collector ?? platformAcct.feeCollector).toString());

    const method = (program.methods as any)
      .adminMigrateStake(tokenMintPubkey, new BN(poolId), oldUserPk)
      .accountsPartial({
        platform: platformPDA,
        project: projectPDA,
        oldStake: oldStakePDA,
        newStake: newStakePDA,
        newUser: newUserPk,
        feeCollector: feeCollector,
        admin: publicKey,
        systemProgram: SystemProgram.programId,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  // Admin: migrate a current-engine stake to a new wallet
  const adminMigrateStake1 = async (
    tokenMint: string,
    poolId: number,
    oldUser: string,
    newUser: string
  ) => {
    if (!wallet || !publicKey) throw new Error("Wallet not connected");
    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();
    const tokenMintPubkey = new PublicKey(tokenMint);
    const [projectPDA] = getPDAs.project1(tokenMintPubkey, poolId);
    const oldUserPk = new PublicKey(oldUser);
    const newUserPk = new PublicKey(newUser);

    const [oldStakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake1"), projectPDA.toBuffer(), oldUserPk.toBuffer()],
      PROGRAM_ID
    );
    const [newStakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake1"), projectPDA.toBuffer(), newUserPk.toBuffer()],
      PROGRAM_ID
    );
    const platformAcct: any = await program.account.platform.fetch(platformPDA);
    const feeCollector = new PublicKey((platformAcct.fee_collector ?? platformAcct.feeCollector).toString());

    const method = (program.methods as any)
      .adminMigrateStake1(tokenMintPubkey, new BN(poolId), oldUserPk)
      .accountsPartial({
        platform: platformPDA,
        project: projectPDA,
        oldStake: oldStakePDA,
        newStake: newStakePDA,
        newUser: newUserPk,
        feeCollector: feeCollector,
        admin: publicKey,
        systemProgram: SystemProgram.programId,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * STEP 1: Create a new project
   */
  const createProject = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
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

    console.log(`✅ Token program detected: ${tokenProgramId.toString()}`);
    
    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const [stakingVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, poolId);

    const [rewardVaultPDA] = getPDAs.rewardVault(tokenMintPubkey, poolId);

    const method = program.methods
      .createProject(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        stakingVault: stakingVaultPDA,
        rewardVault: rewardVaultPDA,
        tokenMint: tokenMintPubkey,
        admin: publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: tokenProgramId,  // ✅ Pass the correct one
        rent: SYSVAR_RENT_PUBKEY,
      });

    const tx = await sendTransactionWithFreshBlockhash(program, method);

    return {
      tx,
      projectPda: projectPDA.toString(),
      tokenMint,
      poolId,
    };
  };

  /**
   * STEP 2: Initialize pool with parameters
   * 
   * CRITICAL: This version matches your DEPLOYED IDL
   * The IDL expects: initializePool(params)
   * NOT: initializePool(token_mint, pool_id, params)
   * 
   * The token_mint and pool_id are passed in the accounts object
   * for Anchor to derive the PDAs correctly.
   */
  const initializePool = async (params: {
    tokenMint: string;
    poolId: number;
    rateBpsPerYear: number;
    rateMode: number;
    lockupSeconds: number;
    poolDurationSeconds: number;
    referrer?: string | null;
    referrerSplitBps?: number | null;
    enableReflections: boolean;
    reflectionToken?: string | null;
    poolTokenFeeBps?: number;
    poolSolFee?: number;
  }) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    console.log('🔧 initializePool called with:', params);

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(params.tokenMint);
    
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

    console.log(`✅ Token program detected: ${tokenProgramId.toString()}`);
    
    // Derive project PDA
    const [projectPDA] = getPDAs.project(tokenMintPubkey, params.poolId);

    // ✅ FIXED: Use params.poolId instead of undefined poolId variable
    const [stakingVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, params.poolId);

    console.log('🔧 PDAs:', {
      tokenMint: tokenMintPubkey.toString(),
      poolId: params.poolId,
      projectPDA: projectPDA.toString(),
      stakingVaultPDA: stakingVaultPDA.toString(),
      tokenProgram: tokenProgramId.toString(),
    });

    // ✅ Build InitializePoolParams struct exactly as Rust expects
    // CRITICAL: Must include reflection_token field (from IDL line 2939-2943)
    const initializePoolParams = {
      rateBpsPerYear: new BN(params.rateBpsPerYear),
      rateMode: params.rateMode,
      lockupSeconds: new BN(params.lockupSeconds),
      poolDurationSeconds: new BN(params.poolDurationSeconds),
      referrer: params.referrer ? new PublicKey(params.referrer) : null,
      referrerSplitBps: params.referrerSplitBps !== null && params.referrerSplitBps !== undefined 
        ? new BN(params.referrerSplitBps) 
        : null,
      enableReflections: params.enableReflections,
      reflectionToken: params.reflectionToken && params.enableReflections
        ? new PublicKey(params.reflectionToken)
        : null,
    };

    console.log('🔧 InitializePoolParams struct:', initializePoolParams);

    // Build accounts object
    // ✅ CRITICAL: Even though tokenMint is in #[instruction()], it still needs
    // to be in the accounts context for PDA derivation
    const accounts: any = {
      project: projectPDA,
      stakingVault: stakingVaultPDA,
      admin: publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: tokenProgramId,
    };

    // ✅ ALWAYS provide reflection accounts (use placeholders if disabled)
    if (params.enableReflections && params.reflectionToken) {
      // Real reflection setup
      const reflectionTokenMintPubkey = params.reflectionToken;
      
      // Check if Native SOL
      const NATIVE_SOL = "So11111111111111111111111111111111111111112";
      const isNativeSol = reflectionTokenMintPubkey.toString() === NATIVE_SOL;
      
      if (isNativeSol) {
        // ✅ Native SOL - no ATA needed, just pass Project PDA
        accounts.reflectionTokenMint = reflectionTokenMintPubkey;
        accounts.reflectionTokenAccount = projectPDA;  // Project PDA itself
        accounts.associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID;
        accounts.reflectionTokenProgram = TOKEN_PROGRAM_ID;
        
        console.log("✅ Native SOL reflections - using Project PDA");
      } else {
        // ✅ SPL/Token-2022 - needs detection
        const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
        const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        
        const reflectionMintInfo = await connection.getAccountInfo(reflectionTokenMintPubkey);
        if (!reflectionMintInfo) {
          throw new Error("Reflection token mint not found");
        }
        
        const reflectionTokenProgramId = reflectionMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) 
          ? TOKEN_2022_PROGRAM_ID 
          : SPL_TOKEN_PROGRAM_ID;
        
        console.log(`✅ Reflection token program detected: ${reflectionTokenProgramId.toString()}`);

        // Get the ATA for the project PDA to hold reflection tokens
        const reflectionTokenAccount = getAssociatedTokenAddressSync(
          reflectionTokenMintPubkey,
          projectPDA,  // ✅ Project PDA owns the reflection account
          true,        // allowOwnerOffCurve
          reflectionTokenProgramId
        );

        accounts.reflectionTokenMint = reflectionTokenMintPubkey;
        accounts.reflectionTokenAccount = reflectionTokenAccount;
        accounts.reflectionTokenProgram = reflectionTokenProgramId;
        accounts.associatedTokenProgram = ASSOCIATED_TOKEN_PROGRAM_ID;

        console.log('🔧 Reflection accounts (ENABLED):', {
          reflectionTokenMint: reflectionTokenMintPubkey.toString(),
          reflectionTokenAccount: reflectionTokenAccount.toString(),
          reflectionTokenProgram: reflectionTokenProgramId.toString(),
        });
      }
    } else {
      // ✅ Placeholder accounts when reflections DISABLED
      // Pass program ID as placeholder for optional accounts
      accounts.reflectionTokenMint = program.programId;
      accounts.reflectionTokenAccount = program.programId;
      accounts.associatedTokenProgram = program.programId;
      accounts.reflectionTokenProgram = program.programId;
      
      console.log('🔧 Reflection accounts (DISABLED - using placeholders)');
    }

    console.log('🔧 All accounts:', accounts);

    try {
      // ✅ UPDATED: Pass token_mint and pool_id before params
      const method = program.methods
        .initializePool(
          tokenMintPubkey,           // token_mint
          new BN(params.poolId),     // pool_id
          initializePoolParams       // params struct
        )
        .accounts(accounts);

      console.log('🔧 Sending transaction...');
      const tx = await sendTransactionWithFreshBlockhash(program, method);
      console.log('✅ Pool initialized! Transaction:', tx);
      return tx;
    } catch (error: any) {
      console.error('❌ Initialize pool error:', error);
      if (error.logs) {
        console.error('📋 Transaction logs:', error.logs);
      }
      throw error;
    }
  };

  /**
   * Update pool parameters (rate and lockup)
   */
  const setProjectParams = async (
    tokenMint: string,
    poolId: number = 0,
    rateBpsPerYear: number,
    lockupSeconds: number
  ) => {
    console.log("setProjectParams called with:", { tokenMint, poolId, rateBpsPerYear, lockupSeconds });
    
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    console.log("PDA derived:", projectPDA.toString(), "for poolId:", poolId);

    const method = program.methods
      .updatePoolParams(
        tokenMintPubkey,
        new BN(poolId),
        new BN(rateBpsPerYear),
        new BN(lockupSeconds)
      )
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Update pool duration
   */
  const setPoolDuration = async (
    tokenMint: string,
    poolId: number = 0,
    durationSeconds: number
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .updatePoolDuration(
        tokenMintPubkey,
        new BN(poolId),
        new BN(durationSeconds)
      )
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Deposit rewards into the reward vault
   */
  const registerExtraReward = async (
    tokenMint: string,
    poolId: number,
    extraMint: string,
    beneficiary: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const extraMintPubkey = new PublicKey(extraMint);
    const beneficiaryPubkey = new PublicKey(beneficiary);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const [extraRewardPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra_reward"), projectPDA.toBuffer(), extraMintPubkey.toBuffer()],
      program.programId
    );

    const method = program.methods
      .registerExtraReward(tokenMintPubkey, new BN(poolId), beneficiaryPubkey)
      .accounts({
        project: projectPDA,
        extraReward: extraRewardPDA,
        extraMint: extraMintPubkey,
        admin: publicKey,
        systemProgram: SystemProgram.programId,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  const depositRewards = async (
    tokenMint: string,
    poolId: number = 0,
    amount: number | string | bigint,
    engine: string = 'legacy',
    rewardMint?: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    // Rewards are paid in the reward token, which differs from the staking
    // token on LP farms and dual token pools
    const rewardMintPubkey = rewardMint ? new PublicKey(rewardMint) : tokenMintPubkey;

    // ✅ DETECT THE TOKEN PROGRAM TYPE (of the reward token)
    const mintInfo = await connection.getAccountInfo(rewardMintPubkey);
    if (!mintInfo) {
      throw new Error("Reward token mint not found");
    }
    
    // Check if it's Token-2022 or SPL Token
    const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    
    const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) 
      ? TOKEN_2022_PROGRAM_ID 
      : SPL_TOKEN_PROGRAM_ID;

    console.log(`✅ Token program detected for deposit rewards: ${tokenProgramId.toString()}`);

    const [projectPDA] = engine === 'current'
      ? getPDAs.project1(tokenMintPubkey, poolId)
      : getPDAs.project(tokenMintPubkey, poolId);

    const [rewardVaultPDA] = engine === 'current'
      ? getPDAs.rewardVault1(tokenMintPubkey, poolId)
      : getPDAs.rewardVault(tokenMintPubkey, poolId);

    const adminTokenAccount = await getAssociatedTokenAddress(
      rewardMintPubkey,
      publicKey,
      false,
      tokenProgramId  // ✅ Use detected token program
    );

    const method = engine === 'current'
      ? program.methods
          .depositRewards1(
            tokenMintPubkey,
            new BN(poolId),
            new BN(amount.toString()))
          .accounts({
            project: projectPDA,
            rewardVault: rewardVaultPDA,
            adminTokenAccount,
            tokenMintAccount: rewardMintPubkey,
            admin: publicKey,
            rewardTokenProgram: tokenProgramId,
            systemProgram: SystemProgram.programId,
          })
      : program.methods
          .depositRewards(
            tokenMintPubkey,
            new BN(poolId),
            new BN(amount.toString()))
          .accounts({
            project: projectPDA,
            rewardVault: rewardVaultPDA,
            adminTokenAccount,
            tokenMintAccount: rewardMintPubkey,
            admin: publicKey,
            tokenProgram: tokenProgramId,
          });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Transfer admin rights to another wallet
   */
  const transferAdmin = async (
    tokenMint: string,
    poolId: number = 0,
    newAdmin: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const newAdminPubkey = new PublicKey(newAdmin);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .transferAdmin(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
        newAdmin: newAdminPubkey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Set project referrer
   */
  const setProjectReferrer = async (
    tokenMint: string,
    poolId: number = 0,
    referrer: string | null,
    splitBps: number
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const referrerPubkey = referrer ? new PublicKey(referrer) : null;

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .updateReferrer(
        tokenMintPubkey,
        new BN(poolId),
        referrerPubkey,
        new BN(splitBps)
      )
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Enable/disable reflections
   */
  const setReflections = async (
    tokenMint: string,
    poolId: number = 0,
    enable: boolean,
    reflectionTokenMint?: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    let reflectionVault = null;
    if (enable && reflectionTokenMint) {
      const [stakingVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("staking_vault"), projectPDA.toBuffer()],
        PROGRAM_ID
      );

      reflectionVault = getAssociatedTokenAddressSync(
        new PublicKey(reflectionTokenMint),
        stakingVaultPDA,
        true
      );
    }

    // ✅ FIX: Calculate reflection token pubkey for the 4th parameter
    const reflectionTokenPubkey = enable && reflectionTokenMint 
      ? new PublicKey(reflectionTokenMint) 
      : null;

    const method = program.methods
      .toggleReflections(
        tokenMintPubkey, 
        new BN(poolId), 
        enable, 
        reflectionTokenPubkey  // ✅ ADDED: 4th parameter
      )
      .accounts({
        project: projectPDA,
        reflectionVault: reflectionVault,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Pause/unpause deposits
   */
  const pauseDeposits = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .pauseDeposits(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  const unpauseDeposits = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .unpauseDeposits(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Pause/unpause withdrawals
   */
  const pauseWithdrawals = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .pauseWithdrawals(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  const unpauseWithdrawals = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .unpauseWithdrawals(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Pause/unpause claims
   */
  const pauseClaims = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .pauseClaims(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  const unpauseClaims = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .unpauseClaims(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Pause/unpause entire project
   */
  const pauseProject = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .pauseProject(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  const unpauseProject = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const method = program.methods
      .unpauseProject(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Set platform fees
   */
  const setFees = async (tokenFeeBps: number, solFee: number) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();

    const method = program.methods
      .setFees(new BN(tokenFeeBps), new BN(solFee))
      .accounts({
        platform: platformPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Update fee collector
   */
  const updateFeeCollector = async (newFeeCollector: string) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();
    const newFeeCollectorPubkey = new PublicKey(newFeeCollector);

    const method = program.methods
      .updateFeeCollector(newFeeCollectorPubkey)
      .accounts({
        platform: platformPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  const transferPlatformAdmin = async (newAdmin: string) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();
    const newAdminPubkey = new PublicKey(newAdmin);

    const method = program.methods
      .transferPlatformAdmin(newAdminPubkey)
      .accounts({
        platform: platformPDA,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Admin: correct a reward lock's reflection token (platform admin only)
   */
  const adminSetReflectionToken = async (
    tokenMint: string,
    poolId: number = 0,
    newReflectionMint: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const [platformPDA] = getPDAs.platformConfig();
    const tokenMintPubkey = new PublicKey(tokenMint);
    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
    const reflectionMintPubkey = new PublicKey(newReflectionMint);

    // Derive the reflection token account exactly as the program validates it
    const NATIVE_SOL = "So11111111111111111111111111111111111111112";
    let reflectionTokenAccount: PublicKey;

    if (newReflectionMint === NATIVE_SOL) {
      reflectionTokenAccount = projectPDA;
    } else {
      const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
      const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const mintInfo = await connection.getAccountInfo(reflectionMintPubkey);
      const tokenProgramId = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : SPL_TOKEN_PROGRAM_ID;
      reflectionTokenAccount = getAssociatedTokenAddressSync(
        reflectionMintPubkey,
        projectPDA,
        true,
        tokenProgramId
      );
    }

    const method = program.methods
      .adminSetReflectionToken(tokenMintPubkey, new BN(poolId))
      .accounts({
        platform: platformPDA,
        project: projectPDA,
        reflectionTokenMint: reflectionMintPubkey,
        reflectionTokenAccount: reflectionTokenAccount,
        admin: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Emergency return stake to user
   */
  const emergencyReturnStake = async (
    tokenMint: string,
    poolId: number = 0,
    userAddress: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const userPubkey = new PublicKey(userAddress);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const [stakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), projectPDA.toBuffer(), userPubkey.toBuffer()],
      PROGRAM_ID
    );

    const [stakingVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, poolId);

    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMintPubkey,
      userPubkey
    );

    const method = program.methods
      .emergencyReturnStake(tokenMintPubkey, new BN(poolId))
      .accounts({
        project: projectPDA,
        stake: stakePDA,
        stakingVault: stakingVaultPDA,
        userTokenAccount,
        user: userPubkey,
        admin: publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /**
   * Change withdrawal wallet for a user's stake
   */
  const changeWithdrawalWallet = async (
    tokenMint: string,
    poolId: number = 0,
    newWallet: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const newWalletPubkey = new PublicKey(newWallet);

    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    const [stakePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), projectPDA.toBuffer(), publicKey.toBuffer()],
      PROGRAM_ID
    );

    const method = program.methods
      .changeWithdrawalWallet(tokenMintPubkey, new BN(poolId), newWalletPubkey)
      .accounts({
        project: projectPDA,
        stake: stakePDA,
        user: publicKey,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  /* REMOVED: claim_unclaimed_tokens no longer exists in the deployed program
  const claimUnclaimedTokens = async (
    tokenMint: string,
    poolId: number = 0,
    vaultType: 'staking' | 'reward' | 'reflection',
    amount: number | string | bigint
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    
    const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

    // Token program detection
    const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

    let vaultPDA: PublicKey;
    let claimTokenMint: PublicKey;
    let tokenProgramId: PublicKey;

    if (vaultType === 'staking') {
      [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("staking_vault"), projectPDA.toBuffer()],
        PROGRAM_ID
      );
      claimTokenMint = tokenMintPubkey;
      
      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      tokenProgramId = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) 
        ? TOKEN_2022_PROGRAM_ID 
        : SPL_TOKEN_PROGRAM_ID;
      
    } else if (vaultType === 'reward') {
      [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), projectPDA.toBuffer()],
        PROGRAM_ID
      );
      claimTokenMint = tokenMintPubkey;
      
      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      tokenProgramId = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) 
        ? TOKEN_2022_PROGRAM_ID 
        : SPL_TOKEN_PROGRAM_ID;
      
    } else {
      // Reflection vault - ATA owned by Project PDA
      const projectData = await program.account.project.fetch(projectPDA);
      
      if (!projectData.reflectionToken) {
        throw new Error("No reflection token configured for this pool");
      }
      
      const reflectionTokenMint = projectData.reflectionToken as PublicKey;
      claimTokenMint = reflectionTokenMint;
      
      const mintInfo = await connection.getAccountInfo(reflectionTokenMint);
      tokenProgramId = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) 
        ? TOKEN_2022_PROGRAM_ID 
        : SPL_TOKEN_PROGRAM_ID;
      
      // Reflection vault is ATA owned by Project PDA
      vaultPDA = getAssociatedTokenAddressSync(
        reflectionTokenMint,
        projectPDA,
        true,
        tokenProgramId
      );
      
      console.log('🔍 Reflection vault claim:', {
        reflectionMint: reflectionTokenMint.toString(),
        vaultATA: vaultPDA.toString(),
      });
    }

    // Admin's token account for the token being claimed
    const adminTokenAccount = await getAssociatedTokenAddress(
      claimTokenMint,
      publicKey,
      false,
      tokenProgramId
    );

    console.log('🔍 Claim unclaimed:', {
      vaultType,
      vault: vaultPDA.toString(),
      claimTokenMint: claimTokenMint.toString(),
      adminTokenAccount: adminTokenAccount.toString(),
    });

    const method = program.methods
      .claimUnclaimedTokens(tokenMintPubkey, new BN(poolId), new BN(amount.toString()))
      .accounts({
        project: projectPDA,
        vault: vaultPDA,
        adminTokenAccount,
        tokenMintAccount: claimTokenMint,
        admin: publicKey,
        tokenProgram: tokenProgramId,
        systemProgram: SystemProgram.programId,
      });

    return await sendTransactionWithFreshBlockhash(program, method);
  };

  */

  const getReflectionTokenAccount = async (
    stakingTokenMint: string,
    poolId: number = 0,
    reflectionTokenMint: string
  ) => {
    const stakingTokenMintPubkey = new PublicKey(stakingTokenMint);
    const reflectionTokenMintPubkey = new PublicKey(reflectionTokenMint);

    const [projectPDA] = getPDAs.project(stakingTokenMintPubkey, poolId);

    const [stakingVaultPDA] = getPDAs.stakingVault(stakingTokenMintPubkey, poolId);

    const reflectionTokenAccount = getAssociatedTokenAddressSync(
      reflectionTokenMintPubkey,
      stakingVaultPDA,
      true
    );

    // Fetch balance
    try {
      const accountInfo = await connection.getTokenAccountBalance(reflectionTokenAccount);
      return {
        reflectionAccount: reflectionTokenAccount.toString(),
        balance: accountInfo.value.uiAmount || 0,
      };
    } catch (error) {
      console.log("Reflection account not created yet");
      return {
        reflectionAccount: reflectionTokenAccount.toString(),
        balance: 0,
      };
    }
  };

  /**
   * Check if reflection account exists and create if needed
   */
  const ensureReflectionAccountExists = async (
    stakingTokenMint: string,
    poolId: number = 0,
    reflectionTokenMint: string
  ) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    const stakingTokenMintPubkey = new PublicKey(stakingTokenMint);
    const reflectionTokenMintPubkey = new PublicKey(reflectionTokenMint);

    const [projectPDA] = getPDAs.project(stakingTokenMintPubkey, poolId);

    const [stakingVaultPDA] = getPDAs.stakingVault(stakingTokenMintPubkey, poolId);

    const reflectionTokenAccount = getAssociatedTokenAddressSync(
      reflectionTokenMintPubkey,
      stakingVaultPDA,
      true
    );

    // Check if account exists
    const accountInfo = await connection.getAccountInfo(reflectionTokenAccount);
    
    if (!accountInfo) {
      console.log("⚠️ Reflection token account doesn't exist yet.");
      console.log("📍 Address:", reflectionTokenAccount.toString());
      console.log("💡 It will be created automatically on pool initialization.");
      
      return {
        exists: false,
        address: reflectionTokenAccount.toString(),
      };
    }

    return {
      exists: true,
      address: reflectionTokenAccount.toString(),
    };
  };

  /**
   * Get project info - UPDATED with reflection info
   */
  const getProjectInfo = async (tokenMint: string, poolId: number = 0, engine: string = 'legacy') => {
    if (!wallet) {
      throw new Error("Wallet not connected");
    }

    const program = await getProgram(wallet, connection);
    const tokenMintPubkey = new PublicKey(tokenMint);
    const isV2 = engine === 'current';
    const [projectPDA] = isV2 ? getPDAs.project1(tokenMintPubkey, poolId) : getPDAs.project(tokenMintPubkey, poolId);

    const projectData = isV2 ? await program.account.project1.fetch(projectPDA) : await program.account.project.fetch(projectPDA);
    
    // If reflections enabled, also fetch reflection account info
    let reflectionInfo = null;
    if (projectData.reflectionToken) {
      const reflectionTokenMint = projectData.reflectionToken as PublicKey;
      const [stakingVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("staking_vault"), projectPDA.toBuffer()],
        PROGRAM_ID
      );

      const reflectionTokenAccount = getAssociatedTokenAddressSync(
        reflectionTokenMint,
        stakingVaultPDA,
        true
      );

      try {
        const accountInfo = await connection.getTokenAccountBalance(reflectionTokenAccount);
        reflectionInfo = {
          tokenMint: reflectionTokenMint.toString(),
          tokenAccount: reflectionTokenAccount.toString(),
          balance: accountInfo.value.uiAmount || 0,
          decimals: accountInfo.value.decimals,
        };
      } catch (error) {
        reflectionInfo = {
          tokenMint: reflectionTokenMint.toString(),
          tokenAccount: reflectionTokenAccount.toString(),
          balance: 0,
          error: "Account not yet created",
        };
      }
    }

    return {
      ...projectData,
      reflectionInfo,
    };
  };

  /**
   * Close a project and recover rent (only if total_staked == 0)
   */
  const closeProject = async (tokenMint: string, poolId: number = 0) => {
    if (!wallet || !publicKey) {
      throw new Error("Wallet not connected");
    }

    try {
      const program = await getProgram(wallet, connection);
      const tokenMintPubkey = new PublicKey(tokenMint);

      // Derive PDAs - FIXED: vaults derive from token_mint, not projectPDA
      const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);

      const [stakingVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("staking_vault"), tokenMintPubkey.toBuffer()], // ✅ FIXED: use tokenMint
        PROGRAM_ID
      );

      const [rewardVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reward_vault"), tokenMintPubkey.toBuffer()], // ✅ FIXED: use tokenMint
        PROGRAM_ID
      );

      const [reflectionVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("reflection_vault"), tokenMintPubkey.toBuffer()], // ✅ FIXED: use tokenMint
        PROGRAM_ID
      );

      console.log("Token Mint:", tokenMintPubkey.toString());
      console.log("Project PDA:", projectPDA.toString());
      console.log("Staking Vault:", stakingVaultPDA.toString());
      console.log("Reward Vault:", rewardVaultPDA.toString());

      // Fetch project data
      const projectData = await program.account.project.fetch(projectPDA);
      
      console.log("Project Data:", {
        totalStaked: projectData.totalStaked?.toString(),
        admin: projectData.admin.toString(),
        hasReflections: projectData.reflectionVault !== null,
      });

      // Verify admin
      if (projectData.admin.toString() !== publicKey.toString()) {
        throw new Error("You are not the admin of this project");
      }

      // Verify no active stakes
      if (projectData.totalStaked && !projectData.totalStaked.isZero()) {
        throw new Error(`Cannot close project with active stakes. Total staked: ${projectData.totalStaked.toString()}`);
      }

      const hasReflections = projectData.reflectionVault !== null;

      // Build the transaction with ALL required accounts
      const method = program.methods
        .closeProject(tokenMintPubkey, new BN(poolId))
        .accounts({
          project: projectPDA,
          stakingVault: stakingVaultPDA,
          rewardVault: rewardVaultPDA,
          reflectionVault: hasReflections ? reflectionVaultPDA : null,
          admin: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        });

      console.log("Sending transaction...");
      return await sendTransactionWithFreshBlockhash(program, method);
    } catch (error: any) {
      console.error("Close project error details:", error);
      throw error;
    }
  };

  return {
    // Platform Setup
    initializePlatform,
    
    // Pool Creation (Two-Step)
    createProject,
    initializePool,
    
    // Pool Management
    setProjectParams,
    setPoolDuration,
    depositRewards,
    registerExtraReward,
    transferAdmin,
    setProjectReferrer,
    setReflections,
    
    // Pause Controls
    pauseDeposits,
    unpauseDeposits,
    pauseWithdrawals,
    unpauseWithdrawals,
    pauseClaims,
    unpauseClaims,
    pauseProject,
    unpauseProject,
    
    // Platform Settings
    setFees,
    updateFeeCollector,
    transferPlatformAdmin,
    adminSetReflectionToken,
    adminMigrateStake,
    adminMigrateStake1,
    
    // Emergency Functions
    emergencyReturnStake,
    changeWithdrawalWallet,
    closeProject,
    
    // Reflection helpers
    getReflectionTokenAccount,
    ensureReflectionAccountExists,
    
    // Query
    getProjectInfo,
    getVaultInfo,
    
    // Status
    connected: !!wallet && !!publicKey,
  };
}