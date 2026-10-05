"use client";

import { useState, useEffect, useMemo } from "react";
import PoolCard from "@/components/PoolCard";
import { useToast } from "@/components/ToastContainer";
import { PoolCardSkeleton } from "@/components/SkeletonLoaders";
import { Search, X, SlidersHorizontal, Grid3x3, List, Plus } from "lucide-react";
import Link from "next/link";
import { usePoolData } from "@/hooks/usePoolData";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDebounce } from 'use-debounce';
import dynamic from 'next/dynamic';
const CreateFarmModal = dynamic(() => import('@/components/CreateFarmModal'), { ssr: false });

type Farm = {
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
  safetyScore?: number | null;
  safetyDetails?: string | null;
  featuredOrder?: number;
  engine?: string;
  rewardTokenMint?: string | null;
  rewardTokenSymbol?: string | null;
  lpUrl?: string | null;
  lpPoolId?: string | null;
  lpDex?: string | null;
  isLPPool?: boolean;
};

export default function FarmingClient({ farms }: { farms: Farm[] }) {
  const [sortBy, setSortBy] = useState<"az" | "za" | "rate" | "newest">("az");
  const [filterType, setFilterType] = useState<"all" | "locked" | "unlocked">("all");
  const [filterFeatured, setFilterFeatured] = useState(false);
  const [aprMin, setAprMin] = useState<number>(0);
  const [aprMax, setAprMax] = useState<number>(Infinity);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [compactCards, setCompactCards] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const FARMS_PER_PAGE = 6;
  const [showCreateFarmModal, setShowCreateFarmModal] = useState(false);

  const { showInfo } = useToast();
  const { connected } = useWallet();

  const { loadPoolsData, loadAllPoolData, getPoolProject, getDecimals, isPoolDataLoading } = usePoolData();
  const [dynamicRates, setDynamicRates] = useState<Map<string, number>>(new Map());
  const [stakerCounts, setStakerCounts] = useState<Record<string, number>>({});
  const [latestActivity, setLatestActivity] = useState<Record<string, string>>({});
  const [featuredLoading, setFeaturedLoading] = useState(true);

  useEffect(() => {
    const loadSequentially = async () => {
      const uniqueMints = [...new Set([...farms.map(p => p.tokenMint), ...farms.map(p => p.rewardTokenMint)].filter(Boolean))];
      if (uniqueMints.length > 0) {
        await loadPoolsData(uniqueMints);
      }
      
      await new Promise(r => setTimeout(r, 500));
      
      const farmInfos = farms.map(p => ({ tokenMint: p.tokenMint, poolId: p.poolId, engine: 'current' }));
      if (farmInfos.length > 0) {
        await loadAllPoolData(farmInfos);
      }
    };
    
    loadSequentially();

    fetch("/api/pool-stakers")
      .then(res => res.ok ? res.json() : { stakerCounts: {}, latestActivity: {} })
      .then(data => {
        setStakerCounts(data.stakerCounts || {});
        setLatestActivity(data.latestActivity || {});
      })
      .catch(() => {})
      .finally(() => setFeaturedLoading(false));
  }, [farms, loadPoolsData, loadAllPoolData]);

  useEffect(() => {
    if (farms.length === 0) return;
    
    const rates = new Map<string, number>();
    
    farms.forEach(farm => {
      const project = getPoolProject(farm.tokenMint, farm.poolId);
      if (!project) {
        const rate = Number(farm.apr ?? farm.apy ?? 0);
        rates.set(farm.id, rate);
        return;
      }
      
      const poolEndTime = project.poolEndTime?.toNumber?.() || project.poolEndTime || null;
      const now = Math.floor(Date.now() / 1000);
      if (poolEndTime && poolEndTime < now) {
        rates.set(farm.id, 0);
        return;
      }
      
      if (project.rateMode === 0) {
        const rate = project.rateBpsPerYear?.toNumber?.() 
          ? project.rateBpsPerYear.toNumber() / 100 
          : (project.rateBpsPerYear || 0) / 100;
        rates.set(farm.id, rate);
      } else if (farm.engine !== 'current') {
        const rewardRatePerSecond = BigInt(project.rewardRatePerSecond?.toString() || '0');
        const totalStaked = BigInt(project.totalStaked?.toString() || '1');
        
        if (totalStaked > 0n && rewardRatePerSecond > 0n) {
          const SECONDS_PER_YEAR = 31_536_000;
          const annualRewards = rewardRatePerSecond * BigInt(SECONDS_PER_YEAR);
          const apr = Number((annualRewards * 10000n) / totalStaked) / 100;
          rates.set(farm.id, apr);
        } else {
          rates.set(farm.id, 0);
        }
      }
    });
    
    setDynamicRates(rates);
  }, [farms, getPoolProject, isPoolDataLoading]);

  useEffect(() => {
    const savedView = localStorage.getItem("farmsViewMode");
    if (savedView === "list" || savedView === "grid") {
      setViewMode(savedView);
    }
  }, []);

  const toggleViewMode = () => {
    const newMode = viewMode === "grid" ? "list" : "grid";
    setViewMode(newMode);
    localStorage.setItem("farmsViewMode", newMode);
  };

  const filteredFarms = useMemo(() => {
    return farms.filter((farm) => {
      if (filterType !== "all" && farm.type !== filterType) return false;
      const project = getPoolProject(farm.tokenMint, farm.poolId);
      const poolEndTime = project?.poolEndTime?.toNumber?.() || project?.poolEndTime || null;
      const now = Math.floor(Date.now() / 1000);
      const isEnded = poolEndTime && poolEndTime < now;
      if (!showEnded && isEnded) return false;
      if (filterFeatured && !farm.featured) return false;

      const rate = dynamicRates.get(farm.id) ?? Number(farm.apr ?? farm.apy ?? 0);
      if (rate < aprMin || (aprMax !== Infinity && rate > aprMax)) return false;

      if (debouncedSearch) {
        const query = debouncedSearch.toLowerCase();
        const matchesName = farm.name.toLowerCase().includes(query);
        const matchesSymbol = farm.symbol.toLowerCase().includes(query);
        if (!matchesName && !matchesSymbol) return false;
      }

      return true;
    });
  }, [farms, filterType, filterFeatured, aprMin, aprMax, debouncedSearch, dynamicRates, showEnded, getPoolProject]);

  const sortedFarms = useMemo(() => {
    return [...filteredFarms].sort((a, b) => {
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
  }, [filteredFarms, sortBy, dynamicRates]);

  const farmCountByToken = useMemo(() => {
    return farms.reduce((acc, farm) => {
      const key = farm.tokenMint;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [farms]);

  const featuredFarms = useMemo(() => {
    const eligible = sortedFarms.filter(f => {
      const rate = dynamicRates.get(f.id) ?? Number(f.apr ?? f.apy ?? 0);
      return rate > 0;
    });
    const featured: (Farm & { categoryLabel?: string; categoryEmoji?: string })[] = [];
    const usedIds = new Set<string>();

    const withStakers = eligible
      .map(f => ({ ...f, _stakers: stakerCounts[`${f.tokenMint}:${f.poolId || 0}`] || 0 }))
      .filter(f => f._stakers > 0)
      .sort((a, b) => b._stakers - a._stakers);
    if (withStakers[0]) {
      const { _stakers, ...farm } = withStakers[0];
      featured.push({ ...farm, categoryLabel: 'Most Popular', categoryEmoji: '\uD83D\uDD25' });
      usedIds.add(farm.id);
    }

    const newest = eligible
      .filter(f => !usedIds.has(f.id) && f.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    if (newest[0]) {
      featured.push({ ...newest[0], categoryLabel: 'Newest Farm', categoryEmoji: '\uD83C\uDD95' });
      usedIds.add(newest[0].id);
    }

    const withActivity = eligible
      .filter(f => !usedIds.has(f.id) && latestActivity[f.id])
      .sort((a, b) => new Date(latestActivity[b.id] || 0).getTime() - new Date(latestActivity[a.id] || 0).getTime());
    if (withActivity[0]) {
      featured.push({ ...withActivity[0], categoryLabel: 'Active Now', categoryEmoji: '\u26A1' });
      usedIds.add(withActivity[0].id);
    }

    return featured;
  }, [sortedFarms, dynamicRates, stakerCounts, latestActivity]);

  const totalPages = Math.ceil(sortedFarms.length / FARMS_PER_PAGE);

  const paginatedFarms = useMemo(() => {
    const start = (currentPage - 1) * FARMS_PER_PAGE;
    return sortedFarms.slice(start, start + FARMS_PER_PAGE);
  }, [sortedFarms, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, filterFeatured, aprMin, aprMax, debouncedSearch, sortBy, showEnded]);

  useEffect(() => {
    if (currentPage > 1) {
      document.getElementById('farms-directory')?.scrollIntoView({ behavior: 'smooth' });
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

  const getFarmRate = (farm: Farm): number => {
    return dynamicRates.get(farm.id) ?? Number(farm.apr ?? farm.apy ?? 0);
  };

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
          LP Farms
        </h2>
        <p className="text-xs sm:text-sm text-gray-400 mb-4">
          Stake LP tokens and earn reward tokens. Provide liquidity, stake your LP, and earn.
        </p>
      </div>

      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <p className="text-sm sm:text-base text-gray-400 sm:hidden">
          Showing <span className="font-semibold" style={{ color: '#fb57ff' }}>{sortedFarms.length}</span> of{" "}
          <span className="font-semibold" style={{ color: '#fb57ff' }}>{farms.length}</span> farms
        </p>

        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <button
            onClick={() => {
              if (!connected) {
                showInfo("Please connect your wallet to create a farm");
                return;
              }
              setShowCreateFarmModal(true);
            }}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px] font-semibold"
            style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Create Farm</span>
          </button>
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

          <button
            onClick={() => setShowEnded(!showEnded)}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/[0.05] border rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px] text-white"
            style={{ borderColor: showEnded ? '#fb57ff' : 'rgba(255,255,255,0.05)' }}
          >
            <span style={{ color: showEnded ? '#fb57ff' : '#6b7280' }}>●</span>
            <span className="hidden sm:inline">{showEnded ? 'Hide Ended' : 'Show Ended'}</span>
          </button>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] rounded-lg transition-all active:scale-95 text-sm sm:text-base flex-1 sm:flex-initial min-h-[44px]"
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

      {showFilters && (
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-4 sm:p-6 mb-4 sm:mb-6 animate-in slide-in-from-top duration-300">
          {/* Search Bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 sm:w-5 sm:h-5" />
            <input
              type="text"
              placeholder="Search farms by name or symbol..."
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
              <label className="block text-xs sm:text-sm text-gray-400 mb-2 font-medium">Farm Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#1a1a1a] border border-white/[0.05] rounded-lg text-white focus:outline-none transition-colors text-sm sm:text-base min-h-[48px] cursor-pointer [&>option]:bg-[#1a1a1a] [&>option]:text-white"
              >
                <option value="all">All Farms</option>
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

      {/* Trending Farms */}
      {(featuredLoading || featuredFarms.length > 0) && (
        <div className="mb-6 sm:mb-8">
          <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>🔥</span> Trending Farms
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {featuredLoading ? (
              [
                { label: 'Most Popular', emoji: '\uD83D\uDD25' },
                { label: 'Newest Farm', emoji: '\uD83C\uDD95' },
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
              featuredFarms.map((farm) => (
                <Link
                  key={farm.id}
                  href={`/pool/${farm.id}`}
                  className="group relative p-[1px] rounded-xl overflow-visible block hover:scale-[1.02] transition-transform"
                  style={{ background: 'linear-gradient(135deg, #fb57ff, #00d4ff)' }}
                >
                  <div className="relative bg-[#0a0a0f] rounded-xl p-4 h-full group-hover:bg-[#0f0f15] transition-colors">
                    {'categoryLabel' in farm && (
                      <div
                        className="absolute -top-2 -left-0.5 px-2 py-0.5 rounded-full flex items-center justify-center gap-1 text-[10px] font-bold text-black shadow-lg whitespace-nowrap z-10 w-[108px]"
                        style={{ background: '#fb57ff', boxShadow: '0 0 10px rgba(251, 87, 255, 0.4)' }}
                      >
                        {(farm as any).categoryEmoji} {(farm as any).categoryLabel}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      {farm.logo ? (
                        <img
                          src={farm.logo}
                          alt={farm.symbol}
                          className="w-12 h-12 rounded-full ring-2 ring-[#fb57ff]/40"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm"
                          style={{ background: 'rgba(251, 87, 255, 0.2)', color: '#fb57ff' }}
                        >
                          {farm.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-white text-sm truncate">{farm.name}</p>
                        <p className="text-xs text-gray-400">{farm.symbol} → {farm.rewardTokenSymbol || farm.rewards || farm.symbol}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold" style={{ color: '#fb57ff' }}>
                          {getFarmRate(farm) > 0 ? `${getFarmRate(farm).toFixed(2)}%` : 'Dynamic'}
                        </p>
                        <p className="text-xs text-gray-400 uppercase">APR</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}

      {/* Farm Cards */}
      {sortedFarms.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🌾</div>
          <h3 className="text-xl font-bold text-white mb-2">No Farms Available Yet</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            LP farms are a new feature. Check back soon for available farms or create one for your project.
          </p>
          <button
            onClick={() => {
              if (!connected) {
                showInfo("Please connect your wallet to create a farm");
                return;
              }
              setShowCreateFarmModal(true);
            }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(45deg, #fb57ff, #9333ea)' }}
          >
            <Plus className="w-4 h-4" />
            Create a Farm
          </button>
        </div>
      ) : (
        <>
          {viewMode === "grid" ? (
            <div className="grid gap-4 sm:gap-5 lg:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedFarms.map((farm) => (
                <PoolCard
                  key={farm.id}
                  id={farm.id}
                  poolId={farm.poolId}
                  tokenMint={farm.tokenMint}
                  name={farm.name}
                  symbol={farm.symbol}
                  apr={String(dynamicRates.get(farm.id) ?? farm.apr ?? farm.apy ?? "0")}
                  type={farm.type}
                  lockPeriod={farm.lockPeriod ?? undefined}
                  totalStaked={String(farm.totalStaked ?? 0)}
                  rewards={farm.rewards ?? undefined}
                  logo={farm.logo ?? undefined}
                  pairAddress={farm.pairAddress ?? undefined}
                  mintAddress={farm.tokenMint}
                  hasSelfReflections={farm.hasSelfReflections}
                  hasExternalReflections={farm.hasExternalReflections}
                  externalReflectionMint={farm.externalReflectionMint ?? undefined}
                  reflectionTokenAccount={farm.reflectionTokenAccount ?? undefined}
                  reflectionTokenSymbol={farm.reflectionTokenSymbol ?? undefined}
                  verified={farm.verified}
                  safetyScore={farm.safetyScore}
                  safetyDetails={farm.safetyDetails}
                  showPoolNumber={farmCountByToken[farm.tokenMint] > 1}
                  totalPoolsForToken={farmCountByToken[farm.tokenMint]}
                  compact={compactCards}
                  engine="current"
                  rewardTokenMint={farm.rewardTokenMint ?? undefined}
                  lpUrl={(farm as any).lpUrl}
                  lpPoolId={(farm as any).dexPoolAddress}
                  lpDex={(farm as any).dexType}
                  isLPPool={true}
                  isInitialized={(farm as any).isInitialized ?? true}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedFarms.map((farm) => {
                const project = getPoolProject(farm.tokenMint, farm.poolId);
                const lockPeriodDays = project?.lockupSeconds 
                  ? Math.floor((project.lockupSeconds.toNumber?.() || project.lockupSeconds) / 86400)
                  : farm.lockPeriod || 0;
                const poolEndTime = project?.poolEndTime?.toNumber?.() || project?.poolEndTime;
                const now = Math.floor(Date.now() / 1000);
                const remainingSeconds = poolEndTime ? Math.max(0, poolEndTime - now) : null;
                const daysRemaining = remainingSeconds ? remainingSeconds / 86400 : null;
                const farmRate = dynamicRates.get(farm.id) ?? Number(farm.apr ?? farm.apy ?? 0);

                return (
                  <div
                    key={farm.id}
                    className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.05] rounded-lg transition-all"
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(251, 87, 255, 0.3)'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = ''}
                  >
                    {/* DESKTOP */}
                    <div className="hidden sm:flex items-center justify-between p-4 cursor-pointer" onClick={() => window.location.href = `/pool/${farm.id}`}>
                      <div className="flex items-center gap-3 w-[240px] flex-shrink-0">
                        {farm.logo ? (
                          <img src={farm.logo} alt={farm.name} className="w-10 h-10 rounded-full flex-shrink-0" loading="lazy" decoding="async" />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: 'rgba(251, 87, 255, 0.2)' }}>{farm.symbol.slice(0, 2)}</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-semibold text-sm truncate">{farm.name}</p>
                          <p className="text-gray-400 text-xs truncate">{farm.symbol} → {farm.rewardTokenSymbol || farm.rewards || farm.symbol}</p>
                        </div>
                      </div>
                      <div className="w-[60px] flex-shrink-0 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${farm.type === "locked" ? "bg-orange-500/20 text-orange-400" : "bg-green-500/20 text-green-400"}`}>
                          {farm.type === "locked" ? "🔒" : "🔓"}
                        </span>
                      </div>
                      <div className="text-center w-[100px] flex-shrink-0">
                        <p className="font-bold text-sm" style={{ color: '#fb57ff' }}>{farmRate > 0 ? `${farmRate.toFixed(2)}%` : 'Dynamic'}</p>
                        <p className="text-gray-400 text-xs">APR</p>
                      </div>
                      <div className="text-center w-[90px] flex-shrink-0">
                        <p className="text-white text-sm">{farm.type === "locked" ? (lockPeriodDays > 0 ? `${lockPeriodDays}d` : 'Flex') : 'Flex'}</p>
                        <p className="text-gray-400 text-xs">Lock</p>
                      </div>
                      <div className="text-center w-[100px] flex-shrink-0">
                        {!poolEndTime ? (
                          <><p className="text-white text-sm">∞</p><p className="text-gray-400 text-xs">Ends</p></>
                        ) : remainingSeconds === 0 ? (
                          <><p className="text-red-400 text-sm">Ended</p><p className="text-gray-400 text-xs">🔴</p></>
                        ) : (
                          <><p className={`text-sm ${daysRemaining! < 1 ? 'text-red-400' : daysRemaining! < 7 ? 'text-yellow-400' : 'text-white'}`}>{Math.floor(remainingSeconds / 86400)}d</p><p className="text-gray-400 text-xs">Ends</p></>
                        )}
                      </div>
                      <div className="text-right w-[120px] flex-shrink-0">
                        {(() => {
                          const decimals = getDecimals(farm.tokenMint);
                          if (!project?.totalStaked) return (<><p className="text-white text-sm">{isPoolDataLoading ? '...' : '0'}</p><p className="text-gray-400 text-xs">Staked</p></>);
                          const totalStaked = Number(project.totalStaked.toString()) / Math.pow(10, decimals);
                          return (<><p className="text-white text-sm">{totalStaked >= 1000000 ? `${(totalStaked / 1000000).toFixed(2)}M` : totalStaked >= 1000 ? `${(totalStaked / 1000).toFixed(2)}K` : totalStaked.toFixed(2)}</p><p className="text-gray-400 text-xs">{farm.symbol}</p></>);
                        })()}
                      </div>
                      <div className="flex gap-2 w-[280px] flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => window.location.href = `/pool/${farm.id}?action=stake`} className="flex-1 px-3 py-2 text-xs font-semibold text-white rounded-lg" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>Stake</button>
                        <button onClick={() => window.location.href = `/pool/${farm.id}?action=unstake`} className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Unstake</button>
                        <button onClick={() => window.location.href = `/pool/${farm.id}?action=claim`} className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Claim</button>
                      </div>
                    </div>
                    {/* MOBILE */}
                    <div className="sm:hidden">
                      <div className="p-4 cursor-pointer" onClick={() => window.location.href = `/pool/${farm.id}`}>
                        <div className="flex items-center gap-3 mb-3">
                          {farm.logo ? (
                            <img src={farm.logo} alt={farm.name} className="w-12 h-12 rounded-full" loading="lazy" decoding="async" />
                          ) : (
                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ background: 'rgba(251, 87, 255, 0.2)' }}>{farm.symbol.slice(0, 2)}</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-bold truncate">{farm.name}</p>
                            <p className="text-gray-400 text-sm">{farm.symbol} → {farm.rewardTokenSymbol || farm.rewards || farm.symbol}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg" style={{ color: '#fb57ff' }}>{farmRate > 0 ? `${farmRate.toFixed(2)}%` : 'Dynamic'}</p>
                            <p className="text-gray-400 text-xs">APR</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-gray-400 text-xs mb-1">Lock Period</p>
                            <p className="text-white font-medium">{farm.type === "locked" ? (lockPeriodDays > 0 ? `${lockPeriodDays} days` : 'Flexible') : 'Flexible'}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-xs mb-1">Farm Ends</p>
                            {!poolEndTime ? <p className="text-white font-medium">No limit</p> : remainingSeconds === 0 ? <p className="text-red-400 font-medium">Ended</p> : <p className={`font-medium ${daysRemaining! < 1 ? 'text-red-400' : daysRemaining! < 7 ? 'text-yellow-400' : 'text-white'}`}>{Math.floor(remainingSeconds / 86400)}d {Math.floor((remainingSeconds % 86400) / 3600)}h</p>}
                          </div>
                          <div className="col-span-2">
                            <p className="text-gray-400 text-xs mb-1">Total Staked</p>
                            {(() => {
                              const decimals = getDecimals(farm.tokenMint);
                              if (!project?.totalStaked) return <p className="text-white font-medium">{isPoolDataLoading ? 'Loading...' : `0 ${farm.symbol}`}</p>;
                              const totalStaked = Number(project.totalStaked.toString()) / Math.pow(10, decimals);
                              return <p className="text-white font-medium">{totalStaked >= 1000000 ? `${(totalStaked / 1000000).toFixed(2)}M` : totalStaked >= 1000 ? `${(totalStaked / 1000).toFixed(2)}K` : totalStaked.toFixed(2)} {farm.symbol}</p>;
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-white/[0.05] p-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => window.location.href = `/pool/${farm.id}?action=stake`} className="flex-1 px-3 py-2.5 text-sm font-semibold text-white rounded-lg" style={{ background: 'linear-gradient(45deg, black, #fb57ff)' }}>Stake</button>
                        <button onClick={() => window.location.href = `/pool/${farm.id}?action=unstake`} className="flex-1 px-3 py-2.5 text-sm font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Unstake</button>
                        <button onClick={() => window.location.href = `/pool/${farm.id}?action=claim`} className="flex-1 px-3 py-2.5 text-sm font-semibold text-white bg-white/[0.05] border border-white/[0.05] rounded-lg">Claim</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6 sm:mt-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white min-h-[40px]"
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
                    currentPage === page
                      ? 'text-white'
                      : 'bg-white/[0.05] hover:bg-white/[0.08] text-gray-400'
                  }`}
                  style={currentPage === page ? { background: 'linear-gradient(45deg, black, #fb57ff)' } : {}}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.05] text-white min-h-[40px]"
              >
                Next
              </button>
            </div>
          )}
          {sortedFarms.length > 0 && (
            <p className="text-center text-sm text-gray-500 mt-3">
              Showing {(currentPage - 1) * FARMS_PER_PAGE + 1} to {Math.min(currentPage * FARMS_PER_PAGE, sortedFarms.length)} of {sortedFarms.length} farms
            </p>
          )}
        </>
      )}
      {showCreateFarmModal && (
        <CreateFarmModal
          onClose={() => setShowCreateFarmModal(false)}
          onSuccess={() => {
            setShowCreateFarmModal(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}