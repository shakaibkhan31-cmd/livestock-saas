import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import {
  computeWeightedAnimalsForPool,
  daysBetweenDateStrings,
  formatDateDDMMYYYY,
} from '@/utils/breakeven'
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

  // Run independent read queries in parallel to speed up page load
  const [
    { data: palaiAnimals },
    { data: selfAnimals },
    { data: weightLogs },
    { data: globalTxns },
    { data: animalFinLogs },
    { data: contactsList },
  ] = await Promise.all([
    supabase
      .from('livestock_master')
      .select('id, tag_id, species, client_name, monthly_palai_fee, acquisition_date, status')
      .eq('farm_id', farm.id)
      .neq('ownership', 'Self')
      .eq('status', 'Active'),
    supabase
      .from('livestock_master')
      .select('id, tag_id, species, acquisition_date, status')
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
  ])

  const todayStr = new Date().toISOString().split('T')[0]
  const currentMonthStr = todayStr.slice(0, 7)

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
    unifiedList.push({
      id: f.id,
      source: 'animal',
      date: String(f.transaction_date).split('T')[0],
      type: f.entry_type === 'Revenue' ? 'Income' : 'Expense',
      category: f.category || 'General',
      amount: Number(f.amount) || 0,
      description: f.notes || '',
      targetSpecies: animalInfo?.species || 'Goat',
      animalId: f.animal_id,
      tagId: animalInfo?.tag_id || 'Animal',
    })
  })

  unifiedList.sort((a, b) => b.date.localeCompare(a.date))

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

  // Server Action: Log Palai Client Boarding Payment
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
        `Logged Palai payment of Rs. ${amount.toLocaleString()} for ${palaiRow.tag_id} (${palaiRow.client_name || 'Client'}).`
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

  // Server Action: Add Global Farm Transaction (with Target Species)
  const addTransaction = async (formData: FormData) => {
    'use server'
    const rawType = ((formData.get('type') as string) || 'Expense').trim()
    const type = rawType === 'Income' ? 'Income' : 'Expense'
    const targetSpecies = ((formData.get('target_species') as string) || 'Goat').trim()
    const category = ((formData.get('category') as string) || '').trim()
    const parsedAmount = parseFloat((formData.get('amount') as string) || '0')
    const txn_date = ((formData.get('txn_date') as string) || '').trim()
    const rawDescription = ((formData.get('description') as string) || '').trim()

    if (!category) {
      return redirect(`/finances?error=${encodeURIComponent('Category is required.')}`)
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return redirect(`/finances?error=${encodeURIComponent('Please enter a valid amount greater than 0.')}`)
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
        txn_date: txn_date || new Date().toISOString().split('T')[0],
        description: descriptionWithTag,
        target_species: targetSpecies,
      },
    ])

    if (error) return redirect(`/finances?error=${encodeURIComponent(error.message)}`)
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
                Admin Ledger &amp; Auto-Billing Engine
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Financials &amp; Billing</h1>
            <p className="text-sm text-slate-500">Consolidated farm-wide income, Palai client WhatsApp reminders, CSV export &amp; analytics</p>
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
        <div className="bg-white p-6 rounded-2xl border border-amber-200 shadow-sm space-y-4">
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
              <p className="text-xs text-slate-500 mt-0.5">Record farm-level overheads, rent, labor, or general sales</p>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category *</label>
                <input
                  name="category"
                  type="text"
                  list="common-categories"
                  required
                  placeholder="e.g. Shed Rent, Labor, Utilities"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900"
                />
                <datalist id="common-categories">
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
                  placeholder="e.g. Monthly shed electricity bill"
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