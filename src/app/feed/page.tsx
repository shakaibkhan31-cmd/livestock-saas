import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import SplitEngineClient from './SplitEngineClient'

// Helper: Consistent DD/MM/YYYY Date Formatter
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

function buildFeedUrl({
  species,
  entryType,
  alloc,
  q,
  page,
  splitDate,
}: {
  species?: string
  entryType?: string
  alloc?: string
  q?: string
  page?: number
  splitDate?: string
}) {
  const sp = new URLSearchParams()
  if (species && species !== 'All') sp.set('species', species)
  if (entryType && entryType !== 'All') sp.set('entryType', entryType)
  if (alloc && alloc !== 'All') sp.set('alloc', alloc)
  if (q && q.trim()) sp.set('q', q.trim())
  if (splitDate && splitDate.trim()) sp.set('splitDate', splitDate.trim())
  if (page && page > 1) sp.set('page', String(page))
  const qs = sp.toString()
  return qs ? `/feed?${qs}` : '/feed'
}

const SPECIES_OPTIONS = [
  'Goat',
  'Sheep',
  'Cattle',
  'Buffalo',
  'Chicken',
  'Rabbit',
  'Horse',
  'Dog',
  'Quail',
  'Shared (All Species)',
]

const DEFAULT_FEED_SUGGESTIONS = [
  'Kala Chana',
  'Channa Chilka',
  'Soya Bean Chilka',
  'Gandum (Wheat)',
  'Gandum Daliya',
  'Chokar (Wheat Bran)',
  'Bhoosa',
  'Alfalfa Hay / Lucerne',
  'Mong Phalli Missa',
  'Mix Dana / Wanda',
  'Khal',
  'Jau (Barley)',
  'Makai (Maize)',
  'Mineral Mixture & DCP',
  'Maymil Milk Powder',
  'Chicken Starter / Layer Feed',
  'Rabbit Pellets / Dry Lucerne',
]

