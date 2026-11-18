import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AnimalsClientView from './AnimalsClientView'

// Helper: Species-based Smart Default Icon SVG when photo_url is missing
function getSpeciesDefaultIcon(species?: string): string {
  const sp = (species || 'Goat').toLowerCase()
  
  // Chicken / Bird Icon
  if (sp.includes('chicken') || sp.includes('bird') || sp.includes('quail')) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2316a34a"><path d="M19 7c0-1.1-.9-2-2-2h-3l-1-2H9L8 5H5c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v1c0 2.8 2.2 5 5 5h1v2H9v2h6v-2h-2v-2h1c2.8 0 5-2.2 5-5v-1h1c1.1 0 2-.9 2-2V7z"/></svg>'
  }
  
  // Sheep / Goat Icon
  if (sp.includes('sheep') || sp.includes('goat')) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2316a34a"><path d="M12 2C9.24 2 7 4.24 7 7c0 .74.17 1.44.47 2.07C6.15 9.77 5 11.24 5 13c0 1.66 1.34 3 3 3h.59C9.28 17.65 10.5 19 12 19s2.72-1.35 3.41-3H16c1.66 0 3-1.34 3-3 0-1.76-1.15-3.23-2.47-3.93.3-.63.47-1.33.47-2.07 0-2.76-2.24-5-5-5zm0 2c1.65 0 3 1.35 3 3s-1.35 3-3 3-3-1.35-3-3 1.35-3 3-3z"/></svg>'
  }
  
  // Cattle / Cow / Buffalo Icon
  if (sp.includes('cattle') || sp.includes('cow') || sp.includes('buffalo') || sp.includes('bull')) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2316a34a"><path d="M20 7v3h-2.1c-.5-1.8-2-3-3.9-3s-3.4 1.2-3.9 3H7V7c0-1.1-.9-2-2-2s-2 .9-2 2v7c0 2.2 1.8 4 4 4h12c2.2 0 4-1.8 4-4V7c0-1.1-.9-2-2-2s-2 .9-2 2z"/></svg>'
  }
  
  // Default Livestock Icon
  return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2316a34a"><circle cx="12" cy="12" r="10"/></svg>'
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