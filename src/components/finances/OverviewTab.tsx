import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import { formatDateDDMMYYYY } from '@/utils/breakeven'
import {
  computeWeeklyCashPulseAndRunway,
  ensureDefaultWallets,
} from '@/utils/wallets'
import {
  getPakistanDateString,
  isOverheadShareCategory,
  isVoidText,
} from '@/utils/financesHelpers'

export default async function OverviewTab({ farmId }: { farmId: string }) {
  const supabase = await createClient()
  const todayStr = getPakistanDateString()

  // Fetches ONLY Overview data: wallets, transactions, and animal_financial_logs (no Palai, contacts, weights, or audit logs)
  const [wallets, { data: globalTxns }, { data: animalFinLogs }] = await Promise.all([
    ensureDefaultWallets(supabase, farmId),
    supabase
      .from('transactions')
      .select('id, txn_date, type, category, amount, description')
      .eq('farm_id', farmId),
    supabase
      .from('animal_financial_logs')
      .select('id, entry_type, category, amount, transaction_date, notes')
      .eq('farm_id', farmId),
  ])

  const operatingWallet = wallets.find(w => w.wallet_type === 'OPERATING_CASH')
  const operatingBalance = Number(operatingWallet?.current_balance || 0)

  const activeItems = [
    ...(globalTxns || [])
      .filter((t: any) => !isVoidText(t.description))
      .map((t: any) => ({
        date: String(t.txn_date).split('T')[0],
        type: (t.type === 'Income' ? 'Income' : 'Expense') as 'Income' | 'Expense',
        category: t.category || 'General',
        amount: Number(t.amount) || 0,
        isAutoBill: false,
      })),
    ...(animalFinLogs || [])
      .filter((f: any) => !isVoidText(f.notes))
      .map((f: any) => {
        const noteStr = String(f.notes || '')
        return {
          date: String(f.transaction_date).split('T')[0],
          type: (f.entry_type === 'Revenue' ? 'Income' : 'Expense') as 'Income' | 'Expense',
          category: f.category || 'General',
          amount: Number(f.amount) || 0,
          isAutoBill: noteStr.startsWith('Auto-Bill'),
        }
      }),
  ]

  const totalBilledIncome = activeItems
    .filter(t => t.type === 'Income')
    .reduce((acc, t) => acc + t.amount, 0)

  const totalCashReceived = activeItems
    .filter(t => t.type === 'Income' && !t.isAutoBill)
    .reduce((acc, t) => acc + t.amount, 0)

  const totalIncome = totalCashReceived

  const totalExpense = activeItems
    .filter(t => t.type === 'Expense' && !isOverheadShareCategory(t.category))
    .reduce((acc, t) => acc + t.amount, 0)

  const netBalance = totalIncome - totalExpense

  const cashItemsForAnalytics = activeItems
    .filter(item => !item.isAutoBill && !isOverheadShareCategory(item.category))
    .map(item => ({
      date: item.date,
      type: item.type,
      category: item.category,
      amount: item.amount,
    }))

  // Phase 2: Weekly Cash Out vs Cash In Red Flag + 30-Day Operating Runway
  const cashPulse = computeWeeklyCashPulseAndRunway({
    items: cashItemsForAnalytics,
    todayStr,
    operatingBalance,
    manualThirtyDayTarget: Number(operatingWallet?.target_buffer_amount || 0),
  })

  const thirtyDayOperatingTarget = cashPulse.thirtyDayTargetRequired
  const runwayProgressPct =
    thirtyDayOperatingTarget > 0
      ? Math.min(100, Math.round((Math.max(0, operatingBalance) / thirtyDayOperatingTarget) * 100))
      : operatingBalance > 0
      ? 100
      : 0

  const expenseByCategory: Record<string, number> = {}
  activeItems
    .filter(t => t.type === 'Expense')
    .forEach(t => {
      const cat = t.category || 'General'
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + t.amount
    })

  const sortedExpenseCategories = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Summary Cards (Active Cash Only; Auto-Bill Receivables & Allocated Overhead Excluded) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-sky-500">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Billed (Incl. Auto-Bill)
          </p>
          <p className="text-2xl font-bold text-sky-700 mt-1">
            Rs. {totalBilledIncome.toLocaleString()}
          </p>
        </div>
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-emerald-500">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Cash Received
          </p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            Rs. {totalCashReceived.toLocaleString()}
          </p>
        </div>
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-rose-500">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Total Active Expenses
          </p>
          <p className="text-2xl font-bold text-rose-600 mt-1">
            Rs. {totalExpense.toLocaleString()}
          </p>
        </div>
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-indigo-500">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Net Cash Balance
          </p>
          <p
            className={`text-2xl font-bold mt-1 ${
              netBalance >= 0 ? 'text-indigo-600' : 'text-rose-600'
            }`}
          >
            Rs. {netBalance.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Phase 2: Weekly Cash Out vs Cash In Red Flag Card + 30-Day Runway */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          className={`lg:col-span-2 p-5 sm:p-6 rounded-2xl border shadow-sm space-y-4 ${
            cashPulse.isRedFlag
              ? 'bg-rose-50/70 border-rose-300'
              : 'bg-emerald-50/60 border-emerald-200'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded-full border ${
                    cashPulse.isRedFlag
                      ? 'bg-rose-600 text-white border-rose-700'
                      : 'bg-emerald-600 text-white border-emerald-700'
                  }`}
                >
                  {cashPulse.isRedFlag ? '🚩 Weekly Cash Red Flag' : '✅ Weekly Cash Healthy'}
                </span>
                <span className="text-xs font-mono text-slate-600">
                  {formatDateDDMMYYYY(cashPulse.windowStartDate)} →{' '}
                  {formatDateDDMMYYYY(cashPulse.windowEndDate)} (7d)
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 mt-1.5">
                Weekly Cash Out vs. Cash In Monitor
              </h2>
            </div>

            {cashPulse.isRedFlag && (
              <Link
                href="/finances?tab=wallets#breakeven-sync"
                className="px-3.5 py-2 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-xl text-xs shadow-xs transition shrink-0 text-center"
              >
                ⚖️ Review Overhead Sync
              </Link>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-white border border-slate-200/90">
              <p className="text-[11px] font-semibold uppercase text-slate-500">
                7d Cash Out (Feed + Labour + Med)
              </p>
              <p className="text-xl font-bold font-mono text-rose-700 mt-1">
                Rs. {cashPulse.coreCashOut7d.toLocaleString()}
              </p>
              {cashPulse.otherCashOut7d > 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  + Rs. {cashPulse.otherCashOut7d.toLocaleString()} other ops
                </p>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-slate-200/90">
              <p className="text-[11px] font-semibold uppercase text-slate-500">
                7d Cash In (Milk + Manure + Sales)
              </p>
              <p className="text-xl font-bold font-mono text-emerald-700 mt-1">
                Rs. {cashPulse.shortCycleCashIn7d.toLocaleString()}
              </p>
              {cashPulse.palaiCashIn7d > 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  + Rs. {cashPulse.palaiCashIn7d.toLocaleString()} Palai receipts
                </p>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-white border border-slate-200/90">
              <p className="text-[11px] font-semibold uppercase text-slate-500">
                7-Day Net Cash Gap
              </p>
              <p
                className={`text-xl font-bold font-mono mt-1 ${
                  cashPulse.weeklyNetGap >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {cashPulse.weeklyNetGap >= 0
                  ? `+Rs. ${cashPulse.weeklyNetGap.toLocaleString()}`
                  : `-Rs. ${Math.abs(cashPulse.weeklyNetGap).toLocaleString()}`}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {cashPulse.isRedFlag
                  ? 'Weekly burn ahead of short-cycle cash'
                  : 'Short-cycle inflows covering weekly burn'}
              </p>
            </div>
          </div>
        </div>

        {/* 30-Day Operating Runway Meter */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                30-Day Runway Rule
              </span>
              <span className="text-xs font-mono font-bold text-slate-700">
                {cashPulse.runwayDays !== null ? `${cashPulse.runwayDays} days` : '—'}
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900 pt-1">Operating Cash Buffer</h2>
            <p className="text-xs text-slate-500">
              Wallet 1 must hold 30 days of Feed + Labour + Medicine cash
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono text-slate-900">
                Rs. {operatingBalance.toLocaleString()}
              </span>
              <span className="text-xs font-mono text-slate-500">
                / Rs. {thirtyDayOperatingTarget.toLocaleString()}
              </span>
            </div>

            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  runwayProgressPct >= 100
                    ? 'bg-emerald-500'
                    : runwayProgressPct >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
                style={{ width: `${runwayProgressPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span>
                Avg Burn:{' '}
                <strong className="font-mono text-slate-800">
                  Rs. {cashPulse.avgDailyOperatingBurn.toLocaleString()}/day
                </strong>
              </span>
              {cashPulse.operatingShortfall > 0 ? (
                <span className="font-mono font-semibold text-rose-700">
                  Top-up: Rs. {cashPulse.operatingShortfall.toLocaleString()}
                </span>
              ) : (
                <span className="font-semibold text-emerald-700">30d Target Met</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Cash In vs Cash Out Ratio
          </h2>
          {totalIncome + totalExpense > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-emerald-600">
                  Cash In: {Math.round((totalIncome / (totalIncome + totalExpense || 1)) * 100)}%
                </span>
                <span className="text-rose-600">
                  Cash Out: {Math.round((totalExpense / (totalIncome + totalExpense || 1)) * 100)}%
                </span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{
                    width: `${(totalIncome / (totalIncome + totalExpense || 1)) * 100}%`,
                  }}
                ></div>
                <div
                  className="bg-rose-500 h-full transition-all duration-500"
                  style={{
                    width: `${(totalExpense / (totalIncome + totalExpense || 1)) * 100}%`,
                  }}
                ></div>
              </div>
              <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>Cash Inflows: Rs. {totalIncome.toLocaleString()}</span>
                <span>Cash Outflows: Rs. {totalExpense.toLocaleString()}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-4 text-center">
              No active cash flow data available for ratio analysis yet.
            </p>
          )}
        </div>

        <div className="lg:col-span-2 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Expense Breakdown by Category (Active)
          </h2>
          {sortedExpenseCategories.length > 0 ? (
            <div className="space-y-3">
              {sortedExpenseCategories.map(([category, amount]) => {
                const totalBreakdownBase = sortedExpenseCategories.reduce((s, [, v]) => s + v, 0)
                const percentage =
                  totalBreakdownBase > 0 ? Math.round((amount / totalBreakdownBase) * 100) : 0
                return (
                  <div key={category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">{category}</span>
                      <span className="font-mono font-semibold text-slate-600">
                        Rs. {amount.toLocaleString()}{' '}
                        <span className="text-slate-400 font-normal">({percentage}%)</span>
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
            <p className="text-xs text-slate-400 py-4 text-center">
              No active expense categories recorded yet.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}