'use client'

import { useState } from 'react'
import Link from 'next/link'

export interface AnimalItem {
  id: string
  tag_id: string
  species: string
  breed_name?: string | null
  ownership: string
  client_name?: string | null
  sex: string
  status: string
  cost_basis: number
  photo_url?: string | null
  acquisition_date?: string | null
  breakEven?: {
    breakEvenToday: number
    perKgToday: number | null
    latestWeight: number | null
  } | null
}

interface AnimalsClientViewProps {
  animals: AnimalItem[]
  deleteAction: (formData: FormData) => Promise<void>
  bulkUpdateAction: (formData: FormData) => Promise<void>
  bulkImportAction: (formData: FormData) => Promise<void>
  bulkWeightLogAction: (formData: FormData) => Promise<void>
  recordSaleAction: (formData: FormData) => Promise<void>
}

export function getSpeciesEmoji(species?: string | null): string {
  const s = (species || '').toLowerCase().trim()
  if (s.includes('chicken') || s.includes('poultry') || s.includes('hen') || s.includes('rooster')) return '🐔'
  if (s.includes('sheep') || s.includes('lamb') || s.includes('dumba')) return '🐑'
  if (s.includes('cow') || s.includes('cattle') || s.includes('buffalo') || s.includes('bull') || s.includes('calf')) return '🐄'
  if (s.includes('rabbit') || s.includes('bunny')) return '🐇'
  if (s.includes('horse') || s.includes('mare') || s.includes('stallion')) return '🐎'
  if (s.includes('dog') || s.includes('puppy')) return '🐕'
  if (s.includes('quail') || s.includes('bird') || s.includes('duck')) return '🐦'
  return '🐐'
}

