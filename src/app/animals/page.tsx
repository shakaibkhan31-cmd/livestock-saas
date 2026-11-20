import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import {
  calculateAdgKgPerDay,
  calculateAnimalBreakEven,
  daysBetweenDateStrings,
} from '@/utils/breakeven'

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

export default async function AnimalsMasterPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
    species?: string
    ownership?: string
    q?: string
  }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error
  const selectedSpecies = params.species || 'All'
  const selectedOwnership = params.ownership || 'All'
  const searchQuery = (params.q || '').trim().toLowerCase()

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

  // Group weight logs & expense totals by animal_id
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

  // Precompute break-even summary for Self animals
  const breakEvenByAnimal: Record<
    string,
    {
      breakEvenToday: number
      perKgToday: number | null
      latestWeight: number | null
    }
  > = {}

  ;(animals || []).forEach(a => {
    if (a.ownership !== 'Self') return

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

    breakEvenByAnimal[a.id] = {
      breakEvenToday: res.breakEvenToday,
      perKgToday: res.perKgToday,
      latestWeight,
    }
  })

  const speciesList = Array.from(
    new Set((animals || []).map(a => a.species).filter(Boolean))
  ).sort()

  const filteredAnimals = (animals || []).filter(a => {
    if (selectedSpecies !== 'All' && a.species !== selectedSpecies) return false
    if (selectedOwnership !== 'All' && a.ownership !== selectedOwnership) return false
    if (!searchQuery) return true

    const haystack = [
      a.tag_id,
      a.species,
      a.breed_name || '',
      a.client_name || '',
      a.status || '',
      a.ownership || '',
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(searchQuery)
  })

  const totalCount = (animals || []).length
  const selfCount = (animals || []).filter(a => a.ownership === 'Self').length
  const palaiCount = (animals || []).filter(a => a.ownership !== 'Self').length

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

        {/* Filter & Search Bar */}
        <form
          method="GET"
          action="/animals"
          className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-4 gap-3"
        >
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Search Tag / Breed / Client</label>
            <input
              type="text"
              name="q"
              defaultValue={params.q || ''}
              placeholder="e.g. G-01, Gulabi, Client..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Species</label>
            <select
              name="species"
              defaultValue={selectedSpecies}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
            >
              <option value="All">All Species</option>
              {speciesList.map(sp => (
                <option key={sp} value={sp}>{sp}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Ownership</label>
            <select
              name="ownership"
              defaultValue={selectedOwnership}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
            >
              <option value="All">All (Self &amp; Palai)</option>
              <option value="Self">Farm-Owned (Self)</option>
              <option value="Client">Palai (Client)</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
            >
              Apply Filters
            </button>
            <Link
              href="/animals"
              className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
            >
              Reset
            </Link>
          </div>
        </form>

        {/* Livestock Cards Grid */}
        {filteredAnimals.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredAnimals.map(animal => {
              const isSelf = animal.ownership === 'Self'
              const be = breakEvenByAnimal[animal.id]

              return (
                <div
                  key={animal.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {animal.photo_url ? (
                            <img src={animal.photo_url} alt={animal.tag_id} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xl">🐐</span>
                          )}
                        </div>
                        <div>
                          <Link
                            href={`/animals/${animal.id}`}
                            className="text-lg font-bold font-mono text-slate-900 hover:text-indigo-600 transition"
                          >
                            {animal.tag_id}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {animal.species} {animal.breed_name ? `• ${animal.breed_name}` : ''} • {animal.sex}
                          </p>
                        </div>
                      </div>

                      <span className="px-2.5 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {animal.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-semibold border ${
                          isSelf
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-purple-50 text-purple-700 border-purple-200'
                        }`}
                      >
                        {isSelf ? 'Farm-Owned (Self)' : `Palai (${animal.client_name || 'Client'})`}
                      </span>
                      <span className="text-slate-400 font-mono">
                        Acq: {formatDateDDMMYYYY(animal.acquisition_date)}
                      </span>
                    </div>

                    {/* Today Break-Even & Per-KG Break-Even Badges for Farm-Owned (Self) Animals */}
                    {isSelf && be && (
                      <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/90 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-900 text-amber-300">
                            Break-Even: Rs. {be.breakEvenToday.toLocaleString()}
                          </span>

                          {be.perKgToday !== null && be.latestWeight ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                              Rs. {be.perKgToday.toLocaleString()}/kg
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              No weight log
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {be.latestWeight
                            ? `Latest weight: ${be.latestWeight} kg • Today sale floor`
                            : 'Add weight log on detail page for /kg benchmark'}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <Link
                      href={`/animals/${animal.id}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
                    >
                      Open Profile &amp; Logs →
                    </Link>
                    <Link
                      href={`/animals/${animal.id}/edit`}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 transition"
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-400">
            No animals match the selected filters.
          </div>
        )}

      </div>
    </div>
  )
}