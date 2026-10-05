"use client";

import { useState, useEffect, useMemo } from "react";
import PoolCard from "@/components/PoolCard";
import { useToast } from "@/components/ToastContainer";
import { PoolCardSkeleton } from "@/components/SkeletonLoaders";
import { Search, X, SlidersHorizontal, Grid3x3, List, Plus } from "lucide-react";
import Link from "next/link";
import { usePoolData } from "@/hooks/usePoolData";
import dynamic from 'next/dynamic';
const CreatePoolModal = dynamic(() => import('@/components/CreatePoolModal'), { ssr: false });
import { useWallet } from "@solana/wallet-adapter-react";
import { useDebounce } from 'use-debounce';

type Pool = {
  id: string;
  poolId: number;
  tokenMint: string;
  name: string;
  symbol: string;
  type: "locked" | "unlocked";
  lockPeriod?: number | null;
  apr?: number | null;
  apy?: number | null;
  rateMode?: number;
  totalStaked: number;
  rewards?: string | null;
  logo?: string | null;
  pairAddress?: string | null;
  hidden?: boolean;
  featured?: boolean;
  createdAt?: string;
  hasSelfReflections?: boolean;
  hasExternalReflections?: boolean;
  externalReflectionMint?: string | null;
  reflectionTokenAccount?: string | null;
  reflectionTokenSymbol?: string | null;
  verified?: boolean;
  featuredOrder?: number;
  engine?: string;
  rewardTokenMint?: string | null;
  rewardTokenSymbol?: string | null;
  lpUrl?: string | null;
  isLPPool?: boolean;
};

