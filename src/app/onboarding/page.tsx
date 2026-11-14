import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default function OnboardingPage() {
  const createFarm = async (formData: FormData) => {
    'use server'
    const farmName = formData.get('farmName') as string
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return redirect('/login')

    // Insert into farms table
    const { error } = await supabase.from('farms').insert([
      { farm_name: farmName, owner_id: user.id }
    ])

    if (error) {
      console.error('Error creating farm:', error)
      return
    }

    return redirect('/')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <div className="p-8 bg-white rounded-lg shadow-md w-[400px]">
        <h1 className="mb-2 text-2xl font-bold text-gray-800">Setup Your Farm</h1>
        <p className="mb-6 text-sm text-gray-500">Enter your farm or shed name to get started.</p>
        <form action={createFarm} className="flex flex-col gap-4">
          <input
            name="farmName"
            type="text"
            placeholder="e.g. BAA BAA Urban Rooftop Shed"
            required
            className="px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            type="submit"
            className="py-2 text-white bg-green-600 rounded-md hover:bg-green-700 transition font-medium"
          >
            Create Farm & Continue
          </button>
        </form>
      </div>
    </div>
  )
}