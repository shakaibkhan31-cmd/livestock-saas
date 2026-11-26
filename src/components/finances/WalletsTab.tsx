import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getUserFarmAndRole } from '@/utils/rbac'
import {
  computeWeightedAnimalsForPool,
  formatDateDDMMYYYY,
} from '@/utils/breakeven'
import {
  computeWeeklyCashPulseAndRunway,
  ensureDefaultWallets,
  recalculateWalletBalance,
  type WalletType,
} from '@/utils/wallets'
import {
  distributeExactShares,
  extractSpeciesFromTxn,
  formatMonthLabel,
  getPakistanDateString,
  isActiveStatus,
  isFeedCategory,
  isOverheadShareCategory,
  isSelfOwnership,
  isVoidText,
  normalizeText,
  OVERHEAD_SHARE_CATEGORY,
  parseSplitRoleFromNotes,
  SPECIES_OPTIONS,
  WALLET_FUND_SOURCE_TYPES,
} from '@/utils/financesHelpers'

export default async function WalletsTab({ farmId }: { farmId: string }) {
  const supabase = await createClient()
  const todayStr = getPakistanDateString()

  // Strictly Wallets, P&L & Overhead Allocation data (trimmed columns, single wallet_transactions query)
  const [
    wallets,
    { data: allFarmLivestock },
    { data: weightLogs },
    { data: allGlobalTxnsForTotals },
    { data: allAnimalFinLogsForTotals },
    { data: allWalletAuditRows, count: totalWalletAuditCount },
  ] = await Promise.all([
    ensureDefaultWallets(supabase, farmId),
    supabase
      .from('livestock_master')
      .select('id, tag_id, species, ownership, acquisition_date, status, cost_basis')
      .eq('farm_id', farmId),
    supabase
      .from('animal_weight_logs')
      .select('animal_id, weight_kg, recorded_date')
      .eq('farm_id', farmId)
      .order('recorded_date', { ascending: false }),
    supabase
      .from('transactions')
      .select('txn_date, type, category, amount, description')
      .eq('farm_id', farmId),
    supabase
      .from('animal_financial_logs')
      .select('entry_type, category, amount, transaction_date, notes')
      .eq('farm_id', farmId),
    supabase
      .from('wallet_transactions')
      .select(
        'id, wallet_id, reference_key, entry_type, amount, source_type, txn_date, notes, created_at',
        { count: 'exact' }
      )
      .eq('farm_id', farmId)
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  const activeFarmLivestock = (allFarmLivestock || []).filter((a: any) => isActiveStatus(a.status))
  const selfAnimals = activeFarmLivestock.filter((a: any) => isSelfOwnership(a.ownership))

  const globalTxns = allGlobalTxnsForTotals || []
  const animalFinLogs = allAnimalFinLogsForTotals || []

  const walletByType: Partial<Record<WalletType, (typeof wallets)[number]>> = {}
  const walletById: Record<string, (typeof wallets)[number]> = {}
  wallets.forEach(w => {
    walletByType[w.wallet_type] = w
    walletById[w.id] = w
  })

  const operatingWallet = walletByType.OPERATING_CASH
  const capitalWallet = walletByType.ANIMAL_CAPITAL
  const emergencyWallet = walletByType.EMERGENCY_MORTALITY
  const ownerProfitWallet = walletByType.OWNER_PROFIT

  const operatingBalance = Number(operatingWallet?.current_balance || 0)
  const capitalBalance = Number(capitalWallet?.current_balance || 0)
  const emergencyBalance = Number(emergencyWallet?.current_balance || 0)
  const ownerProfitBalance = Number(ownerProfitWallet?.current_balance || 0)

  const totalSelfLivestockValue = selfAnimals.reduce(
    (sum: number, a: any) => sum + (Number(a.cost_basis) || 0),
    0
  )
  const tenPercentEmergencyTarget = Math.round(totalSelfLivestockValue * 0.1)
  const emergencyProgressPct =
    tenPercentEmergencyTarget > 0
      ? Math.min(100, Math.round((Math.max(0, emergencyBalance) / tenPercentEmergencyTarget) * 100))
      : emergencyBalance > 0
      ? 100
      : 0

  const allAuditRows = ((allWalletAuditRows || []) as Array<any>).map(r => ({
    ...r,
    isVoid: isVoidText(r.notes),
    splitRole: parseSplitRoleFromNotes(r.notes),
  }))

  const displayedAuditRows = allAuditRows.slice(0, 30)
  const activeAuditRows = allAuditRows.filter(r => !r.isVoid)

  const sale60Total = activeAuditRows
    .filter(
      r =>
        r.entry_type === 'IN' &&
        (r.source_type === 'ANIMAL_SALE_60_CAPITAL' || r.splitRole === '60_CAP')
    )
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const sale20OpTotal = activeAuditRows
    .filter(
      r =>
        r.entry_type === 'IN' &&
        (r.source_type === 'ANIMAL_SALE_20_OPERATING' || r.splitRole === '20_OPS')
    )
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const sale20OwnerTotal = activeAuditRows
    .filter(
      r =>
        r.entry_type === 'IN' &&
        (r.source_type === 'ANIMAL_SALE_20_OWNER_PROFIT' || r.splitRole === '20_OWN')
    )
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const implied20RetainedProfit = sale20OwnerTotal

  const mortalityClaimedTotal = activeAuditRows
    .filter(r => r.source_type === 'MORTALITY_CLAIM' && r.entry_type === 'OUT')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const activeLedgerItems = [
    ...globalTxns
      .filter((t: any) => !isVoidText(t.description))
      .map((t: any) => ({
        date: String(t.txn_date).split('T')[0],
        type: (t.type === 'Income' ? 'Income' : 'Expense') as 'Income' | 'Expense',
        category: t.category || 'General',
        amount: Number(t.amount) || 0,
        isAutoBill: false,
        isFeedAllocation: false,
      })),
    ...animalFinLogs
      .filter((f: any) => !isVoidText(f.notes))
      .map((f: any) => {
        const noteStr = String(f.notes || '')
        return {
          date: String(f.transaction_date).split('T')[0],
          type: (f.entry_type === 'Revenue' ? 'Income' : 'Expense') as 'Income' | 'Expense',
          category: f.category || 'General',
          amount: Number(f.amount) || 0,
          isAutoBill: noteStr.startsWith('Auto-Bill'),
          // Feed Allocation cash nahi hai, sirf andar ki movement hai
          isFeedAllocation: isFeedCategory(f.category || ''),
        }
      }),
  ]

  const cashItemsForAnalytics = activeLedgerItems
    .filter(
      item =>
        !item.isAutoBill &&
        !isOverheadShareCategory(item.category) &&
        !item.isFeedAllocation
    )
    .map(item => ({
      date: item.date,
      type: item.type,
      category: item.category,
      amount: item.amount,
    }))

  const cashPulse = computeWeeklyCashPulseAndRunway({
    items: cashItemsForAnalytics,
    todayStr,
    operatingBalance,
    manualThirtyDayTarget: Number(operatingWallet?.target_buffer_amount || 0),
  })
  const thirtyDayOperatingTarget = cashPulse.thirtyDayTargetRequired

  type MonthlyReportRow = {
    month: string
    label: string
    cashIn: number
    cashOut: number
    netCashFlow: number
    capitalIn60: number
    operatingIn20: number
    retainedProfit20: number
    mortalityClaimed: number
  }

  const monthlyMap: Record<string, MonthlyReportRow> = {}
  const ensureMonthRow = (ym: string) => {
    if (!monthlyMap[ym]) {
      monthlyMap[ym] = {
        month: ym,
        label: formatMonthLabel(ym),
        cashIn: 0,
        cashOut: 0,
        netCashFlow: 0,
        capitalIn60: 0,
        operatingIn20: 0,
        retainedProfit20: 0,
        mortalityClaimed: 0,
      }
    }
    return monthlyMap[ym]
  }

  cashItemsForAnalytics.forEach(item => {
    const ym = (item.date || todayStr).slice(0, 7)
    const row = ensureMonthRow(ym)
    if (item.type === 'Income') row.cashIn += item.amount
    else row.cashOut += item.amount
  })

  activeAuditRows.forEach(r => {
    const ym = String(r.txn_date || todayStr).slice(0, 7)
    const row = ensureMonthRow(ym)
    const amt = Number(r.amount) || 0
    if (
      r.entry_type === 'IN' &&
      (r.source_type === 'ANIMAL_SALE_60_CAPITAL' || r.splitRole === '60_CAP')
    ) {
      row.capitalIn60 += amt
    } else if (
      r.entry_type === 'IN' &&
      (r.source_type === 'ANIMAL_SALE_20_OPERATING' || r.splitRole === '20_OPS')
    ) {
      row.operatingIn20 += amt
    } else if (
      r.entry_type === 'IN' &&
      (r.source_type === 'ANIMAL_SALE_20_OWNER_PROFIT' || r.splitRole === '20_OWN')
    ) {
      row.retainedProfit20 += amt
    } else if (r.source_type === 'MORTALITY_CLAIM' && r.entry_type === 'OUT') {
      row.mortalityClaimed += amt
    }
  })

  const monthlyReportRows = Object.values(monthlyMap)
    .map(r => ({
      ...r,
      netCashFlow: r.cashIn - r.cashOut,
    }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 6)

  const latestWeightByAnimal: Record<string, number> = {}
  ;(weightLogs || []).forEach(w => {
    if (w.animal_id && latestWeightByAnimal[w.animal_id] === undefined) {
      latestWeightByAnimal[w.animal_id] = Math.max(0, Number(w.weight_kg) || 0)
    }
  })

  const totalNonFeedExpense = activeLedgerItems
    .filter(
      t =>
        t.type === 'Expense' &&
        !isFeedCategory(t.category) &&
        !isOverheadShareCategory(t.category)
    )
    .reduce((acc, t) => acc + t.amount, 0)

  const alreadyAllocatedNonFeedExpense = activeLedgerItems
    .filter(t => t.type === 'Expense' && isOverheadShareCategory(t.category))
    .reduce((acc, t) => acc + t.amount, 0)

  const pendingNonFeedAllocationPool = Math.max(
    0,
    Math.round(totalNonFeedExpense - alreadyAllocatedNonFeedExpense)
  )

  const defaultGoatSelfAnimals = selfAnimals.filter(
    a => normalizeText(a.species || 'Goat') === 'goat'
  )
  const previewWeightedAnimals = computeWeightedAnimalsForPool(
    defaultGoatSelfAnimals,
    latestWeightByAnimal,
    todayStr
  )
  const previewTotalWeight = previewWeightedAnimals.reduce((sum, a) => sum + a.effectiveWeight, 0)

  const fundWalletAction = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const walletType = (
      (formData.get('wallet_type') as string) || 'OPERATING_CASH'
    ).trim() as WalletType
    const entryType = ((formData.get('entry_type') as string) || 'IN') === 'OUT' ? 'OUT' : 'IN'
    const rawSourceType = ((formData.get('source_type') as string) || 'WALLET_TRANSFER').trim()
    const amount = parseFloat((formData.get('amount') as string) || '0')
    const txnDate =
      ((formData.get('txn_date') as string) || '').trim() || getPakistanDateString()
    const notes = ((formData.get('notes') as string) || '').trim() || 'Wallet Funding / Adjustment'

    if (isNaN(amount) || amount <= 0) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          'Enter a valid wallet amount greater than 0.'
        )}`
      )
    }

    const supabaseClient = await createClient()
    const farmWallets = await ensureDefaultWallets(supabaseClient, farmId)
    let targetWallet = farmWallets.find(
      w => String(w.wallet_type || '').trim().toUpperCase() === walletType.toUpperCase()
    )

    if (!targetWallet) {
      const { data: existingRow, error: readWalletErr } = await supabaseClient
        .from('farm_wallets')
        .select('id, farm_id, wallet_type, name, account_label, current_balance, target_buffer_amount')
        .eq('farm_id', farmId)
        .eq('wallet_type', walletType)
        .maybeSingle()

      if (readWalletErr) {
        return redirect(
          `/finances?tab=wallets&error=${encodeURIComponent(
            `Wallet lookup failed: ${readWalletErr.message}`
          )}`
        )
      }

      if (existingRow) {
        targetWallet = existingRow as (typeof farmWallets)[number]
      } else {
        const defaultNameMap: Record<string, { name: string; label: string }> = {
          OPERATING_CASH: { name: 'Operating Cash (30-Day)', label: 'Separate Ops Bank / Cash' },
          ANIMAL_CAPITAL: { name: 'Animal Buying Cash (60%)', label: 'Dedicated Purchase Pool' },
          EMERGENCY_MORTALITY: {
            name: 'Emergency / Mortality Fund (10%)',
            label: '10% Active Self Stock Value',
          },
          OWNER_PROFIT: {
            name: 'Owner Draw / Retained Profit (20%)',
            label: 'Owner Draw & Personal Split',
          },
        }
        const meta = defaultNameMap[walletType] || { name: walletType, label: 'Farm Wallet' }
        const { data: createdRow, error: createWalletErr } = await supabaseClient
          .from('farm_wallets')
          .insert([
            {
              farm_id: farmId,
              wallet_type: walletType,
              name: meta.name,
              account_label: meta.label,
              current_balance: 0,
              target_buffer_amount: 0,
            },
          ])
          .select('id, farm_id, wallet_type, name, account_label, current_balance, target_buffer_amount')
          .single()

        if (createWalletErr || !createdRow) {
          return redirect(
            `/finances?tab=wallets&error=${encodeURIComponent(
              `Target wallet not found (${walletType}): ${
                createWalletErr?.message || 'unable to initialize wallet'
              }`
            )}`
          )
        }
        targetWallet = createdRow as (typeof farmWallets)[number]
      }
    }

    const validSources = new Set<string>(WALLET_FUND_SOURCE_TYPES)
    const sourceType =
      walletType === 'EMERGENCY_MORTALITY' && entryType === 'OUT'
        ? 'MORTALITY_CLAIM'
        : walletType === 'OWNER_PROFIT' && entryType === 'OUT'
        ? 'PROFIT_DRAW'
        : validSources.has(rawSourceType)
        ? rawSourceType
        : 'WALLET_TRANSFER'

    const { error: wtErr } = await supabaseClient.from('wallet_transactions').insert([
      {
        farm_id: farmId,
        wallet_id: targetWallet.id,
        entry_type: entryType,
        amount,
        source_type: sourceType,
        txn_date: txnDate,
        notes,
      },
    ])

    if (wtErr) {
      return redirect(`/finances?tab=wallets&error=${encodeURIComponent(wtErr.message)}`)
    }

    await recalculateWalletBalance(supabaseClient, farmId, targetWallet.id)

    return redirect(
      `/finances?tab=wallets&msg=${encodeURIComponent(
        `${targetWallet.name} [${sourceType}]: ${
          entryType === 'IN' ? '+' : '-'
        }Rs. ${amount.toLocaleString()} recorded.`
      )}`
    )
  }

  const voidWalletAuditRowAction = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const wtId = ((formData.get('wtId') as string) || '').trim()
    const walletId = ((formData.get('walletId') as string) || '').trim()
    if (!wtId || !walletId) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent('Invalid wallet transaction ID.')}`
      )
    }

    const supabaseClient = await createClient()
    const { data: existingRow, error: fetchErr } = await supabaseClient
      .from('wallet_transactions')
      .select('id, notes')
      .eq('id', wtId)
      .eq('farm_id', farmId)
      .maybeSingle()

    if (fetchErr || !existingRow) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          fetchErr?.message || 'Wallet transaction not found.'
        )}`
      )
    }

    if (!isVoidText(existingRow.notes)) {
      const nextNotes = `[VOID] Manual audit void on ${getPakistanDateString()}${
        existingRow.notes ? ` — ${existingRow.notes}` : ''
      }`
      const { error: voidErr } = await supabaseClient
        .from('wallet_transactions')
        .update({ notes: nextNotes })
        .eq('id', wtId)
        .eq('farm_id', farmId)

      if (voidErr) {
        return redirect(`/finances?tab=wallets&error=${encodeURIComponent(voidErr.message)}`)
      }
    }

    await recalculateWalletBalance(supabaseClient, farmId, walletId)

    return redirect(
      `/finances?tab=wallets&msg=${encodeURIComponent(
        'Wallet audit entry marked as VOID and balance recalculated.'
      )}`
    )
  }

  const allocateDeficitByWeight = async (formData: FormData) => {
    'use server'
    const { user: actionUser, farm: actionFarm, role: actionRole } = await getUserFarmAndRole()
    if (!actionUser || !actionFarm || actionRole !== 'admin' || actionFarm.id !== farmId) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          'Access denied: admin permission required for this financial action.'
        )}`
      )
    }
    const targetSpecies = ((formData.get('allocate_species') as string) || 'Goat').trim()
    const allocationDate =
      ((formData.get('allocation_date') as string) || '').trim() || getPakistanDateString()
    const periodLabel =
      ((formData.get('period_label') as string) || '').trim() || `${targetSpecies} Non-Feed Split`
    const customAmountRaw = ((formData.get('custom_amount') as string) || '').trim()
    const parsedCustomAmount = customAmountRaw ? parseFloat(customAmountRaw) : NaN

    const supabaseClient = await createClient()

    const [
      { data: liveGlobalTxns },
      { data: liveAnimalLogs },
      { data: liveLivestock },
      { data: liveWeightLogs },
    ] = await Promise.all([
      supabaseClient
        .from('transactions')
        .select('type, category, amount, target_species, description')
        .eq('farm_id', farmId),
      supabaseClient
        .from('animal_financial_logs')
        .select('entry_type, category, amount, notes, livestock_master(species)')
        .eq('farm_id', farmId),
      supabaseClient
        .from('livestock_master')
        .select('id, tag_id, species, ownership, status, acquisition_date')
        .eq('farm_id', farmId),
      supabaseClient
        .from('animal_weight_logs')
        .select('animal_id, weight_kg, recorded_date')
        .eq('farm_id', farmId)
        .order('recorded_date', { ascending: false }),
    ])

    const isSharedPool = targetSpecies === 'Shared (All Species)'

    let speciesNonFeedExpense = 0
    let speciesAllocatedOverhead = 0

    ;(liveGlobalTxns || []).forEach((t: any) => {
      if (isVoidText(t.description)) return
      if (t.type === 'Income') return
      const txnSp = extractSpeciesFromTxn(t)
      if (!isSharedPool && txnSp !== targetSpecies && txnSp !== 'Shared (All Species)') return
      const amt = Number(t.amount) || 0
      if (isOverheadShareCategory(t.category)) {
        speciesAllocatedOverhead += amt
      } else if (!isFeedCategory(t.category)) {
        speciesNonFeedExpense += amt
      }
    })

    ;(liveAnimalLogs || []).forEach((f: any) => {
      if (isVoidText(f.notes)) return
      if (f.entry_type === 'Revenue') return
      const animalInfo = Array.isArray(f.livestock_master)
        ? f.livestock_master[0]
        : f.livestock_master
      const finSp = animalInfo?.species || 'Goat'
      if (!isSharedPool && finSp !== targetSpecies) return
      const amt = Number(f.amount) || 0
      if (isOverheadShareCategory(f.category)) {
        speciesAllocatedOverhead += amt
      } else if (!isFeedCategory(f.category)) {
        speciesNonFeedExpense += amt
      }
    })

    let overallNonFeedExpense = 0
    let overallAllocatedOverhead = 0
    ;(liveGlobalTxns || []).forEach((t: any) => {
      if (isVoidText(t.description)) return
      if (t.type === 'Income') return
      const amt = Number(t.amount) || 0
      if (isOverheadShareCategory(t.category)) {
        overallAllocatedOverhead += amt
      } else if (!isFeedCategory(t.category)) {
        overallNonFeedExpense += amt
      }
    })
    ;(liveAnimalLogs || []).forEach((f: any) => {
      if (isVoidText(f.notes)) return
      if (f.entry_type === 'Revenue') return
      const amt = Number(f.amount) || 0
      if (isOverheadShareCategory(f.category)) {
        overallAllocatedOverhead += amt
      } else if (!isFeedCategory(f.category)) {
        overallNonFeedExpense += amt
      }
    })

    const speciesPendingNonFeed = Math.max(0, speciesNonFeedExpense - speciesAllocatedOverhead)
    const overallPendingNonFeed = Math.max(0, overallNonFeedExpense - overallAllocatedOverhead)
    const suggestedPool =
      speciesPendingNonFeed > 0 ? speciesPendingNonFeed : overallPendingNonFeed

    const poolToAllocate =
      !isNaN(parsedCustomAmount) && parsedCustomAmount > 0
        ? Math.round(parsedCustomAmount)
        : Math.round(suggestedPool)

    if (!isNaN(parsedCustomAmount) && poolToAllocate > suggestedPool) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          `Custom amount Rs. ${poolToAllocate} asal pending Rs. ${suggestedPool} se zyada hai.`
        )}`
      )
    }

    if (poolToAllocate <= 0) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(`No new unallocated expense.`)}`
      )
    }

    const matchingSelfAnimals = (liveLivestock || []).filter(a => {
      if (!isActiveStatus(a.status) || !isSelfOwnership(a.ownership)) return false
      if (isSharedPool) return true
      return normalizeText(a.species || 'Goat') === normalizeText(targetSpecies)
    })

    if (matchingSelfAnimals.length === 0) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          `No active farm-owned (Self) ${targetSpecies} animals found.`
        )}`
      )
    }

    const latestWeights: Record<string, number> = {}
    ;(liveWeightLogs || []).forEach(w => {
      if (w.animal_id && latestWeights[w.animal_id] === undefined) {
        latestWeights[w.animal_id] = Math.max(0, Number(w.weight_kg) || 0)
      }
    })

    const weightedAnimals = computeWeightedAnimalsForPool(
      matchingSelfAnimals,
      latestWeights,
      allocationDate
    )

    if (weightedAnimals.length === 0) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          `No active ${targetSpecies} animals existed on or before ${formatDateDDMMYYYY(
            allocationDate
          )}.`
        )}`
      )
    }

    const sumEffectiveWeight = weightedAnimals.reduce((sum, a) => sum + a.effectiveWeight, 0)
    const allocationTag = `Non-Feed Overhead Share [${targetSpecies}] (${periodLabel} @ ${allocationDate})`

    const insertsToApply: Array<{
      animal_id: string
      farm_id: string
      entry_type: string
      category: string
      amount: number
      transaction_date: string
      notes: string
    }> = []

    const { data: existingAllocationRows, error: existingAllocationErr } = await supabaseClient
      .from('animal_financial_logs')
      .select('id, animal_id, notes')
      .eq('farm_id', farmId)
      .eq('category', OVERHEAD_SHARE_CATEGORY)
      .ilike('notes', `${allocationTag}%`)

    if (existingAllocationErr) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          'Could not verify prior allocation: ' + existingAllocationErr.message
        )}`
      )
    }

    const hasActivePriorAllocation = (existingAllocationRows || []).some(
      (r: any) => !isVoidText(r.notes)
    )
    if (hasActivePriorAllocation) {
      return redirect(
        `/finances?tab=wallets&msg=${encodeURIComponent(
          `Allocation tag already exists for ${targetSpecies} (${periodLabel} @ ${allocationDate}). No new entries created to avoid double allocation.`
        )}`
      )
    }

    const exactShares = distributeExactShares(
      poolToAllocate,
      weightedAnimals.map(a => a.effectiveWeight)
    )

    for (let idx = 0; idx < weightedAnimals.length; idx++) {
      const animal = weightedAnimals[idx]
      const shareRatio = sumEffectiveWeight > 0 ? animal.effectiveWeight / sumEffectiveWeight : 0
      const shareAmount = exactShares[idx]

      if (shareAmount > 0) {
        insertsToApply.push({
          animal_id: animal.id,
          farm_id: farmId,
          entry_type: 'Expense',
          category: OVERHEAD_SHARE_CATEGORY,
          amount: shareAmount,
          transaction_date: allocationDate,
          notes: `${allocationTag} — ${(shareRatio * 100).toFixed(1)}% (${animal.basisNote})`,
        })
      }
    }

    if (insertsToApply.length === 0) {
      return redirect(
        `/finances?tab=wallets&msg=${encodeURIComponent(
          `Non-feed overhead share for ${targetSpecies} (${periodLabel} @ ${allocationDate}) was already allocated.`
        )}`
      )
    }

    const { error: insertErr } = await supabaseClient
      .from('animal_financial_logs')
      .insert(insertsToApply)

    if (insertErr) {
      return redirect(
        `/finances?tab=wallets&error=${encodeURIComponent(
          'Allocation failed: ' + insertErr.message
        )}`
      )
    }

    return redirect(
      `/finances?tab=wallets&msg=${encodeURIComponent(
        `Allocated Rs. ${poolToAllocate.toLocaleString()} (${targetSpecies}) non-feed overhead share across ${insertsToApply.length} Self animal(s).`
      )}`
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 4 Wallets Rule + Phase 4 60/20/20 Sale Split & Mortality Protection */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              4 Wallets Rule + 60/20/20 Sale Split &amp; Mortality Protection
            </h2>
            <p className="text-xs text-slate-500">
              Operating Cash (30-day ops), Animal Buying Capital (60% sale pool),
              Emergency/Mortality (10% active self-stock cost), and Owner Draw Wallet (20% profit)
            </p>
          </div>

          <form
            action={fundWalletAction}
            className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200"
          >
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                Wallet
              </label>
              <select
                name="wallet_type"
                defaultValue="OPERATING_CASH"
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
              >
                <option value="OPERATING_CASH">1. Operating Cash</option>
                <option value="ANIMAL_CAPITAL">2. Animal Buying Cash</option>
                <option value="EMERGENCY_MORTALITY">3. Emergency / Mortality</option>
                <option value="OWNER_PROFIT">4. Owner Draw (20%)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                Flow
              </label>
              <select
                name="entry_type"
                defaultValue="IN"
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
              >
                <option value="IN">Add (+ IN)</option>
                <option value="OUT">Withdraw / Draw (- OUT)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                Source Type
              </label>
              <select
                name="source_type"
                defaultValue="WALLET_TRANSFER"
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
              >
                {WALLET_FUND_SOURCE_TYPES.map(src => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                Amount (PKR)
              </label>
              <input
                name="amount"
                type="number"
                min="1"
                step="1"
                required
                placeholder="10000"
                className="w-28 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                Note
              </label>
              <input
                name="notes"
                type="text"
                placeholder="Funding / owner draw note"
                className="w-36 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
              />
            </div>
            <input type="hidden" name="txn_date" value={todayStr} />
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs transition"
            >
              Update Wallet
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Wallet 1 */}
          <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                Wallet 1 • Operating Cash
              </span>
              <span className="text-[10px] font-mono text-amber-800">30-Day Ops</span>
            </div>
            <p className="text-2xl font-bold font-mono text-slate-900">
              Rs. {operatingBalance.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-600">
              20% Sale Ops:{' '}
              <strong className="font-mono text-emerald-700">
                +Rs. {sale20OpTotal.toLocaleString()}
              </strong>{' '}
              • 30d Target:{' '}
              <strong className="font-mono">
                Rs. {thirtyDayOperatingTarget.toLocaleString()}
              </strong>
            </p>
          </div>

          {/* Wallet 2 */}
          <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900">
                Wallet 2 • Animal Buying Cash
              </span>
              <span className="text-[10px] font-mono text-blue-800">60% Sale Pool</span>
            </div>
            <p className="text-2xl font-bold font-mono text-slate-900">
              Rs. {capitalBalance.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-600">
              60% Sale Capital:{' '}
              <strong className="font-mono text-blue-800">
                +Rs. {sale60Total.toLocaleString()}
              </strong>{' '}
              • Feed &amp; labour blocked
            </p>
          </div>

          {/* Wallet 3 */}
          <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-900">
                Wallet 3 • Emergency / Mortality
              </span>
              <span className="text-[10px] font-mono font-bold text-rose-800">
                {emergencyProgressPct}%
              </span>
            </div>
            <p className="text-sm font-bold font-mono text-slate-900">
              Emergency: Rs. {emergencyBalance.toLocaleString()} / Rs.{' '}
              {tenPercentEmergencyTarget.toLocaleString()} Target
            </p>
            <div className="w-full h-2 bg-rose-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-600 rounded-full transition-all duration-500"
                style={{ width: `${emergencyProgressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-600">
              10% of Active Self Stock (Rs. {totalSelfLivestockValue.toLocaleString()}) • Claims:{' '}
              <strong className="font-mono text-rose-700">
                Rs. {mortalityClaimedTotal.toLocaleString()}
              </strong>
            </p>
          </div>

          {/* Wallet 4 */}
          <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                Wallet 4 • Owner Draw Wallet
              </span>
              <span className="text-[10px] font-mono text-emerald-800">20% Profit</span>
            </div>
            <p className="text-2xl font-bold font-mono text-slate-900">
              Rs. {ownerProfitBalance.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-600">
              20% Sale Profit Split:{' '}
              <strong className="font-mono text-emerald-700">
                +Rs. {implied20RetainedProfit.toLocaleString()}
              </strong>{' '}
              • Personal draws strictly from here
            </p>
          </div>
        </div>
      </div>

      {/* Monthly Retained Profit & Executive Wallet Audit Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-900 text-white">
            <h2 className="text-sm font-bold">Monthly Retained Profit &amp; Cash Report</h2>
            <p className="text-[11px] text-slate-400">
              Active cash flow, 60/20/20 split routing &amp; mortality claims (VOID excluded)
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {monthlyReportRows.length > 0 ? (
              monthlyReportRows.map(mRow => (
                <div key={mRow.month} className="p-4 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{mRow.label}</span>
                    <span
                      className={`font-mono font-bold ${
                        mRow.netCashFlow >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      Net:{' '}
                      {mRow.netCashFlow >= 0
                        ? `+Rs. ${mRow.netCashFlow.toLocaleString()}`
                        : `-Rs. ${Math.abs(mRow.netCashFlow).toLocaleString()}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>Cash In: Rs. {mRow.cashIn.toLocaleString()}</span>
                    <span>Cash Out: Rs. {mRow.cashOut.toLocaleString()}</span>
                  </div>
                  {(mRow.capitalIn60 > 0 ||
                    mRow.retainedProfit20 > 0 ||
                    mRow.mortalityClaimed > 0) && (
                    <div className="flex flex-wrap gap-2 pt-1 text-[10px] font-mono">
                      {mRow.capitalIn60 > 0 && (
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                          60% Cap: +Rs. {mRow.capitalIn60.toLocaleString()}
                        </span>
                      )}
                      {mRow.retainedProfit20 > 0 && (
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                          20% Owner Profit: +Rs. {mRow.retainedProfit20.toLocaleString()}
                        </span>
                      )}
                      {mRow.mortalityClaimed > 0 && (
                        <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">
                          Mortality Claim: -Rs. {mRow.mortalityClaimed.toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="p-6 text-xs text-slate-400 text-center">
                No monthly cash flow records yet.
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Executive Wallet Audit Ledger</h2>
              <p className="text-[11px] text-slate-500">
                Every IN/OUT movement across Operating Cash, Animal Buying Capital, Emergency Fund
                &amp; Owner Draw Wallet (VOID entries excluded from balances)
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 shrink-0">
              {displayedAuditRows.length} of {totalWalletAuditCount ?? allAuditRows.length} entries
            </span>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">
                    Wallet &amp; Type
                  </th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">
                    Amount
                  </th>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">
                    Audit Note / Ref
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-500 uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedAuditRows.length > 0 ? (
                  displayedAuditRows.map((wt: any) => {
                    const wInfo = walletById[wt.wallet_id]
                    const isIn = wt.entry_type === 'IN'
                    const isVoid = Boolean(wt.isVoid)
                    return (
                      <tr
                        key={wt.id}
                        className={isVoid ? 'bg-slate-50/80 opacity-65' : 'hover:bg-slate-50'}
                      >
                        <td className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                          {formatDateDDMMYYYY(wt.txn_date)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">
                              {wInfo?.name || 'Wallet'}
                            </span>
                            {isVoid && (
                              <span className="px-1.5 py-0.2 text-[10px] font-bold uppercase rounded bg-amber-100 text-amber-900 border border-amber-300">
                                VOID
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">
                            {wt.source_type || wt.entry_type}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2.5 font-mono font-bold whitespace-nowrap ${
                            isVoid
                              ? 'line-through text-slate-400'
                              : isIn
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {isIn ? '+' : '-'} Rs. {Number(wt.amount || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">
                          {wt.notes || '—'}
                          {wt.reference_key ? ` • ${wt.reference_key}` : ''}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {!isVoid ? (
                            <form action={voidWalletAuditRowAction} className="inline-block">
                              <input type="hidden" name="wtId" value={wt.id} />
                              <input type="hidden" name="walletId" value={wt.wallet_id} />
                              <button
                                type="submit"
                                className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-semibold"
                              >
                                Void
                              </button>
                            </form>
                          ) : (
                            <span className="text-[10px] font-mono text-slate-400">Voided</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                      No wallet audit transactions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* One-Click Species-Scoped Non-Feed Overhead Share Allocation */}
      <div
        id="breakeven-sync"
        className="bg-white p-5 sm:p-6 rounded-2xl border border-amber-200 shadow-sm space-y-4 scroll-mt-6"
      >
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                Non-Feed Overhead Pool (Already Allocated Excluded)
              </span>
              <span className="text-xs font-mono text-slate-500">
                Goat Self Preview: <strong>{previewWeightedAnimals.length}</strong> animals •
                Total Weightage: <strong>{previewTotalWeight.toFixed(1)}</strong>
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-900">
              Non-Feed Overhead Share Allocation (Excludes Feed &amp; Already Allocated Shares)
            </h2>
            <p className="text-xs text-slate-500 max-w-2xl">
              Pending unallocated non-feed expenses:{' '}
              <strong className="font-mono text-rose-700">
                Rs. {pendingNonFeedAllocationPool.toLocaleString()}
              </strong>{' '}
              (Non-feed total:{' '}
              <span className="font-mono">Rs. {totalNonFeedExpense.toLocaleString()}</span> −
              Already allocated:{' '}
              <span className="font-mono">Rs. {alreadyAllocatedNonFeedExpense.toLocaleString()}</span>
              ). Allocation does not increase farm-level expenses or reduce Net Profit again.
            </p>
          </div>

          <form
            action={allocateDeficitByWeight}
            className="flex flex-wrap items-end gap-2.5 bg-amber-50/70 p-3.5 rounded-xl border border-amber-200"
          >
            <div>
              <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                Target Species
              </label>
              <select
                name="allocate_species"
                defaultValue="Goat"
                className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-semibold text-slate-900"
              >
                {SPECIES_OPTIONS.map(sp => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                Pool Amount (PKR)
              </label>
              <input
                name="custom_amount"
                type="number"
                min="1"
                step="1"
                defaultValue={
                  pendingNonFeedAllocationPool > 0 ? pendingNonFeedAllocationPool : ''
                }
                placeholder={String(pendingNonFeedAllocationPool || 0)}
                className="w-28 px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-mono font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                Period Label
              </label>
              <input
                name="period_label"
                type="text"
                defaultValue="Non-Feed Overhead Nov 2026"
                className="w-36 px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                Entry Date
              </label>
              <input
                name="allocation_date"
                type="date"
                required
                defaultValue={todayStr}
                className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900"
              />
            </div>
            <button
              type="submit"
              disabled={selfAnimals.length === 0 || pendingNonFeedAllocationPool <= 0}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white font-bold rounded-lg text-xs shadow-xs transition"
            >
              ⚖️ Allocate Non-Feed Share
            </button>
          </form>
        </div>

        {previewWeightedAnimals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100">
            {previewWeightedAnimals.map(a => {
              const ratio = previewTotalWeight > 0 ? a.effectiveWeight / previewTotalWeight : 0
              const previewShare = Math.round(pendingNonFeedAllocationPool * ratio)
              return (
                <div
                  key={a.id}
                  className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                >
                  <div>
                    <Link
                      href={`/animals/${a.id}`}
                      className="font-mono font-bold text-slate-900 hover:text-indigo-600"
                    >
                      {a.tag_id}
                    </Link>
                    <span className="text-[11px] text-slate-500 ml-1.5">
                      (
                      {a.weightSource === 'Logged'
                        ? `${a.rawWeight} kg`
                        : `${a.weightSource}: ${a.effectiveWeight}`}{' '}
                      • Acq: {formatDateDDMMYYYY(a.acqStr)} • {(ratio * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <span className="font-mono font-bold text-rose-700">
                    +Rs. {previewShare.toLocaleString()}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}