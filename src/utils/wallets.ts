import type { SupabaseClient } from '@supabase/supabase-js'

export type WalletType = 'OPERATING_CASH' | 'ANIMAL_CAPITAL' | 'EMERGENCY_MORTALITY'

export interface FarmWalletRecord {
  id: string
  farm_id: string
  wallet_type: WalletType
  name: string
  account_label?: string | null
  current_balance: number
  target_buffer_amount: number
}

export interface SaleSplitBreakdown {
  salePrice: number
  capital60: number
  operating20: number
  profit20: number
}

export interface SaleSplitExecutionResult {
  applied: boolean
  alreadyProcessed: boolean
  breakdown: SaleSplitBreakdown
  newCapitalBalance: number
  newOperatingBalance: number
}

export interface MortalityClaimExecutionResult {
  applied: boolean
  alreadyProcessed: boolean
  animalCostBasis: number
  emergencyAvailableBefore: number
  absorbedFromEmergency: number
  uncoveredCapitalLoss: number
  newEmergencyBalance: number
}

export interface WeeklyCashPulseInputItem {
  date: string
  type: 'Income' | 'Expense'
  category: string
  amount: number
}

export interface WeeklyCashPulseSummary {
  windowStartDate: string
  windowEndDate: string
  coreCashOut7d: number // Feed + Labour + Medicine
  otherCashOut7d: number
  totalCashOut7d: number
  shortCycleCashIn7d: number // Milk + Manure + Animal Sales
  palaiCashIn7d: number
  totalCashIn7d: number
  weeklyNetGap: number // shortCycleCashIn7d - coreCashOut7d
  isRedFlag: boolean
  runwayDays: number | null
  avgDailyOperatingBurn: number
  thirtyDayTargetRequired: number
  operatingShortfall: number
}

export interface StaggeredBatchDefinition {
  key: 'BATCH_A_JAN_JUL' | 'BATCH_B_MAR_SEP' | 'BATCH_C_MAY_NOV'
  label: string
  buyWindow: string
  sellWindow: string
  buyMonths: number[]
  sellMonths: number[]
}

export const STAGGERED_BATCH_DEFINITIONS: StaggeredBatchDefinition[] = [
  {
    key: 'BATCH_A_JAN_JUL',
    label: 'Batch A (Jan–Jul)',
    buyWindow: 'Jan – Feb',
    sellWindow: 'Jul – Aug',
    buyMonths: [1, 2],
    sellMonths: [7, 8],
  },
  {
    key: 'BATCH_B_MAR_SEP',
    label: 'Batch B (Mar–Sep)',
    buyWindow: 'Mar – Apr',
    sellWindow: 'Sep – Oct',
    buyMonths: [3, 4],
    sellMonths: [9, 10],
  },
  {
    key: 'BATCH_C_MAY_NOV',
    label: 'Batch C (May–Nov)',
    buyWindow: 'May – Jun',
    sellWindow: 'Nov – Dec',
    buyMonths: [5, 6],
    sellMonths: [11, 12],
  },
]

export const CASH_CYCLE_ROLES = [
  'Meat / Fattening',
  'Daily Milk Producer',
  'Breeding / Kid Crop',
] as const

export interface StaggeredBatchStatus {
  key: StaggeredBatchDefinition['key']
  label: string
  buyWindow: string
  sellWindow: string
  phaseNow: 'BUY_WINDOW' | 'SELL_WINDOW' | 'GROWOUT'
  animalCount: number
  totalCostBasis: number
  tags: string[]
}

export interface ShortCycleMixSummary {
  milkIncome30d: number
  manureIncome30d: number
  kidAndQuickSale30d: number
  palaiIncome30d: number
  totalShortCycle30d: number
  milkProducersCount: number
  kidCropCount: number
  fatteningCount: number
  unassignedBatchCount: number
}

export function inferStaggeredBatchFromDate(acquisitionDate?: string | null): string {
  if (!acquisitionDate) return 'Batch A (Jan–Jul)'
  const parts = String(acquisitionDate).split('T')[0].split('-')
  const month = parseInt(parts[1] || '1', 10)
  if (month === 1 || month === 2 || month === 7 || month === 8) {
    return 'Batch A (Jan–Jul)'
  }
  if (month === 3 || month === 4 || month === 9 || month === 10) {
    return 'Batch B (Mar–Sep)'
  }
  return 'Batch C (May–Nov)'
}

