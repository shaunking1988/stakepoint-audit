"use client";

import { useState, useEffect } from "react";
import { X, Clock, Check, AlertCircle, Loader2, Search, ChevronDown, ExternalLink } from "lucide-react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getProgram, getPDAs } from "@/lib/anchor-program";
import { BN } from "@coral-xyz/anchor";
import { confirmTransactionPolling } from "@/lib/confirmTransaction";

interface CreateVestingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface TokenInfo {
  mint: string;
  balance: number;
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

interface VestingSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol: string;
  amount: string;
  duration: string;
  beneficiary: string;
  vestingPageUrl: string;
}

function VestingReviewPrompt({ onClose }: { onClose: () => void }) {
  const [skipped, setSkipped] = useState(false);

  if (skipped) return (
    <button onClick={onClose} className="w-full py-3 rounded-xl font-semibold bg-white/[0.02] hover:bg-white/[0.05] transition-all text-gray-400">
      Close
    </button>
  );

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

function VestingSuccessModal({ isOpen, onClose, tokenSymbol, amount, duration, beneficiary, vestingPageUrl }: VestingSuccessModalProps) {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/[0.02] backdrop-blur border border-white/[0.05] rounded-2xl p-5 max-w-2xl w-full shadow-2xl" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
            <Clock className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Vesting Created! 🎉</h2>
            <p className="text-gray-400 text-sm">Tokens will unlock gradually on-chain</p>
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
                <span className="text-gray-400">Beneficiary</span>
                <span className="text-white font-semibold">{beneficiary.slice(0, 4)}...{beneficiary.slice(-4)}</span>
              </div>
            </div>
            <div className="border rounded-lg p-3" style={{ background: 'rgba(251, 87, 255, 0.1)', borderColor: 'rgba(251, 87, 255, 0.3)' }}>
              <p className="font-semibold mb-1 text-sm" style={{ color: '#fb57ff' }}>📢 Share with your community!</p>
              <p className="text-xs text-gray-300">Show your holders that team and investor tokens are vesting, not dumping. Share your vesting page to build trust.</p>
            </div>
            <div className="border rounded-lg p-3" style={{ background: 'rgba(251, 87, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.08)' }}>
              <p className="font-semibold mb-1 text-sm text-white">💰 Reward your holders</p>
              <p className="text-xs text-gray-400 mb-2">Create a staking pool and let your community earn while they hold.</p>
              <a
                href="/pools"
                className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-semibold text-xs transition-all hover:opacity-90 text-white"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
              >
                Create a Staking Pool →
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href={vestingPageUrl}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90 text-white"
              style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
            >
              <ExternalLink className="w-4 h-4" />
              View Vesting Page
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${vestingPageUrl}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-full py-2.5 rounded-xl font-semibold text-sm bg-white/[0.05] hover:bg-white/[0.08] transition-all text-white border border-white/[0.05]"
            >
              {copied ? "✅ Copied!" : "Copy Vesting Link"}
            </button>
            <a
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(`⏳ Just set up vesting for ${parseFloat(amount).toLocaleString()} $${tokenSymbol} over ${duration} on @StakePointApp!\n\nVerify on-chain:\n${window.location.origin}${vestingPageUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all text-white border border-white/[0.05] bg-white/[0.05] hover:bg-white/[0.08]"
            >
              𝕏 Share on X
            </a>
            <VestingReviewPrompt onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Global Birdeye rate limiter - ensures minimum gap between ANY call
let lastBirdeyeCall = 0;
const BIRDEYE_MIN_GAP = 200;

async function birdeyeFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = BIRDEYE_MIN_GAP - (now - lastBirdeyeCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastBirdeyeCall = Date.now();
  return fetch(url);
}

export default function CreateVestingModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateVestingModalProps) {
  const { publicKey, wallet, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const [userTokens, setUserTokens] = useState<TokenInfo[]>([]);
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);

  useEffect(() => {
    if (selectedToken) {
      const updated = userTokens.find(t => t.mint === selectedToken.mint);
      if (updated && (updated.name !== selectedToken.name || updated.symbol !== selectedToken.symbol || updated.logoURI !== selectedToken.logoURI)) {
        setSelectedToken(updated);
      }
    }
  }, [userTokens]);

  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [amount, setAmount] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [revocable, setRevocable] = useState(false);

  // Vesting duration
  const [customDays, setCustomDays] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [customEndLabel, setCustomEndLabel] = useState("");
  const [selectedDuration, setSelectedDuration] = useState<number | "custom" | "">("");

  // Cliff
  const [customCliffDays, setCustomCliffDays] = useState("");
  const [showCliffCalendar, setShowCliffCalendar] = useState(false);
  const [customCliffLabel, setCustomCliffLabel] = useState("");
  const [selectedCliff, setSelectedCliff] = useState<number | "custom">(0);

  // Shared calendar state
  const [calViewYear, setCalViewYear] = useState(new Date().getFullYear());
  const [calViewMonth, setCalViewMonth] = useState(new Date().getMonth());
  const [calSelectedDate, setCalSelectedDate] = useState<Date | null>(null);
  const [calHour, setCalHour] = useState(new Date().getHours());
  const [calMinute, setCalMinute] = useState(0);

  const [step, setStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<{ tokenSymbol: string; amount: string; duration: string; beneficiary: string; vestingPageUrl: string } | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [vestStep, setVestStep] = useState<0|1|2|3>(0);
  const [showIntro, setShowIntro] = useState(true);
  const [tvlData, setTvlData] = useState<{ totalValueLocked: number; totalStakers: number; totalLocks: number } | null>(null);

  // Fetch user's tokens when modal opens
  useEffect(() => {
    if (isOpen && publicKey) {
      setShowIntro(true);
      setStep(1);
      fetchUserTokens();
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'vesting_modal_open', { modal_name: 'create_vesting' });
      }
    }
  }, [isOpen, publicKey]);

  // Platform stats for the intro screen
  useEffect(() => {
    if (isOpen) {
      fetch("/api/stats")
        .then(r => r.json())
        .then(d => setTvlData(d))
        .catch(() => {});
    }
  }, [isOpen]);


  const fetchUserTokens = async () => {
    if (!publicKey) return;
    
    setIsLoadingTokens(true);
    setStatusMessage("Fetching your tokens...");

    try {
      // Fetch regular SPL tokens
      let tokenAccounts: { value: any[] } = { value: [] };
      try {
        tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          publicKey,
          { programId: TOKEN_PROGRAM_ID }
        );
        console.log("✅ Found", tokenAccounts.value.length, "SPL token accounts");
      } catch (e) {
        console.warn("⚠️ SPL fetch failed:", e);
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

      console.log(`📊 Total accounts to process: ${allAccounts.length}`);

      const tokens: TokenInfo[] = [];
      let processed = 0;

      for (const account of allAccounts) {
        try {
          if (!account?.account?.data?.parsed?.info) {
            continue;
          }

          const tokenAmount = account.account.data.parsed.info.tokenAmount;
          const mint = account.account.data.parsed.info.mint;
          const balance = tokenAmount?.uiAmount || 0;

          if (balance > 0) {
            processed++;
            setStatusMessage(`Fetching metadata... (${processed}/${allAccounts.filter(a => (a.account.data.parsed.info.tokenAmount?.uiAmount || 0) > 0).length})`);

            // Pacing handled globally by birdeyeFetch

            // Use Birdeye API
            try {
              let td = null;
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const birdeyeRes = await birdeyeFetch(`/api/birdeye?path=/defi/token_overview&address=${mint}`);
                  if (birdeyeRes.status === 429) {
                    console.warn(`⚠️ Birdeye 429 for ${mint}, brief backoff (attempt ${attempt}/3)`);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
                    continue;
                  }
                  const birdeyeData = await birdeyeRes.json();
                  td = birdeyeData?.data;
                  if (td?.symbol) break;
                  if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                } catch (birdeyeErr) {
                  console.warn(`⚠️ Birdeye token_overview attempt ${attempt}/3 failed for ${mint}`);
                  if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                }
              }
              if (!td?.symbol) console.warn(`⚠️ Birdeye token_overview gave no data for ${mint} after 3 attempts, trying fallbacks...`);

              if (td && td.symbol) {
                tokens.push({
                  mint,
                  balance,
                  decimals: tokenAmount.decimals,
                  symbol: td.symbol || "UNKNOWN",
                  name: td.name || "Unknown Token",
                  logoURI: td.logoURI ? td.logoURI.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=') : undefined,
                  programId: account.programIdKey,
                  price: td.price || undefined,
                  liquidity: td.liquidity || undefined,
                  marketCap: td.mc || undefined,
                });
                console.log(`✅ Birdeye: ${td.symbol}`);
              } else {
                console.log(`⚠️ No Birdeye token data for: ${mint}, checking if LP via Birdeye search...`);
                let resolvedSymbol = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
                let resolvedName = "Unknown Token";
                let resolvedLogo: string | undefined = undefined;

                try {
                  const searchRes = await birdeyeFetch(`/api/birdeye?path=/defi/v3/search&keyword=${mint}&sort_by=liquidity&sort_type=desc&limit=1`);
                  const searchData = await searchRes.json();
                  const items = searchData?.data?.items || [];
                  const marketResult = items.find((i: any) => i.type === "market")?.result?.[0];
                  const tokenResults = items.find((i: any) => i.type === "token")?.result || [];

                  if (marketResult?.lp_mint && marketResult.lp_mint === mint) {
                    const baseToken = tokenResults.find((t: any) => t.address === marketResult.base_mint);
                    resolvedSymbol = marketResult.name || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
                    resolvedName = resolvedSymbol + " Liquidity Pool";
                    resolvedLogo = baseToken?.logo_uri || undefined;
                    console.log(`✅ LP resolved via Birdeye search: ${resolvedSymbol}`);
                    tokens.push({
                      mint,
                      balance,
                      decimals: tokenAmount.decimals,
                      symbol: resolvedSymbol,
                      name: resolvedName,
                      logoURI: resolvedLogo,
                      programId: account.programIdKey,
                    });
                    continue;
                  }
                } catch (lpErr) {
                  console.warn(`⚠️ Birdeye LP search failed for ${mint}:`, lpErr);
                }

                // 🔍 PumpSwap AMM LP: Token-2022 mints with no metadata
                const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
                if (!resolvedLogo && account.programIdKey === TOKEN_2022_PROGRAM_ID.toString()) {
                  try {
                    const mintAccountInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
                    const mintData = (mintAccountInfo.value?.data as any)?.parsed?.info;
                    const mintAuthority = mintData?.mintAuthority;
                    if (mintAuthority) {
                      const authorityInfo = await connection.getAccountInfo(new PublicKey(mintAuthority));
                      if (authorityInfo?.owner?.toString() === PUMPSWAP_PROGRAM) {
                        // mintAuthority is the pool PDA, decode base mint from raw account data
                        const rawPool = await connection.getAccountInfo(new PublicKey(mintAuthority));
                        if (rawPool?.data) {
                          // PumpSwap pool layout: discriminator(8) + pool_bump(1) + index(2) + creator(32) + base_mint(32) + quote_mint(32) + lp_mint(32)
                          const baseMint = new PublicKey(rawPool.data.slice(43, 75)).toString();
                          const quoteMint = new PublicKey(rawPool.data.slice(75, 107)).toString();
                          // Fetch base token metadata
                          const baseAssetRes = await fetch("/api/rpc", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              jsonrpc: "2.0",
                              id: "pumpswap-base",
                              method: "getAsset",
                              params: { id: baseMint },
                            }),
                          });
                          const baseAssetData = await baseAssetRes.json();
                          const baseMeta = baseAssetData?.result?.content?.metadata;
                          const baseSymbol = baseMeta?.symbol || "UNKNOWN";
                          const baseName = baseMeta?.name || "Unknown Token";
                          // Use Birdeye for logo, more reliable than on-chain metadata for pump.fun tokens
                          let baseLogoRaw: string | undefined;
                          try {
                            const dexRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${baseMint}`);
                            const dexData = await dexRes.json();
                            baseLogoRaw = dexData?.[0]?.info?.imageUrl || undefined;
                          } catch {}
                          if (!baseLogoRaw) {
                            try {
                              const baseBirdeyeRes = await birdeyeFetch(`/api/birdeye?path=/defi/token_overview&address=${baseMint}`);
                              const baseBirdeyeData = await baseBirdeyeRes.json();
                              baseLogoRaw = baseBirdeyeData?.data?.logoURI || undefined;
                            } catch {
                              baseLogoRaw = baseAssetData?.result?.content?.links?.image || baseAssetData?.result?.content?.files?.[0]?.cdn_uri;
                            }
                          }
                          resolvedSymbol = `${baseSymbol}-SOL LP`;
                          resolvedName = baseName;
                          resolvedLogo = baseLogoRaw
                            ? baseLogoRaw.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=').replace('https://stakepoint.app/api/ipfs-image?cid=', 'https://stakepoint.app/api/ipfs-image?cid=')
                            : undefined;
                          console.log(`✅ Resolved as PumpSwap AMM LP: ${resolvedSymbol}`);
                          tokens.push({
                            mint,
                            balance,
                            decimals: tokenAmount.decimals,
                            symbol: resolvedSymbol,
                            name: resolvedName,
                            logoURI: resolvedLogo,
                            programId: account.programIdKey,
                            isLpToken: true,
                            baseMint,
                          });
                          continue;
                        } else {
                          resolvedSymbol = "PUMP-LP";
                          resolvedName = "PumpSwap LP Token";
                          console.log(`⚠️ PumpSwap LP: could not decode pool data for ${mint}`);
                        }
                      }
                    }
                  } catch (pumpErr) {
                    console.warn(`⚠️ PumpSwap LP check failed for ${mint}:`, pumpErr);
                  }
                }

                // ⚡ Fast path: look the pool up directly by LP mint
                if (!resolvedLogo) {
                  try {
                    const lpRes = await fetch(`https://api-v3.raydium.io/pools/info/lps?lps=${mint}`);
                    const lpData = await lpRes.json();
                    const pool = lpData?.data?.[0];
                    if (pool?.lpMint?.address === mint) {
                      const SOL_MINT = "So11111111111111111111111111111111111111112";
                      const baseToken = pool.mintA?.address === SOL_MINT ? pool.mintB : pool.mintA;
                      const quoteToken = pool.mintA?.address === SOL_MINT ? pool.mintA : pool.mintB;
                      resolvedSymbol = `${baseToken.symbol}-${quoteToken.symbol} LP`;
                      resolvedName = `${baseToken.name} Liquidity Pool`;
                      resolvedLogo = baseToken.logoURI || undefined;
                      try {
                        const hiRes = await fetch("/api/rpc", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ jsonrpc: "2.0", id: "lps-base-logo", method: "getAsset", params: { id: baseToken.address } }),
                        });
                        const hiResData = await hiRes.json();
                        const hiResLogo = hiResData?.result?.content?.links?.image;
                        if (hiResLogo) resolvedLogo = hiResLogo.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=');
                      } catch {}
                      console.log(`✅ LP resolved via Raydium lps lookup: ${resolvedSymbol}`);
                      tokens.push({
                        mint,
                        balance,
                        decimals: tokenAmount.decimals,
                        symbol: resolvedSymbol,
                        name: resolvedName,
                        logoURI: resolvedLogo,
                        programId: account.programIdKey,
                        isLpToken: true,
                        lpPoolId: pool.id,
                      });
                      continue;
                    }
                  } catch (lpsErr) {
                    console.warn(`⚠️ Raydium lps lookup failed for ${mint}, falling back to scan`);
                  }
                }

                // 🔍 Raydium CPMM: find pool by LP mint at offset 136
                if (!resolvedLogo) {
                  try {
                    const rpcUrl = "/api/rpc";
                    // Try CPMM (offset 136) then Standard AMM v4 (offset 464)
                    const poolPrograms = [
                      { program: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", offset: 136 },
                      { program: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", offset: 464 },
                    ];
                    let poolPubkey: string | null = null;
                    let matchedProgram: string | null = null;
                    for (const { program, offset } of poolPrograms) {
                      const cpmmRes = await fetch(rpcUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          jsonrpc: "2.0",
                          id: "pool-lookup",
                          method: "getProgramAccounts",
                          params: [program, {
                            encoding: "base64",
                            filters: [{ memcmp: { offset, bytes: mint } }]
                          }]
                        }),
                      });
                      const cpmmData = await cpmmRes.json();
                      poolPubkey = cpmmData?.result?.[0]?.pubkey || null;
                      if (poolPubkey) { matchedProgram = program; break; }
                    }
                    if (poolPubkey) {
                      const raydiumRes = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolPubkey}`);
                      const raydiumData = await raydiumRes.json();
                      const pool = raydiumData?.data?.[0];
                      if (pool && pool.lpMint?.address === mint) {
                        const SOL_MINT = "So11111111111111111111111111111111111111112";
                        const baseToken = pool.mintA?.address === SOL_MINT ? pool.mintB : pool.mintA;
                        const quoteToken = pool.mintA?.address === SOL_MINT ? pool.mintA : pool.mintB;
                        resolvedSymbol = `${baseToken.symbol}-${quoteToken.symbol} LP`;
                        resolvedName = `${baseToken.name} Liquidity Pool`;
                        resolvedLogo = baseToken.logoURI || undefined;
                        // Upgrade to full-res IPFS logo via Helius
                        try {
                          const baseAssetRes = await fetch("/api/rpc", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              jsonrpc: "2.0",
                              id: "helius-base-logo",
                              method: "getAsset",
                              params: { id: baseToken.address },
                            }),
                          });
                          const baseAssetData = await baseAssetRes.json();
                          const hiResLogo = baseAssetData?.result?.content?.links?.image;
                          if (hiResLogo) resolvedLogo = hiResLogo.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=').replace('https://stakepoint.app/api/ipfs-image?cid=', 'https://stakepoint.app/api/ipfs-image?cid=');
                        } catch (e) {
                          // keep Raydium CDN logo as fallback
                        }
                        console.log(`✅ LP resolved via Raydium CPMM: ${resolvedSymbol}`);
                        tokens.push({
                          mint,
                          balance,
                          decimals: tokenAmount.decimals,
                          symbol: resolvedSymbol,
                          name: resolvedName,
                          logoURI: resolvedLogo,
                          programId: account.programIdKey,
                          isLpToken: true,
                          lpPoolId: poolPubkey,
                        });
                        continue;
                      } else if (poolPubkey) {
                        // Raydium API has no data for this pool, decode mints from raw on-chain account
                        console.log(`⚠️ Raydium API empty for pool ${poolPubkey}, decoding on-chain...`);
                        try {
                          const poolAccRes = await fetch(rpcUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              jsonrpc: "2.0",
                              id: "pool-decode",
                              method: "getAccountInfo",
                              params: [poolPubkey, { encoding: "base64" }],
                            }),
                          });
                          const poolAccData = await poolAccRes.json();
                          const rawB64 = poolAccData?.result?.value?.data?.[0];
                          if (rawB64) {
                            const rawBytes = Uint8Array.from(atob(rawB64), c => c.charCodeAt(0));
                            const isAmmV4 = matchedProgram === "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
                            const coinMintAddr = new PublicKey(rawBytes.slice(isAmmV4 ? 400 : 72, (isAmmV4 ? 400 : 72) + 32)).toString();
                            const pcMintAddr = new PublicKey(rawBytes.slice(isAmmV4 ? 432 : 104, (isAmmV4 ? 432 : 104) + 32)).toString();
                            const SOL_MINT = "So11111111111111111111111111111111111111112";
                            const knownQuotes: Record<string, string> = {
                              [SOL_MINT]: "WSOL",
                              "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
                              "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
                            };
                            const baseMintAddr = knownQuotes[coinMintAddr] ? pcMintAddr : coinMintAddr;
                            const quoteMintAddr = knownQuotes[coinMintAddr] ? coinMintAddr : pcMintAddr;
                            const quoteSymbol = knownQuotes[quoteMintAddr] || "UNKNOWN";

                            let baseSymbol = baseMintAddr.slice(0, 4) + "..." + baseMintAddr.slice(-4);
                            let baseName = "Unknown Token";
                            let baseLogo: string | undefined;

                            // Try DexScreener first for base token metadata
                            try {
                              const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${baseMintAddr}`);
                              const dexData = await dexRes.json();
                              const bestPair = dexData?.pairs?.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))?.[0];
                              if (bestPair) {
                                const isBase = bestPair.baseToken?.address === baseMintAddr;
                                const td = isBase ? bestPair.baseToken : bestPair.quoteToken;
                                if (td?.symbol) baseSymbol = td.symbol;
                                if (td?.name) baseName = td.name;
                                baseLogo = bestPair.info?.imageUrl || undefined;
                              }
                            } catch {}

                            // Helius fallback for logo and metadata
                            if (!baseLogo || baseSymbol.includes("...")) {
                              try {
                                const baseAssetRes = await fetch(rpcUrl, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ jsonrpc: "2.0", id: "base-decode", method: "getAsset", params: { id: baseMintAddr } }),
                                });
                                const baseAssetData = await baseAssetRes.json();
                                const bMeta = baseAssetData?.result?.content?.metadata;
                                if (bMeta?.symbol && baseSymbol.includes("...")) baseSymbol = bMeta.symbol;
                                if (bMeta?.name && baseName === "Unknown Token") baseName = bMeta.name;
                                if (!baseLogo) {
                                  const rawLogo = baseAssetData?.result?.content?.links?.image || baseAssetData?.result?.content?.files?.[0]?.cdn_uri;
                                  if (rawLogo) baseLogo = rawLogo.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=').replace('https://stakepoint.app/api/ipfs-image?cid=', 'https://stakepoint.app/api/ipfs-image?cid=');
                                }
                              } catch {}
                            }

                            // Birdeye fallback for base token
                            if (!baseLogo || baseSymbol.includes("...")) {
                              try {
                                const birdRes = await birdeyeFetch(`/api/birdeye?path=/defi/token_overview&address=${baseMintAddr}`);
                                const birdData = await birdRes.json();
                                if (birdData?.data) {
                                  if (birdData.data.symbol && baseSymbol.includes("...")) baseSymbol = birdData.data.symbol;
                                  if (birdData.data.name && baseName === "Unknown Token") baseName = birdData.data.name;
                                  if (!baseLogo && birdData.data.logoURI) baseLogo = birdData.data.logoURI.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=');
                                }
                              } catch {}
                            }

                            resolvedSymbol = `${baseSymbol}-${quoteSymbol} LP`;
                            resolvedName = `${baseName} Liquidity Pool`;
                            resolvedLogo = baseLogo;
                            console.log(`✅ LP resolved via on-chain decode: ${resolvedSymbol}`);
                            tokens.push({
                              mint,
                              balance,
                              decimals: tokenAmount.decimals,
                              symbol: resolvedSymbol,
                              name: resolvedName,
                              logoURI: resolvedLogo,
                              programId: account.programIdKey,
                              isLpToken: true,
                              lpPoolId: poolPubkey,
                            });
                            continue;
                          }
                        } catch (decodeErr) {
                          console.warn(`⚠️ On-chain pool decode failed for ${poolPubkey}:`, decodeErr);
                        }
                      }
                    }
                  } catch (cpmmErr) {
                    console.warn(`⚠️ Raydium CPMM lookup failed for ${mint}:`, cpmmErr);
                  }
                }

                // 🔍 Transaction-history fallback: find pool from LP mint's creation tx
                if (!resolvedLogo && resolvedName === "Unknown Token") {
                  try {
                    const rpcUrl = "/api/rpc";
                    const CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
                    const AMM_V4_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
                    const sigsRes = await fetch(rpcUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ jsonrpc: "2.0", id: "lp-sigs", method: "getSignaturesForAddress", params: [mint, { limit: 5 }] }),
                    });
                    const sigsData = await sigsRes.json();
                    const sigs = sigsData?.result || [];
                    if (sigs.length > 0) {
                      const oldestSig = sigs[sigs.length - 1].signature;
                      const txRes = await fetch(rpcUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ jsonrpc: "2.0", id: "lp-tx", method: "getTransaction", params: [oldestSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }),
                      });
                      const txData = await txRes.json();
                      const allKeys = txData?.result?.transaction?.message?.accountKeys?.map((k: any) => k.pubkey) || [];
                      const isCPMM = allKeys.includes(CPMM_PROGRAM);
                      const isAMMV4 = allKeys.includes(AMM_V4_PROGRAM);
                      if (isCPMM || isAMMV4) {
                        const targetProgram = isCPMM ? CPMM_PROGRAM : AMM_V4_PROGRAM;
                        // Find pool account (owned by the DEX program)
                        let poolAddr: string | null = null;
                        const candidateKeys = allKeys.filter((k: string) => k !== targetProgram && k !== mint);
                        for (const candidate of candidateKeys) {
                          const accRes = await fetch(rpcUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ jsonrpc: "2.0", id: candidate, method: "getAccountInfo", params: [candidate, { encoding: "jsonParsed" }] }),
                          });
                          const accData = await accRes.json();
                          if (accData?.result?.value?.owner === targetProgram) {
                            poolAddr = candidate;
                            break;
                          }
                        }
                        if (poolAddr) {
                          console.log(`🔍 Found ${isCPMM ? 'CPMM' : 'AMM V4'} pool via tx history: ${poolAddr}`);
                          // Try Raydium API first
                          let apiResolved = false;
                          try {
                            const rayRes = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolAddr}`);
                            const rayData = await rayRes.json();
                            const pool = rayData?.data?.[0];
                            if (pool && pool.mintA && pool.mintB) {
                              const SOL_MINT = "So11111111111111111111111111111111111111112";
                              const baseT = pool.mintA?.address === SOL_MINT ? pool.mintB : pool.mintA;
                              const quoteT = pool.mintA?.address === SOL_MINT ? pool.mintA : pool.mintB;
                              resolvedSymbol = `${baseT.symbol}-${quoteT.symbol} LP`;
                              resolvedName = `${baseT.name} Liquidity Pool`;
                              resolvedLogo = baseT.logoURI || undefined;
                              apiResolved = true;
                            }
                          } catch {}
                          // Fallback: decode vaults from pool account, resolve to mints
                          if (!apiResolved) {
                            const poolAccRes = await fetch(rpcUrl, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ jsonrpc: "2.0", id: "pool-raw", method: "getAccountInfo", params: [poolAddr, { encoding: "base64" }] }),
                            });
                            const poolAccData = await poolAccRes.json();
                            const rawB64 = poolAccData?.result?.value?.data?.[0];
                            if (rawB64) {
                              const rawBytes = Uint8Array.from(atob(rawB64), c => c.charCodeAt(0));
                              // Read addresses at known vault offsets and resolve via jsonParsed
                              const vaultOffsets = isCPMM ? [72, 104] : [400, 432];
                              const resolvedMints: string[] = [];
                              for (const off of vaultOffsets) {
                                const addr = new PublicKey(rawBytes.slice(off, off + 32)).toString();
                                try {
                                  const vaultRes = await fetch(rpcUrl, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ jsonrpc: "2.0", id: addr, method: "getAccountInfo", params: [addr, { encoding: "jsonParsed" }] }),
                                  });
                                  const vaultData = await vaultRes.json();
                                  const vaultMint = vaultData?.result?.value?.data?.parsed?.info?.mint;
                                  resolvedMints.push(vaultMint || addr);
                                } catch {
                                  resolvedMints.push(addr);
                                }
                              }
                              const SOL_MINT = "So11111111111111111111111111111111111111112";
                              const knownQuotes: Record<string, string> = {
                                [SOL_MINT]: "WSOL",
                                "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
                                "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
                              };
                              const baseMintAddr = knownQuotes[resolvedMints[0]] ? resolvedMints[1] : resolvedMints[0];
                              const quoteMintAddr = knownQuotes[resolvedMints[0]] ? resolvedMints[0] : resolvedMints[1];
                              const quoteSymbol = knownQuotes[quoteMintAddr] || "UNKNOWN";
                              let baseSymbol = baseMintAddr.slice(0, 4) + "..." + baseMintAddr.slice(-4);
                              let baseName = "Unknown Token";
                              let baseLogo: string | undefined;
                              // DexScreener
                              try {
                                const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${baseMintAddr}`);
                                const dexData = await dexRes.json();
                                const bestPair = dexData?.pairs?.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))?.[0];
                                if (bestPair) {
                                  const isBase = bestPair.baseToken?.address === baseMintAddr;
                                  const td = isBase ? bestPair.baseToken : bestPair.quoteToken;
                                  if (td?.symbol) baseSymbol = td.symbol;
                                  if (td?.name) baseName = td.name;
                                  baseLogo = bestPair.info?.imageUrl || undefined;
                                }
                              } catch {}
                              // Helius fallback
                              if (!baseLogo || baseSymbol.includes("...")) {
                                try {
                                  const baseAssetRes = await fetch(rpcUrl, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ jsonrpc: "2.0", id: "base-tx", method: "getAsset", params: { id: baseMintAddr } }),
                                  });
                                  const baseAssetData = await baseAssetRes.json();
                                  const bMeta = baseAssetData?.result?.content?.metadata;
                                  if (bMeta?.symbol && baseSymbol.includes("...")) baseSymbol = bMeta.symbol;
                                  if (bMeta?.name && baseName === "Unknown Token") baseName = bMeta.name;
                                  if (!baseLogo) {
                                    const rawLogo = baseAssetData?.result?.content?.links?.image || baseAssetData?.result?.content?.files?.[0]?.cdn_uri;
                                    if (rawLogo) baseLogo = rawLogo.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=').replace('https://stakepoint.app/api/ipfs-image?cid=', 'https://stakepoint.app/api/ipfs-image?cid=');
                                  }
                                } catch {}
                              }
                              // Birdeye fallback
                              if (!baseLogo || baseSymbol.includes("...")) {
                                try {
                                  const birdRes = await birdeyeFetch(`/api/birdeye?path=/defi/token_overview&address=${baseMintAddr}`);
                                  const birdData = await birdRes.json();
                                  if (birdData?.data) {
                                    if (birdData.data.symbol && baseSymbol.includes("...")) baseSymbol = birdData.data.symbol;
                                    if (birdData.data.name && baseName === "Unknown Token") baseName = birdData.data.name;
                                    if (!baseLogo && birdData.data.logoURI) baseLogo = birdData.data.logoURI.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=');
                                  }
                                } catch {}
                              }
                              resolvedSymbol = `${baseSymbol}-${quoteSymbol} LP`;
                              resolvedName = `${baseName} Liquidity Pool`;
                              resolvedLogo = baseLogo;
                              console.log(`✅ LP resolved via tx-history fallback: ${resolvedSymbol}`);
                              tokens.push({
                                mint,
                                balance,
                                decimals: tokenAmount.decimals,
                                symbol: resolvedSymbol,
                                name: resolvedName,
                                logoURI: resolvedLogo,
                                programId: account.programIdKey,
                                isLpToken: true,
                                lpPoolId: poolAddr,
                                baseMint: baseMintAddr,
                              });
                              continue;
                            }
                          }
                          if (apiResolved) {
                            // Upgrade logo via Helius
                            if (resolvedLogo) {
                              try {
                                const rayRes2 = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolAddr}`);
                                const rayData2 = await rayRes2.json();
                                const baseAddr = rayData2?.data?.[0]?.mintA?.address === "So11111111111111111111111111111111111111112" ? rayData2?.data?.[0]?.mintB?.address : rayData2?.data?.[0]?.mintA?.address;
                                if (baseAddr) {
                                  const baseAssetRes = await fetch(rpcUrl, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ jsonrpc: "2.0", id: "hi-res", method: "getAsset", params: { id: baseAddr } }),
                                  });
                                  const baseAssetData = await baseAssetRes.json();
                                  const hiRes = baseAssetData?.result?.content?.links?.image;
                                  if (hiRes) resolvedLogo = hiRes.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=').replace('https://stakepoint.app/api/ipfs-image?cid=', 'https://stakepoint.app/api/ipfs-image?cid=');
                                }
                              } catch {}
                            }
                            tokens.push({
                              mint,
                              balance,
                              decimals: tokenAmount.decimals,
                              symbol: resolvedSymbol,
                              name: resolvedName,
                              logoURI: resolvedLogo,
                              programId: account.programIdKey,
                              isLpToken: true,
                              lpPoolId: poolAddr,
                            });
                            continue;
                          }
                        }
                      }
                    }
                  } catch (txFallbackErr) {
                    console.warn(`⚠️ Tx-history LP fallback failed for ${mint}:`, txFallbackErr);
                  }
                }

                try {
                  const rpcUrl = "/api/rpc";
                  const heliusRes = await fetch(rpcUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      jsonrpc: "2.0",
                      id: "helius-das",
                      method: "getAsset",
                      params: { id: mint },
                    }),
                  });
                  const heliusData = await heliusRes.json();
                  const jsonUri = heliusData?.result?.content?.json_uri;
                  const directLogo = heliusData?.result?.content?.links?.image || heliusData?.result?.content?.files?.[0]?.cdn_uri || undefined;
                  if (directLogo && !resolvedLogo) resolvedLogo = directLogo;

                  if (jsonUri) {
                    const metaRes = await fetch(jsonUri);
                    const metaData = await metaRes.json();

                    if (metaData?.poolInfo?.mintA && metaData?.poolInfo?.mintB) {
                      const quoteMints = [
                        "So11111111111111111111111111111111111111112",
                        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                      ];
                      const baseToken = quoteMints.includes(metaData.poolInfo.mintA.address)
                        ? metaData.poolInfo.mintB
                        : metaData.poolInfo.mintA;

                      resolvedSymbol = `${baseToken.symbol} LP`;
                      resolvedName = `${baseToken.name} Liquidity Pool`;
                      resolvedLogo = baseToken.logoURI || undefined;

                      // If LP metadata has no logo, fetch from base token's own on-chain metadata
                      if (!resolvedLogo) {
                        try {
                          const baseAssetRes = await fetch(rpcUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              jsonrpc: "2.0",
                              id: "helius-base",
                              method: "getAsset",
                              params: { id: baseToken.address },
                            }),
                          });
                          const baseAssetData = await baseAssetRes.json();
                          const baseContent = baseAssetData?.result?.content;
                          resolvedLogo = baseContent?.links?.image
                            || baseContent?.files?.[0]?.cdn_uri
                            || baseContent?.files?.[0]?.uri
                            || undefined;
                          if (resolvedLogo) {
                            console.log(`✅ Logo fetched from base token metadata: ${resolvedLogo}`);
                          }
                        } catch (logoErr) {
                          console.warn(`⚠️ Could not fetch base token logo:`, logoErr);
                        }
                      }

                      console.log(`✅ LP resolved: ${resolvedSymbol} (${resolvedName})`);
                    } else {
                      // Has metadata but not a pool
                      const meta = heliusData?.result?.content?.metadata;
                      if (meta?.name) {
                        resolvedName = meta.name;
                        resolvedSymbol = meta.symbol || resolvedSymbol;
                      }
                      resolvedLogo = heliusData?.result?.content?.links?.image || undefined;
                    }
                  }
                } catch (lpErr) {
                  console.warn(`⚠️ LP resolution failed for ${mint}:`, lpErr);
                }

                tokens.push({
                  mint,
                  balance,
                  decimals: tokenAmount.decimals,
                  symbol: resolvedSymbol,
                  name: resolvedName,
                  logoURI: resolvedLogo,
                  programId: account.programIdKey,
                });
              }
            } catch (err) {
              console.error(`❌ Token metadata error for ${mint}:`, err);
              tokens.push({
                mint,
                balance,
                decimals: tokenAmount.decimals,
                symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
                name: "Unknown Token",
                logoURI: undefined,
                programId: account.programIdKey,
              });
            }
          }
        } catch (parseError) {
          console.error("Error parsing token account:", parseError);
        }
      }

      console.log("🎉 Total tokens loaded:", tokens.length);

      // Sort by balance value (price * balance), then by balance
      tokens.sort((a, b) => {
        const aValue = (a.price || 0) * a.balance;
        const bValue = (b.price || 0) * b.balance;
        if (bValue !== aValue) return bValue - aValue;
        return b.balance - a.balance;
      });

      setUserTokens(tokens);
      setStatusMessage("");

      // 🔄 Auto-retry resolution for any tokens still showing "Unknown Token"
      const unknowns = tokens.filter(t => t.name === "Unknown Token" || t.symbol?.includes("..."));
      if (unknowns.length > 0) {
        console.log(`🔄 ${unknowns.length} unresolved token(s), scheduling retry...`);
        for (let retry = 1; retry <= 3; retry++) {
          await new Promise(r => setTimeout(r, 3000 * retry));
          let anyResolved = false;
          for (const token of unknowns) {
            if (token.name !== "Unknown Token" && !token.symbol?.includes("...")) continue;
            console.log(`🔄 Retry ${retry}/3 for ${token.mint}`);
            try {
              const birdeyeRes = await birdeyeFetch(`/api/birdeye?path=/defi/token_overview&address=${token.mint}`);
              if (birdeyeRes.status === 429) {
                console.warn(`⚠️ Birdeye rate limited on retry for ${token.mint}, backing off`);
                await new Promise(r => setTimeout(r, 1500));
                continue;
              }
              const birdeyeData = await birdeyeRes.json();
              if (birdeyeData?.data?.symbol) {
                token.symbol = birdeyeData.data.symbol;
                token.name = birdeyeData.data.name || token.name;
                token.logoURI = birdeyeData.data.logoURI ? birdeyeData.data.logoURI.replace('https://ipfs.io/ipfs/', 'https://stakepoint.app/api/ipfs-image?cid=') : token.logoURI;
                anyResolved = true;
                console.log(`✅ Retry resolved via Birdeye: ${token.symbol}`);
                continue;
              }
            } catch {}
            try {
              const dexRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${token.mint}`);
              const dexData = await dexRes.json();
              if (dexData?.[0]) {
                const isBase = dexData[0].baseToken?.address === token.mint;
                const td = isBase ? dexData[0].baseToken : dexData[0].quoteToken;
                if (td?.symbol) { token.symbol = td.symbol; token.name = td.name || token.name; anyResolved = true; console.log(`✅ Retry resolved via DexScreener: ${token.symbol}`); continue; }
              }
            } catch {}
            try {
              const heliusRes = await fetch("/api/rpc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: "retry-asset", method: "getAsset", params: { id: token.mint } }),
              });
              const heliusData = await heliusRes.json();
              const meta = heliusData?.result?.content?.metadata;
              if (meta?.symbol && meta.symbol !== token.symbol) {
                token.symbol = meta.symbol;
                token.name = meta.name || token.name;
                token.logoURI = token.logoURI || heliusData?.result?.content?.links?.image || undefined;
                anyResolved = true;
                console.log(`✅ Retry resolved via Helius: ${token.symbol}`);
              }
            } catch {}
          }
          if (anyResolved) {
            setUserTokens([...tokens]);
          }
          if (unknowns.every(t => t.name !== "Unknown Token" && !t.symbol?.includes("..."))) {
            console.log(`✅ All tokens resolved after retry ${retry}`);
            break;
          }
        }
      }
    } catch (error) {
      console.error("Error fetching tokens:", error);
      setError("Failed to load your tokens");
    } finally {
      setIsLoadingTokens(false);
    }
  };


  const vestingDurationOptions = [
    { label: "1 Day", value: 86400 },
    { label: "7 Days", value: 604800 },
    { label: "30 Days", value: 2592000 },
    { label: "90 Days", value: 7776000 },
    { label: "180 Days", value: 15552000 },
    { label: "365 Days", value: 31536000 },
  ];

  const cliffOptions = [
    { label: "None", value: 0 },
    { label: "1 Day", value: 86400 },
    { label: "7 Days", value: 604800 },
    { label: "30 Days", value: 2592000 },
    { label: "90 Days", value: 7776000 },
    { label: "180 Days", value: 15552000 },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // ✅ Check wallet connection first
    if (!publicKey || !wallet || !anchorWallet) {
      setError("Please connect your wallet");
      return;
    }

    if (!selectedToken) {
      setError("Please select a token");
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter an amount greater than zero");
      return;
    }

    if (parseFloat(amount) > selectedToken.balance) {
      setError(`Insufficient balance. You have ${selectedToken.balance.toLocaleString()} ${selectedToken.symbol}`);
      return;
    }

    if (!beneficiary.trim()) {
      setError("Please enter a beneficiary wallet address");
      return;
    }

    let beneficiaryPubkey: PublicKey;
    try {
      beneficiaryPubkey = new PublicKey(beneficiary.trim());
    } catch {
      setError("Invalid beneficiary wallet address");
      return;
    }

    // Calculate final vesting duration in seconds
    let finalDuration = 0;
    if (selectedDuration === "custom") {
      if (!customDays || parseInt(customDays) <= 0) {
        setError("Please select a vesting end date");
        return;
      }
      finalDuration = parseInt(customDays);
    } else if (typeof selectedDuration === "number") {
      finalDuration = selectedDuration;
    } else {
      setError("Please select a vesting duration");
      return;
    }

    // Calculate final cliff in seconds
    let finalCliff = 0;
    if (selectedCliff === "custom") {
      if (!customCliffDays || parseInt(customCliffDays) <= 0) {
        setError("Please select a cliff date");
        return;
      }
      finalCliff = parseInt(customCliffDays);
    } else {
      finalCliff = selectedCliff;
    }

    if (finalCliff > finalDuration) {
      setError("Cliff cannot be longer than the total vesting duration");
      return;
    }

    setIsCreating(true);

    try {
      const program = getProgram(anchorWallet, connection);
      const tokenMintPubkey = new PublicKey(selectedToken.mint);

      // Detect token program for this mint
      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!mintInfo) throw new Error("Token mint not found");
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      console.log(`✅ Token program: ${tokenProgramId.toString()}`);

      // Find next available schedule slot for this creator/beneficiary/mint
      setStatusMessage("Checking existing schedules...");
      let scheduleId = 0;
      let slotTaken = true;
      while (slotTaken && scheduleId < 100) {
        const [candidatePDA] = getPDAs.vestingSchedule(publicKey, beneficiaryPubkey, tokenMintPubkey, scheduleId);
        try {
          const info = await connection.getAccountInfo(candidatePDA);
          if (info !== null) {
            console.log(`⚠️ Schedule ${scheduleId} already exists`);
            scheduleId++;
          } else {
            console.log(`✅ Found available scheduleId: ${scheduleId}`);
            slotTaken = false;
          }
        } catch {
          slotTaken = false;
        }
      }
      if (slotTaken) throw new Error("Unable to find an available vesting slot for this beneficiary. Please contact support.");

      const [schedulePDA] = getPDAs.vestingSchedule(publicKey, beneficiaryPubkey, tokenMintPubkey, scheduleId);
      const [vaultPDA] = getPDAs.vestingVault(publicKey, beneficiaryPubkey, tokenMintPubkey, scheduleId);
      const [platformPDA] = getPDAs.platformConfig();

      // Read fee collector from platform config
      const platformAccount = await program.account.platform.fetch(platformPDA);
      const feeCollectorPubkey = platformAccount.feeCollector as PublicKey;

      // Creator's token account
      const creatorTokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: tokenMintPubkey });
      if (creatorTokenAccounts.value.length === 0) throw new Error("No token account found for this token");
      const creatorTokenAccount = creatorTokenAccounts.value[0].pubkey;

      // Fee collector ATA must match what the contract derives
      const feeCollectorTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey,
        feeCollectorPubkey,
        true,
        tokenProgramId
      );

      const rawAmount = new BN(
        Math.floor(parseFloat(amount) * Math.pow(10, selectedToken.decimals)).toString()
      );

      // ── Single transaction: createVesting ──
      setStatusMessage("Please approve the vesting transaction...");
      setVestStep(1);
      setIsConfirming(true);

      const vestTx = new Transaction();
      vestTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }));
      vestTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));

      // Create the fee collector ATA if it does not exist yet
      const feeCollectorAccountInfo = await connection.getAccountInfo(feeCollectorTokenAccount);
      if (!feeCollectorAccountInfo) {
        vestTx.add(createAssociatedTokenAccountInstruction(
          publicKey, feeCollectorTokenAccount, feeCollectorPubkey, tokenMintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID
        ));
      }

      const createVestingIx = await program.methods
        .createVesting(
          beneficiaryPubkey,
          new BN(scheduleId),
          rawAmount,
          new BN(finalCliff),
          new BN(finalDuration),
          revocable
        )
        .accounts({
          platform: platformPDA,
          vestingSchedule: schedulePDA,
          vestingVault: vaultPDA,
          creatorTokenAccount: creatorTokenAccount,
          feeCollector: feeCollectorPubkey,
          feeCollectorTokenAccount: feeCollectorTokenAccount,
          tokenMint: tokenMintPubkey,
          creator: publicKey,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      vestTx.add(createVestingIx);

      const { blockhash } = await connection.getLatestBlockhash();
      vestTx.recentBlockhash = blockhash;
      vestTx.feePayer = publicKey;

      const tx = await sendTransaction(vestTx, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      setVestStep(2);
      console.log("✅ Vesting transaction sent:", tx);

      setStatusMessage("Confirming vesting...");
      await confirmTransactionPolling(connection, tx);
      console.log("✅ Vesting confirmed:", tx);

      setVestStep(3);
      setStatusMessage("Saving vesting details...");

      const response = await fetch("/api/vesting", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduleId,
          tokenMint: selectedToken.mint,
          name: selectedToken.name || selectedToken.symbol,
          symbol: selectedToken.symbol || "UNKNOWN",
          decimals: selectedToken.decimals,
          totalAmount: parseFloat(amount),
          cliffSeconds: Math.min(finalCliff, 2147483647),
          totalDurationSeconds: Math.min(finalDuration, 2147483647),
          creatorWallet: publicKey.toString(),
          beneficiaryWallet: beneficiaryPubkey.toString(),
          schedulePda: schedulePDA.toString(),
          vaultPda: vaultPDA.toString(),
          logo: selectedToken.logoURI || null,
          revocable,
          createTxSignature: tx,
        }),
      });

      setIsBroadcasting(false);
      let savedVesting = null;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("❌ Failed to save vesting to database:", errorData);
        setError("Your vesting schedule was created on-chain successfully, but we couldn't save it to our database. Your tokens are safe in the vault. Please email contact@stakepoint.app with your wallet address so we can sync your vesting record.");
        setIsCreating(false);
        return;
      } else {
        savedVesting = await response.json();
      }

      setStatusMessage("Vesting schedule created successfully! ✅");
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'vesting_created', { modal_name: 'create_vesting', token: selectedToken?.symbol, duration: finalDuration });
      }

      // Reset form
      setSelectedToken(null);
      setAmount("");
      setBeneficiary("");
      setCustomDays("");
      setSelectedDuration("");
      setCustomCliffDays("");
      setSelectedCliff(0);
      setRevocable(false);

      const durationLabel = selectedDuration === "custom"
        ? (customEndLabel ? `Until ${customEndLabel}` : `${Math.round(finalDuration / 86400)} days`)
        : vestingDurationOptions.find(o => o.value === selectedDuration)?.label || `${Math.round(finalDuration / 86400)} days`;

      setSuccessData({
        tokenSymbol: selectedToken.symbol || "tokens",
        amount,
        duration: durationLabel,
        beneficiary: beneficiaryPubkey.toString(),
        vestingPageUrl: savedVesting ? `/vesting/${savedVesting.id}` : `/vesting`,
      });
      setShowSuccessModal(true);
      onSuccess();
    } catch (err: any) {
      console.error("Error creating vesting schedule:", err);
      console.error("Error logs:", err?.logs);
      console.error("Error cause:", err?.cause);

      const anchorErrorMap: Record<number, string> = {
        6000: "Unauthorized.",
        6001: "Invalid amount. Check the amount, cliff and duration are valid.",
        6002: "Insufficient balance.",
        6011: "Math overflow. Try a smaller amount.",
        6024: "Vesting duration must be greater than zero.",
        6026: "Invalid fee collector account.",
        6028: "Native SOL cannot be vested. Please select an SPL token.",
        6030: "Your token account could not be verified.",
      };

      const code = err?.error?.errorCode?.number ?? err?.code;
      let message = anchorErrorMap[code] || err?.message || "Failed to create vesting schedule";

      if (typeof message === "string" && message.includes("already in use")) {
        message = "A vesting schedule already exists for this beneficiary and token. Please try again.";
      }
      if (typeof message === "string" && (message.includes("User rejected") || message.includes("rejected the request"))) {
        message = "Transaction cancelled.";
      }
      if (typeof message === "string" && message.includes("insufficient")) {
        message = "Insufficient SOL for transaction fees. You need at least 0.02 SOL.";
      }

      setError(message);
      setIsConfirming(false);
      setIsBroadcasting(false);
      setVestStep(0);
    } finally {
      setIsCreating(false);
      setStatusMessage("");
      setVestStep(0);
    }
  };

  const filteredTokens = userTokens.filter((token) => {
    if (!tokenSearchQuery) return true;
    const q = tokenSearchQuery.toLowerCase();
    return (
      token.symbol?.toLowerCase().includes(q) ||
      token.name?.toLowerCase().includes(q) ||
      token.mint.toLowerCase().includes(q)
    );
  });

  const beneficiaryValid = (() => {
    if (!beneficiary.trim()) return null;
    try {
      new PublicKey(beneficiary.trim());
      return true;
    } catch {
      return false;
    }
  })();

  if (!isOpen) return null;


  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3">
      <div className="bg-black/95 rounded-2xl w-full max-w-lg flex flex-col border border-white/[0.08]" style={{ maxHeight: '96vh' }}>

        {showIntro ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center flex-1 min-h-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'linear-gradient(135deg, #1a001a, #fb57ff)' }}>
              <Clock className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Vest tokens on Solana</h2>
            <p className="text-sm text-gray-400 mb-6">Your trusted non-custodial Solana token vesting</p>

            <div className="w-full max-w-xs space-y-3 mb-6">
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

            <p className="text-xs text-gray-500 mb-6 max-w-xs text-center leading-relaxed">Release tokens gradually to team members, investors or advisors. Compatible with all SPL and Token-2022 tokens.</p>

            <button
              onClick={() => setShowIntro(false)}
              className="w-full max-w-xs py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
            >
              Create Vesting
            </button>
            <button onClick={onClose} className="mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        ) : (
        <>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2" style={{ background: 'linear-gradient(45deg, white, #fb57ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            <Clock className="w-4 h-4 flex-shrink-0" style={{ color: '#fb57ff' }} />
            Create Vesting Schedule
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 px-5 py-2.5 border-b border-white/[0.08] flex-shrink-0">
          {(['Token & Amount', 'Schedule'] as const).map((label, i) => {
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
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0" style={{ minHeight: '60vh' }}>
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

            {/* ── STEP 1 ── */}
            {step === 1 && (
            <div className="space-y-3">

            {/* Vesting vs Locking */}
            <div className="p-3 bg-white/[0.02] border border-white/[0.1] rounded-lg">
              <p className="text-xs font-semibold text-white mb-1.5">Vesting is not the same as locking</p>
              <p className="text-xs text-gray-400 leading-relaxed mb-2.5">
                Vesting sends tokens gradually to <strong className="text-gray-300">another wallet</strong> and cannot be reversed once vested. If you want to hold your own tokens until a single unlock date and get the full amount back yourself, you want a lock instead.
              </p>
              <a
                href="/locks"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: 'rgba(0,212,255,0.1)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.25)' }}
              >
                Go to Token Locker →
              </a>
            </div>

              {/* Token Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Select Token *</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTokenSelector(!showTokenSelector)}
                  disabled={isLoadingTokens}
                  className="w-full p-2.5 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white focus:outline-none transition-colors flex items-center justify-between hover:border-[#fb57ff]/50 text-sm"
                >
                  {selectedToken ? (
                    <div className="flex items-center gap-2">
                      {selectedToken.logoURI ? (
                        <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-5 h-5 rounded-full" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#fb57ff] to-purple-600" />
                      )}
                      <div className="text-left">
                        <p className="font-semibold text-sm">{selectedToken.symbol}</p>
                        <p className="text-xs text-gray-400">Balance: {selectedToken.balance.toLocaleString()}</p>
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-400 text-sm">
                      {isLoadingTokens ? "Loading tokens..." : "Choose a token"}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showTokenSelector ? "rotate-180" : ""}`} />
                </button>

                {/* Token Dropdown */}
                {showTokenSelector && !isLoadingTokens && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-black border border-white/[0.1] rounded-lg shadow-xl z-20 max-h-72 overflow-hidden">
                    <div className="p-2 border-b border-white/[0.1]">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="text"
                          value={tokenSearchQuery}
                          onChange={(e) => setTokenSearchQuery(e.target.value)}
                          placeholder="Search tokens..."
                          className="w-full pl-8 pr-3 py-1.5 bg-white/[0.05] border border-white/[0.1] rounded-lg text-white text-xs focus:outline-none focus:border-[#fb57ff]/50"
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredTokens.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-xs">No tokens found</div>
                      ) : (
                        filteredTokens.map((token) => (
                          <button
                            key={token.mint}
                            type="button"
                            onClick={() => { setSelectedToken(token); setShowTokenSelector(false); setTokenSearchQuery(""); }}
                            className="w-full p-2.5 flex items-center gap-2.5 hover:bg-white/[0.05] transition-colors border-b border-white/[0.05] text-left"
                          >
                            {token.logoURI ? (
                              <img src={token.logoURI} alt={token.symbol} className="w-7 h-7 rounded-full" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#fb57ff] to-purple-600" />
                            )}
                            <div className="flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-white text-xs">{token.symbol}</p>
                                <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: token.programId?.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? 'rgba(96, 165, 250, 0.1)' : 'rgba(251, 87, 255, 0.1)', color: token.programId?.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") ? '#60a5fa' : '#fb57ff' }}>
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
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Amount to Vest *</label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-sm focus:outline-none focus:border-[#fb57ff]/50 transition-colors"
                  required
                />
                {selectedToken && selectedToken.balance > 0 && (
                  <button type="button" onClick={async () => { try { const accs = await connection.getParsedTokenAccountsByOwner(publicKey!, { mint: new PublicKey(selectedToken.mint) }); const str = accs.value[0]?.account.data.parsed.info.tokenAmount?.uiAmountString; setAmount(str || String(Math.floor(selectedToken.balance))); } catch { setAmount(String(Math.floor(selectedToken.balance))); } }} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#fb57ff] hover:underline">
                    MAX
                  </button>
                )}
              </div>
              {selectedToken && (
                <p className="text-xs text-gray-400 mt-1">Available: {selectedToken.balance.toLocaleString()} {selectedToken.symbol}</p>
              )}
              {selectedToken && (() => {
                const safeMaxTokens = Number(BigInt("18446744073709551615") / BigInt(200)) / Math.pow(10, selectedToken.decimals);
                const enteredAmount = parseFloat(amount) || 0;
                const isOverMax = enteredAmount > safeMaxTokens;
                return safeMaxTokens < selectedToken.balance ? (
                  <>
                    <p className={`text-xs mt-1 ${isOverMax ? 'text-red-400 font-medium' : 'text-gray-600'}`}>
                      Max single schedule: {safeMaxTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedToken.symbol}
                      {isOverMax && ', split into multiple schedules'}
                    </p>
                    {isOverMax && (
                      <p className="text-xs mt-1 text-red-400 font-medium">
                        ❌ Amount exceeds maximum. Please reduce the amount or split into multiple schedules.
                      </p>
                    )}
                  </>
                ) : null;
              })()}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedToken || !amount || parseFloat(amount) <= 0}
                onClick={() => { setError(""); setStep(2); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 text-white"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
              >
                Continue
              </button>
            </div>

            </div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && (
            <div className="space-y-3">

            {/* Info Box */}
            <div className="p-2.5 bg-white/[0.02] border border-white/[0.1] rounded-lg">
              <p className="text-gray-400 text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                Tokens unlock gradually over the vesting period and can only be claimed by the beneficiary.
              </p>
            </div>

            {/* Beneficiary */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Beneficiary Wallet *</label>
              <input
                type="text"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                placeholder="Wallet address that will receive the tokens"
                className={`w-full px-3 py-2 bg-white/[0.02] border rounded-lg text-white text-sm focus:outline-none transition-colors ${beneficiaryValid === false ? 'border-red-500/50' : 'border-white/[0.1] focus:border-[#fb57ff]/50'}`}
                required
              />
              {beneficiaryValid === false && (
                <p className="text-xs text-red-400 mt-1">Not a valid Solana wallet address</p>
              )}
              <p className="text-xs text-gray-400 mt-1">Only this wallet can claim tokens as they unlock.</p>
            </div>

            {/* Vesting Duration */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-400 mb-1">Vesting Duration *</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {vestingDurationOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => { setSelectedDuration(option.value); setShowCalendar(false); }}
                    className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${
                      selectedDuration === option.value
                        ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white"
                        : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setSelectedDuration("custom"); setCalSelectedDate(null); setShowCliffCalendar(false); setShowCalendar(prev => !prev); }}
                  className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${
                    selectedDuration === "custom"
                      ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white"
                      : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"
                  }`}
                >
                  📅 Custom
                </button>
              </div>
              {selectedDuration === "custom" && customEndLabel && !showCalendar && (
                <p className="text-xs text-[#fb57ff] mt-1.5 truncate">Fully vested {customEndLabel}</p>
              )}

              {showCalendar && (() => {
                const now = new Date();
                const minEnd = new Date(now.getTime() + 60 * 60 * 1000);
                const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
                const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
                const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

                let endPreview = "";
                let previewValid = false;
                if (calSelectedDate) {
                  const end = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate(), calHour, calMinute, 0);
                  if (end > minEnd) {
                    const diffSecs = Math.floor((end.getTime() - now.getTime()) / 1000);
                    const diffDays = Math.floor(diffSecs / 86400);
                    const diffHrs = Math.floor((diffSecs % 86400) / 3600);
                    const diffMins = Math.floor((diffSecs % 3600) / 60);
                    const humanDiff = diffDays > 0 ? `${diffDays}d ${diffHrs}h` : diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins}m`;
                    endPreview = `Fully vested ${calSelectedDate.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')} (${humanDiff})`;
                    previewValid = true;
                  } else {
                    endPreview = "Must be at least 1 hour from now";
                  }
                } else {
                  endPreview = "Select a date above";
                }

                return (
                  <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCalendar(false)} />
                  <div className="relative bg-[#0d0d0d] border border-white/[0.12] rounded-xl p-4 w-full max-w-xs shadow-2xl">
                    <p className="text-xs text-gray-500 mb-3 text-center">When should vesting complete?</p>
                    {/* Month navigation */}
                    <div className="flex items-center justify-between mb-3">
                      <button
                        type="button"
                        onClick={() => { let m = calViewMonth - 1; let y = calViewYear; if (m < 0) { m = 11; y--; } setCalViewMonth(m); setCalViewYear(y); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-[#fb57ff] hover:border-[#fb57ff]/40 transition-colors"
                        aria-label="Previous month"
                      >‹</button>
                      <span className="text-sm font-medium text-white">{MONTHS[calViewMonth]} {calViewYear}</span>
                      <button
                        type="button"
                        onClick={() => { let m = calViewMonth + 1; let y = calViewYear; if (m > 11) { m = 0; y++; } setCalViewMonth(m); setCalViewYear(y); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-[#fb57ff] hover:border-[#fb57ff]/40 transition-colors"
                        aria-label="Next month"
                      >›</button>
                    </div>

                    {/* Day-of-week headers */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                      {DAYS.map(d => (
                        <div key={d} className="text-center text-[10px] text-gray-600 font-medium py-1">{d}</div>
                      ))}
                    </div>

                    {/* Day grid */}
                    <div className="grid grid-cols-7 gap-1 mb-3">
                      {Array.from({ length: firstDay }).map((_, i) => (
                        <div key={`empty-${i}`} />
                      ))}
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                        const dayEnd = new Date(calViewYear, calViewMonth, d, 23, 59, 0);
                        const isToday = calViewYear === now.getFullYear() && calViewMonth === now.getMonth() && d === now.getDate();
                        const isPast = dayEnd < minEnd && !isToday;
                        const isSel = calSelectedDate && calSelectedDate.getFullYear() === calViewYear && calSelectedDate.getMonth() === calViewMonth && calSelectedDate.getDate() === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={isPast}
                            onClick={() => setCalSelectedDate(new Date(calViewYear, calViewMonth, d))}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              isSel ? "bg-[#fb57ff]/25 border border-[#fb57ff]/60 text-white" :
                              isPast ? "text-gray-700 cursor-not-allowed" :
                              isToday ? "text-[#fb57ff] hover:bg-[#fb57ff]/10" :
                              "text-gray-300 hover:bg-[#fb57ff]/10 hover:text-[#fb57ff]"
                            }`}
                          >{d}</button>
                        );
                      })}
                    </div>

                    {/* Time pickers */}
                    <div className="flex items-center gap-2 pb-3 border-b border-white/[0.07]">
                      <span className="text-xs text-gray-500 w-8">Time</span>
                      <select
                        value={calHour}
                        onChange={e => setCalHour(parseInt(e.target.value))}
                        className="flex-1 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#fb57ff]/50"
                        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff' }}
                        aria-label="Hour"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2,'0')}</option>
                        ))}
                      </select>
                      <span className="text-gray-600 text-sm">:</span>
                      <select
                        value={calMinute}
                        onChange={e => setCalMinute(parseInt(e.target.value))}
                        className="flex-1 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#fb57ff]/50"
                        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff' }}
                        aria-label="Minute"
                      >
                        {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => (
                          <option key={m} value={m}>{String(m).padStart(2,'0')}</option>
                        ))}
                      </select>
                    </div>

                    {/* Preview */}
                    <p className={`text-xs text-center mt-2 mb-3 ${previewValid ? "text-[#fb57ff]" : "text-gray-600"}`}>
                      {endPreview}
                    </p>

                    {/* Confirm */}
                    <button
                      type="button"
                      disabled={!previewValid}
                      onClick={() => {
                        if (!previewValid) return;
                        const end = new Date(calSelectedDate!.getFullYear(), calSelectedDate!.getMonth(), calSelectedDate!.getDate(), calHour, calMinute, 0);
                        const secs = Math.floor((end.getTime() - new Date().getTime()) / 1000);
                        const label = `${calSelectedDate!.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')}`;
                        setCustomDays(String(secs));
                        setCustomEndLabel(label);
                        setShowCalendar(false);
                      }}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                    >
                      Set vesting end date
                    </button>
                  </div>
                  </div>
                );
              })()}
            </div>

            {/* Cliff */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-400 mb-1">Cliff</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {cliffOptions.map((option) => {
                  const currentDuration = selectedDuration === "custom" ? parseInt(customDays || "0") : (typeof selectedDuration === "number" ? selectedDuration : 0);
                  const disabled = currentDuration > 0 && option.value > currentDuration;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => { setSelectedCliff(option.value); setShowCliffCalendar(false); }}
                      className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${
                        selectedCliff === option.value
                          ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white"
                          : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"
                      } ${disabled ? "opacity-30 cursor-not-allowed" : ""}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => { setSelectedCliff("custom"); setCalSelectedDate(null); setShowCalendar(false); setShowCliffCalendar(prev => !prev); }}
                  className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${
                    selectedCliff === "custom"
                      ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white"
                      : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"
                  }`}
                >
                  📅 Custom
                </button>
              </div>
              {selectedCliff === "custom" && customCliffLabel && !showCliffCalendar && (
                <p className="text-xs text-[#fb57ff] mt-1.5 truncate">First unlock {customCliffLabel}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">Nothing can be claimed until the cliff has passed.</p>

              {showCliffCalendar && (() => {
                const now = new Date();
                const minCliff = new Date(now.getTime() + 60 * 60 * 1000);
                const durationSecs = selectedDuration === "custom" ? parseInt(customDays || "0") : (typeof selectedDuration === "number" ? selectedDuration : 0);
                const maxCliff = durationSecs > 0 ? new Date(now.getTime() + durationSecs * 1000) : null;
                const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
                const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
                const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

                let cliffPreview = "";
                let previewValid = false;
                if (calSelectedDate) {
                  const cliff = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate(), calHour, calMinute, 0);
                  if (cliff <= minCliff) {
                    cliffPreview = "Must be at least 1 hour from now";
                  } else if (maxCliff && cliff > maxCliff) {
                    cliffPreview = "Cliff cannot be after vesting ends";
                  } else {
                    const diffSecs = Math.floor((cliff.getTime() - now.getTime()) / 1000);
                    const diffDays = Math.floor(diffSecs / 86400);
                    const diffHrs = Math.floor((diffSecs % 86400) / 3600);
                    const diffMins = Math.floor((diffSecs % 3600) / 60);
                    const humanDiff = diffDays > 0 ? `${diffDays}d ${diffHrs}h` : diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins}m`;
                    cliffPreview = `First unlock ${calSelectedDate.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')} (${humanDiff})`;
                    previewValid = true;
                  }
                } else {
                  cliffPreview = "Select a date above";
                }

                return (
                  <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCliffCalendar(false)} />
                  <div className="relative bg-[#0d0d0d] border border-white/[0.12] rounded-xl p-4 w-full max-w-xs shadow-2xl">
                    <p className="text-xs text-gray-500 mb-3 text-center">When should the first tokens unlock?</p>
                    {/* Month navigation */}
                    <div className="flex items-center justify-between mb-3">
                      <button
                        type="button"
                        onClick={() => { let m = calViewMonth - 1; let y = calViewYear; if (m < 0) { m = 11; y--; } setCalViewMonth(m); setCalViewYear(y); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-[#fb57ff] hover:border-[#fb57ff]/40 transition-colors"
                        aria-label="Previous month"
                      >‹</button>
                      <span className="text-sm font-medium text-white">{MONTHS[calViewMonth]} {calViewYear}</span>
                      <button
                        type="button"
                        onClick={() => { let m = calViewMonth + 1; let y = calViewYear; if (m > 11) { m = 0; y++; } setCalViewMonth(m); setCalViewYear(y); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-[#fb57ff] hover:border-[#fb57ff]/40 transition-colors"
                        aria-label="Next month"
                      >›</button>
                    </div>

                    {/* Day-of-week headers */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                      {DAYS.map(d => (
                        <div key={d} className="text-center text-[10px] text-gray-600 font-medium py-1">{d}</div>
                      ))}
                    </div>

                    {/* Day grid */}
                    <div className="grid grid-cols-7 gap-1 mb-3">
                      {Array.from({ length: firstDay }).map((_, i) => (
                        <div key={`empty-${i}`} />
                      ))}
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                        const dayEnd = new Date(calViewYear, calViewMonth, d, 23, 59, 0);
                        const dayStart = new Date(calViewYear, calViewMonth, d, 0, 0, 0);
                        const isToday = calViewYear === now.getFullYear() && calViewMonth === now.getMonth() && d === now.getDate();
                        const isPast = dayEnd < minCliff && !isToday;
                        const isAfterEnd = maxCliff ? dayStart > maxCliff : false;
                        const disabled = isPast || isAfterEnd;
                        const isSel = calSelectedDate && calSelectedDate.getFullYear() === calViewYear && calSelectedDate.getMonth() === calViewMonth && calSelectedDate.getDate() === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            disabled={disabled}
                            onClick={() => setCalSelectedDate(new Date(calViewYear, calViewMonth, d))}
                            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              isSel ? "bg-[#fb57ff]/25 border border-[#fb57ff]/60 text-white" :
                              disabled ? "text-gray-700 cursor-not-allowed" :
                              isToday ? "text-[#fb57ff] hover:bg-[#fb57ff]/10" :
                              "text-gray-300 hover:bg-[#fb57ff]/10 hover:text-[#fb57ff]"
                            }`}
                          >{d}</button>
                        );
                      })}
                    </div>

                    {/* Time pickers */}
                    <div className="flex items-center gap-2 pb-3 border-b border-white/[0.07]">
                      <span className="text-xs text-gray-500 w-8">Time</span>
                      <select
                        value={calHour}
                        onChange={e => setCalHour(parseInt(e.target.value))}
                        className="flex-1 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#fb57ff]/50"
                        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff' }}
                        aria-label="Hour"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>{String(h).padStart(2,'0')}</option>
                        ))}
                      </select>
                      <span className="text-gray-600 text-sm">:</span>
                      <select
                        value={calMinute}
                        onChange={e => setCalMinute(parseInt(e.target.value))}
                        className="flex-1 rounded-lg text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#fb57ff]/50"
                        style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff' }}
                        aria-label="Minute"
                      >
                        {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => (
                          <option key={m} value={m}>{String(m).padStart(2,'0')}</option>
                        ))}
                      </select>
                    </div>

                    {/* Preview */}
                    <p className={`text-xs text-center mt-2 mb-3 ${previewValid ? "text-[#fb57ff]" : "text-gray-600"}`}>
                      {cliffPreview}
                    </p>

                    {/* Confirm */}
                    <button
                      type="button"
                      disabled={!previewValid}
                      onClick={() => {
                        if (!previewValid) return;
                        const cliff = new Date(calSelectedDate!.getFullYear(), calSelectedDate!.getMonth(), calSelectedDate!.getDate(), calHour, calMinute, 0);
                        const secs = Math.floor((cliff.getTime() - new Date().getTime()) / 1000);
                        const label = `${calSelectedDate!.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')}`;
                        setCustomCliffDays(String(secs));
                        setCustomCliffLabel(label);
                        setShowCliffCalendar(false);
                      }}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                    >
                      Set cliff date
                    </button>
                  </div>
                  </div>
                );
              })()}
            </div>

            {/* Revocable */}
            <div className="p-3 bg-white/[0.02] border border-white/[0.1] rounded-lg">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={revocable}
                  onChange={(e) => setRevocable(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-[#fb57ff] flex-shrink-0"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Allow cancellation</p>
                  <p className="text-xs text-gray-400 mt-0.5">If enabled, you can cancel this schedule and reclaim unvested tokens. Leaving it off makes the schedule permanent, which is far stronger proof of commitment to your community.</p>
                </div>
              </label>
            </div>

            {revocable && (
              <div className="p-2.5 rounded-lg" style={{ background: 'rgba(250,204,21,0.05)', border: '1px solid rgba(250,204,21,0.2)' }}>
                <p className="text-xs text-yellow-300">⚠️ This schedule will be publicly marked as cancellable, which carries less weight as proof of commitment.</p>
              </div>
            )}

            {/* Info */}
            <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/30 rounded-lg">
              <p className="text-xs" style={{ color: '#fb57ff' }}>💡 Tokens unlock continuously across the vesting period and can only be claimed by the beneficiary wallet.</p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setError(""); setStep(1); }}
                disabled={isCreating}
                className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isCreating || !publicKey || !selectedToken || !beneficiary || !selectedDuration || (selectedToken && parseFloat(amount) > Number(BigInt("18446744073709551615") / BigInt(200)) / Math.pow(10, selectedToken.decimals))}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                onMouseEnter={(e) => !isCreating && (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
                onMouseLeave={(e) => !isCreating && (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
              >
                {isCreating ? <><Loader2 className="w-4 h-4 animate-spin" />Creating Vesting…</> : "Create Vesting"}
              </button>
            </div>

            </div>
            )}

          </form>
        </div>
      </>
        )}
      </div>
      {(vestStep >= 1 && vestStep <= 3) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
          <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-white/[0.05]" />
                <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.8)', borderTopColor: 'transparent' }} />
                <div className="absolute inset-2 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: 'rgba(251,87,255,0.3)', borderTopColor: 'transparent', animationDirection: 'reverse', animationDuration: '1.5s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Clock className="w-7 h-7" style={{ color: '#fb57ff' }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-40 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${vestStep >= 3 ? 'w-full' : vestStep >= 2 ? 'w-2/3' : 'w-1/3'}`} style={{ background: '#fb57ff' }} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2 font-medium">
              Transaction 1 of 1
            </p>
            <h3 className="text-xl font-bold text-white mb-2">
              {isConfirming ? "Confirm in Wallet" : vestStep === 3 ? "Saving details..." : "Confirming on chain..."}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {isConfirming ? "Check your wallet and approve the vesting transaction" : vestStep === 3 ? "Recording your vesting schedule" : "Waiting for the vesting schedule to confirm on chain"}
            </p>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
              <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
              <p className="text-xs text-gray-500">Stay on this page until you see the success screen so your vesting schedule is recorded correctly.</p>
            </div>
            <div className="flex justify-center gap-1">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#fb57ff', animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {successData && (
        <VestingSuccessModal
          isOpen={showSuccessModal}
          onClose={() => {
            const url = successData.vestingPageUrl;
            setShowSuccessModal(false);
            setSuccessData(null);
            onClose();
            window.location.href = url;
          }}
          tokenSymbol={successData.tokenSymbol}
          amount={successData.amount}
          duration={successData.duration}
          beneficiary={successData.beneficiary}
          vestingPageUrl={successData.vestingPageUrl}
        />
      )}
    </div>
  );
}