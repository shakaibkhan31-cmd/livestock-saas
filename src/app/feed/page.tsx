import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

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

export default async function FeedManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; species?: string }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error
  const selectedSpeciesFilter = params.species || 'All'

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // 1. Fetch all feed logs for this farm
  const { data: allFeedLogs } = await supabase
    .from('feed_logs')
    .select('*')
    .eq('farm_id', farm.id)
    .order('log_date', { ascending: false })

  // 2. Fetch active animals (grouped by species)
  const { data: activeAnimals } = await supabase
    .from('livestock_master')
    .select('id, tag_id, species, ownership, client_name')
    .eq('farm_id', farm.id)
    .eq('status', 'Active')

  // Filter feed logs if a specific species tab is selected
  const feedLogs = (allFeedLogs || []).filter(log => {
    if (selectedSpeciesFilter === 'All') return true
    return (log.target_species || 'Goat') === selectedSpeciesFilter
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
  }

  const stockMap: Record<string, StockSummary> = {}
  feedLogs.forEach(log => {
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

  // Unallocated Cost Pool grouped by Species (across ALL logs so user sees pending pools per species)
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

  const filteredUnallocatedPool = feedLogs
    .filter(l => !l.is_allocated && (l.entry_type === 'Purchase' || !l.entry_type) && Number(l.total_cost) > 0)
    .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

  const filteredUnallocatedBillsCount = feedLogs.filter(
    l => !l.is_allocated && (l.entry_type === 'Purchase' || !l.entry_type) && Number(l.total_cost) > 0
  ).length

  // KPI Metrics for active filter
  const totalPurchasedSpend = feedLogs
    .filter(l => l.entry_type === 'Purchase' || !l.entry_type)
    .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

  const totalRemainingStockKg = inventoryList.reduce((sum, i) => sum + Math.max(i.remainingKg, 0), 0)

  // Active headcount matching selected filter
  const matchingActiveAnimals = (activeAnimals || []).filter(a => {
    if (selectedSpeciesFilter === 'All' || selectedSpeciesFilter === 'Shared (All Species)') return true
    return a.species === selectedSpeciesFilter
  })

  // Unique species present in either livestock_master or feed_logs
  const activeSpeciesTabs = Array.from(
    new Set([
      ...(activeAnimals || []).map(a => a.species),
      ...(allFeedLogs || []).map(l => l.target_species || 'Goat'),
    ])
  ).filter(Boolean)

  // SERVER ACTION 1: Add Bulk Purchase or Daily Consumption Log
  const addFeedLog = async (formData: FormData) => {
    'use server'
    const entry_type = (formData.get('entry_type') as string) || 'Purchase'
    const target_species = (formData.get('target_species') as string) || 'Goat'
    const feed_type = (formData.get('feed_type') as string).trim()
    const quantity_kg = parseFloat(formData.get('quantity_kg') as string) || 0
    const rawCost = formData.get('total_cost') as string
    const log_date = (formData.get('log_date') as string) || new Date().toISOString().split('T')[0]
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    let finalCost = rawCost ? parseFloat(rawCost) : 0

    // Auto-calculate consumption value from average purchase rate for THIS species & feed item
    if (entry_type === 'Consumption' && finalCost === 0 && quantity_kg > 0) {
      const { data: priorPurchases } = await supabaseClient
        .from('feed_logs')
        .select('quantity_kg, total_cost')
        .eq('farm_id', farm.id)
        .eq('target_species', target_species)
        .eq('feed_type', feed_type)
        .eq('entry_type', 'Purchase')

      if (priorPurchases && priorPurchases.length > 0) {
        const totKg = priorPurchases.reduce((s, p) => s + (Number(p.quantity_kg) || 0), 0)
        const totRs = priorPurchases.reduce((s, p) => s + (Number(p.total_cost) || 0), 0)
        if (totKg > 0) {
          finalCost = Math.round((totRs / totKg) * quantity_kg)
        }
      }
    }

    const { error } = await supabaseClient.from('feed_logs').insert([
      {
        farm_id: farm.id,
        target_species,
        entry_type,
        feed_type,
        quantity_kg,
        total_cost: finalCost,
        log_date,
        notes: notes || null,
        is_allocated: entry_type === 'Consumption' ? true : false,
      },
    ])

    if (error) {
      return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(
      `/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
        `${target_species} ${entry_type} saved (${feed_type} - ${quantity_kg} kg).`
      )}`
    )
  }

  // SERVER ACTION 2: Delete Feed Log
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

  // SERVER ACTION 3: Species-Specific Automated Cost Split
  const allocateFeedCostToAnimals = async (formData: FormData) => {
    'use server'
    const targetSpecies = (formData.get('allocate_species') as string) || 'Goat'
    const splitMethod = (formData.get('split_method') as string) || 'equal'
    const allocationDate = (formData.get('allocation_date') as string) || new Date().toISOString().split('T')[0]
    const periodLabel = (formData.get('period_label') as string) || 'Monthly Bulk Ration'

    const supabaseClient = await createClient()

    // 1. Fetch unallocated purchase logs ONLY for the chosen targetSpecies
    const { data: pendingLogs } = await supabaseClient
      .from('feed_logs')
      .select('id, total_cost, feed_type')
      .eq('farm_id', farm.id)
      .eq('target_species', targetSpecies)
      .eq('is_allocated', false)
      .gt('total_cost', 0)

    if (!pendingLogs || pendingLogs.length === 0) {
      return redirect(`/feed?error=${encodeURIComponent(`No unallocated feed costs found for ${targetSpecies}.`)}`)
    }

    const totalPool = pendingLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

    // 2. Fetch active animals matching targetSpecies (or all active if 'Shared (All Species)')
    let animalQuery = supabaseClient
      .from('livestock_master')
      .select('id, tag_id, species')
      .eq('farm_id', farm.id)
      .eq('status', 'Active')

    if (targetSpecies !== 'Shared (All Species)') {
      animalQuery = animalQuery.eq('species', targetSpecies)
    }

    const { data: animals } = await animalQuery

    if (!animals || animals.length === 0) {
      return redirect(
        `/feed?error=${encodeURIComponent(`No active ${targetSpecies} animals found in Livestock Master to split costs.`)}`
      )
    }

    // 3. Fetch latest weights if weight-based split selected
    let weightsByAnimal: Record<string, number> = {}
    if (splitMethod === 'weight') {
      const { data: wLogs } = await supabaseClient
        .from('animal_weight_logs')
        .select('animal_id, weight_kg, recorded_date')
        .eq('farm_id', farm.id)
        .order('recorded_date', { ascending: false })

      ;(wLogs || []).forEach(w => {
        if (w.animal_id && weightsByAnimal[w.animal_id] === undefined) {
          weightsByAnimal[w.animal_id] = Number(w.weight_kg) || 0
        }
      })
    }

    const totalWeight = animals.reduce((sum, a) => sum + (weightsByAnimal[a.id] || 0), 0)
    const useWeightSplit = splitMethod === 'weight' && totalWeight > 0

    // 4. Prepare financial entries ONLY for those matching animals
    const financialInserts = animals.map(animal => {
      let share = 0
      let noteDetail = ''

      if (useWeightSplit) {
        const w = weightsByAnimal[animal.id] || 0
        const ratio = w / totalWeight
        share = Math.round(totalPool * ratio)
        noteDetail = `${periodLabel} [${targetSpecies}] (${(ratio * 100).toFixed(1)}% weight share @ ${w}kg)`
      } else {
        share = Math.round(totalPool / animals.length)
        noteDetail = `${periodLabel} [${targetSpecies}] (Equal split across ${animals.length} ${targetSpecies})`
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

    // 5. Mark ONLY this species' feed logs as allocated
    const logIds = pendingLogs.map(l => l.id)
    await supabaseClient
      .from('feed_logs')
      .update({ is_allocated: true, allocated_at: new Date().toISOString() })
      .in('id', logIds)

    return redirect(
      `/feed?species=${encodeURIComponent(targetSpecies)}&msg=${encodeURIComponent(
        `Rs. ${totalPool.toLocaleString()} (${targetSpecies} Feed Pool) allocated across ${financialInserts.length} active ${targetSpecies}(s) using ${
          useWeightSplit ? 'Live-Weight Pro-Rata' : 'Equal Headcount'
        } split!`
      )}`
    )
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const matchingCount = matchingActiveAnimals.length
  const estimatedShare = matchingCount > 0 ? Math.round(filteredUnallocatedPool / matchingCount) : 0
  const speciesWithPendingPools = Object.keys(unallocatedBySpecies)

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Multi-Species 2-Tier Feed ERP
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">
              Feed Inventory & Cost Allocation
            </h1>
            <p className="text-sm text-slate-500">
              Separate bulk ration inventory & automated cost splitting per livestock species
            </p>
          </div>

          <Link
            href="/animals"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm"
          >
            ← Back to Livestock Master
          </Link>
        </div>

        {/* Species Filter Tabs */}
        <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3">Filter Ledger:</span>
          <Link
            href="/feed"
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              selectedSpeciesFilter === 'All'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Species ({allFeedLogs?.length || 0})
          </Link>
          {activeSpeciesTabs.map(sp => {
            const count = (allFeedLogs || []).filter(l => (l.target_species || 'Goat') === sp).length
            const pendingAmt = unallocatedBySpecies[sp]?.amount || 0
            return (
              <Link
                key={sp}
                href={`/feed?species=${encodeURIComponent(sp)}`}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                  selectedSpeciesFilter === sp
                    ? 'bg-green-600 text-white shadow-xs'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200/70'
                }`}
              >
                <span>{sp}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  selectedSpeciesFilter === sp ? 'bg-green-700 text-green-100' : 'bg-slate-200 text-slate-600'
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
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Success:</strong> {decodeURIComponent(statusMsg)}</span>
            <Link href="/feed" className="text-emerald-600 font-bold hover:text-emerald-900">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Error:</strong> {decodeURIComponent(errorMsg)}</span>
            <Link href="/feed" className="text-red-500 font-bold hover:text-red-800">×</Link>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              {selectedSpeciesFilter === 'All' ? 'Total Bulk Spend' : `${selectedSpeciesFilter} Bulk Spend`}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">Rs. {totalPurchasedSpend.toLocaleString()}</p>
            <p className="text-xs text-slate-400 mt-1">Recorded purchase bills</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Shed Stock Remaining</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{totalRemainingStockKg.toFixed(1)} <span className="text-sm font-normal text-slate-400">kg</span></p>
            <p className="text-xs text-slate-400 mt-1">Across {inventoryList.length} feed item(s)</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-amber-200 bg-amber-50/30 shadow-sm">
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Unallocated Cost Pool</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">Rs. {filteredUnallocatedPool.toLocaleString()}</p>
            <p className="text-xs text-amber-700/80 mt-1">{filteredUnallocatedBillsCount} bill(s) ready to split</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Est. Share / Head</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">Rs. {estimatedShare.toLocaleString()}</p>
            <p className="text-xs text-slate-400 mt-1">
              Across {matchingCount} active {selectedSpeciesFilter === 'All' ? 'animal(s)' : `${selectedSpeciesFilter}(s)`}
            </p>
          </div>
        </div>

        {/* TIER 1: Live Bulk Stock Inventory Breakdown (Species-Tagged) */}
        {inventoryList.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Live Shed Ration Stock (By Species)</h2>
                <p className="text-xs text-slate-500">Auto-calculated from Bulk Purchases minus Daily Consumption per species</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {inventoryList.map((item) => {
                const isLow = item.remainingKg <= 5
                return (
                  <div
                    key={item.key}
                    className={`p-4 rounded-xl border ${
                      isLow ? 'bg-rose-50/40 border-rose-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-900 text-white">
                        {item.species}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isLow ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </div>
                    <p className="font-bold text-sm text-slate-900 mt-2">{item.feedType}</p>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                      {item.remainingKg.toFixed(1)} kg
                    </p>
                    <div className="mt-2 pt-2 border-t border-slate-200/70 flex items-center justify-between text-[11px] text-slate-500">
                      <span>In: {item.purchasedKg}kg | Out: {item.consumedKg}kg</span>
                      <span className="font-mono font-semibold text-slate-700">
                        Rs. {Math.round(item.avgRatePerKg)}/kg
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* TIER 2: Species-Isolated Automated Cost Allocation Engine */}
        <div className="bg-slate-900 text-white rounded-2xl shadow-md p-6 border border-slate-800">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-lg">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-400 text-slate-950">
                  Tier 2 Species-Smart Split
                </span>
                <h2 className="text-base font-bold">Auto-Split Species Feed Costs to Matching Animals</h2>
              </div>
              <p className="text-xs text-slate-300">
                Select a species pool below. Costs will <strong>only</strong> be divided among active animals of that exact species.
              </p>
              {speciesWithPendingPools.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {speciesWithPendingPools.map(sp => (
                    <span key={sp} className="text-[11px] font-mono bg-slate-800 text-amber-300 px-2.5 py-0.5 rounded-lg border border-slate-700">
                      {sp}: Rs. {unallocatedBySpecies[sp].amount.toLocaleString()} pending
                    </span>
                  ))}
                </div>
              )}
            </div>

            <form action={allocateFeedCostToAnimals} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 w-full xl:w-auto">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">1. Target Species</label>
                <select
                  name="allocate_species"
                  defaultValue={selectedSpeciesFilter !== 'All' ? selectedSpeciesFilter : (speciesWithPendingPools[0] || 'Goat')}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:ring-2 focus:ring-amber-400"
                >
                  {SPECIES_OPTIONS.map(sp => {
                    const pool = unallocatedBySpecies[sp]?.amount || 0
                    const count = (activeAnimals || []).filter(a => sp === 'Shared (All Species)' ? true : a.species === sp).length
                    return (
                      <option key={sp} value={sp}>
                        {sp} (Rs. {pool.toLocaleString()} • {count} heads)
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">2. Split Method</label>
                <select
                  name="split_method"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
                >
                  <option value="equal">Equal Split (Per Head)</option>
                  <option value="weight">Live-Weight Pro-Rata Split</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">3. Ledger Date</label>
                <input
                  name="allocation_date"
                  type="date"
                  required
                  defaultValue={todayStr}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">4. Batch Label</label>
                <input
                  name="period_label"
                  type="text"
                  defaultValue="Monthly Bulk Ration"
                  placeholder="e.g. Nov 2026 Ration"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={speciesWithPendingPools.length === 0}
                  className="w-full py-2 px-4 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs transition shadow-sm"
                >
                  Run Species Split
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Main Workspace Grid: History Table + Add Entry Form */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left 2 Columns: Feed Transaction Ledger */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 text-sm">
                {selectedSpeciesFilter === 'All'
                  ? 'All Species Purchase & Consumption Ledger'
                  : `${selectedSpeciesFilter} Feed Ledger`}
              </h2>
              <span className="text-xs text-slate-400">{feedLogs.length} entries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date (DD/MM/YYYY)</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Species & Type</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Feed Item</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Qty (KG)</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Cost / Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {feedLogs.length > 0 ? (
                    feedLogs.map((log) => {
                      const isPurchase = log.entry_type === 'Purchase' || !log.entry_type
                      const speciesLabel = log.target_species || 'Goat'
                      return (
                        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono text-slate-700">
                            {formatDateDDMMYYYY(log.log_date)}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap space-y-1">
                            <div>
                              <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-slate-900 text-white">
                                {speciesLabel}
                              </span>
                            </div>
                            <div>
                              <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                                isPurchase
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-purple-50 text-purple-700 border border-purple-200'
                              }`}>
                                {isPurchase ? 'Stock In (Buy)' : 'Stock Out (Used)'}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="text-xs font-bold text-slate-900">{log.feed_type}</div>
                            {log.notes && <div className="text-[11px] text-slate-400">{log.notes}</div>}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono font-semibold text-slate-800">
                            {Number(log.quantity_kg).toFixed(1)} kg
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <div className="text-xs font-bold font-mono text-slate-900">
                              Rs. {Number(log.total_cost || 0).toLocaleString()}
                            </div>
                            {isPurchase && (
                              <span className={`text-[10px] font-semibold ${
                                log.is_allocated ? 'text-emerald-600' : 'text-amber-600'
                              }`}>
                                {log.is_allocated ? `✓ Split to ${speciesLabel}` : '• Pending Split'}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap text-right">
                            <form action={deleteFeedLog} className="inline-block">
                              <input type="hidden" name="logId" value={log.id} />
                              <button
                                type="submit"
                                className="px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium transition"
                              >
                                Delete
                              </button>
                            </form>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-400">
                        No feed purchases or consumption logs recorded for this selection yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Add Feed Entry Form */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Record Feed Entry</h2>
              <p className="text-xs text-slate-500 mt-0.5">Assign purchase or consumption to a specific species</p>
            </div>

            <form action={addFeedLog} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Target Species *</label>
                <select
                  name="target_species"
                  defaultValue={selectedSpeciesFilter !== 'All' ? selectedSpeciesFilter : 'Goat'}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                >
                  {SPECIES_OPTIONS.map(sp => (
                    <option key={sp} value={sp}>{sp}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Entry Mode *</label>
                <select
                  name="entry_type"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                >
                  <option value="Purchase">Bulk Purchase (Stock-In + Cost Pool)</option>
                  <option value="Consumption">Daily Shed Consumption (Stock-Out)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Feed Ingredient / Ration *</label>
                <input
                  name="feed_type"
                  type="text"
                  list="common-feeds"
                  required
                  placeholder="Select or type (e.g., Kala Chana)"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                />
                <datalist id="common-feeds">
                  <option value="Kala Chana" />
                  <option value="Gandum (Wheat)" />
                  <option value="Chokar (Wheat Bran)" />
                  <option value="Bhoosa" />
                  <option value="Alfalfa Hay / Lucerne" />
                  <option value="Mix Dana / Wanda" />
                  <option value="Khal" />
                  <option value="Mineral Mixture & DCP" />
                  <option value="Chicken Starter / Layer Feed" />
                  <option value="Rabbit Pellets / Dry Lucerne" />
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Quantity (KG) *</label>
                  <input
                    name="quantity_kg"
                    type="number"
                    step="0.1"
                    required
                    placeholder="e.g. 50"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Total Cost (PKR)</label>
                  <input
                    name="total_cost"
                    type="number"
                    step="1"
                    placeholder="Auto if Stock-Out"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Date *</label>
                <input
                  name="log_date"
                  type="date"
                  required
                  defaultValue={todayStr}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes / Batch Info</label>
                <input
                  name="notes"
                  type="text"
                  placeholder="e.g., Goat bulk bag / Chicken feed"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-green-600"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl transition font-semibold text-sm shadow-sm"
              >
                Save Feed Record
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}