export function computeStaggeredBatchesAndShortCycle({
  selfAnimals,
  items,
  todayStr,
}: {
  selfAnimals: Array<{
    id: string
    tag_id: string
    acquisition_date?: string | null
    cost_basis?: number | null
    batch_label?: string | null
    cash_cycle_role?: string | null
  }>
  items: WeeklyCashPulseInputItem[]
  todayStr: string
}): {
  batches: StaggeredBatchStatus[]
  shortCycleMix: ShortCycleMixSummary
} {
  const currentMonth = parseInt(todayStr.split('-')[1] || '1', 10)
  const thirtyDaysStartDate = shiftDateString(todayStr, -29)

  const batches: StaggeredBatchStatus[] = STAGGERED_BATCH_DEFINITIONS.map(def => {
    const phaseNow: StaggeredBatchStatus['phaseNow'] = def.buyMonths.includes(currentMonth)
      ? 'BUY_WINDOW'
      : def.sellMonths.includes(currentMonth)
      ? 'SELL_WINDOW'
      : 'GROWOUT'

    const matching = selfAnimals.filter(a => {
      const assigned = (a.batch_label || '').trim()
      const effectiveLabel = assigned || inferStaggeredBatchFromDate(a.acquisition_date)
      return effectiveLabel === def.label
    })

    return {
      key: def.key,
      label: def.label,
      buyWindow: def.buyWindow,
      sellWindow: def.sellWindow,
      phaseNow,
      animalCount: matching.length,
      totalCostBasis: matching.reduce((s, a) => s + (Number(a.cost_basis) || 0), 0),
      tags: matching.map(a => a.tag_id),
    }
  })

  let milkIncome30d = 0
  let manureIncome30d = 0
  let kidAndQuickSale30d = 0
  let palaiIncome30d = 0

  for (const item of items) {
    if (item.type !== 'Income') continue
    if (item.date < thirtyDaysStartDate || item.date > todayStr) continue
    const amt = Math.max(0, Number(item.amount) || 0)
    const c = (item.category || '').toLowerCase()

    if (c.includes('milk')) {
      milkIncome30d += amt
    } else if (c.includes('manure') || c.includes('khad')) {
      manureIncome30d += amt
    } else if (c.includes('palai')) {
      palaiIncome30d += amt
    } else if (c.includes('kid') || c.includes('sale') || c.includes('qurbani')) {
      kidAndQuickSale30d += amt
    }
  }

  let milkProducersCount = 0
  let kidCropCount = 0
  let fatteningCount = 0
  let unassignedBatchCount = 0

  for (const a of selfAnimals) {
    if (!(a.batch_label || '').trim()) {
      unassignedBatchCount++
    }
    const role = (a.cash_cycle_role || 'Meat / Fattening').toLowerCase()
    if (role.includes('milk')) milkProducersCount++
    else if (role.includes('kid') || role.includes('breed')) kidCropCount++
    else fatteningCount++
  }

  return {
    batches,
    shortCycleMix: {
      milkIncome30d,
      manureIncome30d,
      kidAndQuickSale30d,
      palaiIncome30d,
      totalShortCycle30d: milkIncome30d + manureIncome30d + kidAndQuickSale30d + palaiIncome30d,
      milkProducersCount,
      kidCropCount,
      fatteningCount,
      unassignedBatchCount,
    },
  }
}

export function computeSaleProceedsSplit(salePrice: number): SaleSplitBreakdown {
  const safePrice = Math.max(0, Number(salePrice) || 0)
  const capital60 = Math.round(safePrice * 0.6)
  const operating20 = Math.round(safePrice * 0.2)
  const profit20 = Math.max(0, Math.round(safePrice) - capital60 - operating20)
  return {
    salePrice: Math.round(safePrice),
    capital60,
    operating20,
    profit20,
  }
}

export function isOperatingCategory(category?: string | null): boolean {
  const c = (category || '').toLowerCase()
  return (
    c.includes('feed') ||
    c.includes('ration') ||
    c.includes('labour') ||
    c.includes('labor') ||
    c.includes('medicine') ||
    c.includes('vet') ||
    c.includes('electricity') ||
    c.includes('rent') ||
    c.includes('utility')
  )
}

export function isCoreWeeklyOutflowCategory(category?: string | null): boolean {
  const c = (category || '').toLowerCase()
  return (
    c.includes('feed') ||
    c.includes('ration') ||
    c.includes('labour') ||
    c.includes('labor') ||
    c.includes('staff') ||
    c.includes('medicine') ||
    c.includes('vet')
  )
}

