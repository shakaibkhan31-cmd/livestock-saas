import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getUserFarmAndRole } from '@/utils/rbac'
import FeedCommandCenterClient from './FeedCommandCenterClient'

type ActiveAnimalRow = {
  id: string
  tag_id: string
  species: string
  ownership?: string | null
  client_name?: string | null
  acquisition_date?: string | null
}

function getKarachiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatDateDDMMYYYY(dateInput?: string | null): string {
  if (!dateInput) return 'N/A'
  const datePart = String(dateInput).split('T')[0]
  const parts = datePart.split('-')
  if (parts.length === 3) {
    const [year, month, day] = parts
    return `${day}/${month}/${year}`
  }
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 'N/A'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

function distributeExactShares(totalPool: number, weightsOrEqual: number[]): number[] {
  const n = weightsOrEqual.length
  if (n === 0 || totalPool <= 0) return weightsOrEqual.map(() => 0)
  const weightSum = weightsOrEqual.reduce((s, w) => s + w, 0)
  if (weightSum <= 0) return weightsOrEqual.map(() => 0)

  const shares = weightsOrEqual.map(w => Math.floor((totalPool * w) / weightSum))
  const allocatedSum = shares.reduce((s, v) => s + v, 0)
  const remainder = totalPool - allocatedSum
  shares[n - 1] = Math.max(0, shares[n - 1] + remainder)
  return shares
}

function isNextRedirectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

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

const DEFAULT_FEED_SUGGESTIONS = [
  'Kala Chana',
  'Channa Chilka',
  'Soya Bean Chilka',
  'Gandum (Wheat)',
  'Gandum Daliya',
  'Chokar (Wheat Bran)',
  'Bhoosa',
  'Alfalfa Hay / Lucerne',
  'Mong Phalli Missa',
  'Mix Dana / Wanda',
  'Khal',
  'Jau (Barley)',
  'Makai (Maize)',
  'Mineral Mixture & DCP',
  'Maymil Milk Powder',
  'Chicken Starter / Layer Feed',
  'Rabbit Pellets / Dry Lucerne',
]

const DEFAULT_THRESHOLDS_BY_KEY: Record<string, number> = {
  'mineral mixture & dcp': 1,
  'mineral mixture': 1,
  'dcp': 1,
  'maymil milk powder': 2,
  'maymil': 2,
  'bhoosa': 30,
  'kala chana': 5,
  'channa chilka': 10,
  'soya bean chilka': 20,
  'gandum (wheat)': 15,
  'gandum': 15,
  'gandum daliya': 5,
  'chokar (wheat bran)': 30,
  'alfalfa hay / lucerne': 20,
  'alfalfa hay': 20,
  'mong phalli missa': 20,
  'mix dana / wanda': 30,
  'khal': 20,
  'jau (barley)': 15,
  'makai (maize)': 15,
  'chicken starter / layer feed': 15,
  'rabbit pellets / dry lucerne': 10,
}

const DEFAULT_FALLBACK_THRESHOLD_KG = 10

function getDefaultThresholdForFeed(feedName: string): number {
  const key = String(feedName || '').trim().toLowerCase()
  if (!key) return DEFAULT_FALLBACK_THRESHOLD_KG
  if (DEFAULT_THRESHOLDS_BY_KEY[key] !== undefined) {
    return DEFAULT_THRESHOLDS_BY_KEY[key]
  }
  for (const [k, val] of Object.entries(DEFAULT_THRESHOLDS_BY_KEY)) {
    if (key.includes(k) || k.includes(key)) {
      return val
    }
  }
  return DEFAULT_FALLBACK_THRESHOLD_KG
}

export default async function FeedManagementPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
    species?: string
    splitDate?: string
    entryType?: string
    alloc?: string
    q?: string
    page?: string
    from?: string
    to?: string
    lowOnly?: string
    undo?: string
  }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const selectedSpeciesFilter = params.species || 'All'
  const selectedEntryType =
    params.entryType === 'Purchase' || params.entryType === 'Consumption' ? params.entryType : 'All'
  const selectedAllocFilter =
    params.alloc === 'Pending' || params.alloc === 'Allocated' ? params.alloc : 'All'
  const searchQuery = (params.q || '').trim()
  const fromDateFilter = (params.from || '').trim()
  const toDateFilter = (params.to || '').trim()
  const lowStockOnlyFilter = params.lowOnly === '1'
  const undoPayloadEncoded = params.undo || ''

  // RBAC Check
  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')
  const isAdmin = role === 'admin'

  const supabase = await createClient()
  const todayStr = getKarachiDate()

  let loadErrorMsg = params.error || ''
  let allFeedLogs: Array<Record<string, any>> = []
  let activeAnimals: ActiveAnimalRow[] = []
  let inventoryRows: Array<Record<string, any>> = []
  let thresholdRows: Array<Record<string, any>> = []

  try {
    const [logsRes, animalsRes, invRes, threshRes] = await Promise.all([
      supabase
        .from('feed_logs')
        .select('*')
        .eq('farm_id', farm.id)
        .order('log_date', { ascending: false }),
      supabase
        .from('livestock_master')
        .select('id, tag_id, species, ownership, client_name, acquisition_date')
        .eq('farm_id', farm.id)
        .eq('status', 'Active'),
      supabase
        .from('feed_inventory')
        .select('*')
        .eq('farm_id', farm.id),
      supabase
        .from('feed_thresholds')
        .select('feed_name, min_stock_kg')
        .eq('farm_id', farm.id),
    ])

    if (logsRes.error) {
      loadErrorMsg = loadErrorMsg || logsRes.error.message
    } else {
      allFeedLogs = logsRes.data || []
    }

    if (animalsRes.error) {
      loadErrorMsg = loadErrorMsg || animalsRes.error.message
    } else {
      activeAnimals = (animalsRes.data || []) as ActiveAnimalRow[]
    }

    if (!invRes.error) {
      inventoryRows = invRes.data || []
    }

    if (!threshRes.error) {
      thresholdRows = threshRes.data || []
    }
  } catch (err: unknown) {
    if (isNextRedirectError(err)) throw err
    loadErrorMsg =
      loadErrorMsg ||
      (err instanceof Error ? err.message : 'Failed loading feed data from the database.')
  }

  // Auto-learn custom feed names from entries + inventory + thresholds + defaults
  const dynamicFeedSuggestions = Array.from(
    new Set([
      ...DEFAULT_FEED_SUGGESTIONS,
      ...allFeedLogs.map(l => String(l.feed_type || '').trim()).filter(Boolean),
      ...inventoryRows.map(r => String(r.feed_name || r.item_name || '').trim()).filter(Boolean),
      ...thresholdRows.map(t => String(t.feed_name || '').trim()).filter(Boolean),
    ])
  ).sort()

  // Build thresholdByFeedName: DB value if exists, else DEFAULT_THRESHOLDS[feed], else 10
  const dbThresholdMap: Record<string, number> = {}
  thresholdRows.forEach(row => {
    const key = String(row.feed_name || '').trim().toLowerCase()
    const numVal = Number(row.min_stock_kg)
    if (key && Number.isFinite(numVal) && numVal >= 0) {
      dbThresholdMap[key] = numVal
    }
  })

  const thresholdByFeedName: Record<string, number> = {}
  dynamicFeedSuggestions.forEach(feedName => {
    const key = feedName.trim().toLowerCase()
    thresholdByFeedName[key] =
      dbThresholdMap[key] !== undefined ? dbThresholdMap[key] : getDefaultThresholdForFeed(feedName)
  })

  // Helper to sync weighted average rate & closing stock into public.feed_inventory per species
  const syncFeedInventorySnapshot = async (
    supabaseClient: Awaited<ReturnType<typeof createClient>>,
    farmId: string,
    feedName: string,
    category: string,
    dateStr: string,
    noteText: string | null
  ) => {
    const cleanFeedName = String(feedName || '').trim()
    if (!cleanFeedName) return

    let logsQuery = supabaseClient
      .from('feed_logs')
      .select('quantity_kg, total_cost, entry_type')
      .eq('farm_id', farmId)
      .ilike('feed_type', cleanFeedName)

    if (category && category !== 'Shared (All Species)') {
      logsQuery = logsQuery.eq('target_species', category)
    }

    const { data: logsForName, error: logsErr } = await logsQuery
    if (logsErr) return

    let purchKg = 0
    let purchCost = 0
    let consKg = 0
    ;(logsForName || []).forEach(l => {
      const q = Number(l.quantity_kg) || 0
      const c = Number(l.total_cost) || 0
      if (l.entry_type === 'Purchase' || !l.entry_type) {
        purchKg += q
        purchCost += c
      } else {
        consKg += q
      }
    })

    const closingBalanceKg = Number((purchKg - consKg).toFixed(2))
    const weightedAvgRate = purchKg > 0 ? Number((purchCost / purchKg).toFixed(2)) : 0
    const effectiveThreshold =
      dbThresholdMap[cleanFeedName.toLowerCase()] ?? getDefaultThresholdForFeed(cleanFeedName)

    const { data: existingInv, error: selInvErr } = await supabaseClient
      .from('feed_inventory')
      .select('id, low_stock_threshold_kg')
      .eq('farm_id', farmId)
      .eq('category', category)
      .ilike('feed_name', cleanFeedName)
      .limit(1)

    if (selInvErr) return

    if (existingInv && existingInv.length > 0) {
      await supabaseClient
        .from('feed_inventory')
        .update({
          feed_name: cleanFeedName,
          item_name: cleanFeedName,
          category,
          purchase_kg: purchKg,
          closing_kg: closingBalanceKg,
          current_stock_kg: closingBalanceKg,
          cost_per_kg: weightedAvgRate,
          unit_cost_per_kg: weightedAvgRate,
          low_stock_threshold_kg: effectiveThreshold,
          stock_check_date: dateStr,
          notes: noteText,
        })
        .eq('id', existingInv[0].id)
        .eq('farm_id', farmId)
    } else {
      await supabaseClient.from('feed_inventory').insert([
        {
          farm_id: farmId,
          feed_name: cleanFeedName,
          item_name: cleanFeedName,
          category,
          opening_kg: 0,
          purchase_kg: purchKg,
          closing_kg: closingBalanceKg,
          current_stock_kg: closingBalanceKg,
          cost_per_kg: weightedAvgRate,
          unit_cost_per_kg: weightedAvgRate,
          low_stock_threshold_kg: effectiveThreshold,
          stock_check_date: dateStr,
          notes: noteText,
        },
      ])
    }
  }

  // SERVER ACTION: Upsert Low Stock Threshold (Admin Only)
  const updateFeedThreshold = async (formData: FormData) => {
    'use server'
    try {
      const { user: authUser, farm: authFarm, role: authRole } = await getUserFarmAndRole()
      if (!authUser || !authFarm || authRole !== 'admin') {
        return redirect(`/feed?error=${encodeURIComponent('Unauthorized: Administrator access is required.')}`)
      }

      const feedName = String(formData.get('feed_name') || '').trim()
      const minStockRaw = Number(formData.get('min_stock_kg'))

      if (!feedName) {
        return redirect(`/feed?error=${encodeURIComponent('Please select or enter a valid feed name.')}`)
      }

      if (!Number.isFinite(minStockRaw) || minStockRaw < 0) {
        return redirect(`/feed?error=${encodeURIComponent('Minimum stock must be 0 kg or greater.')}`)
      }

      const minStockKg = Number(minStockRaw.toFixed(2))
      const supabaseClient = await createClient()

      const { error: upsertErr } = await supabaseClient
        .from('feed_thresholds')
        .upsert(
          {
            farm_id: authFarm.id,
            feed_name: feedName,
            min_stock_kg: minStockKg,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'farm_id,feed_name' }
        )

      if (upsertErr) {
        return redirect(`/feed?error=${encodeURIComponent(upsertErr.message)}`)
      }

      await supabaseClient
        .from('feed_inventory')
        .update({ low_stock_threshold_kg: minStockKg })
        .eq('farm_id', authFarm.id)
        .ilike('feed_name', feedName)

      revalidatePath('/feed')

      return redirect(
        `/feed?msg=${encodeURIComponent(`Updated minimum stock threshold for ${feedName} to ${minStockKg} kg.`)}`
      )
    } catch (err: unknown) {
      if (isNextRedirectError(err)) throw err
      const msg = err instanceof Error ? err.message : 'Unexpected error while updating threshold.'
      return redirect(`/feed?error=${encodeURIComponent(msg)}`)
    }
  }

  // SERVER ACTION 1: Record Bulk Purchase (Core Logic Unchanged)
  const addFeedLog = async (formData: FormData) => {
    'use server'
    try {
      const { user: authUser, farm: authFarm, role: authRole } = await getUserFarmAndRole()
      if (!authUser || !authFarm || authRole !== 'admin') {
        return redirect(`/feed?error=${encodeURIComponent('Unauthorized: Administrator access is required.')}`)
      }

      const target_species = String(formData.get('target_species') || 'Goat').trim() || 'Goat'
      const log_date = String(formData.get('log_date') || '').trim() || getKarachiDate()
      const notes = String(formData.get('notes') || '').trim()

      const feedTypes = formData.getAll('feed_type') as string[]
      const quantities = formData.getAll('quantity_kg') as string[]
      const costs = formData.getAll('total_cost') as string[]

      const supabaseClient = await createClient()
      const recordsToInsert: Array<Record<string, any>> = []

      for (let i = 0; i < feedTypes.length; i++) {
        const ft = String(feedTypes[i] || '').trim()
        const qty = parseFloat(String(quantities[i] || '0')) || 0
        const finalCost = parseFloat(String(costs[i] || '0')) || 0
        if (!ft || qty <= 0 || finalCost <= 0) continue

        recordsToInsert.push({
          farm_id: authFarm.id,
          target_species,
          entry_type: 'Purchase',
          feed_type: ft,
          quantity_kg: qty,
          total_cost: finalCost,
          log_date,
          notes: notes || null,
          is_allocated: false,
        })
      }

      if (recordsToInsert.length === 0) {
        return redirect(
          `/feed?error=${encodeURIComponent('Please enter a valid feed item, quantity greater than 0, and cost greater than 0.')}`
        )
      }

      const totalPurchaseCost = recordsToInsert.reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0)

      const { data: insertedLogs, error } = await supabaseClient
        .from('feed_logs')
        .insert(recordsToInsert)
        .select('id')

      if (error) {
        return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
      }

      const { error: walletErr } = await supabaseClient.from('wallet_transactions').insert({
        farm_id: authFarm.id,
        wallet_type: 'OPERATING',
        amount: -totalPurchaseCost,
        source_type: 'FEED_PURCHASE',
        description: `Feed Purchase - ${target_species} - Rs. ${totalPurchaseCost}`,
      })

      if (walletErr) {
        if (insertedLogs && insertedLogs.length > 0) {
          await supabaseClient
            .from('feed_logs')
            .delete()
            .in('id', insertedLogs.map(l => l.id))
            .eq('farm_id', authFarm.id)
        }
        return redirect(
          `/feed?error=${encodeURIComponent('Purchase failed due to a wallet transaction error: ' + walletErr.message)}`
        )
      }

      await Promise.all(
        recordsToInsert.map(rec =>
          syncFeedInventorySnapshot(supabaseClient, authFarm.id, rec.feed_type, target_species, log_date, notes || null)
        )
      )

      return redirect(
        `/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
          `Saved ${recordsToInsert.length} ${target_species} bulk purchase item(s) (Rs. ${totalPurchaseCost.toLocaleString()} deducted from OPERATING wallet).`
        )}`
      )
    } catch (err: unknown) {
      if (isNextRedirectError(err)) throw err
      const msg = err instanceof Error ? err.message : 'Unexpected error while saving purchase.'
      return redirect(`/feed?error=${encodeURIComponent(msg)}`)
    }
  }

  // SERVER ACTION 2: Delete Feed Log (Core Logic Unchanged + Undo Snapshot Payload)
  const deleteFeedLog = async (formData: FormData) => {
    'use server'
    try {
      const { user: authUser, farm: authFarm, role: authRole } = await getUserFarmAndRole()
      if (!authUser || !authFarm || authRole !== 'admin') {
        return redirect(`/feed?error=${encodeURIComponent('Unauthorized: Administrator access is required.')}`)
      }

      const logId = String(formData.get('logId') || '')
      const supabaseClient = await createClient()

      const { data: existingLog, error: fetchErr } = await supabaseClient
        .from('feed_logs')
        .select('id, entry_type, total_cost, quantity_kg, feed_type, target_species, is_allocated, log_date, notes')
        .eq('id', logId)
        .eq('farm_id', authFarm.id)
        .single()

      if (fetchErr || !existingLog) {
        return redirect(`/feed?error=${encodeURIComponent('Feed log entry was not found.')}`)
      }

      if (existingLog.is_allocated) {
        return redirect(
          `/feed?error=${encodeURIComponent('Cannot delete this entry because it has already been allocated. Please reverse the allocation first.')}`
        )
      }

      const { error } = await supabaseClient
        .from('feed_logs')
        .delete()
        .eq('id', logId)
        .eq('farm_id', authFarm.id)

      if (error) {
        return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
      }

      const logCost = Number(existingLog.total_cost) || 0
      if ((existingLog.entry_type === 'Purchase' || !existingLog.entry_type) && logCost > 0) {
        await supabaseClient.from('wallet_transactions').insert({
          farm_id: authFarm.id,
          wallet_type: 'OPERATING',
          amount: Math.abs(logCost),
          source_type: 'FEED_PURCHASE_REVERSAL',
          description: `Reversed Feed Purchase - ${existingLog.target_species || 'Goat'} (${existingLog.feed_type}) - Rs. ${Math.abs(logCost)}`,
        })
      }

      await syncFeedInventorySnapshot(
        supabaseClient,
        authFarm.id,
        existingLog.feed_type,
        existingLog.target_species || 'Goat',
        String(existingLog.log_date || getKarachiDate()).split('T')[0],
        null
      )

      const undoSnapshot = Buffer.from(
        JSON.stringify({
          target_species: existingLog.target_species || 'Goat',
          entry_type: existingLog.entry_type || 'Purchase',
          feed_type: existingLog.feed_type,
          quantity_kg: Number(existingLog.quantity_kg) || 0,
          total_cost: Number(existingLog.total_cost) || 0,
          log_date: String(existingLog.log_date || getKarachiDate()).split('T')[0],
          notes: existingLog.notes || null,
        }),
        'utf-8'
      ).toString('base64url')

      return redirect(
        `/feed?msg=${encodeURIComponent(
          `Deleted ${existingLog.feed_type} (${Number(existingLog.quantity_kg).toFixed(1)} kg — Rs. ${logCost.toLocaleString()}) and synced inventory/wallet.`
        )}&undo=${encodeURIComponent(undoSnapshot)}`
      )
    } catch (err: unknown) {
      if (isNextRedirectError(err)) throw err
      const msg = err instanceof Error ? err.message : 'Unexpected error while deleting feed log.'
      return redirect(`/feed?error=${encodeURIComponent(msg)}`)
    }
  }

  // SERVER ACTION 2B: Restore Deleted Feed Log (10-second Undo Toast Action)
  const restoreFeedLog = async (formData: FormData) => {
    'use server'
    try {
      const { user: authUser, farm: authFarm, role: authRole } = await getUserFarmAndRole()
      if (!authUser || !authFarm || authRole !== 'admin') {
        return redirect(`/feed?error=${encodeURIComponent('Unauthorized: Administrator access is required.')}`)
      }

      const encoded = String(formData.get('undoPayload') || '')
      if (!encoded) {
        return redirect(`/feed?error=${encodeURIComponent('Undo data has expired or is invalid.')}`)
      }

      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'))
      const supabaseClient = await createClient()

      const entryType = decoded.entry_type === 'Consumption' ? 'Consumption' : 'Purchase'
      const targetSpecies = String(decoded.target_species || 'Goat')
      const feedType = String(decoded.feed_type || '').trim()
      const qty = Number(decoded.quantity_kg) || 0
      const cost = Number(decoded.total_cost) || 0
      const logDate = String(decoded.log_date || getKarachiDate()).split('T')[0]

      const { error: restoreErr } = await supabaseClient.from('feed_logs').insert([
        {
          farm_id: authFarm.id,
          target_species: targetSpecies,
          entry_type: entryType,
          feed_type: feedType,
          quantity_kg: qty,
          total_cost: cost,
          log_date: logDate,
          notes: decoded.notes || null,
          is_allocated: false,
        },
      ])

      if (restoreErr) {
        return redirect(`/feed?error=${encodeURIComponent(restoreErr.message)}`)
      }

      if (entryType === 'Purchase' && cost > 0) {
        await supabaseClient.from('wallet_transactions').insert({
          farm_id: authFarm.id,
          wallet_type: 'OPERATING',
          amount: -Math.abs(cost),
          source_type: 'FEED_PURCHASE',
          description: `Restored Feed Purchase - ${targetSpecies} (${feedType}) - Rs. ${Math.abs(cost)}`,
        })
      }

      await syncFeedInventorySnapshot(supabaseClient, authFarm.id, feedType, targetSpecies, logDate, decoded.notes || null)

      return redirect(
        `/feed?msg=${encodeURIComponent(`Restored ${feedType} (${qty.toFixed(1)} kg — Rs. ${cost.toLocaleString()}).`)}`
      )
    } catch (err: unknown) {
      if (isNextRedirectError(err)) throw err
      const msg = err instanceof Error ? err.message : 'Unable to restore deleted entry.'
      return redirect(`/feed?error=${encodeURIComponent(msg)}`)
    }
  }

  // SERVER ACTION 3: Stock Adjustment (Decrease-Only + Consumption vs Write-off)
  const adjustFeedStock = async (formData: FormData) => {
    'use server'
    try {
      const { user: authUser, farm: authFarm, role: authRole } = await getUserFarmAndRole()
      if (!authUser || !authFarm || authRole !== 'admin') {
        return redirect(`/feed?error=${encodeURIComponent('Unauthorized: Administrator access is required.')}`)
      }

      const target_species = String(formData.get('target_species') || 'Goat').trim() || 'Goat'
      const rawDate = String(formData.get('log_date') || '').trim()
      const log_date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getKarachiDate()
      const adjustmentReason = String(formData.get('adjustment_reason') || 'consumption').trim()
      const isWriteOff = adjustmentReason.startsWith('writeoff')
      const rawNotes = String(formData.get('notes') || '').trim()

      if (isWriteOff && !rawNotes) {
        return redirect(
          `/feed?error=${encodeURIComponent('Write-off requires a reason in Notes — e.g. Spoiled, Theft, Expired.')}`
        )
      }

      const notes = rawNotes || 'Stock Adjustment - Physical Count'

      const feedTypes = formData.getAll('feed_type').map(v => String(v || ''))
      const targetQuantities = formData.getAll('target_remaining_kg').map(v => String(v || ''))

      const supabaseClient = await createClient()
      const adjustmentsToInsert: Array<Record<string, any>> = []

      for (let i = 0; i < feedTypes.length; i++) {
        const ft = feedTypes[i].trim()
        if (!ft) continue

        const targetRemainingKg = parseFloat(targetQuantities[i] ?? '')
        if (!Number.isFinite(targetRemainingKg) || targetRemainingKg < 0) continue

        let logsQuery = supabaseClient
          .from('feed_logs')
          .select('quantity_kg, total_cost, entry_type')
          .eq('farm_id', authFarm.id)
          .ilike('feed_type', ft)

        if (target_species !== 'Shared (All Species)') {
          logsQuery = logsQuery.eq('target_species', target_species)
        }

        const { data: itemLogs, error: itemLogsErr } = await logsQuery
        if (itemLogsErr) {
          return redirect(`/feed?error=${encodeURIComponent(itemLogsErr.message)}`)
        }

        let totalPurchasedKg = 0
        let totalPurchasedCost = 0
        let totalConsumedKg = 0

        ;(itemLogs || []).forEach(l => {
          const q = Number(l.quantity_kg) || 0
          const c = Number(l.total_cost) || 0
          if (l.entry_type === 'Purchase' || !l.entry_type) {
            totalPurchasedKg += q
            totalPurchasedCost += c
          } else {
            totalConsumedKg += q
          }
        })

        const currentRemaining = totalPurchasedKg - totalConsumedKg
        const diff = Number((currentRemaining - targetRemainingKg).toFixed(3))

        if (diff < 0) {
          throw new Error(
            `Stock increase is not allowed via Adjustment for ${ft}. Stock can only increase through a Purchase entry with wallet deduction.`
          )
        }

        const avgRatePerKg = totalPurchasedKg > 0 ? totalPurchasedCost / totalPurchasedKg : 0

        if (diff > 0) {
          const adjustedCost = avgRatePerKg > 0 ? Math.round(avgRatePerKg * diff) : 0
          const formattedNotes = isWriteOff
            ? `Write-off: ${adjustmentReason} — ${notes} (${currentRemaining.toFixed(1)}kg -> ${targetRemainingKg.toFixed(1)}kg)`
            : `${notes} (${currentRemaining.toFixed(1)}kg -> ${targetRemainingKg.toFixed(1)}kg)`

          adjustmentsToInsert.push({
            farm_id: authFarm.id,
            target_species,
            entry_type: 'Consumption',
            feed_type: ft,
            quantity_kg: diff,
            total_cost: adjustedCost,
            log_date,
            notes: formattedNotes,
            is_allocated: isWriteOff ? true : false,
          })
        }
      }

      if (adjustmentsToInsert.length === 0) {
        return redirect(
          `/feed?error=${encodeURIComponent('No stock decrease was detected between physical stock and ledger stock.')}`
        )
      }

      const { error: insertErr } = await supabaseClient
        .from('feed_logs')
        .insert(adjustmentsToInsert)

      if (insertErr) {
        return redirect(`/feed?error=${encodeURIComponent(insertErr.message)}`)
      }

      for (const adj of adjustmentsToInsert) {
        await syncFeedInventorySnapshot(
          supabaseClient,
          authFarm.id,
          adj.feed_type,
          target_species,
          log_date,
          adj.notes
        )
      }

      return redirect(
        `/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
          `Applied stock adjustment for ${adjustmentsToInsert.length} item(s).`
        )}`
      )
    } catch (err: unknown) {
      if (isNextRedirectError(err)) throw err
      const message = err instanceof Error ? err.message : 'Unexpected server error during stock adjustment.'
      return redirect(`/feed?error=${encodeURIComponent(message)}`)
    }
  }

  // SERVER ACTION 4: Allocate Pending Consumption Costs to Eligible Animals (Core Logic Unchanged)
  const allocateFeedCostToAnimals = async (formData: FormData) => {
    'use server'
    try {
      const { user: authUser, farm: authFarm, role: authRole } = await getUserFarmAndRole()
      if (!authUser || !authFarm || authRole !== 'admin') {
        return redirect(`/feed?error=${encodeURIComponent('Unauthorized: Administrator access is required.')}`)
      }

      const targetSpecies = String(formData.get('allocate_species') || 'Goat').trim() || 'Goat'
      const splitMethod = String(formData.get('split_method') || 'equal').trim() || 'equal'
      const allocationDate = String(formData.get('allocation_date') || '').trim() || getKarachiDate()
      const periodLabel = String(formData.get('period_label') || '').trim() || 'Consumption Ration Allocation'

      const supabaseClient = await createClient()

      let pendingQuery = supabaseClient
        .from('feed_logs')
        .select('id, total_cost, feed_type, log_date')
        .eq('farm_id', authFarm.id)
        .eq('entry_type', 'Consumption')
        .eq('is_allocated', false)
        .gt('total_cost', 0)

      if (targetSpecies !== 'Shared (All Species)') {
        pendingQuery = pendingQuery.eq('target_species', targetSpecies)
      }

      const { data: pendingLogs } = await pendingQuery

      if (!pendingLogs || pendingLogs.length === 0) {
        return redirect(
          `/feed?error=${encodeURIComponent(`No unallocated consumption costs were found for ${targetSpecies}.`)}`
        )
      }

      const totalPool = pendingLogs.reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0)
      const latestConsumptionDate = pendingLogs
        .map(l => String(l.log_date || '').split('T')[0])
        .filter(Boolean)
        .sort()
        .pop() || String(allocationDate).split('T')[0]

      let animalQuery = supabaseClient
        .from('livestock_master')
        .select('id, tag_id, species, acquisition_date')
        .eq('farm_id', authFarm.id)
        .eq('status', 'Active')

      if (targetSpecies !== 'Shared (All Species)') {
        animalQuery = animalQuery.eq('species', targetSpecies)
      }

      const { data: rawAnimals } = await animalQuery

      const animals = (rawAnimals || []).filter(a => {
        if (!a.acquisition_date) return true
        const acqDateStr = String(a.acquisition_date).split('T')[0]
        return acqDateStr <= latestConsumptionDate
      })

      if (!animals || animals.length === 0) {
        return redirect(
          `/feed?error=${encodeURIComponent(
            `No active ${targetSpecies} animals existed on or before ${formatDateDDMMYYYY(latestConsumptionDate)} to split costs.`
          )}`
        )
      }

      const weightsByAnimal: Record<string, number> = {}
      if (splitMethod === 'weight') {
        const { data: wLogs } = await supabaseClient
          .from('animal_weight_logs')
          .select('animal_id, weight_kg, recorded_date')
          .eq('farm_id', authFarm.id)
          .lte('recorded_date', latestConsumptionDate)
          .order('recorded_date', { ascending: false })

        ;(wLogs || []).forEach(w => {
          if (w.animal_id && weightsByAnimal[w.animal_id] === undefined) {
            weightsByAnimal[w.animal_id] = Number(w.weight_kg) || 0
          }
        })

        for (const animal of animals) {
          const w = weightsByAnimal[animal.id] ?? 0
          if (w <= 0) {
            return redirect(
              `/feed?error=${encodeURIComponent(
                `Weight record is missing for Tag #${animal.tag_id}. Please record its weight before running a live-weight split.`
              )}`
            )
          }
        }
      }

      const logIds = pendingLogs.map(l => l.id)
      const batchId = `${Date.now()}`

      const { data: claimedLogs, error: claimErr } = await supabaseClient
        .from('feed_logs')
        .update({
          is_allocated: true,
          allocated_at: new Date().toISOString(),
        })
        .in('id', logIds)
        .eq('farm_id', authFarm.id)
        .eq('is_allocated', false)
        .select('id')

      if (claimErr || !claimedLogs || claimedLogs.length === 0) {
        return redirect(
          `/feed?error=${encodeURIComponent('Allocation has already been processed or is currently in progress.')}`
        )
      }

      const useWeightSplit = splitMethod === 'weight'
      const weightArray = useWeightSplit
        ? animals.map(a => weightsByAnimal[a.id] || 0)
        : animals.map(() => 1)
      const totalWeight = weightArray.reduce((s, w) => s + w, 0)
      const shares = distributeExactShares(totalPool, weightArray)

      const financialInserts = animals
        .map((animal, idx) => {
          const share = shares[idx]
          const noteDetail = useWeightSplit
            ? `${periodLabel} [${targetSpecies}] (${((weightArray[idx] / totalWeight) * 100).toFixed(1)}% weight share @ ${weightArray[idx]}kg, batch ${batchId})`
            : `${periodLabel} [${targetSpecies}] (Equal split across ${animals.length} ${targetSpecies} on/before ${formatDateDDMMYYYY(latestConsumptionDate)}, batch ${batchId})`

          return {
            animal_id: animal.id,
            farm_id: authFarm.id,
            entry_type: 'Expense',
            category: 'Feed & Ration',
            amount: share,
            transaction_date: allocationDate,
            notes: noteDetail,
          }
        })
        .filter(entry => entry.amount > 0)

      if (financialInserts.length > 0) {
        const { error: finErr } = await supabaseClient
          .from('animal_financial_logs')
          .insert(financialInserts)

        if (finErr) {
          await supabaseClient
            .from('feed_logs')
            .update({ is_allocated: false, allocated_at: null })
            .in('id', claimedLogs.map(c => c.id))
            .eq('farm_id', authFarm.id)

          return redirect(`/feed?error=${encodeURIComponent('Allocation failed: ' + finErr.message)}`)
        }
      }

      const avgPerHead =
        financialInserts.length > 0 ? Math.round(totalPool / financialInserts.length) : 0

      return redirect(
        `/feed?species=${encodeURIComponent(targetSpecies)}&msg=${encodeURIComponent(
          `Rs. ${totalPool.toLocaleString()} split among ${financialInserts.length} animals • Avg Rs. ${avgPerHead.toLocaleString()}/head`
        )}`
      )
    } catch (err: unknown) {
      if (isNextRedirectError(err)) throw err
      const msg = err instanceof Error ? err.message : 'Unexpected error while allocating feed cost.'
      return redirect(`/feed?error=${encodeURIComponent(msg)}`)
    }
  }

  return (
    <FeedCommandCenterClient
      farmName={farm?.farm_name || 'Livestock ERP'}
      role={role || 'staff'}
      isAdmin={isAdmin}
      todayStr={todayStr}
      speciesOptions={SPECIES_OPTIONS}
      dynamicFeedSuggestions={dynamicFeedSuggestions}
      allFeedLogs={allFeedLogs}
      activeAnimals={activeAnimals}
      thresholdByFeedName={thresholdByFeedName}
      initialSpeciesFilter={selectedSpeciesFilter}
      initialEntryType={selectedEntryType}
      initialAllocFilter={selectedAllocFilter}
      initialSearchQuery={searchQuery}
      initialFromDate={fromDateFilter}
      initialToDate={toDateFilter}
      initialLowOnly={lowStockOnlyFilter}
      initialSplitDate={(params.splitDate || todayStr).split('T')[0]}
      statusMsg={statusMsg ? decodeURIComponent(statusMsg) : ''}
      errorMsg={loadErrorMsg ? decodeURIComponent(loadErrorMsg) : ''}
      undoPayload={undoPayloadEncoded}
      addFeedLogAction={addFeedLog}
      deleteFeedLogAction={deleteFeedLog}
      restoreFeedLogAction={restoreFeedLog}
      adjustFeedStockAction={adjustFeedStock}
      allocateFeedCostAction={allocateFeedCostToAnimals}
      updateFeedThresholdAction={updateFeedThreshold}
    />
  )
}