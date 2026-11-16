import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default function NewAnimalPage() {
  const registerAnimal = async (formData: FormData) => {
    'use server'
    const tag_id = formData.get('tag_id') as string
    const species = formData.get('species') as string
    const rawOwnership = formData.get('ownership') as string
    const ownership = rawOwnership.includes('Palai') || rawOwnership === 'Client' ? 'Palai' : 'Self'
    
    const client_name = formData.get('client_name') as string
    const sex = formData.get('sex') as string
    const dob = formData.get('dob') as string
    const acquisition_date = formData.get('acquisition_date') as string
    const cost_basis = formData.get('cost_basis') as string
    const monthly_boarding_rate = formData.get('monthly_boarding_rate') as string

    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return redirect('/login')

    const { data: farm } = await supabase
      .from('farms')
      .select('id')
      .eq('owner_id', user.id)
      .single()

    if (!farm) return redirect('/onboarding')

    const insertData = {
      farm_id: farm.id,
      tag_id,
      species,
      ownership,
      client_name: ownership === 'Palai' ? (client_name || 'Client') : null,
      sex,
      dob: dob || null,
      acquisition_date: acquisition_date || new Date().toISOString().split('T')[0],
      cost_basis: cost_basis ? parseFloat(cost_basis) : 0,
      monthly_boarding_rate: monthly_boarding_rate ? parseFloat(monthly_boarding_rate) : 0,
      status: 'Active',
    }

    const { error } = await supabase.from('livestock_master').insert([insertData])

    if (error) {
      console.error('Supabase Insert Error:', error)
      throw new Error(`Failed to insert animal: ${error.message}`)
    }

    return redirect('/animals')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center py-12">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-lg">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Register New Animal</h1>
        <form action={registerAnimal} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tag ID / Ear Tag</label>
            <input name="tag_id" type="text" required placeholder="e.g., G-01, C-101" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
              <select name="species" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500">
                <option value="Goat">Goat</option>
                <option value="Sheep">Sheep</option>
                <option value="Cattle">Cattle</option>
                <option value="Buffalo">Buffalo</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sex</label>
              <select name="sex" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Castrated">Castrated (Khassi)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ownership</label>
              <select name="ownership" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500">
                <option value="Self">Self (Farm Owned)</option>
                <option value="Palai">Palai (Client Owned)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Name (if Palai)</label>
              <input name="client_name" type="text" placeholder="e.g., Rohan / Annu" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Basis / Purchase Price (PKR)</label>
              <input name="cost_basis" type="number" step="0.01" placeholder="0.00" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Boarding Rate (PKR)</label>
              <input name="monthly_boarding_rate" type="number" step="0.01" placeholder="0.00" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Onboarding Date</label>
              <input 
                name="acquisition_date" 
                type="date" 
                required
                className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth (Approx)</label>
              <input name="dob" type="date" className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          <div className="flex justify-end gap-4 mt-4">
            <a href="/animals" className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition">Cancel</a>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition">Save Animal</button>
          </div>
        </form>
      </div>
    </div>
  )
}