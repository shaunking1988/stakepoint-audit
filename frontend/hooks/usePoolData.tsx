"use client";
import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL, AccountInfo } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { getPDAs, getReadOnlyProgram } from "@/lib/anchor-program";

interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
}

interface UserData {
  solBalance: number;
  tokenBalances: Map<string, TokenBalance>;
  lastUpdated: number;
}

interface PoolInfo {
  tokenMint: string;
  poolId: number;
  engine?: string;
}

interface PoolDataContextType {
  // Token data (cached globally)
  getDecimals: (mint: string) => number | null;
  getPrice: (mint: string) => { price: number | null; change: number | null };
  
  // User data
  getUserTokenBalance: (mint: string) => number;
  getSolBalance: () => number;
  
  // Pool data
  getPoolProject: (tokenMint: string, poolId: number) => any | null;
  getUserStake: (tokenMint: string, poolId: number) => any | null;
  
  // Batch loading
  loadPoolsData: (mints: string[]) => Promise<void>;
  loadAllPoolData: (pools: PoolInfo[]) => Promise<void>;
  loadUserData: () => Promise<void>;
  
  // Status
  isLoading: boolean;
  isUserDataLoading: boolean;
  isPoolDataLoading: boolean;
}

const PoolDataContext = createContext<PoolDataContextType | undefined>(undefined);

// Global caches (persist across renders)
const decimalsCache = new Map<string, number>();

const priceCache = new Map<string, { price: number | null; change: number | null; timestamp: number }>();
const projectCache = new Map<string, any>();
const stakeCache = new Map<string, any>();
const PRICE_CACHE_DURATION = 600000; // 10 minutes
// Clear stale null prices on module load
priceCache.clear();

