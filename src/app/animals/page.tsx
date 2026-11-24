import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import {
  calculateAdgKgPerDay,
  calculateAnimalBreakEven,
  daysBetweenDateStrings,
} from '@/utils/breakeven'
import AnimalsClientView, { type AnimalItem } from './AnimalsClientView'

function isVoidText(val?: string | null): boolean {
  const upper = String(val || '').trim().toUpperCase()
  return upper.startsWith('[VOID]') || upper.startsWith('VOID:')
}

function normalizeDateToISO(rawDate?: string): string {
  const fallback = new Date().toISOString().split('T')[0]
  const val = (rawDate || '').trim()
  if (!val) return fallback

  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val
  }

  const fullMatch = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (fullMatch) {
    const day = fullMatch[1].padStart(2, '0')
    const month = fullMatch[2].padStart(2, '0')
    const year = fullMatch[3]
    return `${year}-${month}-${day}`
  }

  const shortMatch = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/)
  if (shortMatch) {
    const day = shortMatch[1].padStart(2, '0')
    const month = shortMatch[2].padStart(2, '0')
    const year = `20${shortMatch[3]}`
    return `${year}-${month}-${day}`
  }

  return fallback
}

export default async function AnimalsMasterPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
  }>
}) {
  await connection()
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error

  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')

  const supabase = await createClient()

  const [
    { data: animals, error },
    { data: weightLogs },
    { data: financialLogs },
    { data: medicalLogs },
  ] = await Promise.all([
    supabase
      .from('livestock_master')
      .select('*')
      .eq('farm_id', farm.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('animal_weight_logs')
      .select('animal_id, weight_kg, recorded_date')
      .eq('farm_id', farm.id)
      .order('recorded_date', { ascending: false }),
    supabase
      .from('animal_financial_logs')
      .select('animal_id, entry_type, amount, notes')
      .eq('farm_id', farm.id),
    supabase
      .from('animal_medical_logs')
      .select('id, animal_id, treatment_type, medicine_name, next_due_date')
      .eq('farm_id', farm.id)
      .not('next_due_date', 'is', null)
      .order('next_due_date', { ascending: true }),
  ])

  const todayStr = new Date().toISOString().split('T')[0]

  const weightLogsByAnimal: Record<string, Array<{ weight_kg: number | string; recorded_date: string }>> = {}
  ;(weightLogs || []).forEach(w => {
    if (!w.animal_id) return
    if (!weightLogsByAnimal[w.animal_id]) weightLogsByAnimal[w.animal_id] = []
    weightLogsByAnimal[w.animal_id].push({
      weight_kg: w.weight_kg,
      recorded_date: w.recorded_date,
    })
  })

  const expenseByAnimal: Record<string, number> = {}
  ;(financialLogs || []).forEach(f => {
    if (!f.animal_id || f.entry_type !== 'Expense' || isVoidText(f.notes)) return
    expenseByAnimal[f.animal_id] = (expenseByAnimal[f.animal_id] || 0) + (Number(f.amount) || 0)
  })

  const enrichedAnimals: AnimalItem[] = (animals || []).map(a => {
    if (a.ownership !== 'Self') {
      return {
        ...a,
        breakEven: null,
      }
    }

    const aWeights = weightLogsByAnimal[a.id] || []
    const latestWeight = aWeights.length > 0 ? Number(aWeights[0].weight_kg) : null
    const adgKgPerDay = calculateAdgKgPerDay(aWeights)
    const loggedExpenses = expenseByAnimal[a.id] || 0
    const purchaseCost = Number(a.cost_basis || 0)
    const acqDateStr = a.acquisition_date ? String(a.acquisition_date).split('T')[0] : null
    const activeDays = acqDateStr ? daysBetweenDateStrings(acqDateStr, todayStr, 1) : 30

    const res = calculateAnimalBreakEven({
      purchaseCost,
      loggedExpenses,
      activeDays,
      latestWeight,
      adgKgPerDay,
    })

    return {
      ...a,
      breakEven: {
        breakEvenToday: res.breakEvenToday,
        perKgToday: res.perKgToday,
        latestWeight,
      },
    }
  })

  const animalMapById: Record<string, { tag_id: string; species: string; status: string }> = {}
  ;(animals || []).forEach(a => {
    animalMapById[a.id] = { tag_id: a.tag_id, species: a.species, status: a.status }
  })

  const sevenDaysFromNow = new Date()
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)
  const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0]

  const dueMedicalReminders = (medicalLogs || [])
    .filter(m => {
      const ani = animalMapById[m.animal_id]
      if (!ani || ani.status !== 'Active' || !m.next_due_date) return false
      const dueStr = String(m.next_due_date).split('T')[0]
      return dueStr <= sevenDaysStr
    })
    .map(m => {
      const dueStr = String(m.next_due_date).split('T')[0]
      const ani = animalMapById[m.animal_id]
      return {
        id: m.id,
        animal_id: m.animal_id,
        tag_id: ani?.tag_id || 'Unknown',
        species: ani?.species || '',
        treatment_type: m.treatment_type,
        medicine_name: m.medicine_name,
        due_date: dueStr,
        isOverdue: dueStr < todayStr,
      }
    })

  // 1. Delete Single Animal
  const deleteAction = async (formData: FormData) => {
    'use server'
    const animalId = formData.get('animalId') as string
    const supabaseClient = await createClient()
    const { error: delErr } = await supabaseClient
      .from('livestock_master')
      .delete()
      .eq('id', animalId)
      .eq('farm_id', farm.id)

    if (delErr) return redirect(`/animals?error=${encodeURIComponent(delErr.message)}`)
    return redirect(`/animals?msg=${encodeURIComponent('Animal deleted successfully.')}`)
  }

  // 2. Bulk Update / Delete Selected Animals
  const bulkUpdateAction = async (formData: FormData) => {
    'use server'
    const rawIds = (formData.get('selectedIds') as string) || '[]'
    const bulkAction = (formData.get('bulkAction') as string) || ''

    let ids: string[] = []
    try {
      ids = JSON.parse(rawIds)
    } catch {
      ids = []
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return redirect(`/animals?error=${encodeURIComponent('No animals selected.')}`)
    }

    const supabaseClient = await createClient()

    if (bulkAction === 'DELETE') {
      const { error: bulkDelErr } = await supabaseClient
        .from('livestock_master')
        .delete()
        .in('id', ids)
        .eq('farm_id', farm.id)

      if (bulkDelErr) return redirect(`/animals?error=${encodeURIComponent(bulkDelErr.message)}`)
      return redirect(`/animals?msg=${encodeURIComponent(`Deleted ${ids.length} selected animal(s).`)}`)
    }

    const { error: updErr } = await supabaseClient
      .from('livestock_master')
      .update({ status: bulkAction })
      .in('id', ids)
      .eq('farm_id', farm.id)

    if (updErr) return redirect(`/animals?error=${encodeURIComponent(updErr.message)}`)
    return redirect(`/animals?msg=${encodeURIComponent(`Updated ${ids.length} animal(s) to "${bulkAction}".`)}`)
  }

  // 3. Bulk CSV Import Action
  const bulkImportAction = async (formData: FormData) => {
    'use server'
    const rawRows = (formData.get('csvRows') as string) || '[]'
    let rows: Array<Record<string, string>> = []
    try {
      rows = JSON.parse(rawRows)
    } catch {
      rows = []
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return redirect(`/animals?error=${encodeURIComponent('No valid CSV rows to import.')}`)
    }

    const inserts = rows.map((r, idx) => ({
      farm_id: farm.id,
      tag_id: r.tag_id || `TAG-${Date.now()}-${idx + 1}`,
      species: r.species || 'Goat',
      breed_name: r.breed_name || null,
      sex: r.sex || 'Male',
      ownership: r.ownership === 'Client' ? 'Client' : 'Self',
      client_name: r.client_name || null,
      cost_basis: parseFloat(r.cost_basis || '0') || 0,
      acquisition_date: normalizeDateToISO(r.acquisition_date),
      status: 'Active',
    }))

    const supabaseClient = await createClient()
    const { error: impErr } = await supabaseClient.from('livestock_master').insert(inserts)

    if (impErr) return redirect(`/animals?error=${encodeURIComponent('CSV Import failed: ' + impErr.message)}`)
    return redirect(`/animals?msg=${encodeURIComponent(`Successfully imported ${inserts.length} animal(s) from CSV.`)}`)
  }

  // 4. Bulk Weight Log Action
  const bulkWeightLogAction = async (formData: FormData) => {
    'use server'
    const rawEntries = (formData.get('weightEntries') as string) || '[]'
    const recorded_date = normalizeDateToISO((formData.get('recorded_date') as string) || '')
    const notes = ((formData.get('notes') as string) || '').trim() || 'Weekly Shed Weigh-In'

    let entries: Array<{ animal_id: string; weight_kg: number }> = []
    try {
      entries = JSON.parse(rawEntries)
    } catch {
      entries = []
    }

    const valid = entries.filter(e => e.animal_id && Number(e.weight_kg) > 0)
    if (valid.length === 0) {
      return redirect(`/animals?error=${encodeURIComponent('Enter at least one valid animal weight.')}`)
    }

    const supabaseClient = await createClient()
    const inserts = valid.map(e => ({
      farm_id: farm.id,
      animal_id: e.animal_id,
      weight_kg: Number(e.weight_kg),
      recorded_date,
      notes,
    }))

    const { error: wErr } = await supabaseClient.from('animal_weight_logs').insert(inserts)
    if (wErr) return redirect(`/animals?error=${encodeURIComponent('Bulk weigh-in failed: ' + wErr.message)}`)

    return redirect(`/animals?msg=${encodeURIComponent(`Logged weights for ${inserts.length} animal(s) on ${recorded_date}.`)}`)
  }

  // 5. Record Sale & Realized P&L Action
  const recordSaleAction = async (formData: FormData) => {
    'use server'
    const animalId = (formData.get('animalId') as string) || ''
    const salePrice = parseFloat((formData.get('sale_price') as string) || '0')
    const saleDate = normalizeDateToISO((formData.get('sale_date') as string) || '')
    const notes = ((formData.get('notes') as string) || '').trim()

    if (!animalId || isNaN(salePrice) || salePrice <= 0) {
      return redirect(`/animals?error=${encodeURIComponent('Please enter a valid sale price greater than 0.')}`)
    }

    const supabaseClient = await createClient()

    const { data: animalRow } = await supabaseClient
      .from('livestock_master')
      .select('id, tag_id, cost_basis')
      .eq('id', animalId)
      .eq('farm_id', farm.id)
      .single()

    if (!animalRow) {
      return redirect(`/animals?error=${encodeURIComponent('Animal not found.')}`)
    }

    const { data: existingFinLogs } = await supabaseClient
      .from('animal_financial_logs')
      .select('entry_type, amount, notes')
      .eq('animal_id', animalId)
      .eq('farm_id', farm.id)

    const loggedExpenses = (existingFinLogs || [])
      .filter(f => f.entry_type === 'Expense' && !isVoidText(f.notes))
      .reduce((sum, f) => sum + (Number(f.amount) || 0), 0)

    const totalCostOutflow = (Number(animalRow.cost_basis) || 0) + loggedExpenses
    const realizedPnL = salePrice - totalCostOutflow
    const pnlTag =
      realizedPnL >= 0
        ? `Realized Profit: +Rs. ${realizedPnL.toLocaleString()}`
        : `Realized Loss: -Rs. ${Math.abs(realizedPnL).toLocaleString()}`

    const { error: finErr } = await supabaseClient.from('animal_financial_logs').insert([
      {
        farm_id: farm.id,
        animal_id: animalId,
        entry_type: 'Revenue',
        category: 'Sale / Qurbani',
        amount: salePrice,
        transaction_date: saleDate,
        notes: notes ? `${notes} (${pnlTag})` : pnlTag,
      },
    ])

    if (finErr) {
      return redirect(`/animals?error=${encodeURIComponent('Failed to log sale revenue: ' + finErr.message)}`)
    }

    const { error: statusErr } = await supabaseClient
      .from('livestock_master')
      .update({ status: 'Sold' })
      .eq('id', animalId)
      .eq('farm_id', farm.id)

    if (statusErr) {
      return redirect(`/animals?error=${encodeURIComponent('Revenue logged, but status update failed: ' + statusErr.message)}`)
    }

    return redirect(
      `/animals?msg=${encodeURIComponent(
        `${animalRow.tag_id} marked Sold for Rs. ${salePrice.toLocaleString()} (${pnlTag}).`
      )}`
    )
  }

  const totalCount = enrichedAnimals.length
  const selfAnimals = enrichedAnimals.filter(a => a.ownership === 'Self')
  const palaiAnimals = enrichedAnimals.filter(a => a.ownership !== 'Self')
  const selfCount = selfAnimals.length
  const palaiCount = palaiAnimals.length
  const activeCount = enrichedAnimals.filter(a => a.status === 'Active').length
  const totalSelfCostBasis = selfAnimals.reduce((sum, a) => sum + (Number(a.cost_basis) || 0), 0)

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {farm.farm_name} • {role}
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Livestock Master</h1>
            <p className="text-sm text-slate-500">
              Total: <strong>{totalCount}</strong> • Farm-Owned (Self): <strong>{selfCount}</strong> • Palai: <strong>{palaiCount}</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {role === 'admin' && (
              <Link
                href="/finances"
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-sm transition text-sm"
              >
                💰 Financials &amp; Billing
              </Link>
            )}
            <Link
              href="/animals/new"
              className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-sm transition text-sm"
            >
              + Add Animal
            </Link>
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-slate-900">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Livestock</p>
            <p className="text-2xl font-bold text-slate-900 font-mono mt-1">{totalCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{activeCount} Active in shed</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-blue-600">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Farm-Owned (Self)</p>
            <p className="text-2xl font-bold text-blue-700 font-mono mt-1">{selfCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Tracked for break-even &amp; sale</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-purple-600">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Palai (Client)</p>
            <p className="text-2xl font-bold text-purple-700 font-mono mt-1">{palaiCount}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Client boarding animals</p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-emerald-600">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Self Cost Basis</p>
            <p className="text-2xl font-bold text-emerald-700 font-mono mt-1">
              Rs. {totalSelfCostBasis.toLocaleString()}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Initial purchase outlay (Self)</p>
          </div>
        </div>

        {/* Medical & Deworming Due Reminders */}
        {dueMedicalReminders.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">💉</span>
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Upcoming &amp; Overdue Medical / Deworming ({dueMedicalReminders.length})
                </h2>
              </div>
              <span className="text-[11px] text-amber-700 font-medium">Next 7 Days &amp; Overdue</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {dueMedicalReminders.map(rem => (
                <Link
                  key={rem.id}
                  href={`/animals/${rem.animal_id}`}
                  className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2 transition ${
                    rem.isOverdue
                      ? 'bg-rose-50 border-rose-300 text-rose-900 hover:bg-rose-100'
                      : 'bg-white border-amber-200 text-slate-800 hover:bg-amber-100/60'
                  }`}
                >
                  <span className="font-mono font-bold">{rem.tag_id}</span>
                  <span>
                    {rem.treatment_type}: <strong>{rem.medicine_name}</strong>
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                      rem.isOverdue ? 'bg-rose-600 text-white' : 'bg-amber-200 text-amber-950'
                    }`}
                  >
                    {rem.isOverdue ? `OVERDUE (${rem.due_date})` : `Due ${rem.due_date}`}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Feedback Banners */}
        {statusMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Success:</strong> {decodeURIComponent(statusMsg)}</span>
            <Link href="/animals" className="text-emerald-600 font-bold hover:text-emerald-900">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Error:</strong> {decodeURIComponent(errorMsg)}</span>
            <Link href="/animals" className="text-red-500 font-bold hover:text-red-800">×</Link>
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm">
            <strong>Database Error:</strong> {error.message}
          </div>
        )}

        {/* Client View */}
        <AnimalsClientView
          animals={enrichedAnimals}
          deleteAction={deleteAction}
          bulkUpdateAction={bulkUpdateAction}
          bulkImportAction={bulkImportAction}
          bulkWeightLogAction={bulkWeightLogAction}
          recordSaleAction={recordSaleAction}
        />
      </div>
    </div>
  )
}
