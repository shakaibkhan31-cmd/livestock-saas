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
  buyMonths: number[] // 1-12
  sellMonths: number[] // 1-12
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