import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function EditAnimalPage({
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

  // Fetch existing animal record
  const { data: animal, error: fetchError } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('id', id)
    .eq('farm_id', farm.id)
    .single()

  if (fetchError || !animal) {
    return redirect('/animals')
  }

  // Server Action to Update Animal Record & Photo
  const updateAnimal = async (formData: FormData) => {
    'use server'
    const tag_id = formData.get('tag_id') as string
    const species = formData.get('species') as string
    const breed_name = formData.get('breed_name') as string
    const ownership = formData.get('ownership') as string
    const client_name = formData.get('client_name') as string
    const client_phone = formData.get('client_phone') as string
    const sex = formData.get('sex') as string
    const dob = formData.get('dob') as string
    const acquisition_date = formData.get('acquisition_date') as string
    const status = (formData.get('status') as string) || 'Active'
    const cost_basis = formData.get('cost_basis') as string
    const monthly_boarding_rate = formData.get('monthly_boarding_rate') as string
    const existing_photo_url = formData.get('existing_photo_url') as string
    const photoFile = formData.get('photo') as File | null

    const supabaseClient = await createClient()

    const { data: { user: currentUser } } = await supabaseClient.auth.getUser()
    if (!currentUser) return redirect('/login')

    const { data: currentFarm } = await supabaseClient
      .from('farms')
      .select('id')
      .eq('owner_id', currentUser.id)
      .single()

    if (!currentFarm) return redirect('/onboarding')

    let photo_url: string | null = existing_photo_url || null

    // Upload New Photo if user selected one
    if (photoFile && photoFile.size > 0) {
      const fileExt = photoFile.name.split('.').pop() || 'jpg'
      const fileName = `${currentFarm.id}/${tag_id}-${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabaseClient.storage
        .from('animal-photos')
        .upload(fileName, photoFile, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadError) {
        console.error('Photo Upload Error:', uploadError.message)
        return redirect(`/animals/${id}/edit?error=${encodeURIComponent('Photo upload failed: ' + uploadError.message)}`)
      }

      const { data: publicUrlData } = supabaseClient.storage
        .from('animal-photos')
        .getPublicUrl(fileName)

      photo_url = publicUrlData.publicUrl
    }

    const updateData: Record<string, any> = {
      tag_id,
      species,
      breed_name: breed_name || null,
      ownership,
      client_name: ownership === 'Client' ? (client_name || 'Client') : null,
      client_phone: ownership === 'Client' ? (client_phone || null) : null,
      sex,
      status,
      cost_basis: cost_basis ? parseFloat(cost_basis) : 0,
      monthly_boarding_rate: ownership === 'Client' && monthly_boarding_rate ? parseFloat(monthly_boarding_rate) : 0,
      photo_url,
      dob: dob || null,
      acquisition_date: acquisition_date || null,
    }

    const { error } = await supabaseClient
      .from('livestock_master')
      .update(updateData)
      .eq('id', id)
      .eq('farm_id', currentFarm.id)

    if (error) {
      console.error('Supabase Update Error:', error.message)
      return redirect(`/animals/${id}/edit?error=${encodeURIComponent(error.message)}`)
    }

    return redirect('/animals')
  }

  const isPalai = animal.ownership === 'Client'

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Edit Animal Record</h1>
              <span className="font-mono text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-lg border border-green-200">
                {animal.tag_id}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Update visual photo, breed details, ownership terms, or status.</p>
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

          <form action={updateAnimal} className="p-6 sm:p-8 space-y-6">
            <input type="hidden" name="existing_photo_url" value={animal.photo_url || ''} />

            {/* Section 1: Visual Identification (Photo Upload) */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">1. Visual Identification</h2>
              <div className="flex items-center gap-5 p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl">
                <div className="h-20 w-20 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                  <img
                    id="photo-preview"
                    src={animal.photo_url || ''}
                    alt={animal.tag_id}
                    className={`h-full w-full object-cover ${animal.photo_url ? '' : 'hidden'}`}
                  />
                  <span
                    id="photo-placeholder"
                    className={`text-2xl text-slate-400 ${animal.photo_url ? 'hidden' : ''}`}
                  >
                    📷
                  </span>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {animal.photo_url ? 'Change Animal Photo' : 'Upload Animal Photo'}
                  </label>
                  <input
                    name="photo"
                    type="file"
                    accept="image/*"
                    id="photo-input"
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 transition cursor-pointer"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {animal.photo_url ? 'Leave empty to keep existing photo.' : 'JPG, PNG or WEBP. Displays in master inventory.'}
                  </p>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Section 2: Identification & Classification */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">2. Identification & Classification</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Tag ID / Identifier <span className="text-red-500">*</span>
                  </label>
                  <input
                    name="tag_id"
                    type="text"
                    required
                    defaultValue={animal.tag_id}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Species</label>
                    <select
                      name="species"
                      defaultValue={animal.species}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    >
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
                      defaultValue={animal.breed_name || ''}
                      placeholder="e.g., Gulabi, Beetal, Bisser"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Sex</label>
                    <select
                      name="sex"
                      defaultValue={animal.sex}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Castrated">Castrated (Khassi)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Section 3: Ownership & Financial Terms */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">3. Ownership & Financial Terms</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Ownership Structure</label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="relative flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
                      <input
                        type="radio"
                        name="ownership"
                        value="Self"
                        defaultChecked={!isPalai}
                        className="accent-green-600 h-4 w-4"
                      />
                      <span className="text-sm font-medium text-slate-800">Self (Farm Owned)</span>
                    </label>
                    <label className="relative flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition">
                      <input
                        type="radio"
                        name="ownership"
                        value="Client"
                        defaultChecked={isPalai}
                        className="accent-purple-600 h-4 w-4"
                      />
                      <span className="text-sm font-medium text-slate-800">Palai (Client Owned)</span>
                    </label>
                  </div>
                </div>

                {/* Client Name & Boarding Rate - Visible ONLY when Palai is selected */}
                <div id="palai-section" style={{ display: isPalai ? 'block' : 'none' }} className="pt-2 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Name <span className="text-red-500">*</span></label>
                      <input
                        name="client_name"
                        type="text"
                        defaultValue={animal.client_name || ''}
                        placeholder="Enter client name..."
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                      />
                    </div>
                    <div>
  <label className="block text-sm font-medium text-slate-700 mb-1.5">Client Phone</label>
  <input
    name="client_phone"
    type="tel"
    defaultValue={animal.client_phone || ''}
    placeholder="03XX-XXXXXXX"
    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
  />
</div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Monthly Boarding Rate (PKR)</label>
                      <input
                        name="monthly_boarding_rate"
                        type="number"
                        step="0.01"
                        defaultValue={animal.monthly_boarding_rate || 0}
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
                      defaultValue={animal.cost_basis || 0}
                      placeholder="0.00"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    />
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* Section 4: Timeline & Status */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">4. Timeline & Status</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Onboarding Date <span className="text-red-500">*</span></label>
                    <input
                      name="acquisition_date"
                      type="date"
                      required
                      defaultValue={animal.acquisition_date ? String(animal.acquisition_date).split('T')[0] : ''}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Current Status</label>
                    <select
                      name="status"
                      defaultValue={animal.status || 'Active'}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    >
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
                    defaultValue={animal.dob ? String(animal.dob).split('T')[0] : ''}
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
                Update Animal Record
              </button>
            </div>

          </form>
        </div>
      </div>

      {/* Client Script for Palai Toggle + Live Photo Preview */}
      <script dangerouslySetInnerHTML={{ __html: `
        document.addEventListener('change', function(e) {
          if (e.target.name === 'ownership') {
            const palaiSection = document.getElementById('palai-section');
            if (palaiSection) {
              palaiSection.style.display = e.target.value === 'Client' ? 'block' : 'none';
            }
          }
          if (e.target.id === 'photo-input' && e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = function(ev) {
              const img = document.getElementById('photo-preview');
              const placeholder = document.getElementById('photo-placeholder');
              if (img && placeholder) {
                img.src = ev.target.result;
                img.classList.remove('hidden');
                placeholder.classList.add('hidden');
              }
            };
            reader.readAsDataURL(e.target.files[0]);
          }
        });
      ` }} />
    </div>
  )
}