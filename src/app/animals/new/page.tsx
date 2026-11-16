import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function NewAnimalPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const errorMessage = params.error

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Fetch existing animals for smart tag generation
  const { data: existingAnimals } = await supabase
    .from('livestock_master')
    .select('tag_id')
    .eq('farm_id', farm.id)

  // Smart Tag Auto-Suggestion
  let suggestedTag = 'G-01'
  if (existingAnimals && existingAnimals.length > 0) {
    const tags = existingAnimals
      .map(a => a.tag_id)
      .filter((tag): tag is string => Boolean(tag))

    if (tags.length > 0) {
      const numbers = tags.map(tag => {
        const num = parseInt(tag.replace(/[^0-9]/g, ''), 10)
        return isNaN(num) ? 0 : num
      })
      const maxNum = Math.max(...numbers, 0)
      suggestedTag = `G-${String(maxNum + 1).padStart(2, '0')}`
    }
  }

  // Server Action for Form Submission
  const registerAnimal = async (formData: FormData) => {
    'use server'
    const tag_id = formData.get('tag_id') as string
    const species = formData.get('species') as string
    const breed_name = formData.get('breed_name') as string
    const ownership = formData.get('ownership') as string // 'Self' or 'Client'

    const client_name = formData.get('client_name') as string
    const sex = formData.get('sex') as string
    const dob = formData.get('dob') as string
    const acquisition_date = formData.get('acquisition_date') as string
    const status = (formData.get('status') as string) || 'Active'
    const cost_basis = formData.get('cost_basis') as string
    const monthly_boarding_rate = formData.get('monthly_boarding_rate') as string

    const supabaseClient = await createClient()

    const { data: { user: currentUser } } = await supabaseClient.auth.getUser()
    if (!currentUser) return redirect('/login')

    const { data: currentFarm } = await supabaseClient
      .from('farms')
      .select('id')
      .eq('owner_id', currentUser.id)
      .single()

    if (!currentFarm) return redirect('/onboarding')

    const insertData: Record<string, any> = {
      farm_id: currentFarm.id,
      tag_id,
      species,
      ownership,
      client_name: ownership === 'Client' ? (client_name || 'Client') : null,
      sex,
      status,
      cost_basis: cost_basis ? parseFloat(cost_basis) : 0,
      monthly_boarding_rate: ownership === 'Client' && monthly_boarding_rate ? parseFloat(monthly_boarding_rate) : 0,
    }

    if (breed_name) insertData.breed_name = breed_name
    if (dob) insertData.dob = dob
    if (acquisition_date) insertData.acquisition_date = acquisition_date

    const { error } = await supabaseClient.from('livestock_master').insert([insertData])

    if (error) {
      console.error('Supabase Insert Error:', error.message)
      return redirect(`/animals/new?error=${encodeURIComponent(error.message)}`)
    }

    return redirect('/animals')
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Register New Animal</h1>
            <p className="text-sm text-slate-500 mt-0.5">Add multi-species livestock inventory with dynamic ownership rules.</p>
          </div>
          <Link
            href="/animals"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-sm transition"
          >
            ← Back to Master
          </Link>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {errorMessage && (
            <div className="p-4 bg-red-50 border-b border-red-200 text-red-700 text-sm flex items-center gap-2">
              <span className="font-semibold">Error:</span> {decodeURIComponent(errorMessage)}
            </div>
          )}

          <form action={registerAnimal} className="p-6 sm:p-8 space-y-6">
            
            {/* Section 1: Identification & Classification */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">1. Identification & Classification</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Tag ID / Identifier <span className="text-red-500">*</span>
                    <span className="text-xs text-green-600 font-normal ml-2">(Auto-suggested: {suggestedTag})</span>
                  </label>
                  <input 
                    name="tag_id" 
                    type="text" 
                    required 
                    defaultValue={suggestedTag}
                    placeholder="e.g., G-07, C-102" 
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono font-medium placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Species</label>
                    <select name="species" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition">
                      <option value="Goat">Goat</option>
                      <option value="Sheep">Sheep</option>
                      <option value="Cattle">Cattle</option>
                      <option value="Buffalo">Buffalo</option>
                      <option value="Chicken">Chicken</option>
                      <option value="Rabbit">Rabbit</option>
                      <option value="Horse">Horse</option>
                      <option value="Dog">Dog</option>
                      <option value="Quail">Quail</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Breed / Type</label>
                    <input 
                      name="breed_name" 
                      type="text" 
                      placeholder="e.g., Gulabi, Beetal, Desi" 
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Sex</label>
                    <select name="sex" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition">
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Castrated">Castrated (Khassi)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Section 2: Ownership & Financial Terms */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">2. Ownership & Financial Terms</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Ownership Structure</label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="relative flex items-center p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
                      <input type="radio" name="ownership" value="Self" defaultChecked id="ownership-self" className="peer sr-only" />
                      <span className="text-sm font-medium text-slate-800">Self (Farm Owned)</span>
                    </label>
                    <label className="relative flex items-center p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
                      <input type="radio" name="ownership" value="Client" id="ownership-client" className="peer sr-only" />
                      <span className="text-sm font-medium text-slate-800">Palai (Client Owned)</span>
                    </label>
                  </div>
                </div>

                {/* Client Name & Boarding Rate - Visible ONLY when Palai is selected */}
                <div id="palai-section" style={{ display: 'none' }} className="pt-2 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Name <span className="text-red-500">*</span></label>
                      <input 
                        name="client_name" 
                        type="text" 
                        placeholder="Enter client name..." 
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Monthly Boarding Rate (PKR)</label>
                      <input 
                        name="monthly_boarding_rate" 
                        type="number" 
                        step="0.01" 
                        placeholder="0.00" 
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Cost Basis / Purchase Price (PKR)</label>
                    <input 
                      name="cost_basis" 
                      type="number" 
                      step="0.01" 
                      placeholder="0.00" 
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                    />
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Section 3: Timeline & Status */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">3. Timeline & Status</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Onboarding Date <span className="text-red-500">*</span></label>
                    <input 
                      name="acquisition_date" 
                      type="date" 
                      required
                      defaultValue={new Date().toISOString().split('T')[0]}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Initial Status</label>
                    <select name="status" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition">
                      <option value="Active">Active</option>
                      <option value="Sold">Sold</option>
                      <option value="Deceased">Deceased</option>
                      <option value="Returned">Returned</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Date of Birth (Approx)</label>
                  <input 
                    name="dob" 
                    type="date" 
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <Link
                href="/animals"
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition text-sm"
              >
                Cancel
              </Link>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 shadow-sm transition text-sm"
              >
                Save Animal Record
              </button>
            </div>

          </form>
        </div>
      </div>

      {/* Tiny client script for toggle visibility of Palai section */}
      <script dangerouslySetInnerHTML={{ __html: `
        document.addEventListener('change', function(e) {
          if (e.target.name === 'ownership') {
            const palaiSection = document.getElementById('palai-space') || document.getElementById('palai-section');
            if (e.target.value === 'Client') {
              palaiSection.style.display = 'block';
            } else {
              palaiSection.style.display = 'none';
            }
          }
        });
      ` }} />
    </div>
  )
}