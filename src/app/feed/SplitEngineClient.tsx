'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface AnimalItem {
  id: string
  tag_id: string
  species: string
  acquisition_date?: string | null
}

interface SplitEngineClientProps {
  speciesOptions: string[]
  activeAnimals: AnimalItem[]
  unallocatedBySpecies: Record<string, { amount: number; billCount: number }>
  selectedSpeciesFilter: string
  initialSplitDate: string
  allocateAction: (formData: FormData) => Promise<void>
}

export default function SplitEngineClient({
  speciesOptions,
  activeAnimals,
  unallocatedBySpecies,
  selectedSpeciesFilter,
  initialSplitDate,
  allocateAction,
}: SplitEngineClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [ledgerDate, setLedgerDate] = useState(initialSplitDate)

  const speciesWithPendingPools = Object.keys(unallocatedBySpecies)
  const cutoffStr = String(ledgerDate || initialSplitDate).split('T')[0]

  const eligibleAnimals = activeAnimals.filter(a => {
    if (!a.acquisition_date) return true
    return String(a.acquisition_date).split('T')[0] <= cutoffStr
  })

  const handleDateChange = (newDate: string) => {
    setLedgerDate(newDate)
    const params = new URLSearchParams(searchParams.toString())
    if (newDate) {
      params.set('splitDate', newDate)
    } else {
      params.delete('splitDate')
    }
    const query = params.toString()
    router.replace(query ? `/feed?${query}` : '/feed')
  }

  const defaultSpecies =
    selectedSpeciesFilter !== 'All'
      ? selectedSpeciesFilter
      : speciesWithPendingPools[0] || 'Goat'

  return (
    <div className="bg-slate-900 text-white rounded-2xl shadow-md p-6 border border-slate-800">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-lg">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-400 text-slate-950">
              Tier 2 Species-Smart Split
            </span>
            <h2 className="text-base font-bold">Auto-Split Species Feed Costs to Matching Animals</h2>
          </div>
          <p className="text-xs text-slate-300">
            Select a species pool below. Costs will <strong>only</strong> be divided among active animals of that exact species present on or before the ledger date.
          </p>
          {speciesWithPendingPools.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {speciesWithPendingPools.map(sp => (
                <span
                  key={sp}
                  className="text-[11px] font-mono bg-slate-800 text-amber-300 px-2.5 py-0.5 rounded-lg border border-slate-700"
                >
                  {sp}: Rs. {unallocatedBySpecies[sp].amount.toLocaleString()} pending
                </span>
              ))}
            </div>
          )}
        </div>

        <form
          action={allocateAction}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 w-full xl:w-auto"
        >
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
              1. Target Species
            </label>
            <select
              name="allocate_species"
              defaultValue={defaultSpecies}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:ring-2 focus:ring-amber-400"
            >
              {speciesOptions.map(sp => {
                const pool = unallocatedBySpecies[sp]?.amount || 0
                const count = eligibleAnimals.filter(a =>
                  sp === 'Shared (All Species)' ? true : a.species === sp
                ).length
                return (
                  <option key={sp} value={sp}>
                    {sp} (Rs. {pool.toLocaleString()} • {count} heads)
                  </option>
                )
              })}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
              2. Split Method
            </label>
            <select
              name="split_method"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
            >
              <option value="equal">Equal Split (Per Head)</option>
              <option value="weight">Live-Weight Pro-Rata Split</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
              3. Ledger Date
            </label>
            <input
              name="allocation_date"
              type="date"
              required
              value={ledgerDate}
              onChange={e => handleDateChange(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
              4. Batch Label
            </label>
            <input
              name="period_label"
              type="text"
              defaultValue="Monthly Bulk Ration"
              placeholder="e.g. Nov 2026 Ration"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={speciesWithPendingPools.length === 0}
              className="w-full py-2 px-4 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs transition shadow-sm"
            >
              Run Species Split
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}