export function isCoreWeeklyInflowCategory(category?: string | null): boolean {
  const c = (category || '').toLowerCase()
  return (
    c.includes('milk') ||
    c.includes('manure') ||
    c.includes('kid') ||
    c.includes('sale') ||
    c.includes('qurbani')
  )
}

function shiftDateString(baseDateStr: string, deltaDays: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().split('T')[0]
}

export function computeWeeklyCashPulseAndRunway({
  items,
  todayStr,
  operatingBalance,
  manualThirtyDayTarget = 0,
}: {
  items: WeeklyCashPulseInputItem[]
  todayStr: string
  operatingBalance: number
  manualThirtyDayTarget?: number
}): WeeklyCashPulseSummary {
  const windowStartDate = shiftDateString(todayStr, -6)
  const thirtyDaysStartDate = shiftDateString(todayStr, -29)

  let coreCashOut7d = 0
  let otherCashOut7d = 0
  let shortCycleCashIn7d = 0
  let palaiCashIn7d = 0

  let operatingBurn30d = 0

  for (const item of items) {
    const amt = Math.max(0, Number(item.amount) || 0)
    if (amt <= 0) continue

    const catLower = (item.category || '').toLowerCase()
    const isSyntheticSplit = catLower.includes('deficit share') || catLower.includes('overhead')

    if (item.date >= thirtyDaysStartDate && item.date <= todayStr) {
      if (item.type === 'Expense' && !isSyntheticSplit && isOperatingCategory(item.category)) {
        operatingBurn30d += amt
      }
    }

    if (item.date >= windowStartDate && item.date <= todayStr) {
      if (item.type === 'Expense' && !isSyntheticSplit) {
        if (isCoreWeeklyOutflowCategory(item.category)) {
          coreCashOut7d += amt
        } else {
          otherCashOut7d += amt
        }
      } else if (item.type === 'Income') {
        if (isCoreWeeklyInflowCategory(item.category)) {
          shortCycleCashIn7d += amt
        } else if (catLower.includes('palai')) {
          palaiCashIn7d += amt
        } else {
          shortCycleCashIn7d += amt
        }
      }
    }
  }

  const totalCashOut7d = coreCashOut7d + otherCashOut7d
  const totalCashIn7d = shortCycleCashIn7d + palaiCashIn7d
  const weeklyNetGap = shortCycleCashIn7d - coreCashOut7d
  const isRedFlag = coreCashOut7d > shortCycleCashIn7d

  const avgDailyOperatingBurn = operatingBurn30d > 0 ? Math.round(operatingBurn30d / 30) : 0
  const thirtyDayTargetRequired =
    manualThirtyDayTarget > 0
      ? Math.round(manualThirtyDayTarget)
      : Math.round(operatingBurn30d)

  const runwayDays =
    avgDailyOperatingBurn > 0
      ? Math.max(0, Math.floor(Math.max(0, operatingBalance) / avgDailyOperatingBurn))
      : null

  const operatingShortfall = Math.max(0, thirtyDayTargetRequired - Math.max(0, operatingBalance))

  return {
    windowStartDate,
    windowEndDate: todayStr,
    coreCashOut7d,
    otherCashOut7d,
    totalCashOut7d,
    shortCycleCashIn7d,
    palaiCashIn7d,
    totalCashIn7d,
    weeklyNetGap,
    isRedFlag,
    runwayDays,
    avgDailyOperatingBurn,
    thirtyDayTargetRequired,
    operatingShortfall,
  }
}

export async function ensureDefaultWallets(
  supabase: SupabaseClient,
  farmId: string
): Promise<FarmWalletRecord[]> {
  const defaults: Array<{
    farm_id: string
    wallet_type: WalletType
    name: string
    account_label: string
    current_balance: number
    target_buffer_amount: number
  }> = [
    {
      farm_id: farmId,
      wallet_type: 'OPERATING_CASH',
      name: 'Operating Cash (30-Day)',
      account_label: 'Separate Ops Bank / Cash',
      current_balance: 0,
      target_buffer_amount: 0,
    },
    {
      farm_id: farmId,
      wallet_type: 'ANIMAL_CAPITAL',
      name: 'Animal Buying Cash (Capital)',
      account_label: 'Dedicated Purchase Pool',
      current_balance: 0,
      target_buffer_amount: 0,
    },
    {
      farm_id: farmId,
      wallet_type: 'EMERGENCY_MORTALITY',
      name: 'Emergency / Mortality Fund (10%)',
      account_label: '10% Livestock Value Reserve',
      current_balance: 0,
      target_buffer_amount: 0,
    },
  ]

  await supabase
    .from('farm_wallets')
    .upsert(defaults, { onConflict: 'farm_id,wallet_type', ignoreDuplicates: true })

  const { data } = await supabase
    .from('farm_wallets')
    .select('id, farm_id, wallet_type, name, account_label, current_balance, target_buffer_amount')
    .eq('farm_id', farmId)

  return (data || []) as FarmWalletRecord[]
}

