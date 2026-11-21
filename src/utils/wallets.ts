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
  const windowStartDate = shiftDateString(todayStr, -6) // Inclusive 7-day window
  const thirtyDaysStartDate = shiftDateString(todayStr, -29) // Inclusive 30-day window

  let coreCashOut7d = 0
  let otherCashOut7d = 0
  let shortCycleCashIn7d = 0
  let palaiCashIn7d = 0

  let operatingBurn30d = 0

  for (const item of items) {
    const amt = Math.max(0, Number(item.amount) || 0)
    if (amt <= 0) continue

    const catLower = (item.category || '').toLowerCase()
    // Exclude non-cash synthetic deficit split entries from actual cash outflow
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