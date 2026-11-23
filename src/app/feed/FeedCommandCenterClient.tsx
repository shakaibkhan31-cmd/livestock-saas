'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import FeedActionFormsClient from './FeedActionFormsClient'

type ActiveAnimalRow = {
  id: string
  tag_id: string
  species: string
  ownership?: string | null
  client_name?: string | null
  acquisition_date?: string | null
}

interface FeedCommandCenterClientProps {
  farmName: string
  role: string
  isAdmin: boolean
  todayStr: string
  speciesOptions: string[]
  dynamicFeedSuggestions: string[]
  allFeedLogs: Array<Record<string, any>>
  activeAnimals: ActiveAnimalRow[]
  thresholdByFeedName: Record<string, number>
  initialSpeciesFilter: string
  initialEntryType: string
  initialAllocFilter: string
  initialSearchQuery: string
  initialFromDate: string
  initialToDate: string
  initialLowOnly: boolean
  initialSplitDate: string
  statusMsg: string
  errorMsg: string
  undoPayload: string
  addFeedLogAction: (formData: FormData) => void | Promise<void>
  deleteFeedLogAction: (formData: FormData) => void | Promise<void>
  restoreFeedLogAction: (formData: FormData) => void | Promise<void>
  adjustFeedStockAction: (formData: FormData) => void | Promise<void>
  allocateFeedCostAction: (formData: FormData) => void | Promise<void>
  updateFeedThresholdAction: (formData: FormData) => void | Promise<void>
}

interface FeedStockSummaryItem {
  key: string
  feedName: string
  species: string
  purchasedKg: number
  consumedKg: number
  remainingKg: number
  avgRatePerKg: number
  remainingValue: number
  thresholdKg: number
  isLow: boolean
}