export async function recalculateWalletBalance(
  supabase: SupabaseClient,
  farmId: string,
  walletId: string
): Promise<number> {
  const { data: txns } = await supabase
    .from('wallet_transactions')
    .select('entry_type, amount')
    .eq('farm_id', farmId)
    .eq('wallet_id', walletId)

  const balance = (txns || []).reduce((sum, row: any) => {
    const amt = Number(row.amount) || 0
    return row.entry_type === 'IN' ? sum + amt : sum - amt
  }, 0)

  await supabase
    .from('farm_wallets')
    .update({ current_balance: balance, updated_at: new Date().toISOString() })
    .eq('id', walletId)
    .eq('farm_id', farmId)

  return balance
}

/**
 * Phase 4A: 60/20/20 Sale Proceeds Split
 * - 60% -> Wallet 2 (ANIMAL_CAPITAL) to buy replacement livestock
 * - 20% -> Wallet 1 (OPERATING_CASH) to fund 30-day feed/labour/medicine buffer
 * - 20% -> Retained Net Profit (logged in animal_financial_logs / summary without mixing into buying capital)
 */
export async function applySaleProceedsSplitToWallets({
  supabase,
  farmId,
  animalId,
  tagId,
  salePrice,
  txnDate,
}: {
  supabase: SupabaseClient
  farmId: string
  animalId: string
  tagId: string
  salePrice: number
  txnDate: string
}): Promise<SaleSplitExecutionResult> {
  const breakdown = computeSaleProceedsSplit(salePrice)
  const wallets = await ensureDefaultWallets(supabase, farmId)
  const capitalWallet = wallets.find(w => w.wallet_type === 'ANIMAL_CAPITAL')
  const operatingWallet = wallets.find(w => w.wallet_type === 'OPERATING_CASH')

  if (breakdown.salePrice <= 0 || !capitalWallet || !operatingWallet) {
    return {
      applied: false,
      alreadyProcessed: false,
      breakdown,
      newCapitalBalance: Number(capitalWallet?.current_balance || 0),
      newOperatingBalance: Number(operatingWallet?.current_balance || 0),
    }
  }

  const capRef = `SALE_SPLIT_60_${animalId}`
  const opRef = `SALE_SPLIT_20_${animalId}`

  const { data: existingCap } = await supabase
    .from('wallet_transactions')
    .select('id')
    .eq('farm_id', farmId)
    .eq('reference_key', capRef)
    .maybeSingle()

  if (existingCap) {
    return {
      applied: false,
      alreadyProcessed: true,
      breakdown,
      newCapitalBalance: Number(capitalWallet.current_balance || 0),
      newOperatingBalance: Number(operatingWallet.current_balance || 0),
    }
  }

  const rowsToInsert: Array<Record<string, any>> = []

  if (breakdown.capital60 > 0) {
    rowsToInsert.push({
      farm_id: farmId,
      wallet_id: capitalWallet.id,
      animal_id: animalId,
      reference_key: capRef,
      entry_type: 'IN',
      amount: breakdown.capital60,
      source_type: 'ANIMAL_SALE_60_CAPITAL',
      txn_date: txnDate,
      notes: `60% Capital Reinvestment from Sale of ${tagId} (Total Sale: Rs. ${breakdown.salePrice.toLocaleString()} | 20% Profit Retained: Rs. ${breakdown.profit20.toLocaleString()})`,
    })
  }

  if (breakdown.operating20 > 0) {
    rowsToInsert.push({
      farm_id: farmId,
      wallet_id: operatingWallet.id,
      animal_id: animalId,
      reference_key: opRef,
      entry_type: 'IN',
      amount: breakdown.operating20,
      source_type: 'ANIMAL_SALE_20_OPERATING',
      txn_date: txnDate,
      notes: `20% Operating Runway Share from Sale of ${tagId} (Total Sale: Rs. ${breakdown.salePrice.toLocaleString()})`,
    })
  }

  if (rowsToInsert.length > 0) {
    await supabase.from('wallet_transactions').insert(rowsToInsert)
  }

  const [newCapitalBalance, newOperatingBalance] = await Promise.all([
    recalculateWalletBalance(supabase, farmId, capitalWallet.id),
    recalculateWalletBalance(supabase, farmId, operatingWallet.id),
  ])

  return {
    applied: true,
    alreadyProcessed: false,
    breakdown,
    newCapitalBalance,
    newOperatingBalance,
  }
}

