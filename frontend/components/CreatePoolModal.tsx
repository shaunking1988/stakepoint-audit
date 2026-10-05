"use client";
import { confirmTransactionPolling } from "@/lib/confirmTransaction";
import { useState, useEffect } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { Plus, X, Loader2, Check, AlertCircle, Code, Star, ExternalLink } from "lucide-react";
import { getProgram, getPDAs } from "@/lib/anchor-program";
import { calculateEstimatedAPR, calculateRequiredRewards } from "@/lib/calculate-apy";
import IntegrateModal from "@/components/IntegrateModal";
import * as anchor from "@coral-xyz/anchor";

const ADMIN_WALLET = new PublicKey("ecfvkqWdJiYJRyUtWvuYpPWP5faf9GBcA1K6TaDW7wS");

function PoolReviewPrompt() {
  const [skipped, setSkipped] = useState(false);

  if (skipped) return null;

  return (
    <div className="border border-white/[0.05] rounded-xl p-4 mb-2 bg-white/[0.02]">
      <p className="text-white text-sm font-semibold mb-2 text-center">Enjoying StakePoint?</p>
      <p className="text-gray-400 text-xs text-center mb-3">Your Trustpilot review helps AI assistants discover and recommend StakePoint, bringing more visibility to every project and community building here.</p>
      <div className="flex gap-2">
        <button onClick={() => setSkipped(true)} className="flex-1 py-2 rounded-lg text-xs font-semibold text-gray-500 bg-white/[0.02] hover:bg-white/[0.05] transition-all">Skip</button>
        <a href="https://www.trustpilot.com/review/stakepoint.app" target="_blank" rel="noopener noreferrer" className="flex-1 py-2 rounded-lg text-xs font-semibold text-white text-center transition-all" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
          Review on Trustpilot ⭐
        </a>
      </div>
    </div>
  );
}

function toTokenAmount(amount: string, decimals: number): string {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + paddedFraction;
  return combined.replace(/^0+/, '') || '0';
}

interface UserToken {
  mint: string;
  balance: number;
  decimals: number;
  symbol?: string;
  name?: string;
  logoURI?: string;
  programId: string;
  price?: number;
  liquidity?: number;
  marketCap?: number;
}

interface CreatePoolModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const KNOWN_LOGOS: Record<string, string> = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
  "So11111111111111111111111111111111111111112": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
};

