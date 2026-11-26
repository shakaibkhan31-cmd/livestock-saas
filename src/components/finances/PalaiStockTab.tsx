import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getUserFarmAndRole } from '@/utils/rbac'
import {
  daysBetweenDateStrings,
  formatDateDDMMYYYY,
} from '@/utils/breakeven'
import {
  CASH_CYCLE_ROLES,
  STAGGERED_BATCH_DEFINITIONS,
  computeStaggeredBatchesAndShortCycle,
  ensureDefaultWallets,
  recalculateWalletBalance,
} from '@/utils/wallets'
import {
  addDaysToDateString,
  buildPalaiWhatsAppReminderUrl,
  getPakistanDateString,
  inferBatchLabelFromAcquisition,
  isActiveStatus,
  isAseelChick,
  isChickenSpecies,
  isMeatFatteningRole,
  isOverheadShareCategory,
  isSelfOwnership,
  isVoidText,
  normalizeText,
} from '@/utils/financesHelpers'

export default async function PalaiStockTab({
  farmId,
  farmName,
}: {
  farmId: string
  farmName: string
}) {
  const supabase = await createClient()
  const todayStr = getPakistanDateString()
  const currentMonthStr = todayStr.slice(0, 7)

  // Fetches ONLY Palai, Livestock Batches, Poultry, Contacts & Short-Cycle Income data
  const [
    { data: allFarmLivestock },
    { data: allGlobalTxnsForTotals },
    { data: allAnimalFinLogsForTotals },
    { data: contactsList },
  ] = await Promise.all([
    supabase
      .from('livestock_master')
      .select(
        'id, tag_id, species, breed_name, ownership, client_name, monthly_palai_fee, acquisition_date, status, cost_basis, batch_label, cash_cycle_role'
      )
      .eq('farm_id', farmId),
    supabase
      .from('transactions')
      .select('id, txn_date, type, category, amount, description')
      .eq('farm_id', farmId),
    supabase
      .from('animal_financial_logs')
      .select('id, animal_id, entry_type, category, amount, transaction_date, notes')
      .eq('farm_id', farmId),
    supabase.from('contacts').select('id, name, phone').eq('farm_id', farmId),
  ])

  const activeFarmLivestock = (allFarmLivestock || []).filter((a: any) => isActiveStatus(a.status))
  const selfAnimals = activeFarmLivestock.filter((a: any) => isSelfOwnership(a.ownership))
  const palaiAnimals = activeFarmLivestock.filter((a: any) => !isSelfOwnership(a.ownership))

  const animalFinLogs = allAnimalFinLogsForTotals || []

  const contactPhoneByName: Record<string, string> = {}
  ;(contactsList || []).forEach(c => {
    const key = (c.name || '').trim().toLowerCase()
    if (key && c.phone) {
      contactPhoneByName[key] = c.phone
    }
  })

  // Palai Client Billing & Dues Statement per active Palai animal (30-day advance blocks)
  const palaiClientLedger = palaiAnimals.map(a => {
    const rate = Number(a.monthly_palai_fee) > 0 ? Number(a.monthly_palai_fee) : 5000
    const acqStr = a.acquisition_date ? String(a.acquisition_date).split('T')[0] : todayStr
    const daysBoarded = Math.max(1, daysBetweenDateStrings(acqStr, todayStr, 1))
    // BUSINESS RULE: Palai is billed in non-refundable 30-day advance blocks.
    const billedMonths = Math.max(1, Math.ceil(daysBoarded / 30))
    const billedDays = billedMonths * 30
    const nextBillingDateStr = addDaysToDateString(acqStr, billedDays)
    const accruedBoarding = rate * billedMonths

    const animalRevenueLogs = animalFinLogs.filter(
      (f: any) => f.animal_id === a.id && f.entry_type === 'Revenue' && !isVoidText(f.notes)
    )

    const autoBilledRevenue = animalRevenueLogs
      .filter((f: any) => String(f.notes || '').startsWith('Auto-Bill'))
      .reduce((sum: number, f: any) => sum + (Number(f.amount) || 0), 0)

    const totalRevenueRecorded = animalRevenueLogs.reduce(
      (sum: number, f: any) => sum + (Number(f.amount) || 0),
      0
    )

    const totalBilled = Math.max(accruedBoarding, autoBilledRevenue)
    const totalPaid = Math.max(0, totalRevenueRecorded - autoBilledRevenue)
    const balanceDue = Math.max(0, totalBilled - totalPaid)
    const clientName = a.client_name || 'Unnamed Client'
    const phone = contactPhoneByName[clientName.trim().toLowerCase()] || null

    const whatsappUrl =
      balanceDue > 0
        ? buildPalaiWhatsAppReminderUrl({
            farmName,
            clientName,
            tagId: a.tag_id,
            species: a.species || 'Goat',
            monthlyFee: rate,
            billedMonths,
            totalBilled,
            totalPaid,
            balanceDue,
            phone,
          })
        : null

    return {
      id: a.id,
      tag_id: a.tag_id,
      species: a.species || 'Goat',
      client_name: clientName,
      phone,
      monthly_fee: rate,
      daysBoarded,
      billedMonths,
      billedDays,
      nextBillingDate: nextBillingDateStr,
      totalBilled,
      totalPaid,
      balanceDue,
      whatsappUrl,
    }
  })

  const totalPalaiBilled = palaiClientLedger.reduce((s, r) => s + r.totalBilled, 0)
  const totalPalaiPaid = palaiClientLedger.reduce((s, r) => s + r.totalPaid, 0)
  const totalPalaiDue = palaiClientLedger.reduce((s, r) => s + r.balanceDue, 0)
  const overduePalaiClients = palaiClientLedger.filter(r => r.balanceDue > 0)

  // Cash items for 30-day Short-Cycle Cash Engine Summary
  const cashItemsForAnalytics = [
    ...(allGlobalTxnsForTotals || [])
      .filter((t: any) => !isVoidText(t.description) && !isOverheadShareCategory(t.category))
      .map((t: any) => ({
        date: String(t.txn_date).split('T')[0],
        type: (t.type === 'Income' ? 'Income' : 'Expense') as 'Income' | 'Expense',
        category: t.category || 'General',
        amount: Number(t.amount) || 0,
      })),
    ...animalFinLogs
      .filter((f: any) => {
        const noteStr = String(f.notes || '')
        return (
          !isVoidText(noteStr) &&
          !noteStr.startsWith('Auto-Bill') &&
          !isOverheadShareCategory(f.category)
        )
      })
      .map((f: any) => ({
        date: String(f.transaction_date).split('T')[0],
        type: (f.entry_type === 'Revenue' ? 'Income' : 'Expense') as 'Income' | 'Expense',
        category: f.category || 'General',
        amount: Number(f.amount) || 0,
      })),
  ]

  // Phase 3: Staggered Batches (Jan-Jul / Mar-Sep / May-Nov) + Short-Cycle Cash Mix
  const { batches: staggeredBatches, shortCycleMix } = computeStaggeredBatchesAndShortCycle({
    selfAnimals,
    items: cashItemsForAnalytics,
    todayStr,
  })

  // ONLY Goat / Sheep Meat goes in Staggered Batches
  const meatSelfAnimals = selfAnimals.filter(
    (a: any) => isMeatFatteningRole(a.cash_cycle_role) && !isChickenSpecies(a.species)
  )
  const nonSaleSelfAnimals = selfAnimals.filter(
    (a: any) => !isMeatFatteningRole(a.cash_cycle_role) && !isChickenSpecies(a.species)
  )

  // Poultry Stock breakdown
  const poultryAnimals = selfAnimals.filter((a: any) => isChickenSpecies(a.species))
  const desiLayerAnimals = poultryAnimals.filter((a: any) =>
    normalizeText(a.breed_name).includes('desi')
  )
  const aseelAllAnimals = poultryAnimals.filter((a: any) =>
    normalizeText(a.breed_name).includes('aseel')
  )
  const aseelChicksAnimals = aseelAllAnimals.filter((a: any) => isAseelChick(a))
  const aseelBreedersAnimals = aseelAllAnimals.filter((a: any) => !isAseelChick(a))
  const unclassifiedPoultryAnimals = poultryAnimals.filter((a: any) => {
    const b = normalizeText(a.breed_name)
    return !b.includes('desi') && !b.includes('aseel')
  })

  const desiCostBasis = desiLayerAnimals.reduce((s, a: any) => s + (Number(a.cost_basis) || 0), 0)
  const aseelCostBasis = aseelBreedersAnimals.reduce(
    (s, a: any) => s + (Number(a.cost_basis) || 0),
    0
  )
  const unclassifiedPoultryCostBasis = unclassifiedPoultryAnimals.reduce(
    (s, a: any) => s + (Number(a.cost_basis) || 0),
    0
  )

  const meatAnimalsByBatchLabel: Record<string, Array<any>> = {}
  STAGGERED_BATCH_DEFINITIONS.forEach(def => {
    meatAnimalsByBatchLabel[def.label] = []
  })

  meatSelfAnimals.forEach((a: any) => {
    const resolvedBatch =
      a.batch_label && meatAnimalsByBatchLabel[a.batch_label]
        ? a.batch_label
        : inferBatchLabelFromAcquisition(a.acquisition_date, todayStr)
    meatAnimalsByBatchLabel[resolvedBatch].push(a)
  })

  const filteredBatchCards = staggeredBatches.map(batch => {
    const sellableAnimals = meatAnimalsByBatchLabel[batch.label] || []
    const sellableCount = sellableAnimals.length
    const sellableCostBasis = sellableAnimals.reduce(
      (sum, a) => sum + (Number(a.cost_basis) || 0),
      0
    )
    const sellableTags = sellableAnimals.map((a: any) => String(a.tag_id))

    const canShowSellBadge = batch.phaseNow === 'SELL_WINDOW' && sellableCount > 0
    const badgeLabel = canShowSellBadge
      ? 'SELL / HARVEST'
      : batch.phaseNow === 'BUY_WINDOW'
      ? 'BUY WINDOW'
      : sellableCount === 0 && batch.phaseNow === 'SELL_WINDOW'
      ? 'NO MEAT STOCK FOR SALE'
      : 'GROWOUT PHASE'

    const badgeStyle = canShowSellBadge
      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
      : batch.phaseNow === 'BUY_WINDOW'
      ? 'bg-blue-100 text-blue-800 border-blue-300'
      : 'bg-slate-100 text-slate-700 border-slate-300'

    return {
      ...batch,
      sellableCount,
      sellableCostBasis,
      sellableTags,
      badgeLabel,
      badgeStyle,
    }
  })

  const assignBatchAndCycleAction = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const animalId = ((formData.get('animalId') as string) || '').trim()
    const batchLabel = ((formData.get('batch_label') as string) || '').trim()
    const cashCycleRole = (
      (formData.get('cash_cycle_role') as string) || 'Meat / Fattening'
    ).trim()

    if (!animalId || !batchLabel) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent('Select an animal and batch cycle.')}`
      )
    }

    const supabaseClient = await createClient()
    const { error: updErr } = await supabaseClient
      .from('livestock_master')
      .update({
        batch_label: batchLabel,
        cash_cycle_role: cashCycleRole,
      })
      .eq('id', animalId)
      .eq('farm_id', farmId)

    if (updErr) {
      return redirect(`/finances?tab=palai&error=${encodeURIComponent(updErr.message)}`)
    }

    return redirect(
      `/finances?tab=palai&msg=${encodeURIComponent(
        `Updated animal rotation to ${batchLabel} (${cashCycleRole}).`
      )}`
    )
  }

  const runMonthlyPalaiBilling = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const billingMonth = formData.get('billing_month') as string
    const defaultFee = parseFloat(formData.get('default_fee') as string) || 5000

    const supabaseClient = await createClient()

    const { data: farmAnimals } = await supabaseClient
      .from('livestock_master')
      .select('id, tag_id, ownership, status, client_name, monthly_palai_fee')
      .eq('farm_id', farmId)

    const activePalai = (farmAnimals || []).filter(
      (a: any) => isActiveStatus(a.status) && !isSelfOwnership(a.ownership)
    )

    if (activePalai.length === 0) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          'No active Palai animals found for billing.'
        )}`
      )
    }

    const billingNoteTag = `Auto-Bill (${billingMonth})`
    const billingDate = `${billingMonth}-01`

    const { data: existingBillingRows, error: existingBillingErr } = await supabaseClient
      .from('animal_financial_logs')
      .select('animal_id, notes')
      .eq('farm_id', farmId)
      .eq('category', 'Palai Monthly Fee')
      .ilike('notes', `${billingNoteTag}%`)

    if (existingBillingErr) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          'Could not check existing Palai bills: ' + existingBillingErr.message
        )}`
      )
    }

    const alreadyBilledAnimalIds = new Set(
      (existingBillingRows || [])
        .filter((r: any) => !isVoidText(r.notes))
        .map((r: any) => r.animal_id)
    )

    const billingInserts = activePalai
      .filter((animal: any) => !alreadyBilledAnimalIds.has(animal.id))
      .map((animal: any) => ({
        farm_id: farmId,
        animal_id: animal.id,
        entry_type: 'Revenue',
        category: 'Palai Monthly Fee',
        amount:
          Number(animal.monthly_palai_fee) > 0 ? Number(animal.monthly_palai_fee) : defaultFee,
        transaction_date: billingDate,
        notes: billingNoteTag,
      }))

    const billedCount = billingInserts.length
    if (billedCount > 0) {
      const { error: billingInsertErr } = await supabaseClient
        .from('animal_financial_logs')
        .insert(billingInserts)

      if (billingInsertErr) {
        return redirect(
          `/finances?tab=palai&error=${encodeURIComponent(
            'Palai billing failed: ' + billingInsertErr.message
          )}`
        )
      }
    }

    if (billedCount === 0) {
      return redirect(
        `/finances?tab=palai&msg=${encodeURIComponent(
          `All Palai animals were already billed for ${billingMonth}.`
        )}`
      )
    }

    return redirect(
      `/finances?tab=palai&msg=${encodeURIComponent(
        `Generated monthly Palai bills for ${billedCount} animal(s) for ${billingMonth} (Billed receivable only; cash recorded when client pays).`
      )}`
    )
  }

  const logPalaiPaymentAction = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const animalId = ((formData.get('animalId') as string) || '').trim()
    const amount = parseFloat((formData.get('amount') as string) || '0')
    const paymentDate =
      ((formData.get('payment_date') as string) || '').trim() || getPakistanDateString()
    const notes =
      ((formData.get('notes') as string) || '').trim() || 'Palai Client Boarding Payment'

    if (!animalId || isNaN(amount) || amount <= 0) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          'Enter a valid payment amount greater than 0.'
        )}`
      )
    }

    const supabaseClient = await createClient()

    const { data: palaiRow } = await supabaseClient
      .from('livestock_master')
      .select('id, tag_id, client_name')
      .eq('id', animalId)
      .eq('farm_id', farmId)
      .single()

    if (!palaiRow) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent('Palai animal not found.')}`
      )
    }

    const { data: insertedPayLog, error: payErr } = await supabaseClient
      .from('animal_financial_logs')
      .insert([
        {
          farm_id: farmId,
          animal_id: animalId,
          entry_type: 'Revenue',
          category: 'Palai Boarding Fee',
          amount,
          transaction_date: paymentDate,
          notes: `${notes} (${palaiRow.client_name || palaiRow.tag_id})`,
        },
      ])
      .select('id')
      .single()

    if (payErr || !insertedPayLog) {
      return redirect(
        `/finances?tab=palai&error=${encodeURIComponent(
          payErr?.message || 'Failed to log Palai payment.'
        )}`
      )
    }

    const farmWallets = await ensureDefaultWallets(supabaseClient, farmId)
    const opWallet = farmWallets.find(w => w.wallet_type === 'OPERATING_CASH')
    if (opWallet) {
      const refKey = `PALAI_LOG:${insertedPayLog.id}`
      const { error: wtErr } = await supabaseClient.from('wallet_transactions').insert([
        {
          farm_id: farmId,
          wallet_id: opWallet.id,
          animal_id: animalId,
          reference_key: refKey,
          entry_type: 'IN',
          amount,
          source_type: 'PALAI_PAYMENT',
          txn_date: paymentDate,
          notes: `Palai Payment: ${palaiRow.tag_id} (${palaiRow.client_name || 'Client'})`,
        },
      ])
      if (wtErr) {
        await supabaseClient
          .from('animal_financial_logs')
          .delete()
          .eq('id', insertedPayLog.id)
          .eq('farm_id', farmId)
        return redirect(
          `/finances?tab=palai&error=${encodeURIComponent(
            'Palai payment failed, wallet error: ' + wtErr.message
          )}`
        )
      }
      await recalculateWalletBalance(supabaseClient, farmId, opWallet.id)
    }

    return redirect(
      `/finances?tab=palai&msg=${encodeURIComponent(
        `Logged Palai payment of Rs. ${amount.toLocaleString()} for ${palaiRow.tag_id} (${
          palaiRow.client_name || 'Client'
        }) into Operating Cash.`
      )}`
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Monthly Palai Auto-Billing Engine Banner */}
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-5 sm:p-6 rounded-2xl shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-500/30 border border-indigo-400/40 rounded-md">
              Automated Billing (Receivable Only)
            </span>
            <span className="text-xs text-indigo-200">
              Active Palai Animals: <strong>{palaiAnimals.length}</strong>
            </span>
          </div>
          <h2 className="text-lg font-bold">Monthly Palai Auto-Billing Generator</h2>
          <p className="text-xs text-slate-300 max-w-xl">
            Generate monthly boarding bills (receivables) for active client animals in
            non-refundable 30-day blocks. Billing creates dues—cash is only recorded when payment
            is logged.
          </p>
        </div>

        <form
          action={runMonthlyPalaiBilling}
          className="flex flex-wrap items-end gap-3 bg-white/10 p-4 rounded-xl border border-white/15"
        >
          <div>
            <label className="block text-[11px] font-semibold text-indigo-200 mb-1">
              Billing Month
            </label>
            <input
              name="billing_month"
              type="month"
              required
              defaultValue={currentMonthStr}
              className="px-3 py-2 bg-white text-slate-900 rounded-lg text-xs font-mono font-bold"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-indigo-200 mb-1">
              Default Fee (PKR)
            </label>
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

      {/* Palai Client Billing & Dues Ledger + WhatsApp Reminders */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Palai Client Billing &amp; Statement Ledger
            </h2>
            <p className="text-xs text-slate-500">
              Total Billed (30-day blocks) vs. Total Cash Received from client payments, with
              1-click WhatsApp reminders for overdue dues
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-semibold">
              Total Billed: Rs. {totalPalaiBilled.toLocaleString()}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              Total Cash Received: Rs. {totalPalaiPaid.toLocaleString()}
            </span>
            <span
              className={`px-2.5 py-1 rounded-lg font-bold border ${
                totalPalaiDue > 0
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              Due: Rs. {totalPalaiDue.toLocaleString()} ({overduePalaiClients.length})
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Client &amp; Tag
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Rate / Tenure
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Total Billed
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Total Cash Received
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">
                  Balance Due
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase">
                  WhatsApp &amp; Payment
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {palaiClientLedger.length > 0 ? (
                palaiClientLedger.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{row.client_name}</span>
                        {row.phone && (
                          <span className="text-[10px] font-mono text-slate-400">
                            ({row.phone})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Link
                          href={`/animals/${row.id}`}
                          className="font-mono text-[11px] font-bold text-indigo-700 hover:underline"
                        >
                          {row.tag_id}
                        </Link>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                          {row.species}
                        </span>
                        <Link
                          href={`/animals/${row.id}/statement`}
                          className="text-[10px] font-semibold text-slate-500 hover:text-slate-900 underline"
                        >
                          Statement
                        </Link>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono text-slate-700 whitespace-nowrap">
                      <div>Rs. {row.monthly_fee.toLocaleString()}/mo</div>
                      <div className="text-[10px] text-slate-400 space-y-0.5">
                        <div>
                          {row.daysBoarded}d ({row.billedMonths} × 30d blocks)
                        </div>
                        <div>Next block: {formatDateDDMMYYYY(row.nextBillingDate)}</div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono font-bold text-slate-900 whitespace-nowrap">
                      Rs. {row.totalBilled.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono font-semibold text-emerald-700 whitespace-nowrap">
                      Rs. {row.totalPaid.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono font-bold whitespace-nowrap">
                      {row.balanceDue > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                          Rs. {row.balanceDue.toLocaleString()} Due
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Settled
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        {row.balanceDue > 0 && row.whatsappUrl && (
                          <a
                            href={row.whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={
                              row.phone
                                ? `Send WhatsApp reminder to ${row.phone}`
                                : 'Open WhatsApp with pre-filled reminder (pick contact)'
                            }
                            className="px-2.5 py-1 bg-green-50 hover:bg-green-100 text-green-800 border border-green-300 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1"
                          >
                            <span>💬 Remind</span>
                          </a>
                        )}

                        {row.balanceDue <= 0 ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                            ✓ Paid
                          </span>
                        ) : (
                          <form
                            action={logPalaiPaymentAction}
                            className="inline-flex items-center gap-1.5"
                          >
                            <input type="hidden" name="animalId" value={row.id} />
                            <input type="hidden" name="payment_date" value={todayStr} />
                            <input
                              name="amount"
                              type="number"
                              min="1"
                              step="1"
                              required
                              defaultValue={row.balanceDue}
                              className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-xs font-mono text-right text-slate-900"
                            />
                            <button
                              type="submit"
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                            >
                              + Pay
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-slate-400">
                    No active Palai (client boarding) animals found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phase 3: Staggered Batches (Jan-Jul / Mar-Sep / May-Nov) + Breeding + Poultry + Short-Cycle Cash Mix */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                Staggered Batches &amp; Short-Cycle Cash
              </span>
              {shortCycleMix.unassignedBatchCount > 0 && (
                <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  {shortCycleMix.unassignedBatchCount} Self animal(s) auto-grouped by acquisition
                  date
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-1">
              6-Month Staggered Batch Rotation (Jan–Jul • Mar–Sep • May–Nov)
            </h2>
            <p className="text-xs text-slate-500">
              Batch cards track <strong>Goat / Sheep Meat</strong> sellable stock only; Breeding /
              Milk / Kid Crop stock is separated below as non-sale assets
            </p>
          </div>

          {selfAnimals.length > 0 && (
            <form
              action={assignBatchAndCycleAction}
              className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200"
            >
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  Self Animal
                </label>
                <select
                  name="animalId"
                  required
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900"
                >
                  {selfAnimals.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.tag_id} ({a.species}) — {a.cash_cycle_role || 'Meat / Fattening'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  Batch Window
                </label>
                <select
                  name="batch_label"
                  defaultValue={STAGGERED_BATCH_DEFINITIONS[0].label}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
                >
                  {STAGGERED_BATCH_DEFINITIONS.map(b => (
                    <option key={b.key} value={b.label}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  Cash Cycle Role
                </label>
                <select
                  name="cash_cycle_role"
                  defaultValue={CASH_CYCLE_ROLES[0]}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
                >
                  {CASH_CYCLE_ROLES.map(r => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs transition"
              >
                Assign Cycle
              </button>
            </form>
          )}
        </div>

        {/* 3 Overlapping Batches (Goat / Sheep Meat Only) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filteredBatchCards.map(batch => (
            <div
              key={batch.key}
              className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">{batch.label}</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${batch.badgeStyle}`}
                >
                  {batch.badgeLabel}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold font-mono text-slate-900">
                  {batch.sellableCount}{' '}
                  <span className="text-xs font-sans font-normal text-slate-500">meat head</span>
                </span>
                <span className="text-xs font-mono font-semibold text-slate-700">
                  Rs. {batch.sellableCostBasis.toLocaleString()}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Buy: <strong>{batch.buyWindow}</strong> • Sell: <strong>{batch.sellWindow}</strong>
              </p>
              <div className="flex flex-wrap gap-1 pt-1">
                {batch.sellableTags.length > 0 ? (
                  batch.sellableTags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-white border border-slate-200 text-slate-800"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 italic">
                    No Goat / Sheep Meat stock in this batch
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Dedicated Non-Sale Stock Section: Breeding Stock (Not for Sale) */}
        <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/90 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-900 text-white">
                Breeding Stock (Not for Sale)
              </span>
              <span className="text-xs font-bold text-slate-900">
                {nonSaleSelfAnimals.length} head protected from SELL / HARVEST badges
              </span>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-700">
              Asset Value: Rs.{' '}
              {nonSaleSelfAnimals
                .reduce((sum: number, a: any) => sum + (Number(a.cost_basis) || 0), 0)
                .toLocaleString()}
            </span>
          </div>

          {nonSaleSelfAnimals.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {nonSaleSelfAnimals.map((a: any) => {
                const batchLabel =
                  a.batch_label || inferBatchLabelFromAcquisition(a.acquisition_date, todayStr)
                return (
                  <div
                    key={a.id}
                    className="px-3 py-1.5 rounded-lg bg-white border border-amber-200 text-xs flex items-center gap-2"
                  >
                    <Link
                      href={`/animals/${a.id}`}
                      className="font-mono font-bold text-slate-900 hover:text-indigo-600"
                    >
                      {a.tag_id}
                    </Link>
                    <span className="text-[11px] text-amber-900 font-semibold">
                      {a.cash_cycle_role || 'Breeding / Kid Crop'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">({batchLabel})</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No animals assigned to Breeding / Milk / Kid Crop roles.
            </p>
          )}
        </div>

        {/* Poultry Stock Section */}
        <div className="p-4 rounded-xl bg-sky-50/50 border border-sky-200/90 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-sky-900 text-white">
                Poultry Stock
              </span>
              <span className="text-xs font-bold text-slate-900">
                {poultryAnimals.length} bird(s) separated from Goat Batches
              </span>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-700">
              Total Poultry Cost Basis: Rs.{' '}
              {poultryAnimals
                .reduce((sum: number, a: any) => sum + (Number(a.cost_basis) || 0), 0)
                .toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Card 1: Desi Layers */}
            <div className="p-3.5 rounded-xl bg-white border border-sky-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">Desi Layers</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-sky-100 text-sky-900 border border-sky-200">
                  Eggs for Sale
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-base font-bold font-mono text-slate-900">
                  {desiLayerAnimals.length} head
                </span>
                <span className="text-xs font-mono font-semibold text-slate-700">
                  Cost Basis: Rs. {desiCostBasis.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {desiLayerAnimals.length > 0 ? (
                  desiLayerAnimals.map((a: any) => (
                    <span
                      key={a.id}
                      className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-50 border border-slate-200 text-slate-800"
                    >
                      {a.tag_id}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 italic">No Desi birds</span>
                )}
              </div>
            </div>

            {/* Card 2: Aseel Breeders + Aseel Chicks */}
            <div className="p-3.5 rounded-xl bg-white border border-sky-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">Aseel Breeders</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200">
                  Eggs -&gt; Chicks -&gt; Sale at 3 Months
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-base font-bold font-mono text-slate-900">
                  {aseelBreedersAnimals.length} head
                </span>
                <span className="text-xs font-mono font-semibold text-slate-700">
                  Cost Basis: Rs. {aseelCostBasis.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {aseelBreedersAnimals.length > 0 ? (
                  aseelBreedersAnimals.map((a: any) => (
                    <span
                      key={a.id}
                      className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-50 border border-slate-200 text-slate-800"
                    >
                      {a.tag_id}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 italic">No Aseel breeders</span>
                )}
              </div>
              <p className="text-[11px] font-mono text-slate-600 pt-1 border-t border-slate-100">
                Aseel Chicks (0-3 Months): <strong>{aseelChicksAnimals.length} head</strong>
              </p>
            </div>
          </div>

          {unclassifiedPoultryAnimals.length > 0 && (
            <div className="p-3 rounded-xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-bold text-slate-800">Unclassified Poultry:</span>{' '}
                <span className="font-mono font-bold text-slate-900">
                  {unclassifiedPoultryAnimals.length} head
                </span>{' '}
                <span className="text-slate-500">
                  (Cost Basis: Rs. {unclassifiedPoultryCostBasis.toLocaleString()})
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {unclassifiedPoultryAnimals.map((a: any) => (
                  <span
                    key={a.id}
                    className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-50 border border-slate-200 text-slate-700"
                  >
                    {a.tag_id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Short-Cycle Cash Engine Summary (30d) */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200">
              <p className="text-[10px] font-bold uppercase text-emerald-900">30d Milk Cash</p>
              <p className="text-base font-bold font-mono text-emerald-700 mt-0.5">
                Rs. {shortCycleMix.milkIncome30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">
                {shortCycleMix.milkProducersCount} dairy animal(s)
              </p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200">
              <p className="text-[10px] font-bold uppercase text-amber-900">30d Manure Cash</p>
              <p className="text-base font-bold font-mono text-amber-800 mt-0.5">
                Rs. {shortCycleMix.manureIncome30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">Weekly khad / compost</p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200">
              <p className="text-[10px] font-bold uppercase text-indigo-900">
                30d Kid &amp; Quick Sales
              </p>
              <p className="text-base font-bold font-mono text-indigo-800 mt-0.5">
                Rs. {shortCycleMix.kidAndQuickSale30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">
                {nonSaleSelfAnimals.length} breeding / kid stock (Not for Sale)
              </p>
            </div>
            <div className="p-3 rounded-xl bg-cyan-50/60 border border-cyan-200">
              <p className="text-[10px] font-bold uppercase text-cyan-900">30d Palai Income</p>
              <p className="text-base font-bold font-mono text-cyan-800 mt-0.5">
                Rs. {shortCycleMix.palaiIncome30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">{palaiAnimals.length} client animal(s)</p>
            </div>
            <div className="p-3 rounded-xl bg-sky-50/60 border border-sky-200">
              <p className="text-[10px] font-bold uppercase text-sky-900">30d Egg Cash</p>
              <p className="text-base font-bold font-mono text-sky-800 mt-0.5">
                Rs. {shortCycleMix.eggIncome30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">
                {desiLayerAnimals.length} Desi layer(s)
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-100/80 border border-slate-200">
              <p className="text-[10px] font-bold uppercase text-slate-700">
                30d Short-Cycle Total
              </p>
              <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                Rs. {shortCycleMix.totalShortCycle30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">Feeds daily operating cash</p>
            </div>
          </div>
          <p className="text-[11px] font-mono text-slate-600">
            Total = Milk (Rs. {shortCycleMix.milkIncome30d.toLocaleString()}) + Manure (Rs.{' '}
            {shortCycleMix.manureIncome30d.toLocaleString()}) + Kid (Rs.{' '}
            {shortCycleMix.kidAndQuickSale30d.toLocaleString()}) + Palai (Rs.{' '}
            {shortCycleMix.palaiIncome30d.toLocaleString()}) + Egg (Rs.{' '}
            {shortCycleMix.eggIncome30d.toLocaleString()}) = Rs.{' '}
            {shortCycleMix.totalShortCycle30d.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}