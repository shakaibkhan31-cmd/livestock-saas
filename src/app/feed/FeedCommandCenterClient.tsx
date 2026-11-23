'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SplitEngineClient from './SplitEngineClient'
import FeedActionFormsClient from './FeedActionFormsClient'

type ActiveAnimalRow = {
  id: string
  tag_id: string
  species: string
  ownership?: string | null
  client_name?: string | null
  acquisition_date?: string | null
}

type FeedLogRow = Record<string, any>

interface FeedCommandCenterClientProps {
  farmName: string
  role: string
  isAdmin: boolean
  todayStr: string
  speciesOptions: string[]
  dynamicFeedSuggestions: string[]
  allFeedLogs: FeedLogRow[]
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
  addFeedLogAction: (formData: FormData) => Promise<void>
  deleteFeedLogAction: (formData: FormData) => Promise<void>
  restoreFeedLogAction: (formData: FormData) => Promise<void>
  adjustFeedStockAction: (formData: FormData) => Promise<void>
  allocateFeedCostAction: (formData: FormData) => Promise<void>
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

function formatDateTimeDDMMYYYY(dateInput?: string | null): string {
  if (!dateInput) return 'N/A'
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return formatDateDDMMYYYY(dateInput)
  const dateStr = formatDateDDMMYYYY(d.toISOString())
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d)
  return `${dateStr} at ${timeStr}`
}

