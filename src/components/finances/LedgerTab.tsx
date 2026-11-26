import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getUserFarmAndRole } from '@/utils/rbac'
import { formatDateDDMMYYYY } from '@/utils/breakeven'
import {
  applySaleProceedsSplitToWallets,
  ensureDefaultWallets,
  recalculateWalletBalance,
  voidLinkedWalletEntriesByReferenceKeys,
  type WalletType,
} from '@/utils/wallets'
import FinancesExportButton, { type ExportableTxn } from '@/app/finances/FinancesExportButton'
import {
  extractSpeciesFromTxn,
  getPakistanDateString,
  isVoidText,
  SPECIES_OPTIONS,
  stripSpeciesTag,
} from '@/utils/financesHelpers'

function buildLedgerUrl({
  filter,
  q,
  page,
}: {
  filter?: string
  q?: string
  page?: number
}) {
  const sp = new URLSearchParams()
  sp.set('tab', 'ledger')
  if (filter && filter !== 'All') sp.set('filter', filter)
  if (q && q.trim()) sp.set('q', q.trim())
  if (page && page > 1) sp.set('page', String(page))
  return `/finances?${sp.toString()}`
}

export default async function LedgerTab({
  farmId,
  farmName,
  filterParam,
  qParam,
  pageParam,
}: {
  farmId: string
  farmName: string
  filterParam?: string
  qParam?: string
  pageParam?: string
}) {
  const filterType =
    filterParam === 'Income' || filterParam === 'Expense' ? filterParam : 'All'
  const searchQuery = (qParam || '').trim()
  const normalizedQuery = searchQuery.toLowerCase()
  const currentPage = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const pageSize = 15
  const rangeFrom = (currentPage - 1) * pageSize
  const rangeTo = rangeFrom + pageSize - 1

  const supabase = await createClient()
  const todayStr = getPakistanDateString()

  // Fetches ONLY Ledger tables: transactions & animal_financial_logs
  const [
    { data: pagedGlobalTxns, count: pagedGlobalCount },
    { data: allGlobalTxnsForTotals },
    { data: pagedAnimalFinLogs, count: pagedAnimalFinCount },
    { data: allAnimalFinLogsForTotals },
  ] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, txn_date, type, category, amount, description, target_species', {
        count: 'exact',
      })
      .eq('farm_id', farmId)
      .order('txn_date', { ascending: false })
      .range(rangeFrom, rangeTo),
    supabase
      .from('transactions')
      .select('id, txn_date, type, category, amount, description, target_species')
      .eq('farm_id', farmId),
    supabase
      .from('animal_financial_logs')
      .select(
        `
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
      `,
        { count: 'exact' }
      )
      .eq('farm_id', farmId)
      .order('transaction_date', { ascending: false })
      .range(rangeFrom, rangeTo),
    supabase
      .from('animal_financial_logs')
      .select(
        `
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
      `
      )
      .eq('farm_id', farmId),
  ])

  type UnifiedLedgerItem = {
    id: string
    source: 'global' | 'animal'
    date: string
    type: 'Income' | 'Expense'
    category: string
    amount: number
    description: string
    targetSpecies?: string
    animalId?: string
    tagId?: string
    isAutoBill?: boolean
    isVoid?: boolean
  }

  const mapGlobalTxn = (t: any): UnifiedLedgerItem => {
    const voidFlag = isVoidText(t.description)
    const sp = extractSpeciesFromTxn(t)
    const cleanDesc = stripSpeciesTag(t.description)
    return {
      id: t.id,
      source: 'global',
      date: String(t.txn_date).split('T')[0],
      type: t.type === 'Income' ? 'Income' : 'Expense',
      category: t.category || 'General',
      amount: Number(t.amount) || 0,
      description: cleanDesc,
      targetSpecies: sp,
      isVoid: voidFlag,
    }
  }

  const mapAnimalFinLog = (f: any): UnifiedLedgerItem => {
    const animalInfo = Array.isArray(f.livestock_master)
      ? f.livestock_master[0]
      : f.livestock_master
    const noteStr = String(f.notes || '')
    const voidFlag = isVoidText(noteStr)
    return {
      id: f.id,
      source: 'animal',
      date: String(f.transaction_date).split('T')[0],
      type: f.entry_type === 'Revenue' ? 'Income' : 'Expense',
      category: f.category || 'General',
      amount: Number(f.amount) || 0,
      description: noteStr,
      targetSpecies: animalInfo?.species || 'Goat',
      animalId: f.animal_id,
      tagId: animalInfo?.tag_id || 'Animal',
      isAutoBill: noteStr.startsWith('Auto-Bill'),
      isVoid: voidFlag,
    }
  }

  const unifiedList: UnifiedLedgerItem[] = [
    ...(allGlobalTxnsForTotals || []).map(mapGlobalTxn),
    ...(allAnimalFinLogsForTotals || []).map(mapAnimalFinLog),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const pagedUnifiedList: UnifiedLedgerItem[] = [
    ...(pagedGlobalTxns || []).map(mapGlobalTxn),
    ...(pagedAnimalFinLogs || []).map(mapAnimalFinLog),
  ].sort((a, b) => b.date.localeCompare(a.date))

  const activeLedgerItems = unifiedList.filter(item => !item.isVoid)

  const applyLedgerFilter = (item: UnifiedLedgerItem) => {
    if (filterType === 'Income' && item.type !== 'Income') return false
    if (filterType === 'Expense' && item.type !== 'Expense') return false
    if (!normalizedQuery) return true

    const haystack = [
      item.category,
      item.description,
      item.tagId || '',
      item.targetSpecies || '',
      item.type,
      item.isVoid ? 'void' : 'active',
      formatDateDDMMYYYY(item.date),
      String(item.amount),
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  }

  const filteredLedger = unifiedList.filter(applyLedgerFilter)
  const paginatedLedger = pagedUnifiedList.filter(applyLedgerFilter).slice(0, pageSize)

  const exportableRows: ExportableTxn[] = filteredLedger.map(item => ({
    date: item.date,
    type: item.type,
    category: item.category,
    tagOrSpecies:
      item.source === 'animal' && item.tagId
        ? `${item.tagId} (${item.targetSpecies || 'Goat'})`
        : item.targetSpecies || 'Goat',
    amount: item.amount,
    description: item.isVoid ? `[VOID] ${item.description}` : item.description,
    source: item.source,
  }))

  const exportFileName = `${farmName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-finances-${filterType.toLowerCase()}-${todayStr}.csv`

  const totalDbLedgerCount = (pagedGlobalCount ?? 0) + (pagedAnimalFinCount ?? 0)
  const totalFilteredCount = filteredLedger.length
  const totalPages = Math.max(1, Math.ceil(totalDbLedgerCount / pageSize))
  const safePage = Math.min(currentPage, totalPages)

  const addTransaction = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const rawType = ((formData.get('type') as string) || 'Expense').trim()
    const type = rawType === 'Income' ? 'Income' : 'Expense'
    const targetSpecies = (
      (formData.get('target_species') as string) || 'Shared (All Species)'
    ).trim()
    const category = ((formData.get('category') as string) || '').trim()
    const parsedAmount = parseFloat((formData.get('amount') as string) || '0')
    const txn_date =
      ((formData.get('txn_date') as string) || '').trim() || getPakistanDateString()
    const rawDescription = ((formData.get('description') as string) || '').trim()
    const selectedWalletType = (
      (formData.get('wallet_type') as string) || 'OPERATING_CASH'
    ) as WalletType

    if (!category) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent('Category is required.')}`
      )
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent(
          'Please enter a valid amount greater than 0.'
        )}`
      )
    }

    const catLower = category.toLowerCase()
    const isOpsExpense =
      catLower.includes('feed') ||
      catLower.includes('ration') ||
      catLower.includes('labour') ||
      catLower.includes('labor') ||
      catLower.includes('medicine') ||
      catLower.includes('vet') ||
      catLower.includes('electricity') ||
      catLower.includes('rent') ||
      catLower.includes('utility')

    if (type === 'Expense' && selectedWalletType === 'ANIMAL_CAPITAL' && isOpsExpense) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent(
          `Wallets Rule: "${category}" is an operating expense. Select Operating Cash (30-Day) instead of Animal Buying Capital.`
        )}`
      )
    }

    const descriptionWithTag = rawDescription
      ? `${rawDescription} [Species: ${targetSpecies}]`
      : `[Species: ${targetSpecies}]`

    const supabaseClient = await createClient()

    const { data: insertedTxn, error } = await supabaseClient
      .from('transactions')
      .insert([
        {
          farm_id: farmId,
          type,
          category,
          amount: parsedAmount,
          txn_date,
          description: descriptionWithTag,
          target_species: targetSpecies,
        },
      ])
      .select('id')
      .single()

    if (error || !insertedTxn) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent(
          error?.message || 'Failed to save transaction.'
        )}`
      )
    }

    const sourceTxnId = insertedTxn.id
    const isAnimalSaleIncome =
      type === 'Income' &&
      (catLower.includes('animal sale') || catLower.includes('livestock sale'))

    if (isAnimalSaleIncome) {
      try {
        await applySaleProceedsSplitToWallets({
          supabase: supabaseClient,
          farmId,
          sourceTxnId,
          animalId: null,
          tagId: targetSpecies,
          salePrice: parsedAmount,
          txnDate: txn_date,
        })
      } catch (splitErr: any) {
        await supabaseClient
          .from('transactions')
          .delete()
          .eq('id', sourceTxnId)
          .eq('farm_id', farmId)
        return redirect(
          `/finances?tab=ledger&error=${encodeURIComponent(
            `Sale failed, wallet split error: ${splitErr?.message || 'Unknown error'}.`
          )}`
        )
      }
    } else {
      const farmWallets = await ensureDefaultWallets(supabaseClient, farmId)
      const targetWallet = farmWallets.find(w => w.wallet_type === selectedWalletType)
      if (targetWallet) {
        const sourceType =
          type === 'Income' && (catLower.includes('milk') || catLower.includes('manure'))
            ? 'MILK_MANURE'
            : type === 'Income' && catLower.includes('palai')
            ? 'PALAI_PAYMENT'
            : type === 'Income'
            ? 'ANIMAL_SALE'
            : 'DAILY_EXPENSE'

        const walletNotes = `${category} (${targetSpecies})${
          rawDescription ? ` — ${rawDescription}` : ''
        }`
        const { error: walletInsertErr } = await supabaseClient
          .from('wallet_transactions')
          .insert([
            {
              farm_id: farmId,
              wallet_id: targetWallet.id,
              reference_key: `GLOBAL_TXN:${sourceTxnId}`,
              entry_type: type === 'Income' ? 'IN' : 'OUT',
              amount: parsedAmount,
              source_type: sourceType,
              txn_date,
              notes: walletNotes,
            },
          ])
        if (walletInsertErr) {
          await supabaseClient
            .from('transactions')
            .delete()
            .eq('id', sourceTxnId)
            .eq('farm_id', farmId)
          return redirect(
            `/finances?tab=ledger&error=${encodeURIComponent(
              `Transaction failed, wallet error: ${walletInsertErr.message}.`
            )}`
          )
        }
        await recalculateWalletBalance(supabaseClient, farmId, targetWallet.id)
      }
    }

    return redirect(
      `/finances?tab=ledger&msg=${encodeURIComponent(
        `Transaction recorded under ${targetSpecies}.`
      )}`
    )
  }

  const voidTransactionAction = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const txnId = ((formData.get('txnId') as string) || '').trim()
    const source = ((formData.get('source') as string) || 'global').trim()

    if (!txnId) {
      return redirect(
        `/finances?tab=ledger&error=${encodeURIComponent('Invalid transaction ID.')}`
      )
    }

    const supabaseClient = await createClient()
    const voidStamp = `[VOID] Voided on ${getPakistanDateString()}`

    if (source === 'animal') {
      const { data: finRow, error: finFetchErr } = await supabaseClient
        .from('animal_financial_logs')
        .select('id, animal_id, notes')
        .eq('id', txnId)
        .eq('farm_id', farmId)
        .maybeSingle()

      if (finFetchErr || !finRow) {
        return redirect(
          `/finances?tab=ledger&error=${encodeURIComponent(
            finFetchErr?.message || 'Animal log not found.'
          )}`
        )
      }

      if (isVoidText(finRow.notes)) {
        return redirect(
          `/finances?tab=ledger&msg=${encodeURIComponent('Entry is already marked as VOID.')}`
        )
      }

      const nextNotes = `${voidStamp}${finRow.notes ? ` — ${finRow.notes}` : ''}`
      const { error: updErr } = await supabaseClient
        .from('animal_financial_logs')
        .update({ notes: nextNotes })
        .eq('id', txnId)
        .eq('farm_id', farmId)

      if (updErr) {
        return redirect(`/finances?tab=ledger&error=${encodeURIComponent(updErr.message)}`)
      }

      const candidateKeys = [
        `PALAI_LOG:${txnId}`,
        `SALE_TXN:${txnId}:60_CAP`,
        `SALE_TXN:${txnId}:20_OPS`,
        `SALE_TXN:${txnId}:20_OWN`,
        finRow.animal_id ? `SALE_SPLIT_60_${finRow.animal_id}` : '',
        finRow.animal_id ? `SALE_SPLIT_20_OPS_${finRow.animal_id}` : '',
        finRow.animal_id ? `SALE_SPLIT_20_OWNER_${finRow.animal_id}` : '',
      ].filter(Boolean)

      await voidLinkedWalletEntriesByReferenceKeys({
        supabase: supabaseClient,
        farmId,
        referenceKeys: candidateKeys,
        voidReason: `Animal log ${txnId} voided`,
      })
    } else {
      const { data: globalRow, error: globalFetchErr } = await supabaseClient
        .from('transactions')
        .select('id, description')
        .eq('id', txnId)
        .eq('farm_id', farmId)
        .maybeSingle()

      if (globalFetchErr || !globalRow) {
        return redirect(
          `/finances?tab=ledger&error=${encodeURIComponent(
            globalFetchErr?.message || 'Transaction not found.'
          )}`
        )
      }

      if (isVoidText(globalRow.description)) {
        return redirect(
          `/finances?tab=ledger&msg=${encodeURIComponent(
            'Transaction is already marked as VOID.'
          )}`
        )
      }

      const nextDesc = `${voidStamp}${
        globalRow.description ? ` — ${globalRow.description}` : ''
      }`
      const { error: updErr } = await supabaseClient
        .from('transactions')
        .update({ description: nextDesc })
        .eq('id', txnId)
        .eq('farm_id', farmId)

      if (updErr) {
        return redirect(`/finances?tab=ledger&error=${encodeURIComponent(updErr.message)}`)
      }

      const linkedKeys = [
        `GLOBAL_TXN:${txnId}`,
        `SALE_TXN:${txnId}:60_CAP`,
        `SALE_TXN:${txnId}:20_OPS`,
        `SALE_TXN:${txnId}:20_OWN`,
      ]

      await voidLinkedWalletEntriesByReferenceKeys({
        supabase: supabaseClient,
        farmId,
        referenceKeys: linkedKeys,
        voidReason: `Transaction ${txnId} voided`,
      })
    }

    return redirect(
      `/finances?tab=ledger&msg=${encodeURIComponent(
        'Transaction and any linked wallet entries marked as VOID; wallet balances reconciled.'
      )}`
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-800 text-sm">Unified Transaction History</h2>
              <p className="text-[11px] text-slate-400">
                Page {safePage} of {totalPages} • Showing {paginatedLedger.length} on page (
                {totalFilteredCount} matching in ledger; Active: {activeLedgerItems.length} / Total:{' '}
                {unifiedList.length})
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <FinancesExportButton rows={exportableRows} fileName={exportFileName} />
              <Link
                href={buildLedgerUrl({ filter: 'All', q: searchQuery, page: 1 })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  filterType === 'All'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                All
              </Link>
              <Link
                href={buildLedgerUrl({ filter: 'Income', q: searchQuery, page: 1 })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  filterType === 'Income'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Income
              </Link>
              <Link
                href={buildLedgerUrl({ filter: 'Expense', q: searchQuery, page: 1 })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  filterType === 'Expense'
                    ? 'bg-rose-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Expense
              </Link>
            </div>
          </div>

          <form method="GET" action="/finances" className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <input type="hidden" name="tab" value="ledger" />
            {filterType !== 'All' && <input type="hidden" name="filter" value={filterType} />}
            <input
              type="text"
              name="q"
              defaultValue={searchQuery}
              placeholder="Search by category, species, tag ID, void, notes, or amount..."
              className="flex-1 min-w-0 px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
            >
              Search
            </button>
            {(searchQuery || filterType !== 'All') && (
              <Link
                href="/finances?tab=ledger"
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
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">
                  Date
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">
                  Tag / Species
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">
                  Category
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">
                  Amount
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">
                  Notes
                </th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {paginatedLedger.length > 0 ? (
                paginatedLedger.map(txn => {
                  const isIncome = txn.type === 'Income'
                  const isVoid = Boolean(txn.isVoid)
                  return (
                    <tr
                      key={`${txn.source}-${txn.id}`}
                      className={
                        isVoid
                          ? 'bg-slate-50/80 opacity-65'
                          : 'hover:bg-slate-50 transition-colors'
                      }
                    >
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
                            {txn.targetSpecies || 'Shared (All Species)'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-xs font-bold text-slate-900">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{txn.category}</span>
                          {txn.isAutoBill && (
                            <span className="px-1.5 py-0.2 text-[10px] font-bold uppercase rounded bg-sky-50 text-sky-800 border border-sky-200">
                              BILLED
                            </span>
                          )}
                          {isVoid && (
                            <span className="px-1.5 py-0.2 text-[10px] font-bold uppercase rounded bg-amber-100 text-amber-900 border border-amber-300">
                              VOID
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={`px-5 py-4 whitespace-nowrap text-xs font-bold font-mono ${
                          isVoid
                            ? 'line-through text-slate-400'
                            : isIncome
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {isIncome ? '+' : '-'} Rs. {txn.amount.toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500 max-w-xs truncate">
                        {txn.description || '—'}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-right">
                        {!isVoid ? (
                          <form action={voidTransactionAction} className="inline-block">
                            <input type="hidden" name="txnId" value={txn.id} />
                            <input type="hidden" name="source" value={txn.source} />
                            <button
                              type="submit"
                              className="px-2.5 py-1 rounded-lg text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-xs font-semibold transition"
                            >
                              Void
                            </button>
                          </form>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-400">VOID</span>
                        )}
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

        {totalDbLedgerCount > 0 && (
          <div className="px-4 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">
              Page <strong className="text-slate-800">{safePage}</strong> of{' '}
              <strong className="text-slate-800">{totalPages}</strong>
            </span>
            <div className="flex items-center gap-2">
              {safePage > 1 ? (
                <Link
                  href={buildLedgerUrl({
                    filter: filterType,
                    q: searchQuery,
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
                  href={buildLedgerUrl({
                    filter: filterType,
                    q: searchQuery,
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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6 h-fit space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900">Add General Farm Entry</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Record farm-level overheads, rent, labor, or short-cycle sales
          </p>
        </div>

        <form action={addTransaction} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Type *</label>
              <select
                name="type"
                required
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900"
              >
                <option value="Expense">Expense (-)</option>
                <option value="Income">Income (+)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Target Species *
              </label>
              <select
                name="target_species"
                required
                defaultValue="Shared (All Species)"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900"
              >
                {SPECIES_OPTIONS.map(sp => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Wallet Account *
            </label>
            <select
              name="wallet_type"
              required
              defaultValue="OPERATING_CASH"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900"
            >
              <option value="OPERATING_CASH">1. Operating Cash (30-Day Ops)</option>
              <option value="ANIMAL_CAPITAL">2. Animal Buying Cash (Capital Only)</option>
              <option value="EMERGENCY_MORTALITY">3. Emergency / Mortality (10% Reserve)</option>
              <option value="OWNER_PROFIT">4. Owner Draw Wallet (20% Profit)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category *</label>
            <input
              name="category"
              type="text"
              list="common-categories"
              required
              placeholder="e.g. Milk Income, Manure Sale, Labor"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900"
            />
            <datalist id="common-categories">
              <option value="Milk Income (Short-Cycle)" />
              <option value="Manure Sale (Short-Cycle)" />
              <option value="Kid Crop Sale (Short-Cycle)" />
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
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Amount (PKR) *
            </label>
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
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Description (Optional)
            </label>
            <input
              name="description"
              type="text"
              placeholder="e.g. Weekly milk & khad cash collection"
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
  )
}