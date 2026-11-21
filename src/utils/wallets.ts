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