export default function PoolsClient({ pools }: { pools: Pool[] }) {
  const [sortBy, setSortBy] = useState<"az" | "za" | "rate" | "newest">("az");
  const [filterType, setFilterType] = useState<"all" | "locked" | "unlocked">("all");
  const [filterFeatured, setFilterFeatured] = useState(false);
  const [aprMin, setAprMin] = useState<number>(0);
  const [aprMax, setAprMax] = useState<number>(Infinity);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
  const [compactCards, setCompactCards] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const POOLS_PER_PAGE = 6;
    
  const { showInfo, showSuccess } = useToast();
  const { connected } = useWallet();
  
  const { loadPoolsData, loadAllPoolData, getPoolProject, getDecimals, getPrice, isPoolDataLoading } = usePoolData();
  const [dynamicRates, setDynamicRates] = useState<Map<string, number>>(new Map());
  const [stakerCounts, setStakerCounts] = useState<Record<string, number>>({});
  const [latestActivity, setLatestActivity] = useState<Record<string, string>>({});
  const [featuredLoading, setFeaturedLoading] = useState(true);

  // Batch load all pool data on mount (sequenced to avoid RPC rate limits)
  useEffect(() => {
    const loadSequentially = async () => {
      const uniqueMints = [...new Set([...pools.map(p => p.tokenMint), ...pools.map(p => p.rewardTokenMint)].filter(Boolean))] as string[];
      if (uniqueMints.length > 0) {
        await loadPoolsData(uniqueMints);
      }
      
      await new Promise(r => setTimeout(r, 500));
      
      const poolInfos = pools.map(p => ({ tokenMint: p.tokenMint, poolId: p.poolId, engine: p.engine || 'legacy' }));
      if (poolInfos.length > 0) {
        await loadAllPoolData(poolInfos);
      }
    };
    
    loadSequentially();

    // Fetch dynamic featured data
    fetch("/api/pool-stakers")
      .then(res => res.ok ? res.json() : { stakerCounts: {}, latestActivity: {} })
      .then(data => {
        setStakerCounts(data.stakerCounts || {});
        setLatestActivity(data.latestActivity || {});
      })
      .catch(() => {})
      .finally(() => setFeaturedLoading(false));
  }, [pools, loadPoolsData, loadAllPoolData]);

  // Calculate dynamic rates from blockchain data
  useEffect(() => {
    if (pools.length === 0) return;
    
    const rates = new Map<string, number>();
    
    pools.forEach(pool => {
      const project = getPoolProject(pool.tokenMint, pool.poolId);
      if (!project) {
        const rate = Number(pool.apr ?? pool.apy ?? 0);
        rates.set(pool.id, rate);
        return;
      }
      
      // Ended pools show 0% APR
      const poolEndTime = project.poolEndTime?.toNumber?.() || project.poolEndTime || null;
      const now = Math.floor(Date.now() / 1000);
      if (poolEndTime && poolEndTime < now) {
        rates.set(pool.id, 0);
        return;
      }
      
      if (project.rateMode === 0) {
        const rate = project.rateBpsPerYear?.toNumber?.() 
          ? project.rateBpsPerYear.toNumber() / 100 
          : (project.rateBpsPerYear || 0) / 100;
        rates.set(pool.id, rate);
      } else {
        const rewardRatePerSecond = BigInt(project.rewardRatePerSecond?.toString() || '0');
        const totalStaked = BigInt(project.totalStaked?.toString() || '0');
        const hasDifferentReward = pool.rewardTokenMint && pool.rewardTokenMint !== pool.tokenMint;
        
        if (hasDifferentReward) {
          if (totalStaked > 0n && rewardRatePerSecond > 0n) {
            const rewardDecimals = project.rewardTokenDecimals ?? 9;
            const stakingDecimals = getDecimals(pool.tokenMint) ?? 9;
            const annualRewardTokens = Number(rewardRatePerSecond * BigInt(31_536_000)) / Math.pow(10, rewardDecimals);
            const totalStakedTokens = Number(totalStaked) / Math.pow(10, stakingDecimals);
            const rewardPrice = getPrice(pool.rewardTokenMint!).price;
            const stakedPrice = getPrice(pool.tokenMint).price;
            if (rewardPrice && stakedPrice && totalStakedTokens > 0) {
              const usdApr = (annualRewardTokens * rewardPrice) / (totalStakedTokens * stakedPrice) * 100;
              rates.set(pool.id, usdApr);
            }
          }
        } else {
          if (totalStaked > 0n && rewardRatePerSecond > 0n) {
            const SECONDS_PER_YEAR = 31_536_000;
            const annualRewards = rewardRatePerSecond * BigInt(SECONDS_PER_YEAR);
            const apr = Number((annualRewards * 10000n) / totalStaked) / 100;
            rates.set(pool.id, apr);
          } else {
            rates.set(pool.id, 0);
          }
        }
      }
    });
    
    setDynamicRates(rates);
  }, [pools, getPoolProject, getPrice, getDecimals, isPoolDataLoading]);

  // Load saved view preference
  useEffect(() => {
    const savedView = localStorage.getItem("poolsViewMode");
    if (savedView === "list" || savedView === "grid") {
      setViewMode(savedView);
    }
  }, []);

  const toggleViewMode = () => {
    const newMode = viewMode === "grid" ? "list" : "grid";
    setViewMode(newMode);
    localStorage.setItem("poolsViewMode", newMode);
  };

  // Count pools per token
  const poolCountByToken = useMemo(() => {
    return pools.reduce((acc, pool) => {
      const key = pool.tokenMint;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [pools]);

  // Apply Filters
  const filteredPools = useMemo(() => {
    return pools.filter((pool) => {
      if (filterType !== "all" && pool.type !== filterType) return false;
      const project = getPoolProject(pool.tokenMint, pool.poolId);
      const poolEndTime = project?.poolEndTime?.toNumber?.() || project?.poolEndTime || null;
      const now = Math.floor(Date.now() / 1000);
      const isEnded = poolEndTime && poolEndTime < now;
      if (!showEnded && isEnded) return false;
      if (filterFeatured && !pool.featured) return false;

      const rate = dynamicRates.get(pool.id) ?? Number(pool.apr ?? pool.apy ?? 0);
      if (rate < aprMin || (aprMax !== Infinity && rate > aprMax)) return false;

      if (debouncedSearch) {
        const query = debouncedSearch.toLowerCase();
        const matchesName = pool.name.toLowerCase().includes(query);
        const matchesSymbol = pool.symbol.toLowerCase().includes(query);
        if (!matchesName && !matchesSymbol) return false;
      }

      return true;
    });
  }, [pools, filterType, filterFeatured, aprMin, aprMax, debouncedSearch, dynamicRates, showEnded, getPoolProject]);

  // Apply Sorting
  const sortedPools = useMemo(() => {
    return [...filteredPools].sort((a, b) => {
      if (sortBy === "az") return a.name.localeCompare(b.name);
      if (sortBy === "za") return b.name.localeCompare(a.name);
      if (sortBy === "rate") {
        const rateA = dynamicRates.get(a.id) ?? Number(a.apr ?? a.apy ?? 0);
        const rateB = dynamicRates.get(b.id) ?? Number(b.apr ?? b.apy ?? 0);
        return rateB - rateA;
      }
      if (sortBy === "newest") {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      }
      return 0;
    });
  }, [filteredPools, sortBy, dynamicRates]);

  // Dynamic featured pools by category
  const featuredPools = useMemo(() => {
    const eligible = sortedPools.filter(p => {
      const rate = dynamicRates.get(p.id) ?? Number(p.apr ?? p.apy ?? 0);
      return rate > 0;
    });
    const featured: (Pool & { categoryLabel?: string; categoryEmoji?: string })[] = [];
    const usedIds = new Set<string>();

    // Most Popular: hardcoded SPT pool
    const sptPool = eligible.find(p => p.id === 'cmit7qyt80000jp04w6fkyrj6');
    if (sptPool) {
      featured.push({ ...sptPool, categoryLabel: 'Most Popular', categoryEmoji: '\uD83D\uDD25' });
      usedIds.add(sptPool.id);
    } else {
      const withStakers = eligible
        .map(p => ({ ...p, _stakers: stakerCounts[`${p.tokenMint}:${p.poolId || 0}`] || 0 }))
        .filter(p => p._stakers > 0)
        .sort((a, b) => b._stakers - a._stakers);
      if (withStakers[0]) {
        const { _stakers, ...pool } = withStakers[0];
        featured.push({ ...pool, categoryLabel: 'Most Popular', categoryEmoji: '\uD83D\uDD25' });
        usedIds.add(pool.id);
      }
    }

    // Newest Pool: most recently created
    const newest = eligible
      .filter(p => !usedIds.has(p.id) && p.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    if (newest[0]) {
      featured.push({ ...newest[0], categoryLabel: 'Newest Pool', categoryEmoji: '\uD83C\uDD95' });
      usedIds.add(newest[0].id);
    }

    // Most Recent Activity
    const withActivity = eligible
      .filter(p => !usedIds.has(p.id) && latestActivity[p.id])
      .sort((a, b) => new Date(latestActivity[b.id] || 0).getTime() - new Date(latestActivity[a.id] || 0).getTime());
    if (withActivity[0]) {
      featured.push({ ...withActivity[0], categoryLabel: 'Active Now', categoryEmoji: '\u26A1' });
      usedIds.add(withActivity[0].id);
    }

    return featured;
  }, [sortedPools, dynamicRates, stakerCounts, latestActivity]);

  const nonFeaturedPools = useMemo(() => {
    return sortedPools;
  }, [sortedPools]);

  const totalPages = Math.ceil(nonFeaturedPools.length / POOLS_PER_PAGE);

  const paginatedPools = useMemo(() => {
    const start = (currentPage - 1) * POOLS_PER_PAGE;
    return nonFeaturedPools.slice(start, start + POOLS_PER_PAGE);
  }, [nonFeaturedPools, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, filterFeatured, aprMin, aprMax, debouncedSearch, sortBy, showEnded]);

  // Scroll to top of pools when page changes
  useEffect(() => {
    if (currentPage > 1) {
      document.getElementById('pools-directory')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentPage]);

  const clearFilters = () => {
    setFilterType("all");
    setFilterFeatured(false);
    setAprMin(0);
    setAprMax(Infinity);
    setSearchQuery("");
    showInfo("Filters cleared!");
  };

  const hasActiveFilters = filterType !== "all" || filterFeatured || aprMin > 0 || aprMax < 1000 || searchQuery !== "";

  const getPoolRate = (pool: Pool): number => {
    return dynamicRates.get(pool.id) ?? Number(pool.apr ?? pool.apy ?? 0);
  };

  // NO artificial loading delay - render immediately
  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h2
          className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2"
          style={{
            background: 'linear-gradient(45deg, white, #fb57ff)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}
        >
          StakePoint Staking Pool Explorer
        </h2>
        <p className="text-xs sm:text-sm text-gray-400 mb-4">
          Browse every active pool and stake in one click. Supporting SPL and Token-2022 tokens including reflection rewards, with flexible and locked options.
        </p>
      </div>

      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <p className="text-sm sm:text-base text-gray-400 sm:hidden">
          Showing <span className="font-semibold" style={{ color: '#fb57ff' }}>{sortedPools.length}</span> of{" "}
          <span className="font-semibold" style={{ color: '#fb57ff' }}>{pools.length}</span> pools
        </p>

        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
      
          {/* Create Pool Button */}
          <button
            onClick={() => {
              if (!connected) {
                showInfo("Please connect your wallet to create a pool");
                return;
              }
              setShowCreatePoolModal(true);
            }}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px] font-semibold"
            style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Create Pool</span>
          </button>

          {/* Compact Toggle */}
          {viewMode === "grid" && (
            <button
              onClick={() => setCompactCards(!compactCards)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px]"
              title={compactCards ? "Expand cards" : "Compact cards"}
            >
              <span>{compactCards ? '⬇️' : '⬆️'}</span>
              <span className="hidden sm:inline">{compactCards ? 'Expand' : 'Compact'}</span>
            </button>
          )}

          {/* View Toggle Button */}
          <button
            onClick={toggleViewMode}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px]"
            title={viewMode === "grid" ? "Switch to List View" : "Switch to Grid View"}
            aria-label={viewMode === "grid" ? "Switch to List View" : "Switch to Grid View"}
          >
            {viewMode === "grid" ? (
              <>
                <List className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">List</span>
              </>
            ) : (
              <>
                <Grid3x3 className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Grid</span>
              </>
            )}
          </button>

          {/* Show Ended Toggle */}
          <button
            onClick={() => setShowEnded(!showEnded)}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/[0.05] border rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px] text-white"
            style={{ borderColor: showEnded ? '#fb57ff' : 'rgba(255,255,255,0.05)' }}
          >
            <span style={{ color: showEnded ? '#fb57ff' : '#6b7280' }}>●</span>
            <span className="hidden sm:inline">{showEnded ? 'Hide Ended' : 'Show Ended'}</span>
          </button>

          {/* Toggle Filters Button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px]"
            aria-label="Toggle filters panel"
          >
            <SlidersHorizontal className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Filters</span>
            {hasActiveFilters && (
              <span className="text-white text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#fb57ff' }}>
                {[filterType !== "all", filterFeatured, aprMin > 0 || aprMax < 1000, searchQuery !== ""].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filters Section */}
      {showFilters && (
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4 sm:p-6 mb-4 sm:mb-6 animate-in slide-in-from-top duration-300">
          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
            <input
              type="text"
              placeholder="Search pools by name or symbol..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 sm:pl-12 pr-10 sm:pr-12 py-2.5 sm:py-3 bg-white/[0.02] border border-white/[0.05] rounded-lg text-white placeholder-gray-600 focus:outline-none transition-colors text-sm sm:text-base min-h-[48px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors active:scale-90"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}
          </div>

          {/* Filter Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
            <div>
              <label className="block text-xs sm:text-sm text-gray-400 mb-2 font-medium">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#1a1a1a] border border-white/[0.05] rounded-lg text-white focus:outline-none transition-colors text-sm sm:text-base min-h-[48px] cursor-pointer [&>option]:bg-[#1a1a1a] [&>option]:text-white"
              >
                <option value="az">A → Z</option>
                <option value="za">Z → A</option>
                <option value="rate">Highest Rate</option>
                <option value="newest">Newest First</option>
              </select>
            </div>

            <div>
              <label className="block text-xs sm:text-sm text-gray-400 mb-2 font-medium">Pool Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#1a1a1a] border border-white/[0.05] rounded-lg text-white focus:outline-none transition-colors text-sm sm:text-base min-h-[48px] cursor-pointer [&>option]:bg-[#1a1a1a] [&>option]:text-white"
              >
                <option value="all">All Pools</option>
                <option value="locked">Locked Only</option>
                <option value="unlocked">Flexible Only</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs sm:text-sm text-gray-400 mb-2 font-medium">Min APR (%)</label>
              <input
                type="number"
                min="0"
                max={aprMax}
                value={aprMin}
                onChange={(e) => setAprMin(Number(e.target.value))}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/[0.02] border border-white/[0.05] rounded-lg text-white focus:outline-none transition-colors text-sm sm:text-base min-h-[48px]"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs sm:text-sm text-gray-400 mb-2 font-medium">Max APR (%)</label>
              <input
                type="number"
                min={aprMin}
                max="999999999"
                value={aprMax}
                onChange={(e) => setAprMax(Number(e.target.value))}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/[0.02] border border-white/[0.05] rounded-lg text-white focus:outline-none transition-colors text-sm sm:text-base min-h-[48px]"
              />
            </div>
          </div>

          {/* Featured Toggle & Clear Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <label className="flex items-center gap-2 sm:gap-3 cursor-pointer bg-white/[0.02] px-4 py-3 rounded-lg hover:bg-white/[0.04] transition-colors border border-white/[0.05] flex-1 sm:flex-initial min-h-[48px]">
              <input
                type="checkbox"
                checked={filterFeatured}
                onChange={(e) => setFilterFeatured(e.target.checked)}
                className="w-4 h-4 sm:w-5 sm:h-5 rounded border-white/[0.1] cursor-pointer"
                style={{ accentColor: '#fb57ff' }}
              />
              <span className="text-sm sm:text-base text-white font-medium">Featured Only <span style={{ color: '#fb57ff' }}>⭐</span></span>
            </label>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg font-semibold transition-all active:scale-95 text-sm sm:text-base min-h-[48px]"
              >
                <X className="w-4 h-4" />
                Clear Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Featured Pools */}
      {(featuredLoading || isPoolDataLoading || featuredPools.length > 0) && (
        <div className="mb-6 sm:mb-8">
          <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>🔥</span> Trending Pools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(featuredLoading || isPoolDataLoading || featuredPools.length < 3) ? (
              [
                { label: 'Most Popular', emoji: '\uD83D\uDD25' },
                { label: 'Newest Pool', emoji: '\uD83C\uDD95' },
                { label: 'Active Now', emoji: '\u26A1' },
              ].map((cat) => (
                <div
                  key={cat.label}
                  className="relative p-[1px] rounded-xl overflow-visible"
                  style={{ background: 'linear-gradient(135deg, #fb57ff, #00d4ff)' }}
                >
                  <div className="relative bg-[#0a0a0f] rounded-xl p-4">
                    <div 
                      className="absolute -top-2 -left-0.5 px-2 py-0.5 rounded-full flex items-center justify-center gap-1 text-[10px] font-bold text-black shadow-lg whitespace-nowrap z-10 w-[108px]"
                      style={{ background: '#fb57ff', boxShadow: '0 0 10px rgba(251, 87, 255, 0.4)' }}
                    >
                      {cat.emoji} {cat.label}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-white/[0.05] animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-24 bg-white/[0.05] rounded animate-pulse" />
                        <div className="h-3 w-16 bg-white/[0.05] rounded animate-pulse" />
                      </div>
                      <div className="text-right space-y-2">
                        <div className="h-5 w-16 bg-white/[0.05] rounded animate-pulse ml-auto" />
                        <div className="h-3 w-8 bg-white/[0.05] rounded animate-pulse ml-auto" />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              featuredPools.map((pool) => (
                <Link
                  key={pool.id}
                  href={`/pool/${pool.id}`}
                  className="group relative p-[1px] rounded-xl overflow-visible block hover:scale-[1.02] transition-transform"
                  style={{ background: 'linear-gradient(135deg, #fb57ff, #00d4ff)' }}
                >
                  <div className="relative bg-[#0a0a0f] rounded-xl p-4 h-full group-hover:bg-[#0f0f15] transition-colors">
                    {'categoryLabel' in pool && (
                      <div 
                        className="absolute -top-2 -left-0.5 px-2 py-0.5 rounded-full flex items-center justify-center gap-1 text-[10px] font-bold text-black shadow-lg whitespace-nowrap z-10 w-[108px]"
                        style={{ background: '#fb57ff', boxShadow: '0 0 10px rgba(251, 87, 255, 0.4)' }}
                      >
                        {(pool as any).categoryEmoji} {(pool as any).categoryLabel}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      {pool.logo ? (
                        <img
                          src={pool.logo}
                          alt={pool.symbol}
                          className="w-12 h-12 rounded-full ring-2 ring-[#fb57ff]/40"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm"
                          style={{ background: 'rgba(251, 87, 255, 0.2)', color: '#fb57ff' }}
                        >
                          {pool.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-white text-sm truncate">{pool.name}</p>
                        <p className="text-xs text-gray-400">{pool.symbol}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold" style={{ color: '#fb57ff' }}>
                          {getPoolRate(pool).toFixed(2)}%
                        </p>
                        <p className="text-xs text-gray-400 uppercase">
                          {pool.apy ? 'APY' : 'APR'}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pools Grid/List */}
      {sortedPools.length === 0 ? (
        <div className="text-center py-12 sm:py-16">
          <div className="text-5xl sm:text-6xl mb-4">🔍</div>
          <p className="text-lg sm:text-xl text-white mb-2 font-semibold">No pools found</p>
          <p className="text-sm sm:text-base text-gray-600 mb-4">Try adjusting your filters to see more results</p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-4 sm:px-6 py-2.5 sm:py-3 text-white rounded-lg font-semibold transition-all active:scale-95 shadow-lg text-sm sm:text-base min-h-[48px]"
              style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
            >
              Clear All Filters
            </button>
          )}
        </div>
      ) : viewMode === "grid" ? (
        // GRID VIEW
        <>
          <div className="grid gap-4 sm:gap-5 lg:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedPools.map((pool) => (
              <PoolCard 
                key={pool.id}
                {...pool}
                poolId={pool.poolId}
                tokenMint={pool.tokenMint}
                lockPeriod={pool.lockPeriod}
                showPoolNumber={poolCountByToken[pool.tokenMint] > 1}
                totalPoolsForToken={poolCountByToken[pool.tokenMint]}
                verified={pool.verified}
                compact={compactCards}
                engine={pool.engine || 'legacy'}
                rewardTokenMint={pool.rewardTokenMint || undefined}
                isLPPool={pool.isLPPool || false}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6 sm:mt-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-10 px-3 flex items-center justify-center rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white"
              >
                Previous
              </button>
              {(() => {
                const windowSize = 4;
                let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
                let end = Math.min(totalPages, start + windowSize - 1);
                if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i);
              })().map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg text-sm font-semibold transition-all border ${
                    currentPage === page
                      ? 'text-white border-transparent'
                      : 'bg-white/[0.05] hover:bg-white/[0.08] text-gray-400 border-white/[0.05]'
                  }`}
                  style={currentPage === page ? { background: 'linear-gradient(45deg, black, #fb57ff)' } : {}}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-10 px-3 flex items-center justify-center rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white"
              >
                Next
              </button>
            </div>
          )}
          {nonFeaturedPools.length > 0 && (
            <p className="text-center text-sm text-gray-500 mt-3">
              Showing {(currentPage - 1) * POOLS_PER_PAGE + 1} to {Math.min(currentPage * POOLS_PER_PAGE, nonFeaturedPools.length)} of {nonFeaturedPools.length} pools
            </p>
          )}
        </>
      ) : (
        // LIST VIEW
        <>
          <div className="space-y-2">
            {paginatedPools.map((pool) => {
              const project = getPoolProject(pool.tokenMint, pool.poolId);
              const lockPeriodDays = project?.lockupSeconds 
                ? Math.floor((project.lockupSeconds.toNumber?.() || project.lockupSeconds) / 86400)
                : pool.lockPeriod || 0;
              const poolEndTime = project?.poolEndTime?.toNumber?.() || project?.poolEndTime;
              const now = Math.floor(Date.now() / 1000);
              const remainingSeconds = poolEndTime ? Math.max(0, poolEndTime - now) : null;
              const daysRemaining = remainingSeconds ? remainingSeconds / 86400 : null;
              
              return (
                <div
                  key={pool.id}
                  className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.05] rounded-lg transition-all"
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(251, 87, 255, 0.3)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                >
                  {/* DESKTOP: Horizontal compact row */}
                  <div 
                    className="hidden sm:flex items-center justify-between p-4 cursor-pointer"
                    onClick={() => window.location.href = `/pool/${pool.id}`}
                  >
                    {/* Logo + Name */}
                    <div className="flex items-center gap-3 w-[240px] flex-shrink-0">
                      {pool.logo ? (
                        <img
                          src={pool.logo}
                          alt={pool.name}
                          className="w-10 h-10 rounded-full flex-shrink-0"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: 'rgba(251, 87, 255, 0.2)' }}>
                          {pool.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-sm truncate">{pool.name}</p>
                        <p className="text-gray-400 text-xs truncate">{pool.symbol}</p>
                      </div>
                    </div>

                    {/* Type */}
                    <div className="w-[60px] flex-shrink-0 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${pool.type === "locked" ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"}`}>
                        {pool.type === "locked" ? "🔒" : "🔓"}
                      </span>
                    </div>

                    {/* APR */}
                    <div className="text-center w-[100px] flex-shrink-0">
                      <p className="font-bold text-sm" style={{ color: '#fb57ff' }}>{getPoolRate(pool).toFixed(2)}%</p>
                      <p className="text-gray-400 text-xs">APR</p>
                    </div>

                    {/* Lock Period */}
                    <div className="text-center w-[90px] flex-shrink-0">
                      <p className="text-white text-sm">
                        {pool.type === "locked" 
                          ? (lockPeriodDays > 0 ? `${lockPeriodDays}d` : 'Flex')
                          : 'Flex'}
                      </p>
                      <p className="text-gray-400 text-xs">Lock</p>
                    </div>

                    {/* Ends */}
                    <div className="text-center w-[100px] flex-shrink-0">
                      {!poolEndTime ? (
                        <>
                          <p className="text-white text-sm">∞</p>
                          <p className="text-gray-400 text-xs">Ends</p>
                        </>
                      ) : remainingSeconds === 0 ? (
                        <>
                          <p className="text-red-400 text-sm">Ended</p>
                          <p className="text-gray-400 text-xs">🔴</p>
                        </>
                      ) : (
                        <>
                          <p className={`text-sm ${daysRemaining! < 1 ? 'text-red-400' : daysRemaining! < 7 ? 'text-yellow-400' : 'text-white'}`}>
                            {Math.floor(remainingSeconds / 86400)}d
                          </p>
                          <p className="text-gray-400 text-xs">Ends</p>
                        </>
                      )}
                    </div>

                    {/* Total Staked */}
                    <div className="text-right w-[120px] flex-shrink-0">
                      {(() => {
                        const decimals = getDecimals(pool.tokenMint);
                        if (!project?.totalStaked) return (
                          <>
                            <p className="text-white text-sm">{isPoolDataLoading ? '...' : '0'}</p>
                            <p className="text-gray-400 text-xs">Staked</p>
                          </>
                        );
                        const totalStaked = Number(project.totalStaked.toString()) / Math.pow(10, decimals);
                        return (
                          <>
                            <p className="text-white text-sm">
                              {totalStaked >= 1000000 ? `${(totalStaked / 1000000).toFixed(2)}M` : totalStaked >= 1000 ? `${(totalStaked / 1000).toFixed(2)}K` : totalStaked.toFixed(2)}
                            </p>
                            <p className="text-gray-400 text-xs">{pool.symbol}</p>
                          </>
                        );
                      })()}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 w-[280px] flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => window.location.href = `/pool/${pool.id}?action=stake`} className="flex-1 px-3 py-2 text-xs font-semibold text-white rounded-lg" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>Stake</button>
                      <button onClick={() => window.location.href = `/pool/${pool.id}?action=unstake`} className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Unstake</button>
                      <button onClick={() => window.location.href = `/pool/${pool.id}?action=claim`} className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Claim</button>
                    </div>
                  </div>

                  {/* MOBILE: Vertical layout */}
                  <div className="sm:hidden">
                    <div className="p-4 cursor-pointer" onClick={() => window.location.href = `/pool/${pool.id}`}>
                      <div className="flex items-center gap-3 mb-3">
                        {pool.logo ? (
                          <img
                            src={pool.logo}
                            alt={pool.name}
                            className="w-12 h-12 rounded-full"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ background: 'rgba(251, 87, 255, 0.2)' }}>{pool.symbol.slice(0, 2)}</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-white font-bold truncate">{pool.name}</p>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${pool.type === "locked" ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"}`}>
                              {pool.type === "locked" ? "🔒" : "🔓"}
                            </span>
                          </div>
                          <p className="text-gray-400 text-sm">{pool.symbol}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg" style={{ color: '#fb57ff' }}>{getPoolRate(pool).toFixed(2)}%</p>
                          <p className="text-gray-400 text-xs">APR</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-gray-400 text-xs mb-1">Lock Period</p>
                          <p className="text-white font-medium">
                            {pool.type === "locked" 
                              ? (lockPeriodDays > 0 ? `${lockPeriodDays} days` : 'Flexible')
                              : 'Flexible'}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs mb-1">Pool Ends</p>
                          {!poolEndTime ? <p className="text-white font-medium">No limit</p> : remainingSeconds === 0 ? <p className="text-red-400 font-medium">Ended</p> : <p className={`font-medium ${daysRemaining! < 1 ? 'text-red-400' : daysRemaining! < 7 ? 'text-yellow-400' : 'text-white'}`}>{Math.floor(remainingSeconds / 86400)}d {Math.floor((remainingSeconds % 86400) / 3600)}h</p>}
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-400 text-xs mb-1">Total Staked</p>
                          {(() => {
                            const decimals = getDecimals(pool.tokenMint);
                            if (!project?.totalStaked) return <p className="text-white font-medium">{isPoolDataLoading ? 'Loading...' : `0 ${pool.symbol}`}</p>;
                            const totalStaked = Number(project.totalStaked.toString()) / Math.pow(10, decimals);
                            return <p className="text-white font-medium">{totalStaked >= 1000000 ? `${(totalStaked / 1000000).toFixed(2)}M` : totalStaked >= 1000 ? `${(totalStaked / 1000).toFixed(2)}K` : totalStaked.toFixed(2)} {pool.symbol}</p>;
                          })()}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-white/[0.05] p-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => window.location.href = `/pool/${pool.id}?action=stake`} className="flex-1 px-3 py-2.5 text-sm font-semibold text-white rounded-lg" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>Stake</button>
                      <button onClick={() => window.location.href = `/pool/${pool.id}?action=unstake`} className="flex-1 px-3 py-2.5 text-sm font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Unstake</button>
                      <button onClick={() => window.location.href = `/pool/${pool.id}?action=claim`} className="flex-1 px-3 py-2.5 text-sm font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Claim</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6 sm:mt-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-10 px-3 flex items-center justify-center rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white"
              >
                Previous
              </button>
              {(() => {
                const windowSize = 4;
                let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
                let end = Math.min(totalPages, start + windowSize - 1);
                if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i);
              })().map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg text-sm font-semibold transition-all border ${
                    currentPage === page
                      ? 'text-white border-transparent'
                      : 'bg-white/[0.05] hover:bg-white/[0.08] text-gray-400 border-white/[0.05]'
                  }`}
                  style={currentPage === page ? { background: 'linear-gradient(45deg, black, #fb57ff)' } : {}}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-10 px-3 flex items-center justify-center rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white"
              >
                Next
              </button>
            </div>
          )}
          {nonFeaturedPools.length > 0 && (
            <p className="text-center text-sm text-gray-500 mt-3">
              Showing {(currentPage - 1) * POOLS_PER_PAGE + 1} to {Math.min(currentPage * POOLS_PER_PAGE, nonFeaturedPools.length)} of {nonFeaturedPools.length} pools
            </p>
          )}
        </>
      )}
            
      {/* Create Pool Modal */}
      {showCreatePoolModal && (
        <CreatePoolModal
          onClose={() => setShowCreatePoolModal(false)}
          onSuccess={() => {
            setShowCreatePoolModal(false);
            showSuccess("✅ Pool created successfully! Refreshing...");
            setTimeout(() => window.location.reload(), 1500);
          }}
        />
      )}
    </div>
  );
}
