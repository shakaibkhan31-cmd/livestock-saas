import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AnimalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  // 1. Fetch Animal Details
  const { data: animal, error } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !animal) {
    return redirect('/animals')
  }

  // 2. Fetch Weight History for this animal
  const { data: weights } = await supabase
    .from('animal_weights')
    .select('*')
    .eq('animal_id', id)
    .order('recorded_date', { ascending: false })

  // 3. Server Action to Add Weight Entry
  const addWeight = async (formData: FormData) => {
    'use server'
    const weight_kg = formData.get('weight_kg') as string
    const recorded_date = formData.get('recorded_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    await supabaseClient.from('animal_weights').insert([
      {
        animal_id: id,
        weight_kg: parseFloat(weight_kg),
        recorded_date: recorded_date || new Date().toISOString().split('T')[0],
        notes: notes || null,
      },
    ])
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <Link href="/animals" className="text-green-600 hover:underline font-medium">
            &larr; Back to Livestock Master
          </Link>
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
            Status: {animal.status}
          </span>
        </div>

        {/* Animal Profile Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Tag ID: {animal.tag_id}</h1>
              <p className="text-gray-500">{animal.species} &bull; {animal.sex} &bull; {animal.ownership} {animal.client_name ? `(${animal.client_name})` : ''}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Monthly Boarding Rate</p>
              <p className="text-xl font-bold text-green-600">Rs. {animal.monthly_boarding_rate}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100 text-sm">
            <div>
              <span className="text-gray-400 block">Cost Basis</span>
              <span className="font-semibold text-gray-700">Rs. {animal.cost_basis}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Acquisition Date</span>
              <span className="font-semibold text-gray-700">{animal.acquisition_date || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Date of Birth</span>
              <span className="font-semibold text-gray-700">{animal.dob || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-gray-400 block">Breed</span>
              <span className="font-semibold text-gray-700">{animal.breed || 'Standard'}</span>
            </div>
          </div>
        </div>

        {/* Grid Layout: Weight History & Add Weight Form */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Weight History Table */}
          <div className="md:col-span-2 bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Weight Growth History</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Weight (kg)</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {weights && weights.length > 0 ? (
                    weights.map((w) => (
                      <tr key={w.id}>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{w.recorded_date}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-gray-900">{w.weight_kg} kg</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{w.notes || '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-500">
                        No weight logs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Weight Form */}
          <div className="bg-white rounded-lg shadow p-6 h-fit">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Log New Weight</h2>
            <form action={addWeight} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weight (KG)</label>
                <input
                  name="weight_kg"
                  type="number"
                  step="0.1"
                  required
                  placeholder="e.g. 45.5"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recorded Date</label>
                <input
                  name="recorded_date"
                  type="date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                <input
                  name="notes"
                  type="text"
                  placeholder="e.g. Post-deworming check"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition font-medium text-sm mt-2"
              >
                Save Weight Log
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}