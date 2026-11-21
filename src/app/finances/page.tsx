import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import {
  computeWeightedAnimalsForPool,
  daysBetweenDateStrings,
  formatDateDDMMYYYY,
} from '@/utils/breakeven'
import {
  CASH_CYCLE_ROLES,
  STAGGERED_BATCH_DEFINITIONS,
  computeStaggeredBatchesAndShortCycle,
  computeWeeklyCashPulseAndRunway,
  ensureDefaultWallets,
  recalculateWalletBalance,
  type WalletType,
} from '@/utils/wallets'
import FinancesExportButton, { type ExportableTxn } from './FinancesExportButton'

const SPECIES_OPTIONS = [
  'Goat',
  'Sheep',
  'Cattle',
  'Buffalo',
  'Chicken',
  'Rabbit',
  'Horse',
  'Dog',
  'Quail',
  'Shared (All Species)',
]

function extractSpeciesFromTxn(txn: { target_species?: string | null; description?: string | null }): string {
  const colVal = (txn.target_species || '').trim()
  if (colVal) return colVal

  const desc = txn.description || ''
  const match = desc.match(/\[Species:\s*([^\]]+)\]/i)
  if (match && match[1]) {
    return match[1].trim()
  }
  return 'Goat'
}

function stripSpeciesTag(description?: string | null): string {
  if (!description) return ''
  return description.replace(/\s*\[Species:\s*[^\]]+\]\s*/gi, ' ').trim()
}

function formatPakistanWhatsAppPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null
  const digits = rawPhone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0092')) return digits.slice(2)
  if (digits.startsWith('92')) return digits
  if (digits.startsWith('03') && digits.length === 11) return `92${digits.slice(1)}`
  if (digits.startsWith('3') && digits.length === 10) return `92${digits}`
  return digits.length >= 10 ? digits : null
}

