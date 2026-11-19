import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'

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

function buildFinancesUrl({
  filter,
  q,
  page,
}: {
  filter?: string
  q?: string
  page?: number
}) {
  const sp = new URLSearchParams()
  if (filter && filter !== 'All') sp.set('filter', filter)
  if (q && q.trim()) sp.set('q', q.trim())
  if (page && page > 1) sp.set('page', String(page))
  const qs = sp.toString()
  return qs ? `/finances?${qs}` : '/finances'
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
    filter?: string
    q?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error
  const filterType = params.filter === 'Income' || params.filter === 'Expense' ? params.filter : 'All'
  const searchQuery = (params.q || '').trim()
  const normalizedQuery = searchQuery.toLowerCase()
  const currentPage = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const pageSize = 15

  // RBAC Check: Only Admin can access Finances & P&L
  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')
  if (role !== 'admin') {
    return redirect('/animals?error=' + encodeURIComponent('Access Denied: Financial ledger is restricted to Admin only.'))
  }

  const supabase = await createClient()

  // Run independent read queries in parallel to speed up page load
  const [
    { data: palaiAnimals },
    { data: globalTxns },
    { data: animalFinLogs },
  ] = await Promise.all([
    supabase
      .from('livestock_master')
      .select('id, tag_id, client_name, monthly_palai_fee, status')
      .eq('farm_id', farm.id)
      .neq('ownership', 'Self')
      .eq('status', 'Active'),
    supabase
      .from('transactions')
      .select('id, txn_date, type, category, amount, description')
      .eq('farm_id', farm.id)
      .order('txn_date', { ascending: false }),
    supabase
      .from('animal_financial_logs')
      .select(`
        id,
        animal_id,
        entry_type,
        category,
        amount,
        transaction_date,
        notes,
        livestock_master (
          id,
          tag_id,
          species
        )
      `)
      .eq('farm_id', farm.id)
      .order('transaction_date', { ascending: false }),
  ])

  // Merge Ledger
  type UnifiedLedgerItem = {
    id: string
    source: 'global' | 'animal'
    date: string
    type: 'Income' | 'Expense'
    category: string
    amount: number
    description: string
    animalId?: string
    tagId?: string
  }

  const unifiedList: UnifiedLedgerItem[] = []

  ;(globalTxns || []).forEach(t => {
    unifiedList.push({
      id: t.id,
      source: 'global',
      date: String(t.txn_date).split('T')[0],
      type: t.type === 'Income' ? 'Income' : 'Expense',
      category: t.category || 'General',
      amount: Number(t.amount) || 0,
      description: t.description || '',
    })
  })

  ;(animalFinLogs || []).forEach((f: any) => {
    const animalInfo = Array.isArray(f.livestock_master) ? f.livestock_master[0] : f.livestock_master
    unifiedList.push({
      id: f.id,
      source: 'animal',
      date: String(f.transaction_date).split('T')[0],
      type: f.entry_type === 'Revenue' ? 'Income' : 'Expense',
      category: f.category || 'General',
      amount: Number(f.amount) || 0,
      description: f.notes || '',
      animalId: f.animal_id,
      tagId: animalInfo?.tag_id || 'Animal',
    })
  })

  unifiedList.sort((a, b) => b.date.localeCompare(a.date))

  const filteredLedger = unifiedList.filter(item => {
    if (filterType === 'Income' && item.type !== 'Income') return false
    if (filterType === 'Expense' && item.type !== 'Expense') return false
    if (!normalizedQuery) return true

    const haystack = [
      item.category,
      item.description,
      item.tagId || '',
      item.type,
      formatDateDDMMYYYY(item.date),
      String(item.amount),
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  const totalFilteredCount = filteredLedger.length
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const paginatedLedger = filteredLedger.slice(startIndex, startIndex + pageSize)

  const totalIncome = unifiedList.filter(t => t.type === 'Income').reduce((acc, t) => acc + t.amount, 0)
  const totalExpense = unifiedList.filter(t => t.type === 'Expense').reduce((acc, t) => acc + t.amount, 0)
  const netBalance = totalIncome - totalExpense

  const expenseByCategory: Record<string, number> = {}
  unifiedList
    .filter(t => t.type === 'Expense')
    .forEach(t => {
      const cat = t.category || 'General'
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + t.amount
    })

  const sortedExpenseCategories = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])

  // Server Action: Run Monthly Palai Auto-Billing
  const runMonthlyPalaiBilling = async (formData: FormData) => {
    'use server'
    const billingMonth = formData.get('billing_month') as string // e.g. "2026-11"
    const defaultFee = parseFloat(formData.get('default_fee') as string) || 5000

    const supabaseClient = await createClient()

    const { data: activePalai } = await supabaseClient
      .from('livestock_master')
      .select('id, tag_id, client_name, monthly_palai_fee')
      .eq('farm_id', farm.id)
      .neq('ownership', 'Self')
      .eq('status', 'Active')

    if (!activePalai || activePalai.length === 0) {
      return redirect(`/finances?error=${encodeURIComponent('No active Palai animals found for billing.')}`)
    }

    const billingNoteTag = `Auto-Bill (${billingMonth})`
    const billingDate = `${billingMonth}-01`
    let billedCount = 0

    for (const animal of activePalai) {
      const { data: existingLog } = await supabaseClient
        .from('animal_financial_logs')
        .select('id')
        .eq('animal_id', animal.id)
        .eq('notes', billingNoteTag)
        .maybeSingle()

      if (existingLog) continue

      const feeAmount = Number(animal.monthly_palai_fee) > 0 ? Number(animal.monthly_palai_fee) : defaultFee

      await supabaseClient.from('animal_financial_logs').insert([
        {
          farm_id: farm.id,
          animal_id: animal.id,
          entry_type: 'Revenue',
          category: 'Palai Monthly Fee',
          amount: feeAmount,
          transaction_date: billingDate,
          notes: billingNoteTag,
        },
      ])

      if (animal.client_name) {
        const { data: contactMatch } = await supabaseClient
          .from('contacts')
          .select('id, opening_balance')
          .eq('farm_id', farm.id)
          .ilike('name', animal.client_name.trim())
          .maybeSingle()

        if (contactMatch) {
          const updatedReceivable = (Number(contactMatch.opening_balance) || 0) + feeAmount
          await supabaseClient
            .from('contacts')
            .update({ opening_balance: updatedReceivable })
            .eq('id', contactMatch.id)
        }
      }

      billedCount++
    }

    if (billedCount === 0) {
      return redirect(`/finances?msg=${encodeURIComponent(`All Palai animals were already billed for ${billingMonth}.`)}`)
    }

    return redirect(
      `/finances?msg=${encodeURIComponent(
        `Generated monthly Palai bills for ${billedCount} animal(s) for ${billingMonth} & updated client balances.`
      )}`
    )
  }

  // Server Action: Add Global Farm Transaction
  const addTransaction = async (formData: FormData) => {
    'use server'
    const rawType = ((formData.get('type') as string) || 'Expense').trim()
    const type = rawType === 'Income' ? 'Income' : 'Expense'
    const category = ((formData.get('category') as string) || '').trim()
    const parsedAmount = parseFloat((formData.get('amount') as string) || '0')
    const txn_date = ((formData.get('txn_date') as string) || '').trim()
    const description = ((formData.get('description') as string) || '').trim()

    if (!category) {
      return redirect(`/finances?error=${encodeURIComponent('Category is required.')}`)
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return redirect(`/finances?error=${encodeURIComponent('Please enter a valid amount greater than 0.')}`)
    }

    const supabaseClient = await createClient()

    const { error } = await supabaseClient.from('transactions').insert([
      {
        farm_id: farm.id,
        type,
        category,
        amount: parsedAmount,
        txn_date: txn_date || new Date().toISOString().split('T')[0],
        description: description || null,
      },
    ])

    if (error) return redirect(`/finances?error=${encodeURIComponent(error.message)}`)
    return redirect(`/finances?msg=${encodeURIComponent('Transaction recorded successfully.')}`)
  }

  // Server Action: Delete Transaction
  const deleteTransaction = async (formData: FormData) => {
    'use server'
    const txnId = formData.get('txnId') as string
    const source = formData.get('source') as string
    const supabaseClient = await createClient()

    const tableName = source === 'animal' ? 'animal_financial_logs' : 'transactions'

    const { error } = await supabaseClient
      .from(tableName)
      .delete()
      .eq('id', txnId)
      .eq('farm_id', farm.id)

    if (error) return redirect(`/finances?error=${encodeURIComponent(error.message)}`)
    return redirect(`/finances?msg=${encodeURIComponent('Entry deleted successfully.')}`)
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const currentMonthStr = todayStr.slice(0, 7)

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Admin Ledger & Auto-Billing Engine
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Financials & Billing</h1>
            <p className="text-sm text-slate-500">Consolidated farm-wide income, automated Palai billing & analytics</p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/contacts"
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-sm transition text-sm"
            >
              👥 Contacts Directory
            </Link>
            <Link
              href="/animals"
              className="inline-flex items-center justify-center px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm"
            >
              ← Back to Livestock Master
            </Link>
          </div>
        </div>

        {/* Feedback Banners */}
        {statusMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Success:</strong> {decodeURIComponent(statusMsg)}</span>
            <Link href="/finances" className="text-emerald-600 font-bold hover:text-emerald-900">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Error:</strong> {decodeURIComponent(errorMsg)}</span>
            <Link href="/finances" className="text-red-500 font-bold hover:text-red-800">×</Link>
          </div>
        )}

        {/* Monthly Palai Auto-Billing Engine Banner */}
        <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-500/30 border border-indigo-400/40 rounded-md">
                Automated Billing
              </span>
              <span className="text-xs text-indigo-200">
                Active Palai Animals: <strong>{palaiAnimals?.length || 0}</strong>
              </span>
            </div>
            <h2 className="text-lg font-bold">Monthly Palai Auto-Billing Generator</h2>
            <p className="text-xs text-slate-300 max-w-xl">
              Generate monthly boarding fees for all active client animals in one click. Automatically logs revenue and updates client receivable balances in Contacts for WhatsApp reminders.
            </p>
          </div>

          <form action={runMonthlyPalaiBilling} className="flex flex-wrap items-end gap-3 bg-white/10 p-4 rounded-xl border border-white/15">
            <div>
              <label className="block text-[11px] font-semibold text-indigo-200 mb-1">Billing Month</label>
              <input
                name="billing_month"
                type="month"
                required
                defaultValue={currentMonthStr}
                className="px-3 py-2 bg-white text-slate-900 rounded-lg text-xs font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-indigo-200 mb-1">Default Fee (PKR)</label>
              <input
                name="default_fee"
                type="number"
                required
                defaultValue="5000"
                className="w-28 px-3 py-2 bg-white text-slate-900 rounded-lg text-xs font-mono font-bold"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg text-xs shadow transition"
            >
              ⚡ Run Monthly Billing
            </button>
          </form>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-emerald-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Income (All Sources)</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">Rs. {totalIncome.toLocaleString()}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-rose-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Expenses (All Sources)</p>
            <p className="text-2xl font-bold text-rose-600 mt-1">Rs. {totalExpense.toLocaleString()}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-indigo-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Net Profit / Balance</p>
            <p className={`text-2xl font-bold mt-1 ${netBalance >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
              Rs. {netBalance.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Income vs Expense Ratio</h2>
            {totalIncome + totalExpense > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-emerald-600">Income: {Math.round((totalIncome / (totalIncome + totalExpense || 1)) * 100)}%</span>
                  <span className="text-rose-600">Expense: {Math.round((totalExpense / (totalIncome + totalExpense || 1)) * 100)}%</span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-500"
                    style={{ width: `${(totalIncome / (totalIncome + totalExpense || 1)) * 100}%` }}
                  ></div>
                  <div
                    className="bg-rose-500 h-full transition-all duration-500"
                    style={{ width: `${(totalExpense / (totalIncome + totalExpense || 1)) * 100}%` }}
                  ></div>
                </div>
                <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Inflows: Rs. {totalIncome.toLocaleString()}</span>
                  <span>Outflows: Rs. {totalExpense.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No financial data available for ratio analysis yet.</p>
            )}
          </div>

          <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Expense Breakdown by Category</h2>
            {sortedExpenseCategories.length > 0 ? (
              <div className="space-y-3">
                {sortedExpenseCategories.map(([category, amount]) => {
                  const percentage = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0
                  return (
                    <div key={category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">{category}</span>
                        <span className="font-mono font-semibold text-slate-600">
                          Rs. {amount.toLocaleString()} <span className="text-slate-400 font-normal">({percentage}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No expense categories recorded yet.</p>
            )}
          </div>
        </div>

        {/* Ledger & Add Entry */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-800 text-sm">Unified Transaction History</h2>
                  <p className="text-[11px] text-slate-400">
                    Showing {paginatedLedger.length} of {totalFilteredCount} matching entries (Total: {unifiedList.length})
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Link
                    href={buildFinancesUrl({ filter: 'All', q: searchQuery, page: 1 })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      filterType === 'All' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    All
                  </Link>
                  <Link
                    href={buildFinancesUrl({ filter: 'Income', q: searchQuery, page: 1 })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      filterType === 'Income' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Income
                  </Link>
                  <Link
                    href={buildFinancesUrl({ filter: 'Expense', q: searchQuery, page: 1 })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      filterType === 'Expense' ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    Expense
                  </Link>
                </div>
              </div>

              {/* Search Bar */}
              <form method="GET" action="/finances" className="flex items-center gap-2">
                {filterType !== 'All' && <input type="hidden" name="filter" value={filterType} />}
                <input
                  type="text"
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Search by category, tag ID, notes, or amount..."
                  className="flex-1 px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
                >
                  Search
                </button>
                {(searchQuery || filterType !== 'All') && (
                  <Link
                    href="/finances"
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                  >
                    Reset
                  </Link>
                )}
              </form>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Date</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Tag / Source</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Category</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Amount</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Notes</th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {paginatedLedger.length > 0 ? (
                    paginatedLedger.map((txn) => {
                      const isIncome = txn.type === 'Income'
                      return (
                        <tr key={`${txn.source}-${txn.id}`} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-4 whitespace-nowrap text-xs font-mono text-slate-700">
                            {formatDateDDMMYYYY(txn.date)}
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            {txn.source === 'animal' && txn.animalId ? (
                              <Link
                                href={`/animals/${txn.animalId}`}
                                className="inline-flex items-center px-2.5 py-0.5 text-xs font-mono font-bold rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                              >
                                {txn.tagId}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                General Farm
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap text-xs font-bold text-slate-900">{txn.category}</td>
                          <td className={`px-5 py-4 whitespace-nowrap text-xs font-bold font-mono ${isIncome ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {isIncome ? '+' : '-'} Rs. {txn.amount.toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-xs text-slate-500 max-w-xs truncate">{txn.description || '—'}</td>
                          <td className="px-5 py-4 whitespace-nowrap text-right">
                            <form action={deleteTransaction} className="inline-block">
                              <input type="hidden" name="txnId" value={txn.id} />
                              <input type="hidden" name="source" value={txn.source} />
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
                      <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-400">
                        No matching transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalFilteredCount > 0 && (
              <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <span className="text-slate-500">
                  Page <strong className="text-slate-800">{safePage}</strong> of <strong className="text-slate-800">{totalPages}</strong>
                </span>
                <div className="flex items-center gap-2">
                  {safePage > 1 ? (
                    <Link
                      href={buildFinancesUrl({ filter: filterType, q: searchQuery, page: safePage - 1 })}
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
                      href={buildFinancesUrl({ filter: filterType, q: searchQuery, page: safePage + 1 })}
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

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 h-fit space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Add General Farm Entry</h2>
              <p className="text-xs text-slate-500 mt-0.5">Record farm-level overheads, rent, labor, or general sales</p>
            </div>

            <form action={addTransaction} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Type *</label>
                <select
                  name="type"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900"
                >
                  <option value="Income">Income (Aamdani)</option>
                  <option value="Expense">Expense (Kharcha)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category *</label>
                <input
                  name="category"
                  type="text"
                  list="common-categories"
                  required
                  placeholder="e.g. Shed Rent, Labor, Utilities"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900"
                />
                <datalist id="common-categories">
                  <option value="Palai Boarding Fee" />
                  <option value="Animal Sale / Qurbani" />
                  <option value="Feed & Ration Purchase" />
                  <option value="Veterinary & Medicine" />
                  <option value="Transport & Mandi" />
                  <option value="Shed Rent & Utilities" />
                  <option value="Labor & Staffing" />
                  <option value="Other Expense" />
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Amount (PKR) *</label>
                <input
                  name="amount"
                  type="number"
                  step="1"
                  required
                  placeholder="e.g. 5000"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Date *</label>
                <input
                  name="txn_date"
                  type="date"
                  required
                  defaultValue={todayStr}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description (Optional)</label>
                <input
                  name="description"
                  type="text"
                  placeholder="e.g. Monthly shed electricity bill"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl transition font-semibold text-sm shadow-sm"
              >
                Save Transaction
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}