export default function AnimalsClientView({
  animals,
  deleteAction,
  bulkUpdateAction,
  bulkImportAction,
  bulkWeightLogAction,
  recordSaleAction,
}: AnimalsClientViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOwnership, setFilterOwnership] = useState('All')
  const [filterSpecies, setFilterSpecies] = useState('All')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // CSV Import Modal State
  const [showImportModal, setShowImportModal] = useState(false)
  const [parsedRows, setParsedRows] = useState<Array<Record<string, string>>>([])
  const [csvError, setCsvError] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  // Bulk Weight Modal State
  const [showWeightModal, setShowWeightModal] = useState(false)
  const [weightDate, setWeightDate] = useState(() => new Date().toISOString().split('T')[0])
  const [weightNotes, setWeightNotes] = useState('Weekly Shed Weigh-In')
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>({})
  const [isSavingWeights, setIsSavingWeights] = useState(false)

  // Sale / Settlement Modal State
  const [saleAnimal, setSaleAnimal] = useState<AnimalItem | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().split('T')[0])
  const [saleNotes, setSaleNotes] = useState('')
  const [isRecordingSale, setIsRecordingSale] = useState(false)

  const speciesOptions = Array.from(
    new Set(animals.map(a => (a.species || '').trim()).filter(Boolean))
  ).sort()

  const activeAnimals = animals.filter(a => a.status === 'Active')

  const filteredAnimals = animals.filter(animal => {
    const q = searchQuery.trim().toLowerCase()
    const matchesSearch =
      !q ||
      animal.tag_id.toLowerCase().includes(q) ||
      animal.species.toLowerCase().includes(q) ||
      (animal.breed_name && animal.breed_name.toLowerCase().includes(q)) ||
      (animal.client_name && animal.client_name.toLowerCase().includes(q))

    const matchesOwnership = filterOwnership === 'All' || animal.ownership === filterOwnership
    const matchesSpecies = filterSpecies === 'All' || animal.species === filterSpecies
    return matchesSearch && matchesOwnership && matchesSpecies
  })

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredAnimals.length && filteredAnimals.length > 0) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredAnimals.map(a => a.id))
    }
  }

  const downloadSampleCsv = () => {
    const headers = 'tag_id,species,breed_name,sex,ownership,client_name,cost_basis,monthly_boarding_rate,acquisition_date'
    const sample1 = 'G-08,Goat,Gulabi,Male,Self,,28000,0,2026-11-17'
    const sample2 = 'G-09,Goat,Kamori,Male,Client,Zainab,0,5000,2026-11-17'
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, sample1, sample2].join('\n')
    const link = document.createElement('a')
    link.setAttribute('href', encodeURI(csvContent))
    link.setAttribute('download', 'baabaashed_bulk_template.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError('')
    setParsedRows([])
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = (event.target?.result as string) || ''
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        if (lines.length < 2) {
          setCsvError('CSV file must contain a header row and at least one data row.')
          return
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
        const rows = lines.slice(1).map(line => {
          const values = line.split(',')
          const obj: Record<string, string> = {}
          headers.forEach((h, i) => {
            obj[h] = values[i] ? values[i].trim() : ''
          })
          return obj
        })

        setParsedRows(rows)
      } catch {
        setCsvError('Failed to parse CSV file. Please use the sample template format.')
      }
    }
    reader.readAsText(file)
  }

  const exportFilteredCsv = () => {
    const headers = [
      'Tag ID',
      'Species',
      'Breed',
      'Ownership',
      'Client Name',
      'Sex',
      'Status',
      'Cost Basis (PKR)',
      'Latest Weight (KG)',
      'Break-Even Today (PKR)',
      'Break-Even Per KG (PKR)',
    ]
    const rows = filteredAnimals.map(a => [
      a.tag_id,
      a.species,
      a.breed_name || '',
      a.ownership,
      a.client_name || '',
      a.sex,
      a.status,
      a.cost_basis || 0,
      a.breakEven?.latestWeight ?? '',
      a.ownership === 'Self' && a.breakEven ? a.breakEven.breakEvenToday : '',
      a.ownership === 'Self' && a.breakEven && a.breakEven.perKgToday !== null ? a.breakEven.perKgToday : '',
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const link = document.createElement('a')
    link.setAttribute('href', encodeURI(csvContent))
    link.setAttribute('download', `livestock_export_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const validWeightEntries = Object.entries(weightInputs)
    .map(([animal_id, val]) => ({ animal_id, weight_kg: parseFloat(val) }))
    .filter(item => !isNaN(item.weight_kg) && item.weight_kg > 0)

  const parsedSalePrice = parseFloat(salePrice) || 0
  const saleBreakEvenTarget = saleAnimal?.breakEven?.breakEvenToday ?? Number(saleAnimal?.cost_basis || 0)
  const projectedNetPnL = parsedSalePrice - saleBreakEvenTarget

  return (
    <div className="space-y-4">
      {/* Multi-Select Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 bg-green-500 text-slate-950 font-bold text-xs rounded-lg">
              {selectedIds.length} Selected
            </span>
            <span className="text-sm text-slate-300">Apply bulk status change or action:</span>
          </div>

          <form action={bulkUpdateAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="selectedIds" value={JSON.stringify(selectedIds)} />
            <button
              type="submit"
              name="bulkAction"
              value="Sold"
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-xs rounded-lg transition"
            >
              Mark Sold
            </button>
            <button
              type="submit"
              name="bulkAction"
              value="Returned"
              className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white font-semibold text-xs rounded-lg transition"
            >
              Mark Returned
            </button>
            <button
              type="submit"
              name="bulkAction"
              value="Deceased"
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-xs rounded-lg transition"
            >
              Mark Deceased
            </button>
            <button
              type="submit"
              name="bulkAction"
              value="DELETE"
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition"
            >
              Delete Selected
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-slate-400 hover:text-white text-xs"
            >
              Clear
            </button>
          </form>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Search, Filter & Bulk Tools Toolbar */}
        <div className="p-4 sm:p-6 border-b border-slate-100 space-y-3 bg-slate-50/50">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
            <div className="w-full lg:w-80">
              <input
                type="text"
                placeholder="Search by Tag ID, Species, Breed, Client..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-600 transition"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-between lg:justify-end">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterOwnership('All')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    filterOwnership === 'All' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  All Stock
                </button>
                <button
                  type="button"
                  onClick={() => setFilterOwnership('Self')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    filterOwnership === 'Self' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Self Owned
                </button>
                <button
                  type="button"
                  onClick={() => setFilterOwnership('Client')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    filterOwnership === 'Client' ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Palai (Client)
                </button>
              </div>

              <div className="h-5 w-px bg-slate-200 hidden sm:block mx-1"></div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowWeightModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition"
                >
                  ⚖️ Bulk Weigh-In
                </button>
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                >
                  ↑ Bulk CSV Import
                </button>
                <button
                  type="button"
                  onClick={exportFilteredCsv}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 transition"
                >
                  ↓ Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* Species Filter Pills */}
          {speciesOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/70">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
                Species:
              </span>
              <button
                type="button"
                onClick={() => setFilterSpecies('All')}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition ${
                  filterSpecies === 'All'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                All ({animals.length})
              </button>
              {speciesOptions.map(sp => {
                const count = animals.filter(a => a.species === sp).length
                const active = filterSpecies === sp
                return (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setFilterSpecies(sp)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg transition inline-flex items-center gap-1 ${
                      active
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>{getSpeciesEmoji(sp)}</span>
                    <span>{sp}</span>
                    <span className={`text-[10px] ${active ? 'text-emerald-100' : 'text-slate-400'}`}>
                      ({count})
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3.5 text-left w-10">
                  <input
                    type="checkbox"
                    checked={filteredAnimals.length > 0 && selectedIds.length === filteredAnimals.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 accent-green-600 cursor-pointer"
                  />
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Animal / Tag ID</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Species &amp; Breed</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Ownership</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Break-Even (Self)</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Cost Basis</th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {filteredAnimals.length > 0 ? (
                filteredAnimals.map((animal) => {
                  const isChecked = selectedIds.includes(animal.id)
                  const isSelf = animal.ownership === 'Self'
                  const emoji = getSpeciesEmoji(animal.species)

                  return (
                    <tr
                      key={animal.id}
                      className={`transition-colors ${isChecked ? 'bg-green-50/50' : 'hover:bg-slate-50/80'}`}
                    >
                      <td className="px-4 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(animal.id)}
                          className="h-4 w-4 rounded border-slate-300 accent-green-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                            {animal.photo_url ? (
                              <img src={animal.photo_url} alt={animal.tag_id} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xl">{emoji}</span>
                            )}
                          </div>
                          <div>
                            <Link
                              href={`/animals/${animal.id}`}
                              className="font-mono font-semibold text-green-700 hover:text-green-800 hover:underline bg-green-50 px-2.5 py-1 rounded-lg border border-green-200 inline-block"
                            >
                              {animal.tag_id}
                            </Link>
                            <p className="text-[11px] text-slate-400 mt-0.5">{animal.sex}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                          <span>{emoji}</span>
                          <span>{animal.species}</span>
                        </div>
                        {animal.breed_name && <div className="text-xs text-slate-400">{animal.breed_name}</div>}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${
                          isSelf
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          {animal.ownership} {animal.client_name ? `(${animal.client_name})` : ''}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        {isSelf && animal.breakEven ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-900 text-amber-300">
                              Rs. {animal.breakEven.breakEvenToday.toLocaleString()}
                            </span>
                            <div>
                              {animal.breakEven.perKgToday !== null && animal.breakEven.latestWeight ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                  Rs. {animal.breakEven.perKgToday.toLocaleString()}/kg ({animal.breakEven.latestWeight}kg)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                                  No weight log
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${
                          animal.status === 'Sold'
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : animal.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {animal.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                        Rs. {Number(animal.cost_basis || 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-right text-sm font-medium space-x-1.5">
                        {isSelf && animal.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSaleAnimal(animal)
                              setSalePrice(
                                animal.breakEven ? String(animal.breakEven.breakEvenToday) : ''
                              )
                              setSaleNotes('')
                            }}
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition text-xs font-semibold"
                          >
                            💰 Sell
                          </button>
                        )}
                        <Link
                          href={`/animals/${animal.id}/edit`}
                          className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition text-xs font-medium"
                        >
                          Edit
                        </Link>
                        <form action={deleteAction} className="inline-block">
                          <input type="hidden" name="animalId" value={animal.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition text-xs font-medium"
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                    No animals found matching your search or filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Weight Logging Modal */}
      {showWeightModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
              <div>
                <h3 className="text-base font-bold">⚖️ Bulk Shed Weigh-In</h3>
                <p className="text-xs text-slate-300">Enter current weights (KG) for one or more active animals</p>
              </div>
              <button
                type="button"
                disabled={isSavingWeights}
                onClick={() => setShowWeightModal(false)}
                className="text-slate-300 hover:text-white font-bold text-lg"
              >
                ×
              </button>
            </div>

            <form
              action={async (formData) => {
                setIsSavingWeights(true)
                try {
                  await bulkWeightLogAction(formData)
                } finally {
                  setIsSavingWeights(false)
                }
              }}
              className="p-6 space-y-4"
            >
              <input type="hidden" name="weightEntries" value={JSON.stringify(validWeightEntries)} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Weigh-In Date *</label>
                  <input
                    name="recorded_date"
                    type="date"
                    required
                    value={weightDate}
                    onChange={(e) => setWeightDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Batch Notes</label>
                  <input
                    name="notes"
                    type="text"
                    value={weightNotes}
                    onChange={(e) => setWeightNotes(e.target.value)}
                    placeholder="e.g., Weekly Shed Weigh-In"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {activeAnimals.length > 0 ? (
                  activeAnimals.map(a => (
                    <div key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{getSpeciesEmoji(a.species)}</span>
                        <div>
                          <span className="font-mono font-bold text-xs text-slate-900">{a.tag_id}</span>
                          <span className="text-xs text-slate-500 ml-2">
                            {a.species} {a.breed_name ? `(${a.breed_name})` : ''}
                          </span>
                          {a.breakEven?.latestWeight && (
                            <p className="text-[11px] text-slate-400">
                              Last recorded: {a.breakEven.latestWeight} kg
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          placeholder="kg"
                          value={weightInputs[a.id] || ''}
                          onChange={(e) =>
                            setWeightInputs(prev => ({
                              ...prev,
                              [a.id]: e.target.value,
                            }))
                          }
                          className="w-24 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-right text-slate-900 focus:ring-2 focus:ring-green-600"
                        />
                        <span className="text-xs text-slate-400">kg</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="p-6 text-center text-xs text-slate-400">No active animals available.</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-500">
                  <strong>{validWeightEntries.length}</strong> animal weight(s) ready to log
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSavingWeights}
                    onClick={() => setShowWeightModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={validWeightEntries.length === 0 || isSavingWeights}
                    className="px-5 py-2 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-40 transition"
                  >
                    {isSavingWeights
                      ? 'Saving Weights...'
                      : `Save ${validWeightEntries.length} Weight(s)`}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sale / Exit Settlement Modal */}
      {saleAnimal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-emerald-950 text-white">
              <div>
                <h3 className="text-base font-bold">💰 Record Animal Sale &amp; Realized P&amp;L</h3>
                <p className="text-xs text-emerald-200 font-mono">
                  {getSpeciesEmoji(saleAnimal.species)} {saleAnimal.tag_id} • {saleAnimal.species}
                </p>
              </div>
              <button
                type="button"
                disabled={isRecordingSale}
                onClick={() => setSaleAnimal(null)}
                className="text-emerald-200 hover:text-white font-bold text-lg"
              >
                ×
              </button>
            </div>

            <form
              action={async (formData) => {
                setIsRecordingSale(true)
                try {
                  await recordSaleAction(formData)
                } finally {
                  setIsRecordingSale(false)
                }
              }}
              className="p-6 space-y-4"
            >
              <input type="hidden" name="animalId" value={saleAnimal.id} />

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-600">Today&apos;s Break-Even Target:</span>
                <span className="font-mono font-bold text-slate-900">
                  Rs. {saleBreakEvenTarget.toLocaleString()}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Final Sale Price (PKR) *</label>
                <input
                  name="sale_price"
                  type="number"
                  step="1"
                  min="1"
                  required
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder="e.g., 45000"
                  className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {parsedSalePrice > 0 && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
                    projectedNetPnL >= 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <span className="font-semibold">
                    {projectedNetPnL >= 0 ? 'Realized Net Profit:' : 'Realized Net Loss:'}
                  </span>
                  <span className="font-mono font-bold text-sm">
                    {projectedNetPnL >= 0
                      ? `+Rs. ${projectedNetPnL.toLocaleString()}`
                      : `-Rs. ${Math.abs(projectedNetPnL).toLocaleString()}`}
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Sale Date *</label>
                <input
                  name="sale_date"
                  type="date"
                  required
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Buyer / Mandi Notes</label>
                <input
                  name="notes"
                  type="text"
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  placeholder="e.g., Sold to Qurbani buyer / Sohrab Goth Mandi"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isRecordingSale}
                  onClick={() => setSaleAnimal(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={parsedSalePrice <= 0 || isRecordingSale}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 transition"
                >
                  {isRecordingSale ? 'Recording Sale...' : 'Confirm Sale & Close'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Bulk Import Animals via CSV</h3>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => {
                  setShowImportModal(false)
                  setParsedRows([])
                  setCsvError('')
                }}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-800">Step 1: Download Sample Template</p>
                  <p className="text-[11px] text-slate-500">Fill your Mandi purchase or Palai batch in Excel/CSV.</p>
                </div>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={downloadSampleCsv}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition disabled:opacity-40"
                >
                  Download CSV
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Step 2: Upload Filled CSV File</label>
                <input
                  type="file"
                  accept=".csv"
                  disabled={isImporting}
                  onChange={handleCsvFileUpload}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 cursor-pointer disabled:opacity-40"
                />
              </div>

              {csvError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                  {csvError}
                </div>
              )}

              {parsedRows.length > 0 && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                  <p className="text-xs font-semibold text-emerald-800">
                    Ready to import {parsedRows.length} animal record(s):
                  </p>
                  <div className="max-h-32 overflow-y-auto text-xs text-emerald-700 font-mono space-y-1">
                    {parsedRows.map((row, idx) => (
                      <div key={idx}>
                        • {getSpeciesEmoji(row.species)} {row.tag_id || 'Auto-Tag'} — {row.species || 'Goat'} ({row.ownership || 'Self'})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <form
                action={async (formData) => {
                  setIsImporting(true)
                  try {
                    await bulkImportAction(formData)
                  } finally {
                    setIsImporting(false)
                  }
                }}
                className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100"
              >
                <input type="hidden" name="csvRows" value={JSON.stringify(parsedRows)} />
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => {
                    setShowImportModal(false)
                    setParsedRows([])
                    setCsvError('')
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={parsedRows.length === 0 || isImporting}
                  className="px-5 py-2 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-40 transition"
                >
                  {isImporting
                    ? 'Importing...'
                    : `Import ${parsedRows.length > 0 ? `${parsedRows.length} Animals` : ''}`}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}