import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AnimalsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Sirf Active animals fetch karne ke liye .eq('status', 'Active') laga diya hai
  const { data: animals } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('farm_id', farm.id)
    .eq('status', 'Active')
    .order('created_at', { ascending: false })

  // Delete Server Action
  async function deleteAnimal(formData: FormData) {
    'use server'
    const animalId = formData.get('animalId') as string
    const supabaseClient = await createClient()

    await supabaseClient
      .from('livestock_master')
      .delete()
      .eq('id', animalId)

    return redirect('/animals')
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{farm.farm_name}</h1>
            <p className="text-gray-500">Livestock Master & Inventory (Active Stock)</p>
          </div>
          <Link
            href="/animals/new"
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition font-medium"
          >
            + Add New Animal
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tag ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Species</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ownership</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sex</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost Basis (PKR)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {animals && animals.length > 0 ? (
                animals.map((animal) => (
                  <tr key={animal.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-green-600 hover:underline">
                      <Link href={`/animals/${animal.id}`}>{animal.tag_id}</Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">{animal.species}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full ${animal.ownership === 'Self' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                        {animal.ownership} {animal.client_name ? `(${animal.client_name})` : ''}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">{animal.sex}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">{animal.status}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">Rs. {animal.cost_basis}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <Link
                        href={`/animals/${animal.id}/edit`}
                        className="text-indigo-600 hover:text-indigo-900 bg-indigo-50 px-3 py-1 rounded"
                      >
                        Edit
                      </Link>
                      <form action={deleteAnimal} className="inline-block">
                        <input type="hidden" name="animalId" value={animal.id} />
                        <button
                          type="submit"
                          className="text-red-600 hover:text-red-900 bg-red-50 px-3 py-1 rounded"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No active animals registered yet. Click &quot;Add New Animal&quot; to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}