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

  const defaultSpecies =
    selectedSpeciesFilter !== 'All'
      ? selectedSpeciesFilter
      : speciesWithPendingPools[0] || 'Goat'

  const [selectedSpecies, setSelectedSpecies] = useState(defaultSpecies)

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

  const activePool = unallocatedBySpecies[selectedSpecies]?.amount || 0
  const activeBillCount = unallocatedBySpecies[selectedSpecies]?.billCount || 0
  const matchingAnimalCount = eligibleAnimals.filter(a =>
    selectedSpecies === 'Shared (All Species)' ? true : a.species === selectedSpecies
  ).length
  const hasPendingForSelected = activePool > 0

  const handleSubmitConfirm = (e: React.FormEvent<HTMLFormElement>) => {
    if (!hasPendingForSelected) {
      e.preventDefault()
      return
    }
    const ok = window.confirm(
      `Split Rs. ${activePool.toLocaleString()} Consumption cost among ${matchingAnimalCount} ${selectedSpecies} animals? This cannot be undone.`
    )
    if (!ok) {
      e.preventDefault()
    }
  }

  return (
    <div className="bg-slate-900 text-white rounded-2xl shadow-md p-6 border border-slate-800">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-400 text-slate-950">
              Tier 2 Species-Smart Split
            </span>
            <h2 className="text-base font-bold">Auto-Split Species Feed Costs to Matching Animals</h2>
          </div>
          <p className="text-xs text-slate-300">
            Select a species pool below. Costs will <strong>only</strong> be divided among active animals of that exact species present on or before the ledger date.
          </p>
          <p className="text-[11px] font-semibold text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
            Important: Use this Split only after Consumption — not after Purchase. First record the feed as consumed, then split that consumed cost among animals. Purchased stock that has not been consumed yet must not be split.
          </p>
          {speciesWithPendingPools.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-0.5">
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

        <div className="w-full xl:w-auto space-y-2.5">
          <p className="text-[11px] text-slate-400">
            Correct flow: <span className="text-white font-semibold">1. Purchase</span> →{' '}
            <span className="text-white font-semibold">2. Consumption</span> →{' '}
            <span className="text-white font-semibold">3. Split</span>
          </p>

          <form
            action={allocateAction}
            onSubmit={handleSubmitConfirm}
            className="space-y-2.5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                  1. Target Species
                </label>
                <select
                  name="allocate_species"
                  value={selectedSpecies}
                  onChange={e => setSelectedSpecies(e.target.value)}
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
                  disabled={!hasPendingForSelected}
                  className="w-full py-2 px-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold rounded-xl text-xs transition shadow-sm"
                >
                  {hasPendingForSelected ? 'Run Species Split' : 'No pending Consumption cost to split'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono bg-slate-800/80 border border-slate-700/80 rounded-xl px-3 py-1.5 text-slate-200">
              <span>
                Pending Consumption Pool: Rs. {activePool.toLocaleString()} • {activeBillCount} entries
              </span>
              <span className="text-slate-400">
                Eligible {selectedSpecies}: {matchingAnimalCount} head(s)
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}