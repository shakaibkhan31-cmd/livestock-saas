'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

function formatDateDDMMYYYY(dateInput?: string | null): string {
  if (!dateInput) return 'N/A'
  const datePart = String(dateInput).split('T')[0]
  const parts = datePart.split('-')
  if (parts.length === 3) {
    const [year, month, day] = parts
    return `${day}/${month}/${year}`
  }
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 'N/A'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

export default function AnimalStatementPage() {
  const params = useParams()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [farm, setFarm] = useState<{ farm_name: string } | null>(null)
  const [animal, setAnimal] = useState<any>(null)
  const [weightLogs, setWeightLogs] = useState<any[]>([])
  const [financialLogs, setFinancialLogs] = useState<any[]>([])

  useEffect(() => {
    async function fetchData() {
      if (!id) return
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = '/login'
        return
      }

      const { data: farmData } = await supabase
        .from('farms')
        .select('id, farm_name')
        .eq('owner_id', user.id)
        .single()

      if (!farmData) {
        window.location.href = '/onboarding'
        return
      }
      setFarm(farmData)

      const { data: animalData } = await supabase
        .from('livestock_master')
        .select('*')
        .eq('id', id)
        .eq('farm_id', farmData.id)
        .single()

      if (!animalData) {
        window.location.href = '/animals'
        return
      }
      setAnimal(animalData)

      const { data: weights } = await supabase
        .from('animal_weight_logs')
        .select('*')
        .eq('animal_id', id)
        .order('recorded_date', { ascending: false })
      setWeightLogs(weights || [])

      const { data: financials } = await supabase
        .from('animal_financial_logs')
        .select('*')
        .eq('animal_id', id)
        .order('transaction_date', { ascending: false })
      setFinancialLogs(financials || [])

      setLoading(false)
    }

    fetchData()
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-slate-500 text-sm font-mono">
        Loading Official Statement...
      </div>
    )
  }

  const latestWeight = weightLogs.length > 0 ? Number(weightLogs[0].weight_kg) : null
  const initialWeight = weightLogs.length > 0 ? Number(weightLogs[weightLogs.length - 1].weight_kg) : null
  const netGain = latestWeight !== null && initialWeight !== null ? (latestWeight - initialWeight).toFixed(1) : null

  const purchaseCost = Number(animal?.cost_basis || 0)
  const loggedExpenses = financialLogs
    .filter(f => f.entry_type === 'Expense')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0)
  const loggedRevenue = financialLogs
    .filter(f => f.entry_type === 'Revenue')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0)

  const totalCostOutflow = (animal?.ownership === 'Self' ? purchaseCost : 0) + loggedExpenses
  const netPnL = loggedRevenue - totalCostOutflow

  return (
    <div className="min-h-screen bg-white text-slate-900 p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b pb-4 print:hidden">
        <Link href={`/animals/${id}`} className="text-sm font-semibold text-indigo-600 hover:underline">
          &larr; Back to Live Profile
        </Link>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold shadow hover:bg-slate-800 transition"
        >
          🖨️ Print / Save as PDF
        </button>
      </div>

      <div className="text-center border-b-2 border-slate-900 pb-6 space-y-1">
        <h1 className="text-3xl font-extrabold uppercase tracking-wider">{farm?.farm_name}</h1>
        <p className="text-sm text-slate-500 uppercase tracking-widest font-semibold">Official Animal Statement & Audit Report</p>
        <p className="text-xs font-mono text-slate-400">Generated on: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm">
        <div>
          <p className="text-slate-500">Tag ID: <strong className="text-slate-900 font-mono text-base">{animal?.tag_id}</strong></p>
          <p className="text-slate-500">Species / Breed: <strong className="text-slate-900">{animal?.species} {animal?.breed_name ? `• ${animal.breed_name}` : ''}</strong></p>
          <p className="text-slate-500">Sex: <strong className="text-slate-900">{animal?.sex}</strong></p>
        </div>
        <div>
          <p className="text-slate-500">Ownership: <strong className="text-slate-900">{animal?.ownership === 'Self' ? 'Farm Owned' : `Palai Client (${animal?.client_name})`}</strong></p>
          <p className="text-slate-500">Onboarding Date: <strong className="text-slate-900 font-mono">{formatDateDDMMYYYY(animal?.acquisition_date)}</strong></p>
          <p className="text-slate-500">Status: <strong className="text-emerald-700">{animal?.status}</strong></p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="p-4 bg-slate-100 rounded-xl border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Latest Weight</p>
          <p className="text-xl font-bold font-mono text-slate-900 mt-1">{latestWeight !== null ? `${latestWeight} kg` : 'N/A'}</p>
        </div>
        <div className="p-4 bg-slate-100 rounded-xl border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Net Weight Gain</p>
          <p className="text-xl font-bold font-mono text-emerald-700 mt-1">{netGain !== null ? `${netGain} kg` : 'N/A'}</p>
        </div>
        <div className="p-4 bg-slate-100 rounded-xl border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Net P&L (Profit/Loss)</p>
          <p className={`text-xl font-bold font-mono mt-1 ${netPnL >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            Rs. {netPnL.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-bold text-base text-slate-900">Financial Ledger</h3>
        <table className="min-w-full divide-y divide-slate-200 border text-xs">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Date</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Category</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Amount (PKR)</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {animal?.ownership === 'Self' && (
              <tr>
                <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(animal?.acquisition_date)}</td>
                <td className="px-3 py-2 font-semibold text-rose-600">Expense</td>
                <td className="px-3 py-2">Cost Basis / Purchase</td>
                <td className="px-3 py-2 font-mono font-bold">- Rs. {purchaseCost.toLocaleString()}</td>
                <td className="px-3 py-2">Initial Acquisition</td>
              </tr>
            )}
            {financialLogs.map(f => (
              <tr key={f.id}>
                <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(f.transaction_date)}</td>
                <td className={`px-3 py-2 font-semibold ${f.entry_type === 'Revenue' ? 'text-emerald-700' : 'text-rose-600'}`}>{f.entry_type}</td>
                <td className="px-3 py-2">{f.category}</td>
                <td className={`px-3 py-2 font-mono font-bold ${f.entry_type === 'Revenue' ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {f.entry_type === 'Revenue' ? '+' : '-'} Rs. {Number(f.amount).toLocaleString()}
                </td>
                <td className="px-3 py-2">{f.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 pt-4">
        <h3 className="font-bold text-base text-slate-900">Weight Progression History</h3>
        <table className="min-w-full divide-y divide-slate-200 border text-xs">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Date</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Weight (KG)</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {weightLogs.map(w => (
              <tr key={w.id}>
                <td className="px-3 py-2 font-mono">{formatDateDDMMYYYY(w.recorded_date)}</td>
                <td className="px-3 py-2 font-mono font-bold text-slate-900">{w.weight_kg} kg</td>
                <td className="px-3 py-2">{w.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pt-8 text-center text-xs text-slate-400 border-t mt-12">
        <p>{farm?.farm_name} • Certified Livestock Management ERP Statement</p>
      </div>
    </div>
  )
}