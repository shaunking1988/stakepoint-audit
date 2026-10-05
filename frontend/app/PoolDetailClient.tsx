"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from '@solana/wallet-adapter-react';
import SafetyBadge from "@/components/SafetyBadge";
import {
  ArrowLeft,
  Lock,
  Unlock,
  Coins,
  Clock,
  TrendingUp,
  Share2,
  ExternalLink,
  Sparkles,
  Loader2,
  Code,
  Copy,
  AlertCircle,
  CheckCircle2,
  Star,
  Shield,
  User,
  Zap,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useStakingProgram } from "@/hooks/useStakingProgram";
import { useSolanaBalance } from "@/hooks/useSolanaBalance";
import { usePoolData } from "@/hooks/usePoolData";
import { useToast } from "@/components/ToastContainer";
import { useRealtimeRewards, formatRewards } from "@/utils/calculatePendingRewards";
import IntegrateModal from "@/components/IntegrateModal";
import QuickBuyPanel from "@/components/QuickBuyPanel";
import TokenChart from "@/components/TokenChart";
import { useSound } from '@/hooks/useSound';

function toTokenAmount(amount: number, decimals: number): string {
  const amountStr = amount.toString();
  const [whole, fraction = ''] = amountStr.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + paddedFraction;
  return combined.replace(/^0+/, '') || '0';
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeTwitterUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return safeUrl(trimmed);
  const handle = trimmed.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  return handle ? `https://x.com/${handle}` : null;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative rounded-xl ${className}`}
      style={{ background: 'linear-gradient(160deg, rgba(251,87,255,0.04) 0%, rgba(0,0,0,0.25) 100%)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #9b00b0, #fb57ff)' }} />
      {children}
    </div>
  );
}

interface Pool {
  id: string;
  name: string;
  symbol: string;
  tokenAddress: string;
  tokenMint: string;
  logo: string | null;
  apy: number;
  rateBpsPerYear: number;
  rateMode: number;
  lockPeriodDays: number | null;
  duration: number;
  totalStaked: number | null;
  expectedRewards: number | null;
  isPaused: boolean;
  poolId: number | null;
  reflectionEnabled: boolean;
  reflectionType: string | null;
  reflectionMint: string | null;
  reflectionTokenSymbol: string | null;
  isInitialized: boolean;
  createdAt: Date;
  creatorWallet: string | null;
  verified?: boolean;
  safetyScore?: number | null;
  safetyDetails?: string | null;
  engine?: string;
  rewardTokenMint?: string | null;
  rewardTokenSymbol?: string | null;
  lpUrl?: string | null;
  isLPPool?: boolean;
  description?: string | null;
  website?: string | null;
  twitter?: string | null;
}

interface PoolDetailClientProps {
  pool: Pool;
}

export default function PoolDetailClient({ pool }: PoolDetailClientProps) {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { showToast } = useToast();
  const { playSound } = useSound();
  const [copied, setCopied] = useState<string | null>(null);
  const [showIntegrateModal, setShowIntegrateModal] = useState(false);
  const [shareTooltip, setShareTooltip] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'page_view', { page_title: 'Pool Detail', pool_symbol: pool.symbol, pool_id: pool.id });
    }
  }, []);

  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const decimalsMultiplier = useMemo(() => Math.pow(10, tokenDecimals ?? 9), [tokenDecimals]);
  const effectiveMintAddress = pool.tokenAddress;
  const { balance: tokenBalance, loading: balanceLoading, refetch: refetchTokenBalance } = useSolanaBalance(effectiveMintAddress);

  const { loadAllPoolData, loadPoolsData, getPoolProject, isPoolDataLoading, getDecimals, getPrice, getSolBalance, getUserTokenBalance, getUserStake: getCachedUserStake } = usePoolData();

  const platformFeePercent = 2;
  const flatSolFee = 0.012;
  const isInitialized = pool.isInitialized;
  const isPaused = pool.isPaused || false;
  const poolId = pool.poolId ?? 0;
  const engine = pool.engine || 'legacy';
  const isLPPool = pool.isLPPool ?? false;

  useEffect(() => {
    if (effectiveMintAddress && poolId !== undefined) {
      loadAllPoolData([{ tokenMint: effectiveMintAddress, poolId, engine }]);
      const mintsToLoad = [effectiveMintAddress];
      if (pool.rewardTokenMint) mintsToLoad.push(pool.rewardTokenMint);
      loadPoolsData(mintsToLoad);
    }
  }, [effectiveMintAddress, poolId, loadAllPoolData, loadPoolsData]);

  useEffect(() => {
    if (!effectiveMintAddress) return;
    const decimals = getDecimals(effectiveMintAddress);
    if (decimals !== null) setTokenDecimals(decimals);
  }, [effectiveMintAddress, getDecimals]);

  const {
    stake: blockchainStake,
    unstake: blockchainUnstake,
    claimRewards: blockchainClaimRewards,
    claimReflections: blockchainClaimReflections,
    refreshReflections,
    getUserStake,
    getPoolRate,
    getProjectInfo,
    waitForConfirmation,
  } = useStakingProgram();

  const [openModal, setOpenModal] = useState<"stake" | "unstake" | "claimRewards" | "claimReflections" | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const [userStakedAmount, setUserStakedAmount] = useState<number>(0);
  const [userStakeTimestamp, setUserStakeTimestamp] = useState<number>(0);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [dynamicRate, setDynamicRate] = useState<number | null>(null);
  const [projectData, setProjectData] = useState<any>(null);
  const [stakeData, setStakeData] = useState<any>(null);
  const [reflectionBalance, setReflectionBalance] = useState<number>(0);
  const [reflectionLoading, setReflectionLoading] = useState(false);
  const [onChainTotalStaked, setOnChainTotalStaked] = useState<number>(0);
  const [isLoadingAPR, setIsLoadingAPR] = useState(true);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lowAprDismissed, setLowAprDismissed] = useState(false);
  const [reflectionClaimStep, setReflectionClaimStep] = useState<"idle" | "refreshing" | "claiming" | "success">("idle");
  const [successModalType, setSuccessModalType] = useState<"stake" | "unstake" | "claim">("stake");
  const [lastActionAmount, setLastActionAmount] = useState(0);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState("");

  const blockchainProject = getPoolProject(effectiveMintAddress, poolId);
  const blockchainPoolEndTime = blockchainProject?.poolEndTime?.toNumber?.() || blockchainProject?.poolEndTime || null;
  const poolHasEnded = blockchainPoolEndTime ? blockchainPoolEndTime < Math.floor(Date.now() / 1000) : false;

  const feeCalculation = useMemo(() => {
    if (!amount || amount <= 0) return { tokenFee: 0, solFee: flatSolFee, amountAfterFee: 0 };
    const tokenFee = (amount * platformFeePercent) / 100;
    return { tokenFee, solFee: flatSolFee, amountAfterFee: amount - tokenFee };
  }, [amount]);

  const displayAPR = useMemo(() => {
    if (poolHasEnded) return 0;
    if (!blockchainProject) return dynamicRate ?? pool.apy ?? 0;
    if (blockchainProject.rateMode === 0) {
      return blockchainProject.rateBpsPerYear?.toNumber?.()
        ? blockchainProject.rateBpsPerYear.toNumber() / 100
        : (blockchainProject.rateBpsPerYear || 0) / 100;
    } else {
      const hasDifferentReward = pool.rewardTokenMint && pool.rewardTokenMint !== pool.tokenMint;
      if (!hasDifferentReward) {
        const rewardRatePerSecond = BigInt(blockchainProject.rewardRatePerSecond?.toString() || '0');
        const totalStaked = BigInt(blockchainProject.totalStaked?.toString() || '1');
        if (totalStaked > 0n && rewardRatePerSecond > 0n) {
          const annualRewards = rewardRatePerSecond * BigInt(31_536_000);
          return Number((annualRewards * 10000n) / totalStaked) / 100;
        }
      }
    }
    return dynamicRate ?? pool.apy ?? 0;
  }, [blockchainProject, dynamicRate, pool.apy, poolHasEnded, pool.rewardTokenMint, pool.tokenMint]);

      // LP price fetch + USD APR for farms
  const [lpPrice, setLpPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!isLPPool || !pool.lpUrl) return;
    const fetchLpPrice = async () => {
      try {
        const poolIdMatch = pool.lpUrl!.match(/pool_id=([A-Za-z0-9]+)/);
        const pairMatch = pool.lpUrl!.match(/pair\/([A-Za-z0-9]+)/);
        const dexPoolId = poolIdMatch?.[1] || pairMatch?.[1];
        if (!dexPoolId) return;
        const res = await fetch(`/api/lp-price?poolId=${dexPoolId}`);
        const data = await res.json();
        if (data?.price > 0) setLpPrice(data.price);
      } catch {}
    };
    fetchLpPrice();
  }, [isLPPool, pool.lpUrl]);

  useEffect(() => {
    const hasDifferentReward = pool.rewardTokenMint && pool.rewardTokenMint !== pool.tokenMint;
    if (!hasDifferentReward || !blockchainProject) return;
    const stakedPrice = isLPPool ? lpPrice : getPrice(effectiveMintAddress).price;
    if (!stakedPrice) return;
    const rewardRatePerSecond = BigInt(blockchainProject.rewardRatePerSecond?.toString() || '0');
    const totalStaked = BigInt(blockchainProject.totalStaked?.toString() || '0');
    if (totalStaked === 0n || rewardRatePerSecond === 0n) return;
    const rewardDecimals = blockchainProject.rewardTokenDecimals ?? 9;
    const annualRewardTokens = Number(rewardRatePerSecond * BigInt(31_536_000)) / Math.pow(10, rewardDecimals);
    const totalStakedTokens = Number(totalStaked) / Math.pow(10, tokenDecimals ?? 9);
    const rewardMint = pool.rewardTokenMint || blockchainProject.rewardTokenMint?.toString();
    const rewardPrice = rewardMint ? getPrice(rewardMint).price : null;
    if (rewardPrice && totalStakedTokens > 0) {
      const usdApr = (annualRewardTokens * rewardPrice) / (totalStakedTokens * stakedPrice) * 100;
      setDynamicRate(usdApr);
    }
  }, [isLPPool, blockchainProject, lpPrice, tokenDecimals, pool.rewardTokenMint, pool.tokenMint, getPrice, effectiveMintAddress]);

  const displayLockPeriod = useMemo(() => {
    if (blockchainProject?.lockupSeconds) {
      const days = Math.floor(blockchainProject.lockupSeconds.toNumber?.()
        ? blockchainProject.lockupSeconds.toNumber() / 86400
        : blockchainProject.lockupSeconds / 86400);
      return days > 0 ? days : null;
    }
    return pool.lockPeriodDays;
  }, [blockchainProject, pool.lockPeriodDays]);

  const displayDuration = useMemo(() => {
    if (blockchainProject?.poolDurationSeconds) {
      const seconds = blockchainProject.poolDurationSeconds.toNumber?.()
        ? blockchainProject.poolDurationSeconds.toNumber()
        : blockchainProject.poolDurationSeconds;
      return Math.floor(seconds / 86400);
    }
    return pool.duration;
  }, [blockchainProject, pool.duration]);

  const displayTotalStaked = useMemo(() => {
    if (tokenDecimals === null) return null;
    if (blockchainProject?.totalStaked) {
      return parseFloat(blockchainProject.totalStaked.toString()) / Math.pow(10, tokenDecimals);
    }
    return onChainTotalStaked || pool.totalStaked || 0;
  }, [blockchainProject, onChainTotalStaked, pool.totalStaked, tokenDecimals]);

  const rewardDecimals = pool.rewardTokenMint && pool.rewardTokenMint !== pool.tokenMint
    ? (blockchainProject?.rewardTokenDecimals ?? getDecimals(pool.rewardTokenMint) ?? 9)
    : (tokenDecimals ?? 9);
  const realtimeRewards = useRealtimeRewards(projectData, stakeData, rewardDecimals);

  useEffect(() => {
    if (!connected || !publicKey || !effectiveMintAddress) {
      setUserStakedAmount(0); setUserStakeTimestamp(0); setStakeData(null); return;
    }
    const cachedStake = getCachedUserStake(effectiveMintAddress, poolId);
    if (cachedStake) {
      setUserStakedAmount(parseFloat(cachedStake.amount?.toString() || '0') / Math.pow(10, tokenDecimals ?? 9));
      setUserStakeTimestamp(cachedStake.lastStakeTimestamp?.toNumber?.() || 0);
      setStakeData(cachedStake);
    } else {
      setUserStakedAmount(0); setUserStakeTimestamp(0); setStakeData(null);
    }
  }, [connected, publicKey, effectiveMintAddress, poolId, tokenDecimals, getCachedUserStake, isPoolDataLoading]);

  useEffect(() => {
    if (!connected) return;
    setSolBalance(getSolBalance());
  }, [connected, getSolBalance]);

  useEffect(() => {
    if (!effectiveMintAddress || !isInitialized) { setIsLoadingAPR(false); return; }
    const fetchProjectData = async () => {
      try {
        const project = getPoolProject(effectiveMintAddress, poolId);
        if (project) {
          setProjectData(project);
          if (project.totalStaked) setOnChainTotalStaked(Number(project.totalStaked) / decimalsMultiplier);
        }
        if (engine === 'legacy') {
          if (project?.rateMode === 0 && project.rateBpsPerYear) {
            setDynamicRate(project.rateBpsPerYear.toNumber() / 100);
          } else {
            const rateData = await getPoolRate(effectiveMintAddress, poolId, engine);
            if (rateData?.rate !== null && rateData?.rate !== undefined) setDynamicRate(rateData.rate);
          }
        }
        setIsLoadingAPR(false);
      } catch { setIsLoadingAPR(false); }
    };
    fetchProjectData();
    const interval = setInterval(fetchProjectData, 120000);
    return () => clearInterval(interval);
  }, [effectiveMintAddress, poolId, isInitialized, tokenDecimals, isPoolDataLoading]);

  const fetchReflectionBalance = async () => {
    if (!publicKey || !connected || !effectiveMintAddress || !pool.reflectionEnabled || !isInitialized) return;
    setReflectionLoading(true);
    try {
      const balance = await refreshReflections(effectiveMintAddress, poolId);
      if (balance !== null) setReflectionBalance(balance / decimalsMultiplier);
    } catch {}
    finally { setReflectionLoading(false); }
  };

  useEffect(() => {
    if (stakeData && pool.reflectionEnabled) {
      const pending = stakeData.reflectionsPending?.toNumber?.() ?? Number(stakeData.reflectionsPending || 0);
      if (pending > 0) setReflectionBalance(pending / decimalsMultiplier);
    }
  }, [stakeData, pool.reflectionEnabled, decimalsMultiplier]);

  const lockupInfo = useMemo(() => {
    if (!displayLockPeriod || !userStakeTimestamp) return { isLocked: false, remainingTime: 0, lockEndDate: null };
    const lockEndDate = new Date((userStakeTimestamp + displayLockPeriod * 86400) * 1000);
    const remainingTime = Math.max(0, lockEndDate.getTime() - Date.now());
    return { isLocked: remainingTime > 0, remainingTime, lockEndDate };
  }, [displayLockPeriod, userStakeTimestamp]);

  const formatLockPeriod = (days: number | null) => {
    if (!days) return "Flexible";
    if (days >= 365) return `${Math.floor(days / 365)}yr`;
    if (days >= 30) return `${Math.floor(days / 30)}mo`;
    return `${days}d`;
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const shareLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/pool/${pool.id}?t=${Math.floor(Date.now() / 60000)}`);
    setShareTooltip(true);
    setTimeout(() => setShareTooltip(false), 2000);
  };

  const validateTransaction = (): { valid: boolean; error?: string } => {
    if (!effectiveMintAddress) return { valid: false, error: "Pool not properly configured" };
    if (!isInitialized) return { valid: false, error: "Pool not initialized yet" };
    if (isPaused && !poolHasEnded) return { valid: false, error: "Pool is paused" };
    if (openModal === "stake") {
      if (amount <= 0) return { valid: false, error: "Enter an amount" };
      if (amount > tokenBalance) return { valid: false, error: "Insufficient token balance" };
      if (solBalance < 0.02) return { valid: false, error: "You need at least 0.02 SOL to cover the transaction fee." };
    }
    if (openModal === "unstake") {
      if (amount <= 0) return { valid: false, error: "Enter an amount" };
      if (amount > userStakedAmount) return { valid: false, error: "Cannot unstake more than staked" };
      if (lockupInfo.isLocked && !poolHasEnded) return { valid: false, error: "Tokens are still locked" };
      if (solBalance < 0.02) return { valid: false, error: "You need at least 0.02 SOL to cover the transaction fee." };
    }
    if (openModal === "claimRewards") {
      if (realtimeRewards <= 0) return { valid: false, error: "No rewards to claim" };
      if (solBalance < 0.02) return { valid: false, error: "You need at least 0.02 SOL to cover the transaction fee." };
    }
    if (openModal === "claimReflections") {
      if (reflectionBalance <= 0) return { valid: false, error: "No reflections to claim" };
      if (solBalance < 0.04) return { valid: false, error: "You need at least 0.04 SOL to cover the two reflection transactions." };
    }
    return { valid: true };
  };

  const openModalWithFreshBalance = async (modal: typeof openModal) => {
    if (connected && publicKey) {
      try {
        const freshBalance = await connection.getBalance(publicKey);
        setSolBalance(freshBalance / 1e9);
        if (modal === "stake") refetchTokenBalance();
      } catch {}
    }
    setOpenModal(modal);
  };

  const handleQuickSelect = (percent: number) => {
    if (openModal === "stake") setAmount(Math.floor((tokenBalance * percent) / 100));
    else if (openModal === "unstake") {
      const raw = (userStakedAmount * percent) / 100;
      setAmount(Math.floor(raw * Math.pow(10, tokenDecimals ?? 9)) / Math.pow(10, tokenDecimals ?? 9));
    }
  };

  const handleModalSubmit = async () => {
    const validation = validateTransaction();
    if (!validation.valid) { playSound('error'); showToast(`❌ ${validation.error}`, "error"); return; }
    setIsProcessing(true);
    setIsConfirming(true);
    try {
      let txSignature: string | null = null;
      switch (openModal) {
        case "stake":
          txSignature = await blockchainStake(effectiveMintAddress!, toTokenAmount(amount, tokenDecimals ?? 9), poolId, undefined, engine);
          setLastActionAmount(amount); setSuccessModalType("stake");
          playSound('success');
          showToast(`✅ Staked ${amount.toFixed(4)} ${pool.symbol}! TX: ${txSignature.slice(0, 8)}...`, "success");
          try { await fetch("/api/stakes/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userWallet: publicKey?.toBase58(), tokenMint: effectiveMintAddress, poolId }) }); } catch {}
          break;
        case "unstake":
          let finalUnstakeAmount = amount;
          if (engine !== 'current') {
            const dustAmount = 0.1;
            const isFullUnstake = amount >= userStakedAmount * 0.9999;
            const hasEnoughForDust = userStakedAmount > dustAmount * 2;
            finalUnstakeAmount = (isFullUnstake && hasEnoughForDust) ? amount - dustAmount : amount;
          }
          txSignature = await blockchainUnstake(effectiveMintAddress!, poolId, toTokenAmount(finalUnstakeAmount, tokenDecimals ?? 9), engine);
          setLastActionAmount(amount); setSuccessModalType("unstake");
          playSound('success');
          showToast(`✅ Unstaked ${amount.toFixed(4)} ${pool.symbol}! TX: ${txSignature.slice(0, 8)}...`, "success");
          try { await fetch("/api/stakes/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userWallet: publicKey?.toBase58(), tokenMint: effectiveMintAddress, poolId }) }); } catch {}
          break;
        case "claimRewards":
          txSignature = await blockchainClaimRewards(effectiveMintAddress!, poolId, realtimeRewards, engine);
          setLastActionAmount(realtimeRewards); setSuccessModalType("claim");
          setUserStakeTimestamp(Math.floor(Date.now() / 1000));
          playSound('success');
          showToast(`✅ Claimed rewards! TX: ${txSignature.slice(0, 8)}...`, "success");
          await waitForConfirmation(txSignature);
          break;
        case "claimReflections":
          setOpenModal(null);
          setReflectionClaimStep("refreshing");
          await refreshReflections(effectiveMintAddress!, poolId);
          await new Promise(r => setTimeout(r, 4000));
          setReflectionClaimStep("claiming");
          txSignature = await blockchainClaimReflections(effectiveMintAddress!, poolId);
          setReflectionClaimStep("success");
          playSound('success');
          showToast(`✅ Claimed reflections! TX: ${txSignature.slice(0, 8)}...`, "success");
          await new Promise(r => setTimeout(r, 2000));
          setReflectionClaimStep("idle");
          if (stakeData) {
            const pending = stakeData.reflectionsPending?.toNumber?.() ?? 0;
            setReflectionBalance(pending / decimalsMultiplier);
          }
          break;
      }
      setIsConfirming(false); setIsBroadcasting(true);
      setOpenModal(null); setAmount(0); setShowSuccessModal(true);
      try {
        const [freshStake, freshProjectParallel] = await Promise.all([
          getUserStake(effectiveMintAddress!, poolId, engine),
          getProjectInfo(effectiveMintAddress!, poolId, engine),
        ]);
        if (freshProjectParallel) setProjectData(freshProjectParallel);
        if (freshStake) {
          setUserStakedAmount(freshStake.amount / decimalsMultiplier);
          setUserStakeTimestamp(freshStake.stakeTimestamp || freshStake.lastStakeTimestamp?.toNumber?.() || Math.floor(Date.now() / 1000));
          setStakeData(freshStake);
        }
        setTimeout(async () => {
        try {
          const userStake = await getUserStake(effectiveMintAddress!, poolId, engine);
          if (userStake) { setUserStakedAmount(userStake.amount / decimalsMultiplier); setUserStakeTimestamp(userStake.stakeTimestamp); setStakeData(userStake); }
          setProjectData(await getProjectInfo(effectiveMintAddress!, poolId, engine));
        } catch {}
        }, 2000);
      } catch {}
    } catch (error: any) {
      if (error.message?.includes("may have succeeded") || error.message?.includes("already been processed") || error.message?.includes("already processed")) {
        playSound('success'); showToast(`✅ Transaction succeeded! Refreshing...`, "success");
        setTimeout(() => window.location.reload(), 1500); return;
      }
      playSound('error');
      const anchorErrorMap: Record<number, string> = { 6000: "You don't have permission to do this.", 6001: "The amount entered isn't valid.", 6002: "You don't have enough tokens in your wallet.", 6003: "This pool has been paused by the creator.", 6004: "Deposits into this pool are temporarily paused.", 6005: "Withdrawals from this pool are temporarily paused.", 6006: "Reward claims from this pool are temporarily paused.", 6007: "Your lock period hasn't expired yet. You can't unstake until it ends.", 6008: "No active stake found for your wallet in this pool.", 6009: "No rewards available to claim right now.", 6010: "No reflections available to claim right now.", 6011: "A calculation error occurred. Try a smaller amount.", 6012: "This pool has already been set up.", 6013: "This pool wasn't fully initialised. The second transaction may have been missed during creation.", 6014: "The referral split percentage isn't valid.", 6015: "This pool requires a reflection vault but none was provided.", 6016: "A reflection token is required but wasn't set.", 6017: "Reflections aren't enabled on this pool.", 6018: "You don't have enough SOL to cover the transaction fee. Top up your SOL and try again.", 6019: "The referral address doesn't match the one set for this pool.", 6020: "The pool vault doesn't have enough tokens to complete this.", 6021: "This pool has run out of reward tokens. The pool creator may need to top up rewards.", 6022: "The reflection vault doesn't have enough tokens.", 6023: "This pool needs at least one active staker first.", 6024: "Pool duration must be greater than 0 days.", 6025: "A calculation error occurred. Please try again.", 6026: "The fee collector address isn't valid.", 6027: "The APR is too high and exceeds system limits.", 6028: "Wrong token type. This doesn't match the token this pool accepts.", 6029: "The vault doesn't belong to this pool.", 6030: "The withdrawal wallet doesn't match the one used when staking.", 6031: "The reflection vault doesn't match this pool.", 6032: "This stake doesn't belong to this pool.", 6033: "A mismatch was detected in the pool totals. Please contact support.", 6034: "A timing error was detected. Please try the transaction again.", 6035: "This pool has ended and is no longer accepting deposits.", 6036: "Invalid rate mode. Must be fixed APY or variable APR.", 6037: "A required program is missing for this reflection-enabled pool.", 6038: "Please click Refresh Reflections before claiming.", 6039: "The reward rate is outside the allowed range.", 6040: "The referral split exceeds the maximum of 100%.", 6041: "No reflections to claim. Try refreshing reflections first." };
      const errStr = String(error?.message ?? error);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16) : jsonMatch ? parseInt(jsonMatch[1]) : anchorMatch ? parseInt(anchorMatch[1]) : fallbackMatch ? parseInt(fallbackMatch[1]) : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;
      let errorMessage = anchorError || "Transaction failed";
      if (!anchorError && errStr.includes("User rejected")) errorMessage = "Transaction cancelled";
      else if (!anchorError && errStr.includes("insufficient")) errorMessage = "Insufficient balance";
      else if (!anchorError && errStr.includes("LockupNotExpired")) errorMessage = "Tokens still locked";
      else if (errStr.includes("ProjectPaused")) errorMessage = "Pool is paused";
      else if (!anchorError && error.message) errorMessage = error.message;
      setErrorModalMessage(errorMessage);
      setShowErrorModal(true);
      setReflectionClaimStep("idle");
    } finally {
      setIsProcessing(false); setIsConfirming(false); setIsBroadcasting(false);
    }
  };

  const isStakeDisabled = !connected || !effectiveMintAddress || !isInitialized || isPaused || poolHasEnded;
  const isUnstakeDisabled = !connected || !effectiveMintAddress || !isInitialized || (isPaused && !poolHasEnded) || (userStakedAmount <= 0 && !poolHasEnded) || (lockupInfo.isLocked && !poolHasEnded);
  const isClaimDisabled = !connected || !effectiveMintAddress || !isInitialized || isPaused || realtimeRewards <= 0;
  const isClaimReflectionsDisabled = !connected || !effectiveMintAddress || !isInitialized || isPaused || reflectionBalance <= 0;

  const StakeSuccessModal = () => {
    const [rating, setRating] = useState(0);
    const [hover, setHover] = useState(0);
    const [comment, setComment] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [skipped, setSkipped] = useState(false);
    if (!showSuccessModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowSuccessModal(false)} />
        <div className="relative bg-white/[0.02] backdrop-blur border border-white/[0.05] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
              {successModalType === "stake" && <Sparkles className="w-8 h-8 text-white" />}
              {successModalType === "unstake" && <Unlock className="w-8 h-8 text-white" />}
              {successModalType === "claim" && <Coins className="w-8 h-8 text-white" />}
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center mb-1 text-white">
            {successModalType === "stake" ? "Staked! 🎉" : successModalType === "unstake" ? "Unstaked! ✅" : "Rewards Claimed! 💰"}
          </h2>
          <p className="text-center text-gray-400 text-sm mb-4">
            {successModalType === "stake" ? "You're now earning rewards on-chain" : successModalType === "unstake" ? "Your tokens are back in your wallet" : "Rewards sent directly to your wallet"}
          </p>
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4 mb-5 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Pool</span><span className="text-white font-semibold truncate ml-4">{pool.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">{successModalType === "claim" ? "Claimed" : "Amount"}</span><span className="text-white font-semibold">{lastActionAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {successModalType === 'claim' && engine === 'current' && pool.rewardTokenSymbol ? pool.rewardTokenSymbol : pool.symbol}</span></div>
          </div>
          {!skipped && (
            <div className="border border-white/[0.05] rounded-xl p-4 mb-4 bg-white/[0.02]">
              <p className="text-white text-sm font-semibold mb-2 text-center">Enjoying StakePoint?</p>
              <p className="text-gray-400 text-xs text-center mb-3">Your Trustpilot review helps AI assistants discover and recommend StakePoint, bringing more visibility to every project and community building here.</p>
              <div className="flex gap-2">
                <button onClick={() => setSkipped(true)} className="flex-1 py-2 rounded-lg text-xs font-semibold text-gray-500 bg-white/[0.02] hover:bg-white/[0.05] transition-all">Skip</button>
                <a href="https://www.trustpilot.com/review/stakepoint.app" target="_blank" rel="noopener noreferrer" className="flex-1 py-2 rounded-lg text-xs font-semibold text-white text-center transition-all" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
                  Review on Trustpilot ⭐
                </a>
              </div>
            </div>
          )}
          <button onClick={() => setShowSuccessModal(false)} className="w-full py-3 rounded-xl font-semibold transition-all text-white hover:opacity-90" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>Continue</button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-3">

      {/* Back + actions row */}
      <div className="flex items-center justify-between">
        <Link href={isLPPool ? "/farming" : "/pools"} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {isLPPool ? "Back to Farms" : "Back to Pools"}
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowIntegrateModal(true)} className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors" title="Integrate">
            <Code className="w-4 h-4 text-gray-400" />
          </button>
          <button onClick={() => { const text = encodeURIComponent(`Stake ${pool.symbol} and earn ${displayAPR.toFixed(0)}% APR on @StakePointApp 💰\n\nNon-custodial Solana staking 👇`); const url = encodeURIComponent(`${window.location.origin}/pool/${pool.id}?t=${Math.floor(Date.now() / 60000)}`); window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "width=550,height=420"); }} className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors">
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </button>
          <div className="relative">
            <button onClick={shareLink} className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors">
              <Share2 className="w-4 h-4 text-gray-400" />
            </button>
            {shareTooltip && <div className="absolute -bottom-8 right-0 px-2 py-1 rounded bg-green-500 text-white text-xs whitespace-nowrap z-10">Copied!</div>}
          </div>
          <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${poolHasEnded ? "bg-gray-500/10 border-gray-500/30 text-gray-400" : isPaused ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" : "bg-[#fb57ff]/10 border-[#fb57ff]/30 text-[#fb57ff]"}`}>
            {poolHasEnded ? "⏸ Ended" : isPaused ? "⏸ Paused" : "⚡ Active"}
          </div>
        </div>
      </div>

      {/* ROW 1: Hero card */}
      <Card>
        <div className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              {pool.logo ? (
                <img src={pool.logo} alt={pool.symbol} className="w-14 h-14 sm:w-16 sm:h-16 rounded-full shrink-0" onError={e => e.currentTarget.style.display = "none"} />
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
                  <Coins className="w-7 h-7 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-white mb-1 truncate">{pool.name}</h1>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base text-gray-400">{pool.symbol}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(251,87,255,0.1)', color: '#fb57ff', border: '1px solid rgba(251,87,255,0.3)' }}>{isLPPool ? 'LP Farm' : 'Staking Pool'}</span>
                  <SafetyBadge score={pool.safetyScore} details={pool.safetyDetails} />
                  {false ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-500/10 text-green-400 border border-green-500/30">✓ Verified</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium hidden">⚠ Unverified</span>
                  )}
                  {pool.reflectionEnabled && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(251,87,255,0.1)', color: '#fb57ff', border: '1px solid rgba(251,87,255,0.3)' }}>✦ Reflections</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Key stats */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "APR", value: isLoadingAPR ? "..." : `${displayAPR.toFixed(2)}%`, accent: true },
              { label: "Lock Period", value: formatLockPeriod(displayLockPeriod) },
              { label: "Duration", value: `${displayDuration}d` },
              { label: "Total Staked", value: displayTotalStaked === null ? "..." : displayTotalStaked > 0 ? `${displayTotalStaked >= 1_000_000 ? (displayTotalStaked / 1_000_000).toFixed(1) + 'M' : displayTotalStaked.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "0" },
            ].map(item => (
              <div key={item.label} className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{item.label}</p>
                <p className="text-sm font-bold" style={{ color: item.accent ? '#fb57ff' : 'white' }}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Pool ended / paused notice */}
      {poolHasEnded && (
        <Card>
          <div className="p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Pool has ended</p>
              <p className="text-xs text-gray-400 mt-0.5">This pool is no longer accepting deposits. You can still unstake and claim rewards.</p>
            </div>
          </div>
        </Card>
      )}

      {/* Low APR notice */}
      {!isLoadingAPR && displayAPR < 10 && !lowAprDismissed && !poolHasEnded && (
        <Card>
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(110deg, transparent 20%, rgba(251, 87, 255, 0.05) 40%, rgba(251, 87, 255, 0.1) 50%, rgba(251, 87, 255, 0.05) 60%, transparent 80%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 3s ease-in-out infinite',
            }}
          />
          <div className="relative p-4 flex items-start gap-3">
            <TrendingUp className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#fb57ff' }} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{displayAPR === 0 && (!displayTotalStaked || displayTotalStaked === 0) ? 'Waiting for the first staker' : displayAPR === 0 ? 'This pool has no active rewards' : 'This pool is proving popular!'}</p>
              <p className="text-xs text-gray-400 mt-1">
                {displayAPR === 0 && (!displayTotalStaked || displayTotalStaked === 0) ? 'The APR will appear once someone stakes into this pool.' : displayAPR === 0 ? 'The reward rate is currently 0%.' : 'High participation has brought the APR below 10%.'} If you are the pool creator, you can{' '}
                <Link href="/my-pools" className="underline" style={{ color: '#fb57ff' }}>add more rewards</Link>{' '}
                or{' '}
                <Link href="/for-projects" className="underline" style={{ color: '#fb57ff' }}>create an additional pool</Link>{' '}
                to keep the momentum going.
              </p>
            </div>
            <button onClick={() => setLowAprDismissed(true)} className="text-gray-500 hover:text-white transition-colors text-lg leading-none flex-shrink-0 mt-0.5">✕</button>
          </div>
        </Card>
      )}

      {/* Pool creator tip */}
      <Card>
        <div className="relative p-4 flex items-start gap-3">
          <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#fb57ff' }} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Are you the pool creator?</p>
            <p className="text-xs text-gray-400 mt-1">
              Add the StakePoint staking bot to your Telegram group or channel so your community can check rewards, stake, and unstake activity without leaving the chat.
            </p>
            <a href="https://t.me/stakepointstakingbot" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold mt-2 hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
              Add Staking Bot <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </Card>

      {/* ROW 2: Your position (left) + Actions (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">

        {/* Your position */}
        <Card className="flex flex-col">
          <div className="p-4 space-y-3 flex flex-col h-full">
            <p className="text-sm text-gray-400 uppercase tracking-wider">Your Position</p>

            {!connected ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <p className="text-xs text-gray-400">Connect wallet to see your position</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Staked</p>
                    <p className="text-sm font-bold text-white">{userStakedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-gray-400 font-normal text-xs">{pool.symbol}</span></p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Rewards</p>
                    <p className="text-sm font-bold" style={{ color: realtimeRewards > 0 ? '#fb57ff' : 'white' }}>{formatRewards(realtimeRewards)} <span className="text-gray-400 font-normal text-xs">{pool.rewardTokenSymbol && pool.rewardTokenSymbol !== pool.symbol ? pool.rewardTokenSymbol : pool.symbol}</span></p>
                  </div>
                  {pool.reflectionEnabled && (
                    <div className="rounded-xl px-3 py-2.5 col-span-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Reflections</p>
                        <button onClick={fetchReflectionBalance} disabled={reflectionLoading} className="text-[10px] px-2 py-0.5 rounded-md transition-all hover:bg-white/[0.05]" style={{ color: '#fb57ff', border: '1px solid rgba(251,87,255,0.3)' }}>
                          {reflectionLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Refresh"}
                        </button>
                      </div>
                      <p className="text-sm font-bold" style={{ color: reflectionBalance > 0 ? '#fb57ff' : 'white' }}>
                        {reflectionLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : reflectionBalance.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })} <span className="text-gray-400 font-normal text-xs">{pool.reflectionTokenSymbol || ''}</span>
                      </p>
                    </div>
                  )}
                </div>
                {lockupInfo.isLocked && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(251,87,255,0.08)', border: '1px solid rgba(251,87,255,0.2)' }}>
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb57ff' }} />
                    <p className="text-xs font-medium" style={{ color: '#fb57ff' }}>
                      Locked for {Math.ceil(lockupInfo.remainingTime / (1000 * 60 * 60 * 24))} more days
                    </p>
                  </div>
                )}
                {userStakedAmount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(251,87,255,0.08)', border: '1px solid rgba(251,87,255,0.2)' }}>
                    <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb57ff' }} />
                    <p className="text-xs font-medium" style={{ color: '#fb57ff' }}>You are staking in this pool</p>
                  </div>
                )}
              </>
            )}

            {/* Pool info */}
            <div className="pt-1 space-y-2">
              <p className="text-sm text-gray-400 uppercase tracking-wider">Pool Information</p>
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Token Mint</p>
                <div className="flex items-center gap-1.5">
                  <code className="text-xs text-white bg-white/[0.05] px-2.5 py-1.5 rounded flex-1 overflow-hidden text-ellipsis font-mono">
                    {pool.tokenMint.slice(0, 8)}...{pool.tokenMint.slice(-8)}
                  </code>
                  <button onClick={() => copyToClipboard(pool.tokenMint, "mint")} className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                    {copied === "mint" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                  </button>
                  <a href={`https://solscan.io/token/${pool.tokenMint}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                    <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                  </a>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Pool ID</p>
                  <p className="text-xs font-semibold text-white">#{poolId}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Created</p>
                  <p className="text-xs font-semibold text-white">{new Date(pool.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
              {projectData?.address && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Pool Address</p>
                  <div className="flex items-center gap-1.5">
                    <code className="text-xs text-white bg-white/[0.05] px-2.5 py-1.5 rounded flex-1 overflow-hidden text-ellipsis font-mono">
                      {projectData.address.toString().slice(0, 8)}...{projectData.address.toString().slice(-8)}
                    </code>
                    <button onClick={() => copyToClipboard(projectData.address.toString(), "pooladdr")} className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                      {copied === "pooladdr" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    <a href={`https://solscan.io/account/${projectData.address.toString()}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Actions */}
        <Card className="flex flex-col">
          <div className="p-4 space-y-2.5 flex flex-col h-full">
            <p className="text-sm text-gray-400 uppercase tracking-wider mb-3">Actions</p>

            {!connected ? (
              <div className="text-center py-4">
                <p className="text-xs text-gray-400 mb-3">Connect your wallet to start staking</p>
                <Link href="/pools" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
                  Browse Pools
                </Link>
              </div>
            ) : (
              <>
                {!isLPPool && <QuickBuyPanel tokenMint={effectiveMintAddress} tokenSymbol={pool.symbol} poolName={pool.name} poolId={poolId} />}
                <button onClick={() => openModalWithFreshBalance("stake")} disabled={isStakeDisabled} className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: isStakeDisabled ? 'rgba(255,255,255,0.05)' : 'linear-gradient(45deg, black, #fb57ff)' }}>
                  Stake Tokens
                </button>
                <button onClick={() => openModalWithFreshBalance("unstake")} disabled={isUnstakeDisabled} className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  Unstake Tokens
                </button>
                <button onClick={() => openModalWithFreshBalance("claimRewards")} disabled={isClaimDisabled} className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: isClaimDisabled ? 'rgba(255,255,255,0.05)' : 'rgba(251,87,255,0.15)', border: '1px solid rgba(251,87,255,0.3)', color: isClaimDisabled ? '#6b7280' : '#fb57ff' }}>
                  Claim Rewards {realtimeRewards > 0 && <span className="ml-1 text-xs">({formatRewards(realtimeRewards)})</span>}
                </button>
                {pool.reflectionEnabled && (
                  <button onClick={async () => { await fetchReflectionBalance(); await openModalWithFreshBalance("claimReflections"); }} disabled={isClaimReflectionsDisabled} className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: isClaimReflectionsDisabled ? 'rgba(255,255,255,0.05)' : 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: isClaimReflectionsDisabled ? '#6b7280' : '#a78bfa' }}>
                    Claim Reflections
                  </button>
                )}
                {isPaused && !poolHasEnded && (
                  <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-xs text-yellow-400 text-center">Pool is currently paused</p>
                  </div>
                )}
              </>
            )}

            {/* Verified section */}
            <div className="pt-2 border-t border-white/[0.05] mt-3">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#00d4ff' }} />
                <p className="text-xs font-semibold text-white">Non-Custodial</p>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Tokens are held in an on-chain smart contract vault. Nobody including StakePoint can access your staked tokens before you unstake.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <a href={`https://solscan.io/token/${pool.tokenMint}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                  Verify on Solscan <ExternalLink className="w-3 h-3" />
                </a>
                <Link href="/pools" className="text-xs hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>All Pools →</Link>
                <Link href="/for-projects" className="text-xs hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>Create Pool →</Link>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ROW 2.5: Price chart */}
      {!isLPPool && (
        <Card>
          <TokenChart mint={effectiveMintAddress} symbol={pool.symbol} />
        </Card>
      )}

      {/* ROW 3: Project details */}
      <div data-nosnippet className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">

        {/* Project description */}
        <Card className="md:col-span-2 flex flex-col">
          <div className="p-4 flex flex-col h-full">
            <p className="text-sm text-gray-400 uppercase tracking-wider mb-2">About {pool.symbol}</p>
            {pool.description ? (
              <>
                <p className="text-xs text-gray-300 leading-relaxed">{pool.description}</p>
                <p className="text-[10px] text-gray-500 leading-relaxed mt-3 pt-3 border-t border-white/[0.05]">
                  Submitted by the project. StakePoint does not verify or endorse this content or any linked site. Always do your own research.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 italic">No Information Yet</p>
                <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
                  Are you the project behind {pool.symbol}? Connect your creator wallet on My Pools to add your description, website and X profile to this page.
                </p>
                <a href="/my-pools" className="inline-flex items-center gap-1 text-[10px] font-semibold mt-2 hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                  Go to My Pools <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
          </div>
        </Card>

        {/* Project links */}
        <div className="grid grid-cols-1 grid-rows-2 gap-3">

          <Card>
            <div className="p-4">
              <p className="text-sm text-gray-400 uppercase tracking-wider mb-2">Website</p>
              {safeUrl(pool.website) ? (
                <a href={safeUrl(pool.website) as string} target="_blank" rel="nofollow ugc noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold hover:opacity-80 transition-opacity break-all" style={{ color: '#fb57ff' }}>
                  {(safeUrl(pool.website) as string).replace(/^https?:\/\//, '').replace(/\/$/, '')} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              ) : (
                <p className="text-xs text-gray-500 italic">No Information Yet</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <p className="text-sm text-gray-400 uppercase tracking-wider mb-2">X Profile</p>
              {safeTwitterUrl(pool.twitter) ? (
                <a href={safeTwitterUrl(pool.twitter) as string} target="_blank" rel="nofollow ugc noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold hover:opacity-80 transition-opacity break-all" style={{ color: '#fb57ff' }}>
                  @{(safeTwitterUrl(pool.twitter) as string).replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, '').replace(/\/$/, '')} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              ) : (
                <p className="text-xs text-gray-500 italic">No Information Yet</p>
              )}
            </div>
          </Card>

        </div>
      </div>

      {/* MODAL */}
      {openModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50 p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white/[0.02] border border-white/[0.05] p-3 sm:p-6 rounded-2xl shadow-2xl w-full max-w-[calc(100vw-24px)] sm:max-w-md max-h-[90vh] overflow-y-auto overscroll-contain animate-in zoom-in-95 duration-200" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {openModal === "stake" && "💰"}
                {openModal === "unstake" && "📤"}
                {(openModal === "claimRewards" || openModal === "claimReflections") && "🎁"}
                <span>{openModal === "stake" ? "Stake Tokens" : openModal === "unstake" ? "Unstake Tokens" : openModal === "claimRewards" ? "Claim Rewards" : "Claim Reflections"}</span>
              </h2>
              <button onClick={() => { setOpenModal(null); setAmount(0); }} disabled={isProcessing} className="text-gray-400 hover:text-white transition-colors text-xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center">✕</button>
            </div>

            <div className="bg-white/[0.02] border border-white/[0.05] p-3 rounded-lg mb-4 flex items-center gap-3">
              {pool.logo && <img src={pool.logo} alt={pool.name} className="w-9 h-9 rounded-full flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-white font-semibold text-sm truncate">{pool.name}</p>
                <p className="text-gray-400 text-xs">{pool.symbol}</p>
              </div>
            </div>

            {(openModal === "stake" || openModal === "unstake") && (
              <>
                <div className="mb-4 p-3 bg-white/[0.02] border border-white/[0.05] rounded-lg">
                  <p className="text-gray-400 text-xs mb-1">{openModal === "stake" ? "Available Balance" : "Staked Amount"}</p>
                  <p className="text-white font-bold text-xl">
                    {openModal === "stake" ? tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 4 }) : userStakedAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {pool.symbol}
                  </p>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-300 mb-2">Amount to {openModal}</label>
                  <div className="relative">
                    <input type="number" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} className="w-full p-3 pr-16 rounded-lg bg-white/[0.02] text-white border border-white/[0.05] focus:border-[#fb57ff] focus:outline-none text-lg font-semibold" placeholder="0.00" disabled={isProcessing} max={openModal === "stake" ? tokenBalance : userStakedAmount} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm">{pool.symbol}</span>
                  </div>
                </div>
                {openModal === "stake" && amount > 0 && (
                  <details open={typeof window !== 'undefined' && window.innerWidth >= 640} className="group mb-4 p-3 bg-white/[0.02] border border-white/[0.05] rounded-lg text-xs">
                    <summary className="flex items-center justify-between cursor-pointer list-none sm:hidden">
                      <span className="font-semibold" style={{ color: '#fb57ff' }}>You'll Stake: {feeCalculation.amountAfterFee.toFixed(2)} {pool.symbol}</span>
                      <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </summary>
                    <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-gray-400">Token Fee ({platformFeePercent}%):</span><span className="text-yellow-400">-{feeCalculation.tokenFee.toFixed(4)} {pool.symbol}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">SOL Fee:</span><span className="text-yellow-400">-{flatSolFee} SOL</span></div>
                    <div className="border-t border-white/[0.05] pt-2 flex justify-between"><span className="font-semibold" style={{ color: '#fb57ff' }}>You'll Stake:</span><span className="font-bold" style={{ color: '#fb57ff' }}>{feeCalculation.amountAfterFee.toFixed(4)} {pool.symbol}</span></div>
                    </div>
                  </details>
                )}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[25, 50, 100].map(p => (
                    <button key={p} onClick={() => handleQuickSelect(p)} disabled={isProcessing} className="py-2.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg text-sm font-semibold transition-all disabled:opacity-50">{p}%</button>
                  ))}
                </div>
                <div className="mb-4">
                  <input type="range" min="0" max={openModal === "stake" ? Math.floor(tokenBalance) : userStakedAmount} step={openModal === "stake" ? 1 : userStakedAmount / 100} value={amount} onChange={e => setAmount(Number(e.target.value))} disabled={isProcessing} className="w-full h-2 bg-white/[0.05] rounded-lg appearance-none cursor-pointer" style={{ accentColor: '#fb57ff' }} />
                </div>
                {openModal === "stake" && amount > 0 && solBalance < 0.02 && (
                  <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>You need at least 0.02 SOL to cover the transaction fee (you have {solBalance.toFixed(5)})</span>
                  </div>
                )}
                {openModal === "unstake" && lockupInfo.isLocked && (
                  <div className="mb-3 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2 text-yellow-400 text-xs">
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    <span>Unlocks in {Math.ceil(lockupInfo.remainingTime / (1000 * 60 * 60 * 24))} days</span>
                  </div>
                )}
                {openModal === "unstake" && solBalance < 0.02 && (
                  <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>You need at least 0.02 SOL to cover the transaction fee (you have {solBalance.toFixed(5)})</span>
                  </div>
                )}
                {openModal === "claimRewards" && pool.lockPeriodDays && (
                  <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-yellow-400">
                    ⚠️ Claiming rewards restarts your lock timer.
                  </div>
                )}
              </>
            )}

            {openModal === "claimRewards" && solBalance < 0.02 && (
              <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>You need at least 0.02 SOL to cover the transaction fee (you have {solBalance.toFixed(5)})</span>
              </div>
            )}
            {openModal === "claimReflections" && solBalance < 0.04 && (
              <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>You need at least 0.04 SOL to cover the two reflection transactions (you have {solBalance.toFixed(5)})</span>
              </div>
            )}
            {(openModal === "claimRewards" || openModal === "claimReflections") && (
              <div className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-green-400 text-xs mb-1">{openModal === "claimRewards" ? "Available to claim:" : "Available reflections:"}</p>
                <p className="text-white font-bold text-xl">
                  {openModal === "claimRewards" ? `${formatRewards(realtimeRewards)} ${pool.symbol}` : `${reflectionBalance.toFixed(4)} tokens`}
                </p>
                {openModal === "claimRewards" && pool.lockPeriodDays && engine === 'legacy' && (
                  <div className="mt-3 p-2 border border-red-500/50 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.15)' }}>
                    <p className="text-yellow-400 text-xs font-semibold">⚠️ Claiming rewards restarts your lock timer.</p>
                    <p className="text-blue-300 text-xs mt-1"><strong>Want to unstake?</strong> Unstake first, then claim rewards.</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setOpenModal(null); setAmount(0); }} disabled={isProcessing} className="flex-1 px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg text-sm font-semibold transition-all disabled:opacity-50">Cancel</button>
              <button onClick={handleModalSubmit} disabled={isProcessing || !validateTransaction().valid} className="flex-1 px-4 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white" style={{ background: (isProcessing || !validateTransaction().valid) ? 'rgba(255,255,255,0.05)' : 'linear-gradient(45deg, black, #fb57ff)' }}>
                {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Processing...</span></> : "Confirm"}
              </button>
            </div>

            {(isBroadcasting || isConfirming) && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
                <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
                  <div className="flex justify-center mb-6">
                    <div className="relative w-20 h-20">
                      <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                      <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Zap className="w-7 h-7" style={{ color: '#fb57ff' }} />
                      </div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{isConfirming ? "Confirm in Wallet" : "Broadcasting..."}</h3>
                  <p className="text-gray-400 text-sm mb-4">{isConfirming ? "Please approve the transaction in your wallet" : "Broadcasting to the Solana blockchain"}</p>
                  <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
                    <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
                    <p className="text-xs text-gray-500">Your transaction is being confirmed on-chain. This usually takes 5 to 15 seconds.</p>
                  </div>
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {reflectionClaimStep !== "idle" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            {reflectionClaimStep !== "success" ? (
              <>
                <div className="flex justify-center mb-6">
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                    <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Sparkles className="w-7 h-7" style={{ color: '#fb57ff' }} />
                    </div>
                  </div>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {reflectionClaimStep === "refreshing" ? "Transaction 1 of 2" : "Transaction 2 of 2"}
                </h3>
                <p className="text-sm mb-1 font-semibold" style={{ color: '#fb57ff' }}>
                  {reflectionClaimStep === "refreshing" ? "Calculating Reflections" : "Claiming Reflections"}
                </p>
                <p className="text-gray-400 text-xs mb-4">
                  {reflectionClaimStep === "refreshing" ? "Approve in your wallet to calculate your claimable reflections" : "Approve in your wallet to send reflections to your address"}
                </p>
                <div className="flex gap-2 justify-center mb-4">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: reflectionClaimStep === "claiming" ? 'rgba(34,197,94,0.15)' : 'rgba(251,87,255,0.15)', color: reflectionClaimStep === "claiming" ? '#22c55e' : '#fb57ff', border: `1px solid ${reflectionClaimStep === "claiming" ? 'rgba(34,197,94,0.3)' : 'rgba(251,87,255,0.3)'}` }}>
                    {reflectionClaimStep === "claiming" ? "✓" : <Loader2 className="w-3 h-3 animate-spin" />} Calculate
                  </div>
                  <div className="w-4 h-px bg-white/[0.1] self-center" />
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: reflectionClaimStep === "claiming" ? 'rgba(251,87,255,0.15)' : 'rgba(255,255,255,0.05)', color: reflectionClaimStep === "claiming" ? '#fb57ff' : '#6b7280', border: `1px solid ${reflectionClaimStep === "claiming" ? 'rgba(251,87,255,0.3)' : 'rgba(255,255,255,0.05)'}` }}>
                    {reflectionClaimStep === "claiming" ? <Loader2 className="w-3 h-3 animate-spin" /> : "2"} Claim
                  </div>
                </div>
                <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
                  <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
                  <p className="text-xs text-gray-500">Two wallet approvals required. This usually takes 10 to 20 seconds.</p>
                </div>
                <div className="flex justify-center gap-1 mt-4">
                  {[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />)}
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
                    <Sparkles className="w-8 h-8 text-white" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Reflections Claimed! 💰</h3>
                <p className="text-gray-400 text-sm">Tokens sent directly to your wallet</p>
              </>
            )}
          </div>
        </div>
      )}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowErrorModal(false)} />
          <div className="relative bg-white/[0.02] backdrop-blur border border-white/[0.05] rounded-2xl p-5 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-red-500/20 border border-red-500/30">
                <XCircle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Transaction Failed</h2>
                <p className="text-gray-400 text-sm">Something went wrong with your request</p>
              </div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-4">
              <p className="text-white text-sm leading-relaxed">{errorModalMessage}</p>
            </div>
            <p className="text-gray-500 text-xs mb-4">If this keeps happening, email <a href="mailto:contact@stakepoint.app" className="underline" style={{ color: '#fb57ff' }}>contact@stakepoint.app</a> with details of what you were doing.</p>
            <button
              onClick={() => setShowErrorModal(false)}
              className="w-full py-3 rounded-xl font-semibold transition-all text-white hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      <StakeSuccessModal />
      <IntegrateModal isOpen={showIntegrateModal} onClose={() => setShowIntegrateModal(false)} poolId={pool.id} />
    </div>
  );
}
