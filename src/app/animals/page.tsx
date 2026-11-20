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

export default async function AnimalsMasterPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
  }>
}) {
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
      .select('animal_id, entry_type, amount')
      .eq('farm_id', farm.id),
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
    if (!f.animal_id || f.entry_type !== 'Expense') return
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
      monthly_boarding_rate: parseFloat(r.monthly_boarding_rate || '0') || 0,
      acquisition_date: r.acquisition_date || new Date().toISOString().split('T')[0],
      status: 'Active',
    }))

    const supabaseClient = await createClient()
    const { error: impErr } = await supabaseClient.from('livestock_master').insert(inserts)

    if (impErr) return redirect(`/animals?error=${encodeURIComponent('CSV Import failed: ' + impErr.message)}`)
    return redirect(`/animals?msg=${encodeURIComponent(`Successfully imported ${inserts.length} animal(s) from CSV.`)}`)
  }

  const totalCount = enrichedAnimals.length
  const selfCount = enrichedAnimals.filter(a => a.ownership === 'Self').length
  const palaiCount = enrichedAnimals.filter(a => a.ownership !== 'Self').length

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

        {/* Client View with Search, Filters, CSV Import/Export, Multi-Select & Self Break-Even */}
        <AnimalsClientView
          animals={enrichedAnimals}
          deleteAction={deleteAction}
          bulkUpdateAction={bulkUpdateAction}
          bulkImportAction={bulkImportAction}
        />
      </div>
    </div>
  )
}