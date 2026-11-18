import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

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

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; filter?: string }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error
  const filterRole = params.filter || 'All'

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Fetch Contacts for this farm
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .eq('farm_id', farm.id)
    .order('name', { ascending: true })

  // Filter contacts by role
  const filteredContacts = (contacts || []).filter(c => {
    if (filterRole === 'Supplier') return c.role === 'Supplier'
    if (filterRole === 'Client') return c.role === 'Client'
    return true
  })

  // Server Action: Add Contact
  const addContact = async (formData: FormData) => {
    'use server'
    const name = formData.get('name') as string
    const role = formData.get('role') as string
    const phone = formData.get('phone') as string
    const address = formData.get('address') as string
    const opening_balance = formData.get('opening_balance') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()

    const { error } = await supabaseClient.from('contacts').insert([
      {
        farm_id: farm.id,
        name,
        role,
        phone: phone || null,
        address: address || null,
        opening_balance: parseFloat(opening_balance) || 0,
        notes: notes || null,
      },
    ])

    if (error) {
      return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/contacts?msg=${encodeURIComponent('Contact added successfully.')}`)
  }

  // Server Action: Delete Contact
  const deleteContact = async (formData: FormData) => {
    'use server'
    const contactId = formData.get('contactId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('farm_id', farm.id)

    if (error) {
      return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/contacts?msg=${encodeURIComponent('Contact deleted successfully.')}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                Accounts Payable & Receivable Directory
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Suppliers & Clients Directory</h1>
            <p className="text-sm text-slate-500">Manage Feed Dealers, Vet Suppliers, and Palai Boarding Clients</p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/finances"
              className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm"
            >
              ← Back to Finances
            </Link>
          </div>
        </div>

        {/* Feedback Banners */}
        {statusMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Success:</strong> {decodeURIComponent(statusMsg)}</span>
            <Link href="/contacts" className="text-emerald-600 font-bold hover:text-emerald-900">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Error:</strong> {decodeURIComponent(errorMsg)}</span>
            <Link href="/contacts" className="text-red-500 font-bold hover:text-red-800">×</Link>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Contacts Table */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800 text-sm">Directory List</h2>
                <p className="text-[11px] text-slate-400">Total contacts: {contacts?.length || 0}</p>
              </div>

              <div className="flex items-center gap-1.5">
                <Link
                  href="/contacts"
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    filterRole === 'All' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All
                </Link>
                <Link
                  href="/contacts?filter=Supplier"
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    filterRole === 'Supplier' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Suppliers
                </Link>
                <Link
                  href="/contacts?filter=Client"
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    filterRole === 'Client' ? 'bg-purple-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Clients
                </Link>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Name & Role</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Phone / Address</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Balance / Udhaar</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Notes</th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredContacts.length > 0 ? (
                    filteredContacts.map((c) => {
                      const isSupplier = c.role === 'Supplier'
                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-4 whitespace-nowrap">
                            <p className="text-xs font-bold text-slate-900">{c.name}</p>
                            <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md mt-1 ${
                              isSupplier ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
                            }`}>
                              {c.role}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <p className="text-xs font-mono font-medium text-slate-700">{c.phone || '—'}</p>
                            <p className="text-[11px] text-slate-400 truncate max-w-xs">{c.address || '—'}</p>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap text-xs font-mono font-bold text-slate-800">
                            Rs. {Number(c.opening_balance || 0).toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-xs text-slate-500 max-w-xs truncate">{c.notes || '—'}</td>
                          <td className="px-5 py-4 whitespace-nowrap text-right">
                            <form action={deleteContact} className="inline-block">
                              <input type="hidden" name="contactId" value={c.id} />
                              <button
                                type="submit"
                                className="px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium transition"
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
                      <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400">
                        No contacts added yet. Register your first supplier or client.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Contact Form */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 h-fit space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Add New Contact</h2>
              <p className="text-xs text-slate-500 mt-0.5">Register a Feed Dealer, Vet Supplier or Palai Client</p>
            </div>

            <form action={addContact} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Contact Name *</label>
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="e.g. Yousuf Bhai (Feed Dealer)"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role / Type *</label>
                <select
                  name="role"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600"
                >
                  <option value="Supplier">Supplier (Feed / Vet / Services)</option>
                  <option value="Client">Client (Palai Boarding Owner)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Phone Number</label>
                <input
                  name="phone"
                  type="text"
                  placeholder="e.g. 0300-1234567"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Address / Location</label>
                <input
                  name="address"
                  type="text"
                  placeholder="e.g. Sohrab Goth Mandi, Karachi"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Opening Balance / Udhaar (PKR)</label>
                <input
                  name="opening_balance"
                  type="number"
                  step="1"
                  defaultValue="0"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes (Optional)</label>
                <input
                  name="notes"
                  type="text"
                  placeholder="e.g. Delivers feed on weekly credit"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition font-semibold text-sm shadow-sm"
              >
                Save Contact
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}