import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  calculateAdgKgPerDay,
  calculateAnimalBreakEven,
  daysBetweenDateStrings,
  formatDateDDMMYYYY,
} from '@/utils/breakeven'

export default async function AnimalStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ view?: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  const { data: animal } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('id', id)
    .eq('farm_id', farm.id)
    .single()

  if (!animal) return redirect('/animals')

  const [
    { data: weightLogs },
    { data: financialLogs },
    { data: medicalLogs },
  ] = await Promise.all([
    supabase
      .from('animal_weight_logs')
      .select('*')
      .eq('animal_id', id)
      .order('recorded_date', { ascending: false }),
    supabase
      .from('animal_financial_logs')
      .select('*')
      .eq('animal_id', id)
      .order('transaction_date', { ascending: false }),
    supabase
      .from('animal_medical_logs')
      .select('*')
      .eq('animal_id', id)
      .order('administered_date', { ascending: false }),
  ])

  const todayStr = new Date().toISOString().split('T')[0]
  const isSelfOwned = animal.ownership === 'Self'
  const isClientView = (await searchParams)?.view === 'client'
  const isPalai = !isSelfOwned
  const monthlyFee = Number(animal.monthly_palai_fee || animal.monthly_boarding_rate || 0)

  const purchaseCost = Number(animal.cost_basis || 0)

  const allExpenses = (financialLogs || []).filter(f => f.entry_type === 'Expense')
  const overheadExpenses = allExpenses
    .filter(f => f.category === 'Farm Overhead / Deficit Share')
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0)
  const directExpenses = allExpenses
    .filter(f => f.category !== 'Farm Overhead / Deficit Share')
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0)

  const totalLoggedExpenses = overheadExpenses + directExpenses
  const totalRevenue = (financialLogs || [])
    .filter(f => f.entry_type === 'Revenue')
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0)

  const totalCostOutflow = (isSelfOwned ? purchaseCost : 0) + totalLoggedExpenses
  const netPnL = totalRevenue - totalCostOutflow

  const latestWeight = weightLogs && weightLogs.length > 0 ? Number(weightLogs[0].weight_kg) : null
  const adgKgPerDay = calculateAdgKgPerDay(weightLogs)
  const acqDateStr = animal.acquisition_date ? String(animal.acquisition_date).split('T')[0] : null
  const activeDays = acqDateStr ? daysBetweenDateStrings(acqDateStr, todayStr, 1) : 30
  const billedMonths = Math.max(1, Math.ceil(activeDays / 30))
  const palaiTotalBilled = billedMonths * monthlyFee
  const palaiAutoBilled = (financialLogs || [])
  .filter(f => String(f.notes || '').startsWith('Auto-Bill'))
  .reduce((s, f) => s + (Number(f.amount) || 0), 0)
