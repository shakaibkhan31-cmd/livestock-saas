import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AnimalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; editLogId?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const errorMessage = resolvedSearchParams.error
  const editLogId = resolvedSearchParams.editLogId

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
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

  // 1. Server Action: Add Weight Log
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

  // 2. Server Action: Update Weight Log
  const updateWeightLog = async (formData: FormData) => {
    'use server'
    const logId = formData.get('logId') as string
    const weight_kg = formData.get('weight_kg') as string
    const recorded_date = formData.get('recorded_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('animal_weight_logs')
      .update({
        weight_kg: parseFloat(weight_kg),
        recorded_date,
        notes: notes || null,
      })
      .eq('id', logId)
      .eq('animal_id', id)

    if (error) {
      return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/animals/${id}`)
  }

  // 3. Server Action: Delete Weight Log
  const deleteWeightLog = async (formData: FormData) => {
    'use server'
    const logId = formData.get('logId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('animal_weight_logs')
      .delete()
      .eq('id', logId)
      .eq('animal_id', id)

    if (error) {
      return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/animals/${id}`)
  }

  // Growth Summary Calculations
  const latestWeight = weightLogs && weightLogs.length > 0 ? Number(weightLogs[0].weight_kg) : null
  const initialWeight = weightLogs && weightLogs.length > 0 ? Number(weightLogs[weightLogs.length - 1].weight_kg) : null
  const netGain = latestWeight !== null && initialWeight !== null ? (latestWeight - initialWeight).toFixed(1) : null

  // QR Code URL pointing directly to this animal's live profile
  const animalProfileUrl = `https://livestock-saas.vercel.app/animals/${animal.id}`
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(animalProfileUrl)}`

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
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
              <p className="text-sm text-slate-500">
                {animal.species} {animal.breed_name ? `• ${animal.breed_name}` : ''} • Sex: {animal.sex}
              </p>
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

        {/* Grid Layout: Left Profile + QR Tag | Right Weight Logs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column */}
          <div className="space-y-6">
            {/* Ownership & Financial Card */}
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
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {animal.acquisition_date ? new Date(animal.acquisition_date).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>

            {/* Phase 3: Smart QR Code Ear Tag Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Smart QR Ear Tag</h3>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  Scan Ready
                </span>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-300 inline-block mx-auto">
                <img
                  src={qrImageUrl}
                  alt={`QR Code for ${animal.tag_id}`}
                  className="h-36 w-36 mx-auto rounded-lg bg-white p-2 border border-slate-200"
                />
                <p className="font-mono font-bold text-slate-900 text-sm mt-2">{animal.tag_id}</p>
                <p className="text-[11px] text-slate-400">{farm.farm_name}</p>
              </div>

              <p className="text-xs text-slate-500">
                Scan with mobile camera in shed to open live profile & weight logs instantly.
              </p>

              <a
                href={qrImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={`${animal.tag_id}-QR-Tag.png`}
                className="block w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition"
              >
                Open / Print QR Tag
              </a>
            </div>
          </div>

          {/* Right Column: Weight Logs & Growth Tracking */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Growth Summary Mini-Bar */}
            {latestWeight !== null && (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs text-slate-500">Initial Weight</p>
                  <p className="text-lg font-bold text-slate-800 font-mono mt-0.5">{initialWeight} kg</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs text-slate-500">Current Weight</p>
                  <p className="text-lg font-bold text-green-700 font-mono mt-0.5">{latestWeight} kg</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs text-slate-500">Net Gain</p>
                  <p className={`text-lg font-bold font-mono mt-0.5 ${Number(netGain) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {Number(netGain) >= 0 ? `+${netGain}` : netGain} kg
                  </p>
                </div>
              </div>
            )}

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

            {/* Weight History Table with Inline Edit & Delete */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 text-sm">Weight History & Growth Logs</h3>
                <span className="text-xs text-slate-400">{weightLogs?.length || 0} entries</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Weight (KG)</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Notes</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {weightLogs && weightLogs.length > 0 ? (
                      weightLogs.map((log) => {
                        const isEditing = editLogId === log.id
                        return isEditing ? (
                          <tr key={log.id} className="bg-amber-50/60">
                            <td colSpan={4} className="px-6 py-3">
                              <form action={updateWeightLog} className="flex flex-col sm:flex-row items-center gap-2">
                                <input type="hidden" name="logId" value={log.id} />
                                <input
                                  name="recorded_date"
                                  type="date"
                                  required
                                  defaultValue={String(log.recorded_date).split('T')[0]}
                                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                                />
                                <input
                                  name="weight_kg"
                                  type="number"
                                  step="0.1"
                                  required
                                  defaultValue={log.weight_kg}
                                  className="w-24 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                                />
                                <input
                                  name="notes"
                                  type="text"
                                  defaultValue={log.notes || ''}
                                  placeholder="Notes..."
                                  className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="submit"
                                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
                                  >
                                    Save
                                  </button>
                                  <Link
                                    href={`/animals/${id}`}
                                    className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-300"
                                  >
                                    Cancel
                                  </Link>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-3.5 text-sm text-slate-800">
                              {new Date(log.recorded_date).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-3.5 text-sm font-bold text-green-700 font-mono">
                              {log.weight_kg} kg
                            </td>
                            <td className="px-6 py-3.5 text-sm text-slate-500">
                              {log.notes || '—'}
                            </td>
                            <td className="px-6 py-3.5 text-right text-xs font-medium space-x-2 whitespace-nowrap">
                              <Link
                                href={`/animals/${id}?editLogId=${log.id}`}
                                className="inline-flex items-center px-2.5 py-1 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition"
                              >
                                Edit
                              </Link>
                              <form action={deleteWeightLog} className="inline-block">
                                <input type="hidden" name="logId" value={log.id} />
                                <button
                                  type="submit"
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition"
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
                        <td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-sm">
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