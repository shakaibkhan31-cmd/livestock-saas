import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function FeedManagementPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Fetch Feed Logs for this farm
  const { data: feedLogs } = await supabase
    .from('feed_logs')
    .select('*')
    .eq('farm_id', farm.id)
    .order('log_date', { ascending: false })

  // Server Action to Add Feed Log
  const addFeedLog = async (formData: FormData) => {
    'use server'
    const feed_type = formData.get('feed_type') as string
    const quantity_kg = formData.get('quantity_kg') as string
    const total_cost = formData.get('total_cost') as string
    const log_date = formData.get('log_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    await supabaseClient.from('feed_logs').insert([
      {
        farm_id: farm.id,
        feed_type,
        quantity_kg: parseFloat(quantity_kg),
        total_cost: total_cost ? parseFloat(total_cost) : 0,
        log_date: log_date || new Date().toISOString().split('T')[0],
        notes: notes || null,
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
            <h1 className="text-3xl font-bold text-gray-800 mt-2">Feed Management & Logs</h1>
            <p className="text-gray-500">Track daily feed consumption and formulation costs</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Feed Logs Table */}
          <div className="md:col-span-2 bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Feed Consumption History</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Feed Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Qty (KG)</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total Cost (PKR)</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {feedLogs && feedLogs.length > 0 ? (
                    feedLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{log.log_date}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{log.feed_type}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{log.quantity_kg} kg</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">Rs. {log.total_cost}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{log.notes || '-'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                        No feed logs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Feed Log Form */}
          <div className="bg-white rounded-lg shadow p-6 h-fit">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Log Feed Consumption</h2>
            <form action={addFeedLog} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Feed Type / Formulation</label>
                <input
                  name="feed_type"
                  type="text"
                  required
                  placeholder="e.g. Wheat Bran, Wada, Mixed Concentrate"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (KG)</label>
                <input
                  name="quantity_kg"
                  type="number"
                  step="0.1"
                  required
                  placeholder="e.g. 25"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Cost (PKR)</label>
                <input
                  name="total_cost"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 1500"
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Log Date</label>
                <input
                  name="log_date"
                  type="date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                <input
                  name="notes"
                  type="text"
                  placeholder="e.g. Combined total for 3 animals"
                className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition font-medium text-sm mt-2"
              >
                Save Feed Log
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}