export default async function FeedManagementPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
    species?: string
    splitDate?: string
    entryType?: string
    alloc?: string
    q?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error
  const selectedSpeciesFilter = params.species || 'All'
  const selectedEntryType =
    params.entryType === 'Purchase' || params.entryType === 'Consumption' ? params.entryType : 'All'
  const selectedAllocFilter =
    params.alloc === 'Pending' || params.alloc === 'Allocated' ? params.alloc : 'All'
  const searchQuery = (params.q || '').trim()
  const normalizedQuery = searchQuery.toLowerCase()
  const currentPage = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const pageSize = 15

  // RBAC Check
  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')
  const isAdmin = role === 'admin'

  const supabase = await createClient()
  const todayStr = new Date().toISOString().split('T')[0]

  // Run independent queries in parallel to speed up page load
  const [
    { data: allFeedLogs },
    { data: activeAnimals },
    { data: inventoryRows },
  ] = await Promise.all([
    supabase
      .from('feed_logs')
      .select('id, target_species, entry_type, feed_type, quantity_kg, total_cost, log_date, notes, is_allocated')
      .eq('farm_id', farm.id)
      .order('log_date', { ascending: false }),
    supabase
      .from('livestock_master')
      .select('id, tag_id, species, ownership, client_name, acquisition_date')
      .eq('farm_id', farm.id)
      .eq('status', 'Active'),
    supabase
      .from('feed_inventory')
      .select('*')
      .eq('farm_id', farm.id)
      .order('stock_check_date', { ascending: false }),
  ])

  // Auto-learn custom feed names from previous entries + inventory + defaults
  const dynamicFeedSuggestions = Array.from(
    new Set([
      ...DEFAULT_FEED_SUGGESTIONS,
      ...(allFeedLogs || []).map(l => (l.feed_type || '').trim()).filter(Boolean),
      ...(inventoryRows || []).map(r => (r.feed_name || r.item_name || '').trim()).filter(Boolean),
    ])
  ).sort()

  // Species-level logs used for KPIs & Live Shed Stock
  const speciesFeedLogs = (allFeedLogs || []).filter(log => {
    if (selectedSpeciesFilter === 'All') return true
    return (log.target_species || 'Goat') === selectedSpeciesFilter
  })

  // Ledger-specific filtering (Entry Type + Allocation Status + Search Query)
  const filteredLedgerLogs = speciesFeedLogs.filter(log => {
    const isPurchase = log.entry_type === 'Purchase' || !log.entry_type

    if (selectedEntryType === 'Purchase' && !isPurchase) return false
    if (selectedEntryType === 'Consumption' && isPurchase) return false

    if (selectedAllocFilter === 'Pending' && (!isPurchase || log.is_allocated)) return false
    if (selectedAllocFilter === 'Allocated' && (!isPurchase || !log.is_allocated)) return false

    if (!normalizedQuery) return true

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

    return haystack.includes(normalizedQuery)
  })

  // Pagination slice for Ledger table
  const totalLedgerCount = filteredLedgerLogs.length
  const totalPages = Math.max(1, Math.ceil(totalLedgerCount / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const paginatedFeedLogs = filteredLedgerLogs.slice(startIndex, startIndex + pageSize)

  // Map low_stock_threshold_kg from public.feed_inventory by feed name
  const thresholdByFeedName: Record<string, number> = {}
  ;(inventoryRows || []).forEach(row => {
    const nameKey = (row.feed_name || row.item_name || '').trim().toLowerCase()
    if (nameKey && row.low_stock_threshold_kg !== null && row.low_stock_threshold_kg !== undefined) {
      thresholdByFeedName[nameKey] = Number(row.low_stock_threshold_kg) || 50
    }
  })

  // Calculate Bulk Stock Inventory per (Species + Feed Type)
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
    const sp = (log.target_species || 'Goat').trim()
    const ft = (log.feed_type || 'General Feed').trim()
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

  const inventoryList = Object.values(stockMap).map(item => {
    const remainingKg = item.purchasedKg - item.consumedKg
    const avgRatePerKg = item.purchasedKg > 0 ? item.totalPurchasedCost / item.purchasedKg : 0
    return {
      ...item,
      remainingKg,
      avgRatePerKg,
    }
  })

  const lowStockCount = inventoryList.filter(i => i.remainingKg <= i.thresholdKg).length

  // Unallocated Cost Pool grouped by Species
  const unallocatedBySpecies: Record<string, { amount: number; billCount: number }> = {}
  ;(allFeedLogs || []).forEach(l => {
    if (!l.is_allocated && (l.entry_type === 'Purchase' || !l.entry_type) && Number(l.total_cost) > 0) {
      const sp = (l.target_species || 'Goat').trim()
      if (!unallocatedBySpecies[sp]) {
        unallocatedBySpecies[sp] = { amount: 0, billCount: 0 }
      }
      unallocatedBySpecies[sp].amount += Number(l.total_cost) || 0
      unallocatedBySpecies[sp].billCount += 1
    }
  })

  const filteredUnallocatedPool = speciesFeedLogs
    .filter(l => !l.is_allocated && (l.entry_type === 'Purchase' || !l.entry_type) && Number(l.total_cost) > 0)
    .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

  const filteredUnallocatedBillsCount = speciesFeedLogs.filter(
    l => !l.is_allocated && (l.entry_type === 'Purchase' || !l.entry_type) && Number(l.total_cost) > 0
  ).length

  const totalPurchasedSpend = speciesFeedLogs
    .filter(l => l.entry_type === 'Purchase' || !l.entry_type)
    .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

  const totalRemainingStockKg = inventoryList.reduce((sum, i) => sum + Math.max(i.remainingKg, 0), 0)

  const effectiveSplitDate = (params.splitDate || todayStr).split('T')[0]

  const dateEligibleAnimals = (activeAnimals || []).filter(a => {
    if (!a.acquisition_date) return true
    return String(a.acquisition_date).split('T')[0] <= effectiveSplitDate
  })

  const matchingActiveAnimals = dateEligibleAnimals.filter(a => {
    if (selectedSpeciesFilter === 'All' || selectedSpeciesFilter === 'Shared (All Species)') return true
    return a.species === selectedSpeciesFilter
  })

  const activeSpeciesTabs = Array.from(
    new Set([
      ...(activeAnimals || []).map(a => a.species),
      ...(allFeedLogs || []).map(l => l.target_species || 'Goat'),
    ])
  ).filter(Boolean)

  // Helper to sync current balance into public.feed_inventory using existing columns
  const syncFeedInventorySnapshot = async (
    supabaseClient: Awaited<ReturnType<typeof createClient>>,
    feedName: string,
    category: string,
    ratePerKg: number,
    dateStr: string,
    noteText: string | null
  ) => {
    const { data: logsForName } = await supabaseClient
      .from('feed_logs')
      .select('quantity_kg, entry_type')
      .eq('farm_id', farm.id)
      .ilike('feed_type', feedName)

    let purchKg = 0
    let consKg = 0
    ;(logsForName || []).forEach(l => {
      const q = Number(l.quantity_kg) || 0
      if (l.entry_type === 'Purchase' || !l.entry_type) purchKg += q
      else consKg += q
    })
    const closingBalanceKg = Number((purchKg - consKg).toFixed(2))

    const { data: existingInv } = await supabaseClient
      .from('feed_inventory')
      .select('id, low_stock_threshold_kg')
      .eq('farm_id', farm.id)
      .ilike('feed_name', feedName)
      .limit(1)

    if (existingInv && existingInv.length > 0) {
      await supabaseClient
        .from('feed_inventory')
        .update({
          feed_name: feedName,
          item_name: feedName,
          category,
          purchase_kg: purchKg,
          closing_kg: closingBalanceKg,
          current_stock_kg: closingBalanceKg,
          cost_per_kg: ratePerKg,
          unit_cost_per_kg: ratePerKg,
          stock_check_date: dateStr,
          notes: noteText,
        })
        .eq('id', existingInv[0].id)
        .eq('farm_id', farm.id)
    } else {
      await supabaseClient.from('feed_inventory').insert([
        {
          farm_id: farm.id,
          feed_name: feedName,
          item_name: feedName,
          category,
          opening_kg: 0,
          purchase_kg: purchKg,
          closing_kg: closingBalanceKg,
          current_stock_kg: closingBalanceKg,
          cost_per_kg: ratePerKg,
          unit_cost_per_kg: ratePerKg,
          low_stock_threshold_kg: 50,
          stock_check_date: dateStr,
          notes: noteText,
        },
      ])
    }
  }

  // SERVER ACTION 1: Record Bulk Purchase (Stock-In)
  const addFeedLog = async (formData: FormData) => {
    'use server'
    const target_species = (formData.get('target_species') as string) || 'Goat'
    const log_date = (formData.get('log_date') as string) || new Date().toISOString().split('T')[0]
    const notes = (formData.get('notes') as string) || ''

    const feedTypes = formData.getAll('feed_type') as string[]
    const quantities = formData.getAll('quantity_kg') as string[]
    const costs = formData.getAll('total_cost') as string[]

    const supabaseClient = await createClient()
    const recordsToInsert: Array<Record<string, any>> = []

    for (let i = 0; i < feedTypes.length; i++) {
      const ft = (feedTypes[i] || '').trim()
      const qty = parseFloat(quantities[i] || '0') || 0
      if (!ft || qty <= 0) continue

      const finalCost = costs[i] ? parseFloat(costs[i]) || 0 : 0

      recordsToInsert.push({
        farm_id: farm.id,
        target_species,
        entry_type: 'Purchase',
        feed_type: ft,
        quantity_kg: qty,
        total_cost: finalCost,
        log_date,
        notes: notes || null,
        is_allocated: false,
      })
    }

    if (recordsToInsert.length === 0) {
      return redirect('/feed?error=Please+enter+at+least+one+valid+feed+item+and+quantity.')
    }

    const { error } = await supabaseClient.from('feed_logs').insert(recordsToInsert)

    if (error) {
      return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
    }

    await Promise.all(
      recordsToInsert.map(rec => {
        const ratePerKg = rec.quantity_kg > 0 ? Number((rec.total_cost / rec.quantity_kg).toFixed(2)) : 0
        return syncFeedInventorySnapshot(
          supabaseClient,
          rec.feed_type,
          target_species,
          ratePerKg,
          log_date,
          notes || null
        )
      })
    )

    return redirect(
      `/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
        `Saved ${recordsToInsert.length} ${target_species} bulk purchase item(s)!`
      )}`
    )
  }

  // SERVER ACTION 2: Delete Feed Log (Admin Only)
  const deleteFeedLog = async (formData: FormData) => {
    'use server'
    const logId = formData.get('logId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('feed_logs')
      .delete()
      .eq('id', logId)
      .eq('farm_id', farm.id)

    if (error) return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
    return redirect(`/feed?msg=${encodeURIComponent('Feed log entry deleted.')}`)
  }

  // SERVER ACTION 3: Multi-Item Feed Stock Adjustment / Closing Write-off (With Auto Cost Calculation)
  const adjustFeedStock = async (formData: FormData) => {
    'use server'
    const target_species = (formData.get('target_species') as string) || 'Goat'
    const log_date = (formData.get('log_date') as string) || new Date().toISOString().split('T')[0]
    const notes = (formData.get('notes') as string) || 'Closing Stock Adjustment / Write-off'

    const feedTypes = formData.getAll('feed_type') as string[]
    const targetQuantities = formData.getAll('target_remaining_kg') as string[]

    const supabaseClient = await createClient()
    const adjustmentsToInsert: Array<Record<string, any>> = []

    for (let i = 0; i < feedTypes.length; i++) {
      const ft = (feedTypes[i] || '').trim()
      if (!ft) continue

      const targetRemainingKg = parseFloat(targetQuantities[i] ?? '0')
      if (isNaN(targetRemainingKg) || targetRemainingKg < 0) continue

      const { data: itemLogs } = await supabaseClient
        .from('feed_logs')
        .select('quantity_kg, total_cost, entry_type')
        .eq('farm_id', farm.id)
        .eq('target_species', target_species)
        .eq('feed_type', ft)

      let totalPurchasedKg = 0
      let totalPurchasedCost = 0
      let totalConsumedKg = 0

      ;(itemLogs || []).forEach(l => {
        const q = Number(l.quantity_kg) || 0
        const c = Number(l.total_cost) || 0
        if (l.entry_type === 'Purchase' || !l.entry_type) {
          totalPurchasedKg += q
          totalPurchasedCost += c
        } else {
          totalConsumedKg += q
        }
      })

      const currentRemaining = totalPurchasedKg - totalConsumedKg
      const diff = Number((currentRemaining - targetRemainingKg).toFixed(3))

      if (diff > 0) {
        const avgRatePerKg = totalPurchasedKg > 0 ? totalPurchasedCost / totalPurchasedKg : 0
        const adjustedCost = avgRatePerKg > 0 ? Math.round(avgRatePerKg * diff) : 0

        adjustmentsToInsert.push({
          farm_id: farm.id,
          target_species,
          entry_type: 'Consumption',
          feed_type: ft,
          quantity_kg: diff,
          total_cost: adjustedCost,
          log_date,
          notes: `${notes} (${currentRemaining.toFixed(1)}kg -> ${targetRemainingKg.toFixed(1)}kg)`,
          is_allocated: true,
        })
      }
    }

    if (adjustmentsToInsert.length === 0) {
      return redirect(
        `/feed?error=${encodeURIComponent(
          'No items required downward stock adjustment (check item names or target stock vs current stock).'
        )}`
      )
    }

    const { error } = await supabaseClient.from('feed_logs').insert(adjustmentsToInsert)

    if (error) {
      return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
    }

    await Promise.all(
      adjustmentsToInsert.map(adj =>
        syncFeedInventorySnapshot(
          supabaseClient,
          adj.feed_type,
          target_species,
          adj.quantity_kg > 0 ? Number((adj.total_cost / adj.quantity_kg).toFixed(2)) : 0,
          log_date,
          adj.notes
        )
      )
    )

    return redirect(
      `/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
        `Applied stock adjustment for ${adjustmentsToInsert.length} item(s)!`
      )}`
    )
  }

  // SERVER ACTION 4: Species-Specific Automated Cost Split (Admin Only, Date-Aware)
  const allocateFeedCostToAnimals = async (formData: FormData) => {
    'use server'
    const targetSpecies = (formData.get('allocate_species') as string) || 'Goat'
    const splitMethod = (formData.get('split_method') as string) || 'equal'
    const allocationDate = (formData.get('allocation_date') as string) || new Date().toISOString().split('T')[0]
    const periodLabel = (formData.get('period_label') as string) || 'Monthly Bulk Ration'

    const supabaseClient = await createClient()

    const { data: pendingLogs } = await supabaseClient
      .from('feed_logs')
      .select('id, total_cost, feed_type, log_date')
      .eq('farm_id', farm.id)
      .eq('target_species', targetSpecies)
      .eq('is_allocated', false)
      .gt('total_cost', 0)

    if (!pendingLogs || pendingLogs.length === 0) {
      return redirect(`/feed?error=${encodeURIComponent(`No unallocated feed costs found for ${targetSpecies}.`)}`)
    }

    const totalPool = pendingLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

    let animalQuery = supabaseClient
      .from('livestock_master')
      .select('id, tag_id, species, acquisition_date')
      .eq('farm_id', farm.id)
      .eq('status', 'Active')

    if (targetSpecies !== 'Shared (All Species)') {
      animalQuery = animalQuery.eq('species', targetSpecies)
    }

    const { data: rawAnimals } = await animalQuery

    const cutoffDateStr = String(allocationDate).split('T')[0]
    const animals = (rawAnimals || []).filter(a => {
      if (!a.acquisition_date) return true
      const acqDateStr = String(a.acquisition_date).split('T')[0]
      return acqDateStr <= cutoffDateStr
    })

    if (!animals || animals.length === 0) {
      return redirect(
        `/feed?error=${encodeURIComponent(`No active ${targetSpecies} animals existed on or before ${formatDateDDMMYYYY(cutoffDateStr)} to split costs.`)}`
      )
    }

    let weightsByAnimal: Record<string, number> = {}
    if (splitMethod === 'weight') {
      const { data: wLogs } = await supabaseClient
        .from('animal_weight_logs')
        .select('animal_id, weight_kg, recorded_date')
        .eq('farm_id', farm.id)
        .lte('recorded_date', cutoffDateStr)
        .order('recorded_date', { ascending: false })

      ;(wLogs || []).forEach(w => {
        if (w.animal_id && weightsByAnimal[w.animal_id] === undefined) {
          weightsByAnimal[w.animal_id] = Number(w.weight_kg) || 0
        }
      })
    }

    const totalWeight = animals.reduce((sum, a) => sum + (weightsByAnimal[a.id] || 0), 0)
    const useWeightSplit = splitMethod === 'weight' && totalWeight > 0

    const financialInserts = animals.map(animal => {
      let share = 0
      let noteDetail = ''

      if (useWeightSplit) {
        const w = weightsByAnimal[animal.id] || 0
        const ratio = w / totalWeight
        share = Math.round(totalPool * ratio)
        noteDetail = `${periodLabel} [${targetSpecies}] (${(ratio * 100).toFixed(1)}% weight share @ ${w}kg as of ${formatDateDDMMYYYY(cutoffDateStr)})`
      } else {
        share = Math.round(totalPool / animals.length)
        noteDetail = `${periodLabel} [${targetSpecies}] (Equal split across ${animals.length} ${targetSpecies} on/before ${formatDateDDMMYYYY(cutoffDateStr)})`
      }

      return {
        animal_id: animal.id,
        farm_id: farm.id,
        entry_type: 'Expense',
        category: 'Feed & Ration',
        amount: share,
        transaction_date: allocationDate,
        notes: noteDetail,
      }
    }).filter(entry => entry.amount > 0)

    if (financialInserts.length > 0) {
      const { error: finErr } = await supabaseClient
        .from('animal_financial_logs')
        .insert(financialInserts)

      if (finErr) {
        return redirect(`/feed?error=${encodeURIComponent('Allocation failed: ' + finErr.message)}`)
      }
    }

    const logIds = pendingLogs.map(l => l.id)
    await supabaseClient
      .from('feed_logs')
      .update({ is_allocated: true, allocated_at: new Date().toISOString() })
      .in('id', logIds)

    return redirect(
      `/feed?species=${encodeURIComponent(targetSpecies)}&msg=${encodeURIComponent(
        `Rs. ${totalPool.toLocaleString()} (${targetSpecies} Feed Pool) allocated across ${financialInserts.length} ${targetSpecies}(s) present on ${formatDateDDMMYYYY(cutoffDateStr)}!`
      )}`
    )
  }

  const matchingCount = matchingActiveAnimals.length
  const estimatedShare = matchingCount > 0 ? Math.round(filteredUnallocatedPool / matchingCount) : 0
  const hasLedgerFilters =
    selectedEntryType !== 'All' || selectedAllocFilter !== 'All' || searchQuery.length > 0

  return (
    <div className="min-h-screen bg-slate-50/80 py-7 px-4 sm:px-6 lg:px-8">
      <datalist id="common-feeds">
        {dynamicFeedSuggestions.map(item => (
          <option key={item} value={item} />
        ))}
      </datalist>

      <div className="max-w-7xl mx-auto space-y-5">

        {/* Top Bar: Brand Header + Quick Jump Actions */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                {farm?.farm_name || 'Livestock ERP'} • {role?.toUpperCase()}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">Feed Inventory &amp; Cost Allocation</span>
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

        {/* Species Filter Bar */}
        <div className="bg-white px-3 py-2.5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2.5">Species:</span>
          <Link
            href={buildFeedUrl({
              species: 'All',
              entryType: selectedEntryType,
              alloc: selectedAllocFilter,
              q: searchQuery,
              splitDate: params.splitDate,
              page: 1,
            })}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              selectedSpeciesFilter === 'All'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All ({allFeedLogs?.length || 0})
          </Link>
          {activeSpeciesTabs.map(sp => {
            const count = (allFeedLogs || []).filter(l => (l.target_species || 'Goat') === sp).length
            const pendingAmt = unallocatedBySpecies[sp]?.amount || 0
            return (
              <Link
                key={sp}
                href={buildFeedUrl({
                  species: sp,
                  entryType: selectedEntryType,
                  alloc: selectedAllocFilter,
                  q: searchQuery,
                  splitDate: params.splitDate,
                  page: 1,
                })}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                  selectedSpeciesFilter === sp
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200/70'
                }`}
              >
                <span>{sp}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  selectedSpeciesFilter === sp ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-200 text-slate-600'
                }`}>
                  {count}
                </span>
                {pendingAmt > 0 && (
                  <span className="h-2 w-2 rounded-full bg-amber-400" title={`Pending Rs. ${pendingAmt.toLocaleString()}`}></span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Status / Error Alerts */}
        {statusMsg && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl text-xs sm:text-sm flex items-center justify-between shadow-xs">
            <span><strong>Success:</strong> {decodeURIComponent(statusMsg)}</span>
            <Link href="/feed" className="text-emerald-700 font-bold hover:text-emerald-950 px-2">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs sm:text-sm flex items-center justify-between shadow-xs">
            <span><strong>Error:</strong> {decodeURIComponent(errorMsg)}</span>
            <Link href="/feed" className="text-rose-600 font-bold hover:text-rose-900 px-2">×</Link>
          </div>
        )}

        {/* Executive KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {selectedSpeciesFilter === 'All' ? 'Bulk Spend' : `${selectedSpeciesFilter} Spend`}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">Rs. {totalPurchasedSpend.toLocaleString()}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Total recorded purchase bills</p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Shed Stock</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1 font-mono">
              {totalRemainingStockKg.toFixed(1)} <span className="text-xs font-sans font-semibold text-slate-400">kg</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {lowStockCount > 0 ? `${lowStockCount} item(s) at/below threshold` : `Across ${inventoryList.length} tracked ration item(s)`}
            </p>
          </div>

          {isAdmin && (
            <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200/90 shadow-xs">
              <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Pending Split Pool</p>
              <p className="text-2xl font-bold text-amber-700 mt-1 font-mono">Rs. {filteredUnallocatedPool.toLocaleString()}</p>
              <p className="text-[11px] text-amber-700/80 mt-0.5">{filteredUnallocatedBillsCount} purchase item(s) unallocated</p>
            </div>
          )}

          <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Est. Share / Head</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1 font-mono">Rs. {estimatedShare.toLocaleString()}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {matchingCount} eligible {selectedSpeciesFilter === 'All' ? 'head(s)' : `${selectedSpeciesFilter}(s)`} • {formatDateDDMMYYYY(effectiveSplitDate)}
            </p>
          </div>
        </div>

        {/* Tier 2: Automated Cost Split Engine */}
        {isAdmin && (
          <SplitEngineClient
            speciesOptions={SPECIES_OPTIONS}
            activeAnimals={activeAnimals || []}
            unallocatedBySpecies={unallocatedBySpecies}
            selectedSpeciesFilter={selectedSpeciesFilter}
            initialSplitDate={effectiveSplitDate}
            allocateAction={allocateFeedCostToAnimals}
          />
        )}

        {/* Compact Live Shed Stock Strip */}
        {inventoryList.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3.5">
              <div>
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Live Shed Ration Stock</h2>
                <p className="text-[11px] text-slate-500">Real-time balance per species &amp; ration item (Purchase minus Write-off / Usage)</p>
              </div>
              <span className="text-[11px] font-mono text-slate-400">{inventoryList.length} items</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {inventoryList.map((item) => {
                const isLow = item.remainingKg <= item.thresholdKg
                return (
                  <div
                    key={item.key}
                    className={`p-3 rounded-xl border transition ${
                      isLow ? 'bg-rose-50/50 border-rose-200' : 'bg-slate-50/80 border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900 text-white">
                        {item.species}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        isLow ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {isLow ? `Low (≤${item.thresholdKg}kg)` : 'OK'}
                      </span>
                    </div>
                    <p className="font-bold text-xs text-slate-900 mt-1.5 truncate" title={item.feedType}>
                      {item.feedType}
                    </p>
                    <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                      {item.remainingKg.toFixed(1)} <span className="text-[10px] font-sans font-normal text-slate-500">kg</span>
                    </p>
                    <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>+{item.purchasedKg} / -{item.consumedKg}</span>
                      {isAdmin && item.avgRatePerKg > 0 && (
                        <span className="font-semibold text-slate-700">Rs.{Math.round(item.avgRatePerKg)}/kg</span>
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

          {/* Left 7 Cols: Searchable, Filterable & Paginated Transaction Ledger */}
          <div className="lg:col-span-7 bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-slate-900 text-sm">
                    {selectedSpeciesFilter === 'All'
                      ? 'Purchase & Stock-Out Ledger'
                      : `${selectedSpeciesFilter} Feed Ledger`}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Showing {paginatedFeedLogs.length} of {totalLedgerCount} matching entries (Species Total: {speciesFeedLogs.length})
                  </p>
                </div>

                {/* Type & Allocation Filter Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link
                    href={buildFeedUrl({
                      species: selectedSpeciesFilter,
                      entryType: 'All',
                      alloc: 'All',
                      q: searchQuery,
                      splitDate: params.splitDate,
                      page: 1,
                    })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      selectedEntryType === 'All' && selectedAllocFilter === 'All'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    All
                  </Link>
                  <Link
                    href={buildFeedUrl({
                      species: selectedSpeciesFilter,
                      entryType: 'Purchase',
                      alloc: selectedAllocFilter,
                      q: searchQuery,
                      splitDate: params.splitDate,
                      page: 1,
                    })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      selectedEntryType === 'Purchase'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Stock In
                  </Link>
                  <Link
                    href={buildFeedUrl({
                      species: selectedSpeciesFilter,
                      entryType: 'Consumption',
                      alloc: 'All',
                      q: searchQuery,
                      splitDate: params.splitDate,
                      page: 1,
                    })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      selectedEntryType === 'Consumption'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Stock Out
                  </Link>
                  {isAdmin && (
                    <Link
                      href={buildFeedUrl({
                        species: selectedSpeciesFilter,
                        entryType: 'Purchase',
                        alloc: selectedAllocFilter === 'Pending' ? 'All' : 'Pending',
                        q: searchQuery,
                        splitDate: params.splitDate,
                        page: 1,
                      })}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                        selectedAllocFilter === 'Pending'
                          ? 'bg-amber-600 text-white'
                          : 'bg-white border border-amber-200 text-amber-800 hover:bg-amber-50'
                      }`}
                    >
                      Pending Split
                    </Link>
                  )}
                </div>
              </div>

              {/* Search Bar */}
              <form method="GET" action="/feed" className="flex items-center gap-2">
                {selectedSpeciesFilter !== 'All' && (
                  <input type="hidden" name="species" value={selectedSpeciesFilter} />
                )}
                {selectedEntryType !== 'All' && (
                  <input type="hidden" name="entryType" value={selectedEntryType} />
                )}
                {selectedAllocFilter !== 'All' && (
                  <input type="hidden" name="alloc" value={selectedAllocFilter} />
                )}
                {params.splitDate && (
                  <input type="hidden" name="splitDate" value={params.splitDate} />
                )}
                <input
                  type="text"
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Search ration item, vendor/notes, date, or cost..."
                  className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-600"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
                >
                  Search
                </button>
                {hasLedgerFilters && (
                  <Link
                    href={buildFeedUrl({
                      species: selectedSpeciesFilter,
                      splitDate: params.splitDate,
                      page: 1,
                    })}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    Reset
                  </Link>
                )}
              </form>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Item &amp; Type</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cost / Split</th>
                    {isAdmin && <th className="px-4 py-2.5 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Action</th>}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {paginatedFeedLogs.length > 0 ? (
                    paginatedFeedLogs.map((log) => {
                      const isPurchase = log.entry_type === 'Purchase' || !log.entry_type
                      const speciesLabel = log.target_species || 'Goat'
                      return (
                        <tr key={log.id} className="hover:bg-slate-50/90 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-slate-700">
                            {formatDateDDMMYYYY(log.log_date)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-900">{log.feed_type}</span>
                              <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-slate-900 text-white">
                                {speciesLabel}
                              </span>
                              <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${
                                isPurchase
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-purple-50 text-purple-700 border border-purple-200'
                              }`}>
                                {isPurchase ? 'Stock In' : 'Stock Out'}
                              </span>
                            </div>
                            {log.notes && <div className="text-[11px] text-slate-400 mt-0.5">{log.notes}</div>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs font-mono font-semibold text-slate-800">
                            {Number(log.quantity_kg).toFixed(1)} kg
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-xs font-bold font-mono text-slate-900">
                              Rs. {Number(log.total_cost || 0).toLocaleString()}
                            </div>
                            {isPurchase && isAdmin && (
                              <span className={`text-[10px] font-semibold ${
                                log.is_allocated ? 'text-emerald-600' : 'text-amber-600'
                              }`}>
                                {log.is_allocated ? '✓ Allocated' : '• Pending'}
                              </span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3 whitespace-nowrap text-right">
                              <form action={deleteFeedLog} className="inline-block">
                                <input type="hidden" name="logId" value={log.id} />
                                <button
                                  type="submit"
                                  className="px-2 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-[11px] font-semibold transition"
                                >
                                  Delete
                                </button>
                              </form>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={isAdmin ? 5 : 4} className="px-6 py-10 text-center text-sm text-slate-400">
                        No feed records found for this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {totalLedgerCount > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <span className="text-slate-500">
                  Page <strong className="text-slate-800">{safePage}</strong> of{' '}
                  <strong className="text-slate-800">{totalPages}</strong>
                </span>

                <div className="flex items-center gap-2">
                  {safePage > 1 ? (
                    <Link
                      href={buildFeedUrl({
                        species: selectedSpeciesFilter,
                        entryType: selectedEntryType,
                        alloc: selectedAllocFilter,
                        q: searchQuery,
                        splitDate: params.splitDate,
                        page: safePage - 1,
                      })}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-200 transition"
                    >
                      ← Previous
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 bg-slate-100 text-slate-400 font-semibold rounded-lg border border-slate-200 cursor-not-allowed">
                      ← Previous
                    </span>
                  )}

                  {safePage < totalPages ? (
                    <Link
                      href={buildFeedUrl({
                        species: selectedSpeciesFilter,
                        entryType: selectedEntryType,
                        alloc: selectedAllocFilter,
                        q: searchQuery,
                        splitDate: params.splitDate,
                        page: safePage + 1,
                      })}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-200 transition"
                    >
                      Next →
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 bg-slate-100 text-slate-400 font-semibold rounded-lg border border-slate-200 cursor-not-allowed">
                      Next →
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right 5 Cols: Sticky Quick-Entry & Write-off Forms */}
          <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-6">

            {/* Card A: Record Bulk Purchase (Stock-In) */}
            <div id="purchase-panel" className="bg-white rounded-2xl shadow-xs border border-slate-200/90 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Record Bulk Purchase</h2>
                  <p className="text-[11px] text-slate-500">Add ration stock-in &amp; bill amount</p>
                </div>
                <button
                  type="button"
                  id="add-feed-row-btn"
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 transition"
                >
                  + Add Item
                </button>
              </div>

              <form action={addFeedLog} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Species *</label>
                    <select
                      name="target_species"
                      defaultValue={selectedSpeciesFilter !== 'All' ? selectedSpeciesFilter : 'Goat'}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                    >
                      {SPECIES_OPTIONS.map(sp => (
                        <option key={sp} value={sp}>{sp}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Purchase Date *</label>
                    <input
                      name="log_date"
                      type="date"
                      required
                      defaultValue={todayStr}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                </div>

                <div id="feed-items-container" className="space-y-2.5">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 feed-item-row">
                    <input
                      name="feed_type"
                      type="text"
                      list="common-feeds"
                      required
                      placeholder="Ration item (e.g., Channa Chilka)"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:ring-2 focus:ring-emerald-600"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        name="quantity_kg"
                        type="number"
                        step="0.1"
                        required
                        placeholder="Qty (KG)"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-600"
                      />
                      <input
                        name="total_cost"
                        type="number"
                        step="1"
                        placeholder="Cost (PKR)"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-600 cost-input"
                      />
                    </div>
                  </div>
                </div>

                <div className="px-3.5 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">Bill Total:</span>
                  <span id="live-bill-total" className="text-sm font-bold font-mono text-emerald-700">Rs. 0</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Vendor / Notes</label>
                  <input
                    name="notes"
                    type="text"
                    placeholder="e.g., Afzaal Memon Traders"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition font-semibold text-xs sm:text-sm shadow-xs"
                >
                  Save Bulk Purchase(s)
                </button>
              </form>
            </div>

            {/* Card B: Multi-Item Stock Adjustment / Closing Write-off */}
            {isAdmin && (
              <div id="adjustment-panel" className="bg-white rounded-2xl shadow-xs border border-slate-200/90 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Closing Stock Write-off</h2>
                    <p className="text-[11px] text-slate-500">Enter actual remaining kg to auto-log stock out &amp; cost</p>
                  </div>
                  <button
                    type="button"
                    id="add-adj-row-btn"
                    className="text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg border border-slate-300 transition"
                  >
                    + Add Item
                  </button>
                </div>

                <form action={adjustFeedStock} className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Species</label>
                      <select
                        name="target_species"
                        defaultValue={selectedSpeciesFilter !== 'All' ? selectedSpeciesFilter : 'Goat'}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
                      >
                        {SPECIES_OPTIONS.map(sp => (
                          <option key={sp} value={sp}>{sp}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Closing Date</label>
                      <input
                        name="log_date"
                        type="date"
                        required
                        defaultValue={todayStr}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Reason / Label</label>
                    <input
                      name="notes"
                      type="text"
                      defaultValue="Weekly Closing Adjustment"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                    />
                  </div>

                  <div id="adj-items-container" className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-center p-2.5 bg-slate-50 rounded-xl border border-slate-200 adj-item-row">
                      <div className="col-span-7">
                        <input
                          name="feed_type"
                          type="text"
                          list="common-feeds"
                          required
                          placeholder="Item name"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                        />
                      </div>
                      <div className="col-span-4">
                        <input
                          name="target_remaining_kg"
                          type="number"
                          step="0.1"
                          min="0"
                          required
                          defaultValue="0"
                          title="Remaining Physical KG"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900"
                        />
                      </div>
                      <div className="col-span-1 text-right">
                        <span className="text-[10px] font-mono text-slate-400">#1</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition font-semibold text-xs shadow-xs"
                  >
                    Apply Stock Adjustments
                  </button>
                </form>
              </div>
            )}

          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        function updateBillTotal() {
          const costInputs = document.querySelectorAll('.cost-input');
          let total = 0;
          costInputs.forEach(input => {
            const val = parseFloat(input.value) || 0;
            total += val;
          });
          const totalEl = document.getElementById('live-bill-total');
          if (totalEl) {
            totalEl.textContent = 'Rs. ' + total.toLocaleString();
          }
        }

        document.addEventListener('input', function(e) {
          if (e.target && e.target.classList.contains('cost-input')) {
            updateBillTotal();
          }
        });

        document.addEventListener('click', function(e) {
          if (e.target && e.target.id === 'add-feed-row-btn') {
            const container = document.getElementById('feed-items-container');
            if (!container) return;
            const row = document.createElement('div');
            row.className = 'p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 feed-item-row';
            row.innerHTML = \`
              <div class="flex items-center gap-2">
                <input
                  name="feed_type"
                  type="text"
                  list="common-feeds"
                  required
                  placeholder="Ration item name"
                  class="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:ring-2 focus:ring-emerald-600"
                />
                <button type="button" class="remove-feed-row px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg">×</button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <input
                  name="quantity_kg"
                  type="number"
                  step="0.1"
                  required
                  placeholder="Qty (KG)"
                  class="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-600"
                />
                <input
                  name="total_cost"
                  type="number"
                  step="1"
                  placeholder="Cost (PKR)"
                  class="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-600 cost-input"
                />
              </div>
            \`;
            container.appendChild(row);
            updateBillTotal();
          }
          if (e.target && e.target.classList.contains('remove-feed-row')) {
            const row = e.target.closest('.feed-item-row');
            if (row) {
              row.remove();
              updateBillTotal();
            }
          }
          if (e.target && e.target.id === 'add-adj-row-btn') {
            const container = document.getElementById('adj-items-container');
            if (!container) return;
            const idx = container.querySelectorAll('.adj-item-row').length + 1;
            const row = document.createElement('div');
            row.className = 'grid grid-cols-12 gap-2 items-center p-2.5 bg-slate-50 rounded-xl border border-slate-200 adj-item-row';
            row.innerHTML = \`
              <div class="col-span-7">
                <input
                  name="feed_type"
                  type="text"
                  list="common-feeds"
                  required
                  placeholder="Item name"
                  class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                />
              </div>
              <div class="col-span-4">
                <input
                  name="target_remaining_kg"
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  value="0"
                  class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900"
                />
              </div>
              <div class="col-span-1 flex items-center justify-end gap-0.5">
                <span class="text-[10px] font-mono text-slate-400">#\${idx}</span>
                <button type="button" class="remove-adj-row px-1.5 py-0.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg">×</button>
              </div>
            \`;
            container.appendChild(row);
          }
          if (e.target && e.target.classList.contains('remove-adj-row')) {
            const row = e.target.closest('.adj-item-row');
            if (row) row.remove();
          }
        });
      ` }} />
    </div>
  )
}