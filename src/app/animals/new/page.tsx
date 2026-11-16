'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewAnimalPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  // Form Interactive States
  const [ownership, setOwnership] = useState('Self')
  const [species, setSpecies] = useState('Goat')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      try {
        const response = await fetch('/api/animals/create', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (!response.ok || result.error) {
          throw new Error(result.error || 'Failed to register animal.')
        }

        router.push('/animals')
        router.refresh()
      } catch (err: any) {
        setError(err.message || 'Something went wrong.')
      }
    })
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
          {error && (
            <div className="p-4 bg-red-50 border-b border-red-200 text-red-700 text-sm flex items-center justify-between">
              <span><strong>Error:</strong> {error}</span>
              <button onClick={() => setError('')} className="text-red-500 font-bold">×</button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
            
            {/* Section 1: Identification & Classification */}
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">1. Identification & Classification</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Tag ID / Identifier <span className="text-red-500">*</span>
                  </label>
                  <input 
                    name="tag_id" 
                    type="text" 
                    required 
                    placeholder="e.g., G-07, C-102, CH-01" 
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono font-medium placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent transition" 
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Species</label>
                    <select 
                      name="species" 
                      value={species}
                      onChange={(e) => setSpecies(e.target.value)}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Ownership Structure</label>
                    <select 
                      name="ownership" 
                      value={ownership}
                      onChange={(e) => setOwnership(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition"
                    >
                      <option value="Self">Self (Farm Owned)</option>
                      <option value="Client">Palai (Client Owned)</option>
                    </select>
                  </div>

                  {/* Client Name: Only shows if Palai is selected */}
                  {ownership === 'Client' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        Client Name <span className="text-red-500">*</span>
                      </label>
                      <input 
                        name="client_name" 
                        type="text" 
                        required={ownership === 'Client'}
                        placeholder="Enter client name..." 
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-600 transition" 
                      />
                    </div>
                  )}
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

                  {/* Monthly Boarding Rate: Only shows if Palai is selected */}
                  {ownership === 'Client' && (
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
                  )}
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
                disabled={isPending}
                className="px-6 py-2.5 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 shadow-sm transition text-sm disabled:opacity-50"
              >
                {isPending ? 'Saving Record...' : 'Save Animal Record'}
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  )
}