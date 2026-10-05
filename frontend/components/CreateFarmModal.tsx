"use client";
import { confirmTransactionPolling } from "@/lib/confirmTransaction";
import { useState, useEffect, useRef } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Plus, X, Loader2, Check, AlertCircle, Code, Star, ExternalLink, Search, ChevronDown } from "lucide-react";
import { getProgram, getPDAs } from "@/lib/anchor-program";
import IntegrateModal from "@/components/IntegrateModal";
import * as anchor from "@coral-xyz/anchor";

const ADMIN_WALLET = new PublicKey("ecfvkqWdJiYJRyUtWvuYpPWP5faf9GBcA1K6TaDW7wS");

function FarmReviewPrompt() {
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
  isLpToken?: boolean;
  baseMint?: string;
  lpPoolId?: string;
}

interface CreateFarmModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

// Global Birdeye rate limiter
let lastBirdeyeCall = 0;
const BIRDEYE_MIN_GAP = 200;

async function birdeyeFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = BIRDEYE_MIN_GAP - (now - lastBirdeyeCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastBirdeyeCall = Date.now();
  return fetch(url);
}

const KNOWN_LOGOS: Record<string, string> = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
  "So11111111111111111111111111111111111111112": "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
};

export default function CreateFarmModal({ onClose, onSuccess }: CreateFarmModalProps) {
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
  const [createdPoolId, setCreatedPoolId] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showIntegrateModal, setShowIntegrateModal] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [tvlData, setTvlData] = useState<{ totalValueLocked: number } | null>(null);
  const [rewardSearchQuery, setRewardSearchQuery] = useState("");
  const [showRewardSelector, setShowRewardSelector] = useState(false);
  const [pairAddress, setPairAddress] = useState("");
  const [resolvingPair, setResolvingPair] = useState(false);

  const [farmConfig, setFarmConfig] = useState({
    rewardAmount: "1000",
    duration: "365",
    lockPeriod: "0",
    lpUrl: "",
  });

  useEffect(() => {
    if (publicKey && step === 1 && typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'farm_modal_open', { modal_name: 'create_farm' });
    }
  }, [publicKey, step]);

  useEffect(() => {
    if (publicKey && step === 2 && userTokens.length === 0) {
      fetchUserTokens();
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
    if (step === 1 || step === 4) fetchFee();
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

  // ═══════════════════════════════════════════════════════════════
  // resolveLpPair: pair/pool address to LP token mint (Raydium v3)
  // ═══════════════════════════════════════════════════════════════
  const resolveLpPair = async () => {
    const raw = pairAddress.trim();
    if (!raw) { setError("Paste the LP pair address (the pool_id from the Raydium or DexScreener link)."); return; }
    let poolPubkey: PublicKey;
    try { poolPubkey = new PublicKey(raw); } catch { setError("That is not a valid Solana address."); return; }
    const poolId = poolPubkey.toBase58();

    setResolvingPair(true);
    setError(null);
    try {
      const res = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${poolId}`);
      const json = await res.json();
      const pool = json?.data?.[0];
      if (!json?.success || !pool) { setError("No Raydium pool found for that address. Check you pasted the pool_id from the Raydium liquidity link."); return; }
      if (pool.type === "Concentrated" || !pool.lpMint?.address) {
        setError("That is a CLMM pool. Its positions are NFTs rather than fungible LP tokens, so they cannot be staked. Use a standard Raydium pool.");
        return;
      }

      const lpMintAddr: string = pool.lpMint.address;
      const lpDecimals: number = typeof pool.lpMint.decimals === "number" ? pool.lpMint.decimals : 9;
      const lpProgramId: string = pool.lpMint.programId || TOKEN_PROGRAM_ID.toBase58();
      const pairLabel = `${pool.mintA?.symbol || "?"}/${pool.mintB?.symbol || "?"} LP`;

      const lpToken: UserToken = {
        mint: lpMintAddr,
        balance: 0,
        decimals: lpDecimals,
        symbol: pairLabel,
        name: pairLabel,
        logoURI: pool.mintA?.logoURI || pool.mintB?.logoURI || undefined,
        programId: lpProgramId,
        isLpToken: true,
        lpPoolId: poolId,
      };

      setSelectedToken(lpToken);
      setFarmConfig(prev => ({ ...prev, lpUrl: `https://raydium.io/liquidity/increase/?mode=add&pool_id=${poolId}` }));
      setStep(2);
    } catch (e) {
      console.error("resolveLpPair failed:", e);
      setError("Could not reach Raydium to resolve that pool. Try again in a moment.");
    } finally {
      setResolvingPair(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // fetchUserTokens, from CreateLockModal (Birdeye + LP resolution)
  // ═══════════════════════════════════════════════════════════════
  const fetchUserTokens = async () => {
    if (!publicKey) return;

    setLoading(true);
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

      const tokens: UserToken[] = [];
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
                      isLpToken: true,
                    });
                    continue;
                  }
                } catch (lpErr) {
                  console.warn(`⚠️ Birdeye LP search failed for ${mint}:`, lpErr);
                }

                // PumpSwap AMM LP: Token-2022 mints with no metadata
                const PUMPSWAP_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
                if (!resolvedLogo && account.programIdKey === TOKEN_2022_PROGRAM_ID.toString()) {
                  try {
                    const mintAccountInfo = await connection.getParsedAccountInfo(new PublicKey(mint));
                    const mintData = (mintAccountInfo.value?.data as any)?.parsed?.info;
                    const mintAuthority = mintData?.mintAuthority;
                    if (mintAuthority) {
                      const authorityInfo = await connection.getAccountInfo(new PublicKey(mintAuthority));
                      if (authorityInfo?.owner?.toString() === PUMPSWAP_PROGRAM) {
                        const rawPool = await connection.getAccountInfo(new PublicKey(mintAuthority));
                        if (rawPool?.data) {
                          // PumpSwap pool layout: discriminator(8) + pool_bump(1) + index(2) + creator(32) + base_mint(32) + quote_mint(32) + lp_mint(32)
                          const baseMint = new PublicKey(rawPool.data.slice(43, 75)).toString();
                          const quoteMint = new PublicKey(rawPool.data.slice(75, 107)).toString();
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

                            // DexScreener for base token
                            try {
                              const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${baseMintAddr}`);
                              const dexData = await dexRes.json();
                              const bestPair = dexData?.pairs?.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))?.[0];
                              if (bestPair) {
                                const isBase = bestPair.baseToken?.address === baseMintAddr;
                                const td2 = isBase ? bestPair.baseToken : bestPair.quoteToken;
                                if (td2?.symbol) baseSymbol = td2.symbol;
                                if (td2?.name) baseName = td2.name;
                                baseLogo = bestPair.info?.imageUrl || undefined;
                              }
                            } catch {}

                            // Helius fallback
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

                // Transaction-history fallback: find pool from LP mint's creation tx
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
                          // Fallback: decode vaults from pool account
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
                                  const td2 = isBase ? bestPair.baseToken : bestPair.quoteToken;
                                  if (td2?.symbol) baseSymbol = td2.symbol;
                                  if (td2?.name) baseName = td2.name;
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

                // Helius DAS final fallback
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

      tokens.sort((a, b) => {
        const aValue = (a.price || 0) * a.balance;
        const bValue = (b.price || 0) * b.balance;
        if (bValue !== aValue) return bValue - aValue;
        return b.balance - a.balance;
      });

      setUserTokens(tokens.filter(t => t.mint !== "So11111111111111111111111111111111111111112"));
      setStatusMessage("");

      // Auto-retry resolution for any tokens still showing "Unknown Token"
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
                const td2 = isBase ? dexData[0].baseToken : dexData[0].quoteToken;
                if (td2?.symbol) { token.symbol = td2.symbol; token.name = td2.name || token.name; anyResolved = true; console.log(`✅ Retry resolved via DexScreener: ${token.symbol}`); continue; }
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
            setUserTokens(tokens.filter(t => t.mint !== "So11111111111111111111111111111111111111112"));
          }
          if (unknowns.every(t => t.name !== "Unknown Token" && !t.symbol?.includes("..."))) {
            console.log(`✅ All tokens resolved after retry ${retry}`);
            break;
          }
        }
      }
    } catch (error) {
      console.error("Error fetching tokens:", error);
      setStatusMessage("Error loading tokens. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // handleCreateFarm, V2 engine (createProject1 + initializePool1 + depositRewards1)
  // ═══════════════════════════════════════════════════════════════
  const handleCreateFarm = async () => {
    if (!publicKey || !sendTransaction || !selectedToken || !selectedRewardToken || !wallet) {
      setError("Please connect your wallet and select both tokens");
      return;
    }

    const WSOL_MINT = "So11111111111111111111111111111111111111112";
    if (selectedToken.mint === WSOL_MINT || selectedRewardToken.mint === WSOL_MINT) {
      setError("SOL is not supported as a staking or reward token. Please choose an SPL or Token-2022 token.");
      return;
    }

    setError(null);
    setLoading(true);

    const solBalance = await connection.getBalance(publicKey);
    const estimatedFees = poolCreationFee + 0.02 * 1_000_000_000;
    if (solBalance < estimatedFees) {
      setError(`Insufficient SOL. Need ${(estimatedFees / 1_000_000_000).toFixed(3)} SOL, have ${(solBalance / 1_000_000_000).toFixed(4)} SOL.`);
      setLoading(false);
      return;
    }

    try {
      const program = getProgram(wallet, connection);
      const tokenMintPubkey = new PublicKey(selectedToken.mint);
      const rewardMintPubkey = new PublicKey(selectedRewardToken.mint);

      // Find available poolId using V2 PDAs
      let poolId = 0;
      let poolExists = true;
      console.log("🔍 Checking if farm already exists for this token...");
      while (poolExists && poolId < 100) {
        const [projectPDA] = getPDAs.project1(tokenMintPubkey, poolId);
        let onChainExists = false;
        try {
          const accountInfo = await connection.getAccountInfo(projectPDA);
          if (accountInfo !== null) { onChainExists = true; console.log(`⚠️ Farm ${poolId} exists on-chain`); }
        } catch (error: any) { onChainExists = false; }

        let dbExists = false;
        try {
          const dbCheck = await fetch(`/api/pools/by-token/${selectedToken.mint}`);
          if (dbCheck.ok) {
            const pools = await dbCheck.json();
            dbExists = pools.some((p: any) => p.poolId === poolId.toString());
          }
        } catch (error) { console.log("⚠️ Could not check database, continuing..."); }

        if (onChainExists || dbExists) { poolId++; } else { console.log(`✅ Found available poolId: ${poolId}`); poolExists = false; }
      }
      if (poolExists) throw new Error("Unable to find an available pool slot for this token. Please contact support.");

      const [projectPDA] = getPDAs.project1(tokenMintPubkey, poolId);
      const [stakingVaultPDA] = getPDAs.stakingVault1(tokenMintPubkey, poolId);
      const [rewardVaultPDA] = getPDAs.rewardVault1(tokenMintPubkey, poolId);
      const [platformPDA] = getPDAs.platformConfig();

      // Detect token programs for both mints
      const stakingMintInfo = await connection.getAccountInfo(tokenMintPubkey);
      if (!stakingMintInfo) throw new Error("Staking token mint not found");
      const stakingTokenProgramId = stakingMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      console.log(`✅ Staking token program: ${stakingTokenProgramId.toString()}`);

      const rewardMintInfo = await connection.getAccountInfo(rewardMintPubkey);
      if (!rewardMintInfo) throw new Error("Reward token mint not found");
      const rewardTokenProgramId = rewardMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      console.log(`✅ Reward token program: ${rewardTokenProgramId.toString()}`);

      console.log(`🎯 Creating farm with poolId: ${poolId}`);

      // Check user has reward tokens to deposit
      const userRewardAccount = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: rewardMintPubkey });
      if (userRewardAccount.value.length === 0) throw new Error("No token account found for reward token");
      const userRewardAccountPubkey = userRewardAccount.value[0].pubkey;

      const rewardAmount = parseFloat(farmConfig.rewardAmount);
      const userRewardBalance = userRewardAccount.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      if (userRewardBalance < rewardAmount) throw new Error(`Insufficient balance. You have ${userRewardBalance} ${selectedRewardToken.symbol} but need ${rewardAmount}`);

      const rewardAmountWithDecimals = new anchor.BN(toTokenAmount(farmConfig.rewardAmount, selectedRewardToken.decimals));

      // ── TX 1: Payment + createProject1 ──
      setStatusMessage("Creating farm (1 of 2)...");
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
          tokenProgram: stakingTokenProgramId,
          rewardTokenProgram: rewardTokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx1.add(createProject1Ix);

      const { blockhash } = await connection.getLatestBlockhash();
      tx1.recentBlockhash = blockhash;
      tx1.feePayer = publicKey;

      const paymentSignature = await sendTransaction(tx1, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      const createProjectTx = paymentSignature;
      console.log("✅ Payment + Project created:", paymentSignature);

      setStatusMessage("Confirming farm creation...");
      await confirmTransactionPolling(connection, paymentSignature);
      setIsBroadcasting(false);
      setIsConfirming(true);
      setStatusMessage("Preparing farm configuration...");

      // Wait for PDA to be readable
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
        throw new Error("Farm creation confirmed but account not yet readable. Please try again in a few seconds.");
      }

      // ── TX 2: initializePool1 + depositRewards1 ──
      setStatusMessage("Initializing farm & depositing rewards (2 of 2)...");

      const durationDays = parseInt(farmConfig.duration);
      const lockPeriodDays = parseInt(farmConfig.lockPeriod);
      if (!durationDays || durationDays <= 0) throw new Error("Farm duration must be at least 1 day.");
      if (isNaN(lockPeriodDays)) throw new Error("Invalid lock period.");
      const durationSeconds = durationDays * 86400;
      const lockupSeconds = lockPeriodDays * 86400;

      const initParams = {
        rateBpsPerYear: new anchor.BN(0),
        rateMode: 1, // dynamic
        lockupSeconds: new anchor.BN(lockupSeconds),
        poolDurationSeconds: new anchor.BN(durationSeconds),
        referrer: null,
        referrerSplitBps: null,
        enableReflections: false,
        reflectionToken: null,
        customTokenFeeBps: new anchor.BN(0),
        customSolFee: new anchor.BN(0),
        useCustomFees: false,
      };

      const initPoolAccounts: any = {
        project: projectPDA,
        stakingVault: stakingVaultPDA,
        reflectionTokenMint: program.programId,
        reflectionTokenAccount: program.programId,
        platform: platformPDA,
        admin: publicKey,
        associatedTokenProgram: program.programId,
        systemProgram: SystemProgram.programId,
        tokenProgram: stakingTokenProgramId,
        reflectionTokenProgram: program.programId,
      };

      const tx2 = new Transaction();
      tx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
      tx2.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));

      const initPool1Ix = await program.methods
        .initializePool1(tokenMintPubkey, new anchor.BN(poolId), initParams)
        .accounts(initPoolAccounts)
        .instruction();
      tx2.add(initPool1Ix);

      const depositRewards1Ix = await program.methods
        .depositRewards1(tokenMintPubkey, new anchor.BN(poolId), rewardAmountWithDecimals)
        .accounts({
          project: projectPDA,
          rewardVault: rewardVaultPDA,
          adminTokenAccount: userRewardAccountPubkey,
          tokenMintAccount: rewardMintPubkey,
          admin: publicKey,
          rewardTokenProgram: rewardTokenProgramId,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx2.add(depositRewards1Ix);

      // Simulate
      setStatusMessage("Verifying farm transaction...");
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

      setStatusMessage("Initializing farm & depositing rewards (2 of 2)...");
      const { blockhash: tx2Blockhash } = await connection.getLatestBlockhash();
      tx2.recentBlockhash = tx2Blockhash;
      tx2.feePayer = publicKey;

      const initPoolTx = await sendTransaction(tx2, connection, { skipPreflight: false });
      setIsConfirming(false);
      setIsBroadcasting(true);
      console.log("✅ Farm initialized + rewards deposited:", initPoolTx);

      setStatusMessage("Confirming farm setup...");
      await confirmTransactionPolling(connection, initPoolTx);
      console.log("✅ Farm finalized");
      setIsBroadcasting(false);

      // ── Save to database ──
      setStatusMessage("Saving farm information...");

      const poolData = {
        name: selectedToken.name,
        symbol: selectedToken.symbol,
        tokenDecimals: selectedToken.decimals,
        tokenMint: selectedToken.mint,
        logo: selectedToken.logoURI,
        apr: "0",
        apy: "0",
        type: lockPeriodDays === 0 ? "unlocked" : "locked",
        lockPeriod: lockPeriodDays.toString(),
        rewards: selectedRewardToken.symbol,
        poolId,
        transferTaxBps: 0,
        hasSelfReflections: false,
        hasExternalReflections: false,
        externalReflectionMint: null,
        reflectionTokenSymbol: null,
        reflectionVaultAddress: null,
        isInitialized: true,
        isPaused: false,
        paymentTxSignature: paymentSignature,
        createTxSignature: createProjectTx,
        initTxSignature: initPoolTx,
        creatorWallet: publicKey.toString(),
        projectPda: projectPDA.toString(),
        poolAddress: projectPDA.toString(),
        engine: "current",
        isLPPool: true,
        lpUrl: selectedToken.lpPoolId
          ? `https://raydium.io/liquidity/increase/?mode=add&pool_id=${selectedToken.lpPoolId}`
          : (farmConfig.lpUrl || null),
        dexPoolAddress: selectedToken.lpPoolId || null,
        dexType: selectedToken.lpPoolId ? "raydium" : null,
        rewardTokenMint: selectedRewardToken.mint,
        rewardTokenSymbol: selectedRewardToken.symbol,
        duration: parseInt(farmConfig.duration),
        rateMode: 1,
      };

      const response = await fetch("/api/pools/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(poolData),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save farm to database");
      }
      const savedPool = await response.json();
      console.log("✅ Farm saved to database:", savedPool);
      setCreatedPoolId(savedPool.pool.id);

      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'farm_created', { modal_name: 'create_farm', token: selectedToken?.symbol, rewardToken: selectedRewardToken?.symbol });
      }

      setShowSuccessModal(true);
      setStatusMessage("");
      setLoading(false);
    } catch (error: any) {
      console.error("Error creating farm:", error);
      setStatusMessage("");
      const anchorErrorMap: Record<number, string> = {
        6000: "You don't have permission to do this.",
        6001: "The amount entered isn't valid.",
        6002: "You don't have enough tokens in your wallet.",
        6003: "This pool has been paused.",
        6011: "A calculation error occurred. Try a smaller reward amount.",
        6012: "This pool has already been set up.",
        6013: "This pool wasn't fully initialised. The second transaction may have been missed.",
        6015: "This pool requires a reflection vault but none was provided.",
        6016: "A reflection token is required but wasn't set.",
        6018: "You don't have enough SOL to cover the transaction fee.",
        6024: "Pool duration must be greater than 0 days.",
        6025: "A calculation error occurred. Please try again.",
        6028: "Wrong token type. This doesn't match the expected token.",
        6036: "Invalid rate mode.",
      };
      const errStr = String(error?.message ?? error);
      const hexMatch = errStr.match(/custom program error: 0x([0-9a-fA-F]+)/);
      const jsonMatch = errStr.match(/["\\]?Custom["\\]?\s*[:\s]\s*(\d+)/);
      const anchorMatch = errStr.match(/Error Number: (\d+)/);
      const fallbackMatch = !hexMatch && !jsonMatch && !anchorMatch ? errStr.match(/Custom\W+(\d{4,})/) : null;
      const errorCode = hexMatch ? parseInt(hexMatch[1], 16) : jsonMatch ? parseInt(jsonMatch[1]) : anchorMatch ? parseInt(anchorMatch[1]) : fallbackMatch ? parseInt(fallbackMatch[1]) : null;
      const anchorError = errorCode !== null ? anchorErrorMap[errorCode] : null;
      let errorMessage = anchorError || "Failed to create farm. Please try again.";
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

  const inputCls = "w-full px-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-sm focus:outline-none transition-colors";

  // Filtered reward tokens (excludes selected staking token, supports search)
  const filteredRewardTokens = userTokens
    .filter(t => t.mint !== selectedToken?.mint)
    .filter(t => {
      if (!rewardSearchQuery) return true;
      const q = rewardSearchQuery.toLowerCase();
      return (t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q));
    });

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
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
              <h2 className="text-xl font-bold text-white mb-2">Launch your LP Farm</h2>
              <p className="text-sm text-gray-400 mb-6">Dual staking: users stake LP tokens, earn a separate reward token</p>

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

              <p className="text-xs text-gray-500 mb-6 max-w-xs text-center leading-relaxed">Stake LP tokens and earn a different reward token. Supports all SPL and Token-2022 tokens. No code required.</p>

              <button
                onClick={() => setShowIntro(false)}
                className="w-full max-w-xs py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
              >
                Create Farm
              </button>
              <button onClick={onClose} className="mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Cancel
              </button>
            </div>
          ) : (<>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
            <h2 className="text-base font-bold flex items-center gap-2" style={{ background: 'linear-gradient(45deg, white, #fb57ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <Plus className="w-4 h-4 flex-shrink-0" style={{ color: '#fb57ff' }} />
              Create LP Farm
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 px-5 py-2.5 border-b border-white/[0.08] flex-shrink-0">
            {(['Stake Token', 'Reward Token', 'Configure', 'Confirm'] as const).map((label, i) => {
              const s = i + 1;
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className="w-6 h-px bg-white/[0.1]" />}
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

            {loading && step === 2 && (
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

            {/* ── STEP 1: Enter LP Pair Address ── */}
            {step === 1 && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Paste the LP pair address (the pool_id from the Raydium or DexScreener link). No need to hold the LP token in your wallet.
                </p>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <input
                    type="text"
                    value={pairAddress}
                    onChange={e => setPairAddress(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !resolvingPair) resolveLpPair(); }}
                    placeholder="e.g. 3b2ys5YveWJ7D6SusGTESpUnmAUzNitHMNNftsmAmxST"
                    className="w-full pl-9 pr-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[#fb57ff]/30"
                  />
                </div>

                <button
                  onClick={resolveLpPair}
                  disabled={resolvingPair || !pairAddress.trim()}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                >
                  {resolvingPair ? (<><Loader2 className="w-4 h-4 animate-spin" /> Resolving pool...</>) : (<>Find LP token →</>)}
                </button>

                <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/20 rounded-lg">
                  <p className="text-xs text-gray-400">The LP token mint is read straight from the pool and the add liquidity link is built for you. Raydium standard pools only. CLMM pools use NFT positions and cannot be staked.</p>
                </div>
              </div>
            )}

            {/* ── STEP 2: Select Reward Token ── */}
            {step === 2 && selectedToken && (
              <div className="space-y-3">
                {/* Selected staking token summary */}
                <div className="flex items-center gap-3 p-3 bg-white/[0.02] border border-green-500/20 rounded-xl">
                  {selectedToken.logoURI && <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-8 h-8 rounded-full flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-500">Staking token</div>
                    <div className="font-bold text-white text-sm truncate">{selectedToken.symbol}</div>
                  </div>
                  <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                </div>

                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Now select the token stakers will earn as rewards.
                </p>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                  <input
                    type="text"
                    value={rewardSearchQuery}
                    onChange={e => setRewardSearchQuery(e.target.value)}
                    placeholder="Search tokens..."
                    className="w-full pl-9 pr-3 py-2 bg-white/[0.02] border border-white/[0.1] rounded-lg text-white text-sm focus:outline-none focus:border-[#fb57ff]/30"
                  />
                </div>

                {filteredRewardTokens.length === 0 ? (
                  <div className="text-center py-8 text-gray-600">
                    <p className="text-sm">No matching tokens found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredRewardTokens.map((token) => (
                      <button
                        key={token.mint}
                        onClick={() => { setSelectedRewardToken(token); setError(null); setStep(3); }}
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
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Back */}
                <div className="pt-1">
                  <button onClick={() => { setError(null); setStep(1); }} className="w-full px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors">Back</button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Configure ── */}
            {step === 3 && selectedToken && selectedRewardToken && (
              <div className="space-y-3">
                {/* Selected tokens summary */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 p-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                    {selectedToken.logoURI && <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-7 h-7 rounded-full flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">Stake</div>
                      <div className="font-semibold text-white text-xs truncate">{selectedToken.symbol}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                    {selectedRewardToken.logoURI && <img src={selectedRewardToken.logoURI} alt={selectedRewardToken.symbol} className="w-7 h-7 rounded-full flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">Earn</div>
                      <div className="font-semibold text-white text-xs truncate">{selectedRewardToken.symbol}</div>
                    </div>
                  </div>
                </div>

                {/* Tip */}
                <div className="p-2.5 bg-white/[0.02] border border-[#fb57ff]/20 rounded-lg">
                  <p className="text-xs text-gray-400">💡 APR auto-calculates from deposited rewards. <span className="text-yellow-400">⚠️ Stake a small amount yourself after creation to show a live APR.</span></p>
                </div>

                {/* Fields */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Reward Deposit ({selectedRewardToken.symbol})</label>
                      <input type="number" value={farmConfig.rewardAmount} onChange={(e) => setFarmConfig({ ...farmConfig, rewardAmount: e.target.value })} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="1000" min="1" />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>Tokens deposited as staking rewards. Must be greater than 0.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Farm Duration (days) <span className="text-[#fb57ff]">365+ rec.</span></label>
                      <input type="number" value={farmConfig.duration} onChange={(e) => setFarmConfig({ ...farmConfig, duration: e.target.value })} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="365" min="1" />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>How long rewards are distributed. Minimum 1 day, 365+ recommended.</p>
                    </div>
                  </div>
                  <div className="border-t border-white/[0.05]" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Min Lock (days) <span className="text-gray-600">0 = flexible</span></label>
                      <input type="number" value={farmConfig.lockPeriod} onChange={(e) => { const v = e.target.value; const d = parseInt(farmConfig.duration); const l = parseInt(v); setFarmConfig({ ...farmConfig, lockPeriod: l > d ? farmConfig.duration : v }); }} className={inputCls} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="0" min="0" max={farmConfig.duration} />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>Minimum time before stakers can unstake. 0 = flexible.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">LP Pool URL {selectedToken.lpPoolId ? <span className="text-gray-600">locked</span> : <span className="text-[#fb57ff]">*required</span>}</label>
                      <input type="text" value={farmConfig.lpUrl} readOnly={!!selectedToken.lpPoolId} onChange={(e) => { if (selectedToken.lpPoolId) return; setFarmConfig({ ...farmConfig, lpUrl: e.target.value }); }} className={`${inputCls} placeholder:text-[10px] ${selectedToken.lpPoolId ? 'opacity-70 cursor-not-allowed' : ''}`} onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,87,255,0.5)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')} placeholder="https://raydium.io/liquidity/increase/?mode=add&pool_id=..." />
                      <p className="text-xs mt-1" style={{ color: 'rgba(251,87,255,0.5)' }}>{selectedToken.lpPoolId ? "Generated from the pair address and locked." : "Paste the Raydium link where users can add liquidity."}</p>
                    </div>
                  </div>
                </div>

                {/* Nav */}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setError(null); setStep(2); }} disabled={loading} className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">Back</button>
                  <button onClick={() => {
                    if (!farmConfig.rewardAmount || parseFloat(farmConfig.rewardAmount) <= 0) { setError("Reward deposit must be greater than 0."); return; }
                    if (!farmConfig.duration || parseInt(farmConfig.duration) <= 0) { setError("Farm duration must be at least 1 day."); return; }
                    if (!selectedToken.lpPoolId && (!farmConfig.lpUrl || !farmConfig.lpUrl.startsWith('http'))) { setError("We could not detect the pool for this LP token. Paste the Raydium link where users can add liquidity."); return; }
                    if (farmConfig.lpUrl && /dlmm|damm|meteora\.ag\/dlmm/i.test(farmConfig.lpUrl)) { setError("Meteora DLMM and DAMM v2 positions are NFTs rather than LP tokens, so they cannot be staked in a farm. Use a Raydium pool or a Meteora DAMM v1 pool."); return; }
                    setError(null); setStep(4);
                  }} disabled={loading} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50" style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}>Continue →</button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Confirm ── */}
            {step === 4 && selectedToken && selectedRewardToken && (
              <div className="space-y-3">
                {/* Fee */}
                <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-300">⚠️ Farm Creation Fee</p>
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
                    <li>Tx 1: Pay fee + create farm on-chain</li>
                    <li>Tx 2: Initialize params + deposit {farmConfig.rewardAmount} {selectedRewardToken.symbol}</li>
                  </ul>
                </div>

                {/* Summary */}
                <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl">
                  <div className="flex items-center gap-3 mb-3 pb-3 border-b border-white/[0.05]">
                    <div className="flex -space-x-2">
                      {selectedToken.logoURI && <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="w-8 h-8 rounded-full border-2 border-black flex-shrink-0" />}
                      {selectedRewardToken.logoURI && <img src={selectedRewardToken.logoURI} alt={selectedRewardToken.symbol} className="w-8 h-8 rounded-full border-2 border-black flex-shrink-0" />}
                    </div>
                    <div>
                      <div className="font-bold text-white">Stake {selectedToken.symbol} → Earn {selectedRewardToken.symbol}</div>
                      <div className="text-xs text-gray-500">LP Farm</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex justify-between"><span className="text-xs text-gray-500">APR</span><span className="text-xs font-medium" style={{ color: '#fb57ff' }}>Dynamic</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Rewards</span><span className="text-xs font-medium text-white">{parseFloat(farmConfig.rewardAmount).toLocaleString()} {selectedRewardToken.symbol}</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Duration</span><span className="text-xs font-medium text-white">{farmConfig.duration} days</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Lock</span><span className="text-xs font-medium text-white">{farmConfig.lockPeriod} days{parseInt(farmConfig.lockPeriod) === 0 ? ' (Flex)' : ''}</span></div>
                    {(farmConfig.lpUrl || selectedToken.lpPoolId) && (
                      <div className="flex justify-between col-span-2"><span className="text-xs text-gray-500">LP URL</span><span className="text-xs font-medium text-white truncate max-w-[200px]">{farmConfig.lpUrl || `raydium.io/liquidity/increase/?pool_id=${selectedToken.lpPoolId}`}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Engine</span><span className="text-xs font-medium text-white">V2 (Current)</span></div>
                    <div className="flex justify-between"><span className="text-xs text-gray-500">Status</span><span className="text-xs font-medium" style={{ color: '#fb57ff' }}>Ready</span></div>
                  </div>
                </div>

                {/* Nav */}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setError(null); setStep(3); }} disabled={loading} className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">Back</button>
                  <button
                    onClick={handleCreateFarm}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(45deg, #1a001a, #fb57ff)' }}
                    onMouseEnter={(e) => !loading && (e.currentTarget.style.background = 'linear-gradient(45deg, #fb57ff, #1a001a)')}
                    onMouseLeave={(e) => !loading && (e.currentTarget.style.background = 'linear-gradient(45deg, #1a001a, #fb57ff)')}
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : 'Create Farm'}
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
                <h2 className="text-xl font-bold" style={{ background: 'linear-gradient(45deg, white, #fb57ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Farm Created! 🎉</h2>
                <p className="text-gray-400 text-sm">Your LP farm is now live</p>
              </div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-3">
              <p className="text-sm font-semibold text-yellow-400 mb-1">⚡ Important: Kickstart Your APR</p>
              <p className="text-xs text-yellow-300 leading-relaxed">Your farm's APR will show <strong>0%</strong> until someone stakes. Stake a small amount yourself right away to activate reward distribution and show a live APR.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="flex flex-col gap-2">
                <div className="bg-white/[0.02] border border-[#fb57ff]/20 rounded-lg p-3 flex-1">
                  <p className="text-sm font-semibold mb-2" style={{ color: '#fb57ff' }}>🔗 Share Your Farm</p>
                  <div className="flex gap-2 mb-2">
                    <input type="text" value={`${typeof window !== 'undefined' ? window.location.origin : ''}/pool/${createdPoolId}`} readOnly className="flex-1 px-2 py-1.5 bg-white/[0.05] border border-white/[0.1] rounded text-xs text-white font-mono min-w-0" onClick={(e) => e.currentTarget.select()} />
                    <button onClick={() => { navigator.clipboard.writeText(`${typeof window !== 'undefined' ? window.location.origin : ''}/pool/${createdPoolId}`); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2000); }} className="px-3 py-1.5 bg-[#fb57ff]/20 hover:bg-[#fb57ff]/30 border border-[#fb57ff]/50 rounded transition-all text-xs font-semibold min-w-[60px]" style={urlCopied ? { background: 'linear-gradient(45deg, black, #fb57ff)' } : {}}>
                      {urlCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">Share this link with your community!</p>
                </div>
                <FarmReviewPrompt />
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    const url = `https://stakepoint.app/pool/${createdPoolId}`;
                    const lockText = parseInt(farmConfig.lockPeriod) > 0 ? ` with a ${farmConfig.lockPeriod}-day lock` : '';
                    const text = `Just launched a $${selectedToken?.symbol} LP farm on @StakePointApp 🚀\n\nStake LP tokens and earn $${selectedRewardToken?.symbol} rewards${lockText}.\n\n`;
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
                <button onClick={() => window.open(`/pool/${createdPoolId}`, '_blank')} className="w-full px-4 py-2.5 bg-white/[0.05] hover:bg-white/[0.08] border border-[#fb57ff]/30 rounded-lg font-semibold text-sm transition-all hover:border-[#fb57ff] text-white">View Farm</button>
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
            <h3 className="text-xl font-bold text-white mb-2">
              {isConfirming ? "Confirm in Wallet" : "Broadcasting..."}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {isConfirming ? "Please approve the transaction in your wallet" : "Broadcasting to the Solana blockchain"}
            </p>
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 mb-4">
              <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Do not close this window</p>
              <p className="text-xs text-gray-500">Farm creation requires 2 transactions. Stay on this page.</p>
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