"use client";

import { useState, useEffect } from "react";
import { X, Lock, AlertCircle, Loader2, Search, ChevronDown, ExternalLink, Star, Gift } from "lucide-react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getProgram, getPDAs } from "@/lib/anchor-program";
import { BN } from "@coral-xyz/anchor";
import { confirmTransactionPolling } from "@/lib/confirmTransaction";

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

interface CreateRewardLockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface TokenInfo {
  mint: string;
  balance: number;
  tokenAccount: string;
  decimals: number;
  symbol?: string;
  name?: string;
  logoURI?: string;
  price?: number;
  liquidity?: number;
  marketCap?: number;
  programId?: string;
  isLpToken?: boolean;
  baseMint?: string;
  lpPoolId?: string;
}

interface RewardLockSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol: string;
  amount: string;
  duration: string;
  lockPageUrl: string;
  rewardTokenSymbol: string;
}

function LockReviewPrompt({ onClose }: { onClose: () => void }) {
  const { publicKey } = useWallet();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skipped, setSkipped] = useState(false);

  if (skipped) return (
    <button onClick={onClose} className="w-full py-3 rounded-xl font-semibold bg-white/[0.02] hover:bg-white/[0.05] transition-all text-gray-400">
      Close
    </button>
  );

  if (submitted) return (
    <div className="text-center py-2 mb-2">
      <p className="text-green-400 text-sm font-semibold">Thanks for your review!</p>
      <button onClick={onClose} className="w-full mt-3 py-3 rounded-xl font-semibold bg-white/[0.02] hover:bg-white/[0.05] transition-all text-gray-400">
        Close
      </button>
    </div>
  );

  return (
    <div className="border border-white/[0.05] rounded-xl p-4 mb-2 bg-white/[0.02]">
      <p className="text-white text-sm font-semibold mb-3 text-center">How was your experience?</p>
      <div className="flex justify-center gap-1 mb-3">
        {[1,2,3,4,5].map(star => (
          <button key={star} onClick={() => setRating(star)} onMouseEnter={() => setHover(star)} onMouseLeave={() => setHover(0)} className="p-1 transition-transform hover:scale-110">
            <Star className={`w-6 h-6 ${star <= (hover || rating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'} transition-colors`} />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Tell us about your experience (optional)"
          maxLength={160}
          rows={2}
          className="w-full bg-white/[0.05] border border-white/[0.05] rounded-lg p-2.5 text-xs text-white placeholder-gray-500 resize-none focus:outline-none focus:border-[#fb57ff]/30 mb-3"
        />
      )}
      <div className="flex gap-2">
        <button onClick={() => setSkipped(true)} className="flex-1 py-2 rounded-lg text-xs font-semibold text-gray-500 bg-white/[0.02] hover:bg-white/[0.05] transition-all">
          Skip
        </button>
        <button
          onClick={async () => {
            if (!rating || !publicKey) return;
            setSubmitting(true);
            try {
              const res = await fetch("/api/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: publicKey.toString(), rating, comment }),
              });
              if (res.ok || res.status === 409) setSubmitted(true);
            } catch {}
            setSubmitting(false);
          }}
          disabled={!rating || submitting}
          className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: rating ? 'linear-gradient(45deg, black, #fb57ff)' : 'rgba(255,255,255,0.05)' }}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

