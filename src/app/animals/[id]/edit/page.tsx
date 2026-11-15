import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function EditAnimalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // 1. User authentication check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  // 2. Current user ka farm fetch karein (Security ke liye)
  const { data: farm } = await supabase
    .from('farms')
    .select('id')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // 3. Animal ka purana data fetch karein
  const { data: animal, error } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('id', id)
    .eq('farm_id', farm.id)
    .single()

  if (error || !animal) {
    return redirect('/animals')
  }

  // 4. Update Server Action
  async function updateAnimal(formData: FormData) {
    'use server'
    const supabaseClient = await createClient()

    const tag_id = formData.get('tag_id') as string
    const species = formData.get('species') as string
    const sex = formData.get('sex') as string
    const ownership = formData.get('ownership') as string
    const client_name = formData.get('client_name') as string
    const status = formData.get('status') as string
    const cost_basis = parseFloat(formData.get('cost_basis') as string) || 0
    const monthly_boarding_rate = parseFloat(formData.get('monthly_boarding_rate') as string) || 0
    const dob = formData.get('dob') as string

    const { error: updateError } = await supabaseClient
      .from('livestock_master')
      .update({
        tag_id,
        species,
        sex,
        ownership,
        client_name: ownership === 'Palai' ? client_name : null,
        status,
        cost_basis,
        monthly_boarding_rate,
        dob: dob || null,
      })
      .eq('id', id)
      .eq('farm_id', farm!.id)

    if (updateError) {
      console.error('Error updating animal:', updateError.message)
      return redirect(`/animals/${id}/edit?error=${encodeURIComponent(updateError.message)}`)
    }

    return redirect('/animals')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6">
      <div className="p-8 bg-white rounded-lg shadow-md w-full max-w-lg">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Edit Animal ({animal.tag_id})</h1>
          <Link href="/animals" className="text-sm text-gray-500 hover:underline">
            ← Back to List
          </Link>
        </div>

        <form action={updateAnimal} className="flex flex-col gap-4">
          {/* Tag ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tag ID / Ear Tag</label>
            <input
              name="tag_id"
              type="text"
              defaultValue={animal.tag_id}
              required
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Species & Sex */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
              <select
                name="species"
                defaultValue={animal.species}
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="Goat">Goat</option>
                <option value="Sheep">Sheep</option>
                <option value="Cattle">Cattle</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sex</label>
              <select
                name="sex"
                defaultValue={animal.sex}
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
          </div>

          {/* Ownership & Client Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ownership</label>
              <select
                name="ownership"
                defaultValue={animal.ownership}
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="Self">Self (Farm Owned)</option>
                <option value="Palai">Palai (Client Owned)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Name (if Palai)</label>
              <input
                name="client_name"
                type="text"
                defaultValue={animal.client_name || ''}
                placeholder="e.g. Rohan / Annu"
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              name="status"
              defaultValue={animal.status}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="Active">Active</option>
              <option value="Sold">Sold</option>
              <option value="Deceased">Deceased</option>
              <option value="Returned">Returned (Palai)</option>
            </select>
          </div>

          {/* Cost Basis & Monthly Boarding Rate */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Basis (PKR)</label>
              <input
                name="cost_basis"
                type="number"
                step="0.01"
                defaultValue={animal.cost_basis || 0}
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Boarding Rate (PKR)</label>
              <input
                name="monthly_boarding_rate"
                type="number"
                step="0.01"
                defaultValue={animal.monthly_boarding_rate || 0}
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Date of Birth */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth (Approx)</label>
            <input
              name="dob"
              type="date"
              defaultValue={animal.dob ? animal.dob.split('T')[0] : ''}
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 mt-4">
            <Link
              href="/animals"
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition font-medium"
            >
              Update Animal
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}