import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function FinancesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Fetch Financial Transactions for this farm
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('farm_id', farm.id)
    .order('txn_date', { ascending: false })

  // Calculate Totals
  const totalIncome = transactions
    ?.filter((t) => t.type === 'Income')
    .reduce((acc, t) => acc + Number(t.amount), 0) || 0

  const totalExpense = transactions
    ?.filter((t) => t.type === 'Expense')
    .reduce((acc, t) => acc + Number(t.amount), 0) || 0

  const netBalance = totalIncome - totalExpense

  // Server Action to Add Transaction
  const addTransaction = async (formData: FormData) => {
    'use server'
    const type = formData.get('type') as string
    const category = formData.get('category') as string
    const amount = formData.get('amount') as string
    const txn_date = formData.get('txn_date') as string
    const description = formData.get('description') as string

    const supabaseClient = await createClient()

    await supabaseClient.from('transactions').insert([
      {
        farm_id: farm.id,
        type,
        category,
        amount: parseFloat(amount),
        txn_date: txn_date || new Date().toISOString().split('T')[0],
        description: description || null,
      },
    ])
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <Link href="/animals" className="text-green-600 hover:underline font-medium">
              &larr; Back to Livestock Master
            </Link>
            <h1 className="text-3xl font-bold text-gray-800 mt-2">Financial Ledger & Billing</h1>
            <p className="text-gray-500">Track farm income, boarding dues, and operational expenses</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
            <p className="text-sm text-gray-500 font-medium">Total Income</p>
            <p className="text-2xl font-bold text-green-600">Rs. {totalIncome.toLocaleString()}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
            <p className="text-sm text-gray-500 font-medium">Total Expenses</p>
            <p className="text-2xl font-bold text-red-600">Rs. {totalExpense.toLocaleString()}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
            <p className="text-sm text-gray-500 font-medium">Net Profit / Balance</p>
            <p className={`text-2xl font-bold ${netBalance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
              Rs. {netBalance.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Transactions Table */}
          <div className="md:col-span-2 bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Transaction History</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions && transactions.length > 0 ? (
                    transactions.map((txn) => (
                      <tr key={txn.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{txn.txn_date}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full font-semibold ${txn.type === 'Income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {txn.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{txn.category}</td>
                        <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${txn.type === 'Income' ? 'text-green-600' : 'text-red-600'}`}>
                          {txn.type === 'Income' ? '+' : '-'} Rs. {txn.amount}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{txn.description || '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                        No transactions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Transaction Form */}
          <div className="bg-white rounded-lg shadow p-6 h-fit">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Add Transaction</h2>
            <form action={addTransaction} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  name="type"
                  required
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                >
                  <option value="Income">Income (Aamdani)</option>
                  <option value="Expense">Expense (Kharcha)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  name="category"
                  type="text"
                  required
                  placeholder="e.g. Boarding Fee, Feed Purchase, Vet/Med"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR)</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 5000"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  name="txn_date"
                  type="date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                <input
                  name="description"
                  type="text"
                  placeholder="e.g. Received monthly boarding for Tag G-01"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition font-medium text-sm mt-2"
              >
                Save Transaction
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}