import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AnimalsClientView from './AnimalsClientView'

// Helper: Clean Species-Specific Livestock Vector Icons
function getSpeciesDefaultIcon(species?: string): string {
  const sp = (species || 'Goat').toLowerCase()
  
  if (sp.includes('chicken') || sp.includes('bird') || sp.includes('quail') || sp.includes('poultry')) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2316a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 7h.01M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-4-4H9a5 5 0 0 0-5 5v7a3 3 0 0 0-3 3v1h4.4Z"/></svg>'
  }
  
  if (sp.includes('sheep') || sp.includes('goat') || sp.includes('lamb')) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2316a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 11v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6"/><path d="M5 7l7-4 7 4v4H5z"/></svg>'
  }
  
  if (sp.includes('cattle') || sp.includes('cow') || sp.includes('buffalo') || sp.includes('bull')) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2316a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4m4 0h4"/><path d="M2 10h2m16 0h2"/></svg>'
  }
  
  return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2316a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 11v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6"/><path d="M5 7l7-4 7 4v4H5z"/></svg>'
}

export default async function AnimalsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error

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
  const { data: rawAnimals } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('farm_id', farm.id)
    .eq('status', 'Active')
    .order('created_at', { ascending: false })

  // Map animals to ensure fallback photo_url uses species-specific smart icon
  const animals = (rawAnimals || []).map(animal => ({
    ...animal,
    photo_url: animal.photo_url && animal.photo_url.trim() !== '' 
      ? animal.photo_url 
      : getSpeciesDefaultIcon(animal.species)
  }))

  // 1. Single Delete Server Action
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

  // 2. Bulk Status Update / Delete Server Action
  async function bulkUpdateAnimals(formData: FormData) {
    'use server'
    const idsRaw = formData.get('selectedIds') as string
    const bulkAction = formData.get('bulkAction') as string

    if (!idsRaw || !bulkAction) return redirect('/animals')
    const ids = JSON.parse(idsRaw) as string[]
    if (ids.length === 0) return redirect('/animals')

    const supabaseClient = await createClient()

    if (bulkAction === 'DELETE') {
      const { error } = await supabaseClient
        .from('livestock_master')
        .delete()
        .in('id', ids)

      if (error) return redirect(`/animals?error=${encodeURIComponent(error.message)}`)
      return redirect(`/animals?msg=${encodeURIComponent(`${ids.length} animal(s) deleted successfully.`)}`)
    } else {
      const { error } = await supabaseClient
        .from('livestock_master')
        .update({ status: bulkAction })
        .in('id', ids)

      if (error) return redirect(`/animals?error=${encodeURIComponent(error.message)}`)
      return redirect(`/animals?msg=${encodeURIComponent(`${ids.length} animal(s) marked as ${bulkAction}.`)}`)
    }
  }

  // 3. Bulk CSV Import Server Action
  async function bulkImportCsv(formData: FormData) {
    'use server'
    const csvRowsRaw = formData.get('csvRows') as string
    if (!csvRowsRaw) return redirect('/animals?error=No+CSV+data+provided')

    const rows = JSON.parse(csvRowsRaw) as Array<Record<string, string>>
    if (!rows || rows.length === 0) return redirect('/animals?error=CSV+file+is+empty')

    const supabaseClient = await createClient()
    const { data: { user: currentUser } } = await supabaseClient.auth.getUser()
    if (!currentUser) return redirect('/login')

    const { data: currentFarm } = await supabaseClient
      .from('farms')
      .select('id')
      .eq('owner_id', currentUser.id)
      .single()

    if (!currentFarm) return redirect('/onboarding')

    const today = new Date().toISOString().split('T')[0]

    const recordsToInsert = rows.map((r, idx) => {
      const rawOwn = (r.ownership || 'Self').trim()
      const ownership = rawOwn.toLowerCase().includes('client') || rawOwn.toLowerCase().includes('palai')
        ? 'Client'
        : 'Self'

      return {
        farm_id: currentFarm.id,
        tag_id: (r.tag_id || `IMP-${Date.now()}-${idx + 1}`).trim(),
        species: (r.species || 'Goat').trim(),
        breed_name: r.breed_name ? r.breed_name.trim() : null,
        sex: (r.sex || 'Male').trim(),
        ownership,
        client_name: ownership === 'Client' ? (r.client_name?.trim() || 'Client') : null,
        cost_basis: r.cost_basis ? parseFloat(r.cost_basis) || 0 : 0,
        monthly_boarding_rate: ownership === 'Client' && r.monthly_boarding_rate ? parseFloat(r.monthly_boarding_rate) || 0 : 0,
        acquisition_date: r.acquisition_date?.trim() || today,
        status: 'Active',
      }
    })

    const { error } = await supabaseClient
      .from('livestock_master')
      .insert(recordsToInsert)

    if (error) {
      return redirect(`/animals?error=${encodeURIComponent('CSV Import Failed: ' + error.message)}`)
    }

    return redirect(`/animals?msg=${encodeURIComponent(`Successfully imported ${recordsToInsert.length} animals!`)}`)
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

        {/* Interactive Search, Bulk Import & Multi-Select Table */}
        <AnimalsClientView
          animals={animals || []}
          deleteAction={deleteAnimal}
          bulkUpdateAction={bulkUpdateAnimals}
          bulkImportAction={bulkImportCsv}
        />

      </div>
    </div>
  )
}