"use client";

import { useState, useEffect } from "react";
import { X, Lock, AlertCircle, Loader2, Search, ChevronDown, ExternalLink, Star } from "lucide-react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getProgram, getPDAs } from "@/lib/anchor-program";
import { BN } from "@coral-xyz/anchor";
import { confirmTransactionPolling } from "@/lib/confirmTransaction";

interface CreateLockModalProps {
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

interface LockSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenSymbol: string;
  amount: string;
  duration: string;
  lockPageUrl: string;
}

function LockReviewPrompt({ onClose }: { onClose: () => void }) {
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

function LockSuccessModal({ isOpen, onClose, tokenSymbol, amount, duration, lockPageUrl }: LockSuccessModalProps) {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/[0.02] backdrop-blur border border-white/[0.05] rounded-2xl p-5 max-w-2xl w-full shadow-2xl" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>
            <Lock className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Tokens Locked! 🎉</h2>
            <p className="text-gray-400 text-sm">Your tokens are now securely locked on-chain</p>
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
            </div>
            <div className="border rounded-lg p-3" style={{ background: 'rgba(251, 87, 255, 0.1)', borderColor: 'rgba(251, 87, 255, 0.3)' }}>
              <p className="font-semibold mb-1 text-sm" style={{ color: '#fb57ff' }}>📢 Share with your community!</p>
              <p className="text-xs text-gray-300">Let your holders know their tokens are safu. Share your lock page to build trust.</p>
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
              href={lockPageUrl}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90 text-white"
              style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
            >
              <ExternalLink className="w-4 h-4" />
              View Lock Page
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${lockPageUrl}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-full py-2.5 rounded-xl font-semibold text-sm bg-white/[0.05] hover:bg-white/[0.08] transition-all text-white border border-white/[0.05]"
            >
              {copied ? "✅ Copied!" : "Copy Lock Link"}
            </button>
            <a
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(`🔒 Just locked ${parseFloat(amount).toLocaleString()} $${tokenSymbol} for ${duration} on @StakePointApp!\n\nVerify the lock:\n${window.location.origin}${lockPageUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all text-white border border-white/[0.05] bg-white/[0.05] hover:bg-white/[0.08]"
            >
              𝕏 Share on X
            </a>
            <LockReviewPrompt onClose={onClose} />
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

export default function CreateLockModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateLockModalProps) {
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
  const [customDays, setCustomDays] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [calViewYear, setCalViewYear] = useState(new Date().getFullYear());
  const [calViewMonth, setCalViewMonth] = useState(new Date().getMonth());
  const [calSelectedDate, setCalSelectedDate] = useState<Date | null>(null);
  const [calHour, setCalHour] = useState(new Date().getHours());
  const [calMinute, setCalMinute] = useState(0);
  const [customUnlockLabel, setCustomUnlockLabel] = useState("");
  const [selectedDuration, setSelectedDuration] = useState<number | "custom" | "">("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<{ tokenSymbol: string; amount: string; duration: string; lockPageUrl: string } | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [lockStep, setLockStep] = useState<0|1|2|3|4|5|6>(0);
  const [showIntro, setShowIntro] = useState(true);
  const [tvlData, setTvlData] = useState<{ totalValueLocked: number; totalStakers: number; totalLocks: number } | null>(null);

  // Fetch user's tokens when modal opens
  useEffect(() => {
    if (isOpen && publicKey) {
      setShowIntro(true);
      fetchUserTokens();
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'lock_modal_open', { modal_name: 'create_lock' });
      }
    }
  }, [isOpen, publicKey]);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/stats")
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setTvlData({
              totalValueLocked: data.totalValueLocked || 0,
              totalStakers: data.totalStakers || 0,
              totalLocks: data.totalLocks || 0,
            });
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Helper: Wait for project account to exist and be fully initialized on-chain
  const waitForProjectAccount = async (tokenMint: string, poolId: number, walletAdapter: any, maxRetries = 30) => {
    const { getProgram } = await import("@/lib/anchor-program");
    const { getPDAs } = await import("@/lib/anchor-program");
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        if (!walletAdapter) throw new Error("Wallet not found");

        const program = getProgram(walletAdapter, connection);
        const tokenMintPubkey = new PublicKey(tokenMint);
        const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
        
        // ✅ Try to actually FETCH and DESERIALIZE the project account
        // This ensures it's not just created, but fully initialized and readable
        // Use "confirmed" commitment for faster confirmation
        const projectData = await program.account.project.fetch(projectPDA, "confirmed");
        
        // Verify it has the expected data
        if (projectData && 
            projectData.tokenMint.toString() === tokenMint &&
            projectData.poolId.toNumber() === poolId &&
            projectData.admin) {
          console.log(`✅ Project account fully initialized and verified after ${i + 1} attempts`);
          console.log(`   - Token Mint: ${projectData.tokenMint.toString()}`);
          console.log(`   - Pool ID: ${projectData.poolId.toString()}`);
          console.log(`   - Admin: ${projectData.admin.toString()}`);
          return true;
        }
      } catch (err: any) {
        console.log(`⏳ Attempt ${i + 1}/${maxRetries}: Project not fully initialized yet... (${err.message || 'checking'})`);
      }
      
      // Wait 1 second before next attempt (increased from 500ms)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error("Project account not fully initialized after multiple attempts. Please try again.");
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // ✅ Check wallet connection first
    if (!publicKey || !wallet) {
      setError("Please connect your wallet first");
      return;
    }

    if (!selectedToken) {
      setError("Please select a token");
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    // Calculate final lock duration in seconds
    let finalDuration: number;
    if (selectedDuration === "custom") {
      if (!customDays || parseInt(customDays) <= 0) {
        setError("Please select a valid unlock date and time");
        return;
      }
      finalDuration = parseInt(customDays);
    } else if (typeof selectedDuration === "number") {
      finalDuration = selectedDuration;
    } else {
      setError("Please select a lock duration");
      return;
    }

    const solBalance = await connection.getBalance(publicKey);
    if (solBalance < 0.025 * 1e9) {
      setError(`Insufficient SOL, you need at least 0.025 SOL to cover the platform fee and transaction costs across both transactions. Current balance: ${(solBalance / 1e9).toFixed(4)} SOL`);
      return;
    }

    // Re-check token balance before submitting (prevents retries with zero balance)
    try {
      const mintInfo = await connection.getAccountInfo(new PublicKey(selectedToken.mint));
      const tokenProg = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const ata = await getAssociatedTokenAddress(new PublicKey(selectedToken.mint), publicKey, false, tokenProg);
      const freshBalance = await connection.getTokenAccountBalance(ata);
      const freshAmount = freshBalance.value.uiAmount || 0;
      if (freshAmount < parseFloat(amount)) {
        setError(`Insufficient balance. You have ${freshAmount.toLocaleString()} ${selectedToken.symbol} but tried to lock ${parseFloat(amount).toLocaleString()}.`);
        setSelectedToken({ ...selectedToken, balance: freshAmount });
        return;
      }
    } catch {
      // If balance check fails, proceed anyway and let the TX fail naturally
    }

    // Re-read latest resolved metadata from userTokens in case resolution finished after selection
    const latestToken = userTokens.find(t => t.mint === selectedToken.mint);
    const resolvedToken = (latestToken && latestToken.name !== "Unknown Token") ? latestToken : selectedToken;

    setIsCreating(true);
    setLockStep(1);
    setStatusMessage("Preparing lock transaction...");
    const preventClose = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", preventClose);

    try {
      setStatusMessage("Finding available pool slot...");
      
      // For locks, ALWAYS create a new unique pool (no reusing)
      const poolsResponse = await fetch(`/api/pools/by-token/${selectedToken.mint}`);
      const existingPools = poolsResponse.ok ? await poolsResponse.json() : [];

      // Don't look for matching pool - each lock gets its own pool
      let matchingPool = null;
      
      // Track the actual poolId we'll use
      let usedPoolId: number;
      
      if (matchingPool) {
        // Pool with this lockup already exists for this token, verify it on-chain
        setStatusMessage("Verifying existing pool...");
        const { getProgram, getPDAs } = await import("@/lib/anchor-program");
        const walletForVerify = wallet.adapter;
        const program = getProgram(walletForVerify, connection);
        const tokenMintPubkey = new PublicKey(selectedToken.mint);
        
        try {
          // Verify the project exists on-chain with correct token mint
          const [projectPDA] = getPDAs.project(tokenMintPubkey, matchingPool.poolId);
          const projectData = await program.account.project.fetch(projectPDA);
          
          if (projectData.tokenMint.toString() === selectedToken.mint && 
              projectData.lockupSeconds.toNumber() === finalDuration) {
            usedPoolId = matchingPool.poolId;
            console.log(`✅ Verified existing pool on-chain - poolId: ${usedPoolId}, lockup: ${finalDuration}s`);
          } else {
            console.warn(`⚠️ Pool mismatch on-chain, finding new poolId...`);
            matchingPool = null; // Force creation of new pool
          }
        } catch (error) {
          console.warn(`⚠️ Pool ${matchingPool.poolId} not found on-chain, finding new poolId...`);
          matchingPool = null; // Force creation of new pool
        }
      }
      
      if (!matchingPool) {
        // Need to find next available poolId (check both on-chain AND database)
        const { getProgram } = await import("@/lib/anchor-program");
        const { getPDAs } = await import("@/lib/anchor-program");
        const walletForCheck = wallet.adapter;
        const program = getProgram(walletForCheck, connection);
        const tokenMintPubkey = new PublicKey(selectedToken.mint);
        
        let poolId = 1000;
        let poolExists = true;
        
        console.log("🔍 Finding next available poolId...");
        
        while (poolExists && poolId < 2000) { // Max 100 pools per token
          const [projectPDA] = getPDAs.project(tokenMintPubkey, poolId);
          
          // Check on-chain
          let onChainExists = false;
          try {
            await program.account.project.fetch(projectPDA);
            onChainExists = true;
          } catch (error) {
            // Pool doesn't exist on-chain
          }
          
          // Check database
          let dbExists = false;
          try {
            dbExists = existingPools.some((p: any) => p.poolId === poolId);
          } catch (error) {
            console.log("⚠️ Could not check database, continuing...");
          }
          
          if (onChainExists || dbExists) {
            console.log(`⚠️ Pool ${poolId} already exists (onChain: ${onChainExists}, db: ${dbExists}), trying next...`);
            poolId++;
          } else {
            console.log(`✅ Found available poolId: ${poolId}`);
            poolExists = false;
          }
        }
        
        if (poolExists) {
          throw new Error("Maximum number of pools (100) reached for this token.");
        }
        
        usedPoolId = poolId;
      }
      
      // ===== 2-TX LOCK: Create Project, then Init + Stake + Transfer Admin =====
      const PLATFORM_ADMIN = new PublicKey("ecfvkqWdJiYJRyUtWvuYpPWP5faf9GBcA1K6TaDW7wS");
      
      if (!anchorWallet) throw new Error("Wallet not connected");
      
      const program = getProgram(anchorWallet, connection);
      const tokenMintPubkey = new PublicKey(selectedToken.mint);
      
      // Detect token program
      const mintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!mintInfo) throw new Error("Token mint not found");
      const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) 
        ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      
      // Derive all PDAs
      const [projectPDA] = getPDAs.project(tokenMintPubkey, usedPoolId);
      const [stakingVaultPDA] = getPDAs.stakingVault(tokenMintPubkey, usedPoolId);
      const [rewardVaultPDA] = getPDAs.rewardVault(tokenMintPubkey, usedPoolId);
      const [userStakePDA] = getPDAs.userStake(projectPDA, publicKey);
      const [platformConfigPDA] = getPDAs.platformConfig();
      
      // Fetch platform config for fee collector
      const platformConfig = await program.account.platform.fetch(platformConfigPDA, "confirmed");
      const feeCollector = platformConfig.feeCollector;
      
      // Get token accounts. A wallet can hold the same mint across several
      // accounts and only one of them is the ATA, so pick whichever actually
      // holds enough rather than assuming the ATA does.
      let userTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey, publicKey, false, tokenProgramId
      );
      try {
        const owned = await connection.getParsedTokenAccountsByOwner(
          publicKey,
          { mint: tokenMintPubkey }
        );
        const needed = parseFloat(amount);
        const best = owned.value
          .map(a => ({
            pubkey: a.pubkey,
            amount: a.account.data.parsed?.info?.tokenAmount?.uiAmount || 0,
          }))
          .sort((x, y) => y.amount - x.amount)[0];
        if (best && best.amount >= needed) {
          userTokenAccount = best.pubkey;
        }
      } catch (e) {
        console.warn("Could not scan token accounts, falling back to ATA", e);
      }
      const feeCollectorTokenAccount = await getAssociatedTokenAddress(
        tokenMintPubkey, feeCollector, false, tokenProgramId
      );
      
      // ===== TX1: Create Project =====
      setStatusMessage("Creating lock pool (1 of 2)...");
      const createTx = new Transaction();
      createTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      createTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
      
      const createProjectIx = await program.methods
        .createProject(tokenMintPubkey, new BN(usedPoolId))
        .accounts({
          project: projectPDA,
          stakingVault: stakingVaultPDA,
          rewardVault: rewardVaultPDA,
          tokenMint: tokenMintPubkey,
          admin: publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: tokenProgramId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .instruction();
      createTx.add(createProjectIx);
      
      const { blockhash: createBlockhash } = await connection.getLatestBlockhash();
      createTx.recentBlockhash = createBlockhash;
      createTx.feePayer = publicKey;
      
      setIsConfirming(true);
      setLockStep(2);
      const createSig = await sendTransaction(createTx, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      setLockStep(3);
      console.log("✅ Project created:", createSig);
      
      setStatusMessage("Confirming pool creation...");
      await confirmTransactionPolling(connection, createSig);
      
      // Wait for RPC propagation, fetch and deserialize, not just getAccountInfo
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
        throw new Error("Pool creation confirmed but account not yet readable. Please try locking again in a few seconds.");
      }
      
      // ===== TX2: Init + Stake + Transfer Admin =====
      setStatusMessage("Locking tokens (2 of 2)...");
      const lockTx = new Transaction();
      lockTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
      lockTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
      
      // Create fee collector ATA if needed
      const feeCollectorAccountInfo = await connection.getAccountInfo(feeCollectorTokenAccount);
      if (!feeCollectorAccountInfo) {
        lockTx.add(createAssociatedTokenAccountInstruction(
          publicKey, feeCollectorTokenAccount, feeCollector, tokenMintPubkey, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID
        ));
      }
      
      // IX 1: Initialize Pool
      const initPoolIx = await program.methods
        .initializePool(tokenMintPubkey, new BN(usedPoolId), {
          rateBpsPerYear: new BN(0),
          rateMode: 0,
          lockupSeconds: new BN(finalDuration),
          poolDurationSeconds: new BN(finalDuration),
          referrer: null,
          referrerSplitBps: null,
          enableReflections: false,
          reflectionToken: null,
        })
        .accounts({
          project: projectPDA,
          stakingVault: stakingVaultPDA,
          admin: publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: tokenProgramId,
          reflectionTokenMint: program.programId,
          reflectionTokenAccount: program.programId,
          associatedTokenProgram: program.programId,
          reflectionTokenProgram: program.programId,
        })
        .instruction();
      lockTx.add(initPoolIx);
      
      // IX 2: Deposit (lock tokens)
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
          userTokenAccount: userTokenAccount,
          feeCollectorTokenAccount: feeCollectorTokenAccount,
          feeCollector: feeCollector,
          reflectionVault: null,
          tokenMintAccount: tokenMintPubkey,
          user: publicKey,
          tokenProgram: tokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      lockTx.add(depositIx);

      // IX 3: Close deposits so nobody else can deposit into this lock.
      // Must run after the deposit, since the deposit guard reads the flag
      // at the start of its own instruction.
      const setDepositPausedIx = await program.methods
        .setDepositPaused(tokenMintPubkey, new BN(usedPoolId), true)
        .accounts({
          project: projectPDA,
          admin: publicKey,
        })
        .instruction();
      lockTx.add(setDepositPausedIx);
      
      // IX 4: Transfer admin to platform
      const transferAdminIx = await program.methods
        .transferAdmin(tokenMintPubkey, new BN(usedPoolId))
        .accounts({
          project: projectPDA,
          admin: publicKey,
          newAdmin: PLATFORM_ADMIN,
        })
        .instruction();
      lockTx.add(transferAdminIx);
      
      // Simulate TX2 before presenting to wallet, catches stale PDA / Blowfish issues
      setStatusMessage("Verifying lock transaction...");
      let simPassed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { blockhash: simBlockhash } = await connection.getLatestBlockhash();
        lockTx.recentBlockhash = simBlockhash;
        lockTx.feePayer = publicKey;
        try {
          const simResult = await connection.simulateTransaction(lockTx, { sigVerify: false });
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

      // Send TX2 with fresh blockhash
      setIsConfirming(true);
      setLockStep(4);
      setStatusMessage("Please approve the lock transaction...");
      const { blockhash: lockBlockhash } = await connection.getLatestBlockhash();
      lockTx.recentBlockhash = lockBlockhash;
      lockTx.feePayer = publicKey;
      
      const tx = await sendTransaction(lockTx, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      setLockStep(5);
      console.log("✅ Lock transaction sent:", tx);
      
      setStatusMessage("Confirming lock...");
      await confirmTransactionPolling(connection, tx);
      console.log("✅ Lock confirmed:", tx);
      
      // Lock DB sync handled by /api/locks below
      
      setStatusMessage("Saving lock details...");
      const lockId = Date.now();
      const stakePDA = userStakePDA;
      
      const response = await fetch("/api/locks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lockId,
          tokenMint: selectedToken.mint,
          name: resolvedToken.name || resolvedToken.symbol,
          symbol: resolvedToken.symbol || "UNKNOWN",
          amount: parseFloat(amount),
          lockDuration: Math.min(finalDuration, 2147483647),
          creatorWallet: publicKey.toString(),
          poolAddress: projectPDA.toString(),
          stakePda: stakePDA.toString(),
          poolId: usedPoolId,
          logo: resolvedToken.logoURI || null,
          isLpToken: resolvedToken.isLpToken || false,
          lpPoolId: resolvedToken.lpPoolId || null,
        }),
      });

      setIsBroadcasting(false);
      let savedLock = null;
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("❌ Failed to save lock to database:", errorData);
        setError("Your tokens have been locked on-chain successfully, but we couldn't save the lock to our database. Your tokens are safe in the vault. Please email contact@stakepoint.app with your wallet address so we can sync your lock record.");
        setIsCreating(false);
        return;
      } else {
        savedLock = await response.json();
      }
      setStatusMessage("Lock created successfully! ✅");
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'lock_created', { modal_name: 'create_lock', token: selectedToken?.symbol, duration: finalDuration });
      }

      // Reset form
      setSelectedToken(null);
      setAmount("");
      setCustomDays("");
      setSelectedDuration("");

      const durationLabel = selectedDuration === "custom"
        ? (customUnlockLabel ? `Until ${customUnlockLabel}` : `${Math.round(finalDuration / 86400)} days`)
        : lockDurationOptions.find(o => o.value === selectedDuration)?.label || `${Math.round(finalDuration / 86400)} days`;

      setSuccessData({
        tokenSymbol: selectedToken.symbol || "tokens",
        amount,
        duration: durationLabel,
        lockPageUrl: savedLock ? `/locks/${savedLock.id}` : `/locks`,
      });
      setShowSuccessModal(true);
      onSuccess();
    } catch (err: any) {
      console.error("Error creating lock:", err);
      console.error("Error logs:", err?.logs);
      console.error("Error cause:", err?.cause);
      const anchorErrorMap: Record<number, string> = {
        6000: "You don't have permission to do this.",
        6001: "The amount entered isn't valid.",
        6002: "You don't have enough tokens in your wallet.",
        6003: "This pool has been paused.",
        6004: "Deposits are temporarily paused.",
        6005: "Withdrawals are temporarily paused.",
        6006: "Claims are temporarily paused.",
        6007: "Tokens are still locked.",
        6008: "Lock period hasn't expired yet.",
        6011: "Amount too large for a single lock. Please split into smaller amounts.",
        6012: "This lock has already been set up.",
        6013: "This lock wasn't fully initialised. The second transaction may have been missed.",
        6014: "The referral split percentage isn't valid.",
        6018: "You don't have enough SOL to cover the transaction fee. Ensure you have at least 0.025 SOL before locking.",
        6020: "The vault doesn't have enough tokens to complete this.",
        6024: "Lock duration must be greater than 0.",
        6025: "A calculation error occurred. Please try again.",
        6028: "Wrong token type.",
        6033: "A mismatch was detected in the pool totals. Please contact support.",
        6034: "A timing error was detected. Please try again.",
        6035: "This pool has ended.",
        6036: "Invalid rate mode.",
      };
      const errStr = String(err?.message ?? err);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16) : jsonMatch ? parseInt(jsonMatch[1]) : anchorMatch ? parseInt(anchorMatch[1]) : fallbackMatch ? parseInt(fallbackMatch[1]) : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;
      let errorMessage = anchorError || "Failed to create lock";
      if (!anchorError && errStr.includes("User rejected")) errorMessage = "Transaction cancelled.";
      else if (!anchorError && errStr.includes("insufficient")) errorMessage = "Insufficient SOL balance.";
      else if (!anchorError && err.message) errorMessage = err.message;
      setError(errorMessage);
      setIsConfirming(false);
      setIsBroadcasting(false);
    } finally {
      window.removeEventListener("beforeunload", preventClose);
      setIsCreating(false);
      setIsConfirming(false);
      setIsBroadcasting(false);
      setLockStep(0);
      setTimeout(() => setStatusMessage(""), 2000);
    }
  };

  if (!isOpen) return null;

  const filteredTokens = userTokens.filter((token) => {
    if (!tokenSearchQuery) return true;
    const query = tokenSearchQuery.toLowerCase();
    return (
      token.symbol?.toLowerCase().includes(query) ||
      token.name?.toLowerCase().includes(query) ||
      token.mint.toLowerCase().includes(query)
    );
  });

  const lockDurationOptions = [
    { label: "1 Day", value: 86400 },
    { label: "7 Days", value: 604800 },
    { label: "30 Days", value: 2592000 },
    { label: "90 Days", value: 7776000 },
    { label: "180 Days", value: 15552000 },
    { label: "365 Days", value: 31536000 },
    { label: "🔒 Forever", value: 2147483647 },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3">
      <div className="bg-black/95 rounded-2xl w-full max-w-lg flex flex-col border border-white/[0.08]" style={{ maxHeight: '96vh' }}>

        {showIntro ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center flex-1 min-h-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'linear-gradient(135deg, #1a001a, #fb57ff)' }}>
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Secure your tokens on Solana</h2>
            <p className="text-sm text-gray-400 mb-6">Your trusted non-custodial Solana token locker</p>

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

            <p className="text-xs text-gray-500 mb-6 max-w-xs text-center leading-relaxed">Supports Raydium, Meteora, PumpSwap, and Orca LP tokens. Compatible with all SPL and Token-2022 tokens.</p>

            <button
              onClick={() => setShowIntro(false)}
              className="w-full max-w-xs py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
            >
              Create Lock
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
            <Lock className="w-4 h-4 flex-shrink-0" style={{ color: '#fb57ff' }} />
            Create Token Lock
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

            {/* Info Box */}
            <div className="p-2.5 bg-white/[0.02] border border-white/[0.1] rounded-lg">
              <p className="text-gray-400 text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                Lock tokens securely for a set duration. Cannot be withdrawn until unlock time.
              </p>
            </div>

            {/* 2 Transaction Warning */}
            <div className="p-3 bg-[#00d4ff]/10 border-2 border-[#00d4ff]/50 rounded-lg ring-2 ring-[#00d4ff]/20 ring-offset-2 ring-offset-black animate-pulse">
              <p className="text-[#00d4ff] text-xs font-semibold mb-1 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                ⚠️ 2 wallet approvals required
              </p>
              <p className="text-[#00d4ff]/70 text-xs leading-relaxed">
                This process requires <strong>two separate wallet confirmations</strong>. Do not close the browser between approvals. Ensure you have at least <strong>0.025 SOL</strong> in your wallet before starting.
              </p>
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
              <label className="block text-xs font-medium text-gray-400 mb-1">Amount to Lock *</label>
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
                  <button type="button" onClick={async () => { try { const mintPk = new PublicKey(selectedToken.mint); const mintInfo = await connection.getAccountInfo(mintPk); const prog = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID; const ata = await getAssociatedTokenAddress(mintPk, publicKey!, false, prog); const bal = await connection.getTokenAccountBalance(ata); setAmount(bal.value.uiAmountString || String(Math.floor(selectedToken.balance))); } catch { setAmount(String(Math.floor(selectedToken.balance))); } }} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#fb57ff] hover:underline">
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
                      Max single lock: {safeMaxTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedToken.symbol}
                      {isOverMax && ', split into multiple locks'}
                    </p>
                    {isOverMax && (
                      <p className="text-xs mt-1 text-red-400 font-medium">
                        ❌ Amount exceeds maximum. Please reduce the amount or split into multiple locks.
                      </p>
                    )}
                  </>
                ) : null;
              })()}
            </div>

            {selectedToken && (
              <div className="p-3 rounded-lg border" style={{ background: 'rgba(251,87,255,0.06)', borderColor: 'rgba(251,87,255,0.25)' }}>
                <p className="text-xs text-gray-300 leading-relaxed">
                  <span className="font-semibold text-white">Does {selectedToken.symbol} pay rewards to holders?</span>{' '}
                  Use the <a href="/lock-revshare-tokens" className="underline" style={{ color: '#fb57ff' }}>reward locker</a> instead. Your rewards keep arriving while the tokens are locked and you can claim them any time, with the locked amount untouched. This cannot be changed after the lock is created.
                </p>
              </div>
            )}

            {/* Lock Duration */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-400 mb-1">Lock Duration *</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {lockDurationOptions.map((option) => (
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
                  onClick={() => { setSelectedDuration("custom"); setShowCalendar(prev => !prev); }}
                  className={`py-2 px-1 rounded-lg border transition-colors text-xs font-semibold ${
                    selectedDuration === "custom"
                      ? "border-[#fb57ff] bg-[#fb57ff]/10 text-white"
                      : "border-white/[0.1] bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]"
                  }`}
                >
                  📅 Custom
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
                    const diffMins = Math.floor((diffSecs % 3600) / 60);
                    const humanDiff = diffDays > 0 ? `${diffDays}d ${diffHrs}h` : diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins}m`;
                    unlockPreview = `Unlocks ${calSelectedDate.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')} (${humanDiff})`;
                    previewValid = true;
                  } else {
                    unlockPreview = "Must be at least 1 hour from now";
                  }
                } else {
                  unlockPreview = "Select a date above";
                }

                return (
                  <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowCalendar(false)} />
                  <div className="relative bg-[#0d0d0d] border border-white/[0.12] rounded-xl p-4 w-full max-w-xs shadow-2xl">
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
                        const isPast = dayEnd < minUnlock && !isToday;
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
                      {unlockPreview}
                    </p>

                    {/* Confirm */}
                    <button
                      type="button"
                      disabled={!previewValid}
                      onClick={() => {
                        if (!previewValid) return;
                        const unlock = new Date(calSelectedDate!.getFullYear(), calSelectedDate!.getMonth(), calSelectedDate!.getDate(), calHour, calMinute, 0);
                        const secs = Math.floor((unlock.getTime() - new Date().getTime()) / 1000);
                        const label = `${calSelectedDate!.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} at ${String(calHour).padStart(2,'0')}:${String(calMinute).padStart(2,'0')}`;
                        setCustomDays(String(secs));
                        setCustomUnlockLabel(label);
                        setShowCalendar(false);
                      }}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                    >
                      Set unlock date
                    </button>
                  </div>
                  </div>
                );
              })()}
            </div>

            {/* Info */}
            <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/30 rounded-lg">
              <p className="text-xs" style={{ color: '#fb57ff' }}>💡 Tokens cannot be withdrawn until the lock period expires.</p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={isCreating}
                className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating || !publicKey || !selectedToken || (selectedToken && parseFloat(amount) > Number(BigInt("18446744073709551615") / BigInt(200)) / Math.pow(10, selectedToken.decimals))}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                onMouseEnter={(e) => !isCreating && (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
                onMouseLeave={(e) => !isCreating && (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
              >
                {isCreating ? <><Loader2 className="w-4 h-4 animate-spin" />Creating Lock…</> : "Create Lock"}
              </button>
            </div>

          </form>
        </div>
      </>
        )}
      </div>
      {(lockStep >= 2 && lockStep <= 5) && (
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
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-20 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${lockStep >= 4 ? 'w-full' : 'w-1/2'}`} style={{ background: '#fb57ff' }} />
              </div>
              <div className="w-20 h-1.5 rounded-full bg-white/[0.1] overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${lockStep >= 5 ? 'w-full' : lockStep >= 4 ? 'w-1/2' : 'w-0'}`} style={{ background: '#fb57ff' }} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2 font-medium">
              {lockStep <= 3 ? "Transaction 1 of 2" : "Transaction 2 of 2"}
            </p>
            <h3 className="text-xl font-bold text-white mb-2">
              {isConfirming ? "Confirm in Wallet" : lockStep === 3 ? "Confirming on chain..." : lockStep === 5 ? "Confirming lock..." : "Broadcasting..."}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {isConfirming && lockStep <= 3 ? "Check your wallet and approve transaction 1: Create lock pool" : isConfirming && lockStep >= 4 ? "Check your wallet and approve transaction 2: Lock tokens" : lockStep === 3 ? "Waiting for pool creation to confirm" : lockStep === 5 ? "Waiting for lock to confirm on chain" : "Broadcasting to the Solana blockchain"}
            </p>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
              <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
              <p className="text-xs text-gray-500">{lockStep >= 4 ? "Your tokens have not moved yet. This second approval is the one that locks them. Closing now leaves the lock incomplete." : "Both transactions must complete. Stay on this page until you see the success screen."}</p>
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
        <LockSuccessModal
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
        />
      )}
    </div>
  );
}