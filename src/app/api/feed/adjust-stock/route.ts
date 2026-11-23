import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getUserFarmAndRole } from '@/utils/rbac'

function getKarachiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
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

  const { data: existingInv, error: selInvErr } = await supabaseClient
    .from('feed_inventory')
    .select('id')
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
        low_stock_threshold_kg: 50,
        stock_check_date: dateStr,
        notes: noteText,
      },
    ])
  }
}

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin

  try {
    const { user, farm, role } = await getUserFarmAndRole()
    if (!user || !farm || role !== 'admin') {
      return NextResponse.redirect(
        `${origin}/feed?error=${encodeURIComponent('Unauthorized: Admin only')}`,
        303
      )
    }

    const formData = await req.formData()
    const target_species = String(formData.get('target_species') || 'Goat').trim() || 'Goat'
    const rawDate = String(formData.get('log_date') || '').trim()
    const log_date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getKarachiDate()
    const notes = String(formData.get('notes') || '').trim() || 'Closing Stock Adjustment'
    const markAlreadyAllocated = formData.get('already_allocated') === 'on'

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
        .eq('farm_id', farm.id)
        .ilike('feed_type', ft)

      if (target_species !== 'Shared (All Species)') {
        logsQuery = logsQuery.eq('target_species', target_species)
      }

      const { data: itemLogs, error: itemLogsErr } = await logsQuery
      if (itemLogsErr) {
        return NextResponse.redirect(
          `${origin}/feed?error=${encodeURIComponent(itemLogsErr.message)}`,
          303
        )
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
      const avgRatePerKg = totalPurchasedKg > 0 ? totalPurchasedCost / totalPurchasedKg : 0

      if (diff > 0) {
        const adjustedCost = avgRatePerKg > 0 ? Math.round(avgRatePerKg * diff) : 0
        adjustmentsToInsert.push({
          farm_id: farm.id,
          target_species,
          entry_type: 'Consumption',
          feed_type: ft,
          quantity_kg: diff,
          total_cost: adjustedCost,
          log_date,
          notes: `${notes} (${currentRemaining.toFixed(1)}kg -> ${targetRemainingKg.toFixed(1)}kg)`,
          is_allocated: markAlreadyAllocated,
          allocated_at: markAlreadyAllocated ? new Date().toISOString() : null,
        })
      } else if (diff < 0) {
        const upQty = Math.abs(diff)
        const correctionCost = avgRatePerKg > 0 ? Math.round(avgRatePerKg * upQty) : 0
        adjustmentsToInsert.push({
          farm_id: farm.id,
          target_species,
          entry_type: 'Purchase',
          feed_type: ft,
          quantity_kg: upQty,
          total_cost: correctionCost,
          log_date,
          notes: `${notes} [Stock Correction +${upQty.toFixed(1)}kg: ${currentRemaining.toFixed(1)}kg -> ${targetRemainingKg.toFixed(1)}kg]`,
          is_allocated: true,
        })
      }
    }

    if (adjustmentsToInsert.length === 0) {
      return NextResponse.redirect(
        `${origin}/feed?error=${encodeURIComponent('No stock difference detected between physical stock and ledger stock.')}`,
        303
      )
    }

    const { error: insertErr } = await supabaseClient
      .from('feed_logs')
      .insert(adjustmentsToInsert)

    if (insertErr) {
      return NextResponse.redirect(
        `${origin}/feed?error=${encodeURIComponent(insertErr.message)}`,
        303
      )
    }

    for (const adj of adjustmentsToInsert) {
      await syncFeedInventorySnapshot(
        supabaseClient,
        farm.id,
        adj.feed_type,
        target_species,
        log_date,
        adj.notes
      )
    }

    return NextResponse.redirect(
      `${origin}/feed?species=${encodeURIComponent(target_species)}&msg=${encodeURIComponent(
        `Applied stock adjustment for ${adjustmentsToInsert.length} item(s)!`
      )}`,
      303
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error during stock adjustment.'
    return NextResponse.redirect(
      `${origin}/feed?error=${encodeURIComponent(message)}`,
      303
    )
  }
}