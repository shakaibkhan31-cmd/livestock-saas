import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AnimalsClientView from './AnimalsClientView'

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

        {/* Interactive Search & Table Component */}
        <AnimalsClientView animals={animals || []} deleteAction={deleteAnimal} />

      </div>
    </div>
  )
}