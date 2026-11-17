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

export default async function FeedManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error

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
  const { data: feedLogs } = await supabase
    .from('feed_logs')
    .select('*')
    .eq('farm_id', farm.id)
    .order('log_date', { ascending: false })

  // 2. Fetch active animals (for cost allocation preview & execution)
  const { data: activeAnimals } = await supabase
    .from('livestock_master')
    .select('id, tag_id, species, ownership, client_name')
    .eq('farm_id', farm.id)
    .eq('status', 'Active')

  // 3. Fetch latest weight logs (for Weight-Based Pro-Rata Split)
  const { data: allWeights } = await supabase
    .from('animal_weight_logs')
    .select('animal_id, weight_kg, recorded_date')
    .eq('farm_id', farm.id)
    .order('recorded_date', { ascending: false })

  // Build map of latest weight per animal
  const latestWeightMap: Record<string, number> = {}
  ;(allWeights || []).forEach(w => {
    if (w.animal_id && latestWeightMap[w.animal_id] === undefined) {
      latestWeightMap[w.animal_id] = Number(w.weight_kg) || 0
    }
  })

  // Calculate Bulk Stock Inventory per Feed Type
  type StockSummary = {
    feedType: string
    purchasedKg: number
    consumedKg: number
    remainingKg: number
    totalPurchasedCost: number
    avgRatePerKg: number
  }

  const stockMap: Record<string, StockSummary> = {}
  ;(feedLogs || []).forEach(log => {
    const key = (log.feed_type || 'General Feed').trim()
    if (!stockMap[key]) {
      stockMap[key] = {
        feedType: key,
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

  // Unallocated Cost Pool (Purchases or Direct Logs not yet split to animals)
  const unallocatedLogs = (feedLogs || []).filter(
    l => !l.is_allocated && (l.entry_type === 'Purchase' || !l.entry_type) && Number(l.total_cost) > 0
  )
  const unallocatedCostPool = unallocatedLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

  // KPI Metrics
  const totalPurchasedSpend = (feedLogs || [])
    .filter(l => l.entry_type === 'Purchase' || !l.entry_type)
    .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

  const totalRemainingStockKg = inventoryList.reduce((sum, i) => sum + Math.max(i.remainingKg, 0), 0)

  // SERVER ACTION 1: Add Bulk Purchase or Daily Consumption Log
  const addFeedLog = async (formData: FormData) => {
    'use server'
    const entry_type = (formData.get('entry_type') as string) || 'Purchase'
    const feed_type = (formData.get('feed_type') as string).trim()
    const quantity_kg = parseFloat(formData.get('quantity_kg') as string) || 0
    const rawCost = formData.get('total_cost') as string
    const log_date = (formData.get('log_date') as string) || new Date().toISOString().split('T')[0]
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    let finalCost = rawCost ? parseFloat(rawCost) : 0

    // Auto-calculate consumption value from average purchase rate if user left cost blank on Consumption
    if (entry_type === 'Consumption' && finalCost === 0 && quantity_kg > 0) {
      const { data: priorPurchases } = await supabaseClient
        .from('feed_logs')
        .select('quantity_kg, total_cost')
        .eq('farm_id', farm.id)
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
        entry_type,
        feed_type,
        quantity_kg,
        total_cost: finalCost,
        log_date,
        notes: notes || null,
        is_allocated: entry_type === 'Consumption' ? true : false, // Purchases go into cost allocation pool
      },
    ])

    if (error) {
      return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/feed?msg=${encodeURIComponent(`${entry_type} log saved (${feed_type} - ${quantity_kg} kg).`)}`)
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

  // SERVER ACTION 3: Run Automated Cost Split to Active Animals
  const allocateFeedCostToAnimals = async (formData: FormData) => {
    'use server'
    const splitMethod = (formData.get('split_method') as string) || 'equal'
    const allocationDate = (formData.get('allocation_date') as string) || new Date().toISOString().split('T')[0]
    const periodLabel = (formData.get('period_label') as string) || 'Bulk Ration Allocation'

    const supabaseClient = await createClient()

    // Fetch unallocated purchase logs
    const { data: pendingLogs } = await supabaseClient
      .from('feed_logs')
      .select('id, total_cost, feed_type')
      .eq('farm_id', farm.id)
      .eq('is_allocated', false)
      .gt('total_cost', 0)

    if (!pendingLogs || pendingLogs.length === 0) {
      return redirect('/feed?error=No+unallocated+feed+costs+available+to+split.')
    }

    const totalPool = pendingLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)

    // Fetch active animals
    const { data: animals } = await supabaseClient
      .from('livestock_master')
      .select('id, tag_id')
      .eq('farm_id', farm.id)
      .eq('status', 'Active')

    if (!animals || animals.length === 0) {
      return redirect('/feed?error=No+active+animals+found+to+allocate+costs.')
    }

    // Fetch latest weights if weight-based split selected
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

    // Prepare financial entries for each active animal
    const financialInserts = animals.map(animal => {
      let share = 0
      let noteDetail = ''

      if (useWeightSplit) {
        const w = weightsByAnimal[animal.id] || 0
        const ratio = w / totalWeight
        share = Math.round(totalPool * ratio)
        noteDetail = `${periodLabel} (${(ratio * 100).toFixed(1)}% weight share @ ${w}kg)`
      } else {
        share = Math.round(totalPool / animals.length)
        noteDetail = `${periodLabel} (Equal split across ${animals.length} heads)`
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

    // Mark feed logs as allocated so they aren't double-counted
    const logIds = pendingLogs.map(l => l.id)
    await supabaseClient
      .from('feed_logs')
      .update({ is_allocated: true, allocated_at: new Date().toISOString() })
      .in('id', logIds)

    return redirect(
      `/feed?msg=${encodeURIComponent(
        `Rs. ${totalPool.toLocaleString()} allocated across ${financialInserts.length} active animals (${
          useWeightSplit ? 'Live-Weight Pro-Rata' : 'Equal Headcount'
        } split)!`
      )}`
    )
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const activeCount = activeAnimals?.length || 0
  const estimatedEqualShare = activeCount > 0 ? Math.round(unallocatedCostPool / activeCount) : 0

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                2-Tier Feed ERP
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">
              Feed Inventory & Cost Allocation
            </h1>
            <p className="text-sm text-slate-500">
              Manage bulk ration purchases, track daily shed consumption & split costs to active livestock
            </p>
          </div>

          <Link
            href="/animals"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm"
          >
            ← Back to Livestock Master
          </Link>
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
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Bulk Spend</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">Rs. {totalPurchasedSpend.toLocaleString()}</p>
            <p className="text-xs text-slate-400 mt-1">All recorded feed purchases</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Shed Stock Remaining</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{totalRemainingStockKg.toFixed(1)} <span className="text-sm font-normal text-slate-400">kg</span></p>
            <p className="text-xs text-slate-400 mt-1">Across {inventoryList.length} ingredient(s)</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-amber-200 bg-amber-50/30 shadow-sm">
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Unallocated Cost Pool</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">Rs. {unallocatedCostPool.toLocaleString()}</p>
            <p className="text-xs text-amber-700/80 mt-1">{unallocatedLogs.length} bill(s) ready to split</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Est. Share / Head</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">Rs. {estimatedEqualShare.toLocaleString()}</p>
            <p className="text-xs text-slate-400 mt-1">Across {activeCount} active animal(s)</p>
          </div>
        </div>

        {/* TIER 1: Live Bulk Stock Inventory Breakdown */}
        {inventoryList.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Live Shed Ration Stock (Bulk Inventory)</h2>
                <p className="text-xs text-slate-500">Auto-calculated from Bulk Purchases minus Daily Shed Consumption</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {inventoryList.map((item) => {
                const isLow = item.remainingKg <= 5
                return (
                  <div
                    key={item.feedType}
                    className={`p-4 rounded-xl border ${
                      isLow ? 'bg-rose-50/40 border-rose-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900">{item.feedType}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isLow ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </div>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-2">
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

        {/* TIER 2: Automated Cost Allocation Engine */}
        <div className="bg-slate-900 text-white rounded-2xl shadow-md p-6 border border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-400 text-slate-950">
                  Tier 2 Automation
                </span>
                <h2 className="text-base font-bold">Auto-Split Unallocated Feed Costs to Active Animals</h2>
              </div>
              <p className="text-xs text-slate-300">
                Distribute your pending bulk feed pool (<strong>Rs. {unallocatedCostPool.toLocaleString()}</strong>) directly into each active animal&apos;s Financial P&L Ledger in one click.
              </p>
            </div>

            <form action={allocateFeedCostToAnimals} className="grid grid-cols-1 sm:grid-cols-4 gap-3 w-full lg:w-auto">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Allocation Method</label>
                <select
                  name="split_method"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
                >
                  <option value="equal">Equal Split ({activeCount} heads)</option>
                  <option value="weight">Live-Weight Pro-Rata Split</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Ledger Date</label>
                <input
                  name="allocation_date"
                  type="date"
                  required
                  defaultValue={todayStr}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Batch / Month Label</label>
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
                  disabled={unallocatedCostPool <= 0 || activeCount === 0}
                  className="w-full py-2 px-4 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs transition shadow-sm"
                >
                  Split Rs. {unallocatedCostPool.toLocaleString()} Now
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
              <h2 className="font-bold text-slate-800 text-sm">Bulk Purchase & Daily Consumption Ledger</h2>
              <span className="text-xs text-slate-400">{feedLogs?.length || 0} entries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date (DD/MM/YYYY)</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Type</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Feed Item</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Qty (KG)</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Cost / Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {feedLogs && feedLogs.length > 0 ? (
                    feedLogs.map((log) => {
                      const isPurchase = log.entry_type === 'Purchase' || !log.entry_type
                      return (
                        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono text-slate-700">
                            {formatDateDDMMYYYY(log.log_date)}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full ${
                              isPurchase
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-purple-50 text-purple-700 border border-purple-200'
                            }`}>
                              {isPurchase ? 'Stock In (Buy)' : 'Stock Out (Used)'}
                            </span>
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
                                {log.is_allocated ? '✓ Split to Animals' : '• Pending Split'}
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
                        No feed purchases or consumption logs recorded yet.
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
              <p className="text-xs text-slate-500 mt-0.5">Log a bulk purchase or daily shed ration usage</p>
            </div>

            <form action={addFeedLog} className="space-y-4">
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
                  placeholder="e.g., Mandi bulk bag / Morning ration"
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