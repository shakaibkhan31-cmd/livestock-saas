'use server'

import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getUserFarmAndRole } from '@/utils/rbac'
import { recalculateWalletBalance } from '@/utils/wallets'

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

async function syncFeedInventorySnapshot(
  supabaseClient: Awaited<ReturnType<typeof createClient>>,
  farmId: string,
  feedName: string,
  category: string,
  dateStr: string,
  noteText: string | null
) {
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

  const { data: threshRow } = await supabaseClient
    .from('feed_thresholds')
    .select('min_stock_kg')
    .eq('farm_id', farmId)
    .ilike('feed_name', cleanFeedName)
    .maybeSingle()

  const dbMin = threshRow ? Number(threshRow.min_stock_kg) : NaN
  const effectiveThreshold =
    Number.isFinite(dbMin) && dbMin >= 0 ? dbMin : getDefaultThresholdForFeed(cleanFeedName)

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

export async function updateFeedThreshold(formData: FormData) {
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

export async function addFeedLog(formData: FormData) {
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
    const purchaseAmount = Math.abs(totalPurchaseCost)

    const { data: insertedLogs, error } = await supabaseClient
      .from('feed_logs')
      .insert(recordsToInsert)
      .select('id')

    if (error) {
      return redirect(`/feed?error=${encodeURIComponent(error.message)}`)
    }

    const primaryLogId = insertedLogs?.[0]?.id
    const referenceKey = primaryLogId ? `FEED_LOG:${primaryLogId}` : null

    const { data: opWallet, error: walletLookupErr } = await supabaseClient
      .from('farm_wallets')
      .select('id')
      .eq('farm_id', authFarm.id)
      .eq('wallet_type', 'OPERATING_CASH')
      .maybeSingle()

    if (walletLookupErr || !opWallet?.id) {
      if (insertedLogs && insertedLogs.length > 0) {
        await supabaseClient
          .from('feed_logs')
          .delete()
          .in('id', insertedLogs.map(l => l.id))
          .eq('farm_id', authFarm.id)
      }
      return redirect(
        `/feed?error=${encodeURIComponent(
          'Purchase failed: OPERATING_CASH wallet not found — ' + (walletLookupErr?.message || 'missing wallet')
        )}`
      )
    }

    const { error: walletErr } = await supabaseClient.from('wallet_transactions').insert({
      farm_id: authFarm.id,
      wallet_id: opWallet.id,
      ...(referenceKey ? { reference_key: referenceKey } : {}),
      entry_type: 'OUT',
      amount: purchaseAmount,
      source_type: 'FEED_EXPENSE',
      txn_date: log_date,
      notes: `Feed Purchase - ${target_species} - Rs. ${purchaseAmount}`,
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

    const { error: txnErr } = await supabaseClient.from('transactions').insert({
      farm_id: authFarm.id,
      type: 'Expense',
      category: 'Feed & Ration Purchase',
      amount: purchaseAmount,
      txn_date: log_date,
      description: `Feed Purchase - ${target_species}${referenceKey ? ` [${referenceKey}]` : ''}`,
      target_species,
    })

    if (txnErr) {
      if (referenceKey) {
        await supabaseClient
          .from('wallet_transactions')
          .delete()
          .eq('farm_id', authFarm.id)
          .eq('reference_key', referenceKey)
      }
      if (insertedLogs && insertedLogs.length > 0) {
        await supabaseClient
          .from('feed_logs')
          .delete()
          .in('id', insertedLogs.map(l => l.id))
          .eq('farm_id', authFarm.id)
      }
      return redirect(
        `/feed?error=${encodeURIComponent('Purchase failed due to a ledger transaction error: ' + txnErr.message)}`
      )
    }

    await recalculateWalletBalance(supabaseClient, authFarm.id, opWallet.id)

    await Promise.all(
      recordsToInsert.map(rec =>
        syncFeedInventorySnapshot(supabaseClient, authFarm.id, rec.feed_type, target_species, log_date, notes || null)
      )
    )

    return redirect(
      `/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
        `Saved ${recordsToInsert.length} ${target_species} bulk purchase item(s) (Rs. ${totalPurchaseCost.toLocaleString()} deducted from OPERATING_CASH wallet).`
      )}`
    )
  } catch (err: unknown) {
    if (isNextRedirectError(err)) throw err
    const msg = err instanceof Error ? err.message : 'Unexpected error while saving purchase.'
    return redirect(`/feed?error=${encodeURIComponent(msg)}`)
  }
}

export async function deleteFeedLog(formData: FormData) {
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
    const isPurchase = existingLog.entry_type === 'Purchase' || !existingLog.entry_type

    if (isPurchase) {
      const referenceKey = `FEED_LOG:${existingLog.id}`
      const voidDateStr = getKarachiDate()

      const { data: matchingTxns } = await supabaseClient
        .from('transactions')
        .select('id, description')
        .eq('farm_id', authFarm.id)
        .ilike('description', `%${referenceKey}%`)

      for (const txn of matchingTxns || []) {
        const currentDesc = String(txn.description || '')
        if (!currentDesc.trim().toUpperCase().startsWith('[VOID]')) {
          await supabaseClient
            .from('transactions')
            .update({
              description: `[VOID] Voided on ${voidDateStr} — ${currentDesc}`,
            })
            .eq('id', txn.id)
            .eq('farm_id', authFarm.id)
        }
      }

      const { data: matchingWalletTxns } = await supabaseClient
        .from('wallet_transactions')
        .select('id, wallet_id, notes')
        .eq('farm_id', authFarm.id)
        .eq('reference_key', referenceKey)

      const touchedWalletIds = new Set<string>()
      for (const wt of matchingWalletTxns || []) {
        if (wt.wallet_id) touchedWalletIds.add(wt.wallet_id)
        const currentNotes = String(wt.notes || '')
        if (!currentNotes.trim().toUpperCase().startsWith('[VOID]')) {
          await supabaseClient
            .from('wallet_transactions')
            .update({
              notes: `[VOID] Voided on ${voidDateStr}${currentNotes ? ` — ${currentNotes}` : ''}`,
            })
            .eq('id', wt.id)
            .eq('farm_id', authFarm.id)
        }
      }

      for (const wId of touchedWalletIds) {
        await recalculateWalletBalance(supabaseClient, authFarm.id, wId)
      }
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
        `Deleted ${existingLog.feed_type} (${Number(existingLog.quantity_kg).toFixed(1)} kg — Rs. ${logCost.toLocaleString()}) and synced inventory/ledger.`
      )}&undo=${encodeURIComponent(undoSnapshot)}`
    )
  } catch (err: unknown) {
    if (isNextRedirectError(err)) throw err
    const msg = err instanceof Error ? err.message : 'Unexpected error while deleting feed log.'
    return redirect(`/feed?error=${encodeURIComponent(msg)}`)
  }
}

export async function restoreFeedLog(formData: FormData) {
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

    const { data: restoredLog, error: restoreErr } = await supabaseClient
      .from('feed_logs')
      .insert([
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
      .select('id')
      .single()

    if (restoreErr) {
      return redirect(`/feed?error=${encodeURIComponent(restoreErr.message)}`)
    }

    const newReferenceKey = restoredLog?.id ? `FEED_LOG:${restoredLog.id}` : null
    const restoreAmount = Math.abs(cost)

    if (entryType === 'Purchase' && restoreAmount > 0) {
      const { data: opWallet } = await supabaseClient
        .from('farm_wallets')
        .select('id')
        .eq('farm_id', authFarm.id)
        .eq('wallet_type', 'OPERATING_CASH')
        .maybeSingle()

      if (opWallet?.id) {
        await supabaseClient.from('wallet_transactions').insert({
          farm_id: authFarm.id,
          wallet_id: opWallet.id,
          ...(newReferenceKey ? { reference_key: newReferenceKey } : {}),
          entry_type: 'OUT',
          amount: restoreAmount,
          source_type: 'FEED_EXPENSE',
          txn_date: logDate,
          notes: `Restored Feed Purchase - ${targetSpecies} (${feedType}) - Rs. ${restoreAmount}`,
        })
      }

      await supabaseClient.from('transactions').insert({
        farm_id: authFarm.id,
        type: 'Expense',
        category: 'Feed & Ration Purchase',
        amount: restoreAmount,
        txn_date: logDate,
        description: `Feed Purchase - ${targetSpecies}${newReferenceKey ? ` [${newReferenceKey}]` : ''}`,
        target_species: targetSpecies,
      })

      if (opWallet?.id) {
        await recalculateWalletBalance(supabaseClient, authFarm.id, opWallet.id)
      }
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

export async function adjustFeedStock(formData: FormData) {
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

export async function allocateFeedCostToAnimals(formData: FormData) {
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