function formatDateDDMMYYYY(dateInput?: string | null): string {
  if (!dateInput) return 'N/A'
  const datePart = String(dateInput).split('T')[0]
  const parts = datePart.split('-')
  if (parts.length === 3) {
    const [year, month, day] = parts
    return `${day}/${month}/${year}`
  }
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 'N/A'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

export default function FeedCommandCenterClient({
  farmName,
  role,
  isAdmin,
  todayStr,
  speciesOptions,
  dynamicFeedSuggestions,
  allFeedLogs,
  activeAnimals,
  thresholdByFeedName,
  initialSpeciesFilter,
  initialEntryType,
  initialAllocFilter,
  initialSearchQuery,
  initialFromDate,
  initialToDate,
  initialLowOnly,
  initialSplitDate,
  statusMsg,
  errorMsg,
  undoPayload,
  addFeedLogAction,
  deleteFeedLogAction,
  restoreFeedLogAction,
  adjustFeedStockAction,
  allocateFeedCostAction,
  updateFeedThresholdAction,
}: FeedCommandCenterClientProps) {
  const router = useRouter()

  const [speciesFilter, setSpeciesFilter] = useState<string>(initialSpeciesFilter || 'All')
  const [entryTypeFilter, setEntryTypeFilter] = useState<string>(initialEntryType || 'All')
  const [allocFilter, setAllocFilter] = useState<string>(initialAllocFilter || 'All')
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery || '')
  const [fromDate, setFromDate] = useState<string>(initialFromDate || '')
  const [toDate, setToDate] = useState<string>(initialToDate || '')
  const [lowOnly, setLowOnly] = useState<boolean>(Boolean(initialLowOnly))
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 15

  const defaultAllocSpecies =
    speciesFilter !== 'All' ? speciesFilter : speciesOptions[0] || 'Goat'
  const [allocateSpecies, setAllocateSpecies] = useState<string>(defaultAllocSpecies)
  const [splitMethod, setSplitMethod] = useState<'equal' | 'weight'>('equal')
  const [allocationDate, setAllocationDate] = useState<string>(initialSplitDate || todayStr)
  const [periodLabel, setPeriodLabel] = useState<string>('Consumption Ration Allocation')
  const [isAllocating, setIsAllocating] = useState<boolean>(false)

  const thresholdFeedList = useMemo(() => {
    const names = new Set<string>(dynamicFeedSuggestions)
    allFeedLogs.forEach(l => {
      const n = String(l.feed_type || '').trim()
      if (n) names.add(n)
    })
    return Array.from(names).sort()
  }, [dynamicFeedSuggestions, allFeedLogs])

  const [selectedThresholdFeed, setSelectedThresholdFeed] = useState<string>(
    thresholdFeedList[0] || 'Mineral Mixture & DCP'
  )
  const [thresholdInputKg, setThresholdInputKg] = useState<string>(() => {
    const initialFeed = thresholdFeedList[0] || 'Mineral Mixture & DCP'
    const val = thresholdByFeedName[initialFeed.trim().toLowerCase()]
    return val !== undefined ? String(val) : ''
  })
  const [isSavingThreshold, setIsSavingThreshold] = useState<boolean>(false)

  const handleSelectThresholdFeed = (feedName: string) => {
    setSelectedThresholdFeed(feedName)
    const val = thresholdByFeedName[feedName.trim().toLowerCase()]
    setThresholdInputKg(val !== undefined ? String(val) : '')
  }

  const stockSummaryList = useMemo<FeedStockSummaryItem[]>(() => {
    const grouped: Record<
      string,
      {
        key: string
        feedName: string
        species: string
        purchasedKg: number
        purchasedCost: number
        consumedKg: number
      }
    > = {}

    for (const log of allFeedLogs) {
      const feedName = String(log.feed_type || '').trim()
      if (!feedName) continue
      const species = String(log.target_species || 'Goat').trim() || 'Goat'
      if (speciesFilter !== 'All' && species !== speciesFilter) continue

      const key = `${species.toLowerCase()}::${feedName.toLowerCase()}`
      if (!grouped[key]) {
        grouped[key] = {
          key,
          feedName,
          species,
          purchasedKg: 0,
          purchasedCost: 0,
          consumedKg: 0,
        }
      }

      const qty = Number(log.quantity_kg) || 0
      const cost = Number(log.total_cost) || 0

      if (log.entry_type === 'Purchase' || !log.entry_type) {
        grouped[key].purchasedKg += qty
        grouped[key].purchasedCost += cost
      } else {
        grouped[key].consumedKg += qty
      }
    }

    return Object.values(grouped)
      .map(item => {
        const remainingKg = Number((item.purchasedKg - item.consumedKg).toFixed(2))
        const avgRatePerKg =
          item.purchasedKg > 0 ? Number((item.purchasedCost / item.purchasedKg).toFixed(2)) : 0
        const remainingValue = Math.round(Math.max(0, remainingKg) * avgRatePerKg)
        const feedKey = item.feedName.trim().toLowerCase()
        const thresholdKg = thresholdByFeedName[feedKey] ?? 0
        const isLow = remainingKg <= thresholdKg

        return {
          key: item.key,
          feedName: item.feedName,
          species: item.species,
          purchasedKg: Number(item.purchasedKg.toFixed(2)),
          consumedKg: Number(item.consumedKg.toFixed(2)),
          remainingKg,
          avgRatePerKg,
          remainingValue,
          thresholdKg,
          isLow,
        }
      })
      .sort((a, b) => a.feedName.localeCompare(b.feedName))
  }, [allFeedLogs, speciesFilter, thresholdByFeedName])

  const lowStockItems = useMemo(
    () => stockSummaryList.filter(item => item.isLow),
    [stockSummaryList]
  )

  const displayedStockCards = useMemo(
    () => (lowOnly ? lowStockItems : stockSummaryList),
    [lowOnly, lowStockItems, stockSummaryList]
  )

  const pendingPoolLogs = useMemo(() => {
    return allFeedLogs.filter(l => {
      if (l.entry_type !== 'Consumption') return false
      if (Boolean(l.is_allocated)) return false
      const cost = Number(l.total_cost) || 0
      if (cost <= 0) return false
      if (allocateSpecies !== 'Shared (All Species)') {
        return String(l.target_species || 'Goat') === allocateSpecies
      }
      return true
    })
  }, [allFeedLogs, allocateSpecies])

  const pendingPoolTotalCost = useMemo(
    () => pendingPoolLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0),
    [pendingPoolLogs]
  )

  const eligibleAnimalsForSplit = useMemo(() => {
    const latestConsDate =
      pendingPoolLogs
        .map(l => String(l.log_date || '').split('T')[0])
        .filter(Boolean)
        .sort()
        .pop() || allocationDate

    return activeAnimals.filter(a => {
      const matchesSpecies =
        allocateSpecies === 'Shared (All Species)' || a.species === allocateSpecies
      if (!matchesSpecies) return false
      if (!a.acquisition_date) return true
      const acqStr = String(a.acquisition_date).split('T')[0]
      return acqStr <= latestConsDate
    })
  }, [activeAnimals, allocateSpecies, pendingPoolLogs, allocationDate])

  const filteredLogs = useMemo(() => {
    const qLower = searchQuery.trim().toLowerCase()
    const lowStockNames = new Set(lowStockItems.map(i => i.feedName.trim().toLowerCase()))

    return allFeedLogs.filter(log => {
      const sp = String(log.target_species || 'Goat')
      if (speciesFilter !== 'All' && sp !== speciesFilter) return false

      const eType = log.entry_type === 'Consumption' ? 'Consumption' : 'Purchase'
      if (entryTypeFilter !== 'All' && eType !== entryTypeFilter) return false

      if (eType === 'Consumption') {
        const isAlloc = Boolean(log.is_allocated)
        if (allocFilter === 'Pending' && isAlloc) return false
        if (allocFilter === 'Allocated' && !isAlloc) return false
      } else if (allocFilter !== 'All') {
        return false
      }

      const logDateStr = String(log.log_date || '').split('T')[0]
      if (fromDate && logDateStr && logDateStr < fromDate) return false
      if (toDate && logDateStr && logDateStr > toDate) return false

      if (lowOnly) {
        const fKey = String(log.feed_type || '').trim().toLowerCase()
        if (!lowStockNames.has(fKey)) return false
      }

      if (qLower) {
        const haystack = [
          log.feed_type,
          log.target_species,
          log.entry_type,
          log.notes,
        ]
          .map(v => String(v || '').toLowerCase())
          .join(' ')
        if (!haystack.includes(qLower)) return false
      }

      return true
    })
  }, [
    allFeedLogs,
    speciesFilter,
    entryTypeFilter,
    allocFilter,
    fromDate,
    toDate,
    lowOnly,
    lowStockItems,
    searchQuery,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedLogs = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredLogs.slice(start, start + pageSize)
  }, [filteredLogs, safePage])

  const totalRemainingStockKg = useMemo(
    () =>
      Number(
        stockSummaryList.reduce((s, item) => s + Math.max(0, item.remainingKg), 0).toFixed(2)
      ),
    [stockSummaryList]
  )

  const totalRemainingStockValue = useMemo(
    () => stockSummaryList.reduce((s, item) => s + item.remainingValue, 0),
    [stockSummaryList]
  )

  const totalPendingPoolAllSpecies = useMemo(
    () =>
      allFeedLogs
        .filter(
          l =>
            l.entry_type === 'Consumption' &&
            !Boolean(l.is_allocated) &&
            (Number(l.total_cost) || 0) > 0
        )
        .reduce((s, l) => s + (Number(l.total_cost) || 0), 0),
    [allFeedLogs]
  )

  const defaultFormSpecies =
    speciesFilter !== 'All' ? speciesFilter : speciesOptions[0] || 'Goat'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6">
      <datalist id="common-feeds">
        {dynamicFeedSuggestions.map(item => (
          <option key={item} value={item} />
        ))}
      </datalist>

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                Feed &amp; Ration Command Center
              </h1>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {farmName}
              </span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase">
                {role}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Manage bulk ration purchases, physical stock adjustments, low-stock thresholds, and animal cost splits.
            </p>
          </div>
        </div>

        {/* Status & Error Banners */}
        {statusMsg && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium">{statusMsg}</span>
            {undoPayload && isAdmin && (
              <form action={restoreFeedLogAction}>
                <input type="hidden" name="undoPayload" value={undoPayload} />
                <button
                  type="submit"
                  className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition"
                >
                  Undo Delete
                </button>
              </form>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm font-medium">
            {errorMsg}
          </div>
        )}

        {/* Low Stock Alert Banner */}
        {lowStockItems.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Low Stock Alert ({lowStockItems.length} item{lowStockItems.length > 1 ? 's' : ''})
              </p>
              <p className="text-xs text-amber-800">
                {lowStockItems
                  .map(i => `${i.feedName} (${i.remainingKg} kg / Min ${i.thresholdKg} kg)`)
                  .join(' • ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLowOnly(prev => !prev)
                setCurrentPage(1)
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition shrink-0"
            >
              {lowOnly ? 'Show All Stock' : 'Filter Low Stock'}
            </button>
          </div>
        )}

        {/* Top Summary KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Live Ration Stock
            </p>
            <p className="text-xl font-bold font-mono text-slate-900 mt-1">
              {totalRemainingStockKg.toLocaleString()} kg
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Est. Value: Rs. {totalRemainingStockValue.toLocaleString()}
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Pending Split Pool (All Species)
            </p>
            <p className="text-xl font-bold font-mono text-amber-700 mt-1">
              Rs. {totalPendingPoolAllSpecies.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Unallocated consumption costs ready to split
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Low Stock Items
            </p>
            <p className="text-xl font-bold font-mono text-rose-700 mt-1">
              {lowStockItems.length}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              At or below configured minimum stock threshold
            </p>
          </div>
        </div>

        {/* Main 12-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Columns: Purchase & Stock Adjustment Forms */}
          <FeedActionFormsClient
            speciesOptions={speciesOptions}
            defaultSpecies={defaultFormSpecies}
            todayStr={todayStr}
            isAdmin={isAdmin}
            addFeedLogAction={addFeedLogAction}
            adjustFeedStockAction={adjustFeedStockAction}
          />

          {/* Right 7 Columns: Live Shed Ration Stock, Thresholds, Allocation & Ledger */}
          <div className="lg:col-span-7 space-y-6">
            {/* Live Shed Ration Stock Cards */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Live Shed Ration Stock</h2>
                  <p className="text-[11px] text-slate-500">
                    Remaining physical balance per feed item vs. configured minimum stock
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={speciesFilter}
                    onChange={e => {
                      setSpeciesFilter(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800"
                  >
                    <option value="All">All Species</option>
                    {speciesOptions.map(sp => (
                      <option key={sp} value={sp}>
                        {sp}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setLowOnly(prev => !prev)
                      setCurrentPage(1)
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      lowOnly
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    Low Only
                  </button>
                </div>
              </div>

              {displayedStockCards.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  No ration stock items match the selected filter.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayedStockCards.map(item => (
                    <div
                      key={item.key}
                      className={`p-3.5 rounded-xl border transition ${
                        item.isLow
                          ? 'bg-rose-50/70 border-rose-200'
                          : 'bg-slate-50 border-slate-200/90'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-slate-900">{item.feedName}</p>
                          <p className="text-[11px] text-slate-500">{item.species}</p>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            item.isLow
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {item.isLow ? 'LOW STOCK' : 'OK'}
                        </span>
                      </div>

                      <div className="mt-2.5 flex items-baseline justify-between">
                        <span className="text-base font-bold font-mono text-slate-900">
                          {item.remainingKg.toLocaleString()} kg
                        </span>
                        <span className="text-[11px] font-mono text-slate-600">
                          Min: {item.thresholdKg} kg
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Avg Rate: Rs. {item.avgRatePerKg.toLocaleString()}/kg</span>
                        <span>Val: Rs. {item.remainingValue.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Low Stock Thresholds Section (Admin Editable / Staff Read-Only) */}
            <div
              id="thresholds-panel"
              className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-4"
            >
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">Low Stock Thresholds</h2>
                <p className="text-[11px] text-slate-500">
                  {isAdmin
                    ? 'Configure minimum stock (kg) per feed item. Alerts and low-stock filters use these thresholds.'
                    : 'View minimum stock (kg) thresholds configured for each feed item.'}
                </p>
              </div>

              {isAdmin && (
                <form
                  action={updateFeedThresholdAction}
                  onSubmit={() => setIsSavingThreshold(true)}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end bg-slate-50 p-3.5 rounded-xl border border-slate-200"
                >
                  <div className="sm:col-span-6">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Feed Item
                    </label>
                    <select
                      name="feed_name"
                      value={selectedThresholdFeed}
                      disabled={isSavingThreshold}
                      onChange={e => handleSelectThresholdFeed(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
                    >
                      {thresholdFeedList.map(feedName => (
                        <option key={feedName} value={feedName}>
                          {feedName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Min Stock (kg)
                    </label>
                    <input
                      name="min_stock_kg"
                      type="number"
                      step="0.1"
                      min="0"
                      required
                      value={thresholdInputKg}
                      disabled={isSavingThreshold}
                      onChange={e => setThresholdInputKg(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono text-slate-900"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={isSavingThreshold}
                      className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition"
                    >
                      {isSavingThreshold ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </form>
              )}

              <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200/80 rounded-xl">
                {thresholdFeedList.map(feedName => {
                  const key = feedName.trim().toLowerCase()
                  const minKg = thresholdByFeedName[key] ?? 0
                  return (
                    <div
                      key={feedName}
                      className="px-3.5 py-2 flex items-center justify-between text-xs bg-white hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-800">{feedName}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-slate-900">
                          {minKg} kg
                        </span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleSelectThresholdFeed(feedName)}
                            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Pending Consumption Pool & Split Form */}
            {isAdmin && (
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Split Pending Consumption Pool
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Allocate unallocated consumption costs to active eligible animals
                    </p>
                  </div>
                  <span className="text-xs font-bold font-mono px-3 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                    Pool: Rs. {pendingPoolTotalCost.toLocaleString()}
                  </span>
                </div>

                <form
                  action={allocateFeedCostAction}
                  onSubmit={() => setIsAllocating(true)}
                  className="space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Species
                      </label>
                      <select
                        name="allocate_species"
                        value={allocateSpecies}
                        disabled={isAllocating}
                        onChange={e => setAllocateSpecies(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
                      >
                        {speciesOptions.map(sp => (
                          <option key={sp} value={sp}>
                            {sp}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Split Method
                      </label>
                      <select
                        name="split_method"
                        value={splitMethod}
                        disabled={isAllocating}
                        onChange={e =>
                          setSplitMethod(e.target.value === 'weight' ? 'weight' : 'equal')
                        }
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
                      >
                        <option value="equal">Equal Per Head</option>
                        <option value="weight">By Live Weight (kg)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Allocation Date
                      </label>
                      <input
                        name="allocation_date"
                        type="date"
                        required
                        value={allocationDate}
                        disabled={isAllocating}
                        onChange={e => setAllocationDate(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Period / Batch Label
                    </label>
                    <input
                      name="period_label"
                      type="text"
                      value={periodLabel}
                      disabled={isAllocating}
                      onChange={e => setPeriodLabel(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                    <span>Eligible Active Animals: {eligibleAnimalsForSplit.length}</span>
                    <span>
                      Est. Share:{' '}
                      {eligibleAnimalsForSplit.length > 0
                        ? `~Rs. ${Math.round(
                            pendingPoolTotalCost / eligibleAnimalsForSplit.length
                          ).toLocaleString()}/head`
                        : 'Rs. 0'}
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={isAllocating || pendingPoolTotalCost <= 0}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition"
                  >
                    {isAllocating ? 'Splitting...' : 'Split Pending Consumption Pool'}
                  </button>
                </form>
              </div>
            )}

            {/* Feed Ledger Table */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Feed Ledger</h2>
                  <p className="text-[11px] text-slate-500">
                    Showing {filteredLogs.length} entr{filteredLogs.length === 1 ? 'y' : 'ies'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={entryTypeFilter}
                    onChange={e => {
                      setEntryTypeFilter(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800"
                  >
                    <option value="All">All Types</option>
                    <option value="Purchase">Purchase</option>
                    <option value="Consumption">Consumption</option>
                  </select>

                  <select
                    value={allocFilter}
                    onChange={e => {
                      setAllocFilter(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800"
                  >
                    <option value="All">All Split Status</option>
                    <option value="Pending">Pending Split</option>
                    <option value="Allocated">Allocated / Write-off</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                  placeholder="Search item or notes..."
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => {
                    setFromDate(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={e => {
                    setToDate(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 px-2">Item</th>
                      <th className="py-2 px-2">Type</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2 text-right">Cost</th>
                      <th className="py-2 px-2">Status / Notes</th>
                      {isAdmin && <th className="py-2 pl-2 text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isAdmin ? 7 : 6}
                          className="py-6 text-center text-slate-500"
                        >
                          No feed log entries found.
                        </td>
                      </tr>
                    ) : (
                      paginatedLogs.map(row => {
                        const isCons = row.entry_type === 'Consumption'
                        const notesStr = String(row.notes || '')
                        const isWriteOffRow =
                          isCons && notesStr.toLowerCase().startsWith('write-off:')
                        const statusLabel = !isCons
                          ? 'Stock In'
                          : isWriteOffRow
                          ? 'Stock Out — Write-off'
                          : row.is_allocated
                          ? 'Allocated'
                          : 'Pending Split'

                        return (
                          <tr key={row.id} className="hover:bg-slate-50/80">
                            <td className="py-2.5 pr-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {formatDateDDMMYYYY(row.log_date)}
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="font-semibold text-slate-900">{row.feed_type}</div>
                              <div className="text-[10px] text-slate-500">
                                {row.target_species || 'Goat'}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 whitespace-nowrap">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isCons
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                }`}
                              >
                                {row.entry_type || 'Purchase'}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                              {Number(row.quantity_kg || 0).toFixed(1)} kg
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                              Rs. {Number(row.total_cost || 0).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-2 max-w-[210px]">
                              <div className="text-[10px] font-semibold text-slate-700">
                                {statusLabel}
                              </div>
                              {notesStr && (
                                <div className="text-[11px] text-slate-500 truncate" title={notesStr}>
                                  {notesStr}
                                </div>
                              )}
                            </td>
                            {isAdmin && (
                              <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                                <form action={deleteFeedLogAction}>
                                  <input type="hidden" name="logId" value={row.id} />
                                  <button
                                    type="submit"
                                    onClick={() => {
                                      router.refresh()
                                    }}
                                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-800"
                                  >
                                    Delete
                                  </button>
                                </form>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2 text-xs text-slate-600">
                  <span>
                    Page {safePage} of {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}