"use client";
import { useEffect, useState, useMemo } from "react";
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { useStakingProgram } from '@/hooks/useStakingProgram';
import { usePoolData } from '@/hooks/usePoolData';
import { balanceCache } from '@/hooks/useSolanaBalance';
import { useToast } from "@/components/ToastContainer";
import { LoadingSpinner } from "@/components/SkeletonLoaders";
import { useRealtimeRewards, formatRewards } from "@/utils/calculatePendingRewards";
import SafetyBadge from "@/components/SafetyBadge";
import { 
  Lock, 
  Unlock, 
  Coins,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Sparkles,
  Repeat,
  Star,
  ExternalLink
} from "lucide-react";
import TraxrBadge from "@/components/TraxrBadge";
import QuickBuyPanel from "@/components/QuickBuyPanel";
import ZapPanel from "@/components/ZapPanel";

// Helper function to safely convert decimal amounts to token units
function toTokenAmount(amount: number, decimals: number): string {
  const amountStr = amount.toString();
  const [whole, fraction = ''] = amountStr.split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + paddedFraction;
  return combined.replace(/^0+/, '') || '0';
}

const priceCache = new Map<string, {
  price: number | null;
  priceChange24h: number | null;
  timestamp: number;
}>();

const decimalsCache = new Map<string, number>();

// 🔒 GLOBAL REQUEST QUEUE - Prevents all pools from hitting RPC at once
let lastRpcCall = 0;
const MIN_RPC_DELAY = 2000; // 2 seconds between ANY RPC call across all pools

