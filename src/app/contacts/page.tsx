import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import { daysBetweenDateStrings } from '@/utils/breakeven'
import { getPakistanDateString, isActiveStatus, isSelfOwnership, isVoidText } from '@/utils/financesHelpers'

// ---------- Helpers ----------
function formatWhatsAppNumber(phone?: string | null): string | null {
  if (!phone) return null
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('0092')) cleaned = cleaned.slice(2)
  if (cleaned.startsWith('92') && cleaned.length === 12) return cleaned
  if (cleaned.startsWith('03') && cleaned.length === 11) cleaned = '92' + cleaned.slice(1)
  else if (cleaned.startsWith('3') && cleaned.length === 10) cleaned = '92' + cleaned
  return cleaned.length === 12 ? cleaned : null
}

function buildWhatsAppUrl(contact: any, farmName: string, liveBalance: number): string | null {
  const waNumber = formatWhatsAppNumber(contact.phone)
  if (!waNumber) return null
  const balance = Number(liveBalance || 0)
  let message = ''
  if (contact.role === 'Client') {
    if (balance > 0) {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nHope you are doing well. This is a friendly reminder from *${farmName}* regarding your Palai boarding account.\n\n*Pending / Due Balance:* Rs. ${balance.toLocaleString()}\n\nPlease share the payment confirmation once transferred. JazakAllah!`
    } else {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nGreetings from *${farmName}*. Sharing a quick update regarding your livestock boarding with us. Let us know if you need the latest weight & health statement.\n\nJazakAllah!`
    }
  } else {
    if (balance < 0) {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nThis is *${farmName}*. Reaching out regarding our ledger balance of *Rs. ${Math.abs(balance).toLocaleString()}* and upcoming feed/supply requirements. Please confirm availability.\n\nShukriya!`
    } else {
      message = `Assalam-o-Alaikum *${contact.name}*,\n\nThis is *${farmName}*. We need to place an order / check rates for our farm supplies. Please share your updated rate list.\n\nShukriya!`
    }
  }
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`
}

async function requireAdmin() {
  const { farm, role } = await getUserFarmAndRole()
  if (!farm) return redirect('/onboarding')
  if (role !== 'admin') {
    return redirect('/contacts?error=' + encodeURIComponent('Access denied: admin permission required.'))
  }
  return { farm, role }
}

// ---------- Page ----------
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string; filter?: string; q?: string; page?: string; due?: string; editId?: string }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error
  const filterRole = params.filter || 'All'
  const searchQ = (params.q || '').trim().toLowerCase()
  const dueFilter = params.due || 'All'
  const editId = params.editId || ''
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const PAGE_SIZE = 20

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { farm } = await getUserFarmAndRole()
  if (!farm) return redirect('/onboarding')

  const todayStr = getPakistanDateString()

  // Fetch contacts + Palai animals + Palai logs (for live due)
  const [{ data: contacts }, { data: palaiAnimals }, { data: palaiLogs }] = await Promise.all([
    supabase.from('contacts').select('*').eq('farm_id', farm.id).order('name', { ascending: true }),
    supabase.from('livestock_master').select('id, client_name, monthly_palai_fee, acquisition_date, status, ownership').eq('farm_id', farm.id),
    supabase.from('animal_financial_logs').select('animal_id, entry_type, category, amount, notes, transaction_date').eq('farm_id', farm.id),
  ])

  const activePalaiAnimals = (palaiAnimals || []).filter(
    (a: any) => isActiveStatus(a.status) && !isSelfOwnership(a.ownership)
  )

  // Map client_name -> active Palai animals & compute exact due using PalaiStockTab 30-day advance block formula
  const palaiAnimalsByClient: Record<string, any[]> = {}
  activePalaiAnimals.forEach((a: any) => {
    const key = String(a.client_name || '').trim().toLowerCase()
    if (!key) return
    if (!palaiAnimalsByClient[key]) palaiAnimalsByClient[key] = []
    palaiAnimalsByClient[key].push(a)
  })

  const palaiDueByClient: Record<string, number> = {}
  Object.entries(palaiAnimalsByClient).forEach(([key, clientAnimals]) => {
    const clientTotalDue = clientAnimals.reduce((clientSum: number, a: any) => {
      const rate = Number(a.monthly_palai_fee) > 0 ? Number(a.monthly_palai_fee) : 5000
      const acqStr = a.acquisition_date ? String(a.acquisition_date).split('T')[0] : todayStr
      const daysBoarded = Math.max(1, daysBetweenDateStrings(acqStr, todayStr, 1))
      // BUSINESS RULE: Palai is billed in non-refundable 30-day advance blocks.
      const billedMonths = Math.max(1, Math.ceil(daysBoarded / 30))
      const accruedBoarding = rate * billedMonths

      const animalRevenueLogs = (palaiLogs || []).filter(
        (f: any) => f.animal_id === a.id && f.entry_type === 'Revenue' && !isVoidText(f.notes)
      )

      const autoBilledRevenue = animalRevenueLogs
        .filter((f: any) => String(f.notes || '').startsWith('Auto-Bill'))
        .reduce((sum: number, f: any) => sum + (Number(f.amount) || 0), 0)

      const totalRevenueRecorded = animalRevenueLogs.reduce(
        (sum: number, f: any) => sum + (Number(f.amount) || 0),
        0
      )

      const totalBilled = Math.max(accruedBoarding, autoBilledRevenue)
      const totalPaid = Math.max(0, totalRevenueRecorded - autoBilledRevenue)
      const balanceDue = Math.max(0, totalBilled - totalPaid)

      return clientSum + balanceDue
    }, 0)

    palaiDueByClient[key] = clientTotalDue
  })

  // Attach live balance + animal count to each contact
  const withLive = (contacts || []).map((c: any) => {
    const opening = Number(c.opening_balance || 0)
    const key = String(c.name || '').trim().toLowerCase()
    const clientAnimals = palaiAnimalsByClient[key] || []
    const animalCount = clientAnimals.length
    let liveBalance = opening
    let palaiDue = 0
    if (c.role === 'Client') {
      palaiDue = palaiDueByClient[key] || 0
      liveBalance = animalCount > 0 ? palaiDue : opening
    }
    return { ...c, openingBalance: opening, liveBalance, palaiDue, animalCount }
  })

  // Filters: role + search + due
  let filtered = withLive.filter((c: any) => {
    if (filterRole === 'Supplier' && c.role !== 'Supplier') return false
    if (filterRole === 'Client' && c.role !== 'Client') return false
    if (searchQ) {
      const hay = `${c.name || ''} ${c.phone || ''} ${c.address || ''}`.toLowerCase()
      if (!hay.includes(searchQ)) return false
    }
    if (dueFilter === 'Due' && !(Number(c.liveBalance || 0) !== 0)) return false
    if (dueFilter === 'Settled' && Number(c.liveBalance || 0) !== 0) return false
    if (dueFilter === 'Advance' && !(Number(c.liveBalance || 0) < 0 && c.role === 'Client') && !(Number(c.liveBalance || 0) > 0 && c.role === 'Supplier')) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Summary totals — LIVE balance, advances included separately
  const totalClientDues = withLive.filter((c: any) => c.role === 'Client' && Number(c.liveBalance || 0) > 0).reduce((s: number, c: any) => s + Number(c.liveBalance || 0), 0)
  const totalClientAdvance = withLive.filter((c: any) => c.role === 'Client' && Number(c.liveBalance || 0) < 0).reduce((s: number, c: any) => s + Math.abs(Number(c.liveBalance || 0)), 0)
  const totalSupplierPayable = withLive.filter((c: any) => c.role === 'Supplier' && Number(c.liveBalance || 0) < 0).reduce((s: number, c: any) => s + Math.abs(Number(c.liveBalance || 0)), 0)
  const totalSupplierAdvance = withLive.filter((c: any) => c.role === 'Supplier' && Number(c.liveBalance || 0) > 0).reduce((s: number, c: any) => s + Number(c.liveBalance || 0), 0)

  const editContactRow = editId ? withLive.find((c: any) => c.id === editId) : null

  // ---------- Server Actions ----------
  const addContact = async (formData: FormData) => {
    'use server'
    const { farm } = await requireAdmin()
    const name = String(formData.get('name') || '').trim()
    const role = String(formData.get('role') || '')
    const phone = String(formData.get('phone') || '').trim()
    const address = String(formData.get('address') || '').trim()
    const opening_balance = String(formData.get('opening_balance') || '0')
    const notes = String(formData.get('notes') || '').trim()

    if (!name) return redirect('/contacts?error=' + encodeURIComponent('Name zaroori hai.'))
    if (role !== 'Client' && role !== 'Supplier') return redirect('/contacts?error=' + encodeURIComponent('Role galat hai.'))
    if (phone) {
      const wa = formatWhatsAppNumber(phone)
      if (!wa) return redirect('/contacts?error=' + encodeURIComponent('Phone galat hai. 0300-1234567 jaisa likhein.'))
    }

    const supabaseClient = await createClient()
    // Duplicate phone check
    if (phone) {
      const { data: dup } = await supabaseClient.from('contacts').select('id').eq('farm_id', farm.id).eq('phone', phone).maybeSingle()
      if (dup) return redirect('/contacts?error=' + encodeURIComponent('Ye phone pehle se maujood hai.'))
    }
    const { error } = await supabaseClient.from('contacts').insert([{ farm_id: farm.id, name, role, phone: phone || null, address: address || null, opening_balance: parseFloat(opening_balance) || 0, notes: notes || null }])
    if (error) return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    return redirect('/contacts?msg=' + encodeURIComponent('Contact added successfully.'))
  }

  const updateContact = async (formData: FormData) => {
    'use server'
    const { farm } = await requireAdmin()
    const contactId = String(formData.get('contactId') || '')
    const name = String(formData.get('name') || '').trim()
    const phone = String(formData.get('phone') || '').trim()
    const address = String(formData.get('address') || '').trim()
    const notes = String(formData.get('notes') || '').trim()
    if (!contactId || !name) return redirect('/contacts?error=' + encodeURIComponent('Name zaroori hai.'))
    if (phone && !formatWhatsAppNumber(phone)) return redirect('/contacts?error=' + encodeURIComponent('Phone galat hai.'))
    const supabaseClient = await createClient()
    const { error } = await supabaseClient.from('contacts').update({ name, phone: phone || null, address: address || null, notes: notes || null }).eq('id', contactId).eq('farm_id', farm.id)
    if (error) return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    return redirect('/contacts?msg=' + encodeURIComponent('Contact updated successfully.'))
  }

  const updateBalance = async (formData: FormData) => {
    'use server'
    const { farm } = await requireAdmin()
    const contactId = String(formData.get('contactId') || '')
    const newBalance = parseFloat(String(formData.get('newBalance') || '0')) || 0
    const supabaseClient = await createClient()
    const { data: old } = await supabaseClient.from('contacts').select('opening_balance, notes, name').eq('id', contactId).eq('farm_id', farm.id).maybeSingle()
    if (!old) return redirect('/contacts?error=' + encodeURIComponent('Contact nahi mila.'))
    // Audit: old balance ko notes me save karo, overwrite ka record rahe
    const audit = `[Balance ${new Date().toISOString().slice(0, 10)}: ${Number(old.opening_balance || 0)} -> ${newBalance}]`
    const nextNotes = old.notes ? `${old.notes} | ${audit}` : audit
    const { error } = await supabaseClient.from('contacts').update({ opening_balance: newBalance, notes: nextNotes }).eq('id', contactId).eq('farm_id', farm.id)
    if (error) return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    return redirect('/contacts?msg=' + encodeURIComponent('Balance updated successfully.'))
  }

  const deleteContact = async (formData: FormData) => {
    'use server'
    const { farm } = await requireAdmin()
    const contactId = String(formData.get('contactId') || '')
    const supabaseClient = await createClient()
    const { data: row } = await supabaseClient.from('contacts').select('id, name, role').eq('id', contactId).eq('farm_id', farm.id).maybeSingle()
    if (!row) return redirect('/contacts?error=' + encodeURIComponent('Contact nahi mila.'))
    // Guard: Palai animals linked hain to delete roko
    const { data: linked } = await supabaseClient.from('livestock_master').select('id').eq('farm_id', farm.id).ilike('client_name', row.name).limit(1)
    if (linked && linked.length > 0) {
      return redirect('/contacts?error=' + encodeURIComponent(`Delete nahi ho sakta — ${row.name} ke Palai animals linked hain. Pehle unka client badlo ya animals transfer karo.`))
    }
    const { error } = await supabaseClient.from('contacts').delete().eq('id', contactId).eq('farm_id', farm.id)
    if (error) return redirect(`/contacts?error=${encodeURIComponent(error.message)}`)
    return redirect('/contacts?msg=' + encodeURIComponent('Contact deleted successfully.'))
  }

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ filter: filterRole, q: params.q || '', due: dueFilter, page: String(safePage) })
    Object.entries(extra).forEach(([k, v]) => p.set(k, v))
    return `/contacts?${p.toString()}`
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">WhatsApp Reminders & Ledger Directory</span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Suppliers & Clients Directory</h1>
            <p className="text-sm text-slate-500">Manage Feed Dealers, Palai Clients & send 1-click WhatsApp payment reminders</p>
          </div>
          <Link href="/finances" className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm">← Back to Finances</Link>
        </div>

        {/* KPI Cards — Live */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-purple-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Palai Client Receivables (Lena)</p>
            <p className="text-2xl font-bold text-purple-700 font-mono mt-1">Rs. {totalClientDues.toLocaleString()}</p>
            <p className="text-[11px] text-slate-400 mt-1">Client Advance: Rs. {totalClientAdvance.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-rose-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Supplier Payables (Dena)</p>
            <p className="text-2xl font-bold text-rose-600 font-mono mt-1">Rs. {totalSupplierPayable.toLocaleString()}</p>
            <p className="text-[11px] text-slate-400 mt-1">Supplier Advance: Rs. {totalSupplierAdvance.toLocaleString()}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-emerald-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Registered Contacts</p>
            <p className="text-2xl font-bold text-slate-900 font-mono mt-1">{contacts?.length || 0}</p>
            <p className="text-[11px] text-slate-400 mt-1">Page {safePage} / {totalPages}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-amber-500">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Net Position</p>
            <p className="text-2xl font-bold font-mono mt-1 text-slate-900">Rs. {(totalClientDues - totalSupplierPayable).toLocaleString()}</p>
            <p className="text-[11px] text-slate-400 mt-1">Lena − Dena</p>
          </div>
        </div>

        {statusMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Success:</strong> {statusMsg}</span>
            <Link href="/contacts" className="text-emerald-600 font-bold hover:text-emerald-900">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex items-center justify-between">
            <span><strong>Error:</strong> {errorMsg}</span>
            <Link href="/contacts" className="text-red-500 font-bold hover:text-red-800">×</Link>
          </div>
        )}

        {/* Search + Filters */}
        <form action="/contacts" method="get" className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-2 items-center">
          <input name="q" defaultValue={params.q || ''} placeholder="Search naam / phone / address..." className="flex-1 min-w-[200px] px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm" />
          <select name="filter" defaultValue={filterRole} className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold">
            <option value="All">All Roles</option>
            <option value="Supplier">Suppliers</option>
            <option value="Client">Clients</option>
          </select>
          <select name="due" defaultValue={dueFilter} className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold">
            <option value="All">All Balances</option>
            <option value="Due">Due Only</option>
            <option value="Settled">Settled Only</option>
            <option value="Advance">Advance Only</option>
          </select>
          <button className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold">Search</button>
          <Link href="/contacts" className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold">Clear</Link>
        </form>

        {/* Edit Form — sirf jab editId ho */}
        {editContactRow && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <h2 className="font-bold text-slate-900 text-sm">Edit Contact — {editContactRow.name}</h2>
            <form action={updateContact} className="flex flex-wrap gap-2 mt-3">
              <input type="hidden" name="contactId" value={editContactRow.id} />
              <input name="name" defaultValue={editContactRow.name} required className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm flex-1 min-w-[160px]" />
              <input name="phone" defaultValue={editContactRow.phone || ''} placeholder="Phone" className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm w-40" />
              <input name="address" defaultValue={editContactRow.address || ''} placeholder="Address" className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm flex-1 min-w-[160px]" />
              <input name="notes" defaultValue={editContactRow.notes || ''} placeholder="Notes" className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm flex-1 min-w-[160px]" />
              <button className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold">Save Edit</button>
              <Link href="/contacts" className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold">Cancel</Link>
            </form>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800 text-sm">Directory List</h2>
                <p className="text-[11px] text-slate-400">Click WhatsApp to send instant reminder or order message</p>
              </div>
              <span className="text-xs text-slate-500">{filtered.length} found</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Name & Role</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Phone / Location</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase">Live Balance (PKR)</th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase">WhatsApp & Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {paged.length > 0 ? paged.map((c: any) => {
                    const isSupplier = c.role === 'Supplier'
                    const bal = Number(c.liveBalance || 0)
                    const whatsappUrl = buildWhatsAppUrl(c, farm.farm_name, bal)
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-4 whitespace-nowrap">
                          <p className="text-xs font-bold text-slate-900">{c.name}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md mt-1 ${isSupplier ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>{c.role}</span>
                          {c.role === 'Client' && c.animalCount > 0 && <p className="text-[11px] text-slate-500 mt-1">🐾 {c.animalCount} Palai animal(s)</p>}
                          {c.notes && <p className="text-[11px] text-slate-400 mt-1 max-w-[180px] truncate">{c.notes}</p>}
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-xs font-mono font-medium text-slate-700">{c.phone || '—'}</p>
                          <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{c.address || '—'}</p>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <form action={updateBalance} className="flex items-center gap-1.5">
                            <input type="hidden" name="contactId" value={c.id} />
                            <input name="newBalance" type="number" step="1" defaultValue={bal} className={`w-24 px-2 py-1 text-xs font-mono font-bold border rounded-lg ${bal > 0 ? 'text-emerald-700 bg-emerald-50/50 border-emerald-200' : bal < 0 ? 'text-rose-700 bg-rose-50/50 border-rose-200' : 'text-slate-700 bg-slate-50 border-slate-200'}`} />
                            <button type="submit" title="Update Balance" className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition">Save</button>
                          </form>
                          <p className="text-[10px] text-slate-400 mt-0.5">{bal > 0 ? 'Receivable (Lena)' : bal < 0 ? 'Payable (Dena)' : 'Settled'}</p>
                          {c.role === 'Client' && <p className="text-[10px] text-slate-400">Opening: {Number(c.openingBalance || 0).toLocaleString()} • Palai Due: {Number(c.palaiDue || 0).toLocaleString()}</p>}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap text-right space-x-2">
                          {whatsappUrl ? (
                            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition">💬 WhatsApp</a>
                          ) : (
                            <span title="Add valid mobile number (e.g. 03001234567) to enable WhatsApp" className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-medium cursor-not-allowed">No Phone</span>
                          )}
                          <Link href={qs({ editId: c.id })} className="inline-block px-2.5 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-xs font-medium transition">Edit</Link>
                          <form action={deleteContact} className="inline-block">
                            <input type="hidden" name="contactId" value={c.id} />
                            <button type="submit" className="px-2.5 py-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium transition">Delete</button>
                          </form>
                        </td>
                      </tr>
                    )
                  }) : (
                    <tr><td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-400">No contacts found. Search / filter badlo ya naya contact add karo.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">Page {safePage} / {totalPages} • {filtered.length} contacts</span>
              <div className="flex gap-2">
                {safePage > 1 && <Link href={qs({ page: String(safePage - 1) })} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold">← Prev</Link>}
                {safePage < totalPages && <Link href={qs({ page: String(safePage + 1) })} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold">Next →</Link>}
              </div>
            </div>
          </div>

          {/* Add Contact Form — waisa hi, bas validation server pe hai */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 h-fit space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Add New Contact</h2>
              <p className="text-xs text-slate-500 mt-0.5">Register a Feed Dealer, Vet Supplier or Palai Client</p>
            </div>
            <form action={addContact} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Contact Name *</label>
                <input name="name" type="text" required placeholder="e.g. Rohan (Palai Client)" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role / Type *</label>
                <select name="role" required className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600">
                  <option value="Client">Client (Palai Boarding Owner)</option>
                  <option value="Supplier">Supplier (Feed / Vet / Services)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">WhatsApp Mobile Number</label>
                <input name="phone" type="text" placeholder="e.g. 0300-1234567" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Address / Location</label>
                <input name="address" type="text" placeholder="e.g. DHA / Clifton, Karachi" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Opening Balance (PKR) [+ Lena / - Dena]</label>
                <input name="opening_balance" type="number" step="1" defaultValue="0" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600" />
                <p className="text-[11px] text-slate-400 mt-1">Client ke liye ye starting due hai. Baad me Palai bills se live due banta hai.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Notes (Optional)</label>
                <input name="notes" type="text" placeholder="e.g. Tag G-04 Palai Owner" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600" />
              </div>
              <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition font-semibold text-sm shadow-sm">Save Contact</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}