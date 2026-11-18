import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

// Helper: Format Pakistani Phone Number to International WhatsApp Format (923XXXXXXXXX)
function formatWhatsAppNumber(phone?: string | null): string | null {
  if (!phone) return null
  // Remove spaces, dashes, brackets, plus signs
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, '')
  if (!cleaned) return null

  // Convert local 03XXXXXXXXX to 923XXXXXXXXX
  if (cleaned.startsWith('03') && cleaned.length === 11) {
    cleaned = '92' + cleaned.slice(1)
  } else if (cleaned.startsWith('3') && cleaned.length === 10) {
    cleaned = '92' + cleaned
  }

  return cleaned.length >= 11 ? cleaned : null
}

// Helper: Generate Dynamic Pre-filled WhatsApp Message
function buildWhatsAppUrl(contact: any, farmName: string): string | null {
  const waNumber = formatWhatsAppNumber(contact.phone)
  if (!waNumber) return null

  const balance = Number(contact.opening_balance || 0)
  let message = ''

  if (contact.role === 'Client') {
    if (balance > 0) {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nHope you are doing well. This is a friendly reminder from *${farmName}* regarding your Palai boarding account.\n\n*Pending / Due Balance:* Rs. ${balance.toLocaleString()}\n\nPlease share the payment confirmation once transferred. JazakAllah!`
    } else {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nGreetings from *${farmName}*. Sharing a quick update regarding your livestock boarding with us. Let us know if you need the latest weight & health statement.\n\nJazakAllah!`
    }
  } else {
    // Supplier Message
    if (balance < 0) {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nThis is *${farmName}*. Reaching out regarding our ledger balance of *Rs. ${Math.abs(balance).toLocaleString()}* and upcoming feed/supply requirements. Please confirm availability.\n\nShukriya!`
    } else {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nThis is *${farmName}*. We need to place an order / check rates for our farm supplies. Please share your updated rate list.\n\nShukriya!`
    }
  }

  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`
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

  // Summary Totals for Receivable & Payable
  const totalClientDues = (contacts || [])
    .filter(c => c.role === 'Client' && Number(c.opening_balance || 0) > 0)
    .reduce((sum, c) => sum + Number(c.opening_balance || 0), 0)

  const totalSupplierPayable = (contacts || [])
    .filter(c => c.role === 'Supplier' && Number(c.opening_balance || 0) < 0)
    .reduce((sum, c) => sum + Math.abs(Number(c.opening_balance || 0)), 0)

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

  // Server Action: Update Contact Balance (Quick Settle / Update Dues)
  const updateBalance = async (formData: FormData) => {
    'use server'
    const contactId = formData.get('contactId') as string
    const newBalance = formData.get('newBalance') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('contacts')
      .update({ opening_balance: parseFloat(newBalance) || 0 })
      .eq('id', contactId)
      .eq('farm_id', farm.id)

    if (error) {
      return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    }

    return redirect(`/contacts?msg=${encodeURIComponent('Balance updated successfully.')}`)
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
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                WhatsApp Reminders & Ledger Directory
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Suppliers & Clients Directory</h1>
            <p className="text-sm text-slate-500">Manage Feed Dealers, Palai Clients & send 1-click WhatsApp payment reminders</p>
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

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-purple-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Palai Client Receivables (Lena)</p>
            <p className="text-2xl font-bold text-purple-700 font-mono mt-1">Rs. {totalClientDues.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-rose-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Supplier Payables (Dena)</p>
            <p className="text-2xl font-bold text-rose-600 font-mono mt-1">Rs. {totalSupplierPayable.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-emerald-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Registered Contacts</p>
            <p className="text-2xl font-bold text-slate-900 font-mono mt-1">{contacts?.length || 0}</p>
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
                <p className="text-[11px] text-slate-400">Click WhatsApp to send instant reminder or order message</p>
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
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Phone / Location</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Balance (PKR)</th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase">WhatsApp & Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredContacts.length > 0 ? (
                    filteredContacts.map((c) => {
                      const isSupplier = c.role === 'Supplier'
                      const bal = Number(c.opening_balance || 0)
                      const whatsappUrl = buildWhatsAppUrl(c, farm.farm_name)

                      return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-4 whitespace-nowrap">
                            <p className="text-xs font-bold text-slate-900">{c.name}</p>
                            <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md mt-1 ${
                              isSupplier ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
                            }`}>
                              {c.role}
                            </span>
                            {c.notes && <p className="text-[11px] text-slate-400 mt-1 max-w-[180px] truncate">{c.notes}</p>}
                          </td>

                          <td className="px-5 py-4">
                            <p className="text-xs font-mono font-medium text-slate-700">{c.phone || '—'}</p>
                            <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{c.address || '—'}</p>
                          </td>

                          <td className="px-5 py-4 whitespace-nowrap">
                            <form action={updateBalance} className="flex items-center gap-1.5">
                              <input type="hidden" name="contactId" value={c.id} />
                              <input
                                name="newBalance"
                                type="number"
                                step="1"
                                defaultValue={bal}
                                className={`w-24 px-2 py-1 text-xs font-mono font-bold border rounded-lg ${
                                  bal > 0
                                    ? 'text-emerald-700 bg-emerald-50/50 border-emerald-200'
                                    : bal < 0
                                    ? 'text-rose-700 bg-rose-50/50 border-rose-200'
                                    : 'text-slate-700 bg-slate-50 border-slate-200'
                                }`}
                              />
                              <button
                                type="submit"
                                title="Update Balance"
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition"
                              >
                                Save
                              </button>
                            </form>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {bal > 0 ? 'Receivable (Lena)' : bal < 0 ? 'Payable (Dena)' : 'Settled'}
                            </p>
                          </td>

                          <td className="px-5 py-4 whitespace-nowrap text-right space-x-2">
                            {whatsappUrl ? (
                              <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition"
                              >
                                💬 WhatsApp
                              </a>
                            ) : (
                              <span
                                title="Add valid mobile number (e.g. 03001234567) to enable WhatsApp"
                                className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-medium cursor-not-allowed"
                              >
                                No Phone
                              </span>
                            )}

                            <form action={deleteContact} className="inline-block">
                              <input type="hidden" name="contactId" value={c.id} />
                              <button
                                type="submit"
                                className="px-2.5 py-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium transition"
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
                      <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-400">
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
                  placeholder="e.g. Rohan (Palai Client)"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role / Type *</label>
                <select
                  name="role"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="Client">Client (Palai Boarding Owner)</option>
                  <option value="Supplier">Supplier (Feed / Vet / Services)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">WhatsApp Mobile Number</label>
                <input
                  name="phone"
                  type="text"
                  placeholder="e.g. 0300-1234567"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Address / Location</label>
                <input
                  name="address"
                  type="text"
                  placeholder="e.g. DHA / Clifton, Karachi"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Balance (PKR) [+ Lena / - Dena]</label>
                <input
                  name="opening_balance"
                  type="number"
                  step="1"
                  defaultValue="0"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes (Optional)</label>
                <input
                  name="notes"
                  type="text"
                  placeholder="e.g. Tag G-04 Palai Owner"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition font-semibold text-sm shadow-sm"
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