async function waitForRpcSlot() {
  const now = Date.now();
  const timeSinceLastCall = now - lastRpcCall;
  
  if (timeSinceLastCall < MIN_RPC_DELAY) {
    const waitTime = MIN_RPC_DELAY - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastRpcCall = Date.now();
}

const CACHE_DURATION = 120000; // 2 minutes
const TOKEN_DECIMALS = 9;
const decimalsMultiplier = Math.pow(10, TOKEN_DECIMALS);

interface PoolCardProps {
  id: string;
  poolId?: number; // ✅ NEW: Pool number (0, 1, 2...)
  tokenMint?: string; // ✅ NEW: Token mint address
  name: string;
  symbol: string;
  apr?: string;
  apy?: string | number;
  type: string;
  lockPeriod?: number | string;
  totalStaked?: string;
  rewards?: string;
  logo?: string;
  pairAddress?: string;
  mintAddress?: string;
  hasSelfReflections?: boolean;
  hasExternalReflections?: boolean;
  externalReflectionMint?: string;
  featured?: boolean;
  isPaused?: boolean;
  poolEndTime?: number;
  isInitialized?: boolean;
  platformFeePercent?: number;
  flatSolFee?: number;
  reflectionTokenAccount?: string;
  reflectionTokenSymbol?: string;
  showPoolNumber?: boolean; 
  totalPoolsForToken?: number; 
  transferTaxBps?: number; 
  verified?: boolean;
  safetyScore?: number | null;
  safetyDetails?: string | null;
  compact?: boolean;
  engine?: string;
  lpUrl?: string;
  lpPoolId?: string | null;
  lpDex?: string | null;
  rewardTokenMint?: string;
  isLPPool?: boolean;
}

function StakeSuccessModal({ isOpen, onClose, symbol, amount, poolName, publicKey, type }: {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  amount: number;
  poolName: string;
  publicKey: string | null;
  type: "stake" | "unstake" | "claim";
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skipped, setSkipped] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/[0.02] backdrop-blur border border-white/[0.05] rounded-2xl p-5 max-w-2xl w-full shadow-2xl" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
            {type === "stake" && <Sparkles className="w-6 h-6 text-white" />}
            {type === "unstake" && <Unlock className="w-6 h-6 text-white" />}
            {type === "claim" && <Coins className="w-6 h-6 text-white" />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {type === "stake" && "Staked! 🎉"}
              {type === "unstake" && "Unstaked! ✅"}
              {type === "claim" && "Rewards Claimed! 💰"}
            </h2>
            <p className="text-gray-400 text-sm">
              {type === "stake" && "You're now earning rewards on-chain"}
              {type === "unstake" && "Your tokens are back in your wallet"}
              {type === "claim" && "Rewards sent directly to your wallet"}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-3">
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Pool</span>
                <span className="text-white font-semibold truncate ml-4">{poolName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">{type === "claim" ? "Claimed" : "Amount"}</span>
                <span className="text-white font-semibold">{amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol}</span>
              </div>
            </div>
            {submitted && (
              <p className="text-center text-green-400 text-sm font-semibold">✅ Thanks for your review!</p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {!skipped && (
              <div className="border border-white/[0.05] rounded-xl p-3 bg-white/[0.02]">
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
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl font-semibold transition-all text-white hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PoolCard(props: PoolCardProps) {
  const { 
    id, 
    poolId = 0, // ✅ NEW: Default to 0
    tokenMint, // ✅ NEW
    name, 
    symbol, 
    apr, 
    apy, 
    type, 
    lockPeriod, 
    totalStaked, 
    rewards, 
    logo, 
    pairAddress, 
    mintAddress, 
    hasSelfReflections, 
    hasExternalReflections, 
    externalReflectionMint, 
    featured,
    isPaused, 
    poolEndTime, 
    isInitialized,
    platformFeePercent = 2,
    flatSolFee = 0.012,
    reflectionTokenAccount,
    reflectionTokenSymbol,
    showPoolNumber = false,
    totalPoolsForToken = 1,
    transferTaxBps = 0,
    verified = false,
    safetyScore = null,
    safetyDetails = null,
    compact = false,
    engine = 'legacy',
    lpUrl,
    lpPoolId,
    lpDex,
    rewardTokenMint,
    isLPPool = false,
    } = props;

  const effectiveMintAddress = tokenMint || mintAddress;
  
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { showSuccess, showError, showWarning } = useToast();
  
  const { getDecimals, getPrice, getSolBalance, getUserTokenBalance, isUserDataLoading, isPoolDataLoading, getPoolProject, getUserStake: getCachedUserStake, loadPoolsData } = usePoolData();
  const [tokenBalance, setTokenBalance] = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const { 
    stake: blockchainStake, 
    unstake: blockchainUnstake, 
    claimRewards: blockchainClaimRewards,
    claimReflections: blockchainClaimReflections,
    refreshReflections,
    getUserStake,
    calculateRewards,
    getPoolRate,
    getProjectInfo,
    waitForConfirmation,
  } = useStakingProgram();

  const [price, setPrice] = useState<number | null>(null);
  const [priceChange24h, setPriceChange24h] = useState<number | null>(null);
  const [marketCap, setMarketCap] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [openModal, setOpenModal] = useState<"stake" | "unstake" | "claimRewards" | "claimSelf" | "claimExternal" | "viewBalances" | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  
  const [userStakedAmount, setUserStakedAmount] = useState<number>(0);
  const [userStakeTimestamp, setUserStakeTimestamp] = useState<number>(0);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [dynamicRate, setDynamicRate] = useState<number | null>(null);
  const [showStakeSuccess, setShowStakeSuccess] = useState(false);
  const [lastStakeAmount, setLastStakeAmount] = useState(0);
  const [successModalType, setSuccessModalType] = useState<"stake" | "unstake" | "claim">("stake");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState("");

  const taxMultiplier = 1 - (transferTaxBps / 10000);
  const displayStakedAmount = userStakedAmount * taxMultiplier;

  const [projectData, setProjectData] = useState<any>(null);
  const [stakeData, setStakeData] = useState<any>(null);

  // Derive pool end time from blockchain data
  const blockchainPoolEndTime = projectData?.poolEndTime?.toNumber?.() || projectData?.poolEndTime || null;

  const [reflectionClaimStep, setReflectionClaimStep] = useState<"idle" | "refreshing" | "claiming" | "success">("idle");
  const [reflectionBalance, setReflectionBalance] = useState<number>(0);
  const [reflectionLoading, setReflectionLoading] = useState(false);
  const [tokenDecimals, setTokenDecimals] = useState<number>(9);
  const [dailyRewardRate, setDailyRewardRate] = useState<string | null>(null);
  const decimalsMultiplier = useMemo(() => Math.pow(10, tokenDecimals), [tokenDecimals]);
  const [copied, setCopied] = useState(false);

  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const REFRESH_COOLDOWN = 3000; // 3 seconds between refreshes
  
  const rewardDecimals = engine === 'current' && projectData?.rewardTokenDecimals != null ? projectData.rewardTokenDecimals : tokenDecimals;
  const realtimeRewards = useRealtimeRewards(projectData, stakeData, rewardDecimals);

  const [currentTime, setCurrentTime] = useState<number>(Math.floor(Date.now() / 1000));

  // Update current time every 10 seconds for realtime rewards
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // Use batched decimals from provider
  useEffect(() => {
    if (!effectiveMintAddress) return;
    const cachedDecimals = getDecimals(effectiveMintAddress);
    if (cachedDecimals !== null) setTokenDecimals(cachedDecimals);
  }, [effectiveMintAddress, getDecimals]);

  // Use batched token balance from provider
  useEffect(() => {
    if (!effectiveMintAddress || !connected) {
      setTokenBalance(0);
      setBalanceLoading(false);
      return;
    }
    const balance = getUserTokenBalance(effectiveMintAddress);
    setTokenBalance(balance);
    setBalanceLoading(isUserDataLoading);
  }, [effectiveMintAddress, connected, getUserTokenBalance, isUserDataLoading]);

  const onChainLockSeconds = useMemo(() => {
    if (projectData?.lockupSeconds) {
      return projectData.lockupSeconds.toNumber?.() 
        ? projectData.lockupSeconds.toNumber() 
        : Number(projectData.lockupSeconds);
    }
    // Fallback to database value
    if (!lockPeriod) return 0;
    return typeof lockPeriod === 'string' ? parseInt(lockPeriod) * 86400 : lockPeriod * 86400;
  }, [projectData, lockPeriod]);

  const lockupInfo = useMemo(() => {
    if (!onChainLockSeconds || type !== "locked" || !userStakeTimestamp) {
      return { isLocked: false, remainingSeconds: 0, unlocksAt: null, canClaim: true };
    }

    const unlocksAt = userStakeTimestamp + onChainLockSeconds;
    const remainingSeconds = Math.max(0, unlocksAt - currentTime);
    
    return {
      isLocked: remainingSeconds > 0,
      remainingSeconds,
      unlocksAt: new Date(unlocksAt * 1000),
      canClaim: true,
    };
  }, [onChainLockSeconds, type, userStakeTimestamp, currentTime]);

  const poolEndInfo = useMemo(() => {
    const endTime = blockchainPoolEndTime || poolEndTime;
    
    if (!endTime) return { hasEnded: false, endsAt: null, remainingSeconds: 0, status: 'none' as const };
    
    const remainingSeconds = Math.max(0, endTime - currentTime);
    const daysRemaining = remainingSeconds / 86400;
    
    let status: 'ended' | 'critical' | 'warning' | 'active' | 'none' = 'active';
    if (remainingSeconds === 0) status = 'ended';
    else if (daysRemaining < 1) status = 'critical';
    else if (daysRemaining < 7) status = 'warning';
    
    return {
      hasEnded: remainingSeconds === 0,
      endsAt: new Date(endTime * 1000),
      remainingSeconds,
      status,
      daysRemaining,
    };
  }, [blockchainPoolEndTime, poolEndTime, currentTime]);

  const feeCalculation = useMemo(() => {
    if (!amount || amount <= 0) return { tokenFee: 0, solFee: flatSolFee, amountAfterFee: 0 };
    
    const tokenFee = (amount * platformFeePercent) / 100;
    const amountAfterFee = amount - tokenFee;
    
    return {
      tokenFee,
      solFee: flatSolFee,
      amountAfterFee,
    };
  }, [amount, platformFeePercent, flatSolFee]);

  // ✅ PUBLIC DATA: Use batched project data from provider
  useEffect(() => {
    if (!effectiveMintAddress) return;

    const cachedProject = getPoolProject(effectiveMintAddress, poolId);
    if (cachedProject) {
      setProjectData(cachedProject);
      
      // Calculate rate from cached project
      if (cachedProject.rateMode === 0) {
        // Locked pool - static APY
        const rate = cachedProject.rateBpsPerYear?.toNumber?.() 
          ? cachedProject.rateBpsPerYear.toNumber() / 100 
          : (cachedProject.rateBpsPerYear || 0) / 100;
        setDynamicRate(rate);
      } else {
        // Variable pool - calculate APR
        const rewardRatePerSecond = BigInt(cachedProject.rewardRatePerSecond?.toString() || '0');
        const totalStaked = BigInt(cachedProject.totalStaked?.toString() || '0');
        
        if (totalStaked > 0n && rewardRatePerSecond > 0n) {
          if (rewardTokenMint && rewardTokenMint !== effectiveMintAddress) {
            const rewardDecimals = cachedProject.rewardTokenDecimals ?? 9;
            const stakingDecimals = tokenDecimals;
            const annualRewardTokens = Number(rewardRatePerSecond * BigInt(31_536_000)) / Math.pow(10, rewardDecimals);
            const totalStakedTokens = Number(totalStaked) / Math.pow(10, stakingDecimals);

            const rewardMint = rewardTokenMint || cachedProject.rewardTokenMint?.toString();
            const rewardPrice = rewardMint ? getPrice(rewardMint).price : null;
            const stakedPrice = getPrice(effectiveMintAddress!).price;

            if (rewardPrice && stakedPrice && totalStakedTokens > 0) {
              const usdApr = (annualRewardTokens * rewardPrice) / (totalStakedTokens * stakedPrice) * 100;
              setDynamicRate(usdApr);
            }

            const dailyRaw = rewardRatePerSecond * 86400n;
            const cachedStake = getCachedUserStake(effectiveMintAddress!, poolId);
            const userStakedBig = BigInt(cachedStake?.amount?.toString() || '0');
            if (userStakedBig > 0n && totalStaked > 0n) {
              const userDailyRaw = (dailyRaw * userStakedBig) / totalStaked;
              const daily = Number(userDailyRaw) / Math.pow(10, rewardDecimals);
              setDailyRewardRate(daily.toLocaleString('en-US', { maximumFractionDigits: 2 }));
            } else {
              setDailyRewardRate(null);
            }
          } else {
            const SECONDS_PER_YEAR = 31_536_000;
            const annualRewards = rewardRatePerSecond * BigInt(SECONDS_PER_YEAR);
            const apr = Number((annualRewards * 10000n) / totalStaked) / 100;
            setDynamicRate(apr);
          }
        }
      }
    }
  }, [effectiveMintAddress, poolId, getPoolProject, isPoolDataLoading, getPrice, rewardTokenMint, tokenDecimals]);

  // ✅ USER DATA: Use batched stake data from provider
  useEffect(() => {
    if (!connected || !publicKey || !effectiveMintAddress) {
      setUserStakedAmount(0);
      setUserStakeTimestamp(0);
      setStakeData(null);
      setSolBalance(0);
      return;
    }

    // Use batched SOL balance
    setSolBalance(getSolBalance());

    // Use cached user stake
    const cachedStake = getCachedUserStake(effectiveMintAddress, poolId);
    if (cachedStake) {
      const amountStr = cachedStake.amount?.toString() || '0';
      setUserStakedAmount(parseFloat(amountStr) / Math.pow(10, tokenDecimals));
      setUserStakeTimestamp(cachedStake.lastStakeTimestamp?.toNumber?.() || 0);
      setStakeData(cachedStake);
    } else {
      setStakeData(null);
      setUserStakedAmount(0);
      setUserStakeTimestamp(0);
    }
  }, [connected, publicKey, effectiveMintAddress, poolId, tokenDecimals, getSolBalance, getCachedUserStake]);

  // Use batched price from provider + FORCE fetch
  useEffect(() => {
  if (!effectiveMintAddress) {
    setPrice(null);
    setPriceChange24h(null);
    setPriceLoading(false);
    return;
  }

  const STABLECOINS: Record<string, number> = {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1.0,
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 1.0,
    'USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX': 1.0,
  };

  if (STABLECOINS[effectiveMintAddress]) {
    setPrice(STABLECOINS[effectiveMintAddress]);
    setPriceChange24h(0);
    setPriceLoading(false);
    return;
  }

  const updatePrice = () => {
    const cached = getPrice(effectiveMintAddress);
    if (cached.price !== null) {
      setPrice(prev => prev === cached.price ? prev : cached.price);
      setPriceChange24h(prev => prev === cached.change ? prev : cached.change);
      setPriceLoading(false);
    }
  };

  updatePrice();

  // LP token price fallback for farms
  if (isLPPool && lpUrl) {
    const checkLpPrice = async () => {
      const cached = getPrice(effectiveMintAddress);
      if (cached.price !== null) return;
      try {
        const poolIdMatch = lpUrl.match(/pool_id=([A-Za-z0-9]+)/);
        const pairMatch = lpUrl.match(/pair\/([A-Za-z0-9]+)/);
        const dexPoolId = poolIdMatch?.[1] || pairMatch?.[1];
        if (!dexPoolId) return;
        const res = await fetch(`/api/lp-price?poolId=${dexPoolId}`);
        const data = await res.json();
        if (data?.price > 0) {
          setPrice(data.price);
          setPriceLoading(false);
        }
      } catch {}
    };
    checkLpPrice();
  }

  const interval = setInterval(updatePrice, 2000);
  return () => clearInterval(interval);

}, [effectiveMintAddress, getPrice]);

    // USD APR for farms (uses local LP price from fallback)
  useEffect(() => {
    const hasDifferentReward = rewardTokenMint && rewardTokenMint !== effectiveMintAddress;
    if (!hasDifferentReward || !projectData || !price) return;
    const rewardRatePerSecond = BigInt(projectData.rewardRatePerSecond?.toString() || '0');
    const totalStaked = BigInt(projectData.totalStaked?.toString() || '0');
    if (totalStaked === 0n || rewardRatePerSecond === 0n) return;
    const rewardDecimals = projectData.rewardTokenDecimals ?? 9;
    const annualRewardTokens = Number(rewardRatePerSecond * BigInt(31_536_000)) / Math.pow(10, rewardDecimals);
    const totalStakedTokens = Number(totalStaked) / Math.pow(10, tokenDecimals);
    const rewardMint = rewardTokenMint || projectData.rewardTokenMint?.toString();
    const rewardPrice = rewardMint ? getPrice(rewardMint).price : null;
    if (rewardPrice && totalStakedTokens > 0) {
      const usdApr = (annualRewardTokens * rewardPrice) / (totalStakedTokens * price) * 100;
      console.log('[USD APR]', { rewardPrice, lpPrice: price, annualRewardTokens, totalStakedTokens, usdApr });
      setDynamicRate(usdApr);
    }
  }, [rewardTokenMint, effectiveMintAddress, projectData, price, tokenDecimals, getPrice]);

  const handleQuickSelect = (percent: number) => {
    if (openModal === "stake") {
      setAmount(Math.floor((tokenBalance * percent) / 100));
    } else if (openModal === "unstake") {
      const raw = (userStakedAmount * percent) / 100;
      setAmount(Math.floor(raw * Math.pow(10, tokenDecimals)) / Math.pow(10, tokenDecimals));
    }
  };

  const validateTransaction = (): { valid: boolean; error?: string } => {
    if (!effectiveMintAddress) {
      return { valid: false, error: "Pool not properly configured" };
    }

    if (!isInitialized) {
      return { valid: false, error: "Pool not initialized yet" };
    }

    if (isPaused) {
      return { valid: false, error: "Pool is paused" };
    }

    if (openModal === "stake") {
      if (poolEndInfo.hasEnded) {
        return { valid: false, error: "Pool has ended" };
      }
      if (amount <= 0) {
        return { valid: false, error: "Enter an amount" };
      }
      if (amount > tokenBalance) {
        return { valid: false, error: "Insufficient token balance" };
      }
      if (solBalance < 0.02) {
        return { valid: false, error: "You need at least 0.02 SOL to cover the transaction fee." };
      }
    }

    if (openModal === "unstake") {
      if (amount <= 0) {
        return { valid: false, error: "Enter an amount" };
      }
      if (amount > userStakedAmount) {
        return { valid: false, error: "Cannot unstake more than staked" };
      }
      if (lockupInfo.isLocked && !poolEndInfo.hasEnded) {
        return { valid: false, error: "Tokens are still locked" };
      }
      if (solBalance < 0.02) {
        return { valid: false, error: "You need at least 0.02 SOL to cover the transaction fee." };
      }
    }

    if (openModal === "claimRewards") {
      if (realtimeRewards <= 0) {
        return { valid: false, error: "No rewards to claim" };
      }
      if (solBalance < 0.02) {
        return { valid: false, error: "You need at least 0.02 SOL to cover the transaction fee." };
      }
    }

    if (openModal === "claimSelf" || openModal === "claimExternal") {
      if (reflectionBalance <= 0) {
        return { valid: false, error: "No reflections to claim" };
      }
      if (solBalance < 0.04) {
        return { valid: false, error: "You need at least 0.04 SOL to cover the two reflection transactions." };
      }
    }

    return { valid: true };
  };

  const handleConfirmAction = async () => {
    const validation = validateTransaction();
    if (!validation.valid) {
      showError(`❌ ${validation.error}`);
      return;
    }

    setIsProcessing(true);
    setIsBroadcasting(false);

    try {
      let txSignature: string;

      switch (openModal) {
        case "stake":
          const stakeAmount = toTokenAmount(amount, tokenDecimals);
          setIsConfirming(true);
          txSignature = await blockchainStake(effectiveMintAddress!, stakeAmount, poolId, undefined, engine);
          setIsConfirming(false);
          setIsBroadcasting(true);
          setLastStakeAmount(amount);
          showSuccess(`✅ Staked ${amount.toFixed(4)} ${symbol}! TX: ${txSignature.slice(0, 8)}...`);
          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'stake', { pool_name: name, symbol, amount, pool_id: poolId, value: price ? amount * price : undefined });
          }
          break;

        case "unstake":
          let finalUnstakeAmount = amount;
          if (engine !== 'current') {
            const dustAmount = 0.1;
            const isFullUnstake = amount >= userStakedAmount * 0.9999;
            const hasEnoughForDust = userStakedAmount > dustAmount * 2;
            finalUnstakeAmount = (isFullUnstake && hasEnoughForDust) 
              ? amount - dustAmount 
              : amount;
          }
          
          const unstakeAmount = toTokenAmount(finalUnstakeAmount, tokenDecimals);
          setIsConfirming(true);
          txSignature = await blockchainUnstake(effectiveMintAddress!, poolId, unstakeAmount, engine);
          setIsConfirming(false);
          setIsBroadcasting(true);
          setLastStakeAmount(amount);
          showSuccess(`✅ Unstaked ${amount.toFixed(4)} ${symbol}! TX: ${txSignature.slice(0, 8)}...`);
          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'unstake', { pool_name: name, symbol, amount, pool_id: poolId });
          }
          break;

        case "claimRewards":
          setIsConfirming(true);
          txSignature = await blockchainClaimRewards(effectiveMintAddress!, poolId, realtimeRewards, engine);
          setIsConfirming(false);
          setIsBroadcasting(true);
          setLastStakeAmount(realtimeRewards);
          setUserStakeTimestamp(Math.floor(Date.now() / 1000));
          showSuccess(`✅ Claimed rewards! TX: ${txSignature.slice(0, 8)}...`);
          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'claim_rewards', { pool_name: name, symbol, amount: realtimeRewards, pool_id: poolId });
          }
          // Wait for confirmation before refetch so stakeData reflects the claim
          await waitForConfirmation(txSignature);
          break;

        case "claimSelf":
          if (!hasSelfReflections && !hasExternalReflections) {
            showError("❌ Reflections not enabled for this pool");
            return;
          }
          closeModal();
          setReflectionClaimStep("refreshing");
          await refreshReflections(effectiveMintAddress!, poolId);
          await new Promise(r => setTimeout(r, 4000));
          setReflectionClaimStep("claiming");
          txSignature = await blockchainClaimReflections(effectiveMintAddress!, poolId);
          setReflectionClaimStep("success");
          showSuccess(`✅ Claimed reflections! TX: ${txSignature.slice(0, 8)}...`);
          await new Promise(r => setTimeout(r, 2000));
          setReflectionClaimStep("idle");
          break;

        case "claimExternal":
          if (!hasSelfReflections && !hasExternalReflections) {
            showError("❌ Reflections not enabled for this pool");
            return;
          }
          if (!externalReflectionMint) {
            showError("❌ External reflection mint not configured");
            return;
          }
          closeModal();
          setReflectionClaimStep("refreshing");
          await refreshReflections(effectiveMintAddress!, poolId);
          await new Promise(r => setTimeout(r, 4000));
          setReflectionClaimStep("claiming");
          txSignature = await blockchainClaimReflections(effectiveMintAddress!, poolId);
          setReflectionClaimStep("success");
          showSuccess(`✅ Claimed external reflections! TX: ${txSignature.slice(0, 8)}...`);
          await new Promise(r => setTimeout(r, 2000));
          setReflectionClaimStep("idle");
          break;

        default:
          throw new Error("Unknown action");
      }

      // Immediate refetch to update UI (especially lock state after claim)
      try {
        const [freshStake, freshProjectParallel] = await Promise.all([
          getUserStake(effectiveMintAddress!, poolId, engine),
          getProjectInfo(effectiveMintAddress!, poolId, engine),
        ]);
        if (freshProjectParallel) setProjectData(freshProjectParallel);
        if (freshStake) {
          setUserStakedAmount(parseFloat(freshStake.amount.toString()) / decimalsMultiplier);
          setUserStakeTimestamp(freshStake.lastStakeTimestamp?.toNumber() || Math.floor(Date.now() / 1000));
          setStakeData(freshStake);
        }
        } catch {}
      // Delayed refetch as backup (also handles reflections)
      setTimeout(async () => {
        try {
          const userStake = await getUserStake(effectiveMintAddress!, poolId, engine);
          const project = await getProjectInfo(effectiveMintAddress!, poolId, engine);
          
          if (userStake) {
            setUserStakedAmount(parseFloat(userStake.amount.toString()) / decimalsMultiplier);
            setUserStakeTimestamp(userStake.lastStakeTimestamp?.toNumber() || 0);
            setStakeData(userStake);
          }
          
          setProjectData(project);
          
          // ✅ Recalculate reflection balance with fresh data
          if (userStake && project && project.reflectionVault) {
            const userStakedLamports = userStake.amount ? parseFloat(userStake.amount.toString()) : 0;
            
            if (userStakedLamports > 0) {
              const userReflectionPerTokenPaid = userStake.reflectionPerTokenPaid 
                ? userStake.reflectionPerTokenPaid.toNumber() 
                : 0;
              
              const currentReflectionPerToken = project.reflectionPerTokenStored 
                ? project.reflectionPerTokenStored.toNumber() 
                : 0;

              // ✅ FIX: Read reflections_pending directly from blockchain
              const pendingReflectionsLamports = userStake.reflectionsPending 
                ? userStake.reflectionsPending.toNumber() 
                : 0;

              const isNativeSOL = project.reflectionToken?.toString() === 'So11111111111111111111111111111111111111112';

              const pendingReflections = pendingReflectionsLamports / LAMPORTS_PER_SOL;

              // ✅ NEW: Account for 0.003 SOL fixed buffer for Native SOL reflections
              const isNativeSOLReflections = project.reflectionToken?.toString() === 'So11111111111111111111111111111111111111112';

              let displayReflections = pendingReflections;

              if (isNativeSOLReflections) {
                try {
                  const vaultBalance = await connection.getBalance(new PublicKey(project.reflectionVault || project.key()));
                  const FIXED_BUFFER = 0.003;
                  const availableInVault = Math.max(0, (vaultBalance / LAMPORTS_PER_SOL) - FIXED_BUFFER);
                  displayReflections = Math.min(pendingReflections, availableInVault);
                } catch (error) {
                  console.error('Error fetching vault balance:', error);
                }
              }
                                                        
              setReflectionBalance(Math.max(0, displayReflections));

              console.log(`🔍 [POST-ACTION] Reflection balance updated:`, {
                action: openModal,
                pendingReflections,
                displayReflections,
              });
            }
          }
        } catch (error) {
          console.error("Error updating balances after action:", error);
        }
      }, 2000);

      if (openModal === "stake") {
        setSuccessModalType("stake");
        closeModal();
        setShowStakeSuccess(true);
      } else if (openModal === "unstake") {
        setSuccessModalType("unstake");
        closeModal();
        setShowStakeSuccess(true);
      } else if (openModal === "claimRewards") {
        setSuccessModalType("claim");
        closeModal();
        setShowStakeSuccess(true);
      } else {
        closeModal();
      }

    } catch (error: any) {
      // Handle "already processed" as success
      if (error.message?.includes("may have succeeded") || 
          error.message?.includes("already been processed") ||
          error.message?.includes("already processed")) {
        
        showSuccess(`✅ Transaction succeeded! Refreshing...`);
        
        setTimeout(async () => {
          try {
            const userStake = await getUserStake(effectiveMintAddress!, poolId, engine);
            if (userStake) {
              setUserStakedAmount(parseFloat(userStake.amount.toString()) / decimalsMultiplier);
              setUserStakeTimestamp(userStake.lastStakeTimestamp?.toNumber() || 0);
              setStakeData(userStake);
            }
            const project = await getProjectInfo(effectiveMintAddress!, poolId, engine);
            setProjectData(project);
            
            closeModal();
            window.location.reload();
          } catch (refreshError) {
            window.location.reload();
          }
        }, 1500);
        
        return;
      }
      
      // Handle other errors
      // Decode Anchor error codes
      const anchorErrorMap: Record<number, string> = {
        6000: "You don't have permission to do this.",
        6001: "The amount entered isn't valid.",
        6002: "You don't have enough tokens in your wallet.",
        6003: "This pool has been paused by the creator.",
        6004: "Deposits into this pool are temporarily paused.",
        6005: "Withdrawals from this pool are temporarily paused.",
        6006: "Reward claims from this pool are temporarily paused.",
        6007: "Your lock period hasn't expired yet. You can't unstake until it ends.",
        6008: "No active stake found for your wallet in this pool.",
        6009: "No rewards available to claim right now.",
        6010: "No reflections available to claim right now.",
        6011: "A calculation error occurred. Try a smaller amount.",
        6012: "This pool has already been set up.",
        6013: "This pool wasn't fully initialised. The second transaction may have been missed during creation.",
        6014: "The referral split percentage isn't valid.",
        6015: "This pool requires a reflection vault but none was provided.",
        6016: "A reflection token is required but wasn't set.",
        6017: "Reflections aren't enabled on this pool.",
        6018: "You don't have enough SOL to cover the transaction fee. Top up your SOL and try again.",
        6019: "The referral address doesn't match the one set for this pool.",
        6020: "The pool vault doesn't have enough tokens to complete this.",
        6021: "This pool has run out of reward tokens. The pool creator may need to top up rewards.",
        6022: "The reflection vault doesn't have enough tokens.",
        6023: "This pool needs at least one active staker first.",
        6024: "Pool duration must be greater than 0 days.",
        6025: "A calculation error occurred. Please try again.",
        6026: "The fee collector address isn't valid.",
        6027: "The APR is too high and exceeds system limits.",
        6028: "Wrong token type. This doesn't match the token this pool accepts.",
        6029: "The vault doesn't belong to this pool.",
        6030: "The withdrawal wallet doesn't match the one used when staking.",
        6031: "The reflection vault doesn't match this pool.",
        6032: "This stake doesn't belong to this pool.",
        6033: "A mismatch was detected in the pool totals. Please contact support.",
        6034: "A timing error was detected. Please try the transaction again.",
        6035: "This pool has ended and is no longer accepting deposits.",
        6036: "Invalid rate mode. Must be fixed APY or variable APR.",
        6037: "A required program is missing for this reflection-enabled pool.",
        6038: "Please click Refresh Reflections before claiming.",
        6039: "The reward rate is outside the allowed range.",
        6040: "The referral split exceeds the maximum of 100%.",
        6041: "No reflections to claim. Try refreshing reflections first.",
      };

      const errStr = String(error?.message ?? error);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16)
        : jsonMatch ? parseInt(jsonMatch[1])
        : anchorMatch ? parseInt(anchorMatch[1])
        : fallbackMatch ? parseInt(fallbackMatch[1])
        : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;

      let errorMessage = anchorError || "Transaction failed";
      if (!anchorError && errStr.includes("User rejected")) {
        errorMessage = "Transaction cancelled";
      } else if (!anchorError && errStr.includes("insufficient")) {
        errorMessage = "Insufficient balance";
      } else if (!anchorError && errStr.includes("LockupNotExpired")) {
        errorMessage = "Tokens still locked";
      } else if (errStr.includes("ProjectPaused")) {
        errorMessage = "Pool is paused";
      } else if (errStr.includes("DepositsPaused")) {
        errorMessage = "Deposits paused";
      } else if (errStr.includes("WithdrawalsPaused")) {
        errorMessage = "Withdrawals paused";
      } else if (errStr.includes("ClaimsPaused")) {
        errorMessage = "Claims paused";
      } else if (errStr.includes("PoolEnded")) {
        errorMessage = "Pool has ended";
      } else if (!anchorError && error.message) {
        errorMessage = error.message;
      }
      
      setErrorModalMessage(errorMessage);
      setShowErrorModal(true);
      setReflectionClaimStep("idle");
    } finally {
      setIsProcessing(false);
      setIsConfirming(false);
      setIsBroadcasting(false);
    }
  };

  const openModalWithFreshBalance = async (modal: typeof openModal) => {
    if (connected && publicKey) {
      try {
        const freshBalance = await connection.getBalance(publicKey);
        setSolBalance(freshBalance / 1e9);
        if (modal === "stake" && effectiveMintAddress) {
          balanceCache.delete(`${publicKey.toString()}-${effectiveMintAddress}`);
          const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(effectiveMintAddress) });
          if (accounts.value.length > 0) {
            setTokenBalance(accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0);
          }
        }
      } catch {}
    }
    setOpenModal(modal);
  };

  const closeModal = () => {
    setOpenModal(null);
    setAmount(0);
  };

  const getModalTitle = () => {
    switch (openModal) {
      case "stake": return "Stake Tokens";
      case "unstake": return "Unstake Tokens";
      case "claimRewards": return "Claim Staking Rewards";
      case "claimSelf":
      case "claimExternal": return "Claim Reflections";
      case "viewBalances": return "Your Balances";
      default: return "";
    }
  };

  const getModalColor = () => {
    switch (openModal) {
      case "stake": return "bg-blue-600 hover:bg-blue-700 active:bg-blue-800";
      case "unstake": return "bg-red-600 hover:bg-red-700 active:bg-red-800";
      case "claimRewards":
      case "claimSelf":
      case "claimExternal": return "bg-green-600 hover:bg-green-700 active:bg-green-800";
      default: return "bg-gray-600 hover:bg-gray-700";
    }
  };

  const handleRefreshReflections = async () => {
    if (!effectiveMintAddress) {
      showError("❌ Token mint missing");
      return;
    }

    if (isProcessing) {
      return;
    }

    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime;
    if (timeSinceLastRefresh < REFRESH_COOLDOWN) {
      const remainingCooldown = Math.ceil((REFRESH_COOLDOWN - timeSinceLastRefresh) / 1000);
      showWarning(`⏳ Please wait ${remainingCooldown}s before refreshing again`);
      return;
    }

    if (!hasSelfReflections && !hasExternalReflections) {
      showError("❌ Reflections not enabled for this pool");
      return;
    }

    setIsProcessing(true);
    setLastRefreshTime(now);
    
    try {
      showWarning("🔄 Refreshing reflections...");
      
      await refreshReflections(effectiveMintAddress, poolId);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const userStake = await getUserStake(effectiveMintAddress, poolId, engine);
      const project = await getProjectInfo(effectiveMintAddress, poolId, engine);
      
      if (userStake) {
        setUserStakedAmount(parseFloat(userStake.amount.toString()) / decimalsMultiplier);
        setUserStakeTimestamp(userStake.lastStakeTimestamp?.toNumber() || 0);
        setStakeData(userStake);
      }
      
      setProjectData(project);
      
      // ✅ Manually recalculate reflection balance with fresh data
      if (userStake && project && project.reflectionVault) {
        const userStakedLamports = userStake.amount ? parseFloat(userStake.amount.toString()) : 0;
        
        if (userStakedLamports > 0) {
          const userReflectionPerTokenPaid = userStake.reflectionPerTokenPaid 
            ? userStake.reflectionPerTokenPaid.toNumber() 
            : 0;
          
          const currentReflectionPerToken = project.reflectionPerTokenStored 
            ? project.reflectionPerTokenStored.toNumber() 
            : 0;

          // ✅ FIX: Read reflections_pending directly from blockchain
          const pendingReflectionsLamports = userStake.reflectionsPending 
            ? userStake.reflectionsPending.toNumber() 
            : 0;

          const isNativeSOL = project.reflectionToken?.toString() === 'So11111111111111111111111111111111111111112';

          const pendingReflections = pendingReflectionsLamports / LAMPORTS_PER_SOL;

          // ✅ NEW: Account for 0.003 SOL fixed buffer for Native SOL reflections
          const isNativeSOLReflections = project.reflectionToken?.toString() === 'So11111111111111111111111111111111111111112';

          let displayReflections = pendingReflections;

          if (isNativeSOLReflections) {
            try {
              const vaultBalance = await connection.getBalance(new PublicKey(project.reflectionVault || project.key()));
              const FIXED_BUFFER = 0.003;
              const availableInVault = Math.max(0, (vaultBalance / LAMPORTS_PER_SOL) - FIXED_BUFFER);
              displayReflections = Math.min(pendingReflections, availableInVault);
            } catch (error) {
              console.error('Error fetching vault balance:', error);
            }
          }
                                          
          console.log(`🔍 [REVSHARE] Reflection Calculation After Refresh:`, {
            userStakedLamports,
            userStakedTokens: userStakedLamports / decimalsMultiplier,
            currentRate: currentReflectionPerToken,
            pendingLamports: pendingReflectionsLamports,
            pendingTokens: pendingReflections,
            displayReflections: displayReflections,
            isNativeSOL: isNativeSOLReflections,
            reflectionToken: project.reflectionToken?.toString(),
          });

          setReflectionBalance(Math.max(0, displayReflections));
        }
      }
     
      showSuccess("✅ Reflections refreshed!");
      
    } catch (error: any) {
      showError(`❌ Error: ${error.message || "Failed to refresh"}`);
    } finally {
      setIsProcessing(false);
      setIsBroadcasting(false);
    }
  };

  const formatTimeRemaining = (seconds: number) => {
    if (seconds <= 0) return "Unlocked";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rate = poolEndInfo.hasEnded ? 0 : (dynamicRate || apy || apr || 0);
  
  // Store data in localStorage so Dashboard can read it
  useEffect(() => {
    if (poolId !== undefined && typeof window !== 'undefined') {
      const data = {
        userStakedAmount,
        realtimeRewards,
        userStakeTimestamp,
        poolId,
        name,
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(`pool_${poolId}`, JSON.stringify(data));
    }
  }, [userStakedAmount, realtimeRewards, poolId, name, userStakeTimestamp]);
  
  const rewardSymbol = rewards && rewards !== symbol ? rewards : symbol;
  const rewardsDisplay = realtimeRewards > 0 
    ? `${formatRewards(realtimeRewards)} ${rewardSymbol}` 
    : rewards || "0 " + symbol;

  const reflectionsDisplay = reflectionBalance > 0
    ? `${reflectionBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${reflectionTokenSymbol || 'REFLECT'}`
    : `0 ${reflectionTokenSymbol || 'REFLECT'}`;

  const isStakeDisabled = !connected || !effectiveMintAddress || !isInitialized || isPaused || poolEndInfo.hasEnded;
  const isUnstakeDisabled = !connected || !effectiveMintAddress || !isInitialized || (isPaused && !poolEndInfo.hasEnded) || (userStakedAmount <= 0 && !poolEndInfo.hasEnded) || (lockupInfo.isLocked && !poolEndInfo.hasEnded);
  const isClaimDisabled = !connected || !effectiveMintAddress || !isInitialized || isPaused || realtimeRewards <= 0;
  const isClaimReflectionsDisabled = !connected || !effectiveMintAddress || !isInitialized || isPaused || reflectionBalance <= 0;

  return (
    <>
      <div 
        className="border transition-all duration-300 rounded-2xl p-3 sm:p-4 flex flex-col gap-2 sm:gap-3 relative group hover:-translate-y-0.5"
        style={{ background: 'linear-gradient(160deg, rgba(251,87,255,0.04) 0%, rgba(0,0,0,0.25) 100%)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(251,87,255,0.3)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
      >
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl pointer-events-none" style={{ background: 'linear-gradient(90deg, #9b00b0, #fb57ff)' }} />
        {/* Hover glow */}
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(251,87,255,0.07) 0%, transparent 65%)' }} />
        {/* Left side badges - positioned above the card */}
        {(showPoolNumber || featured) && (
          <div className="absolute -top-2 left-2 sm:-top-2 sm:left-3 flex flex-wrap gap-1 items-start z-20">
            {showPoolNumber && (
              <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm" style={{ background: 'rgba(251, 87, 255, 0.2)', borderColor: 'rgba(251, 87, 255, 0.5)', color: '#fb57ff' }}>
                Pool #{poolId}
              </div>
            )}
            {featured && (
              <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm flex items-center gap-1" style={{ background: 'rgba(251, 87, 255, 0.2)', borderColor: 'rgba(251, 87, 255, 0.5)', color: '#fb57ff' }}>
                ⭐ <span className="hidden sm:inline">Featured</span>
              </div>
            )}
          </div>
        )}

        {/* Right side status badges - inside the card */}
        <div className="absolute top-2 right-2 sm:top-3 sm:right-3 flex flex-wrap gap-1 items-start justify-end z-20">
          {/* Verified/Unverified Badge */}
          {effectiveMintAddress && <TraxrBadge mint={effectiveMintAddress} />}
          <SafetyBadge score={safetyScore} details={safetyDetails} />
          {false ? (
            <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm bg-green-500/20 border-green-500/50 text-green-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Verified</span>
            </div>
          ) : (
            <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm hidden">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="hidden sm:inline">Unverified</span>
            </div>
          )}
          {!effectiveMintAddress && (
              <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm bg-red-500/20 border-red-500/50 text-red-400">
                ⚠️ Error
              </div>
            )}
            {!isInitialized && effectiveMintAddress && (
              <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm bg-white/[0.05] border-white/[0.1] text-gray-400">
                ⏳ Initializing
              </div>
            )}
            {isPaused && (
              <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm bg-white/[0.05] border-white/[0.1] text-gray-400">
                ⏸ Paused
              </div>
            )}
            {poolEndInfo.hasEnded && (
              <div className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs font-semibold border backdrop-blur-sm bg-white/[0.05] border-white/[0.1] text-gray-400">
                🔴 Ended
              </div>
            )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 relative z-10 pt-6 sm:pt-7">
          <div className="relative flex-shrink-0">
            {logo ? (
              <img src={logo} alt={name} width={56} height={56} loading="lazy" decoding="async" className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full border-2 border-white/[0.1]" />
            ) : (
              <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white font-bold text-sm sm:text-base md:text-lg" style={{ background: 'rgba(251, 87, 255, 0.2)' }}>
                {symbol.slice(0, 2)}
              </div>
            )}
            {type === "locked" ? (
              <Lock className="absolute -bottom-0.5 -right-0.5 sm:-bottom-1 sm:-right-1 w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5 text-white rounded-full p-0.5" style={{ background: '#ef4444' }} />
            ) : (
              <Unlock className="absolute -bottom-0.5 -right-0.5 sm:-bottom-1 sm:-right-1 w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5 text-white rounded-full p-0.5" style={{ background: '#22c55e' }} />
            )}
          </div>
          
          <div className="flex-1 min-w-0 overflow-hidden">
            <h2 className="text-sm sm:text-base md:text-lg font-bold text-white truncate leading-tight">{name}</h2>
            <p className="text-gray-400 text-[10px] sm:text-xs leading-tight">{symbol}</p>
            
            <div className="min-h-[42px] sm:min-h-[46px] mt-0.5 sm:mt-1">
              {priceLoading ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#fb57ff' }}></div>
                  <span className="text-[10px] text-gray-400">Fetching price...</span>
                </div>
              ) : price !== null ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-white">
                      ${price.toFixed(price < 0.000001 ? 10 : price < 0.0001 ? 8 : price < 0.01 ? 6 : price < 1 ? 4 : 2)}
                    </p>
                    {priceChange24h !== null && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        priceChange24h >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {priceChange24h >= 0 ? '↑' : '↓'} {Math.abs(priceChange24h).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {marketCap !== null && (
                    <p className="text-[10px] text-gray-400">
                      MC ${marketCap >= 1_000_000 ? (marketCap / 1_000_000).toFixed(1) + 'M' : (marketCap / 1_000).toFixed(0) + 'K'}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[10px] text-amber-400">Price unavailable</p>
              )}
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <div className="p-2 sm:p-3 rounded-lg text-center bg-white/[0.02] border border-white/[0.05] min-h-[60px] sm:min-h-[68px]">
            {rewardTokenMint && rewardTokenMint !== effectiveMintAddress && dynamicRate === null && !dailyRewardRate ? (
              (() => {
                const rps = BigInt(projectData?.rewardRatePerSecond?.toString() || '0');
                const rd = projectData?.rewardTokenDecimals ?? 9;
                const totalDaily = rps > 0n ? Number(rps * 86400n) / Math.pow(10, rd) : 0;
                return totalDaily > 0 ? (
                  <>
                    <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-400 uppercase tracking-wide mb-0.5">
                      Daily Rewards
                    </p>
                    <p className="text-lg sm:text-xl font-bold leading-none truncate" style={{ color: '#fb57ff' }} title={`${totalDaily.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${rewards || symbol} / day`}>
                      {totalDaily.toLocaleString('en-US', { maximumFractionDigits: 2 })} {rewards || symbol}
                    </p>
                    <p className="text-[9px] text-gray-500 mt-0.5">total pool emission</p>
                  </>
                ) : (
                  <>
                    <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-400 uppercase tracking-wide mb-0.5">APR</p>
                    <p className="text-xl sm:text-2xl font-bold leading-none truncate" style={{ color: '#fb57ff' }}>--%</p>
                  </>
                );
              })()
            ) : (
              <>
                <p className="text-[9px] sm:text-[10px] md:text-xs text-gray-400 uppercase tracking-wide mb-0.5">
                  APR
                </p>
                <p className="text-xl sm:text-2xl font-bold leading-none truncate" style={{ color: '#fb57ff' }} title={`${typeof rate === 'number' ? rate.toFixed(2) : rate ?? "-"}%`}>
                  {typeof rate === 'number' ? rate.toFixed(2) : rate ?? "-"}%
                </p>
                {dailyRewardRate && (
                  <p className="text-[9px] text-gray-400 mt-0.5">
                    {dailyRewardRate} {rewards || symbol}/day
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Total Staked & Contract Address */}
        <div className={`grid grid-cols-2 gap-2 text-xs sm:text-sm relative z-10 ${compact ? 'hidden' : ''}`}>
          <div className="bg-white/[0.025] p-2 rounded-xl border border-white/[0.05] min-h-[52px]">
            <p className="text-gray-400 text-[9px] sm:text-[10px] md:text-xs mb-0.5 leading-tight">Total Staked</p>
            <p className="font-semibold text-[11px] sm:text-xs md:text-sm leading-tight truncate" style={{ color: '#fb57ff' }}>
              {projectData?.totalStaked 
                ? `${(Number(projectData.totalStaked.toString()) / Math.pow(10, tokenDecimals)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}` 
                : "0 " + symbol}
            </p>
          </div>
          
          <div 
            className="bg-white/[0.02] p-2 rounded-lg border border-white/[0.05] cursor-pointer hover:bg-white/[0.04] transition-colors"
            onClick={() => effectiveMintAddress && copyToClipboard(effectiveMintAddress)}
            title={effectiveMintAddress || "No address"}
          >
            <p className="text-gray-400 text-[9px] sm:text-[10px] md:text-xs mb-0.5 leading-tight">Contract</p>
            <p className="text-white font-semibold text-[11px] sm:text-xs md:text-sm leading-tight flex items-center gap-1">
              <span className="font-mono truncate">
                {effectiveMintAddress ? `${effectiveMintAddress.slice(0, 4)}...${effectiveMintAddress.slice(-4)}` : "-"}
              </span>
              {copied ? (
                <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
              ) : (
                <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </p>
          </div>
        </div>

        {/* Your Stake & Lock Period - EXISTING */}
        <div className={`grid grid-cols-2 gap-2 text-xs sm:text-sm relative z-10 ${compact ? 'hidden' : ''}`}>
          <div className="bg-white/[0.025] p-2 rounded-xl border border-white/[0.05] min-h-[52px]">
            <p className="text-gray-400 text-[9px] sm:text-[10px] md:text-xs mb-0.5 leading-tight">Your Stake</p>
            <p className="text-white font-semibold text-[11px] sm:text-xs md:text-sm leading-tight truncate">
              {connected ? `${displayStakedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol}` : "-"}
            </p>
          </div>
          
          <div className="bg-white/[0.02] p-2 rounded-lg border border-white/[0.05]">
            <p className="text-gray-400 text-[9px] sm:text-[10px] md:text-xs mb-0.5 leading-tight">
              {type === "locked" && lockupInfo.isLocked ? "Unlocks In" : "Lock Period"}
            </p>
            <p className="text-white font-semibold text-[11px] sm:text-xs md:text-sm leading-tight truncate">
              {type === "locked" ? (
                lockupInfo.isLocked ? (
                  <span className="flex items-center gap-1" style={{ color: '#fb57ff' }}>
                    <Clock className="w-3 h-3" />
                    {formatTimeRemaining(lockupInfo.remainingSeconds)}
                  </span>
                ) : userStakedAmount > 0 ? (
                  <span style={{ color: '#fb57ff' }}>✓ Unlocked</span>
                ) : (
                  lockPeriod && lockPeriod !== '0' ? `${lockPeriod}d` : "Unlocked"
                )
              ) : "Flex"}
            </p>
          </div>
        </div>

        {/* Pool Ended Message */}
        {!compact && poolEndInfo.hasEnded && (
          <div className="p-2 rounded-lg relative z-10 border bg-red-500/10 border-red-500/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <XCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 text-red-400" />
                <span className="text-[9px] sm:text-[10px] md:text-xs text-red-400">Pool Ended</span>
              </div>
              <span className="font-bold text-[11px] sm:text-xs md:text-sm text-red-400">
                Claim & Withdraw
              </span>
            </div>
            {poolEndInfo.endsAt && (
              <p className="text-[8px] sm:text-[9px] text-gray-400 mt-1">
                Ended: {poolEndInfo.endsAt.toLocaleDateString()} at {poolEndInfo.endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}

        {!compact && (blockchainPoolEndTime || poolEndTime) && !poolEndInfo.hasEnded && (
          <div className={`p-2 rounded-lg relative z-10 border ${
            poolEndInfo.status === 'critical' 
              ? 'bg-red-500/10 border-red-500/30' 
              : poolEndInfo.status === 'warning'
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-white/[0.02] border-white/[0.05]'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <Clock className={`w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0 ${
                  poolEndInfo.status === 'critical' 
                    ? 'text-red-400' 
                    : poolEndInfo.status === 'warning'
                    ? 'text-yellow-400'
                    : 'text-gray-400'
                }`} />
                <span className={`text-[9px] sm:text-[10px] md:text-xs ${
                  poolEndInfo.status === 'critical' 
                    ? 'text-red-400' 
                    : poolEndInfo.status === 'warning'
                    ? 'text-yellow-400'
                    : 'text-gray-400'
                }`}>
                  {poolEndInfo.status === 'critical' ? 'Ending Soon!' : 'Pool Ends In'}
                </span>
              </div>
              <span className={`font-bold text-[11px] sm:text-xs md:text-sm ${
                poolEndInfo.status === 'critical' 
                  ? 'text-red-400' 
                  : poolEndInfo.status === 'warning'
                  ? 'text-yellow-400'
                  : 'text-white'
              }`}>
                {formatTimeRemaining(poolEndInfo.remainingSeconds)}
              </span>
            </div>
            {poolEndInfo.endsAt && (
              <p className="text-[8px] sm:text-[9px] text-gray-400 mt-1">
                {poolEndInfo.endsAt.toLocaleDateString()} at {poolEndInfo.endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}
        <button
          onClick={() => openModalWithFreshBalance("viewBalances")}
          style={{ display: compact ? 'none' : undefined }}
          disabled={!connected}
          className="w-full bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.05] p-2 rounded-lg relative z-10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-white">View Balances</span>
          </div>
          <div className="flex items-center gap-2">
            {realtimeRewards > 0 && (
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#fb57ff' }}></span>
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#fb57ff' }}></span>
              </div>
            )}
            {reflectionBalance > 0 && (
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#fb57ff' }}></span>
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: '#fb57ff' }}></span>
              </div>
            )}
          </div>
        </button>

          {!compact && isLPPool && lpUrl && (
          <ZapPanel
            lpUrl={lpUrl}
            lpMint={effectiveMintAddress}
            lpPoolId={lpPoolId}
            lpDex={lpDex}
            poolName={name}
            symbol={symbol}
            onComplete={() => openModalWithFreshBalance("stake")}
            compact
          />
        )}
        {!compact && !isLPPool && effectiveMintAddress && (
          <QuickBuyPanel tokenMint={effectiveMintAddress} tokenSymbol={symbol} poolName={name} poolId={poolId} compact />
        )}
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2 relative z-10 min-h-[80px] [&>button]:h-[32px] [&>button]:sm:h-[36px]">
          <button
            onClick={() => { openModalWithFreshBalance("stake"); if (typeof window !== 'undefined' && window.gtag) window.gtag('event', 'stake_modal_open', { pool_name: name, symbol, pool_id: poolId }); }}
            disabled={isStakeDisabled}
            className="text-white py-2 px-2 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[36px] leading-tight"
            style={{ background: isStakeDisabled ? 'rgba(255,255,255,0.05)' : 'linear-gradient(45deg, black, #fb57ff)' }}
            title={isStakeDisabled ? (
              !isInitialized ? "Pool not initialized" :
              isPaused ? "Pool paused" :
              poolEndInfo.hasEnded ? "Pool ended" :
              "Connect wallet"
            ) : ""}
          >
            Stake
          </button>

          <button
            onClick={() => { openModalWithFreshBalance("unstake"); if (typeof window !== 'undefined' && window.gtag) window.gtag('event', 'unstake_modal_open', { pool_name: name, symbol, pool_id: poolId }); }}
            disabled={isUnstakeDisabled}
            className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white py-2 px-2 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[36px] leading-tight"
            title={isUnstakeDisabled ? (
              lockupInfo.isLocked ? `Locked for ${formatTimeRemaining(lockupInfo.remainingSeconds)}` :
              userStakedAmount <= 0 ? "No stake" :
              "Connect wallet"
            ) : ""}
          >
            Unstake
          </button>

          <button
            onClick={() => openModalWithFreshBalance("claimRewards")}
            disabled={isClaimDisabled}
            className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white py-2 px-2 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[36px] leading-tight"
          >
            Rewards
          </button>

          <button
            onClick={() => (hasSelfReflections || hasExternalReflections) && openModalWithFreshBalance(hasSelfReflections ? "claimSelf" : "claimExternal")}
            disabled={!(hasSelfReflections || hasExternalReflections) || isClaimReflectionsDisabled}
            className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white py-2 px-2 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[36px] leading-tight"
          >
            Reflect
          </button>
        </div>

        <a
          href={`/pool/${id}`}
          className="relative z-10 w-full text-center py-2 px-2 rounded-lg text-xs font-medium text-gray-300 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] hover:border-[#fb57ff]/40 hover:text-white transition-all"
        >
          More Details
        </a>

        {!connected && (
          <div className="relative z-10 flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-gray-400 bg-white/[0.02] border border-white/[0.05] p-1.5 sm:p-2 rounded leading-tight">
            <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
            <span>Connect wallet to interact</span>
          </div>
        )}
      </div>

      {/* MODAL */}
      {openModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50 p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white/[0.02] border border-white/[0.05] p-3 sm:p-5 rounded-2xl shadow-2xl w-full max-w-[calc(100vw-24px)] sm:max-w-2xl max-h-[92vh] overflow-y-auto overscroll-contain animate-in zoom-in-95 duration-200" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2">
                {openModal === "stake" && "💰"}
                {openModal === "unstake" && "📤"}
                {(openModal === "claimRewards" || openModal === "claimSelf" || openModal === "claimExternal") && "🎁"}
                {openModal === "viewBalances" && "📊"}
                <span className="truncate">{getModalTitle()}</span>
              </h2>
              <button
                onClick={closeModal}
                disabled={isProcessing}
                className="text-gray-400 hover:text-white transition-colors text-2xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2"
              >
                ✕
              </button>
            </div>

            <div className="bg-white/[0.02] border border-white/[0.05] p-2.5 sm:p-3 rounded-lg mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3">
              {logo && <img src={logo} alt={name} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-white font-semibold text-sm sm:text-base truncate">{name}</p>
                <p className="text-gray-400 text-xs sm:text-sm">{symbol}</p>
              </div>
            </div>

            {(openModal === "stake" || openModal === "unstake") && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
              <div className="flex flex-col gap-2 sm:gap-3">
                <div className="p-2.5 sm:p-4 bg-white/[0.02] border border-white/[0.05] rounded-lg">
                  <div className="flex items-center justify-between mb-0.5 sm:mb-2">
                    <p className="text-gray-400 text-xs sm:text-sm font-semibold leading-tight">
                      {openModal === "stake" ? "Available Balance" : "Staked Amount"}
                    </p>
                    {balanceLoading && <LoadingSpinner size="sm" />}
                  </div>
                  <p className="text-white font-bold text-lg sm:text-2xl break-all leading-tight">
                    {openModal === "stake" 
                      ? `${tokenBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`
                      : `${userStakedAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`
                    }
                  </p>
                  {price && (
                    <p className="text-gray-400 text-xs sm:text-sm mt-0 sm:mt-1 leading-tight">
                      ≈ ${((openModal === "stake" ? tokenBalance : userStakedAmount) * price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-gray-300 mb-1 sm:mb-2">
                    Input amount to {openModal}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount === 0 ? "" : amount}
                      onChange={(e) => setAmount(e.target.value === "" ? 0 : Number(e.target.value))}
                      className="w-full p-2.5 sm:p-3 pr-12 sm:pr-16 rounded-lg bg-white/[0.02] text-white border border-white/[0.05] focus:border-[#fb57ff] focus:outline-none text-base sm:text-lg font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="0.00"
                      disabled={isProcessing}
                      max={openModal === "stake" ? tokenBalance : userStakedAmount}
                    />
                    <span className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-xs sm:text-sm">
                      {symbol}
                    </span>
                  </div>
                </div>

                {openModal === "stake" && amount > 0 && (
                  <details open={typeof window !== 'undefined' && window.innerWidth >= 640} className="group p-3 sm:p-4 bg-white/[0.02] border border-white/[0.05] rounded-lg text-xs sm:text-sm">
                    <summary className="flex items-center justify-between cursor-pointer list-none sm:hidden mb-2">
                      <span className="font-semibold" style={{ color: '#fb57ff' }}>You'll Stake: {feeCalculation.amountAfterFee.toFixed(2)} {symbol}</span>
                      <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </summary>
                    <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Stake Amount:</span>
                      <span className="text-white font-semibold">{amount.toFixed(4)} {symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Token Fee ({platformFeePercent}%):</span>
                      <span className="text-yellow-400">-{feeCalculation.tokenFee.toFixed(4)} {symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">SOL Fee:</span>
                      <span className="text-yellow-400">-{flatSolFee} SOL</span>
                    </div>
                    <div className="border-t border-white/[0.05] pt-2 flex justify-between">
                      <span className="font-semibold" style={{ color: '#fb57ff' }}>You'll Stake:</span>
                      <span className="font-bold" style={{ color: '#fb57ff' }}>{feeCalculation.amountAfterFee.toFixed(4)} {symbol}</span>
                    </div>
                    </div>
                  </details>
                )}

                </div>
                <div className="flex flex-col gap-3">
                {openModal === "stake" && amount > 0 && dynamicRate && poolEndInfo.remainingSeconds > 0 && (
                  <details open={typeof window !== 'undefined' && window.innerWidth >= 640} className="group p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <summary className="flex items-center justify-between cursor-pointer list-none sm:hidden">
                      <p className="text-xs text-blue-400 font-medium">📊 Expected Returns</p>
                      <svg className="w-4 h-4 text-blue-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </summary>
                    <div className="hidden sm:flex items-center justify-between mb-2">
                      <p className="text-xs text-blue-400 font-medium">📊 Expected Returns</p>
                      <a href="/blog/apy-vs-apr-crypto-explained" target="_blank" className="text-[10px] text-blue-400 hover:underline">
                        How is this calculated? →
                      </a>
                    </div>
                    <div className="space-y-1 text-xs sm:text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Pool APR:</span>
                        <span className="text-white">{dynamicRate.toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Pool Time Remaining:</span>
                        <span className="text-white">{Math.floor(poolEndInfo.remainingSeconds / 86400)} days</span>
                      </div>
                      <div className="flex justify-between border-t border-blue-500/20 pt-1 mt-1">
                        <span className="text-blue-400 font-medium">Your Return:</span>
                        <span className="text-blue-400 font-bold">
                          +{rewardTokenMint && rewardTokenMint !== effectiveMintAddress && price && projectData?.rewardRatePerSecond
                            ? (() => {
                                const rps = BigInt(projectData.rewardRatePerSecond.toString());
                                const ts = BigInt(projectData.totalStaked?.toString() || '1');
                                const rd = projectData.rewardTokenDecimals ?? 9;
                                const stakeRaw = BigInt(Math.round(feeCalculation.amountAfterFee * Math.pow(10, tokenDecimals)));
                                const userDaily = ts > 0n ? Number(rps * 86400n * stakeRaw / ts) / Math.pow(10, rd) : 0;
                                return (userDaily * (poolEndInfo.remainingSeconds / 86400)).toFixed(2);
                              })()
                            : ((feeCalculation.amountAfterFee * (dynamicRate / 100) * (poolEndInfo.remainingSeconds / 86400)) / 365).toFixed(2)} {rewards && rewards !== symbol ? rewards : symbol}
                          <span className="text-[10px] text-gray-400 ml-1">
                            ({((dynamicRate * (poolEndInfo.remainingSeconds / 86400)) / 365).toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2">
                      Based on {Math.floor(poolEndInfo.remainingSeconds / 86400)} days remaining. Actual returns may vary.
                    </p>
                  </details>
                )}

                <div className="grid grid-cols-3 gap-2">
                  {[25, 50, 100].map((percent) => (
                    <button
                      key={percent}
                      onClick={() => handleQuickSelect(percent)}
                      disabled={isProcessing}
                      className="px-2 py-2.5 sm:py-2 bg-white/[0.05] hover:bg-white/[0.08] active:bg-white/[0.1] border border-white/[0.05] rounded-lg text-xs sm:text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 min-h-[44px]"
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(251, 87, 255, 0.3)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>

                <div>
                  <input
                    type="range"
                    min="0"
                    max={openModal === "stake" ? Math.floor(tokenBalance) : userStakedAmount}
                    step={openModal === "stake" ? 1 : (userStakedAmount / 100)}
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    disabled={isProcessing}
                    className="w-full h-2 bg-white/[0.05] rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: '#fb57ff' }}
                  />
                  <div className="flex justify-between text-[10px] sm:text-xs text-gray-400 mt-1">
                    <span>0</span>
                    <span>{(openModal === "stake" ? tokenBalance : userStakedAmount).toFixed(2)}</span>
                  </div>
                </div>

                {openModal === "stake" && amount > 0 && solBalance < 0.02 && (
                  <div className="p-2.5 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs sm:text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>You need at least 0.02 SOL to cover the transaction fee (you have {solBalance.toFixed(5)})</span>
                  </div>
                )}

                {openModal === "stake" && amount > tokenBalance && (
                  <div className="p-2.5 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs sm:text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Insufficient balance</span>
                  </div>
                )}

                {openModal === "unstake" && lockupInfo.isLocked && (
                  <div className="p-2.5 sm:p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2 text-yellow-400 text-xs sm:text-sm">
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    <span>Unlocks in {formatTimeRemaining(lockupInfo.remainingSeconds)}</span>
                  </div>
                )}

                {openModal === "unstake" && amount > userStakedAmount && (
                  <div className="p-2.5 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs sm:text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Cannot unstake more than staked amount</span>
                  </div>
                )}
                {openModal === "unstake" && solBalance < 0.02 && (
                  <div className="p-2.5 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs sm:text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>You need at least 0.02 SOL to cover the transaction fee (you have {solBalance.toFixed(5)})</span>
                  </div>
                )}
                {openModal === "unstake" && realtimeRewards > 0 && !lockupInfo.isLocked && (
                  <div className="p-2.5 sm:p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-blue-400 text-xs sm:text-sm">
                    💡 You have unclaimed rewards! After unstaking, click "Claim Rewards" to collect them.
                  </div>
                )}
                </div>
              </div>
            )}

            {openModal === "claimRewards" && solBalance < 0.02 && (
              <div className="mb-3 p-2.5 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs sm:text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>You need at least 0.02 SOL to cover the transaction fee (you have {solBalance.toFixed(5)})</span>
              </div>
            )}
            {(openModal === "claimSelf" || openModal === "claimExternal") && solBalance < 0.04 && (
              <div className="mb-3 p-2.5 sm:p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-xs sm:text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>You need at least 0.04 SOL to cover the two reflection transactions (you have {solBalance.toFixed(5)})</span>
              </div>
            )}
            {(openModal === "claimRewards" || openModal === "claimSelf" || openModal === "claimExternal") && (
              <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-green-400 text-xs sm:text-sm mb-1.5 sm:mb-2">
                  {openModal === "claimRewards" ? "Available to claim:" : "Available reflections to claim:"}
                </p>
                <p className="text-white font-bold text-lg sm:text-xl break-all">
                  {openModal === "claimRewards" ? rewardsDisplay : reflectionsDisplay}
                </p>
                {openModal === "claimRewards" && realtimeRewards > 0 && (() => {
                  const rewardMint = rewardTokenMint || projectData?.rewardTokenMint?.toString();
                  const rPrice = engine === 'current' && rewardMint ? getPrice(rewardMint).price : price;
                  return rPrice ? (
                    <p className="text-gray-400 text-xs sm:text-sm mt-1">
                      ≈ ${(realtimeRewards * rPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  ) : null;
                })()}
                {openModal === "claimRewards" && type === "locked" && engine === 'legacy' && (
                  <div className="mt-3 p-2 border border-red-500/50 rounded-lg space-y-1 animate-pulse" style={{ background: 'rgba(239, 68, 68, 0.15)' }}>
                    <p className="text-yellow-400 text-xs font-semibold">⚠️ Claiming rewards restarts your lock timer.</p>
                    <p className="text-blue-300 text-xs mt-1">
                      <strong>Staying in the pool?</strong> Claim freely, your timer resets.
                    </p>
                    <p className="text-blue-300 text-xs">
                      <strong>Want to unstake?</strong> Unstake first, then claim rewards.
                    </p>
                  </div>
                )}
                {(openModal === "claimSelf" || openModal === "claimExternal") && stakeData?.withdrawalWallet && openModal === "claimExternal" && (
                  <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-yellow-400 text-xs mb-1">⚠️ Withdrawal Wallet:</p>
                    <p className="text-white text-xs font-mono break-all">
                      {stakeData.withdrawalWallet.toString()}
                    </p>
                  </div>
                )}
                
                {(openModal === "claimSelf" || openModal === "claimExternal") && (
                  <div className="mt-3">
                    <button
                      onClick={handleRefreshReflections}
                      disabled={isProcessing || !effectiveMintAddress}
                      className="w-full px-3 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(251, 87, 255, 0.3)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                    >
                      <Sparkles className="w-4 h-4" style={{ color: '#fb57ff' }} />
                      {isProcessing ? "Refreshing..." : "🔄 Refresh Reflections"}
                    </button>
                    <p className="text-gray-400 text-xs mt-1 text-center">
                      Click to update reflection calculations
                    </p>
                  </div>
                )}

              </div>
            )}

            {openModal === "viewBalances" && (
              <div className="space-y-4">
                {/* Accumulating Rewards */}
                <div className="bg-green-500/10 border border-green-500/30 p-4 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Coins className="w-5 h-5 text-green-400" />
                    <span className="text-sm font-semibold text-gray-300">Accumulating Rewards</span>
                    {realtimeRewards > 0 && (
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse ml-auto" />
                    )}
                  </div>
                  <div className="text-green-400 font-bold text-2xl break-all mb-2">
                    {rewardsDisplay}
                  </div>
                  {realtimeRewards > 0 && (() => {
                    const rewardMint = rewardTokenMint || projectData?.rewardTokenMint?.toString();
                    const rPrice = engine === 'current' && rewardMint ? getPrice(rewardMint).price : price;
                    return rPrice ? (
                      <div className="text-gray-400 text-sm">
                        ≈ ${(realtimeRewards * rPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* Reflection Balance */}
                {(hasSelfReflections || hasExternalReflections) && (
                  <div className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5" style={{ color: '#fb57ff' }} />
                        <span className="text-sm font-semibold text-gray-300">Reflection Balance</span>
                        {reflectionLoading && <LoadingSpinner size="sm" />}
                      </div>
                      <button
                        onClick={handleRefreshReflections}
                        disabled={!connected || !effectiveMintAddress || !isInitialized || isProcessing || !(hasSelfReflections || hasExternalReflections)}
                        className="p-2 hover:bg-white/[0.05] rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        title={(hasSelfReflections || hasExternalReflections) ? "Refresh reflection calculations" : "Reflections not enabled for this pool"}
                        type="button"
                      >
                        <Repeat className="w-4 h-4 text-gray-400 hover:text-white" />
                      </button>
                    </div>
                    <div className="font-bold text-2xl break-all" style={{ color: '#fb57ff' }}>
                      {reflectionBalance > 0 
                        ? `${reflectionBalance.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })} ${reflectionTokenSymbol || 'REFLECT'}`
                        : `0.000000 ${reflectionTokenSymbol || 'REFLECT'}`
                      }
                    </div>
                  </div>
                )}

                {/* No Reflections Message */}
                {!hasSelfReflections && !hasExternalReflections && (
                  <div className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-lg text-center">
                    <p className="text-gray-400 text-sm">No reflections available for this pool</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 sm:gap-3">
              {openModal === "viewBalances" ? (
                <button
                  onClick={closeModal}
                  className="w-full px-3 sm:px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] active:bg-white/[0.1] border border-white/[0.05] rounded-lg text-sm sm:text-base font-semibold transition-all min-h-[48px]"
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(251, 87, 255, 0.3)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    onClick={closeModal}
                    disabled={isProcessing}
                    className="flex-1 px-3 sm:px-4 py-3 bg-white/[0.05] hover:bg-white/[0.08] active:bg-white/[0.1] border border-white/[0.05] rounded-lg text-sm sm:text-base font-semibold transition-all disabled:opacity-50 min-h-[48px]"
                    onMouseEnter={(e) => !isProcessing && (e.currentTarget.style.borderColor = 'rgba(251, 87, 255, 0.3)')}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmAction}
                    disabled={isProcessing || !validateTransaction().valid}
                    className="flex-1 px-3 sm:px-4 py-3 rounded-lg text-sm sm:text-base font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px] text-white"
                    style={{ background: (isProcessing || !validateTransaction().valid) ? 'rgba(255,255,255,0.05)' : 'linear-gradient(45deg, black, #fb57ff)' }}
                  >
                    {isProcessing ? (
                      <>
                        <LoadingSpinner size="sm" />
                        <span>
                          {openModal === "stake" && "Staking in progress..."}
                          {openModal === "unstake" && "Withdrawal in progress..."}
                          {openModal === "claimRewards" && "Claiming rewards..."}
                          {(openModal === "claimSelf" || openModal === "claimExternal") && "Claiming reflections..."}
                        </span>
                      </>
                    ) : (
                      <>
                        Confirm
                        {(openModal === "stake" || openModal === "unstake") && amount > 0 && (
                          <span className="hidden sm:inline"> {amount.toFixed(4)} {symbol}</span>
                        )}
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
            {(isBroadcasting || isConfirming) && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
                <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
                  <div className="flex justify-center mb-6">
                    <div className="relative w-20 h-20">
                      <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                      <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                      <div className="absolute inset-2 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.3)', borderTopColor: 'transparent', animationDirection: 'reverse', animationDuration: '1.5s' }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        {openModal === "stake" && <Sparkles className="w-7 h-7" style={{ color: '#fb57ff' }} />}
                        {openModal === "unstake" && <Unlock className="w-7 h-7" style={{ color: '#fb57ff' }} />}
                        {openModal === "claimRewards" && <Coins className="w-7 h-7" style={{ color: '#fb57ff' }} />}
                        {(openModal === "claimSelf" || openModal === "claimExternal") && <Sparkles className="w-7 h-7" style={{ color: '#fb57ff' }} />}
                      </div>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">
                    {isConfirming ? "Confirm in Wallet" : (
                      <>
                        {openModal === "stake" && "Staking Tokens..."}
                        {openModal === "unstake" && "Unstaking Tokens..."}
                        {openModal === "claimRewards" && "Claiming Rewards..."}
                        {(openModal === "claimSelf" || openModal === "claimExternal") && "Claiming Reflections..."}
                      </>
                    )}
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">
                    {isConfirming ? "Please approve the transaction in your wallet" : "Broadcasting to the Solana blockchain"}
                  </p>
                  <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
                    <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
                    <p className="text-xs text-gray-500">Your transaction is being confirmed on-chain. This usually takes 5 to 15 seconds.</p>
                  </div>
                  <div className="flex justify-center gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />
                    ))}
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
    <StakeSuccessModal
        isOpen={showStakeSuccess}
        onClose={() => setShowStakeSuccess(false)}
        symbol={successModalType === 'claim' && rewards && rewards !== symbol ? rewards : symbol}
        amount={lastStakeAmount}
        poolName={name}
        publicKey={publicKey?.toString() || null}
        type={successModalType}
      />
    </>
  );
}