/**
 * Phase 4B: Mortality 10% Emergency Fund Claim Flow
 * - Absorbs animal purchase cost_basis from Wallet 3 (EMERGENCY_MORTALITY) up to available reserve
 * - Logs mortality loss entry on animal_financial_logs and flags any uncovered capital shortfall
 */
export async function applyMortalityEmergencyClaim({
  supabase,
  farmId,
  animalId,
  tagId,
  costBasis,
  txnDate,
  causeNotes,
}: {
  supabase: SupabaseClient
  farmId: string
  animalId: string
  tagId: string
  costBasis: number
  txnDate: string
  causeNotes?: string
}): Promise<MortalityClaimExecutionResult> {
  const safeCost = Math.max(0, Math.round(Number(costBasis) || 0))
  const wallets = await ensureDefaultWallets(supabase, farmId)
  const emergencyWallet = wallets.find(w => w.wallet_type === 'EMERGENCY_MORTALITY')

  const availableBefore = Math.max(0, Math.round(Number(emergencyWallet?.current_balance || 0)))

  if (!emergencyWallet) {
    return {
      applied: false,
      alreadyProcessed: false,
      animalCostBasis: safeCost,
      emergencyAvailableBefore: availableBefore,
      absorbedFromEmergency: 0,
      uncoveredCapitalLoss: safeCost,
      newEmergencyBalance: availableBefore,
    }
  }

  const claimRef = `MORTALITY_CLAIM_${animalId}`
  const { data: existingClaim } = await supabase
    .from('wallet_transactions')
    .select('id')
    .eq('farm_id', farmId)
    .eq('reference_key', claimRef)
    .maybeSingle()

  if (existingClaim) {
    return {
      applied: false,
      alreadyProcessed: true,
      animalCostBasis: safeCost,
      emergencyAvailableBefore: availableBefore,
      absorbedFromEmergency: 0,
      uncoveredCapitalLoss: 0,
      newEmergencyBalance: availableBefore,
    }
  }

  const absorbedFromEmergency = Math.min(safeCost, availableBefore)
  const uncoveredCapitalLoss = Math.max(0, safeCost - absorbedFromEmergency)
  const reasonSuffix = causeNotes ? ` • Cause: ${causeNotes}` : ''

  if (absorbedFromEmergency > 0) {
    await supabase.from('wallet_transactions').insert([
      {
        farm_id: farmId,
        wallet_id: emergencyWallet.id,
        animal_id: animalId,
        reference_key: claimRef,
        entry_type: 'OUT',
        amount: absorbedFromEmergency,
        source_type: 'MORTALITY_CLAIM',
        txn_date: txnDate,
        notes: `Mortality Claim for ${tagId}: Absorbed Rs. ${absorbedFromEmergency.toLocaleString()} of Rs. ${safeCost.toLocaleString()} cost basis${
          uncoveredCapitalLoss > 0 ? ` (Uncovered Loss: Rs. ${uncoveredCapitalLoss.toLocaleString()})` : ''
        }${reasonSuffix}`,
      },
    ])
  }

  // Record mortality write-off in animal_financial_logs for full P&L audit trail
  if (safeCost > 0) {
    await supabase.from('animal_financial_logs').insert([
      {
        farm_id: farmId,
        animal_id: animalId,
        entry_type: 'Expense',
        category: 'Mortality Loss Write-Off',
        amount: safeCost,
        transaction_date: txnDate,
        notes: `Deceased Mortality Write-Off (${tagId}): Rs. ${absorbedFromEmergency.toLocaleString()} covered by 10% Emergency Reserve, Rs. ${uncoveredCapitalLoss.toLocaleString()} uncovered${reasonSuffix}`,
      },
    ])
  }

  const newEmergencyBalance = await recalculateWalletBalance(supabase, farmId, emergencyWallet.id)

  return {
    applied: true,
    alreadyProcessed: false,
    animalCostBasis: safeCost,
    emergencyAvailableBefore: availableBefore,
    absorbedFromEmergency,
    uncoveredCapitalLoss,
    newEmergencyBalance,
  }
}