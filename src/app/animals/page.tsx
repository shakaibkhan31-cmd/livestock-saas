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

  // Fetch active animals
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

  // Calculate Quick Stats
  const totalStock = animals ? animals.length : 0
  const selfStock = animals ? animals.filter(a => a.ownership === 'Self').length : 0
  const palaiStock = animals ? animals.filter(a => a.ownership === 'Client').length : 0
  const totalValuation = animals ? animals.reduce((acc, curr) => acc + (Number(curr.cost_basis) || 0), 0) : 0

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header & Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-green-700 bg-green-50 px-2.5 py-0.5 rounded-full border border-green-200">
                Live Operations
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">{farm.farm_name}</h1>
            <p className="text-sm text-slate-500">Livestock Master & Inventory Management (Active Stock)</p>
          </div>
          
          <Link
            href="/animals/new"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl shadow-sm transition text-sm gap-2"
          >
            <span className="text-lg leading-none">+</span> Add New Animal
          </Link>
        </div>

        {/* Quick KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Active Stock</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{totalStock} <span className="text-sm font-normal text-slate-400">heads</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Self Owned</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{selfStock} <span className="text-sm font-normal text-slate-400">animals</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Client Palai (Boarding)</p>
            <p className="text-2xl font-bold text-purple-600 mt-1">{palaiStock} <span className="text-sm font-normal text-slate-400">animals</span></p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Cost Valuation</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">Rs. {totalValuation.toLocaleString()}</p>
          </div>
        </div>

        {/* Main Data Table Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <h3 className="font-semibold text-slate-800 text-sm">Active Livestock Inventory</h3>
            <span className="text-xs text-slate-500 font-medium">Showing active records only</span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Tag ID</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Species</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Ownership</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Sex</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Cost Basis (PKR)</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {animals && animals.length > 0 ? (
                  animals.map((animal) => (
                    <tr key={animal.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link 
                          href={`/animals/${animal.id}`}
                          className="font-mono font-semibold text-green-700 hover:text-green-800 hover:underline bg-green-50 px-2.5 py-1 rounded-lg border border-green-200 inline-block"
                        >
                          {animal.tag_id}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-800">{animal.species}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${
                          animal.ownership === 'Self' 
                            ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                            : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          {animal.ownership} {animal.client_name ? `(${animal.client_name})` : ''}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{animal.sex}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {animal.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                        Rs. {Number(animal.cost_basis || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                        <Link
                          href={`/animals/${animal.id}/edit`}
                          className="inline-flex items-center px-3 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition text-xs font-medium"
                        >
                          Edit
                        </Link>
                        <form action={deleteAnimal} className="inline-block">
                          <input type="hidden" name="animalId" value={animal.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition text-xs font-medium"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <div className="max-w-sm mx-auto space-y-3">
                        <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400 text-xl font-bold">🐐</div>
                        <p className="text-slate-600 font-medium">No active animals registered yet.</p>
                        <p className="text-sm text-slate-400">Get started by adding your first rooftop livestock record.</p>
                        <Link
                          href="/animals/new"
                          className="inline-block mt-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 transition"
                        >
                          + Register First Animal
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}