function buildPalaiWhatsAppReminderUrl({
  farmName,
  clientName,
  tagId,
  species,
  monthlyFee,
  billedMonths,
  totalBilled,
  totalPaid,
  balanceDue,
  phone,
}: {
  farmName: string
  clientName: string
  tagId: string
  species: string
  monthlyFee: number
  billedMonths: number
  totalBilled: number
  totalPaid: number
  balanceDue: number
  phone?: string | null
}): string {
  const message = [
    `Assalam-o-Alaikum ${clientName},`,
    ``,
    `Friendly Palai boarding reminder from *${farmName}*:`,
    `• Animal Tag: *${tagId}* (${species})`,
    `• Monthly Rate: Rs. ${monthlyFee.toLocaleString()}/month (${billedMonths} mo)`,
    `• Total Billed: Rs. ${totalBilled.toLocaleString()}`,
    `• Paid to Date: Rs. ${totalPaid.toLocaleString()}`,
    `• *Pending Balance Due: Rs. ${balanceDue.toLocaleString()}*`,
    ``,
    `Kindly share confirmation once transferred. JazakAllah!`,
  ].join('\n')

  const encoded = encodeURIComponent(message)
  const formattedPhone = formatPakistanWhatsAppPhone(phone)
  return formattedPhone
    ? `https://wa.me/${formattedPhone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`
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

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const idx = Math.max(0, Math.min(11, (parseInt(m || '1', 10) || 1) - 1))
  return `${monthNames[idx]} ${y || ''}`.trim()
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

  // Ensure default 3 wallets exist & load parallel data
  const [
    wallets,
    { data: palaiAnimals },
    { data: selfAnimals },
    { data: weightLogs },
    { data: globalTxns },
    { data: animalFinLogs },
    { data: contactsList },
    { data: walletAuditRows },
  ] = await Promise.all([
    ensureDefaultWallets(supabase, farm.id),
    supabase
      .from('livestock_master')
      .select('id, tag_id, species, client_name, monthly_palai_fee, acquisition_date, status, cost_basis')
      .eq('farm_id', farm.id)
      .neq('ownership', 'Self')
      .eq('status', 'Active'),
    supabase
      .from('livestock_master')
      .select('id, tag_id, species, acquisition_date, status, cost_basis, batch_label, cash_cycle_role')
      .eq('farm_id', farm.id)
      .eq('ownership', 'Self')
      .eq('status', 'Active'),
    supabase
      .from('animal_weight_logs')
      .select('animal_id, weight_kg, recorded_date')
      .eq('farm_id', farm.id)
      .order('recorded_date', { ascending: false }),
    supabase
      .from('transactions')
      .select('id, txn_date, type, category, amount, description, target_species')
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
    supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('farm_id', farm.id),
    supabase
      .from('wallet_transactions')
      .select(`
        id,
        wallet_id,
        animal_id,
        entry_type,
        amount,
        source_type,
        txn_date,
        notes,
        created_at
      `)
      .eq('farm_id', farm.id)
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  const todayStr = new Date().toISOString().split('T')[0]
  const currentMonthStr = todayStr.slice(0, 7)

  const walletByType: Partial<Record<WalletType, (typeof wallets)[number]>> = {}
  const walletById: Record<string, (typeof wallets)[number]> = {}
  wallets.forEach(w => {
    walletByType[w.wallet_type] = w
    walletById[w.id] = w
  })

  const operatingWallet = walletByType.OPERATING_CASH
  const capitalWallet = walletByType.ANIMAL_CAPITAL
  const emergencyWallet = walletByType.EMERGENCY_MORTALITY

  const operatingBalance = Number(operatingWallet?.current_balance || 0)
  const capitalBalance = Number(capitalWallet?.current_balance || 0)
  const emergencyBalance = Number(emergencyWallet?.current_balance || 0)

  // 10% Emergency / Mortality Fund target from active self-owned livestock valuation
  const totalSelfLivestockValue = (selfAnimals || []).reduce(
    (sum: number, a: any) => sum + (Number(a.cost_basis) || 0),
    0
  )
  const tenPercentEmergencyTarget = Math.round(totalSelfLivestockValue * 0.1)

  // Phase 4 Metrics: 60/20/20 Sale Split Totals & Mortality Claims from wallet_transactions
  const allAuditRows = (walletAuditRows || []) as Array<any>
  const sale60Total = allAuditRows
    .filter(r => r.source_type === 'ANIMAL_SALE_60_CAPITAL' && r.entry_type === 'IN')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const sale20OpTotal = allAuditRows
    .filter(r => r.source_type === 'ANIMAL_SALE_20_OPERATING' && r.entry_type === 'IN')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  // 20% retained profit derived from 60% capital split (60% -> 20% means profit20 = capital60 / 3)
  const implied20RetainedProfit = Math.round(sale60Total / 3)

  const mortalityClaimedTotal = allAuditRows
    .filter(r => r.source_type === 'MORTALITY_CLAIM' && r.entry_type === 'OUT')
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const contactPhoneByName: Record<string, string> = {}
  ;(contactsList || []).forEach(c => {
    const key = (c.name || '').trim().toLowerCase()
    if (key && c.phone) {
      contactPhoneByName[key] = c.phone
    }
  })

  // Palai Client Billing & Dues Statement per active Palai animal
  const palaiClientLedger = (palaiAnimals || []).map(a => {
    const rate = Number(a.monthly_palai_fee) > 0 ? Number(a.monthly_palai_fee) : 5000
    const acqStr = a.acquisition_date ? String(a.acquisition_date).split('T')[0] : todayStr
    const daysBoarded = Math.max(1, daysBetweenDateStrings(acqStr, todayStr, 1))
    const billedMonths = Math.max(1, Math.ceil(daysBoarded / 30))
    const accruedBoarding = rate * billedMonths

    const animalRevenueLogs = (animalFinLogs || []).filter(
      (f: any) => f.animal_id === a.id && f.entry_type === 'Revenue'
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
            farmName: farm.farm_name || 'BAA BAA Shed',
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

  // Latest weight per animal
  const latestWeightByAnimal: Record<string, number> = {}
  ;(weightLogs || []).forEach(w => {
    if (w.animal_id && latestWeightByAnimal[w.animal_id] === undefined) {
      latestWeightByAnimal[w.animal_id] = Math.max(0, Number(w.weight_kg) || 0)
    }
  })

  // Merge Ledger
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
  }

  const unifiedList: UnifiedLedgerItem[] = []

  ;(globalTxns || []).forEach((t: any) => {
    const sp = extractSpeciesFromTxn(t)
    const cleanDesc = stripSpeciesTag(t.description)
    unifiedList.push({
      id: t.id,
      source: 'global',
      date: String(t.txn_date).split('T')[0],
      type: t.type === 'Income' ? 'Income' : 'Expense',
      category: t.category || 'General',
      amount: Number(t.amount) || 0,
      description: cleanDesc,
      targetSpecies: sp,
    })
  })

  ;(animalFinLogs || []).forEach((f: any) => {
    const animalInfo = Array.isArray(f.livestock_master) ? f.livestock_master[0] : f.livestock_master
    const noteStr = String(f.notes || '')
    unifiedList.push({
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
    })
  })

  unifiedList.sort((a, b) => b.date.localeCompare(a.date))

  const cashItemsForAnalytics = unifiedList
    .filter(item => !item.isAutoBill)
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

  // Phase 3: Staggered Batches (Jan-Jul / Mar-Sep / May-Nov) + Short-Cycle Cash Mix
  const { batches: staggeredBatches, shortCycleMix } = computeStaggeredBatchesAndShortCycle({
    selfAnimals: selfAnimals || [],
    items: cashItemsForAnalytics,
    todayStr,
  })

  // Phase 5: Monthly Retained Profit & Capital Growth Report
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

  allAuditRows.forEach(r => {
    const ym = String(r.txn_date || todayStr).slice(0, 7)
    const row = ensureMonthRow(ym)
    const amt = Number(r.amount) || 0
    if (r.source_type === 'ANIMAL_SALE_60_CAPITAL' && r.entry_type === 'IN') {
      row.capitalIn60 += amt
      row.retainedProfit20 += Math.round(amt / 3)
    } else if (r.source_type === 'ANIMAL_SALE_20_OPERATING' && r.entry_type === 'IN') {
      row.operatingIn20 += amt
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

  const thirtyDayOperatingTarget = cashPulse.thirtyDayTargetRequired
  const runwayProgressPct =
    thirtyDayOperatingTarget > 0
      ? Math.min(100, Math.round((Math.max(0, operatingBalance) / thirtyDayOperatingTarget) * 100))
      : operatingBalance > 0
      ? 100
      : 0

  const filteredLedger = unifiedList.filter(item => {
    if (filterType === 'Income' && item.type !== 'Income') return false
    if (filterType === 'Expense' && item.type !== 'Expense') return false
    if (!normalizedQuery) return true

    const haystack = [
      item.category,
      item.description,
      item.tagId || '',
      item.targetSpecies || '',
      item.type,
      formatDateDDMMYYYY(item.date),
      String(item.amount),
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  const exportableRows: ExportableTxn[] = filteredLedger.map(item => ({
    date: item.date,
    type: item.type,
    category: item.category,
    tagOrSpecies:
      item.source === 'animal' && item.tagId
        ? `${item.tagId} (${item.targetSpecies || 'Goat'})`
        : item.targetSpecies || 'Goat',
    amount: item.amount,
    description: item.description,
    source: item.source,
  }))

  const exportFileName = `${(farm.farm_name || 'farm')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-finances-${filterType.toLowerCase()}-${todayStr}.csv`

  const totalFilteredCount = filteredLedger.length
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const paginatedLedger = filteredLedger.slice(startIndex, startIndex + pageSize)

  const totalIncome = unifiedList.filter(t => t.type === 'Income').reduce((acc, t) => acc + t.amount, 0)
  const totalExpense = unifiedList.filter(t => t.type === 'Expense').reduce((acc, t) => acc + t.amount, 0)
  const netBalance = totalIncome - totalExpense
  const unrecoveredDeficit = netBalance < 0 ? Math.abs(netBalance) : 0

  // Preview for default Goat species using shared breakeven pool helper
  const defaultGoatSelfAnimals = (selfAnimals || []).filter(a => (a.species || 'Goat') === 'Goat')
  const previewWeightedAnimals = computeWeightedAnimalsForPool(
    defaultGoatSelfAnimals,
    latestWeightByAnimal,
    todayStr
  )
  const previewTotalWeight = previewWeightedAnimals.reduce((sum, a) => sum + a.effectiveWeight, 0)

  const expenseByCategory: Record<string, number> = {}
  unifiedList
    .filter(t => t.type === 'Expense')
    .forEach(t => {
      const cat = t.category || 'General'
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + t.amount
    })

  const sortedExpenseCategories = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1])

  // Server Action: Assign Batch & Short-Cycle Role on an Animal
  const assignBatchAndCycleAction = async (formData: FormData) => {
    'use server'
    const animalId = ((formData.get('animalId') as string) || '').trim()
    const batchLabel = ((formData.get('batch_label') as string) || '').trim()
    const cashCycleRole = ((formData.get('cash_cycle_role') as string) || 'Meat / Fattening').trim()

    if (!animalId || !batchLabel) {
      return redirect(`/finances?error=${encodeURIComponent('Select an animal and batch cycle.')}`)
    }

    const supabaseClient = await createClient()
    const { error: updErr } = await supabaseClient
      .from('livestock_master')
      .update({
        batch_label: batchLabel,
        cash_cycle_role: cashCycleRole,
      })
      .eq('id', animalId)
      .eq('farm_id', farm.id)

    if (updErr) {
      return redirect(`/finances?error=${encodeURIComponent(updErr.message)}`)
    }

    return redirect(
      `/finances?msg=${encodeURIComponent(
        `Updated animal rotation to ${batchLabel} (${cashCycleRole}).`
      )}`
    )
  }

  // Server Action: Fund / Adjust a Wallet (3 Wallets Rule)
  const fundWalletAction = async (formData: FormData) => {
    'use server'
    const walletType = ((formData.get('wallet_type') as string) || 'OPERATING_CASH') as WalletType
    const entryType = ((formData.get('entry_type') as string) || 'IN') === 'OUT' ? 'OUT' : 'IN'
    const amount = parseFloat((formData.get('amount') as string) || '0')
    const txnDate = ((formData.get('txn_date') as string) || '').trim() || new Date().toISOString().split('T')[0]
    const notes = ((formData.get('notes') as string) || '').trim() || 'Wallet Funding / Adjustment'

    if (isNaN(amount) || amount <= 0) {
      return redirect(`/finances?error=${encodeURIComponent('Enter a valid wallet amount greater than 0.')}`)
    }

    const supabaseClient = await createClient()
    const farmWallets = await ensureDefaultWallets(supabaseClient, farm.id)
    const targetWallet = farmWallets.find(w => w.wallet_type === walletType)

    if (!targetWallet) {
      return redirect(`/finances?error=${encodeURIComponent('Target wallet not found.')}`)
    }

    const sourceType =
      walletType === 'EMERGENCY_MORTALITY' && entryType === 'OUT'
        ? 'MORTALITY_CLAIM'
        : 'WALLET_TRANSFER'

    const { error: wtErr } = await supabaseClient.from('wallet_transactions').insert([
      {
        farm_id: farm.id,
        wallet_id: targetWallet.id,
        entry_type: entryType,
        amount,
        source_type: sourceType,
        txn_date: txnDate,
        notes,
      },
    ])

    if (wtErr) {
      return redirect(`/finances?error=${encodeURIComponent(wtErr.message)}`)
    }

    await recalculateWalletBalance(supabaseClient, farm.id, targetWallet.id)

    return redirect(
      `/finances?msg=${encodeURIComponent(
        `${targetWallet.name}: ${entryType === 'IN' ? '+' : '-'}Rs. ${amount.toLocaleString()} recorded.`
      )}`
    )
  }

  // Phase 5 Server Action: Delete Wallet Audit Transaction & Recalculate Wallet Balance
  const deleteWalletAuditRowAction = async (formData: FormData) => {
    'use server'
    const wtId = ((formData.get('wtId') as string) || '').trim()
    const walletId = ((formData.get('walletId') as string) || '').trim()
    if (!wtId || !walletId) {
      return redirect(`/finances?error=${encodeURIComponent('Invalid wallet transaction ID.')}`)
    }

    const supabaseClient = await createClient()
    const { error: delErr } = await supabaseClient
      .from('wallet_transactions')
      .delete()
      .eq('id', wtId)
      .eq('farm_id', farm.id)

    if (delErr) {
      return redirect(`/finances?error=${encodeURIComponent(delErr.message)}`)
    }

    await recalculateWalletBalance(supabaseClient, farm.id, walletId)

    return redirect(`/finances?msg=${encodeURIComponent('Wallet audit entry removed and balance recalculated.')}`)
  }

  // Server Action: Log Palai Client Boarding Payment (credits Operating Cash Wallet)
  const logPalaiPaymentAction = async (formData: FormData) => {
    'use server'
    const animalId = ((formData.get('animalId') as string) || '').trim()
    const amount = parseFloat((formData.get('amount') as string) || '0')
    const paymentDate = ((formData.get('payment_date') as string) || '').trim() || new Date().toISOString().split('T')[0]
    const notes = ((formData.get('notes') as string) || '').trim() || 'Palai Client Boarding Payment'

    if (!animalId || isNaN(amount) || amount <= 0) {
      return redirect(`/finances?error=${encodeURIComponent('Enter a valid payment amount greater than 0.')}`)
    }

    const supabaseClient = await createClient()

    const { data: palaiRow } = await supabaseClient
      .from('livestock_master')
      .select('id, tag_id, client_name')
      .eq('id', animalId)
      .eq('farm_id', farm.id)
      .single()

    if (!palaiRow) {
      return redirect(`/finances?error=${encodeURIComponent('Palai animal not found.')}`)
    }

    const { error: payErr } = await supabaseClient.from('animal_financial_logs').insert([
      {
        farm_id: farm.id,
        animal_id: animalId,
        entry_type: 'Revenue',
        category: 'Palai Boarding Fee',
        amount,
        transaction_date: paymentDate,
        notes: `${notes} (${palaiRow.client_name || palaiRow.tag_id})`,
      },
    ])

    if (payErr) {
      return redirect(`/finances?error=${encodeURIComponent(payErr.message)}`)
    }

    // Credit Palai client payment into Wallet 1: Operating Cash
    const farmWallets = await ensureDefaultWallets(supabaseClient, farm.id)
    const opWallet = farmWallets.find(w => w.wallet_type === 'OPERATING_CASH')
    if (opWallet) {
      await supabaseClient.from('wallet_transactions').insert([
        {
          farm_id: farm.id,
          wallet_id: opWallet.id,
          entry_type: 'IN',
          amount,
          source_type: 'PALAI_PAYMENT',
          txn_date: paymentDate,
          notes: `Palai Payment: ${palaiRow.tag_id} (${palaiRow.client_name || 'Client'})`,
        },
      ])
      await recalculateWalletBalance(supabaseClient, farm.id, opWallet.id)
    }

    if (palaiRow.client_name) {
      const { data: contactMatch } = await supabaseClient
        .from('contacts')
        .select('id, opening_balance')
        .eq('farm_id', farm.id)
        .ilike('name', palaiRow.client_name.trim())
        .maybeSingle()

      if (contactMatch) {
        const nextBal = Math.max(0, (Number(contactMatch.opening_balance) || 0) - amount)
        await supabaseClient
          .from('contacts')
          .update({ opening_balance: nextBal })
          .eq('id', contactMatch.id)
      }
    }

    return redirect(
      `/finances?msg=${encodeURIComponent(
        `Logged Palai payment of Rs. ${amount.toLocaleString()} for ${palaiRow.tag_id} (${palaiRow.client_name || 'Client'}) into Operating Cash.`
      )}`
    )
  }

  // Server Action: One-Click Species-Scoped Weight & Acquisition-Based Deficit Allocation
  const allocateDeficitByWeight = async (formData: FormData) => {
    'use server'
    const targetSpecies = ((formData.get('allocate_species') as string) || 'Goat').trim()
    const allocationDate = ((formData.get('allocation_date') as string) || '').trim() || new Date().toISOString().split('T')[0]
    const periodLabel = ((formData.get('period_label') as string) || '').trim() || `${targetSpecies} Deficit Split`
    const customAmountRaw = ((formData.get('custom_amount') as string) || '').trim()
    const parsedCustomAmount = customAmountRaw ? parseFloat(customAmountRaw) : NaN

    const supabaseClient = await createClient()

    const [
      { data: liveGlobalTxns },
      { data: liveAnimalLogs },
      { data: liveSelfAnimals },
      { data: liveWeightLogs },
    ] = await Promise.all([
      supabaseClient.from('transactions').select('type, amount, target_species, description').eq('farm_id', farm.id),
      supabaseClient.from('animal_financial_logs').select('entry_type, amount, livestock_master(species)').eq('farm_id', farm.id),
      supabaseClient
        .from('livestock_master')
        .select('id, tag_id, species, acquisition_date')
        .eq('farm_id', farm.id)
        .eq('ownership', 'Self')
        .eq('status', 'Active'),
      supabaseClient
        .from('animal_weight_logs')
        .select('animal_id, weight_kg, recorded_date')
        .eq('farm_id', farm.id)
        .order('recorded_date', { ascending: false }),
    ])

    const isSharedPool = targetSpecies === 'Shared (All Species)'

    let speciesIncome = 0
    let speciesExpense = 0

    ;(liveGlobalTxns || []).forEach((t: any) => {
      const txnSp = extractSpeciesFromTxn(t)
      if (!isSharedPool && txnSp !== targetSpecies && txnSp !== 'Shared (All Species)') return
      const amt = Number(t.amount) || 0
      if (t.type === 'Income') speciesIncome += amt
      else speciesExpense += amt
    })

    ;(liveAnimalLogs || []).forEach((f: any) => {
      const animalInfo = Array.isArray(f.livestock_master) ? f.livestock_master[0] : f.livestock_master
      const finSp = animalInfo?.species || 'Goat'
      if (!isSharedPool && finSp !== targetSpecies) return
      const amt = Number(f.amount) || 0
      if (f.entry_type === 'Revenue') speciesIncome += amt
      else speciesExpense += amt
    })

    let overallIncome = 0
    let overallExpense = 0
    ;(liveGlobalTxns || []).forEach((t: any) => {
      const amt = Number(t.amount) || 0
      if (t.type === 'Income') overallIncome += amt
      else overallExpense += amt
    })
    ;(liveAnimalLogs || []).forEach((f: any) => {
      const amt = Number(f.amount) || 0
      if (f.entry_type === 'Revenue') overallIncome += amt
      else overallExpense += amt
    })

    const speciesDeficit = Math.max(0, speciesExpense - speciesIncome)
    const overallDeficit = Math.max(0, overallExpense - overallIncome)
    const suggestedPool = speciesDeficit > 0 ? speciesDeficit : overallDeficit

    const poolToAllocate =
      !isNaN(parsedCustomAmount) && parsedCustomAmount > 0
        ? Math.round(parsedCustomAmount)
        : Math.round(suggestedPool)

    if (poolToAllocate <= 0) {
      return redirect(`/finances?error=${encodeURIComponent(`No unrecovered deficit available to allocate for ${targetSpecies}.`)}`)
    }

    const matchingSelfAnimals = (liveSelfAnimals || []).filter(a => {
      if (isSharedPool) return true
      return (a.species || 'Goat') === targetSpecies
    })

    if (matchingSelfAnimals.length === 0) {
      return redirect(`/finances?error=${encodeURIComponent(`No active farm-owned (Self) ${targetSpecies} animals found.`)}`)
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
        `/finances?error=${encodeURIComponent(
          `No active ${targetSpecies} animals existed on or before ${formatDateDDMMYYYY(allocationDate)}.`
        )}`
      )
    }

    const sumEffectiveWeight = weightedAnimals.reduce((sum, a) => sum + a.effectiveWeight, 0)
    const allocationTag = `Farm Deficit Split [${targetSpecies}] (${periodLabel} @ ${allocationDate})`

    const insertsToApply: Array<{
      animal_id: string
      farm_id: string
      entry_type: string
      category: string
      amount: number
      transaction_date: string
      notes: string
    }> = []

    let allocatedSum = 0

    for (let idx = 0; idx < weightedAnimals.length; idx++) {
      const animal = weightedAnimals[idx]

      const { data: existingEntry } = await supabaseClient
        .from('animal_financial_logs')
        .select('id')
        .eq('animal_id', animal.id)
        .eq('notes', allocationTag)
        .maybeSingle()

      if (existingEntry) continue

      const shareRatio = animal.effectiveWeight / sumEffectiveWeight
      const isLast = idx === weightedAnimals.length - 1
      const shareAmount = isLast
        ? Math.max(0, poolToAllocate - allocatedSum)
        : Math.round(poolToAllocate * shareRatio)

      allocatedSum += shareAmount

      if (shareAmount > 0) {
        insertsToApply.push({
          animal_id: animal.id,
          farm_id: farm.id,
          entry_type: 'Expense',
          category: 'Farm Overhead / Deficit Share',
          amount: shareAmount,
          transaction_date: allocationDate,
          notes: `${allocationTag} — ${(shareRatio * 100).toFixed(1)}% (${animal.basisNote})`,
        })
      }
    }

    if (insertsToApply.length === 0) {
      return redirect(
        `/finances?msg=${encodeURIComponent(
          `Deficit for ${targetSpecies} (${periodLabel} @ ${allocationDate}) was already allocated.`
        )}`
      )
    }

    const { error: insertErr } = await supabaseClient
      .from('animal_financial_logs')
      .insert(insertsToApply)

    if (insertErr) {
      return redirect(`/finances?error=${encodeURIComponent('Allocation failed: ' + insertErr.message)}`)
    }

    return redirect(
      `/finances?msg=${encodeURIComponent(
        `Allocated Rs. ${poolToAllocate.toLocaleString()} (${targetSpecies}) across ${insertsToApply.length} Self animal(s) in animal_financial_logs.`
      )}`
    )
  }

  // Server Action: Run Monthly Palai Auto-Billing
  const runMonthlyPalaiBilling = async (formData: FormData) => {
    'use server'
    const billingMonth = formData.get('billing_month') as string
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

  // Server Action: Add Global Farm Transaction (with Target Species & Wallet Guardrail)
  const addTransaction = async (formData: FormData) => {
    'use server'
    const rawType = ((formData.get('type') as string) || 'Expense').trim()
    const type = rawType === 'Income' ? 'Income' : 'Expense'
    const targetSpecies = ((formData.get('target_species') as string) || 'Goat').trim()
    const category = ((formData.get('category') as string) || '').trim()
    const parsedAmount = parseFloat((formData.get('amount') as string) || '0')
    const txn_date = ((formData.get('txn_date') as string) || '').trim() || new Date().toISOString().split('T')[0]
    const rawDescription = ((formData.get('description') as string) || '').trim()
    const selectedWalletType = ((formData.get('wallet_type') as string) || 'OPERATING_CASH') as WalletType

    if (!category) {
      return redirect(`/finances?error=${encodeURIComponent('Category is required.')}`)
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return redirect(`/finances?error=${encodeURIComponent('Please enter a valid amount greater than 0.')}`)
    }

    // 3 Wallets Guardrail: Do not mix daily operating expenses into Animal Buying Capital
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
        `/finances?error=${encodeURIComponent(
          `3 Wallets Rule: "${category}" is an operating expense. Select Operating Cash (30-Day) instead of Animal Buying Capital.`
        )}`
      )
    }

    const descriptionWithTag = rawDescription
      ? `${rawDescription} [Species: ${targetSpecies}]`
      : `[Species: ${targetSpecies}]`

    const supabaseClient = await createClient()

    const { error } = await supabaseClient.from('transactions').insert([
      {
        farm_id: farm.id,
        type,
        category,
        amount: parsedAmount,
        txn_date,
        description: descriptionWithTag,
        target_species: targetSpecies,
      },
    ])

    if (error) return redirect(`/finances?error=${encodeURIComponent(error.message)}`)

    // Sync wallet ledger for selected wallet
    const farmWallets = await ensureDefaultWallets(supabaseClient, farm.id)
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

      await supabaseClient.from('wallet_transactions').insert([
        {
          farm_id: farm.id,
          wallet_id: targetWallet.id,
          entry_type: type === 'Income' ? 'IN' : 'OUT',
          amount: parsedAmount,
          source_type: sourceType,
          txn_date,
          notes: `${category} (${targetSpecies})${rawDescription ? ` — ${rawDescription}` : ''}`,
        },
      ])
      await recalculateWalletBalance(supabaseClient, farm.id, targetWallet.id)
    }

    return redirect(`/finances?msg=${encodeURIComponent(`Transaction recorded under ${targetSpecies}.`)}`)
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

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Admin Ledger &amp; 3-Wallet Cash Engine
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Financials &amp; Billing</h1>
            <p className="text-sm text-slate-500">3 Wallets discipline, 60/20/20 sale split, mortality claims, executive audit &amp; Palai billing</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FinancesExportButton rows={exportableRows} fileName={exportFileName} />
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

        {/* Phase 2: Weekly Cash Out vs Cash In Red Flag Card + 30-Day Runway */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Weekly Cash Pulse (7-Day Rule) */}
          <div
            className={`lg:col-span-2 p-6 rounded-2xl border shadow-sm space-y-4 ${
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
                    {formatDateDDMMYYYY(cashPulse.windowStartDate)} → {formatDateDDMMYYYY(cashPulse.windowEndDate)} (7d)
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-900 mt-1.5">
                  Weekly Cash Out vs. Cash In Monitor
                </h2>
              </div>

              {cashPulse.isRedFlag && (
                <a
                  href="#breakeven-sync"
                  className="px-3.5 py-2 bg-rose-700 hover:bg-rose-800 text-white font-bold rounded-xl text-xs shadow-xs transition shrink-0 text-center"
                >
                  ⚖️ Sync Gap to Break-Even
                </a>
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
                    ? 'Capital burn active — allocate onto Self stock'
                    : 'Short-cycle inflows covering weekly burn'}
                </p>
              </div>
            </div>
          </div>

          {/* 30-Day Operating Runway Meter */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                  30-Day Runway Rule
                </span>
                <span className="text-xs font-mono font-bold text-slate-700">
                  {cashPulse.runwayDays !== null ? `${cashPulse.runwayDays} days` : '—'}
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 pt-1">
                Operating Cash Buffer
              </h2>
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
                  Avg Burn: <strong className="font-mono text-slate-800">Rs. {cashPulse.avgDailyOperatingBurn.toLocaleString()}/day</strong>
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

        {/* Phase 3: Staggered Batches (Jan-Jul / Mar-Sep / May-Nov) + Short-Cycle Cash Mix */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                  Staggered Batches &amp; Short-Cycle Cash
                </span>
                {shortCycleMix.unassignedBatchCount > 0 && (
                  <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    {shortCycleMix.unassignedBatchCount} Self animal(s) auto-grouped by acquisition date
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-900 mt-1">
                6-Month Staggered Batch Rotation (Jan–Jul • Mar–Sep • May–Nov)
              </h2>
              <p className="text-xs text-slate-500">
                Never hold all stock on one single Qurbani timeline—rotate 3 overlapping batches alongside daily Milk, Manure &amp; Kid cash streams
              </p>
            </div>

            {(selfAnimals || []).length > 0 && (
              <form
                action={assignBatchAndCycleAction}
                className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200"
              >
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Self Animal</label>
                  <select
                    name="animalId"
                    required
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900"
                  >
                    {(selfAnimals || []).map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.tag_id} ({a.species})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Batch Window</label>
                  <select
                    name="batch_label"
                    defaultValue={STAGGERED_BATCH_DEFINITIONS[0].label}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
                  >
                    {STAGGERED_BATCH_DEFINITIONS.map(b => (
                      <option key={b.key} value={b.label}>{b.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Cash Cycle Role</label>
                  <select
                    name="cash_cycle_role"
                    defaultValue={CASH_CYCLE_ROLES[0]}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
                  >
                    {CASH_CYCLE_ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
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

          {/* 3 Overlapping Batches */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {staggeredBatches.map(batch => {
              const phaseBadge =
                batch.phaseNow === 'BUY_WINDOW'
                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                  : batch.phaseNow === 'SELL_WINDOW'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300'

              const phaseLabel =
                batch.phaseNow === 'BUY_WINDOW'
                  ? 'BUY WINDOW'
                  : batch.phaseNow === 'SELL_WINDOW'
                  ? 'SELL / HARVEST'
                  : 'GROWOUT PHASE'

              return (
                <div
                  key={batch.key}
                  className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">{batch.label}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${phaseBadge}`}>
                      {phaseLabel}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-bold font-mono text-slate-900">
                      {batch.animalCount} <span className="text-xs font-sans font-normal text-slate-500">head</span>
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-700">
                      Rs. {batch.totalCostBasis.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Buy: <strong>{batch.buyWindow}</strong> • Sell: <strong>{batch.sellWindow}</strong>
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {batch.tags.length > 0 ? (
                      batch.tags.map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-white border border-slate-200 text-slate-800"
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">No animals assigned yet</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Short-Cycle Cash Engine Summary (30d) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200">
              <p className="text-[10px] font-bold uppercase text-emerald-900">30d Milk Cash</p>
              <p className="text-base font-bold font-mono text-emerald-700 mt-0.5">
                Rs. {shortCycleMix.milkIncome30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">{shortCycleMix.milkProducersCount} dairy animal(s)</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200">
              <p className="text-[10px] font-bold uppercase text-amber-900">30d Manure Cash</p>
              <p className="text-base font-bold font-mono text-amber-800 mt-0.5">
                Rs. {shortCycleMix.manureIncome30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">Weekly khad / compost</p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200">
              <p className="text-[10px] font-bold uppercase text-indigo-900">30d Kid &amp; Quick Sales</p>
              <p className="text-base font-bold font-mono text-indigo-800 mt-0.5">
                Rs. {shortCycleMix.kidAndQuickSale30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">{shortCycleMix.kidCropCount} breeding / kid stock</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-100/80 border border-slate-200">
              <p className="text-[10px] font-bold uppercase text-slate-700">30d Short-Cycle Total</p>
              <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                Rs. {shortCycleMix.totalShortCycle30d.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-500">Feeds daily operating cash</p>
            </div>
          </div>
        </div>

        {/* 3 Wallets Rule + Phase 4 60/20/20 & Mortality Claim Summary */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                3 Wallets Rule + 60/20/20 Sale Split &amp; Mortality Protection
              </h2>
              <p className="text-xs text-slate-500">
                Operating Cash (30-day ops), Animal Buying Capital (60% sale pool), and Emergency / Mortality Reserve (10% of stock)
              </p>
            </div>

            <form action={fundWalletAction} className="flex flex-wrap items-end gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Wallet</label>
                <select
                  name="wallet_type"
                  defaultValue="OPERATING_CASH"
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
                >
                  <option value="OPERATING_CASH">1. Operating Cash</option>
                  <option value="ANIMAL_CAPITAL">2. Animal Buying Cash</option>
                  <option value="EMERGENCY_MORTALITY">3. Emergency / Mortality</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Flow</label>
                <select
                  name="entry_type"
                  defaultValue="IN"
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
                >
                  <option value="IN">Add (+ IN)</option>
                  <option value="OUT">Withdraw (- OUT)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Amount (PKR)</label>
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
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">Note</label>
                <input
                  name="notes"
                  type="text"
                  placeholder="Initial funding / transfer"
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                20% Sale Ops Inflow: <strong className="font-mono text-emerald-700">+Rs. {sale20OpTotal.toLocaleString()}</strong> • 30d Target: <strong className="font-mono">Rs. {thirtyDayOperatingTarget.toLocaleString()}</strong>
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
                60% Sale Capital: <strong className="font-mono text-blue-800">+Rs. {sale60Total.toLocaleString()}</strong> • Est. 20% Retained Profit: <strong className="font-mono text-emerald-700">Rs. {implied20RetainedProfit.toLocaleString()}</strong>
              </p>
            </div>

            {/* Wallet 3 */}
            <div className="p-4 rounded-xl bg-rose-50/50 border border-rose-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-900">
                  Wallet 3 • Emergency / Mortality
                </span>
                <span className="text-[10px] font-mono text-rose-800">10% Stock Rule</span>
              </div>
              <p className="text-2xl font-bold font-mono text-slate-900">
                Rs. {emergencyBalance.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-600">
                10% Target: <strong className="font-mono">Rs. {tenPercentEmergencyTarget.toLocaleString()}</strong> • Mortality Claims Paid: <strong className="font-mono text-rose-700">Rs. {mortalityClaimedTotal.toLocaleString()}</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Phase 5: Monthly Retained Profit, Capital Growth & Executive Wallet Audit Ledger */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Monthly Retained Profit & Cash Report */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-900 text-white">
              <h2 className="text-sm font-bold">Monthly Retained Profit &amp; Cash Report</h2>
              <p className="text-[11px] text-slate-400">
                Monthly cash flow, 60/20/20 split routing &amp; mortality claims
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
                        Net: {mRow.netCashFlow >= 0 ? `+Rs. ${mRow.netCashFlow.toLocaleString()}` : `-Rs. ${Math.abs(mRow.netCashFlow).toLocaleString()}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>In: Rs. {mRow.cashIn.toLocaleString()}</span>
                      <span>Out: Rs. {mRow.cashOut.toLocaleString()}</span>
                    </div>
                    {(mRow.capitalIn60 > 0 || mRow.retainedProfit20 > 0 || mRow.mortalityClaimed > 0) && (
                      <div className="flex flex-wrap gap-2 pt-1 text-[10px] font-mono">
                        {mRow.capitalIn60 > 0 && (
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                            60% Cap: +Rs. {mRow.capitalIn60.toLocaleString()}
                          </span>
                        )}
                        {mRow.retainedProfit20 > 0 && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                            20% Profit: Rs. {mRow.retainedProfit20.toLocaleString()}
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
                <p className="p-6 text-xs text-slate-400 text-center">No monthly cash flow records yet.</p>
              )}
            </div>
          </div>

          {/* Executive Wallet Audit Ledger */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Executive Wallet Audit Ledger</h2>
                <p className="text-[11px] text-slate-500">
                  Every IN/OUT movement across Operating Cash, Animal Buying Capital, and 10% Emergency Fund
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">{allAuditRows.length} entries</span>
            </div>

            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-100 text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">Date</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">Wallet &amp; Type</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">Amount</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase">Audit Note</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-slate-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allAuditRows.length > 0 ? (
                    allAuditRows.slice(0, 20).map((wt: any) => {
                      const wInfo = walletById[wt.wallet_id]
                      const isIn = wt.entry_type === 'IN'
                      return (
                        <tr key={wt.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                            {formatDateDDMMYYYY(wt.txn_date)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="font-bold text-slate-900 block">
                              {wInfo?.name || 'Wallet'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {wt.source_type || wt.entry_type}
                            </span>
                          </td>
                          <td
                            className={`px-4 py-2.5 font-mono font-bold whitespace-nowrap ${
                              isIn ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {isIn ? '+' : '-'} Rs. {Number(wt.amount || 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 max-w-xs truncate">
                            {wt.notes || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <form action={deleteWalletAuditRowAction} className="inline-block">
                              <input type="hidden" name="wtId" value={wt.id} />
                              <input type="hidden" name="walletId" value={wt.wallet_id} />
                              <button
                                type="submit"
                                className="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-medium"
                              >
                                Remove
                              </button>
                            </form>
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

        {/* Palai Client Billing & Dues Ledger + WhatsApp Reminders */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Palai Client Billing &amp; Statement Ledger
              </h2>
              <p className="text-xs text-slate-500">
                Accrued boarding charges vs. client payments received, with 1-click WhatsApp reminders for overdue dues
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-semibold">
                Billed: Rs. {totalPalaiBilled.toLocaleString()}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                Paid: Rs. {totalPalaiPaid.toLocaleString()}
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
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Client &amp; Tag</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Rate / Tenure</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Total Billed</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Paid</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Balance Due</th>
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
                            <span className="text-[10px] font-mono text-slate-400">({row.phone})</span>
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
                      <td className="px-5 py-3.5 text-xs font-mono text-slate-700">
                        <div>Rs. {row.monthly_fee.toLocaleString()}/mo</div>
                        <div className="text-[10px] text-slate-400">
                          {row.daysBoarded}d ({row.billedMonths} mo)
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono font-bold text-slate-900">
                        Rs. {row.totalBilled.toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono font-semibold text-emerald-700">
                        Rs. {row.totalPaid.toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono font-bold">
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
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {row.whatsappUrl && (
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

                          <form action={logPalaiPaymentAction} className="inline-flex items-center gap-1.5">
                            <input type="hidden" name="animalId" value={row.id} />
                            <input type="hidden" name="payment_date" value={todayStr} />
                            <input
                              name="amount"
                              type="number"
                              min="1"
                              step="1"
                              required
                              defaultValue={row.balanceDue > 0 ? row.balanceDue : row.monthly_fee}
                              className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-xs font-mono text-right text-slate-900"
                            />
                            <button
                              type="submit"
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                            >
                              + Pay
                            </button>
                          </form>
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

        {/* One-Click Species-Scoped Weight & Acquisition-Based Deficit Allocation */}
        <div id="breakeven-sync" className="bg-white p-6 rounded-2xl border border-amber-200 shadow-sm space-y-4 scroll-mt-6">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                  Farm-Owned Break-Even Sync
                </span>
                <span className="text-xs font-mono text-slate-500">
                  Goat Self Preview: <strong>{previewWeightedAnimals.length}</strong> animals • Total Weightage: <strong>{previewTotalWeight.toFixed(1)}</strong>
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900">
                One-Click Species-Scoped Deficit Allocation (to Animal Financial Logs)
              </h2>
              <p className="text-xs text-slate-500 max-w-2xl">
                Allocates unrecovered deficit (<strong className="font-mono text-rose-700">Rs. {unrecoveredDeficit.toLocaleString()}</strong>) to matching active <code className="text-slate-700">Self</code> animals by weight &amp; acquisition date—using species average weight or tenure days instead of a 1 kg fallback.
              </p>
            </div>

            <form action={allocateDeficitByWeight} className="flex flex-wrap items-end gap-2.5 bg-amber-50/70 p-3.5 rounded-xl border border-amber-200">
              <div>
                <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">Target Species</label>
                <select
                  name="allocate_species"
                  defaultValue="Goat"
                  className="px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-semibold text-slate-900"
                >
                  {SPECIES_OPTIONS.map(sp => (
                    <option key={sp} value={sp}>{sp}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">Pool Amount (PKR)</label>
                <input
                  name="custom_amount"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={unrecoveredDeficit > 0 ? unrecoveredDeficit : ''}
                  placeholder={String(unrecoveredDeficit || 0)}
                  className="w-28 px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-mono font-bold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">Period Label</label>
                <input
                  name="period_label"
                  type="text"
                  defaultValue="Jul-Nov 2026 Deficit"
                  className="w-36 px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">Entry Date</label>
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
                disabled={(selfAnimals || []).length === 0}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white font-bold rounded-lg text-xs shadow-xs transition"
              >
                ⚖️ Allocate by Weight
              </button>
            </form>
          </div>

          {previewWeightedAnimals.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100">
              {previewWeightedAnimals.map(a => {
                const ratio = previewTotalWeight > 0 ? a.effectiveWeight / previewTotalWeight : 0
                const previewShare = Math.round(unrecoveredDeficit * ratio)
                return (
                  <div key={a.id} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                    <div>
                      <Link href={`/animals/${a.id}`} className="font-mono font-bold text-slate-900 hover:text-indigo-600">
                        {a.tag_id}
                      </Link>
                      <span className="text-[11px] text-slate-500 ml-1.5">
                        ({a.weightSource === 'Logged'
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
                <div className="flex flex-wrap items-center gap-1.5">
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
                  placeholder="Search by category, species, tag ID, notes, or amount..."
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
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Tag / Species</th>
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
                                {txn.targetSpecies || 'Goat'}
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
              <p className="text-xs text-slate-500 mt-0.5">Record farm-level overheads, rent, labor, or short-cycle sales</p>
            </div>

            <form action={addTransaction} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Target Species *</label>
                  <select
                    name="target_species"
                    required
                    defaultValue="Goat"
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900"
                  >
                    {SPECIES_OPTIONS.map(sp => (
                      <option key={sp} value={sp}>{sp}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Wallet Account *</label>
                <select
                  name="wallet_type"
                  required
                  defaultValue="OPERATING_CASH"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900"
                >
                  <option value="OPERATING_CASH">1. Operating Cash (30-Day Ops)</option>
                  <option value="ANIMAL_CAPITAL">2. Animal Buying Cash (Capital Only)</option>
                  <option value="EMERGENCY_MORTALITY">3. Emergency / Mortality (10% Reserve)</option>
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
      </div>
    </div>
  )
}