function RewardLockSuccessModal({ isOpen, onClose, tokenSymbol, amount, duration, lockPageUrl, rewardTokenSymbol }: RewardLockSuccessModalProps) {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/[0.02] backdrop-blur border border-white/[0.05] rounded-2xl p-5 max-w-2xl w-full shadow-2xl" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
            <Gift className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Reward Lock Created!</h2>
            <p className="text-gray-400 text-sm">Your tokens are locked and rewards will auto-claim from the PDA</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div className="flex flex-col gap-3">
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Token</span>
                <span className="text-white font-semibold">{tokenSymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Amount</span>
                <span className="text-white font-semibold">{parseFloat(amount).toLocaleString()} {tokenSymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Duration</span>
                <span className="text-white font-semibold">{duration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Reward Token</span>
                <span className="font-semibold" style={{ color: '#fb57ff' }}>{rewardTokenSymbol}</span>
              </div>
            </div>
            <div className="border rounded-lg p-3" style={{ background: 'rgba(251, 87, 255, 0.05)', borderColor: 'rgba(251, 87, 255, 0.2)' }}>
              <p className="font-semibold mb-1 text-sm" style={{ color: '#fb57ff' }}>Claim rewards anytime</p>
              <p className="text-xs text-gray-300">Visit your lock page while connected to claim available {rewardTokenSymbol} rewards sent to your lock PDA.</p>
            </div>
            <div className="border rounded-lg p-3" style={{ background: 'rgba(251, 87, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.08)' }}>
              <p className="font-semibold mb-1 text-sm text-white">Share with your community</p>
              <p className="text-xs text-gray-400 mb-2">Let holders know you are locked and earning rewards alongside them.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href={lockPageUrl}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90 text-white"
              style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
            >
              <ExternalLink className="w-4 h-4" />
              View Lock & Claim Rewards
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${lockPageUrl}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-full py-2.5 rounded-xl font-semibold text-sm bg-white/[0.05] hover:bg-white/[0.08] transition-all text-white border border-white/[0.05]"
            >
              {copied ? "Copied!" : "Copy Lock Link"}
            </button>
            <a
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(`🔒 Just locked ${parseFloat(amount).toLocaleString()} $${tokenSymbol} and earning $${rewardTokenSymbol} rewards on @StakePointApp!\n\nVerify the lock:\n${window.location.origin}${lockPageUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all text-white border border-white/[0.05] bg-white/[0.05] hover:bg-white/[0.08]"
            >
              Share on X
            </a>
            <LockReviewPrompt onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CreateRewardLockModal({ isOpen, onClose, onSuccess }: CreateRewardLockModalProps) {
  const { publicKey, wallet, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  // Token state
  const [userTokens, setUserTokens] = useState<TokenInfo[]>([]);
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);

  // Reward token state
  const [rewardTokenType, setRewardTokenType] = useState<"sol" | "custom">("sol");
  const [customRewardMint, setCustomRewardMint] = useState("");
  const [extraRewardMint, setExtraRewardMint] = useState("");
  const [customRewardSymbol, setCustomRewardSymbol] = useState("");
  const [isFetchingRewardSymbol, setIsFetchingRewardSymbol] = useState(false);
  const [extraRewardSymbol, setExtraRewardSymbol] = useState("");
  const [isFetchingExtraSymbol, setIsFetchingExtraSymbol] = useState(false);

  // Lock params
  const [amount, setAmount] = useState("");
  const [selectedDuration, setSelectedDuration] = useState<number | "custom" | "">("");
  const [customDays, setCustomDays] = useState("");
  const [customUnlockLabel, setCustomUnlockLabel] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [calViewYear, setCalViewYear] = useState(new Date().getFullYear());
  const [calViewMonth, setCalViewMonth] = useState(new Date().getMonth());
  const [calSelectedDate, setCalSelectedDate] = useState<Date | null>(null);
  const [calHour, setCalHour] = useState(new Date().getHours());
  const [calMinute, setCalMinute] = useState(0);

  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [lockStep, setLockStep] = useState(0);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<{ tokenSymbol: string; amount: string; duration: string; lockPageUrl: string; rewardTokenSymbol: string } | null>(null);

  const rewardMint = rewardTokenType === "sol" ? NATIVE_SOL_MINT : customRewardMint;
  const rewardSymbol = rewardTokenType === "sol" ? "SOL" : (customRewardSymbol || "TOKEN");

  useEffect(() => {
    if (isOpen && publicKey) {
      fetchUserTokens();
    }
  }, [isOpen, publicKey]);

  useEffect(() => {
    if (selectedToken) {
      const updated = userTokens.find(t => t.mint === selectedToken.mint);
      if (updated && updated.name !== selectedToken.name) setSelectedToken(updated);
    }
  }, [userTokens]);

  // Fetch reward token symbol when custom CA is entered
  useEffect(() => {
    if (rewardTokenType !== "custom" || customRewardMint.length < 32) {
      setCustomRewardSymbol("");
      return;
    }
    const timeout = setTimeout(async () => {
      setIsFetchingRewardSymbol(true);
      try {
        const res = await fetch(`/api/birdeye?path=/defi/token_overview&address=${customRewardMint}`);
        const data = await res.json();
        if (data?.data?.symbol) {
          setCustomRewardSymbol(data.data.symbol);
        }
      } catch {}
      setIsFetchingRewardSymbol(false);
    }, 600);
    return () => clearTimeout(timeout);
  }, [customRewardMint, rewardTokenType]);

  // Fetch second reward token symbol when a CA is entered
  useEffect(() => {
    if (extraRewardMint.length < 32) {
      setExtraRewardSymbol("");
      return;
    }
    const timeout = setTimeout(async () => {
      setIsFetchingExtraSymbol(true);
      try {
        const res = await fetch(`/api/birdeye?path=/defi/token_overview&address=${extraRewardMint}`);
        const data = await res.json();
        if (data?.data?.symbol) {
          setExtraRewardSymbol(data.data.symbol);
        }
      } catch {}
      setIsFetchingExtraSymbol(false);
    }, 600);
    return () => clearTimeout(timeout);
  }, [extraRewardMint]);

  const fetchUserTokens = async () => {
    if (!publicKey) return;
    setIsLoadingTokens(true);
    setStatusMessage("Fetching your tokens...");
    try {
      let tokenAccounts: { value: any[] } = { value: [] };
      try {
        tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
      } catch {}

      let token2022Accounts: { value: any[] } = { value: [] };
      try {
        const raw = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "t2022", method: "getTokenAccountsByOwner", params: [publicKey.toString(), { programId: TOKEN_2022_PROGRAM_ID.toString() }, { encoding: "jsonParsed", commitment: "confirmed" }] })
        });
        const data = await raw.json();
        token2022Accounts.value = (data?.result?.value || []).filter((a: any) => typeof a?.account?.data?.program === 'string');
      } catch {}

      const allAccounts = [
        ...tokenAccounts.value.filter(a => typeof a?.account?.data?.program === 'string').map(a => ({ ...a, programIdKey: TOKEN_PROGRAM_ID.toString() })),
        ...token2022Accounts.value.filter(a => typeof a?.account?.data?.program === 'string').map(a => ({ ...a, programIdKey: TOKEN_2022_PROGRAM_ID.toString() })),
      ];

      const tokens: TokenInfo[] = [];
      for (const account of allAccounts) {
        try {
          const info = account.account.data.parsed.info;
          const balance = info.tokenAmount?.uiAmount || 0;
          if (balance <= 0) continue;
          const mint = info.mint;
          await new Promise(r => setTimeout(r, 1200));
          try {
            const bRes = await fetch(`/api/birdeye?path=/defi/token_overview&address=${mint}`);
            const bData = await bRes.json();
            const td = bData?.data;
            tokens.push({
              mint,
              balance,
              tokenAccount: account.pubkey.toString(),
              decimals: info.tokenAmount.decimals,
              symbol: td?.symbol || `${mint.slice(0,4)}...${mint.slice(-4)}`,
              name: td?.name || "Unknown Token",
              logoURI: td?.logoURI?.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid='),
              programId: account.programIdKey,
              price: td?.price,
              liquidity: td?.liquidity,
              marketCap: td?.mc,
            });
          } catch {
            tokens.push({ mint, balance, tokenAccount: account.pubkey.toString(), decimals: info.tokenAmount.decimals, symbol: `${mint.slice(0,4)}...${mint.slice(-4)}`, name: "Unknown Token", programId: account.programIdKey });
          }
        } catch {}
      }

      tokens.sort((a, b) => ((b.price || 0) * b.balance) - ((a.price || 0) * a.balance));
      setUserTokens(tokens);
      setStatusMessage("");
    } catch {
      setError("Failed to load your tokens");
    } finally {
      setIsLoadingTokens(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!publicKey || !wallet) { setError("Please connect your wallet first"); return; }
    if (!selectedToken) { setError("Please select a token"); return; }
    if (!amount || parseFloat(amount) <= 0) { setError("Please enter a valid amount"); return; }
    if (rewardTokenType === "custom" && customRewardMint.length < 32) { setError("Please enter a valid reward token mint address"); return; }
    if (extraRewardMint && extraRewardMint.length < 32) { setError("Please enter a valid second reward token address"); return; }
    if (extraRewardMint && extraRewardMint === rewardMint) { setError("Second reward token must differ from the first"); return; }
    if (extraRewardMint && extraRewardMint === NATIVE_SOL_MINT) { setError("SOL is not supported as a second reward token"); return; }

    let finalDuration: number;
    if (selectedDuration === "custom") {
      if (!customDays || parseInt(customDays) <= 0) { setError("Please select a valid unlock date"); return; }
      finalDuration = parseInt(customDays);
    } else if (typeof selectedDuration === "number") {
      finalDuration = selectedDuration;
    } else {
      setError("Please select a lock duration"); return;
    }

    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.02 * 1e9) {
      setError("Insufficient SOL, you need at least 0.02 SOL to cover transaction costs.");
      return;
    }

    const latestToken = userTokens.find(t => t.mint === selectedToken.mint);
    const resolvedToken = (latestToken && latestToken.name !== "Unknown Token") ? latestToken : selectedToken;

    setIsCreating(true);
    setStatusMessage("Preparing reward lock transaction...");

    try {
      // Find available pool slot
      setStatusMessage("Finding available pool slot...");
      const poolsResponse = await fetch(`/api/pools/by-token/${selectedToken.mint}`);
      const existingPools = poolsResponse.ok ? await poolsResponse.json() : [];

      const { getProgram: gp } = await import("@/lib/anchor-program");
      const { getPDAs: gpd } = await import("@/lib/anchor-program");
      const walletForCheck = wallet.adapter;
      const programCheck = gp(walletForCheck, connection);
      const tokenMintPubkeyCheck = new PublicKey(selectedToken.mint);

      let poolId = 1000;
      let poolExists = true;
      while (poolExists && poolId < 2000) {
        const [projectPDA] = gpd.project(tokenMintPubkeyCheck, poolId);
        let onChain = false;
        try { await programCheck.account.project.fetch(projectPDA); onChain = true; } catch {}
        const inDb = existingPools.some((p: any) => p.poolId === poolId);
        if (onChain || inDb) { poolId++; } else { poolExists = false; }
      }
      if (poolExists) throw new Error("Maximum pools reached for this token.");

      const usedPoolId = poolId;
      const PLATFORM_ADMIN = new PublicKey("2jL52MJkSQsnEMWfun1ca7fUx67WEFpuD5bN4rQwuEVw");

      if (!anchorWallet) throw new Error("Wallet not connected");
      const program = getProgram(anchorWallet, connection);
      const tokenMintPubkey = new PublicKey(selectedToken.mint);
      const rewardTokenMintPubkey = new PublicKey(rewardMint);

      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!mintInfo) throw new Error("Token mint not found");
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

      const [projectPDA] = getPDAs.project(tokenMintPubkey, usedPoolId);
      const [stakingVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, usedPoolId);
      const [rewardVaultPDA] = getPDAs.rewardVault(tokenMintPubkey, usedPoolId);
      const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);
      const [platformConfigPDA] = getPDAs.platformConfig();

      const platformConfig = await program.account.platform.fetch(platformConfigPDA, "confirmed");
      const feeCollector = platformConfig.feeCollector;

      // Use the exact account the user selected, since a wallet can hold the
      // same mint across several accounts and only one of them is the ATA
      const userTokenAccount = selectedToken.tokenAccount
        ? new PublicKey(selectedToken.tokenAccount)
        : await getAssociatedTokenAddress(tokenMintPubkey, publicKey, false, tokenProgramId);
      const feeCollectorTokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, feeCollector, false, tokenProgramId);

      // TX1: Create Project
      setStatusMessage("Creating reward lock pool (1 of 2)...");
      const createTx = new Transaction();
      createTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      createTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
      const createProjectIx = await program.methods
        .createProject(tokenMintPubkey, new BN(usedPoolId))
        .accounts({ project: projectPDA, stakingVault: stakingVaultPDA, rewardVault: rewardVaultPDA, tokenMint: tokenMintPubkey, admin: publicKey, systemProgram: SystemProgram.programId, tokenProgram: tokenProgramId, rent: SYSVAR_RENT_PUBKEY })
        .instruction();
      createTx.add(createProjectIx);
      const { blockhash: cb1 } = await connection.getLatestBlockhash();
      createTx.recentBlockhash = cb1;
      createTx.feePayer = publicKey;

      setLockStep(2);
      setIsConfirming(true);
      const createSig = await sendTransaction(createTx, connection, { skipPreflight: false });
      setIsConfirming(false);
      setLockStep(3);
      setIsBroadcasting(true);
      await confirmTransactionPolling(connection, createSig);
      setIsBroadcasting(false);

      setStatusMessage("Waiting for pool confirmation...");
      let pdaReady = false;
      for (let i = 0; i < 20; i++) {
        try {
          const projectData = await program.account.project.fetch(projectPDA, "confirmed");
          if (projectData && projectData.tokenMint.toString() === selectedToken.mint) {
            console.log(`✅ Project PDA fully deserialized after ${i + 1} attempts`);
            pdaReady = true;
            break;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!pdaReady) {
        throw new Error("Pool creation confirmed but account not yet readable. Please try again in a few seconds.");
      }

      // Determine reflection token accounts, mirrors CreatePoolModal exactly
      const isNativeSOL = rewardMint === NATIVE_SOL_MINT;
      const anchor = await import("@coral-xyz/anchor");
      let reflectionTokenMintAccount: PublicKey;
      let reflectionTokenAccountPDA: PublicKey;
      let reflectionTokenProgram: PublicKey;

      if (isNativeSOL) {
        reflectionTokenMintAccount = rewardTokenMintPubkey;
        reflectionTokenAccountPDA = projectPDA;
        reflectionTokenProgram = TOKEN_PROGRAM_ID;
      } else {
        const reflMintInfo = await connection.getAccountInfo(rewardTokenMintPubkey);
        if (!reflMintInfo) throw new Error("Reward token mint not found on-chain");
        reflectionTokenProgram = reflMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        reflectionTokenMintAccount = rewardTokenMintPubkey;
        reflectionTokenAccountPDA = await getAssociatedTokenAddress(
          rewardTokenMintPubkey,
          projectPDA,
          true,
          reflectionTokenProgram
        );
      }

      // TX2: Init + Stake + Transfer Admin
      setStatusMessage("Locking tokens with rewards enabled (2 of 2)...");
      const lockTx = new Transaction();
      lockTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
      lockTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));

      const feeCollectorInfo = await connection.getAccountInfo(feeCollectorTokenAccount);
      if (!feeCollectorInfo) {
        lockTx.add(createAssociatedTokenAccountInstruction(publicKey, feeCollectorTokenAccount, feeCollector, tokenMintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID));
      }

      const initPoolIx = await program.methods
        .initializePool(tokenMintPubkey, new BN(usedPoolId), {
          rateBpsPerYear: new BN(0),
          rateMode: 0,
          lockupSeconds: new BN(finalDuration),
          poolDurationSeconds: new BN(finalDuration),
          referrer: null,
          referrerSplitBps: null,
          enableReflections: true,
          reflectionToken: rewardTokenMintPubkey,
        })
        .accounts({
          project: projectPDA,
          stakingVault: stakingVaultPDA,
          admin: publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: tokenProgramId,
          reflectionTokenMint: reflectionTokenMintAccount,
          reflectionTokenAccount: reflectionTokenAccountPDA,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          reflectionTokenProgram: reflectionTokenProgram,
        })
        .instruction();
      lockTx.add(initPoolIx);

      const amountStr = /e/i.test(amount) ? parseFloat(amount).toFixed(selectedToken.decimals) : amount.trim();
      const [whole, frac = ""] = amountStr.split(".");
      const amountBN = new BN((whole || "0") + frac.slice(0, selectedToken.decimals).padEnd(selectedToken.decimals, "0"));

      const depositIx = await program.methods
        .deposit(tokenMintPubkey, new BN(usedPoolId), amountBN)
        .accountsPartial({
          platform: platformConfigPDA,
          project: projectPDA,
          stake: userStakePDA,
          stakingVault: stakingVaultPDA,
          userTokenAccount,
          feeCollectorTokenAccount,
          feeCollector,
          reflectionVault: reflectionTokenAccountPDA,
          tokenMintAccount: tokenMintPubkey,
          user: publicKey,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      lockTx.add(depositIx);

      // Register a second reward token if one was set. Verify-only, the vault
      // ATA is derived in-program and not created here.
      if (extraRewardMint) {
        const extraMintPubkey = new PublicKey(extraRewardMint);
        const [extraRewardPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("extra_reward"), projectPDA.toBuffer(), extraMintPubkey.toBuffer()],
          program.programId
        );

        const registerExtraIx = await program.methods
          .registerExtraReward(tokenMintPubkey, new BN(usedPoolId), publicKey)
          .accounts({
            project: projectPDA,
            extraReward: extraRewardPDA,
            extraMint: extraMintPubkey,
            admin: publicKey,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        lockTx.add(registerExtraIx);
      }

      // Close deposits so nobody else can deposit into this lock.
      // Must run after the deposit, since the deposit guard reads the flag
      // at the start of its own instruction.
      const setDepositPausedIx = await program.methods
        .setDepositPaused(tokenMintPubkey, new BN(usedPoolId), true)
        .accounts({ project: projectPDA, admin: publicKey })
        .instruction();
      lockTx.add(setDepositPausedIx);

      const transferAdminIx = await program.methods
        .transferAdmin(tokenMintPubkey, new BN(usedPoolId))
        .accounts({ project: projectPDA, admin: publicKey, newAdmin: PLATFORM_ADMIN })
        .instruction();
      lockTx.add(transferAdminIx);

      setStatusMessage("Verifying lock transaction...");
      let simPassed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { blockhash: simBlockhash } = await connection.getLatestBlockhash();
        lockTx.recentBlockhash = simBlockhash;
        lockTx.feePayer = publicKey;
        try {
          const simResult = await connection.simulateTransaction(lockTx);
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

      setStatusMessage("Locking tokens with rewards enabled (2 of 2)...");
      const { blockhash: cb2 } = await connection.getLatestBlockhash();
      lockTx.recentBlockhash = cb2;
      lockTx.feePayer = publicKey;

      setLockStep(4);
      setIsConfirming(true);
      setStatusMessage("Please approve the lock transaction...");
      const lockTxSig = await sendTransaction(lockTx, connection, { skipPreflight: false });
      setIsConfirming(false);
      setLockStep(5);
      setIsBroadcasting(true);
      await confirmTransactionPolling(connection, lockTxSig);
      setIsBroadcasting(false);

      setStatusMessage("Saving reward lock details...");
      const lockId = Date.now();

      const response = await fetch("/api/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockId,
          tokenMint: selectedToken.mint,
          name: resolvedToken.name || resolvedToken.symbol,
          symbol: resolvedToken.symbol || "UNKNOWN",
          amount: parseFloat(amount),
          lockDuration: Math.min(finalDuration, 2147483647),
          creatorWallet: publicKey.toString(),
          poolAddress: projectPDA.toString(),
          stakePda: userStakePDA.toString(),
          poolId: usedPoolId,
          logo: resolvedToken.logoURI || null,
          isLpToken: resolvedToken.isLpToken || false,
          lpPoolId: resolvedToken.lpPoolId || null,
          rewardTokenMint: rewardMint,
          rewardTokenSymbol: rewardSymbol,
          extraRewardMint: extraRewardMint || null,
          extraRewardSymbol: extraRewardMint ? (extraRewardSymbol || "TOKEN") : null,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error("Failed to save reward lock:", errData);
        setError("Lock created on-chain but failed to save. Please contact support with your wallet address.");
        setIsCreating(false);
        setLockStep(0);
        return;
      }

      const savedLock = await response.json();
      setStatusMessage("Reward lock created successfully!");

      setSelectedToken(null);
      setAmount("");
      setCustomDays("");
      setSelectedDuration("");
      setCustomRewardMint("");
      setCustomRewardSymbol("");
      setRewardTokenType("sol");

      const durationLabel = selectedDuration === "custom"
        ? (customUnlockLabel ? `Until ${customUnlockLabel}` : `${Math.round(finalDuration / 86400)} days`)
        : lockDurationOptions.find(o => o.value === selectedDuration)?.label || `${Math.round(finalDuration / 86400)} days`;

      setSuccessData({
        tokenSymbol: selectedToken.symbol || "tokens",
        amount,
        duration: durationLabel,
        lockPageUrl: savedLock ? `/locks/${savedLock.id}` : `/locks`,
        rewardTokenSymbol: rewardSymbol,
      });
      setShowSuccessModal(true);
      onSuccess();
    } catch (err: any) {
      console.error("Reward lock error:", err);
      const anchorErrorMap: Record<number, string> = {
        6000: "Unauthorized", 6001: "Invalid amount", 6002: "Insufficient token balance",
        6007: "Tokens still locked", 6018: "Insufficient SOL, ensure at least 0.02 SOL in wallet.",
        6013: "Already initialized", 6014: "Pool not initialized",
      };
      const errStr = String(err?.message ?? err);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16) : jsonMatch ? parseInt(jsonMatch[1]) : anchorMatch ? parseInt(anchorMatch[1]) : fallbackMatch ? parseInt(fallbackMatch[1]) : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;
      let errorMessage = anchorError || "Failed to create reward lock";
      if (!anchorError && errStr.includes("User rejected")) errorMessage = "Transaction cancelled.";
      else if (!anchorError && errStr.includes("insufficient")) errorMessage = "Insufficient SOL balance.";
      else if (!anchorError && err.message) errorMessage = err.message;
      setError(errorMessage);
      setIsConfirming(false);
      setIsBroadcasting(false);
    } finally {
      setIsCreating(false);
      setIsConfirming(false);
      setIsBroadcasting(false);
      setLockStep(0);
      setTimeout(() => setStatusMessage(""), 2000);
    }
  };

  if (!isOpen) return null;

  const filteredTokens = userTokens.filter(t => {
    if (!tokenSearchQuery) return true;
    const q = tokenSearchQuery.toLowerCase();
    return t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q);
  });

  const lockDurationOptions = [
    { label: "1 Day", value: 86400 },
    { label: "7 Days", value: 604800 },
    { label: "30 Days", value: 2592000 },
    { label: "90 Days", value: 7776000 },
    { label: "180 Days", value: 15552000 },
    { label: "365 Days", value: 31536000 },
    { label: "Forever", value: 2147483647 },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3">
      <div className="bg-black/95 rounded-2xl w-full max-w-lg flex flex-col border border-white/[0.08]" style={{ maxHeight: '96vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2" style={{ background: 'linear-gradient(45deg, white, #fb57ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            <Gift className="w-4 h-4 flex-shrink-0" style={{ color: '#fb57ff' }} />
            Create Reward Lock
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications */}
        {(statusMessage || error) && (
          <div className="px-4 pt-3 flex-shrink-0 space-y-2">
            {error && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-200 flex-1">{error}</p>
                <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 flex-shrink-0"><X className="w-3 h-3" /></button>
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          <form onSubmit={handleSubmit} className="space-y-3">

            {/* Token Loading Overlay */}
            {isLoadingTokens && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
                <div className="relative bg-[#0a0a0f] border border-white/[0.08] rounded-2xl p-8 max-w-xs w-full text-center shadow-2xl">
                  <div className="flex justify-center mb-4">
                    <div className="relative w-16 h-16">
                      <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                      <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Search className="w-6 h-6" style={{ color: '#fb57ff' }} />
                      </div>
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">Scanning Wallet</h3>
                  <p className="text-sm text-gray-400 mb-4">{statusMessage || "Fetching your tokens..."}</p>
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Info */}
            <div className="p-2.5 bg-white/[0.02] border border-white/[0.1] rounded-lg">
              <p className="text-gray-400 text-xs flex items-center gap-1.5">
                <Gift className="w-3 h-3 flex-shrink-0" style={{ color: '#fb57ff' }} />
                Lock tokens and claim rewards auto-sent to your lock PDA, such as revshare or fee distributions.
              </p>
            </div>

            {/* 2 Transaction Warning */}
            <div className="p-3 bg-[#00d4ff]/10 border-2 border-[#00d4ff]/50 rounded-lg ring-2 ring-[#00d4ff]/20 ring-offset-2 ring-offset-black animate-pulse">
              <p className="text-[#00d4ff] text-xs font-semibold mb-1 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                2 wallet approvals required
              </p>
              <p className="text-[#00d4ff]/70 text-xs leading-relaxed">
                Requires <strong>two separate wallet confirmations</strong>. Do not close the browser between approvals. Ensure at least <strong>0.02 SOL</strong> in wallet.
              </p>
            </div>

            {/* Token Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Select Token to Lock *</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTokenSelector(!showTokenSelector)}
                  disabled={isLoadingTokens}
                  className="w-full p-2.5 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white focus:outline-none transition-colors flex items-center justify-between hover:border-[#fb57ff]/50 text-sm"
                >
                  {selectedToken ? (
                    <div className="flex items-center gap-2">
                      {selectedToken.logoURI ? <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-5 h-5 rounded-full" /> : <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#fb57ff] to-purple-600" />}
                      <div className="text-left">
                        <p className="font-semibold text-sm">{selectedToken.symbol}</p>
                        <p className="text-xs text-gray-400">Balance: {selectedToken.balance.toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-400 text-sm">{isLoadingTokens ? "Loading tokens..." : "Choose a token"}</span>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showTokenSelector ? "rotate-180" : ""}`} />
                </button>

                {showTokenSelector && !isLoadingTokens && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-black border border-white/[0.1] rounded-lg shadow-xl z-20 max-h-72 overflow-hidden">
                    <div className="p-2 border-b border-white/[0.1]">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input type="text" value={tokenSearchQuery} onChange={e => setTokenSearchQuery(e.target.value)} placeholder="Search tokens..." className="w-full pl-8 pr-3 py-1.5 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-xs focus:outline-none focus:border-[#fb57ff]/50" />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredTokens.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-xs">No tokens found</div>
                      ) : filteredTokens.map(token => (
                        <button key={token.mint} type="button" onClick={() => { setSelectedToken(token); setShowTokenSelector(false); setTokenSearchQuery(""); }} className="w-full p-2.5 flex items-center gap-2.5 hover:bg-white/[0.05] transition-colors border-b border-white/[0.05] text-left">
                          {token.logoURI ? <img src={token.logoURI} alt={token.symbol} className="w-7 h-7 rounded-full" /> : <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#fb57ff] to-purple-600" />}
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-white text-xs">{token.symbol}</p>
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: token.programId?.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? 'rgba(96,165,250,0.1)' : 'rgba(251,87,255,0.1)', color: token.programId?.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? '#60a5fa' : '#fb57ff' }}>
                                {token.programId?.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? "SPL" : "2022"}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400">{token.name}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-white">{token.balance.toLocaleString()}</p>
                            {token.price && <p className="text-xs text-gray-400">${(token.balance * token.price).toFixed(2)}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Amount to Lock *</label>
              <div className="relative">
                <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-sm focus:outline-none focus:border-[#fb57ff]/50 transition-colors" required />
                {selectedToken && selectedToken.balance > 0 && (
                  <button type="button" onClick={async () => { try { const mintPk = new PublicKey(selectedToken.mint); const mintInfo = await connection.getAccountInfo(mintPk); const prog = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID; const ata = await getAssociatedTokenAddress(mintPk, publicKey!, false, prog); const bal = await connection.getTokenAccountBalance(ata); setAmount(bal.value.uiAmountString || String(Math.floor(selectedToken.balance))); } catch { setAmount(String(Math.floor(selectedToken.balance))); } }} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#fb57ff] hover:underline">MAX</button>
                )}
              </div>
              {selectedToken && <p className="text-xs text-gray-400 mt-1">Available: {selectedToken.balance.toLocaleString()} {selectedToken.symbol}</p>}
            </div>

            {/* Reward Token Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Reward Token *</label>
              <p className="text-xs text-gray-500 mb-2">Select the token your project auto-sends to holders (e.g. SOL revshare, USDC fees)</p>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => { setRewardTokenType("sol"); setCustomRewardMint(""); setCustomRewardSymbol(""); }}
                  className={`p-3 rounded-lg border transition-all text-left ${rewardTokenType === "sol" ? "border-[#fb57ff] bg-[#fb57ff]/10" : "border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.05]"}`}
                >
                  <p className="text-xs font-semibold text-white">SOL (Lamports)</p>
                  <p className="text-xs text-gray-400 mt-0.5">Native SOL rewards</p>
                </button>
                <button
                  type="button"
                  onClick={() => setRewardTokenType("custom")}
                  className={`p-3 rounded-lg border transition-all text-left ${rewardTokenType === "custom" ? "border-[#fb57ff] bg-[#fb57ff]/10" : "border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.05]"}`}
                >
                  <p className="text-xs font-semibold text-white">Custom Token</p>
                  <p className="text-xs text-gray-400 mt-0.5">SPL or Token-2022</p>
                </button>
              </div>
              {rewardTokenType === "custom" && (
                <div>
                  <div className="relative">
                    <input
                      type="text"
                      value={customRewardMint}
                      onChange={e => setCustomRewardMint(e.target.value.trim())}
                      placeholder="Enter reward token contract address"
                      className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-xs font-mono focus:outline-none focus:border-[#fb57ff]/50 transition-colors"
                    />
                    {isFetchingRewardSymbol && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-gray-400" />}
                  </div>
                  {customRewardSymbol && (
                    <p className="text-xs mt-1" style={{ color: '#fb57ff' }}>Detected: {customRewardSymbol}</p>
                  )}
                </div>
              )}
              {rewardTokenType === "sol" && (
                <p className="text-xs text-gray-500">SOL lamports auto-sent to your lock PDA will be claimable on your lock page.</p>
              )}

              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-400 mb-1">Second Reward Token (optional)</label>
                <div className="relative">
                  <input
                    type="text"
                    value={extraRewardMint}
                    onChange={e => setExtraRewardMint(e.target.value.trim())}
                    placeholder="Contract address, leave blank if not needed"
                    className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-xs font-mono focus:outline-none focus:border-[#fb57ff]/50 transition-colors"
                  />
                  {isFetchingExtraSymbol && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-gray-400" />}
                </div>
                {extraRewardSymbol && (
                  <p className="text-xs mt-1" style={{ color: '#fb57ff' }}>Detected: {extraRewardSymbol}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Use this if your project pays rewards in more than one token. Cannot be added after the lock is created.
                </p>
              </div>
            </div>

            {/* Lock Duration */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-400 mb-1">Lock Duration *</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {lockDurationOptions.map(option => (
                  <button key={option.value} type="button" onClick={() => { setSelectedDuration(option.value); setShowCalendar(false); }}
                    className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${selectedDuration === option.value ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white" : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"}`}>
                    {option.label}
                  </button>
                ))}
                <button type="button" onClick={() => { setSelectedDuration("custom"); setShowCalendar(prev => !prev); }}
                  className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${selectedDuration === "custom" ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white" : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"}`}>
                  Custom
                </button>
              </div>
              {selectedDuration === "custom" && customUnlockLabel && !showCalendar && (
                <p className="text-xs text-[#fb57ff] mt-1.5 truncate">Until {customUnlockLabel}</p>
              )}

              {showCalendar && (() => {
                const now = new Date();
                const minUnlock = new Date(now.getTime() + 60 * 60 * 1000);
                const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
                const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
                const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
                let unlockPreview = "";
                let previewValid = false;
                let diffSecs = 0;
                if (calSelectedDate) {
                  const unlock = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate(), calHour, calMinute, 0);
                  if (unlock > minUnlock) {
                    diffSecs = Math.floor((unlock.getTime() - now.getTime()) / 1000);
                    const diffDays = Math.floor(diffSecs / 86400);
                    const diffHrs = Math.floor((diffSecs % 86400) / 3600);
                    unlockPreview = `Unlocks ${calSelectedDate.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')} (${diffDays}d ${diffHrs}h)`;
                    previewValid = true;
                  } else { unlockPreview = "Must be at least 1 hour from now"; }
                } else { unlockPreview = "Select a date above"; }

                return (
                  <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCalendar(false)} />
                    <div className="relative bg-[#0d0d0d] border border-white/[0.12] rounded-xl p-4 w-full max-w-xs shadow-2xl">
                      <div className="flex items-center justify-between mb-3">
                        <button type="button" onClick={() => { let m = calViewMonth - 1; let y = calViewYear; if (m < 0) { m = 11; y--; } setCalViewMonth(m); setCalViewYear(y); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-[#fb57ff] transition-colors">‹</button>
                        <span className="text-sm font-medium text-white">{MONTHS[calViewMonth]} {calViewYear}</span>
                        <button type="button" onClick={() => { let m = calViewMonth + 1; let y = calViewYear; if (m > 11) { m = 0; y++; } setCalViewMonth(m); setCalViewYear(y); }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-[#fb57ff] transition-colors">›</button>
                      </div>
                      <div className="grid grid-cols-7 gap-1 mb-1">
                        {DAYS.map(d => <div key={d} className="text-center text-[10px] text-gray-600 font-medium py-1">{d}</div>)}
                      </div>
                      <div className="grid grid-cols-7 gap-1 mb-3">
                        {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                          const dayEnd = new Date(calViewYear, calViewMonth, d, 23, 59, 0);
                          const isToday = calViewYear === now.getFullYear() && calViewMonth === now.getMonth() && d === now.getDate();
                          const isPast = dayEnd < minUnlock && !isToday;
                          const isSel = calSelectedDate && calSelectedDate.getFullYear() === calViewYear && calSelectedDate.getMonth() === calViewMonth && calSelectedDate.getDate() === d;
                          return (
                            <button key={d} type="button" disabled={isPast} onClick={() => setCalSelectedDate(new Date(calViewYear, calViewMonth, d))}
                              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${isSel ? "bg-[#fb57ff]/25 border border-[#fb57ff]/60 text-white" : isPast ? "text-gray-700 cursor-not-allowed" : isToday ? "text-[#fb57ff] hover:bg-[#fb57ff]/10" : "text-gray-300 hover:bg-[#fb57ff]/10 hover:text-[#fb57ff]"}`}>
                              {d}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2 pb-3 border-b border-white/[0.07]">
                        <span className="text-xs text-gray-500 w-8">Time</span>
                        <select value={calHour} onChange={e => setCalHour(parseInt(e.target.value))} className="flex-1 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,'0')}</option>)}
                        </select>
                        <span className="text-gray-600 text-sm">:</span>
                        <select value={calMinute} onChange={e => setCalMinute(parseInt(e.target.value))} className="flex-1 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none" style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
                        </select>
                      </div>
                      <p className={`text-xs text-center mt-2 mb-3 ${previewValid ? "text-[#fb57ff]" : "text-gray-600"}`}>{unlockPreview}</p>
                      <button type="button" disabled={!previewValid} onClick={() => {
                        if (!previewValid) return;
                        const unlock = new Date(calSelectedDate!.getFullYear(), calSelectedDate!.getMonth(), calSelectedDate!.getDate(), calHour, calMinute, 0);
                        const secs = Math.floor((unlock.getTime() - new Date().getTime()) / 1000);
                        const label = `${calSelectedDate!.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')}`;
                        setCustomDays(String(secs));
                        setCustomUnlockLabel(label);
                        setShowCalendar(false);
                      }} className="w-full py-2.5 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40" style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}>
                        Set unlock date
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Info */}
            <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/30 rounded-lg">
              <p className="text-xs" style={{ color: '#fb57ff' }}>Rewards auto-sent to your lock PDA by the token contract are claimable from your lock page anytime during the lock period.</p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} disabled={isCreating} className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isCreating || !publicKey || !selectedToken || (rewardTokenType === "custom" && customRewardMint.length < 32)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}>
                {isCreating ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : "Create Reward Lock"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Confirming overlay */}
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
                  <Gift className="w-7 h-7" style={{ color: '#fb57ff' }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-20 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${lockStep >= 4 ? 'w-full' : lockStep >= 3 ? 'w-full' : 'w-1/2'}`} style={{ background: '#fb57ff' }} />
              </div>
              <div className="w-20 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${lockStep >= 5 ? 'w-full' : lockStep >= 4 ? 'w-1/2' : 'w-0'}`} style={{ background: '#fb57ff' }} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2 font-medium">{lockStep <= 3 ? "Transaction 1 of 2" : "Transaction 2 of 2"}</p>
            <h3 className="text-xl font-bold text-white mb-2">{isConfirming ? "Confirm in Wallet" : lockStep === 3 ? "Confirming on chain..." : lockStep === 5 ? "Confirming lock..." : "Broadcasting..."}</h3>
            <p className="text-gray-400 text-sm mb-4">{isConfirming ? "Please approve the transaction in your wallet" : "Broadcasting to the Solana blockchain"}</p>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
              <p className="text-xs text-yellow-400 font-semibold mb-1">Do not close this window</p>
              <p className="text-xs text-gray-500">Reward lock creation requires 2 transactions. Stay on this page.</p>
            </div>
            <div className="flex justify-center gap-1">
              {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />)}
            </div>
          </div>
        </div>
      )}

      {successData && (
        <RewardLockSuccessModal
          isOpen={showSuccessModal}
          onClose={() => {
            const url = successData.lockPageUrl;
            setShowSuccessModal(false);
            setSuccessData(null);
            onClose();
            window.location.href = url;
          }}
          tokenSymbol={successData.tokenSymbol}
          amount={successData.amount}
          duration={successData.duration}
          lockPageUrl={successData.lockPageUrl}
          rewardTokenSymbol={successData.rewardTokenSymbol}
        />
      )}
    </div>
  );
}