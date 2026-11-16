'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Animal {
  id: string
  tag_id: string
  species: string
  breed_name?: string
  ownership: string
  client_name?: string
  sex: string
  status: string
  cost_basis: number
  photo_url?: string
}

interface AnimalsClientViewProps {
  animals: Animal[]
  deleteAction: (formData: FormData) => Promise<void>
}

export default function AnimalsClientView({ animals, deleteAction }: AnimalsClientViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterOwnership, setFilterOwnership] = useState('All')

  const filteredAnimals = animals.filter(animal => {
    const matchesSearch = 
      animal.tag_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      animal.species.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (animal.breed_name && animal.breed_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (animal.client_name && animal.client_name.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesOwnership = filterOwnership === 'All' || animal.ownership === filterOwnership

    return matchesSearch && matchesOwnership
  })

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      
      {/* Search & Filter Bar */}
      <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
        <div className="w-full sm:w-80">
          <input
            type="text"
            placeholder="Search by Tag ID, Species, Breed, Client..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-600 transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={() => setFilterOwnership('All')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              filterOwnership === 'All' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            All Stock
          </button>
          <button
            onClick={() => setFilterOwnership('Self')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              filterOwnership === 'Self' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Self Owned
          </button>
          <button
            onClick={() => setFilterOwnership('Client')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              filterOwnership === 'Client' ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Palai (Client)
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Animal / Tag ID</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Species & Breed</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Ownership</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Sex</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Cost Basis (PKR)</th>
              <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {filteredAnimals.length > 0 ? (
              filteredAnimals.map((animal) => (
                <tr key={animal.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                        {animal.photo_url ? (
                          <img src={animal.photo_url} alt={animal.tag_id} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-base">🐐</span>
                        )}
                      </div>
                      <Link 
                        href={`/animals/${animal.id}`}
                        className="font-mono font-semibold text-green-700 hover:text-green-800 hover:underline bg-green-50 px-2.5 py-1 rounded-lg border border-green-200 inline-block"
                      >
                        {animal.tag_id}
                      </Link>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-slate-800">{animal.species}</div>
                    {animal.breed_name && <div className="text-xs text-slate-400">{animal.breed_name}</div>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${
                      animal.ownership === 'Self' 
                        ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                        : 'bg-purple-50 text-purple-700 border border-purple-200'
                    }`}>
                      {animal.ownership} {animal.client_name ? `(${animal.client_name})` : ''}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{animal.sex}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {animal.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                    Rs. {Number(animal.cost_basis || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <Link
                      href={`/animals/${animal.id}/edit`}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition text-xs font-medium"
                    >
                      Edit
                    </Link>
                    <form action={deleteAction} className="inline-block">
                      <input type="hidden" name="animalId" value={animal.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center px-3 py-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition text-xs font-medium"
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                  No animals found matching your search or filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  )
}