const palaiTotalPaid = Math.max(0, totalRevenue - palaiAutoBilled)
const palaiBalanceDue = Math.max(0, Math.max(palaiTotalBilled, palaiAutoBilled) - palaiTotalPaid)
const palaiLogs = (financialLogs || []).filter(f =>
  f.entry_type === 'Revenue' ||
  String(f.notes || '').startsWith('Auto-Bill')
)
  const breakEven = calculateAnimalBreakEven({
    purchaseCost: isSelfOwned ? purchaseCost : 0,
    loggedExpenses: totalLoggedExpenses,
    activeDays,
    latestWeight,
    adgKgPerDay,
  })

  return (
    <div className="min-h-screen bg-white text-slate-900 py-8 px-6 sm:px-12">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Action Bar (Hidden when printing) */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 print:hidden">
          <Link
            href={`/animals/${animal.id}`}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Back to Animal Profile
	  </Link>
          <div className="flex gap-2 print:hidden">
  <Link href={`/animals/${animal.id}/statement`} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!isClientView ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>Owner View</Link>
  <Link href={`/animals/${animal.id}/statement?view=client`} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${isClientView ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700'}`}>Client View</Link>
</div>

          <span className="text-xs text-slate-400">
            Press <strong>Ctrl + P</strong> (or Cmd + P) to Print / Save PDF
          </span>
        </div>

        {/* Statement Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b-2 border-slate-900 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{farm.farm_name}</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">
              {isClientView && isPalai ? 'Palai Boarding Statement' : 'Livestock Ledger & Break-Even Statement'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Generated on {formatDateDDMMYYYY(todayStr)} • Active Tenure: {activeDays} days
            </p>
          </div>
          <div className="text-left sm:text-right font-mono">
            <p className="text-xl font-bold text-slate-900">{animal.tag_id}</p>
            <p className="text-xs text-slate-600">
              {animal.species} {animal.breed_name ? `(${animal.breed_name})` : ''} • {animal.sex}
            </p>
            <p className="text-xs font-semibold text-slate-700 mt-0.5">
              {isSelfOwned ? 'Ownership: Farm-Owned (Self)' : `Palai Client: ${animal.client_name || 'N/A'}${animal.client_phone ? ` • ${animal.client_phone}` : ''}`}
            </p>
          </div>
        </div>

        {isClientView && isPalai ? (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div className="p-3.5 rounded-xl border bg-slate-50"><p className="text-[10px] font-bold uppercase text-slate-500">Monthly Palai Fee</p><p className="text-base font-bold font-mono mt-1">Rs. {monthlyFee.toLocaleString()}</p></div>
    <div className="p-3.5 rounded-xl border bg-slate-50"><p className="text-[10px] font-bold uppercase text-slate-500">Months Billed</p><p className="text-base font-bold font-mono mt-1">{billedMonths} mo ({activeDays} days)</p></div>
    <div className="p-3.5 rounded-xl border bg-slate-50"><p className="text-[10px] font-bold uppercase text-slate-500">Total Billed</p><p className="text-base font-bold font-mono mt-1">Rs. {Math.max(palaiTotalBilled, palaiAutoBilled).toLocaleString()}</p></div>
    <div className={`p-3.5 rounded-xl border ${palaiBalanceDue > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}><p className="text-[10px] font-bold uppercase text-rose-700">Balance Due</p><p className="text-base font-bold font-mono mt-1 ${palaiBalanceDue > 0 ? 'text-rose-700' : 'text-emerald-700'}">Rs. {palaiBalanceDue.toLocaleString()}</p><p className="text-[10px] text-slate-500">Paid: Rs. {palaiTotalPaid.toLocaleString()}</p></div>
  </div>
) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
            <p className="text-[10px] font-bold uppercase text-slate-500">Purchase Cost Basis</p>
            <p className="text-base font-bold font-mono text-slate-900 mt-1">
              Rs. {(isSelfOwned ? purchaseCost : 0).toLocaleString()}
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
            <p className="text-[10px] font-bold uppercase text-slate-500">Direct + Overhead Costs</p>
            <p className="text-base font-bold font-mono text-rose-700 mt-1">
              Rs. {totalLoggedExpenses.toLocaleString()}
            </p>
            <p className="text-[10px] text-slate-500">
              Direct: Rs. {directExpenses.toLocaleString()} • Overhead: Rs. {overheadExpenses.toLocaleString()}
            </p>
          </div>

          {isSelfOwned ? (
            <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50">
              <p className="text-[10px] font-bold uppercase text-amber-900">Break-Even Target (3% Comm.)</p>
              <p className="text-base font-bold font-mono text-slate-900 mt-1">
                Rs. {breakEven.breakEvenToday.toLocaleString()}
              </p>
              <p className="text-[10px] text-amber-800 font-mono">
                {breakEven.perKgToday !== null && latestWeight
                  ? `Rs. ${breakEven.perKgToday.toLocaleString()}/kg (@ ${latestWeight} kg)`
                  : `Burn: Rs. ${breakEven.dailyBurnRate.toLocaleString()}/day`}
              </p>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
              <p className="text-[10px] font-bold uppercase text-slate-500">Latest Weight</p>
              <p className="text-base font-bold font-mono text-slate-900 mt-1">
                {latestWeight !== null ? `${latestWeight} kg` : 'N/A'}
              </p>
            </div>
          )}

          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
            <p className="text-[10px] font-bold uppercase text-slate-500">
              {animal.status === 'Sold' ? 'Realized Net P&L' : 'Current Net Position'}
            </p>
            <p className={`text-base font-bold font-mono mt-1 ${netPnL >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {netPnL >= 0 ? `+Rs. ${netPnL.toLocaleString()}` : `-Rs. ${Math.abs(netPnL).toLocaleString()}`}
            </p>
            <p className="text-[10px] text-slate-500">Revenue: Rs. {totalRevenue.toLocaleString()}</p>
          </div>
        </div>
	)}
        {/* Itemized Financial Ledger */}
        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Itemized Cost &amp; Revenue Ledger
          </h2>
          <table className="w-full border border-slate-200 text-xs">
            <thead className="bg-slate-100 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Type</th>
                <th className="px-3 py-2 text-left font-semibold">Category</th>
                <th className="px-3 py-2 text-left font-semibold">Details</th>
                <th className="px-3 py-2 text-right font-semibold">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isSelfOwned && purchaseCost > 0 && (
                <tr>
                  <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(animal.acquisition_date)}</td>
                  <td className="px-3 py-2">Cost Basis</td>
                  <td className="px-3 py-2 font-semibold">Initial Purchase Price</td>
                  <td className="px-3 py-2 text-slate-500">Onboarding cost basis</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-rose-700">
                    -Rs. {purchaseCost.toLocaleString()}
                  </td>
                </tr>
              )}
              {(isClientView && isPalai ? palaiLogs : (financialLogs || [])).map(f => (
                <tr key={f.id}>
                  <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(f.transaction_date)}</td>
                  <td className="px-3 py-2">{f.entry_type}</td>
                  <td className="px-3 py-2 font-semibold">{f.category}</td>
                  <td className="px-3 py-2 text-slate-500">{f.notes || '—'}</td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-semibold ${
                      f.entry_type === 'Revenue' ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {f.entry_type === 'Revenue' ? '+' : '-'}Rs. {Number(f.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
              {(!financialLogs || financialLogs.length === 0) && (!isSelfOwned || purchaseCost <= 0) && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    No financial entries recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Weight & Medical Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">Weight History</h2>
            <table className="w-full border border-slate-200 text-xs">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Weight</th>
                  <th className="px-3 py-2 text-left font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {weightLogs && weightLogs.length > 0 ? (
                  weightLogs.map(w => (
                    <tr key={w.id}>
                      <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(w.recorded_date)}</td>
                      <td className="px-3 py-2 font-mono font-bold">{w.weight_kg} kg</td>
                      <td className="px-3 py-2 text-slate-500">{w.notes || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                      No weight logs recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">Medical &amp; Vaccination Log</h2>
            <table className="w-full border border-slate-200 text-xs">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Protocol</th>
                  <th className="px-3 py-2 text-left font-semibold">Next Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {medicalLogs && medicalLogs.length > 0 ? (
                  medicalLogs.map(m => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(m.administered_date)}</td>
                      <td className="px-3 py-2">
                        <strong>{m.treatment_type}:</strong> {m.medicine_name}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {m.next_due_date ? formatDateDDMMYYYY(m.next_due_date) : '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                      No medical records logged.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}