export function PoolDataProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  
  const [isLoading, setIsLoading] = useState(false);
  const [isUserDataLoading, setIsUserDataLoading] = useState(false);
  const [isPoolDataLoading, setIsPoolDataLoading] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [poolsLoaded, setPoolsLoaded] = useState(false);
  const [priceVersion, setPriceVersion] = useState(0);
  const [decimalsVersion, setDecimalsVersion] = useState(0);
  
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  
  const publicKeyRef = useRef(publicKey);
  publicKeyRef.current = publicKey;

  // Track loaded pools for re-fetching user stakes
  const loadedPoolsRef = useRef<PoolInfo[]>([]);

  // Batch load decimals for all mints
  const loadPoolsData = useCallback(async (mints: string[]) => {
    const allMints = [...new Set(mints)].filter(m => m);
    const mintsNeedingDecimals = allMints.filter(m => !decimalsCache.has(m));
    
    setIsLoading(true);
    
    try {
      // Fetch decimals for mints that need them
      if (mintsNeedingDecimals.length > 0) {
        const conn = connectionRef.current;
        
        // Use getParsedAccountInfo for reliable decimal parsing (works for SPL and Token-2022)
        // Batch fetch all mint accounts in chunks of 100
        const chunks = [];
        for (let i = 0; i < mintsNeedingDecimals.length; i += 100) {
          chunks.push(mintsNeedingDecimals.slice(i, i + 100));
        }
        
        for (const chunk of chunks) {
          try {
            const pubkeys = chunk.map(m => new PublicKey(m));
            const accounts = await conn.getMultipleAccountsInfo(pubkeys);
            
            accounts.forEach((account, idx) => {
              if (account) {
                try {
                  // Parse mint account data manually - decimals at byte offset 44
                  const decimals = account.data[44] || 9;
                  decimalsCache.set(chunk[idx], decimals);
                } catch {
                  decimalsCache.set(chunk[idx], 9);
                }
              } else {
                decimalsCache.set(chunk[idx], 9);
              }
            });
            
            console.log(`✅ Batch loaded decimals for ${chunk.length} mints in 1 RPC call`);
          } catch (error) {
            console.error('Batch decimals error:', error);
            chunk.forEach(mint => decimalsCache.set(mint, 9));
          }
        }
        
        console.log(`✅ Loaded decimals for ${mintsNeedingDecimals.length} mints`);
        setDecimalsVersion(v => v + 1); // Trigger re-render
      }
      
      // ✅ ALWAYS fetch prices for ALL mints (price cache has its own expiry)
      if (allMints.length > 0) {
        await new Promise(r => setTimeout(r, 400)); // breathing room
        await batchFetchPrices(allMints);
      }
      
    } catch (error) {
      console.error('Batch load error:', error);
      mintsNeedingDecimals.forEach(mint => {
        if (!decimalsCache.has(mint)) {
          decimalsCache.set(mint, 9);
        }
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ✅ NEW: Batch load ALL pool projects and user stakes in 2 RPC calls
  const loadAllPoolData = useCallback(async (pools: PoolInfo[]) => {
    if (pools.length === 0) return;
    
    setIsPoolDataLoading(true);
    
    try {
      const conn = connectionRef.current;
      const program = getReadOnlyProgram(conn);
      
      // Calculate all PDAs
      const projectPDAs: PublicKey[] = [];
      const userStakePDAs: PublicKey[] = [];
      const poolKeys: string[] = [];
      
      const poolEngines: string[] = [];
      for (const pool of pools) {
        const mint = new PublicKey(pool.tokenMint);
        const eng = pool.engine || 'legacy';
        const [projectPDA] = eng === 'current'
          ? getPDAs.project1(mint, pool.poolId)
          : getPDAs.project(mint, pool.poolId);
        projectPDAs.push(projectPDA);
        poolKeys.push(`${pool.tokenMint}-${pool.poolId}`);
        poolEngines.push(eng);
      }
      
      // ✅ BATCH CALL 1: Fetch ALL project accounts
      console.log(`🔄 Fetching ${projectPDAs.length} project accounts...`);
      const projectAccounts = await conn.getMultipleAccountsInfo(projectPDAs);
      
      // Decode project accounts
      projectAccounts.forEach((account, idx) => {
        const key = poolKeys[idx];
        if (account) {
          try {
            const accountType = poolEngines[idx] === 'current' ? 'project1' : 'project';
            const decoded = program.coder.accounts.decode(accountType, account.data);
            projectCache.set(key, {
              ...decoded,
              address: projectPDAs[idx],
            });
          } catch (e) {
            console.warn(`Failed to decode project ${key}:`, e);
          }
        }
      });
      
      console.log(`✅ Batch loaded ${projectAccounts.filter(Boolean).length} projects in 1 RPC call`);
      
      // ✅ BATCH CALL 2: Fetch ALL user stake accounts (if wallet connected)
      if (publicKeyRef.current) {
        const userStakePDAsForUser: PublicKey[] = [];
        
        for (let i = 0; i < pools.length; i++) {
          const [userStakePDA] = poolEngines[i] === 'current'
            ? getPDAs.userStake1(projectPDAs[i], publicKeyRef.current)
            : getPDAs.userStake(projectPDAs[i], publicKeyRef.current);
          userStakePDAsForUser.push(userStakePDA);
        }
        
        console.log(`🔄 Fetching ${userStakePDAsForUser.length} user stake accounts...`);
        const stakeAccounts = await conn.getMultipleAccountsInfo(userStakePDAsForUser);
        
        stakeAccounts.forEach((account, idx) => {
          const key = poolKeys[idx];
          if (account) {
            try {
              const accountType = poolEngines[idx] === 'current' ? 'stake1' : 'stake';
              const decoded = program.coder.accounts.decode(accountType, account.data);
              stakeCache.set(key, decoded);
            } catch (e) {
              // User hasn't staked in this pool
            }
          }
        });
        
        console.log(`✅ Batch loaded ${stakeAccounts.filter(Boolean).length} user stakes in 1 RPC call`);
      }
      
      setPoolsLoaded(true);
      loadedPoolsRef.current = pools;
      
    } catch (error) {
      console.error('Batch pool data load error:', error);
    } finally {
      setIsPoolDataLoading(false);
    }
  }, []);

  // Batch fetch prices from DexScreener + Birdeye Fallback - Fixed Caching
  const batchFetchPrices = async (mints: string[]) => {
    const now = Date.now();
    
    const mintsNeedingPrice = mints.filter(m => {
      const cached = priceCache.get(m);
      if (!cached) return true;
      if (cached.price === null) return (now - cached.timestamp > 60000); // 60 seconds for nulls
      return (now - cached.timestamp > PRICE_CACHE_DURATION);
    });

    if (mintsNeedingPrice.length === 0) {
      console.log("✅ All prices are cached");
      return;
    }

    console.log(`🔍 Fetching prices for ${mintsNeedingPrice.length} tokens...`);

    const chunks = [];
    for (let i = 0; i < mintsNeedingPrice.length; i += 20) {
      chunks.push(mintsNeedingPrice.slice(i, i + 20));
    }

    let successCount = 0;
    const failedMints: string[] = [];

    // DexScreener
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const res = await fetch(`/api/price?mints=${chunk.join(',')}`, {
          cache: 'no-store',
        });

        if (res.ok) {
          const data = await res.json();
          const pairs = data?.pairs || [];

          chunk.forEach(mint => {
            const relevant = pairs.filter((p: any) => 
              p.baseToken?.address === mint || p.quoteToken?.address === mint
            );
            if (relevant.length === 0) {
              failedMints.push(mint);
              return;
            }

            const best = relevant.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
            let price = parseFloat(best.priceUsd) || null;
            if (best.quoteToken?.address === mint && price) price = 1 / price;

            if (price && price > 0) {
              priceCache.set(mint, { price, change: best.priceChange?.h24 != null && best.priceChange.h24 !== '' ? parseFloat(best.priceChange.h24) : null, timestamp: now });
              successCount++;
            } else {
              failedMints.push(mint);
            }
          });
        } else {
          failedMints.push(...chunk);
        }
      } catch (e) {
        failedMints.push(...chunk);
      }

      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 900));
    }

    // Birdeye Fallback - batch call
    if (failedMints.length > 0) {
      try {
        const res = await fetch(`/api/price?mints_birdeye=${failedMints.join(',')}`);
        if (res.ok) {
          const data = await res.json();
          failedMints.forEach(mint => {
            const item = data?.[mint];
            if (item?.value) {
              priceCache.set(mint, { price: item.value, change: item.priceChange24h != null ? Number(item.priceChange24h) : null, timestamp: now });
              successCount++;
            }
          });
        }
      } catch (e) {}
    }

    console.log(`✅ Got prices for ${successCount} tokens`);
    setPriceVersion(v => v + 1);
  };

  // Load all user token balances
  const loadUserData = useCallback(async () => {
    if (!publicKey || !connected) {
      setUserData(null);
      return;
    }
    
    setIsUserDataLoading(true);
    
    try {
      const conn = connectionRef.current;
      
      // Get SOL balance
      const solBalance = await conn.getBalance(publicKey);
      
      const tokenBalances = new Map<string, TokenBalance>();
      
      // Fetch standard SPL tokens
      const tokenAccounts = await conn.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );
      
      tokenAccounts.value.forEach(account => {
        const parsed = account.account.data.parsed?.info;
        if (parsed) {
          const mint = parsed.mint;
          const balance = parsed.tokenAmount?.uiAmount || 0;
          const decimals = parsed.tokenAmount?.decimals || 9;
          
          tokenBalances.set(mint, { mint, balance, decimals });
          
          if (!decimalsCache.has(mint)) {
            decimalsCache.set(mint, decimals);
          }
        }
      });
      
      // ✅ ALSO fetch Token-2022 tokens (like SPT)
      try {
        const raw2022Res = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "token2022-balance",
            method: "getTokenAccountsByOwner",
            params: [
              publicKey.toString(),
              { programId: TOKEN_2022_PROGRAM_ID.toString() },
              { encoding: "jsonParsed" }
            ]
          })
        });
        const raw2022Data = await raw2022Res.json();
        const token2022Accounts = {
          value: (raw2022Data?.result?.value || []).filter(
            (acc: any) => typeof acc?.account?.data?.program === 'string'
          )
        };
        
        token2022Accounts.value.forEach((account: any) => {
          const parsed = account.account.data.parsed?.info;
          if (parsed) {
            const mint = parsed.mint;
            const balance = parsed.tokenAmount?.uiAmount || 0;
            const decimals = parsed.tokenAmount?.decimals || 9;
            
            tokenBalances.set(mint, { mint, balance, decimals });
            
            if (!decimalsCache.has(mint)) {
              decimalsCache.set(mint, decimals);
            }
          }
        });
      } catch (e) {
        console.warn('Token-2022 fetch failed:', e);
      }
      
      setUserData({
        solBalance: solBalance / LAMPORTS_PER_SOL,
        tokenBalances,
        lastUpdated: Date.now()
      });
      
      console.log(`✅ Loaded user data: ${tokenBalances.size} token accounts in 3 RPC calls`);
      
    } catch (error) {
      console.error('User data load error:', error);
    } finally {
      setIsUserDataLoading(false);
    }
  }, [publicKey, connected]);

  // Auto-load user data when wallet connects
  useEffect(() => {
    if (connected && publicKey) {
      loadUserData();
      
      // Re-fetch user stakes if pools were already loaded
      if (loadedPoolsRef.current.length > 0) {
        console.log('🔄 Wallet connected - refetching user stakes...');
        loadAllPoolData(loadedPoolsRef.current);
      }
      
      // Refresh every 2 minutes
      const interval = setInterval(loadUserData, 120000);
      return () => clearInterval(interval);
    } else {
      setUserData(null);
      // Clear user-specific caches
      stakeCache.clear();
    }
  }, [connected, publicKey, loadUserData, loadAllPoolData]);

  // Getters
  const getDecimals = useCallback((mint: string): number | null => {
    const cached = decimalsCache.get(mint);
    return cached !== undefined ? cached : null;
  }, [decimalsVersion]);

  const getPrice = useCallback((mint: string): { price: number | null; change: number | null } => {
    const cached = priceCache.get(mint);
    return cached ? { price: cached.price, change: cached.change } : { price: null, change: null };
  }, [priceVersion]);

  const getUserTokenBalance = useCallback((mint: string): number => {
    if (!userData) return 0;
    return userData.tokenBalances.get(mint)?.balance || 0;
  }, [userData]);

  const getSolBalance = useCallback((): number => {
    return userData?.solBalance || 0;
  }, [userData]);

  // Get cached pool project data
  const getPoolProject = useCallback((tokenMint: string, poolId: number): any | null => {
    const key = `${tokenMint}-${poolId}`;
    return projectCache.get(key) || null;
  }, [poolsLoaded]);

  // Get cached user stake data
  const getUserStake = useCallback((tokenMint: string, poolId: number): any | null => {
    const key = `${tokenMint}-${poolId}`;
    return stakeCache.get(key) || null;
  }, [poolsLoaded]);

  return (
    <PoolDataContext.Provider value={useMemo(() => ({
      getDecimals,
      getPrice,
      getUserTokenBalance,
      getSolBalance,
      getPoolProject,
      getUserStake,
      loadPoolsData,
      loadAllPoolData,
      loadUserData,
      isLoading,
      isUserDataLoading,
      isPoolDataLoading,
    }), [getDecimals, getPrice, getUserTokenBalance, getSolBalance, getPoolProject, getUserStake, loadPoolsData, loadAllPoolData, loadUserData, isLoading, isUserDataLoading, isPoolDataLoading])}>
      {children}
    </PoolDataContext.Provider>
  );
}

export function usePoolData() {
  const context = useContext(PoolDataContext);
  if (!context) {
    throw new Error('usePoolData must be used within PoolDataProvider');
  }
  return context;
}