function getWhatToDoNextHint(err: string): string {
  const lower = err.toLowerCase()
  if (lower.includes('increase') || lower.includes('purchase')) {
    return 'Record a New Purchase entry with the invoice cost so wallet and inventory stay balanced.'
  }
  if (lower.includes('weight')) {
    return 'Open Livestock Master, record the latest live weight for that tag, and retry the split.'
  }
  if (lower.includes('allocated')) {
    return 'Reverse the cost allocation from the animal financial ledger before deleting this log.'
  }
  if (lower.includes('unallocated') || lower.includes('consumption')) {
    return 'Log a stock consumption/write-off first so there is a pending consumption cost pool to split.'
  }
  return 'Review your input values and try again, or refresh the page to sync the latest ledger state.'
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
}: FeedCommandCenterClientProps) {
  const router = useRouter()

  // Filters & Table State
  const [selectedSpeciesFilter, setSelectedSpeciesFilter] = useState(initialSpeciesFilter)
  const [selectedEntryType, setSelectedEntryType] = useState(initialEntryType)
  const [selectedAllocFilter, setSelectedAllocFilter] = useState(initialAllocFilter)
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [fromDate, setFromDate] = useState(initialFromDate)
  const [toDate, setToDate] = useState(initialToDate)
  const [lowStockOnly, setLowStockOnly] = useState(initialLowOnly)
  const [sortBy, setSortBy] = useState<'date' | 'qty' | 'cost'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [restoringUndo, setRestoringUndo] = useState(false)
  const pageSize = 15

  // Toast State (5-second auto-dismiss for normal toasts, 10-second for Undo delete toast)
  const [toast, setToast] = useState<{
    type: 'success' | 'error'
    message: string
    undo?: string
  } | null>(() => {
    if (errorMsg) return { type: 'error', message: errorMsg }
    if (statusMsg) return { type: 'success', message: statusMsg, undo: undoPayload || undefined }
    return null
  })

  useEffect(() => {
    if (errorMsg) {
      setToast({ type: 'error', message: errorMsg })
    } else if (statusMsg) {
      setToast({ type: 'success', message: statusMsg, undo: undoPayload || undefined })
    }
  }, [statusMsg, errorMsg, undoPayload])

  useEffect(() => {
    if (!toast) return
    const duration = toast.undo ? 10000 : 5000
    const timer = setTimeout(() => {
      setToast(null)
    }, duration)
    return () => clearTimeout(timer)
  }, [toast])

  // Sync URL cleanly when filters change without full reload
  const updateUrlQuery = (overrides?: {
    species?: string
    entryType?: string
    alloc?: string
    q?: string
    from?: string
    to?: string
    lowOnly?: boolean
  }) => {
    const sp = new URLSearchParams()
    const s = overrides?.species ?? selectedSpeciesFilter
    const et = overrides?.entryType ?? selectedEntryType
    const al = overrides?.alloc ?? selectedAllocFilter
    const qVal = overrides?.q ?? searchQuery
    const fVal = overrides?.from ?? fromDate
    const tVal = overrides?.to ?? toDate
    const lVal = overrides?.lowOnly ?? lowStockOnly

    if (s && s !== 'All') sp.set('species', s)
    if (et && et !== 'All') sp.set('entryType', et)
    if (al && al !== 'All') sp.set('alloc', al)
    if (qVal.trim()) sp.set('q', qVal.trim())
    if (fVal) sp.set('from', fVal)
    if (tVal) sp.set('to', tVal)
    if (lVal) sp.set('lowOnly', '1')
    const qs = sp.toString()
    router.replace(qs ? `/feed?${qs}` : '/feed', { scroll: false })
  }

  // Species-level logs for KPIs & Live Shed Stock
  const speciesFeedLogs = useMemo(() => {
    return allFeedLogs.filter(log => {
      if (selectedSpeciesFilter === 'All') return true
      return (log.target_species || 'Goat') === selectedSpeciesFilter
    })
  }, [allFeedLogs, selectedSpeciesFilter])

  // Today's Checklist Status (1. Purchase -> 2. Consumption -> 3. Split)
  const hasTodayPurchase = useMemo(
    () =>
      allFeedLogs.some(
        l =>
          (l.entry_type === 'Purchase' || !l.entry_type) &&
          String(l.log_date || '').split('T')[0] === todayStr
      ),
    [allFeedLogs, todayStr]
  )

  const hasTodayConsumption = useMemo(
    () =>
      allFeedLogs.some(
        l =>
          l.entry_type === 'Consumption' &&
          String(l.log_date || '').split('T')[0] === todayStr
      ),
    [allFeedLogs, todayStr]
  )

  const hasTodaySplit = useMemo(
    () =>
      allFeedLogs.some(
        l =>
          l.entry_type === 'Consumption' &&
          l.is_allocated &&
          String(l.allocated_at || l.log_date || '').split('T')[0] === todayStr
      ),
    [allFeedLogs, todayStr]
  )

  // Pending Consumption Cost Pool grouped by Species
  const unallocatedBySpecies = useMemo(() => {
    const map: Record<string, { amount: number; billCount: number }> = {}
    allFeedLogs.forEach(l => {
      if (!l.is_allocated && l.entry_type === 'Consumption' && Number(l.total_cost) > 0) {
        const sp = String(l.target_species || 'Goat').trim()
        if (!map[sp]) {
          map[sp] = { amount: 0, billCount: 0 }
        }
        map[sp].amount += Number(l.total_cost) || 0
        map[sp].billCount += 1
      }
    })
    return map
  }, [allFeedLogs])

  const filteredUnallocatedPool = useMemo(
    () =>
      speciesFeedLogs
        .filter(l => !l.is_allocated && l.entry_type === 'Consumption' && Number(l.total_cost) > 0)
        .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0),
    [speciesFeedLogs]
  )

  const filteredUnallocatedBillsCount = useMemo(
    () =>
      speciesFeedLogs.filter(
        l => !l.is_allocated && l.entry_type === 'Consumption' && Number(l.total_cost) > 0
      ).length,
    [speciesFeedLogs]
  )

  const totalPurchasedSpend = useMemo(
    () =>
      speciesFeedLogs
        .filter(l => l.entry_type === 'Purchase' || !l.entry_type)
        .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0),
    [speciesFeedLogs]
  )

  // Live Shed Ration Stock (sorted with Low / Out of Stock first)
  const inventoryList = useMemo(() => {
    type StockSummary = {
      key: string
      species: string
      feedType: string
      purchasedKg: number
      consumedKg: number
      remainingKg: number
      totalPurchasedCost: number
      avgRatePerKg: number
      thresholdKg: number
    }

    const stockMap: Record<string, StockSummary> = {}
    speciesFeedLogs.forEach(log => {
      const sp = String(log.target_species || 'Goat').trim()
      const ft = String(log.feed_type || 'General Feed').trim()
      const key = `${sp}__${ft}`

      if (!stockMap[key]) {
        stockMap[key] = {
          key,
          species: sp,
          feedType: ft,
          purchasedKg: 0,
          consumedKg: 0,
          remainingKg: 0,
          totalPurchasedCost: 0,
          avgRatePerKg: 0,
          thresholdKg: thresholdByFeedName[ft.toLowerCase()] ?? 50,
        }
      }
      const qty = Number(log.quantity_kg) || 0
      const cost = Number(log.total_cost) || 0
      const type = log.entry_type || 'Purchase'

      if (type === 'Purchase') {
        stockMap[key].purchasedKg += qty
        stockMap[key].totalPurchasedCost += cost
      } else {
        stockMap[key].consumedKg += qty
      }
    })

    return Object.values(stockMap)
      .map(item => {
        const remainingKg = Number((item.purchasedKg - item.consumedKg).toFixed(2))
        const avgRatePerKg = item.purchasedKg > 0 ? item.totalPurchasedCost / item.purchasedKg : 0
        return {
          ...item,
          remainingKg,
          avgRatePerKg,
        }
      })
      .sort((a, b) => {
        const aLow = a.remainingKg <= a.thresholdKg ? 0 : 1
        const bLow = b.remainingKg <= b.thresholdKg ? 0 : 1
        if (aLow !== bLow) return aLow - bLow
        return a.remainingKg - b.remainingKg
      })
  }, [speciesFeedLogs, thresholdByFeedName])

  const displayedInventory = useMemo(() => {
    if (!lowStockOnly) return inventoryList
    return inventoryList.filter(i => i.remainingKg <= i.thresholdKg)
  }, [inventoryList, lowStockOnly])

  const lowStockCount = useMemo(
    () => inventoryList.filter(i => i.remainingKg <= i.thresholdKg).length,
    [inventoryList]
  )

  const totalRemainingStockKg = useMemo(
    () => inventoryList.reduce((sum, i) => sum + Math.max(i.remainingKg, 0), 0),
    [inventoryList]
  )

  // Active Animals per Species
  const activeSpeciesTabs = useMemo(
    () =>
      Array.from(
        new Set([
          ...activeAnimals.map(a => String(a.species || '')),
          ...allFeedLogs.map(l => String(l.target_species || 'Goat')),
        ])
      ).filter(Boolean),
    [activeAnimals, allFeedLogs]
  )

  const matchingActiveAnimals = useMemo(
    () =>
      activeAnimals.filter(a => {
        if (selectedSpeciesFilter === 'All' || selectedSpeciesFilter === 'Shared (All Species)') {
          return true
        }
        return a.species === selectedSpeciesFilter
      }),
    [activeAnimals, selectedSpeciesFilter]
  )

  const matchingCount = matchingActiveAnimals.length
  const estimatedShare = matchingCount > 0 ? Math.floor(filteredUnallocatedPool / matchingCount) : 0

  // Filtered + Sorted Ledger Logs
  const filteredAndSortedLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = allFeedLogs.filter(log => {
      if (selectedSpeciesFilter !== 'All' && (log.target_species || 'Goat') !== selectedSpeciesFilter) {
        return false
      }
      const isPurchase = log.entry_type === 'Purchase' || !log.entry_type

      if (selectedEntryType === 'Purchase' && !isPurchase) return false
      if (selectedEntryType === 'Consumption' && isPurchase) return false

      if (selectedAllocFilter === 'Pending' && log.is_allocated) return false
      if (selectedAllocFilter === 'Allocated' && !log.is_allocated) return false

      const logDateOnly = String(log.log_date || '').split('T')[0]
      if (fromDate && logDateOnly < fromDate) return false
      if (toDate && logDateOnly > toDate) return false

      if (!q) return true

      const haystack = [
        log.feed_type || '',
        log.target_species || 'Goat',
        log.notes || '',
        isPurchase ? 'stock in purchase' : 'stock out consumption',
        formatDateDDMMYYYY(log.log_date),
        String(log.quantity_kg || ''),
        String(log.total_cost || ''),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    })

    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'date') {
        const da = String(a.log_date || '')
        const db = String(b.log_date || '')
        cmp = da.localeCompare(db)
      } else if (sortBy === 'qty') {
        cmp = (Number(a.quantity_kg) || 0) - (Number(b.quantity_kg) || 0)
      } else if (sortBy === 'cost') {
        cmp = (Number(a.total_cost) || 0) - (Number(b.total_cost) || 0)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [
    allFeedLogs,
    selectedSpeciesFilter,
    selectedEntryType,
    selectedAllocFilter,
    fromDate,
    toDate,
    searchQuery,
    sortBy,
    sortDir,
  ])

  const totalFilteredCount = filteredAndSortedLogs.length
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedLogs = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredAndSortedLogs.slice(start, start + pageSize)
  }, [filteredAndSortedLogs, safePage])

  const pageTotalCost = useMemo(
    () => paginatedLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0),
    [paginatedLogs]
  )

  const filterTotalCost = useMemo(
    () => filteredAndSortedLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0),
    [filteredAndSortedLogs]
  )

  const toggleSort = (col: 'date' | 'qty' | 'cost') => {
    if (sortBy === col) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setCurrentPage(1)
  }

  // Quick Date Range Helpers
  const applyQuickDateRange = (preset: 'today' | 'week' | 'month') => {
    const base = new Date(`${todayStr}T00:00:00`)
    let from = todayStr
    if (preset === 'week') {
      const d = new Date(base)
      d.setDate(d.getDate() - 6)
      from = d.toISOString().split('T')[0]
    } else if (preset === 'month') {
      from = `${todayStr.slice(0, 8)}01`
    }
    setFromDate(from)
    setToDate(todayStr)
    setCurrentPage(1)
    updateUrlQuery({ from, to: todayStr })
  }

  const resetAllLedgerFilters = () => {
    setSelectedEntryType('All')
    setSelectedAllocFilter('All')
    setSearchQuery('')
    setFromDate('')
    setToDate('')
    setCurrentPage(1)
    updateUrlQuery({ entryType: 'All', alloc: 'All', q: '', from: '', to: '' })
  }

  // CSV Export for Filtered Ledger
  const handleExportCSV = () => {
    const headers = [
      'Date (DD/MM/YYYY)',
      'Feed Item',
      'Species',
      'Entry Type',
      'Quantity (kg)',
      'Total Cost (Rs.)',
      'Allocation Status',
      'Notes',
    ]

    const escapeCell = (val: unknown) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const rows = filteredAndSortedLogs.map(log => {
      const isPurchase = log.entry_type === 'Purchase' || !log.entry_type
      return [
        formatDateDDMMYYYY(log.log_date),
        log.feed_type || '',
        log.target_species || 'Goat',
        isPurchase ? 'Purchase' : 'Consumption',
        Number(log.quantity_kg || 0).toFixed(1),
        Number(log.total_cost || 0),
        isPurchase ? 'N/A' : log.is_allocated ? 'Allocated' : 'Pending Split',
        log.notes || '',
      ]
        .map(escapeCell)
        .join(',')
    })

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `feed-ledger-${selectedSpeciesFilter.toLowerCase()}-${todayStr}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const hasLedgerFilters =
    selectedEntryType !== 'All' ||
    selectedAllocFilter !== 'All' ||
    searchQuery.length > 0 ||
    fromDate.length > 0 ||
    toDate.length > 0

  return (
    <div className="min-h-screen bg-slate-50/80 py-7 px-4 sm:px-6 lg:px-8">
      <datalist id="common-feeds">
        {dynamicFeedSuggestions.map(item => (
          <option key={item} value={item} />
        ))}
      </datalist>

      {/* P0: Auto-Dismiss Top-Right Toast Notifications */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-5 right-5 z-50 w-full max-w-md rounded-2xl border p-4 shadow-xl transition-all ${
            toast.type === 'error'
              ? 'bg-rose-950 text-rose-50 border-rose-700'
              : 'bg-slate-900 text-white border-emerald-500/60'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 text-xs">
              <p className="font-bold uppercase tracking-wider text-[10px] text-emerald-400">
                {toast.type === 'error' ? 'Action Required' : 'Operation Completed'}
              </p>
              <p className="text-sm font-medium leading-snug">{toast.message}</p>
              {toast.type === 'error' && (
                <p className="text-[11px] text-rose-200 pt-1">
                  <strong>What to do next:</strong> {getWhatToDoNextHint(toast.message)}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {toast.type === 'success' && (
                  <a
                    href="#feed-ledger-section"
                    onClick={() => setToast(null)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] transition"
                  >
                    View Ledger
                  </a>
                )}
                {toast.undo && isAdmin && (
                  <form action={restoreFeedLogAction} onSubmit={() => setRestoringUndo(true)}>
                    <input type="hidden" name="undoPayload" value={toast.undo} />
                    <button
                      type="submit"
                      disabled={restoringUndo}
                      className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold text-[11px] transition"
                    >
                      {restoringUndo ? 'Restoring...' : 'Undo Delete (10s)'}
                    </button>
                  </form>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-white font-bold text-base leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-5">
        {/* Top Bar: Brand Header + Quick Jump Actions */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                {farmName} • {role.toUpperCase()}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                Feed Inventory &amp; Cost Allocation
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Feed Command Center
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="#purchase-panel"
              className="inline-flex items-center justify-center px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-xs transition text-xs"
            >
              + New Purchase
            </a>
            {isAdmin && (
              <a
                href="#adjustment-panel"
                className="inline-flex items-center justify-center px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-xs transition text-xs"
              >
                Stock Write-off
              </a>
            )}
            <Link
              href="/animals"
              className="inline-flex items-center justify-center px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl border border-slate-200 transition text-xs"
            >
              ← Livestock Master
            </Link>
          </div>
        </div>

        {/* P1 #5: Today's Checklist Banner */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Today&apos;s Workflow ({formatDateDDMMYYYY(todayStr)}):
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <a
              href="#purchase-panel"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border font-semibold transition ${
                hasTodayPurchase
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{hasTodayPurchase ? '✓' : '1.'}</span>
              <span>1. Purchase</span>
            </a>

            <span className="text-slate-300">→</span>

            <a
              href="#adjustment-panel"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border font-semibold transition ${
                hasTodayConsumption
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{hasTodayConsumption ? '✓' : '2.'}</span>
              <span>2. Consumption</span>
            </a>

            <span className="text-slate-300">→</span>

            <a
              href="#split-engine-section"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border font-semibold transition ${
                filteredUnallocatedPool > 0
                  ? 'bg-amber-50 text-amber-900 border-amber-300 ring-2 ring-amber-400/40'
                  : hasTodaySplit
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{filteredUnallocatedPool > 0 ? '!' : hasTodaySplit ? '✓' : '3.'}</span>
              <span>3. Split</span>
              {filteredUnallocatedPool > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded bg-amber-400 text-slate-950 text-[10px] font-bold">
                  Action Required
                </span>
              )}
            </a>
          </div>
        </div>

        {/* P1 #9: Species Filter Bar with Active Head Count + Pending Rs. */}
        <div className="bg-white px-3 py-2.5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2.5">
            Species:
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedSpeciesFilter('All')
              setCurrentPage(1)
              updateUrlQuery({ species: 'All' })
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              selectedSpeciesFilter === 'All'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All • {activeAnimals.length} heads
          </button>

          {activeSpeciesTabs.map(sp => {
            const headCount = activeAnimals.filter(a => a.species === sp).length
            const pendingAmt = unallocatedBySpecies[sp]?.amount || 0
            const isSelected = selectedSpeciesFilter === sp
            return (
              <button
                key={sp}
                type="button"
                onClick={() => {
                  setSelectedSpeciesFilter(sp)
                  setCurrentPage(1)
                  updateUrlQuery({ species: sp })
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200/70'
                }`}
              >
                <span>
                  {sp} • {headCount} heads
                  {pendingAmt > 0 ? ` • Rs. ${pendingAmt.toLocaleString()} pending` : ''}
                </span>
              </button>
            )
          })}
        </div>

        {/* P1 #7: Clickable Executive KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <button
            type="button"
            onClick={() => {
              setSelectedEntryType('Purchase')
              setSelectedAllocFilter('All')
              setCurrentPage(1)
              updateUrlQuery({ entryType: 'Purchase', alloc: 'All' })
              document.getElementById('feed-ledger-section')?.scrollIntoView({ behavior: 'smooth' })
            }}
            className="text-left bg-white p-4 rounded-2xl border border-slate-200/90 hover:border-slate-300 shadow-xs transition"
          >
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {selectedSpeciesFilter === 'All' ? 'Bulk Spend' : `${selectedSpeciesFilter} Spend`}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              Rs. {totalPurchasedSpend.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Click to filter purchase bills</p>
          </button>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between">
            <button
              type="button"
              onClick={() => {
                setLowStockOnly(false)
                updateUrlQuery({ lowOnly: false })
                document.getElementById('live-stock-strip')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="text-left"
            >
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Shed Stock
              </p>
              <p className="text-2xl font-bold text-emerald-600 mt-1 font-mono">
                {totalRemainingStockKg.toFixed(1)}{' '}
                <span className="text-xs font-sans font-semibold text-slate-400">kg</span>
              </p>
            </button>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                Across {inventoryList.length} item(s)
              </span>
              {lowStockCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !lowStockOnly
                    setLowStockOnly(next)
                    updateUrlQuery({ lowOnly: next })
                    document.getElementById('live-stock-strip')?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition ${
                    lowStockOnly
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  {lowStockCount} Low Stock
                </button>
              )}
            </div>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setSelectedEntryType('Consumption')
                setSelectedAllocFilter('Pending')
                setCurrentPage(1)
                updateUrlQuery({ entryType: 'Consumption', alloc: 'Pending' })
                document.getElementById('feed-ledger-section')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="text-left bg-amber-50/60 p-4 rounded-2xl border border-amber-200/90 hover:border-amber-400 shadow-xs transition"
            >
              <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                Pending Consumption Pool
              </p>
              <p className="text-2xl font-bold text-amber-700 mt-1 font-mono">
                Rs. {filteredUnallocatedPool.toLocaleString()}
              </p>
              <p className="text-[11px] text-amber-700/80 mt-0.5">
                {filteredUnallocatedPool === 0
                  ? 'All caught up. No pending Consumption to split.'
                  : `${filteredUnallocatedBillsCount} consumption item(s) • Click to view`}
              </p>
            </button>
          )}

          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Est. Share / Head
            </p>
            <p className="text-2xl font-bold text-indigo-600 mt-1 font-mono">
              Rs. {estimatedShare.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {matchingCount} active{' '}
              {selectedSpeciesFilter === 'All' ? 'head(s)' : `${selectedSpeciesFilter}(s)`}
            </p>
          </div>
        </div>

        {/* Tier 2: Automated Cost Split Engine */}
        {isAdmin && (
          <div id="split-engine-section">
            <SplitEngineClient
              speciesOptions={SPECIES_OPTIONS}
              activeAnimals={activeAnimals}
              unallocatedBySpecies={unallocatedBySpecies}
              selectedSpeciesFilter={selectedSpeciesFilter}
              initialSplitDate={initialSplitDate}
              allocateAction={allocateFeedCostAction}
            />
          </div>
        )}

        {/* P1 #8: Live Shed Ration Stock with Progress Bar & Low-Stock First Sorting */}
        {inventoryList.length > 0 && (
          <div
            id="live-stock-strip"
            className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5">
              <div>
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Live Shed Ration Stock
                </h2>
                <p className="text-[11px] text-slate-500">
                  Real-time balance per species &amp; ration item (Purchase minus Consumption)
                </p>
              </div>
              <div className="flex items-center gap-2">
                {lowStockOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setLowStockOnly(false)
                      updateUrlQuery({ lowOnly: false })
                    }}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                  >
                    Showing Low Stock Only ×
                  </button>
                )}
                <span className="text-[11px] font-mono text-slate-400">
                  {displayedInventory.length} of {inventoryList.length} items
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {displayedInventory.map(item => {
                const isOut = item.remainingKg <= 0
                const isLow = item.remainingKg <= item.thresholdKg
                const pct =
                  item.thresholdKg > 0
                    ? Math.min(100, Math.max(0, (item.remainingKg / item.thresholdKg) * 100))
                    : 100

                return (
                  <div
                    key={item.key}
                    className={`p-3 rounded-xl border transition ${
                      isOut
                        ? 'bg-rose-50/80 border-rose-400'
                        : isLow
                        ? 'bg-rose-50/50 border-rose-300'
                        : 'bg-slate-50/80 border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-white">
                        {item.species}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          isOut
                            ? 'bg-rose-600 text-white'
                            : isLow
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {isOut ? 'OUT OF STOCK' : isLow ? 'LOW' : 'OK'}
                      </span>
                    </div>

                    <p className="font-bold text-xs text-slate-900 mt-1.5 truncate" title={item.feedType}>
                      {item.feedType}
                    </p>

                    <div className="flex items-baseline justify-between mt-0.5">
                      <p className="text-base font-bold font-mono text-slate-900">
                        {item.remainingKg.toFixed(1)}{' '}
                        <span className="text-[10px] font-sans font-normal text-slate-500">kg</span>
                      </p>
                      <span className="text-[10px] font-mono text-slate-400">
                        / {item.thresholdKg} kg min
                      </span>
                    </div>

                    {/* Progress Bar: Remaining / Threshold */}
                    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1.5">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isOut ? 'bg-rose-600' : isLow ? 'bg-rose-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>
                        +{item.purchasedKg} / -{item.consumedKg}
                      </span>
                      {isAdmin && item.avgRatePerKg > 0 && (
                        <span className="font-semibold text-slate-700">
                          Rs.{Math.round(item.avgRatePerKg)}/kg
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Main Workspace: Left Ledger + Right Sticky Action Forms */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 Cols: Searchable, Filterable, Sortable & Responsive Transaction Ledger */}
          <div
            id="feed-ledger-section"
            className="lg:col-span-7 bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-slate-900 text-sm">
                    {selectedSpeciesFilter === 'All'
                      ? 'Purchase & Stock-Out Ledger'
                      : `${selectedSpeciesFilter} Feed Ledger`}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Page {safePage} of {totalPages} • {totalFilteredCount} matching record(s)
                  </p>
                </div>

                {/* Export CSV & Print Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 print:hidden">
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    disabled={filteredAndSortedLogs.length === 0}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition"
                  >
                    Print
                  </button>
                </div>
              </div>

              {/* Type & Allocation Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 print:hidden">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEntryType('All')
                    setSelectedAllocFilter('All')
                    setCurrentPage(1)
                    updateUrlQuery({ entryType: 'All', alloc: 'All' })
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    selectedEntryType === 'All' && selectedAllocFilter === 'All'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEntryType('Purchase')
                    setSelectedAllocFilter('All')
                    setCurrentPage(1)
                    updateUrlQuery({ entryType: 'Purchase', alloc: 'All' })
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    selectedEntryType === 'Purchase'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Stock In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEntryType('Consumption')
                    setSelectedAllocFilter('All')
                    setCurrentPage(1)
                    updateUrlQuery({ entryType: 'Consumption', alloc: 'All' })
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    selectedEntryType === 'Consumption' && selectedAllocFilter === 'All'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Stock Out
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextAlloc = selectedAllocFilter === 'Pending' ? 'All' : 'Pending'
                      setSelectedEntryType('Consumption')
                      setSelectedAllocFilter(nextAlloc)
                      setCurrentPage(1)
                      updateUrlQuery({ entryType: 'Consumption', alloc: nextAlloc })
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      selectedAllocFilter === 'Pending'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-50'
                    }`}
                  >
                    Pending Split
                  </button>
                )}
              </div>

              {/* P2 #12: Date Range Filter + Quick Presets */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end print:hidden">
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => {
                      setFromDate(e.target.value)
                      setCurrentPage(1)
                      updateUrlQuery({ from: e.target.value })
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => {
                      setToDate(e.target.value)
                      setCurrentPage(1)
                      updateUrlQuery({ to: e.target.value })
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900"
                  />
                </div>
                <div className="sm:col-span-4 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyQuickDateRange('today')}
                    className="flex-1 px-2 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-700"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickDateRange('week')}
                    className="flex-1 px-2 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-700"
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickDateRange('month')}
                    className="flex-1 px-2 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-700"
                  >
                    Month
                  </button>
                </div>
              </div>

              {/* Search Bar */}
              <div className="flex items-center gap-2 print:hidden">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                    updateUrlQuery({ q: e.target.value })
                  }}
                  placeholder="Search ration item, vendor/notes, date (DD/MM/YYYY), or cost..."
                  className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-600"
                />
                {hasLedgerFilters && (
                  <button
                    type="button"
                    onClick={resetAllLedgerFilters}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* P1 #6: Guided Empty State */}
            {paginatedLogs.length === 0 ? (
              <div className="px-6 py-12 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-700">
                  {allFeedLogs.length === 0
                    ? 'No feed entries yet. Add your first Purchase.'
                    : 'No feed records match the selected filters.'}
                </p>
                <div className="flex items-center justify-center gap-2">
                  {allFeedLogs.length === 0 ? (
                    <a
                      href="#purchase-panel"
                      className="inline-flex items-center justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs shadow-xs transition"
                    >
                      + New Purchase
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={resetAllLedgerFilters}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* P2 #14: Mobile Cards (<768px) */}
                <div className="md:hidden divide-y divide-slate-100">
                  {paginatedLogs.map(log => {
                    const isPurchase = log.entry_type === 'Purchase' || !log.entry_type
                    const speciesLabel = log.target_species || 'Goat'
                    const costNum = Number(log.total_cost || 0)
                    const qtyNum = Number(log.quantity_kg || 0)
                    const isExpanded = expandedRowId === log.id

                    return (
                      <div key={log.id} className="p-4 space-y-2 bg-white">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-900">{log.feed_type}</span>
                              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-slate-900 text-white">
                                {speciesLabel}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${
                                  isPurchase
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-purple-50 text-purple-700 border border-purple-200'
                                }`}
                              >
                                {isPurchase ? 'Stock In' : 'Stock Out'}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                              {formatDateDDMMYYYY(log.log_date)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold font-mono text-slate-900">
                              Rs. {costNum.toLocaleString()}
                            </p>
                            <p className="text-[11px] font-mono text-slate-600">
                              {qtyNum.toFixed(1)} kg
                            </p>
                          </div>
                        </div>

                        {log.notes && <p className="text-[11px] text-slate-500">{log.notes}</p>}

                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2">
                            {!isPurchase && isAdmin && (
                              <span
                                className={`text-[10px] font-semibold ${
                                  log.is_allocated ? 'text-emerald-600' : 'text-amber-600'
                                }`}
                              >
                                {log.is_allocated ? '✓ Allocated' : '• Pending Split'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setExpandedRowId(isExpanded ? null : log.id)}
                              className="text-[10px] font-semibold text-slate-500 underline"
                            >
                              {isExpanded ? 'Hide audit' : 'Audit info'}
                            </button>
                          </div>

                          {isAdmin && (
                            <form
                              action={deleteFeedLogAction}
                              onSubmit={e => {
                                const confirmed = window.confirm(
                                  `Delete ${log.feed_type} — ${qtyNum.toFixed(1)}kg — Rs. ${costNum.toLocaleString()}? ${
                                    isPurchase
                                      ? `Rs. ${costNum.toLocaleString()} will be refunded to OPERATING wallet. `
                                      : ''
                                  }This cannot be undone.`
                                )
                                if (!confirmed) {
                                  e.preventDefault()
                                  return
                                }
                                setDeletingId(log.id)
                              }}
                            >
                              <input type="hidden" name="logId" value={log.id} />
                              <button
                                type="submit"
                                disabled={deletingId === log.id}
                                className="px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 border border-rose-200 text-[11px] font-semibold transition"
                              >
                                {deletingId === log.id ? 'Deleting...' : 'Delete'}
                              </button>
                            </form>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="text-[10px] text-slate-500 bg-slate-50 rounded-lg p-2 border border-slate-200/70">
                            Created at: {formatDateTimeDDMMYYYY(log.created_at || log.log_date)} • Created by:{' '}
                            {log.created_by_email || log.created_by || role.toUpperCase()}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* P2 #13 & #14: Desktop Table with Sticky Header & Sortable Columns */}
                <div className="hidden md:block overflow-x-auto max-h-[620px]">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-2xs">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <button
                            type="button"
                            onClick={() => toggleSort('date')}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            <span>Date</span>
                            <span>{sortBy === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                          </button>
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Item &amp; Type
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <button
                            type="button"
                            onClick={() => toggleSort('qty')}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            <span>Qty</span>
                            <span>{sortBy === 'qty' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                          </button>
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <button
                            type="button"
                            onClick={() => toggleSort('cost')}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            <span>Cost / Split</span>
                            <span>{sortBy === 'cost' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                          </button>
                        </th>
                        {isAdmin && (
                          <th className="px-4 py-2.5 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider print:hidden">
                            Action
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {paginatedLogs.map(log => {
                        const isPurchase = log.entry_type === 'Purchase' || !log.entry_type
                        const speciesLabel = log.target_species || 'Goat'
                        const costNum = Number(log.total_cost || 0)
                        const qtyNum = Number(log.quantity_kg || 0)
                        const isExpanded = expandedRowId === log.id

                        return (
                          <tr
                            key={log.id}
                            title={`Created at: ${formatDateTimeDDMMYYYY(
                              log.created_at || log.log_date
                            )} • By: ${log.created_by_email || log.created_by || role.toUpperCase()}`}
                            className="hover:bg-slate-50/90 transition-colors"
                          >
                            <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-slate-700">
                              {formatDateDDMMYYYY(log.log_date)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold text-slate-900">
                                  {log.feed_type}
                                </span>
                                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-slate-900 text-white">
                                  {speciesLabel}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${
                                    isPurchase
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : 'bg-purple-50 text-purple-700 border border-purple-200'
                                  }`}
                                >
                                  {isPurchase ? 'Stock In' : 'Stock Out'}
                                </span>
                              </div>
                              {log.notes && (
                                <div className="text-[11px] text-slate-400 mt-0.5">{log.notes}</div>
                              )}
                              <button
                                type="button"
                                onClick={() => setExpandedRowId(isExpanded ? null : log.id)}
                                className="text-[10px] text-slate-400 hover:text-slate-600 mt-0.5 print:hidden"
                              >
                                {isExpanded ? '▾ Hide audit' : '▸ Audit'}
                              </button>
                              {isExpanded && (
                                <div className="text-[10px] text-slate-500 mt-1 bg-slate-50 px-2 py-1 rounded border border-slate-200/70">
                                  Created at: {formatDateTimeDDMMYYYY(log.created_at || log.log_date)} •
                                  Created by: {log.created_by_email || log.created_by || role.toUpperCase()}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-xs font-mono font-semibold text-slate-800">
                              {qtyNum.toFixed(1)} kg
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="text-xs font-bold font-mono text-slate-900">
                                Rs. {costNum.toLocaleString()}
                              </div>
                              {!isPurchase && isAdmin && (
                                <span
                                  className={`text-[10px] font-semibold ${
                                    log.is_allocated ? 'text-emerald-600' : 'text-amber-600'
                                  }`}
                                >
                                  {log.is_allocated ? '✓ Allocated' : '• Pending Split'}
                                </span>
                              )}
                            </td>
                            {isAdmin && (
                              <td className="px-4 py-3 whitespace-nowrap text-right print:hidden">
                                <form
                                  action={deleteFeedLogAction}
                                  onSubmit={e => {
                                    const confirmed = window.confirm(
                                      `Delete ${log.feed_type} — ${qtyNum.toFixed(1)}kg — Rs. ${costNum.toLocaleString()}? ${
                                        isPurchase
                                          ? `Rs. ${costNum.toLocaleString()} will be refunded to OPERATING wallet. `
                                          : ''
                                      }This cannot be undone.`
                                    )
                                    if (!confirmed) {
                                      e.preventDefault()
                                      return
                                    }
                                    setDeletingId(log.id)
                                  }}
                                  className="inline-block"
                                >
                                  <input type="hidden" name="logId" value={log.id} />
                                  <button
                                    type="submit"
                                    disabled={deletingId === log.id}
                                    className="px-2 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 border border-rose-200 text-[11px] font-semibold transition"
                                  >
                                    {deletingId === log.id ? 'Deleting...' : 'Delete'}
                                  </button>
                                </form>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* P1 #10: Ledger Footer Totals + Pagination */}
            {totalFilteredCount > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <span className="text-slate-600 font-mono text-[11px]">
                  Showing <strong className="text-slate-900">{paginatedLogs.length}</strong> of{' '}
                  <strong className="text-slate-900">{totalFilteredCount}</strong> • Page Total:{' '}
                  <strong className="text-slate-900">Rs. {pageTotalCost.toLocaleString()}</strong> • Filter
                  Total: <strong className="text-slate-900">Rs. {filterTotalCost.toLocaleString()}</strong>
                </span>

                <div className="flex items-center gap-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 font-semibold rounded-lg border border-slate-200 transition"
                  >
                    ← Previous
                  </button>

                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 font-semibold rounded-lg border border-slate-200 transition"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right 5 Cols: Sticky Quick-Entry & Write-off Forms */}
          <FeedActionFormsClient
            speciesOptions={SPECIES_OPTIONS}
            defaultSpecies={selectedSpeciesFilter !== 'All' ? selectedSpeciesFilter : 'Goat'}
            todayStr={todayStr}
            isAdmin={isAdmin}
            addFeedLogAction={addFeedLogAction}
            adjustFeedStockAction={adjustFeedStockAction}
          />
        </div>
      </div>
    </div>
  )
}