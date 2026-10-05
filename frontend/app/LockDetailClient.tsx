"use client";

import { useState, useEffect } from "react";
import {
  Lock,
  Calendar,
  Clock,
  User,
  Copy,
  ExternalLink,
  Share2,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Shield,
  XCircle,
} from "lucide-react";
import { formatDistance, format } from "date-fns";
import Link from "next/link";
import LockChart from "@/components/LockChart";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useStakingProgram } from "@/hooks/useStakingProgram";
import RewardClaimCard from "@/components/RewardClaimCard";
import ExtraRewardClaimCard from "@/components/ExtraRewardClaimCard";
import { normalizeLogo } from "@/lib/ipfs";
import { isAdmin } from "@/lib/adminAuth";

interface LockDetailClientProps {
  lock: {
    id: string;
    lockId: number;
    tokenMint: string;
    name: string;
    symbol: string;
    amount: number;
    lockDuration: number;
    unlockTime: Date;
    creatorWallet: string;
    poolId?: number | null;
    stakePda?: string | null;
    logo: string | null;
    isActive: boolean;
    isUnlocked: boolean;
    createdAt: Date;
    rewardTokenMint?: string | null;
    rewardTokenSymbol?: string | null;
  };
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative rounded-xl overflow-hidden ${className}`}
      style={{ background: 'linear-gradient(160deg, rgba(251,87,255,0.04) 0%, rgba(0,0,0,0.25) 100%)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #9b00b0, #fb57ff)' }} />
      {children}
    </div>
  );
}

export default function LockDetailClient({ lock: initialLock }: LockDetailClientProps) {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const { unstake, extendLock } = useStakingProgram();
  const [showExtend, setShowExtend] = useState(false);
  const [extendPreset, setExtendPreset] = useState<number | null>(null);
  const [extendCustomDate, setExtendCustomDate] = useState("");
  const [isExtending, setIsExtending] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [extendSuccess, setExtendSuccess] = useState<{ date: string; tx: string } | null>(null);
  const [lock, setLock] = useState(initialLock);
  const [copied, setCopied] = useState<string | null>(null);
  const [shareTooltip, setShareTooltip] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockStep, setUnlockStep] = useState<0|1|2|3|4>(0);
  const [unlockError, setUnlockError] = useState("");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  const unlockDate = new Date(lock.unlockTime);
  const createdDate = new Date(lock.createdAt);

  useEffect(() => {
    setMounted(true);
    setNow(new Date());
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'page_view', { page_title: 'Lock Detail', lock_symbol: lock.symbol, lock_id: lock.id });
    }
  }, []);

  // Auto-resolve unknown LP tokens
  useEffect(() => {
    if (lock.name !== "Unknown Token" && !lock.symbol?.includes("...")) return;
    const resolveLP = async () => {
      try {
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "";
        const heliusRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "helius-das", method: "getAsset", params: { id: lock.tokenMint } }),
        });
        const heliusData = await heliusRes.json();
        const jsonUri = heliusData?.result?.content?.json_uri;
        if (jsonUri) {
          const metaRes = await fetch(jsonUri);
          const metaData = await metaRes.json();
          if (metaData?.poolInfo?.mintA && metaData?.poolInfo?.mintB) {
            const quoteMints = ["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"];
            const baseToken = quoteMints.includes(metaData.poolInfo.mintA.address) ? metaData.poolInfo.mintB : metaData.poolInfo.mintA;
            let baseLogo = baseToken.logoURI || null;
            if (!baseLogo) {
              try {
                const baseAssetRes = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "helius-base", method: "getAsset", params: { id: baseToken.address } }) });
                const baseAssetData = await baseAssetRes.json();
                baseLogo = baseAssetData?.result?.content?.links?.image || baseAssetData?.result?.content?.files?.[0]?.cdn_uri || null;
              } catch {}
            }
            setLock(prev => ({ ...prev, symbol: `${baseToken.symbol} LP`, name: `${baseToken.name} Liquidity Pool`, logo: normalizeLogo(baseLogo) || prev.logo }));
          } else {
            const meta = heliusData?.result?.content?.metadata;
            const logo = heliusData?.result?.content?.links?.image || null;
            if (meta?.name) setLock(prev => ({ ...prev, name: meta.name, symbol: meta.symbol || prev.symbol, logo: normalizeLogo(logo) || prev.logo }));
          }
        }
      } catch {}
    };
    resolveLP();
  }, [lock.tokenMint]);

  const isUnlockable = now ? unlockDate <= now : false;
  const isOwner = publicKey && lock.creatorWallet === publicKey.toString();
  const canViewRewards = isOwner || isAdmin(publicKey?.toString() ?? null);
  const isForever = lock.lockDuration >= 2147483647;
  const isLpToken = lock.symbol?.includes("LP") || lock.name?.toLowerCase().includes("lp");
  const isRewardLock = !!lock.rewardTokenMint;

  const timeRemaining = mounted && now
    ? (unlockDate > now ? formatDistance(unlockDate, now, { addSuffix: true }) : "Unlocked")
    : "...";

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const shareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShareTooltip(true);
    setTimeout(() => setShareTooltip(false), 2000);
  };

  useEffect(() => {
    if (!publicKey) { setSolBalance(null); return; }
    connection.getBalance(publicKey)
      .then(b => setSolBalance(b / 1_000_000_000))
      .catch(() => setSolBalance(null));
  }, [publicKey, connection, showExtend]);

  const handleExtend = async () => {
    if (!publicKey || !isOwner) { setErrorModalMessage("You must be the owner and have your wallet connected."); setShowErrorModal(true); return; }

    // The contract takes the total lockup from the original stake timestamp,
    // so work out the new total rather than an addition.
    let newUnlockDate: Date;
    if (extendPreset !== null) {
      newUnlockDate = new Date(Date.now() + extendPreset * 1000);
    } else if (extendCustomDate) {
      newUnlockDate = new Date(extendCustomDate);
    } else {
      setErrorModalMessage("Choose a duration or a date.");
      setShowErrorModal(true);
      return;
    }

    if (newUnlockDate <= unlockDate) {
      setErrorModalMessage("The new unlock date must be later than the current one.");
      setShowErrorModal(true);
      return;
    }

    // The contract measures from stake.last_stake_timestamp, which differs from
    // createdAt on any lock that was topped up. Read it so the date the user
    // picks is the date they get.
    let lockStartMs: number;
    try {
      const res = await fetch(`/api/locks/${lock.id}/stake-start`);
      const data = await res.json();
      if (!res.ok || typeof data.lastStakeTimestamp !== "number") {
        throw new Error(data.error || "Could not read lock start time");
      }
      lockStartMs = data.lastStakeTimestamp * 1000;
    } catch (err: any) {
      setErrorModalMessage(err?.message || "Could not read lock start time");
      setShowErrorModal(true);
      setIsExtending(false);
      return;
    }

    const newLockupSeconds = Math.floor((newUnlockDate.getTime() - lockStartMs) / 1000);

    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.005 * 1_000_000_000) {
      setErrorModalMessage(`You need a small amount of SOL for the network fee. Your balance is ${(solBalance / 1_000_000_000).toFixed(4)} SOL.`);
      setShowErrorModal(true);
      return;
    }

    setIsExtending(true);
    try {
      const sig = await extendLock(lock.tokenMint, lock.poolId ?? 1000, newLockupSeconds);

      await fetch(`/api/locks/${lock.id}/extend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: publicKey.toString(),
          lockDuration: newLockupSeconds,
          unlockTime: newUnlockDate.toISOString(),
        }),
      });

      setShowExtend(false);
      setExtendSuccess({
        date: newUnlockDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        tx: sig,
      });
    } catch (err: any) {
      console.error("Extend failed:", err);
      setErrorModalMessage(err?.message?.slice(0, 160) || "Failed to extend lock");
      setShowErrorModal(true);
    } finally {
      setIsExtending(false);
    }
  };

  const handleUnlock = async () => {
    if (!publicKey || !isOwner || !wallet) { setErrorModalMessage("You must be the owner and have your wallet connected."); setShowErrorModal(true); return; }
    if (lock.poolId === null || lock.poolId === undefined) { setErrorModalMessage("Pool ID not found. Cannot unlock."); setShowErrorModal(true); return; }
    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.02 * 1e9) { setErrorModalMessage(`You don't have enough SOL to cover the transaction fee. You have ${(solBalance / 1e9).toFixed(4)} SOL but need at least 0.02 SOL.`); setShowErrorModal(true); return; }
    setIsUnlocking(true);
    setUnlockError("");
    setUnlockStep(1);
    const preventClose = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", preventClose);
    try {
      const { getProgram, getPDAs } = await import("@/lib/anchor-program");
      const { PublicKey: PK } = await import("@solana/web3.js");
      const program = getProgram(wallet.adapter, connection);
      const tokenMintPubkey = new PK(lock.tokenMint);
      const [projectPDA] = getPDAs.project(tokenMintPubkey, lock.poolId);
      const [derivedStakePDA] = getPDAs.userStake(projectPDA, publicKey);
      try { await program.account.project.fetch(projectPDA, "confirmed"); }
      catch { setErrorModalMessage("Project not found on-chain. It may not have been fully created."); setShowErrorModal(true); setIsUnlocking(false); return; }
      try {
        const stakeAccount = await program.account.stake.fetch(lock.stakePda ? new PK(lock.stakePda) : derivedStakePDA, "confirmed");
        if (stakeAccount.amount.toString() === "0") { setErrorModalMessage("These tokens have already been unlocked."); setShowErrorModal(true); setIsUnlocking(false); return; }
      } catch (e: any) {
        if (e.message?.includes("Account does not exist")) { setErrorModalMessage("Stake account not found. This lock may have been unlocked already."); setShowErrorModal(true); setIsUnlocking(false); return; }
      }
      setUnlockStep(2);
      await unstake(lock.tokenMint, lock.poolId);
      setUnlockStep(3);
      const response = await fetch(`/api/locks/${lock.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false, isUnlocked: true, walletAddress: publicKey.toString() }) });
      if (response.ok) setLock(await response.json());
      await fetch(`/api/locks/${lock.id}/claimed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: publicKey.toString() }) });
      setUnlockStep(4);
      await new Promise(r => setTimeout(r, 3000));
      router.refresh();
    } catch (error: any) {
      if (error.message?.includes("confirmation timeout") || error.message?.includes("may have succeeded") || error.message?.includes("already been processed")) {
        await fetch(`/api/locks/${lock.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false, isUnlocked: true, walletAddress: publicKey.toString() }) });
        await fetch(`/api/locks/${lock.id}/claimed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: publicKey.toString() }) });
        setUnlockStep(4);
        await new Promise(r => setTimeout(r, 3000));
        router.refresh();
        return;
      }
      const anchorErrorMap: Record<number, string> = { 6000: "You don't have permission to do this.", 6001: "The amount entered isn't valid.", 6002: "You don't have enough tokens in your wallet.", 6003: "This pool has been paused by the creator.", 6004: "Deposits into this pool are temporarily paused.", 6005: "Withdrawals from this pool are temporarily paused.", 6006: "Reward claims from this pool are temporarily paused.", 6007: "Your lock period hasn't expired yet. You can't unlock until it ends.", 6008: "No active stake found for your wallet.", 6009: "No rewards available to claim right now.", 6010: "No reflections available to claim right now.", 6011: "A calculation error occurred. Try again.", 6012: "This lock has already been set up.", 6013: "This lock wasn't fully initialised. The second transaction may have been missed.", 6018: "You don't have enough SOL to cover the transaction fee. Top up your SOL and try again.", 6020: "The vault doesn't have enough tokens to complete this.", 6021: "Insufficient rewards in the vault.", 6025: "A calculation error occurred. Please try again.", 6028: "Wrong token type.", 6033: "A mismatch was detected in the pool totals. Please contact support.", 6034: "A timing error was detected. Please try again.", 6035: "This pool has ended." };
      const errStr = String(error?.message ?? error);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16) : jsonMatch ? parseInt(jsonMatch[1]) : anchorMatch ? parseInt(anchorMatch[1]) : fallbackMatch ? parseInt(fallbackMatch[1]) : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;
      let errorMessage = anchorError || "Failed to unlock tokens.";
      if (!anchorError && errStr.includes("User rejected")) errorMessage = "Transaction cancelled.";
      else if (!anchorError && errStr.includes("insufficient")) errorMessage = "Insufficient SOL balance.";
      else if (!anchorError && error.message) errorMessage = error.message;
      setErrorModalMessage(errorMessage);
      setShowErrorModal(true);
    } finally {
      setIsUnlocking(false);
      setUnlockStep(0);
      window.removeEventListener("beforeunload", preventClose);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-3">

      {/* Back + share row */}
      <div className="flex items-center justify-between">
        <Link href="/locks" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Locks
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const text = encodeURIComponent(`I just locked ${lock.amount.toLocaleString()} $${lock.symbol} for ${isForever ? "forever" : Math.floor(lock.lockDuration / 86400) + " days"} on @StakePointApp 🔒\n\nVerified on-chain on Solana 👇`);
              const url = encodeURIComponent(`https://stakepoint.app/locks/${lock.id}`);
              window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "width=550,height=420");
            }}
            className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </button>
          <div className="relative">
            <button onClick={shareLink} className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors">
              <Share2 className="w-4 h-4 text-gray-400" />
            </button>
            {shareTooltip && <div className="absolute -bottom-8 right-0 px-2 py-1 rounded bg-green-500 text-white text-xs whitespace-nowrap z-10">Copied!</div>}
          </div>
          <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${isUnlockable ? "bg-green-500/10 border-green-500/30 text-green-400" : lock.isActive ? "bg-[#fb57ff]/10 border-[#fb57ff]/30 text-[#fb57ff]" : "bg-gray-500/10 border-gray-500/30 text-gray-400"}`}>
            {isUnlockable ? "🔓 Unlockable" : lock.isActive ? "🔒 Locked" : "⏸ Inactive"}
          </div>
        </div>
      </div>

      {/* ── ROW 1: Hero card, original style ── */}
      <Card>
        <div className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
            {/* Logo + title */}
            <div className="flex items-center gap-4 min-w-0">
              {lock.logo ? (
                <img src={normalizeLogo(lock.logo)} alt={lock.symbol} className="w-14 h-14 sm:w-16 sm:h-16 rounded-full shrink-0" onError={e => e.currentTarget.style.display = "none"} />
              ) : isLpToken ? (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(251,87,255,0.15)', border: '2px solid rgba(251,87,255,0.4)' }}>
                  <span className="text-[#fb57ff] font-bold text-lg">LP</span>
                </div>
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
                  <Lock className="w-7 h-7 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-white mb-1 truncate">{lock.name}</h1>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base sm:text-lg text-gray-400">{lock.symbol}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: isLpToken ? 'rgba(251,87,255,0.1)' : 'rgba(96,165,250,0.1)', color: isLpToken ? '#fb57ff' : '#60a5fa', border: `1px solid ${isLpToken ? 'rgba(251,87,255,0.3)' : 'rgba(96,165,250,0.3)'}` }}>
                    {isLpToken ? "LP" : "Token"}
                  </span>
                  {isRewardLock && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(251,87,255,0.1)', color: '#fb57ff', border: '1px solid rgba(251,87,255,0.3)' }}>
                      🎁 Reward Lock
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Amount + stats */}
          <div className="mb-4">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Locked Amount</p>
            <p className="text-3xl font-extrabold text-white">
              {lock.amount >= 1_000_000_000 ? `${(lock.amount / 1_000_000_000).toFixed(2)}B` : lock.amount.toLocaleString()}
              <span className="text-lg text-gray-400 ml-2">{lock.symbol}</span>
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Unlocks", value: isForever ? "Never" : timeRemaining, accent: isUnlockable },
              { label: "Date", value: isForever ? "∞" : (mounted ? format(unlockDate, "dd MMM yyyy") : "..."), accent: false },
              { label: "Duration", value: isForever ? "Forever" : `${Math.floor(lock.lockDuration / 86400)}d`, accent: false },
            ].map(item => (
              <div key={item.label} className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider">{item.label}</span>
                </div>
                <p className={`text-sm font-bold ${item.accent ? 'text-green-400' : 'text-white'}`} style={!item.accent && item.label === "Unlocks" && !isUnlockable ? { color: '#fb57ff' } : {}}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Unlock action (owner only, when unlockable) ── */}
      {isOwner && isUnlockable && lock.isActive && !lock.isUnlocked && (
        <div className="relative rounded-xl overflow-hidden" style={{ background: 'linear-gradient(160deg, rgba(34,197,94,0.06) 0%, rgba(0,0,0,0.3) 100%)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #16a34a, #4ade80)' }} />
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white">Your tokens are ready to unlock!</p>
                <p className="text-xs text-gray-400 mt-0.5">The lock period has ended. You can now withdraw your tokens.</p>
                </div>
            </div>
            <button onClick={handleUnlock} disabled={isUnlocking} className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50" style={{ background: 'linear-gradient(45deg, #16a34a, #4ade80)' }}>
              {isUnlocking ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Unlocking...</> : "Unlock Tokens"}
            </button>
          </div>
        </div>
      )}

      {extendSuccess && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => { setExtendSuccess(null); window.location.reload(); }} />
          <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
                <Lock className="w-8 h-8 text-white" />
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Lock extended</h3>
            <p className="text-gray-400 text-sm mb-4">
              Your tokens are now locked until <span className="text-white font-semibold">{extendSuccess.date}</span>
            </p>
            <a href={`https://solscan.io/tx/${extendSuccess.tx}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs mb-5 hover:opacity-80" style={{ color: '#fb57ff' }}>
              View transaction
              <ExternalLink className="w-3 h-3" />
            </a>
            <button onClick={() => { setExtendSuccess(null); window.location.reload(); }} className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-all" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
              Done
            </button>
          </div>
        </div>
      )}

      {isExtending && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                <div className="absolute inset-2 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.3)', borderTopColor: 'transparent', animationDirection: 'reverse', animationDuration: '1.5s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Lock className="w-7 h-7" style={{ color: '#fb57ff' }} />
                </div>
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Extending lock</h3>
            <p className="text-gray-400 text-sm mb-4">Approve in your wallet, then wait for confirmation.</p>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
              <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
              <p className="text-xs text-gray-500">The extension is recorded after the transaction confirms. Closing early leaves your lock page showing the old unlock date.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Extend lock (owner only, while still locked) ── */}
      {isOwner && lock.isActive && !lock.isUnlocked && !isForever && (
        <div className="relative rounded-xl overflow-hidden" style={{ background: 'linear-gradient(160deg, rgba(251,87,255,0.06) 0%, rgba(0,0,0,0.3) 100%)', border: '1px solid rgba(251,87,255,0.25)' }}>
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #9b00b0, #fb57ff)' }} />
          <div className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Extend this lock</p>
                <p className="text-xs text-gray-400 mt-0.5">Push the unlock date back without withdrawing. No fee.</p>
              </div>
              {!showExtend && (
                <button onClick={() => setShowExtend(true)} className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
                  Extend
                </button>
              )}
            </div>

            {showExtend && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: "30 Days", secs: 30 * 86400 },
                    { label: "90 Days", secs: 90 * 86400 },
                    { label: "180 Days", secs: 180 * 86400 },
                    { label: "1 Year", secs: 365 * 86400 },
                    { label: "2 Years", secs: 730 * 86400 },
                    { label: "5 Years", secs: 1825 * 86400 },
                  ].map(p => (
                    <button
                      key={p.label}
                      onClick={() => { setExtendPreset(p.secs); setExtendCustomDate(""); }}
                      className={`py-2 rounded-lg text-xs font-semibold transition-all border ${extendPreset === p.secs ? 'text-white border-transparent' : 'bg-white/[0.03] border-white/[0.08] text-gray-300 hover:border-[#fb57ff]/40'}`}
                      style={extendPreset === p.secs ? { background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' } : {}}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Or pick a date and time</label>
                  <input
                    type="datetime-local"
                    value={extendCustomDate}
                    onChange={e => { setExtendCustomDate(e.target.value); setExtendPreset(null); }}
                    className="w-full p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.08] text-white text-sm focus:outline-none focus:border-[#fb57ff]/50"
                  />
                </div>

                <p className="text-xs text-gray-500">
                  Current unlock: {unlockDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>

                <div className="flex gap-2">
                  <button onClick={() => { setShowExtend(false); setExtendPreset(null); setExtendCustomDate(""); }} className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-white/[0.04] border border-white/[0.08] text-gray-300 hover:bg-white/[0.07] transition-all">
                    Cancel
                  </button>
                  <button onClick={handleExtend} disabled={isExtending || (extendPreset === null && !extendCustomDate) || (solBalance !== null && solBalance < 0.005)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2" style={{ background: 'linear-gradient(45deg, #9b00b0, #fb57ff)' }}>
                    {isExtending ? <><Loader2 className="w-4 h-4 animate-spin" />Extending...</> : solBalance !== null && solBalance < 0.005 ? "Not enough SOL" : "Confirm Extension"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Still locked notice (non-owner or not unlockable) ── */}
      {!isUnlockable && (
        <Card>
          <div className="p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: '#fb57ff' }} />
            <div>
              <p className="text-sm font-semibold text-white">Lock is active</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {isForever ? "This lock is permanent, tokens cannot be withdrawn." : `Tokens are securely locked and will be available ${timeRemaining}.`}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── ROW 2: Timeline (left) + Token info (right) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* Timeline, compact */}
        <Card>
          <div className="p-4">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-4">Lock Timeline</p>
            <LockChart createdAt={lock.createdAt} unlockTime={lock.unlockTime} />
          </div>
        </Card>

        {/* Token info + creator */}
        <Card>
          <div className="p-4 space-y-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Token Information</p>

            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Token Mint</p>
              <div className="flex items-center gap-1.5">
                <code className="text-xs text-white bg-white/[0.05] px-2.5 py-1.5 rounded flex-1 overflow-hidden text-ellipsis font-mono">
                  {lock.tokenMint.slice(0, 8)}...{lock.tokenMint.slice(-8)}
                </code>
                <button onClick={() => copyToClipboard(lock.tokenMint, "mint")} className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                  {copied === "mint" ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                <a href={`https://solscan.io/token/${lock.tokenMint}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                  <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                </a>
              </div>
            </div>

            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Creator Wallet</p>
              <div className="flex items-center gap-1.5">
                <code className="text-xs text-white bg-white/[0.05] px-2.5 py-1.5 rounded flex-1 overflow-hidden text-ellipsis font-mono">
                  {lock.creatorWallet.slice(0, 8)}...{lock.creatorWallet.slice(-8)}
                </code>
                <button onClick={() => copyToClipboard(lock.creatorWallet, "creator")} className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                  {copied === "creator" ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                <a href={`https://solscan.io/account/${lock.creatorWallet}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors flex-shrink-0">
                  <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Lock ID</p>
                <p className="text-sm font-semibold text-white">#{lock.lockId.toString()}</p>
              </div>
              {lock.poolId !== undefined && lock.poolId !== null && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Pool ID</p>
                  <p className="text-sm font-semibold text-white">#{lock.poolId}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Created</p>
                <p className="text-sm font-semibold text-white">{mounted ? format(createdDate, "dd MMM yyyy HH:mm") : "..."}</p>
              </div>
            </div>

            {isOwner && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(251,87,255,0.08)', border: '1px solid rgba(251,87,255,0.2)' }}>
                <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb57ff' }} />
                <p className="text-xs font-medium" style={{ color: '#fb57ff' }}>You own this lock</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── ROW 3: Verification, full width OR split if reward lock ── */}
      {isRewardLock && canViewRewards ? (
        <div className={lock.extraRewardMint ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 gap-3"}>
          {/* Verified On-Chain Lock */}
          <Card>
            <div className="p-4 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(0,212,255,0.15)' }}>
                  <Shield className="w-4 h-4" style={{ color: '#00d4ff' }} />
                </div>
                <p className="text-sm font-semibold text-white">
                  {!lock.isActive && lock.isUnlocked ? "Lock Successfully Completed" : "Verified On-Chain Lock"}
                </p>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-4 flex-1">
                {!lock.isActive && lock.isUnlocked
                  ? `This ${lock.symbol} token lock was held in a Program Derived Address on Solana and has been completed. All activity is permanently recorded on-chain and verifiable on Solscan.`
                  : `${lock.symbol} tokens are locked in a Program Derived Address and cannot be withdrawn until the unlock time. Independently verifiable on Solscan using the token mint address.`
                }
              </p>
              <div className="flex flex-col items-start sm:flex-row sm:flex-wrap gap-2 sm:gap-3">
                <a href={`https://solscan.io/token/${lock.tokenMint}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                  Verify on Solscan <ExternalLink className="w-3 h-3" />
                </a>
                <Link href="/locks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                  All Locks →
                </Link>
                <Link href="/solana-token-locker" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                  Create Lock →
                </Link>
                <Link href="/pools" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                  Staking Pools →
                </Link>
              </div>
            </div>
          </Card>

          {/* Reward Claim Cards */}
          {lock.extraRewardMint ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="h-full">
                <RewardClaimCard
                  tokenMint={lock.tokenMint}
                  poolId={lock.poolId !== null && lock.poolId !== undefined ? lock.poolId : 1000}
                  rewardTokenMint={lock.rewardTokenMint!}
                  rewardTokenSymbol={lock.rewardTokenSymbol ?? "TOKEN"}
                  creatorWallet={lock.creatorWallet}
                />
              </div>
              <div className="h-full">
                <ExtraRewardClaimCard
                  tokenMint={lock.tokenMint}
                  poolId={lock.poolId !== null && lock.poolId !== undefined ? lock.poolId : 1000}
                  extraRewardMint={lock.extraRewardMint}
                  extraRewardSymbol={lock.extraRewardSymbol ?? undefined}
                  creatorWallet={lock.creatorWallet}
                />
              </div>
            </div>
          ) : (
            <div className="h-full">
              <RewardClaimCard
                tokenMint={lock.tokenMint}
                poolId={lock.poolId !== null && lock.poolId !== undefined ? lock.poolId : 1000}
                rewardTokenMint={lock.rewardTokenMint!}
                rewardTokenSymbol={lock.rewardTokenSymbol ?? "TOKEN"}
                creatorWallet={lock.creatorWallet}
              />
            </div>
          )}
        </div>
      ) : (
        /* Full width verification for standard locks */
        <Card>
          <div className="p-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(0,212,255,0.15)' }}>
                <Shield className="w-5 h-5" style={{ color: '#00d4ff' }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white mb-1.5">
                  {!lock.isActive && lock.isUnlocked ? "Lock Successfully Completed" : "Verified On-Chain Lock"}
                </p>
                <p className="text-xs text-gray-400 leading-relaxed mb-3">
                  {!lock.isActive && lock.isUnlocked
                    ? `This ${lock.symbol} token lock was held in a Program Derived Address on Solana and has been completed. All activity is permanently recorded on-chain and verifiable on Solscan.`
                    : `${lock.symbol} tokens are locked in a Program Derived Address and cannot be withdrawn until the unlock time. The lock is enforced by a smart contract, nobody including StakePoint can access tokens before the unlock date. Independently verifiable on Solscan using the token mint address.`
                  }
                </p>
                <div className="flex flex-col items-start sm:flex-row sm:flex-wrap gap-2 sm:gap-4">
                  <a href={`https://solscan.io/token/${lock.tokenMint}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>
                    Verify on Solscan <ExternalLink className="w-3 h-3" />
                  </a>
                  <Link href="/locks" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>All Locks →</Link>
                  <Link href="/solana-token-locker" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>Create Lock →</Link>
                  <Link href="/pools" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>Staking Pools →</Link>
                  <Link href="/for-projects" className="text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: '#fb57ff' }}>Create Staking Pool →</Link>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

    {unlockStep >= 1 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(34,197,94,0.8)', borderTopColor: 'transparent' }} />
                <div className="absolute inset-2 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(34,197,94,0.3)', borderTopColor: 'transparent', animationDirection: 'reverse', animationDuration: '1.5s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-green-400" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className={`w-8 h-1 rounded-full transition-colors ${unlockStep >= 1 ? 'bg-green-400' : 'bg-white/[0.1]'}`} />
              <div className={`w-8 h-1 rounded-full transition-colors ${unlockStep >= 2 ? 'bg-green-400' : 'bg-white/[0.1]'}`} />
              <div className={`w-8 h-1 rounded-full transition-colors ${unlockStep >= 3 ? 'bg-green-400' : 'bg-white/[0.1]'}`} />
            </div>
            {unlockStep === 4 ? (
              <>
                <h3 className="text-xl font-bold text-white mb-2">Tokens Unlocked! 🎉</h3>
                <p className="text-gray-400 text-sm mb-4">Your tokens have been sent back to your wallet.</p>
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 mb-4">
                  <p className="text-xs text-green-400 font-semibold">✅ Unlock complete. This page will refresh shortly.</p>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold text-white mb-2">
                  {unlockStep === 1 ? "Verifying Lock..." : unlockStep === 2 ? "Confirm in Wallet" : "Updating Records..."}
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                  {unlockStep === 1 ? "Checking lock status on-chain" : unlockStep === 2 ? "Approve the unlock transaction in your wallet" : "Saving unlock status"}
                </p>
                <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
                  <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
                  <p className="text-xs text-gray-500">Stay on this page until the unlock completes.</p>
                </div>
                <div className="flex justify-center gap-1">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#4ade80', animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
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
                <h2 className="text-xl font-bold text-white">Unlock Failed</h2>
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
    </div>
  );
}