export default function CreatePoolModal({ onClose, onSuccess }: CreatePoolModalProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [poolCreationFee, setPoolCreationFee] = useState(10_000_000);
  const [userTokens, setUserTokens] = useState<UserToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<UserToken | null>(null);
  const [selectedRewardToken, setSelectedRewardToken] = useState<UserToken | null>(null);
  const [useCustomRewardToken, setUseCustomRewardToken] = useState(false);
  const [rewardSearchQuery, setRewardSearchQuery] = useState("");
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showIntegrateModal, setShowIntegrateModal] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [txPhase, setTxPhase] = useState<1 | 2>(1);
  const [showIntro, setShowIntro] = useState(true);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [poolType, setPoolType] = useState<'staking' | 'farm' | null>(null);
  const [tvlData, setTvlData] = useState<{ totalValueLocked: number } | null>(null);

  const [poolConfig, setPoolConfig] = useState({
    rewardAmount: "1000",
    duration: "365",
    lockPeriod: "30",
    enableReflections: false,
    reflectionType: "self" as "self" | "external",
    externalReflectionMint: "",
    transferTaxPercent: "0",
  });

  useEffect(() => {
    if (publicKey && step === 1) {
      fetchUserTokens();
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'pool_modal_open', { modal_name: 'create_pool' });
      }
    }
  }, [publicKey, step]);

  const [feeLoading, setFeeLoading] = useState(false);
  const ORIGINAL_FEE_LAMPORTS = 1_000_000_000;
  const isDiscounted = poolCreationFee < ORIGINAL_FEE_LAMPORTS;
  const discountPercent = isDiscounted ? Math.round((1 - poolCreationFee / ORIGINAL_FEE_LAMPORTS) * 100) : 0;

  useEffect(() => {
    const fetchFee = async () => {
      setFeeLoading(true);
      try {
        const res = await fetch("/api/admin/pool-fee", { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setPoolCreationFee(data.feeInLamports);
        }
      } catch (error) {
        console.error("Failed to fetch pool creation fee:", error);
      } finally {
        setFeeLoading(false);
      }
    };
    if (step === 1 || step === 3) fetchFee();
  }, [step]);

  useEffect(() => {
    fetch("/api/stats")
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTvlData({ totalValueLocked: data.totalValueLocked || 0 });
        }
      })
      .catch(() => {});
  }, []);

  const fetchUserTokens = async () => {
    if (!publicKey) return;
    setLoading(true);
    setStatusMessage("Loading your tokens...");
    try {
      console.log("🔍 Fetching tokens for wallet:", publicKey.toString());
      const balance = await connection.getBalance(publicKey);
      const genesisHash = await connection.getGenesisHash();
      console.log("📍 Network:", genesisHash === "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" ? "MAINNET" : genesisHash === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ? "DEVNET" : "UNKNOWN");
      let tokenAccounts: { value: any[] } = { value: [] };
      try {
        tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
      } catch (e) {
        console.warn("⚠️ SPL fetch failed, skipping:", e);
      }
      let token2022Accounts: { value: any[] } = { value: [] };
      try {
        const raw2022Res = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "token2022-fetch",
            method: "getTokenAccountsByOwner",
            params: [
              publicKey.toString(),
              { programId: TOKEN_2022_PROGRAM_ID.toString() },
              { encoding: "jsonParsed", commitment: "confirmed" }
            ]
          })
        });
        const raw2022Data = await raw2022Res.json();
        token2022Accounts.value = (raw2022Data?.result?.value || []).filter(
          (acc: any) => typeof acc?.account?.data?.program === 'string'
        );
        console.log("✅ Found", token2022Accounts.value.length, "Token-2022 accounts via raw RPC");
      } catch (e) {
        console.warn("⚠️ Token-2022 fetch failed:", e);
      }
      const allAccounts = [
        ...tokenAccounts.value
          .filter(acc => typeof acc?.account?.data?.program === 'string')
          .map(acc => ({ ...acc, programId: "SPL Token", programIdKey: TOKEN_PROGRAM_ID.toString() })),
        ...token2022Accounts.value
          .filter(acc => typeof acc?.account?.data?.program === 'string')
          .map(acc => ({ ...acc, programId: "Token-2022", programIdKey: TOKEN_2022_PROGRAM_ID.toString() }))
      ];
      const tokens: UserToken[] = [];
      let processed = 0;
      for (const account of allAccounts) {
        try {
          const parsed = account.account.data.parsed.info;
          const tokenAmount = parsed.tokenAmount;
          const balance = tokenAmount.uiAmount || 0;
          const rawAmount = tokenAmount.amount;
          if (rawAmount !== "0") {
            const mint = parsed.mint;
            processed++;
            setStatusMessage(`Fetching metadata... (${processed}/${allAccounts.length})`);
            try {
              const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
              let tokenInfo: any = { symbol: mint.slice(0, 4) + '...' + mint.slice(-4), name: 'Unknown', logoURI: null, price: null, liquidity: null, marketCap: null };
              if (dexRes.ok) {
                const dexData = await dexRes.json();
                const bestPair = dexData.pairs?.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
                if (bestPair) {
                  const isBase = bestPair.baseToken?.address === mint;
                  const tokenData = isBase ? bestPair.baseToken : bestPair.quoteToken;
                  if (tokenData) {
                    let price = parseFloat(bestPair.priceUsd) || null;
                    if (!isBase && price) price = 1 / price;
                    let resolvedLogo = KNOWN_LOGOS[mint] || bestPair.info?.imageUrl || null;
              if (!resolvedLogo) {
                try {
                  const heliusRes = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'logo-fallback', method: 'getAsset', params: { id: mint } }) });
                  const heliusData = await heliusRes.json();
                  const raw = heliusData?.result?.content?.links?.image || heliusData?.result?.content?.files?.[0]?.uri;
                  if (raw) resolvedLogo = raw.replace('https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/').replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
                } catch {}
              }
              tokenInfo = { symbol: tokenData.symbol, name: tokenData.name, logoURI: resolvedLogo, price, liquidity: bestPair.liquidity?.usd || null, marketCap: bestPair.marketCap || null };
                  }
                }
              }
              // Fallback for tokens DexScreener can't see (no trading pair yet)
              if (tokenInfo.name === 'Unknown') {
                try {
                  const dasRes = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'pool-meta-fallback', method: 'getAsset', params: { id: mint } }) });
                  const dasData = await dasRes.json();
                  const meta = dasData?.result?.content?.metadata;
                  if (meta?.symbol) {
                    const rawLogo = dasData?.result?.content?.links?.image || dasData?.result?.content?.files?.[0]?.uri;
                    tokenInfo = {
                      symbol: meta.symbol,
                      name: meta.name || meta.symbol,
                      logoURI: KNOWN_LOGOS[mint] || (rawLogo ? rawLogo.replace('https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/').replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/') : null),
                      price: null,
                      liquidity: null,
                      marketCap: null,
                    };
                    console.log(`✅ Resolved ${meta.symbol} via Helius DAS (no DexScreener pair)`);
                  }
                } catch {}
              }
              tokens.push({ mint, balance, decimals: tokenAmount.decimals, symbol: tokenInfo.symbol || mint.slice(0, 4) + '...' + mint.slice(-4), name: tokenInfo.name || "Unknown", logoURI: tokenInfo.logoURI, programId: account.programIdKey, price: tokenInfo.price, liquidity: tokenInfo.liquidity, marketCap: tokenInfo.marketCap });
            } catch (err) {
              tokens.push({ mint, balance, decimals: tokenAmount.decimals, programId: account.programIdKey, symbol: mint.slice(0, 4) + '...' + mint.slice(-4), name: "Unknown" });
            }
          }
        } catch (parseError) { console.error("Error parsing token account:", parseError); }
      }
      tokens.sort((a, b) => {
        if (a.balance > 0 && b.balance === 0) return -1;
        if (a.balance === 0 && b.balance > 0) return 1;
        return (b.liquidity || b.marketCap || 0) - (a.liquidity || a.marketCap || 0);
      });
      setUserTokens(tokens.filter(t => t.mint !== "So11111111111111111111111111111111111111112"));
      setStatusMessage("");
    } catch (error) {
      console.error("❌ Error fetching tokens:", error);
      setStatusMessage("Error loading tokens. Please try again.");
    } finally {
      setLoading(false);
    }
  };

    const handleCreatePool = async () => {
    if (!publicKey || !sendTransaction || !selectedToken || !wallet || !effectiveRewardToken) { setError("Please connect your wallet"); return; }
    const WSOL_MINT = "So11111111111111111111111111111111111111112";
    if (selectedToken.mint === WSOL_MINT || effectiveRewardToken.mint === WSOL_MINT) { setError("SOL is not supported as a staking or reward token. Please choose an SPL or Token-2022 token."); return; }
    console.log("🔍 [CREATE POOL START] Pool Config:", { enableReflections: poolConfig.enableReflections, reflectionType: poolConfig.reflectionType, externalReflectionMint: poolConfig.externalReflectionMint, rewardToken: effectiveRewardToken.symbol });
    setError(null);
    setLoading(true);
    const solBalance = await connection.getBalance(publicKey);
    const estimatedFees = 1_000_000_000 + 0.02 * 1_000_000_000;
    if (solBalance < estimatedFees) { setError(`Insufficient SOL. Need ${(estimatedFees / 1_000_000_000).toFixed(3)} SOL, have ${(solBalance / 1_000_000_000).toFixed(4)} SOL.`); setLoading(false); return; }
    try {
      const program = getProgram(wallet, connection);
      const tokenMintPubkey = new PublicKey(selectedToken.mint);
      const rewardMintPubkey = new PublicKey(effectiveRewardToken.mint);
      let poolId = 0; let poolExists = true;
      console.log("🔍 Checking if pool already exists for this token...");
      while (poolExists && poolId < 100) {
        let onChainExists = false;
        // Check V2 PDA
        const [project1PDA] = getPDAs.project1(tokenMintPubkey, poolId);
        try { const accountInfo = await connection.getAccountInfo(project1PDA); if (accountInfo !== null) { onChainExists = true; console.log(`⚠️ Pool ${poolId} exists on-chain (V2)`); } } catch {}
        // Also check V1 PDA so we don't collide with legacy pools
        if (!onChainExists) {
          try { const [legacyPDA] = getPDAs.project(tokenMintPubkey, poolId); const accountInfo = await connection.getAccountInfo(legacyPDA); if (accountInfo !== null) { onChainExists = true; console.log(`⚠️ Pool ${poolId} exists on-chain (V1)`); } } catch {}
        }
        let dbExists = false;
        try { const dbCheck = await fetch(`/api/pools/by-token/${selectedToken.mint}`); if (dbCheck.ok) { const pools = await dbCheck.json(); dbExists = pools.some((p: any) => String(p.poolId) === String(poolId)); } } catch (error) { console.log("⚠️ Could not check database, continuing..."); }
        if (onChainExists || dbExists) { poolId++; } else { console.log(`✅ Found available poolId: ${poolId}`); poolExists = false; }
      }
      if (poolExists) throw new Error("Unable to find an available pool slot for this token. Please contact support.");
      const [projectPDA] = getPDAs.project1(tokenMintPubkey, poolId);
      const [stakingVaultPDA] = getPDAs.stakingVault1(tokenMintPubkey, poolId);
      const [rewardVaultPDA] = getPDAs.rewardVault1(tokenMintPubkey, poolId);
      const [platformPDA] = getPDAs.platformConfig();
      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!mintInfo) throw new Error("Token mint not found");
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const rewardMintInfo = effectiveRewardToken.mint === selectedToken.mint ? mintInfo : await connection.getAccountInfo(rewardMintPubkey);
      if (!rewardMintInfo) throw new Error("Reward token mint not found");
      const rewardTokenProgramId = rewardMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      console.log(`✅ Staking token program: ${tokenProgramId.toString()}, Reward token program: ${rewardTokenProgramId.toString()}`);
      console.log(`🎯 Creating pool with poolId: ${poolId}`);
      const userTokenAccount = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: tokenMintPubkey });
      if (userTokenAccount.value.length === 0) throw new Error("No token account found for this token");
      const userTokenAccountPubkey = userTokenAccount.value[0].pubkey;
      const rewardAmount = parseFloat(poolConfig.rewardAmount);
      if (effectiveRewardToken.mint === selectedToken.mint) {
        const userBalance = userTokenAccount.value[0].account.data.parsed.info.tokenAmount.uiAmount;
        if (userBalance < rewardAmount) throw new Error(`Insufficient balance. You have ${userBalance} ${selectedToken.symbol} but need ${rewardAmount}`);
      } else {
        if (effectiveRewardToken.balance < rewardAmount) throw new Error(`Insufficient balance. You have ${effectiveRewardToken.balance} ${effectiveRewardToken.symbol} but need ${rewardAmount}`);
      }
      const rewardAmountWithDecimals = new anchor.BN(toTokenAmount(poolConfig.rewardAmount, effectiveRewardToken.decimals));

      // ── TX 1: Payment + createProject1 ──
      setStatusMessage("Creating pool (1 of 2)...");
      setTxPhase(1);
      setIsConfirming(true);
      const tx1 = new Transaction();
      tx1.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }));
      tx1.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
      const platformAccount = await program.account.platform.fetch(platformPDA);
      const feeCollectorPubkey = platformAccount.feeCollector as PublicKey;
      const createProject1Ix = await program.methods
        .createProject1(tokenMintPubkey, new anchor.BN(poolId), rewardMintPubkey)
        .accounts({
          platform: platformPDA,
          project: projectPDA,
          stakingVault: stakingVaultPDA,
          rewardVault: rewardVaultPDA,
          tokenMint: tokenMintPubkey,
          rewardTokenMintAccount: rewardMintPubkey,
          feeCollector: feeCollectorPubkey,
          admin: publicKey,
          tokenProgram: tokenProgramId,
          rewardTokenProgram: rewardTokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx1.add(createProject1Ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx1.recentBlockhash = blockhash; tx1.feePayer = publicKey;
      const paymentSignature = await sendTransaction(tx1, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      const createProjectTx = paymentSignature;
      console.log("✅ Payment + Project created:", paymentSignature);
      setStatusMessage("Confirming pool creation...");
      await confirmTransactionPolling(connection, paymentSignature);
      setIsBroadcasting(false);
      setTxPhase(2);
      setIsConfirming(true);
      setStatusMessage("Preparing pool configuration...");
      let pdaReady = false;
      for (let i = 0; i < 20; i++) {
        try {
          const projectData = await program.account.project1.fetch(projectPDA, "confirmed");
          if (projectData && projectData.tokenMint.toString() === selectedToken.mint) {
            console.log(`✅ Project1 PDA fully deserialized after ${i + 1} attempts`);
            pdaReady = true;
            break;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!pdaReady) {
        throw new Error("Pool creation confirmed but account not yet readable. Please try again in a few seconds.");
      }

      // ── TX 2: initializePool1 + depositRewards1 ──
      setStatusMessage("Initializing pool & depositing rewards (2 of 2)...");
      const reflectionTokenMintToUse = poolConfig.enableReflections
        ? (poolConfig.reflectionType === "external" && poolConfig.externalReflectionMint ? new PublicKey(poolConfig.externalReflectionMint) : tokenMintPubkey)
        : null;
      const durationDays = parseInt(poolConfig.duration);
      const lockPeriodDays = parseInt(poolConfig.lockPeriod);
      if (!durationDays || durationDays <= 0) throw new Error("Pool duration must be at least 1 day.");
      if (isNaN(lockPeriodDays)) throw new Error("Invalid lock period.");
      const durationSeconds = durationDays * 86400;
      const lockupSeconds = lockPeriodDays * 86400;
      const initParams = { rateBpsPerYear: new anchor.BN(0), rateMode: 1, lockupSeconds: new anchor.BN(lockupSeconds), poolDurationSeconds: new anchor.BN(durationSeconds), referrer: null, referrerSplitBps: null, enableReflections: poolConfig.enableReflections, reflectionToken: reflectionTokenMintToUse, customTokenFeeBps: new anchor.BN(0), customSolFee: new anchor.BN(0), useCustomFees: false };
      const initPoolAccounts: any = { project: projectPDA, stakingVault: stakingVaultPDA, platform: platformPDA, admin: publicKey, systemProgram: SystemProgram.programId, tokenProgram: tokenProgramId };
      if (poolConfig.enableReflections && reflectionTokenMintToUse) {
        const NATIVE_SOL = "So11111111111111111111111111111111111111112";
        const isNativeSol = reflectionTokenMintToUse.toString() === NATIVE_SOL;
        if (isNativeSol) {
          initPoolAccounts.reflectionTokenMint = reflectionTokenMintToUse;
          initPoolAccounts.reflectionTokenAccount = projectPDA;
          initPoolAccounts.associatedTokenProgram = anchor.utils.token.ASSOCIATED_PROGRAM_ID;
          initPoolAccounts.reflectionTokenProgram = TOKEN_PROGRAM_ID;
        } else {
          const reflectionMintInfo = await connection.getAccountInfo(reflectionTokenMintToUse);
          if (!reflectionMintInfo) throw new Error("Reflection token mint not found");
          const reflectionTokenProgram = reflectionMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
          const reflectionVaultATA = await getAssociatedTokenAddress(reflectionTokenMintToUse, projectPDA, true, reflectionTokenProgram);
          initPoolAccounts.reflectionTokenMint = reflectionTokenMintToUse;
          initPoolAccounts.reflectionTokenAccount = reflectionVaultATA;
          initPoolAccounts.associatedTokenProgram = anchor.utils.token.ASSOCIATED_PROGRAM_ID;
          initPoolAccounts.reflectionTokenProgram = reflectionTokenProgram;
        }
      } else {
        initPoolAccounts.reflectionTokenMint = program.programId;
        initPoolAccounts.reflectionTokenAccount = program.programId;
        initPoolAccounts.associatedTokenProgram = program.programId;
        initPoolAccounts.reflectionTokenProgram = program.programId;
      }
      const tx2 = new Transaction();
      tx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
      tx2.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
      const initPool1Ix = await program.methods.initializePool1(tokenMintPubkey, new anchor.BN(poolId), initParams).accounts(initPoolAccounts).instruction();
      tx2.add(initPool1Ix);
      const userRewardAccount = effectiveRewardToken.mint === selectedToken.mint
        ? userTokenAccountPubkey
        : (await connection.getParsedTokenAccountsByOwner(publicKey, { mint: rewardMintPubkey })).value[0]?.pubkey;
      if (!userRewardAccount) throw new Error("No token account found for reward token");
      const depositRewards1Ix = await program.methods.depositRewards1(tokenMintPubkey, new anchor.BN(poolId), rewardAmountWithDecimals).accounts({ project: projectPDA, rewardVault: rewardVaultPDA, adminTokenAccount: userRewardAccount, tokenMintAccount: rewardMintPubkey, admin: publicKey, rewardTokenProgram: rewardTokenProgramId, systemProgram: SystemProgram.programId }).instruction();
      tx2.add(depositRewards1Ix);
      setStatusMessage("Verifying pool transaction...");
      let simPassed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { blockhash: simBlockhash } = await connection.getLatestBlockhash();
        tx2.recentBlockhash = simBlockhash;
        tx2.feePayer = publicKey;
        try {
          const simResult = await connection.simulateTransaction(tx2);
          if (!simResult.value.err) {
            console.log(`✅ TX2 simulation passed on attempt ${attempt + 1}`);
            simPassed = true;
            break;
          }
          console.warn(`⚠️ TX2 simulation failed attempt ${attempt + 1}:`, simResult.value.err);
        } catch (simErr: any) {
          console.warn(`⚠️ TX2 simulation error attempt ${attempt + 1}:`, simErr.message);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!simPassed) {
        console.warn("⚠️ TX2 simulation did not pass after 3 attempts, proceeding anyway");
      }
      setStatusMessage("Initializing pool & depositing rewards (2 of 2)...");
      const { blockhash: tx2Blockhash } = await connection.getLatestBlockhash();
      tx2.recentBlockhash = tx2Blockhash; tx2.feePayer = publicKey;
      const initPoolTx = await sendTransaction(tx2, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      console.log("✅ Pool initialized + rewards deposited:", initPoolTx);
      setStatusMessage("Confirming pool setup...");
      await confirmTransactionPolling(connection, initPoolTx);
      console.log("✅ Pool finalized");
      setIsBroadcasting(false);
      setStatusMessage("Saving pool information...");
      let reflectionVaultAddress = null; let reflectionSymbol = null; let actualReflectionMint = null;
      if (poolConfig.enableReflections) {
        try {
          const reflectionMint = poolConfig.reflectionType === "external" ? new PublicKey(poolConfig.externalReflectionMint) : tokenMintPubkey;
          actualReflectionMint = reflectionMint.toString();
          const NATIVE_SOL = "So11111111111111111111111111111111111111112";
          const isNativeSol = reflectionMint.toString() === NATIVE_SOL;
          if (isNativeSol) {
            reflectionVaultAddress = projectPDA.toString(); reflectionSymbol = "SOL";
          } else {
            const refMintInfo = await connection.getAccountInfo(reflectionMint);
            if (!refMintInfo) throw new Error("Reflection token mint not found");
            const refTokenProgram = refMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
            reflectionVaultAddress = (await getAssociatedTokenAddress(reflectionMint, projectPDA, true, refTokenProgram)).toString();
            if (poolConfig.reflectionType === "external") {
              try { const response = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'reflection-symbol', method: 'getAsset', params: { id: actualReflectionMint } }) }); const result = await response.json(); reflectionSymbol = result?.result?.content?.metadata?.symbol || result?.result?.token_info?.symbol || "REFLECT"; } catch { reflectionSymbol = "REFLECT"; }
            } else { reflectionSymbol = selectedToken.symbol; }
          }
        } catch (err) { console.error("⚠️ Could not calculate reflection vault:", err); throw new Error("Failed to setup reflection vault"); }
      }
      const poolData = { name: selectedToken.name, symbol: selectedToken.symbol, tokenDecimals: selectedToken.decimals, tokenMint: selectedToken.mint, logo: selectedToken.logoURI, apr: "0", apy: "0", type: lockPeriodDays === 0 ? "unlocked" : "locked", lockPeriod: lockPeriodDays.toString(), rewards: effectiveRewardToken.symbol, poolId, transferTaxBps: parseFloat(poolConfig.transferTaxPercent) * 100, hasSelfReflections: poolConfig.enableReflections && poolConfig.reflectionType === "self", hasExternalReflections: poolConfig.enableReflections && poolConfig.reflectionType === "external", externalReflectionMint: poolConfig.enableReflections ? actualReflectionMint : null, reflectionTokenSymbol: poolConfig.enableReflections ? reflectionSymbol : null, reflectionVaultAddress: poolConfig.enableReflections ? reflectionVaultAddress : null, isInitialized: true, isPaused: false, paymentTxSignature: paymentSignature, createTxSignature: createProjectTx, initTxSignature: initPoolTx, creatorWallet: publicKey.toString(), projectPda: projectPDA.toString(), poolAddress: projectPDA.toString(), engine: "current", isLPPool: false, rewardTokenMint: effectiveRewardToken.mint, rewardTokenSymbol: effectiveRewardToken.symbol, duration: parseInt(poolConfig.duration), rateMode: 1 };
      console.log("🔍 [SAVING TO DB] Pool Data:", poolData);
      const response = await fetch("/api/pools/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(poolData) });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || "Failed to save pool to database"); }
      const savedPool = await response.json();
      console.log("✅ Pool saved to database:", savedPool);
      setCreatedPoolId(savedPool.pool.id);
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'pool_created', { modal_name: 'create_pool', token: selectedToken?.symbol, rewardToken: effectiveRewardToken?.symbol });
      }
      setShowSuccessModal(true);
      setStatusMessage("");
      setLoading(false);
    } catch (error: any) {
      console.error("Error creating pool:", error);
      setStatusMessage("");
      const anchorErrorMap: Record<number, string> = { 6000: "You don't have permission to do this.", 6001: "The amount entered isn't valid.", 6002: "You don't have enough tokens in your wallet.", 6003: "This pool has been paused.", 6011: "A calculation error occurred. Try a smaller reward amount.", 6012: "This pool has already been set up.", 6013: "This pool wasn't fully initialised. The second transaction may have been missed.", 6015: "This pool requires a reflection vault but none was provided.", 6016: "A reflection token is required but wasn't set.", 6018: "You don't have enough SOL to cover the transaction fee. Ensure you have at least 0.02 SOL.", 6024: "Pool duration must be greater than 0 days.", 6025: "A calculation error occurred. Please try again.", 6028: "Wrong token type. This doesn't match the expected token.", 6036: "Invalid rate mode." };
      const errStr = String(error?.message ?? error);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16) : jsonMatch ? parseInt(jsonMatch[1]) : anchorMatch ? parseInt(anchorMatch[1]) : fallbackMatch ? parseInt(fallbackMatch[1]) : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;
      let errorMessage = anchorError || "Failed to create pool. Please try again.";
      if (!anchorError && errStr.includes("User rejected")) errorMessage = "Transaction cancelled.";
      else if (!anchorError && errStr.includes("insufficient")) errorMessage = "Insufficient SOL balance.";
      else if (!anchorError && error.message) errorMessage = error.message;
      setError(errorMessage);
      setLoading(false);
      setIsConfirming(false);
      setIsBroadcasting(false);
    } finally {
      setLoading(false);
      setIsConfirming(false);
      setIsBroadcasting(false);
    }
  };

  const effectiveRewardToken = useCustomRewardToken && selectedRewardToken ? selectedRewardToken : selectedToken;

  const filteredRewardTokens = userTokens
    .filter(t => t.mint !== selectedToken?.mint)
    .filter(t => {
      if (!rewardSearchQuery) return true;
      const q = rewardSearchQuery.toLowerCase();
      return (t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q));
    });

  const inputCls = "w-full px-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-sm focus:outline-none transition-colors";

  return (
    <>
      {/* Main Modal */}
      <div className={`fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3 ${showSuccessModal ? 'hidden' : ''}`}>
        <div className="bg-black/95 rounded-2xl w-full max-w-lg flex flex-col border border-white/[0.08]" style={{ maxHeight: '96vh' }}>

          {showIntro ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center flex-1 min-h-0">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'linear-gradient(135deg, #1a001a, #fb57ff)' }}>
                <Plus className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Launch your staking pool</h2>
              <p className="text-sm text-gray-400 mb-6">Your trusted non-custodial Solana staking platform</p>

              <div className="w-full max-w-xs space-y-3 mb-4">
                <div className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/[0.08] rounded-xl">
                  <span className="text-xs text-gray-400">Total Value Locked</span>
                  <span className="text-sm font-bold text-white">
                    {tvlData ? `$${tvlData.totalValueLocked.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
                  </span>
                </div>
                <a
                  href="https://auditr.xyz/public/c192a765-5ce6-4a69-82dc-e162437568a7"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 border rounded-xl transition-colors hover:bg-white/[0.03]"
                  style={{ borderColor: 'rgba(34, 197, 94, 0.3)', background: 'rgba(34, 197, 94, 0.05)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 text-sm">🛡️</span>
                    <span className="text-xs text-green-400 font-medium">Smart Contract Audited</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-green-400">Grade A</span>
                    <ExternalLink className="w-3 h-3 text-green-400/60" />
                  </div>
                </a>
              </div>

              <p className="text-xs text-gray-500 mb-4">Trusted by thousands of users every month</p>

              <p className="text-xs text-gray-500 mb-6 max-w-xs text-center leading-relaxed">Supports all SPL and Token-2022 tokens. No code required. Optional reward distributions for tokens that pay holders.</p>

              <button
                onClick={() => { setShowIntro(false); setShowTypeSelector(true); }}
                className="w-full max-w-xs py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
              >
                Get Started
              </button>
              <button onClick={onClose} className="mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Cancel
              </button>
            </div>
          ) : showTypeSelector ? (
            <div className="flex flex-col px-6 py-8 flex-1 min-h-0">
              <h2 className="text-lg font-bold text-white text-center mb-2">What would you like to create?</h2>
              <p className="text-sm text-gray-400 text-center mb-6">Choose your reward structure</p>
              <div className="space-y-3 max-w-sm mx-auto w-full">
                <button
                  onClick={() => { setPoolType('staking'); setUseCustomRewardToken(false); setSelectedRewardToken(null); setShowTypeSelector(false); }}
                  className="w-full p-4 rounded-xl border transition-all text-left hover:border-[#fb57ff]/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                >
                  <p className="text-white font-semibold text-sm mb-1">Same Token Rewards</p>
                  <p className="text-gray-400 text-xs leading-relaxed">Users stake a token and earn rewards in the same token. Standard staking pool.</p>
                </button>
                <button
                  onClick={() => { setPoolType('staking'); setUseCustomRewardToken(true); setSelectedRewardToken(null); setShowTypeSelector(false); }}
                  className="w-full p-4 rounded-xl border transition-all text-left hover:border-[#fb57ff]/50"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                >
                  <p className="text-white font-semibold text-sm mb-1">Different Reward Token</p>
                  <p className="text-gray-400 text-xs leading-relaxed">Users stake one token and earn rewards in a different token. You choose both.</p>
                </button>
              </div>
              <button onClick={() => { setShowTypeSelector(false); setShowIntro(true); }} className="mt-6 text-xs text-gray-500 hover:text-gray-300 transition-colors text-center">
                Back
              </button>
            </div>
          ) : (<>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
            <h2 className="text-base font-bold flex items-center gap-2" style={{ background: 'linear-gradient(45deg, white, #fb57ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <Plus className="w-4 h-4 flex-shrink-0" style={{ color: '#fb57ff' }} />
              Create Staking Pool
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 px-5 py-2.5 border-b border-white/[0.08] flex-shrink-0">
            {(['Select Token', 'Configure', 'Confirm'] as const).map((label, i) => {
              const s = i + 1;
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className="w-8 h-px bg-white/[0.1]" />}
                  <div className={`flex items-center gap-1.5 ${step >= s ? 'text-[#fb57ff]' : 'text-gray-600'}`}>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${step >= s ? 'text-white' : 'bg-gray-800 text-gray-500'}`}
                      style={step >= s ? { background: 'linear-gradient(45deg, #1a001a, #fb57ff)' } : {}}
                    >
                      {step > s ? <Check className="w-3 h-3" /> : s}
                    </div>
                    <span className="text-xs font-medium hidden sm:block">{label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Notifications */}
          {(error || statusMessage) && (
            <div className="px-4 pt-3 flex-shrink-0 space-y-2">
              {error && (
                <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-200 flex-1">{error}</p>
                  <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 flex-shrink-0"><X className="w-3 h-3" /></button>
                </div>
              )}
              {statusMessage && (
                <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/30 rounded-lg flex items-center gap-2" style={{ color: '#fb57ff' }}>
                  <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                  <span className="text-xs">{statusMessage}</span>
                </div>
              )}
            </div>
          )}

          {/* Scrollable Step Content */}
          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">

            {/* ── STEP 1 ── */}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Select a token from your wallet. Only tokens with a balance are shown.
                </p>

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#fb57ff' }} />
                  </div>
                ) : userTokens.length === 0 ? (
                  <div className="text-center py-12 text-gray-600">
                    <AlertCircle className="w-10 h-10 mx-auto mb-3" />
                    <p className="text-sm">No tokens found in your wallet</p>
                    <p className="text-xs mt-1">Make sure you have tokens with a balance &gt; 0</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {userTokens.map((token) => (
                      <button
                        key={token.mint}
                        onClick={() => { setSelectedToken(token); setSelectedRewardToken(null); setUseCustomRewardToken(false); setError(null); setStep(2); }}
                        className="w-full flex items-center gap-3 p-3 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] hover:border-white/[0.12] rounded-xl transition-all text-left"
                      >
                        {token.logoURI ? (
                          <img src={token.logoURI} alt={token.symbol} className="w-9 h-9 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-bold text-gray-300">{token.symbol?.[0] || "?"}</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-white text-sm truncate">{token.name || "Unknown"}</div>
                          <div className="text-xs text-gray-500 font-mono">{token.mint.slice(0, 6)}…{token.mint.slice(-4)}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-white text-sm font-medium">{token.balance.toLocaleString()}</div>
                          {token.price && token.balance > 0 && (
                            <div className="text-xs text-gray-500">${(token.balance * token.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                          )}
                          <div className="text-xs font-semibold" style={{ color: token.programId.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? '#60a5fa' : '#fb57ff' }}>
                            {token.programId.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? "SPL" : "T-2022"}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && selectedToken && (
              <div className="space-y-3">
                {/* Selected token */}
                <div className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                  {selectedToken.logoURI && <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-9 h-9 rounded-full flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white text-sm truncate">{selectedToken.name}</div>
                    <div className="text-xs text-gray-500">{selectedToken.symbol}{selectedToken.price ? ` · $${selectedToken.price.toFixed(6)}` : ''}</div>
                  </div>
                </div>

                {/* Tip */}
                <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/20 rounded-lg">
                  <p className="text-xs text-gray-400">💡 APR auto-calculates from deposited rewards. <span className="text-yellow-400">⚠️ Stake a small amount yourself after creation to show a live APR.</span></p>
                </div>

                {/* 2-col fields */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Reward Deposit ({effectiveRewardToken?.symbol || selectedToken.symbol})</label>
                      <input type="number" value={poolConfig.rewardAmount} onChange={(e) => setPoolConfig({ ...poolConfig, rewardAmount: e.target.value })} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="1000" min="1" />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>Tokens deposited as staking rewards. Must be greater than 0.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Pool Duration (days) <span className="text-[#fb57ff]">365+ rec.</span></label>
                      <input type="number" value={poolConfig.duration} onChange={(e) => setPoolConfig({ ...poolConfig, duration: e.target.value })} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="365" min="1" />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>How long rewards are distributed. Minimum 1 day, 365+ recommended.</p>
                    </div>
                  </div>
                  <div className="border-t border-white/[0.05]" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Min Lock (days) <span className="text-gray-600">0 = flexible</span></label>
                      <input type="number" value={poolConfig.lockPeriod} onChange={(e) => { const v = e.target.value; const d = parseInt(poolConfig.duration); const l = parseInt(v); setPoolConfig({ ...poolConfig, lockPeriod: l > d ? poolConfig.duration : v }); }} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="30" min="0" max={poolConfig.duration} />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>Minimum time before stakers can unstake. 0 = flexible.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Transfer Tax (%)</label>
                      <input type="number" step="0.1" value={poolConfig.transferTaxPercent} onChange={(e) => { const v = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)); setPoolConfig({ ...poolConfig, transferTaxPercent: v.toString() }); }} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="0" min="0" max="100" />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>Only set if your token has a transfer tax. Leave at 0 for standard tokens.</p>
                    </div>
                  </div>
                </div>

                {parseFloat(poolConfig.transferTaxPercent) > 0 && (
                  <div className="p-2.5 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
                    <p className="text-xs text-yellow-300">⚠️ With {parseFloat(poolConfig.transferTaxPercent).toFixed(1)}% tax: {poolConfig.rewardAmount} → {(parseFloat(poolConfig.rewardAmount) * (1 - parseFloat(poolConfig.transferTaxPercent) / 100)).toFixed(2)} {selectedToken.symbol} in vault.</p>
                  </div>
                )}

                {/* Reward Token */}
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-300">Different Reward Token</p>
                      <p className="text-xs text-gray-600">Earn a different token than what's staked</p>
                    </div>
                    <button type="button" onClick={() => { setUseCustomRewardToken(!useCustomRewardToken); if (useCustomRewardToken) setSelectedRewardToken(null); }} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${useCustomRewardToken ? 'bg-[#fb57ff]' : 'bg-gray-700'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${useCustomRewardToken ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {useCustomRewardToken && (
                    <div className="space-y-2 pt-2 border-t border-white/[0.05]">
                      {selectedRewardToken ? (
                        <div className="flex items-center gap-3 p-2.5 bg-white/[0.03] border border-[#fb57ff]/30 rounded-lg">
                          {selectedRewardToken.logoURI && <img src={selectedRewardToken.logoURI} alt={selectedRewardToken.symbol} className="w-7 h-7 rounded-full flex-shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-semibold text-white">{selectedRewardToken.symbol}</span>
                            <span className="text-xs text-gray-500 ml-2">Balance: {selectedRewardToken.balance.toLocaleString()}</span>
                          </div>
                          <button onClick={() => setSelectedRewardToken(null)} className="text-gray-400 hover:text-white text-xs">Change</button>
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <input type="text" value={rewardSearchQuery} onChange={e => setRewardSearchQuery(e.target.value)} placeholder="Search reward token..." className={`${inputCls} pl-8`} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} />
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">🔍</span>
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {filteredRewardTokens.length === 0 ? (
                              <p className="text-xs text-gray-500 text-center py-3">No other tokens found in wallet</p>
                            ) : filteredRewardTokens.map(token => (
                              <button key={token.mint} onClick={() => { setSelectedRewardToken(token); setRewardSearchQuery(""); }} className="w-full flex items-center gap-2.5 p-2 bg-white/[0.01] hover:bg-white/[0.05] border border-white/[0.05] rounded-lg transition-all text-left">
                                {token.logoURI ? <img src={token.logoURI} alt={token.symbol} className="w-7 h-7 rounded-full flex-shrink-0" /> : <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-gray-300">{token.symbol?.[0] || "?"}</span></div>}
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-semibold text-white">{token.symbol}</span>
                                  <span className="text-xs text-gray-500 ml-1.5">{token.balance.toLocaleString()}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Reflections */}
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-300">Enable Reward Distributions</p>
                      <p className="text-xs text-gray-600">Turn on if your token pays rewards to holders. Stakers can claim them without unstaking.</p>
                    </div>
                    <button type="button" onClick={() => setPoolConfig({ ...poolConfig, enableReflections: !poolConfig.enableReflections })} className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${poolConfig.enableReflections ? 'bg-[#fb57ff]' : 'bg-gray-700'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${poolConfig.enableReflections ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>

                  {poolConfig.enableReflections && (
                    <div className="space-y-3 pt-2 border-t border-white/[0.05]">
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setPoolConfig({ ...poolConfig, reflectionType: "self" })} className={`p-2.5 rounded-lg border transition-colors text-left ${poolConfig.reflectionType === "self" ? 'border-[#fb57ff] bg-[#fb57ff]/10 text-white' : 'border-white/[0.08] text-gray-500 hover:bg-white/[0.03]'}`}>
                          <div className="text-xs font-semibold">Same Token</div>
                          <div className="text-xs opacity-60">Pays in your own token</div>
                        </button>
                        <button type="button" onClick={() => setPoolConfig({ ...poolConfig, reflectionType: "external" })} className={`p-2.5 rounded-lg border transition-colors text-left ${poolConfig.reflectionType === "external" ? 'border-[#fb57ff] bg-[#fb57ff]/10 text-white' : 'border-white/[0.08] text-gray-500 hover:bg-white/[0.03]'}`}>
                          <div className="text-xs font-semibold">Different Token</div>
                          <div className="text-xs opacity-60">SOL, USDC, SPL or Token-2022</div>
                        </button>
                      </div>
                      {poolConfig.reflectionType === "external" && (
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1">Reward Token Mint Address</label>
                          <input type="text" value={poolConfig.externalReflectionMint} onChange={(e) => setPoolConfig({ ...poolConfig, externalReflectionMint: e.target.value })} className={`${inputCls} font-mono`} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="Enter mint address" />
                          <p className="text-xs text-gray-600 mt-1">Native SOL: So11111111111111111111111111111111111111112</p>
                          <p className="text-xs text-gray-600 mt-1">SOL is supported for reflections only. It cannot be used as the staking token or the reward token.</p>
                          <p className="text-xs mt-2 leading-relaxed" style={{ color: '#fb57ff' }}>This is permanent. The reward token is set when the pool is created and cannot be changed or added later. If it is wrong, distributions will still arrive at the pool but will not be claimable.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Nav */}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setError(null); setStep(1); }} disabled={loading} className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">Back</button>
                  <button onClick={() => {
                    if (!poolConfig.rewardAmount || parseFloat(poolConfig.rewardAmount) <= 0) { setError("Reward deposit must be greater than 0."); return; }
                    if (!poolConfig.duration || parseInt(poolConfig.duration) <= 0) { setError("Pool duration must be at least 1 day."); return; }
                    if (useCustomRewardToken && !selectedRewardToken) { setError("Please select a reward token."); return; }
                    setError(null); setStep(3);
                  }} disabled={loading} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50" style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}>Continue →</button>
                </div>
              </div>
            )}

            {/* ── STEP 3 ── */}
            {step === 3 && selectedToken && (
              <div className="space-y-3">
                {/* Fee */}
                <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-300">⚠️ Pool Creation Fee</p>
                    {feeLoading ? (
                      <span className="text-xs text-gray-500">Loading…</span>
                    ) : isDiscounted ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 line-through">{(ORIGINAL_FEE_LAMPORTS / 1_000_000_000).toFixed(1)} SOL</span>
                        <span className="text-sm font-bold text-white">{(poolCreationFee / 1_000_000_000).toFixed(3)} SOL</span>
                        <span className="px-1.5 py-0.5 text-xs font-bold rounded-full bg-green-500/20 text-green-400 border border-green-500/30">{discountPercent}% OFF</span>
                      </div>
                    ) : (
                      <span className="text-sm font-bold text-white">{(poolCreationFee / 1_000_000_000).toFixed(1)} SOL</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-1">2 transactions required:</p>
                  <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
                    <li>Tx 1: Pay fee + create pool on-chain</li>
                    <li>Tx 2: Initialize params + deposit {poolConfig.rewardAmount} {effectiveRewardToken?.symbol || selectedToken.symbol}</li>
                  </ul>
                </div>

                {/* Summary */}
                <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl">
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b border-white/[0.05]">
                    {selectedToken.logoURI && <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-9 h-9 rounded-full flex-shrink-0" />}
                    <div>
                      <div className="font-bold text-white">{selectedToken.symbol} Pool</div>
                      <div className="text-xs text-gray-500">{selectedToken.name}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex justify-between"><span className="text-xs text-gray-500">APR</span><span className="text-xs font-medium" style={{ color: '#fb57ff' }}>Dynamic</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Rewards</span><span className="text-xs font-medium text-white">{parseFloat(poolConfig.rewardAmount).toLocaleString()} {effectiveRewardToken?.symbol || selectedToken.symbol}</span></div>
                    {useCustomRewardToken && selectedRewardToken && <div className="flex justify-between"><span className="text-xs text-gray-500">Reward Token</span><span className="text-xs font-medium" style={{ color: '#fb57ff' }}>{selectedRewardToken.symbol}</span></div>}
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Duration</span><span className="text-xs font-medium text-white">{poolConfig.duration} days</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Lock</span><span className="text-xs font-medium text-white">{poolConfig.lockPeriod} days{parseInt(poolConfig.lockPeriod) === 0 ? ' (Flex)' : ''}</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Tax</span><span className="text-xs font-medium text-white">{poolConfig.transferTaxPercent}%</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Status</span><span className="text-xs font-medium" style={{ color: '#fb57ff' }}>Ready</span></div>
                  </div>
                </div>

                {/* Nav */}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setError(null); setStep(2); }} disabled={loading} className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">Back</button>
                  <button
                    onClick={handleCreatePool}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                    onMouseEnter={(e) => !loading && (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
                    onMouseLeave={(e) => !loading && (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : 'Create Pool'}
                  </button>
                </div>
              </div>
            )}

          </div>
          </>)}
        </div>
      </div>

      {/* Success Modal */}
        {showSuccessModal && createdPoolId && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div className="bg-black border-2 border-[#fb57ff] rounded-2xl max-w-2xl w-full p-5 animate-in fade-in zoom-in duration-300" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-[#fb57ff]/20 border-2 border-[#fb57ff] rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-6 h-6" style={{ color: '#fb57ff' }} />
              </div>
              <div>
                <h2 className="text-xl font-bold" style={{ background: 'linear-gradient(45deg, white, #fb57ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Pool Created! 🎉</h2>
                <p className="text-gray-400 text-sm">Your staking pool is now live</p>
              </div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3">
              <p className="text-sm font-semibold text-yellow-400 mb-1">⚡ Important: Kickstart Your APR</p>
              <p className="text-xs text-yellow-300 leading-relaxed">Your pool's APR will show <strong>0%</strong> until someone stakes. Stake a small amount yourself right away to activate reward distribution and show a live APR.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="flex flex-col gap-2">
                <div className="bg-white/[0.02] border border-[#fb57ff]/20 rounded-lg p-3 flex-1">
                  <p className="text-sm font-semibold mb-2" style={{ color: '#fb57ff' }}>🔗 Share Your Pool</p>
                  <div className="flex gap-2 mb-2">
                    <input type="text" value={`${typeof window !== 'undefined' ? window.location.origin : ''}/pool/${createdPoolId}`} readOnly className="flex-1 px-2 py-1.5 bg-white/[0.05] border border-white/[0.1] rounded text-xs text-white font-mono min-w-0" onClick={(e) => e.currentTarget.select()} />
                    <button onClick={() => { navigator.clipboard.writeText(`${typeof window !== 'undefined' ? window.location.origin : ''}/pool/${createdPoolId}`); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2000); }} className="px-3 py-1.5 bg-[#fb57ff]/20 hover:bg-[#fb57ff]/30 border border-[#fb57ff]/50 rounded transition-all text-xs font-semibold min-w-[60px]" style={urlCopied ? { background: 'linear-gradient(45deg, black, #fb57ff)' } : {}}>
                      {urlCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">Share this link with your community!</p>
                </div>
                <PoolReviewPrompt />
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    const url = `https://stakepoint.app/pool/${createdPoolId}?t=${Math.floor(Date.now() / 60000)}`;
                    const lockText = parseInt(poolConfig.lockPeriod) > 0 ? ` with a ${poolConfig.lockPeriod}-day lock` : '';
                    const text = `Just launched a $${selectedToken?.symbol} staking pool on @StakePointApp 🚀\n\nStake $${selectedToken?.symbol} on Solana and earn rewards${lockText}.\n\n`;
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
                  }}
                  className="w-full px-4 py-2.5 bg-black hover:bg-zinc-900 border border-white/10 hover:border-white/20 rounded-lg font-semibold text-sm transition-all text-white flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  Share on X
                </button>
                <button onClick={() => { setShowSuccessModal(false); setShowIntegrateModal(true); }} className="w-full px-4 py-2.5 bg-white/[0.05] hover:bg-white/[0.08] border border-[#fb57ff]/30 rounded-lg font-semibold text-sm transition-all hover:border-[#fb57ff] text-white flex items-center justify-center gap-2">
                  <Code className="w-4 h-4" />Integrate on Your Website
                </button>
                <button onClick={() => window.open(`/pool/${createdPoolId}`, '_blank')} className="w-full px-4 py-2.5 bg-white/[0.05] hover:bg-white/[0.08] border border-[#fb57ff]/30 rounded-lg font-semibold text-sm transition-all hover:border-[#fb57ff] text-white">View Pool</button>
                <button onClick={() => { onSuccess(); onClose(); }} className="w-full px-4 py-2.5 rounded-lg font-semibold text-sm transition-all hover:opacity-90 text-white" style={{ background: 'linear-gradient(45deg, #fb57ff, black)' }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Integrate Modal */}
      {createdPoolId && (
        <IntegrateModal isOpen={showIntegrateModal} onClose={() => setShowIntegrateModal(false)} poolId={createdPoolId} />
      )}

      {(isConfirming || isBroadcasting) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="flex justify-center mb-6">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                <div className="absolute inset-2 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.3)', borderTopColor: 'transparent', animationDirection: 'reverse', animationDuration: '1.5s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Plus className="w-7 h-7" style={{ color: '#fb57ff' }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-20 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${txPhase >= 2 ? 'w-full' : isBroadcasting ? 'w-full' : 'w-1/2'}`} style={{ background: '#fb57ff' }} />
              </div>
              <div className="w-20 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${txPhase < 2 ? 'w-0' : isBroadcasting ? 'w-full' : 'w-1/2'}`} style={{ background: '#fb57ff' }} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2 font-medium">Transaction {txPhase} of 2</p>
            <h3 className="text-xl font-bold text-white mb-2">
              {isConfirming ? "Confirm in Wallet" : "Broadcasting..."}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {isConfirming ? `Check your wallet and approve transaction ${txPhase}: ${txPhase === 1 ? 'Create pool' : 'Initialize pool and deposit rewards'}` : "Broadcasting to the Solana blockchain"}
            </p>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
              <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
              <p className="text-xs text-gray-500">{txPhase >= 2 ? "Your reward tokens have not moved yet. This second approval initializes the pool and deposits them. Closing now leaves the pool unfunded." : "Pool creation requires 2 approvals. Stay on this page until you see the success screen."}</p>
            </div>
            <div className="flex justify-center gap-1">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}