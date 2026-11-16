import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AnimalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const errorMessage = resolvedSearchParams.error

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Fetch animal details
  const { data: animal } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('id', id)
    .eq('farm_id', farm.id)
    .single()

  if (!animal) return redirect('/animals')

  // Fetch weight logs for this animal
  const { data: weightLogs } = await supabase
    .from('animal_weight_logs')
    .select('*')
    .eq('animal_id', id)
    .order('recorded_date', { ascending: false })

  // Server Action to Add Weight Log
  const addWeightLog = async (formData: FormData) => {
    'use server'
    const weight_kg = formData.get('weight_kg') as string
    const recorded_date = formData.get('recorded_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    const { error } = await supabaseClient.from('animal_weight_logs').insert([{
      animal_id: id,
      farm_id: farm.id,
      weight_kg: parseFloat(weight_kg),
      recorded_date: recorded_date || new Date().toISOString().split('T')[0],
      notes: notes || null,
    }])

    if (error) {
      return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/animals/${id}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Top Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
              {animal.photo_url ? (
                <img src={animal.photo_url} alt={animal.tag_id} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl">🐐</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 font-mono">{animal.tag_id}</h1>
                <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {animal.status}
                </span>
              </div>
              <p className="text-sm text-slate-500">{animal.species} {animal.breed_name ? `• ${animal.breed_name}` : ''} • Sex: {animal.sex}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/animals/${animal.id}/edit`}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 rounded-xl text-sm font-medium transition"
            >
              Edit Animal
            </Link>
            <Link
              href="/animals"
              className="px-4 py-2 bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-xl text-sm font-medium transition"
            >
              ← Back to Master
            </Link>
          </div>
        </div>

        {errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            <strong>Error:</strong> {decodeURIComponent(errorMessage)}
          </div>
        )}

        {/* Grid Layout: Profile info & Weight Tracking */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left Column: Quick Stats */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Financial & Ownership</h3>
              
              <div>
                <p className="text-xs text-slate-500">Ownership Structure</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {animal.ownership === 'Self' ? 'Self (Farm Owned)' : `Palai (${animal.client_name})`}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Cost Basis / Purchase Price</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">Rs. {Number(animal.cost_basis || 0).toLocaleString()}</p>
              </div>

              {animal.ownership === 'Client' && (
                <div>
                  <p className="text-xs text-slate-500">Monthly Boarding Rate</p>
                  <p className="text-sm font-semibold text-purple-700 mt-0.5">Rs. {Number(animal.monthly_boarding_rate || 0).toLocaleString()}</p>
                </div>
              )}

              <div>
                <p className="text-xs text-slate-500">Onboarding Date</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">{animal.acquisition_date ? new Date(animal.acquisition_date).toLocaleDateString() : 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* Right Column: Weight Logs & Growth Tracking */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Add Weight Log Form Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Record New Weight Log</h3>
              <form action={addWeightLog} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Weight (KG) *</label>
                  <input
                    name="weight_kg"
                    type="number"
                    step="0.1"
                    required
                    placeholder="e.g., 45.5"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-green-600 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                  <input
                    name="recorded_date"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-green-600 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes / Remarks</label>
                  <div className="flex gap-2">
                    <input
                      name="notes"
                      type="text"
                      placeholder="e.g., Post-feeding"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-green-600 transition"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium shadow-sm transition shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Weight History Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-semibold text-slate-800 text-sm">Weight History & Growth Logs</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Recorded Date</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Weight (KG)</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {weightLogs && weightLogs.length > 0 ? (
                      weightLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3.5 text-sm text-slate-800">{new Date(log.recorded_date).toLocaleDateString()}</td>
                          <td className="px-6 py-3.5 text-sm font-bold text-green-700 font-mono">{log.weight_kg} kg</td>
                          <td className="px-6 py-3.5 text-sm text-slate-500">{log.notes || '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-slate-400 text-sm">
                          No weight logs recorded yet. Add the first weight entry above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  )
}