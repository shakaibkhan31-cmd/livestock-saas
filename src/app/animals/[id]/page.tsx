import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  calculateAdgKgPerDay,
  calculateAnimalBreakEven,
  daysBetweenDateStrings,
  formatDateDDMMYYYY,
} from '@/utils/breakeven'

export default async function AnimalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    error?: string
    editLogId?: string
    commPct?: string
    transport?: string
    agentFee?: string
  }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const errorMessage = resolvedSearchParams.error
  const editLogId = resolvedSearchParams.editLogId

  const commissionPct = Math.max(0, parseFloat(resolvedSearchParams.commPct ?? '3') || 0)
  const transportCost = Math.max(0, parseFloat(resolvedSearchParams.transport ?? '0') || 0)
  const agentFeeCost = Math.max(0, parseFloat(resolvedSearchParams.agentFee ?? '0') || 0)

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { data: farm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (!farm) return redirect('/onboarding')

  // Fetch animal details
  const { data: animal } = await supabase
    .from('livestock_master')
    .select('*')
    .eq('id', id)
    .eq('farm_id', farm.id)
    .single()

  if (!animal) return redirect('/animals')

  // Fetch weight logs
  const { data: weightLogs } = await supabase
    .from('animal_weight_logs')
    .select('*')
    .eq('animal_id', id)
    .order('recorded_date', { ascending: false })

  // Fetch financial logs
  const { data: financialLogs } = await supabase
    .from('animal_financial_logs')
    .select('*')
    .eq('animal_id', id)
    .order('transaction_date', { ascending: false })

  // Fetch medical & vaccination logs
  const { data: medicalLogs } = await supabase
    .from('animal_medical_logs')
    .select('*')
    .eq('animal_id', id)
    .order('administered_date', { ascending: false })

  // 1. Server Action: Add Weight Log
  const addWeightLog = async (formData: FormData) => {
    'use server'
    const weight_kg = formData.get('weight_kg') as string
    const recorded_date = formData.get('recorded_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()
    const { error } = await supabaseClient.from('animal_weight_logs').insert([{
      animal_id: id,
      farm_id: farm.id,
      weight_kg: parseFloat(weight_kg),
      recorded_date: recorded_date || new Date().toISOString().split('T')[0],
      notes: notes || null,
    }])

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // 2. Server Action: Update Weight Log
  const updateWeightLog = async (formData: FormData) => {
    'use server'
    const logId = formData.get('logId') as string
    const weight_kg = formData.get('weight_kg') as string
    const recorded_date = formData.get('recorded_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()
    const { error } = await supabaseClient
      .from('animal_weight_logs')
      .update({
        weight_kg: parseFloat(weight_kg),
        recorded_date,
        notes: notes || null,
      })
      .eq('id', logId)
      .eq('animal_id', id)

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // 3. Server Action: Delete Weight Log
  const deleteWeightLog = async (formData: FormData) => {
    'use server'
    const logId = formData.get('logId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('animal_weight_logs')
      .delete()
      .eq('id', logId)
      .eq('animal_id', id)

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // 4. Server Action: Add Financial Transaction
  const addFinancialLog = async (formData: FormData) => {
    'use server'
    const entry_type = formData.get('entry_type') as string
    const category = formData.get('category') as string
    const amount = formData.get('amount') as string
    const transaction_date = formData.get('transaction_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()
    const { error } = await supabaseClient.from('animal_financial_logs').insert([{
      animal_id: id,
      farm_id: farm.id,
      entry_type,
      category,
      amount: parseFloat(amount),
      transaction_date: transaction_date || new Date().toISOString().split('T')[0],
      notes: notes || null,
    }])

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // 5. Server Action: Delete Financial Transaction
  const deleteFinancialLog = async (formData: FormData) => {
    'use server'
    const finId = formData.get('finId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('animal_financial_logs')
      .delete()
      .eq('id', finId)
      .eq('animal_id', id)

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // 6. Server Action: Add Medical / Vaccination Log
  const addMedicalLog = async (formData: FormData) => {
    'use server'
    const treatment_type = formData.get('treatment_type') as string
    const medicine_name = formData.get('medicine_name') as string
    const dosage = formData.get('dosage') as string
    const administered_date = formData.get('administered_date') as string
    const next_due_date = formData.get('next_due_date') as string
    const notes = formData.get('notes') as string

    const supabaseClient = await createClient()
    const { error } = await supabaseClient.from('animal_medical_logs').insert([{
      animal_id: id,
      farm_id: farm.id,
      treatment_type,
      medicine_name,
      dosage: dosage || null,
      administered_date: administered_date || new Date().toISOString().split('T')[0],
      next_due_date: next_due_date || null,
      notes: notes || null,
    }])

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // 7. Server Action: Delete Medical Log
  const deleteMedicalLog = async (formData: FormData) => {
    'use server'
    const medId = formData.get('medId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('animal_medical_logs')
      .delete()
      .eq('id', medId)
      .eq('animal_id', id)

    if (error) return redirect(`/animals/${id}?error=${encodeURIComponent(error.message)}`)
    return redirect(`/animals/${id}`)
  }

  // Growth Summary Calculations
  const latestWeight = weightLogs && weightLogs.length > 0 ? Number(weightLogs[0].weight_kg) : null
  const initialWeight = weightLogs && weightLogs.length > 0 ? Number(weightLogs[weightLogs.length - 1].weight_kg) : null
  const netGain = latestWeight !== null && initialWeight !== null ? (latestWeight - initialWeight).toFixed(1) : null

  // Financial & P&L Calculations
  const purchaseCost = Number(animal.cost_basis || 0)
  const loggedExpenses = (financialLogs || [])
    .filter(f => f.entry_type === 'Expense')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0)
  const loggedRevenue = (financialLogs || [])
    .filter(f => f.entry_type === 'Revenue')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0)

  const isSelfOwned = animal.ownership === 'Self'
  const totalCostOutflow = (isSelfOwned ? purchaseCost : 0) + loggedExpenses
  const netPnL = loggedRevenue - totalCostOutflow

  // Shared Break-Even & Daily Burn Projection for Farm-Owned (Self) Animals
  const todayStr = new Date().toISOString().split('T')[0]
  const acqDateStr = animal.acquisition_date ? String(animal.acquisition_date).split('T')[0] : null
  const activeDays = acqDateStr
    ? daysBetweenDateStrings(acqDateStr, todayStr, 1)
    : Math.max(1, (financialLogs || []).length || 30)

  const adgKgPerDay = calculateAdgKgPerDay(weightLogs)

  const {
    dailyBurnRate,
    breakEvenToday,
    breakEven30Days,
    breakEven60Days,
    perKgToday,
    perKg30Days,
    perKg60Days,
    projWeight30,
    projWeight60,
    extraCost30,
    extraCost60,
  } = calculateAnimalBreakEven({
    purchaseCost: isSelfOwned ? purchaseCost : 0,
    loggedExpenses,
    activeDays,
    latestWeight,
    adgKgPerDay,
    commissionPct,
    transportCost,
    agentFeeCost,
  })

  // Upcoming / Overdue Medical Alerts (within next 7 days or past due)
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const dueAlerts = (medicalLogs || []).filter(m => m.next_due_date && m.next_due_date <= sevenDaysFromNow)

  // Unified Chronological Activity Timeline
  type TimelineItem = {
    date: string
    title: string
    subtitle: string
    badgeColor: string
  }

  const timelineEvents: TimelineItem[] = []

  if (animal.acquisition_date) {
    timelineEvents.push({
      date: String(animal.acquisition_date).split('T')[0],
      title: 'Animal Onboarded',
      subtitle: `${isSelfOwned ? 'Farm Stock' : `Palai (${animal.client_name})`}`,
      badgeColor: 'bg-slate-800',
    })
  }

  ;(weightLogs || []).forEach(w => {
    timelineEvents.push({
      date: String(w.recorded_date).split('T')[0],
      title: `Weight Logged: ${w.weight_kg} kg`,
      subtitle: w.notes || 'Routine weight check',
      badgeColor: 'bg-green-600',
    })
  })

  ;(medicalLogs || []).forEach(m => {
    timelineEvents.push({
      date: String(m.administered_date).split('T')[0],
      title: `${m.treatment_type}: ${m.medicine_name}`,
      subtitle: m.dosage ? `Dosage: ${m.dosage}` : (m.notes || 'Health care logged'),
      badgeColor: 'bg-blue-600',
    })
  })

  ;(financialLogs || []).forEach(f => {
    timelineEvents.push({
      date: String(f.transaction_date).split('T')[0],
      title: `${f.entry_type}: Rs. ${Number(f.amount).toLocaleString()}`,
      subtitle: f.category,
      badgeColor: f.entry_type === 'Revenue' ? 'bg-emerald-600' : 'bg-rose-600',
    })
  })

  timelineEvents.sort((a, b) => b.date.localeCompare(a.date))

  // QR Code URL
  const animalProfileUrl = `https://livestock-saas.vercel.app/animals/${animal.id}`
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(animalProfileUrl)}`

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Top Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
              {animal.photo_url ? (
                <img src={animal.photo_url} alt={animal.tag_id} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl">🐐</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 font-mono">{animal.tag_id}</h1>
                <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {animal.status}
                </span>
              </div>
              <p className="text-sm text-slate-500">
                {animal.species} {animal.breed_name ? `• ${animal.breed_name}` : ''} • Sex: {animal.sex}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/animals/${animal.id}/statement`}
              target="_blank"
              className="px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl text-sm font-semibold shadow-xs transition flex items-center gap-1.5"
            >
              📄 Export Statement
            </Link>
            <Link
              href={`/animals/${animal.id}/edit`}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 rounded-xl text-sm font-medium transition"
            >
              Edit Animal
            </Link>
            <Link
              href="/animals"
              className="px-4 py-2 bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-xl text-sm font-medium transition"
            >
              ← Back to Master
            </Link>
          </div>
        </div>

        {/* Medical / Deworming Due Alert Banner */}
        {dueAlerts.length > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="text-sm font-bold text-amber-900">Medical / Deworming Schedule Alert</p>
                <div className="text-xs text-amber-800 mt-0.5 space-y-0.5">
                  {dueAlerts.map(alert => {
                    const isOverdue = alert.next_due_date < todayStr
                    return (
                      <p key={alert.id}>
                        • <strong>{alert.treatment_type} ({alert.medicine_name})</strong> is {isOverdue ? 'OVERDUE since' : 'due on'}{' '}
                        <span className="font-mono font-bold underline">{formatDateDDMMYYYY(alert.next_due_date)}</span>
                      </p>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            <strong>Error:</strong> {decodeURIComponent(errorMessage)}
          </div>
        )}

        {/* Break-Even & Per-KG / Future Projection Engine (Farm-Owned / Self Animals) */}
        {isSelfOwned && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    Farm-Owned (Self)
                  </span>
                  <h2 className="text-sm font-bold">Break-Even Sale Price & Future Projection</h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Daily cost accumulation ({activeDays} days active) + mandi selling cost & per-kg benchmark
                </p>
              </div>
              <div className="text-xs font-mono text-slate-300">
                Burn Rate: <strong className="text-amber-300">Rs. {dailyBurnRate.toLocaleString()}/day</strong>
                {adgKgPerDay !== null && (
                  <span className="ml-3">
                    ADG: <strong className="text-emerald-300">{adgKgPerDay >= 0 ? `+${adgKgPerDay.toFixed(2)}` : adgKgPerDay.toFixed(2)} kg/day</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Selling Cost Assumptions Form */}
              <form method="GET" action={`/animals/${animal.id}`} className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                {editLogId && <input type="hidden" name="editLogId" value={editLogId} />}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Mandi Commission (%)</label>
                  <input
                    name="commPct"
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    defaultValue={commissionPct}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Transport (PKR)</label>
                  <input
                    name="transport"
                    type="number"
                    step="1"
                    min="0"
                    defaultValue={transportCost}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Agent Fee (PKR)</label>
                  <input
                    name="agentFee"
                    type="number"
                    step="1"
                    min="0"
                    defaultValue={agentFeeCost}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="w-full py-1.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition"
                  >
                    Recalculate Break-Even
                  </button>
                </div>
              </form>

              {/* Horizon Cards: Today vs +30 Days vs +60 Days */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Today */}
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Today Break-Even Sale</p>
                  <p className="text-2xl font-bold font-mono text-slate-900">Rs. {breakEvenToday.toLocaleString()}</p>
                  <p className="text-xs font-mono text-emerald-700">
                    {perKgToday !== null && latestWeight
                      ? `Rs. ${perKgToday.toLocaleString()} / kg (@ ${latestWeight} kg)`
                      : 'Add weight log for /kg rate'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Cost to date: Rs. {totalCostOutflow.toLocaleString()} + selling costs
                  </p>
                </div>

                {/* +30 Days */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">+30 Days Break-Even</p>
                  <p className="text-2xl font-bold font-mono text-slate-900">Rs. {breakEven30Days.toLocaleString()}</p>
                  <p className="text-xs font-mono text-indigo-700">
                    {perKg30Days !== null && projWeight30
                      ? `Rs. ${perKg30Days.toLocaleString()} / kg (Est. ${projWeight30} kg)`
                      : 'Need 2+ weight logs for est. weight'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Extra holding cost: +Rs. {extraCost30.toLocaleString()}
                  </p>
                </div>

                {/* +60 Days */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">+60 Days Break-Even</p>
                  <p className="text-2xl font-bold font-mono text-slate-900">Rs. {breakEven60Days.toLocaleString()}</p>
                  <p className="text-xs font-mono text-indigo-700">
                    {perKg60Days !== null && projWeight60
                      ? `Rs. ${perKg60Days.toLocaleString()} / kg (Est. ${projWeight60} kg)`
                      : 'Need 2+ weight logs for est. weight'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Extra holding cost: +Rs. {extraCost60.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Opportunity & Growth Note */}
              <div className="px-4 py-3 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>
                  <strong>Holding Opportunity Check:</strong> Keeping for 30 days adds <strong>Rs. {extraCost30.toLocaleString()}</strong> in burn
                  {projWeight30 && latestWeight ? ` for ~+${(projWeight30 - latestWeight).toFixed(1)} kg projected gain` : ''}.
                </span>
                {perKgToday !== null && (
                  <span className="font-mono font-bold text-slate-900 shrink-0">
                    Mandi Target: &gt; Rs. {perKgToday.toLocaleString()}/kg
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Grid Layout: Left Profile + QR + Timeline | Right Weight + Medical + Financial */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column */}
          <div className="space-y-6">
            {/* Ownership & Financial Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Financial & Ownership</h3>
              
              <div>
                <p className="text-xs text-slate-500">Ownership Structure</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">
                  {isSelfOwned ? 'Self (Farm Owned)' : `Palai (${animal.client_name})`}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-500">Cost Basis / Purchase Price</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5">Rs. {purchaseCost.toLocaleString()}</p>
              </div>

              {animal.ownership === 'Client' && (
                <div>
                  <p className="text-xs text-slate-500">Monthly Boarding Rate</p>
                  <p className="text-sm font-semibold text-purple-700 mt-0.5">Rs. {Number(animal.monthly_boarding_rate || 0).toLocaleString()}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <p className="text-xs text-slate-500">Onboarding Date</p>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5 font-mono">
                    {formatDateDDMMYYYY(animal.acquisition_date)}
                  </p>
                </div>
                {animal.dob && (
                  <div>
                    <p className="text-xs text-slate-500">Date of Birth</p>
                    <p className="text-sm font-semibold text-slate-900 mt-0.5 font-mono">
                      {formatDateDDMMYYYY(animal.dob)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Smart QR Code Ear Tag Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Smart QR Ear Tag</h3>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  Scan Ready
                </span>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-300 inline-block mx-auto">
                <img
                  src={qrImageUrl}
                  alt={`QR Code for ${animal.tag_id}`}
                  className="h-36 w-36 mx-auto rounded-lg bg-white p-2 border border-slate-200"
                />
                <p className="font-mono font-bold text-slate-900 text-sm mt-2">{animal.tag_id}</p>
                <p className="text-[11px] text-slate-400">{farm.farm_name}</p>
              </div>

              <p className="text-xs text-slate-500">
                Scan with mobile camera in shed to open live profile & logs instantly.
              </p>

              <a
                href={qrImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={`${animal.tag_id}-QR-Tag.png`}
                className="block w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition"
              >
                Open / Print QR Tag
              </a>
            </div>

            {/* Unified Chronological Activity Timeline */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Activity Timeline</h3>
                <span className="text-[11px] text-slate-400">{timelineEvents.length} events</span>
              </div>

              <div className="relative pl-4 border-l-2 border-slate-200 space-y-4 max-h-96 overflow-y-auto">
                {timelineEvents.length > 0 ? (
                  timelineEvents.slice(0, 15).map((ev, idx) => (
                    <div key={idx} className="relative">
                      <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${ev.badgeColor}`}></span>
                      <p className="text-[11px] font-mono text-slate-400">{formatDateDDMMYYYY(ev.date)}</p>
                      <p className="text-xs font-semibold text-slate-800">{ev.title}</p>
                      <p className="text-[11px] text-slate-500">{ev.subtitle}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">No activity recorded yet.</p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Weight, Medical/Vaccination & Financial Ledgers */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Growth Summary Mini-Bar */}
            {latestWeight !== null && (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs text-slate-500">Initial Weight</p>
                  <p className="text-lg font-bold text-slate-800 font-mono mt-0.5">{initialWeight} kg</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs text-slate-500">Current Weight</p>
                  <p className="text-lg font-bold text-green-700 font-mono mt-0.5">{latestWeight} kg</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-xs text-slate-500">Net Gain</p>
                  <p className={`text-lg font-bold font-mono mt-0.5 ${Number(netGain) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {Number(netGain) >= 0 ? `+${netGain}` : netGain} kg
                  </p>
                </div>
              </div>
            )}

            {/* Add Weight Log Form Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Record New Weight Log</h3>
              <form action={addWeightLog} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Weight (KG) *</label>
                  <input
                    name="weight_kg"
                    type="number"
                    step="0.1"
                    required
                    placeholder="e.g., 45.5"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-green-600 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                  <input
                    name="recorded_date"
                    type="date"
                    required
                    defaultValue={todayStr}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-green-600 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes / Remarks</label>
                  <div className="flex gap-2">
                    <input
                      name="notes"
                      type="text"
                      placeholder="e.g., Post-feeding"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-green-600 transition"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium shadow-sm transition shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Weight History Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 text-sm">Weight History & Growth Logs</h3>
                <span className="text-xs text-slate-400">{weightLogs?.length || 0} entries</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date (DD/MM/YYYY)</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Weight (KG)</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Notes</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {weightLogs && weightLogs.length > 0 ? (
                      weightLogs.map((log) => {
                        const isEditing = editLogId === log.id
                        return isEditing ? (
                          <tr key={log.id} className="bg-amber-50/60">
                            <td colSpan={4} className="px-6 py-3">
                              <form action={updateWeightLog} className="flex flex-col sm:flex-row items-center gap-2">
                                <input type="hidden" name="logId" value={log.id} />
                                <input
                                  name="recorded_date"
                                  type="date"
                                  required
                                  defaultValue={String(log.recorded_date).split('T')[0]}
                                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                                />
                                <input
                                  name="weight_kg"
                                  type="number"
                                  step="0.1"
                                  required
                                  defaultValue={log.weight_kg}
                                  className="w-24 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono"
                                />
                                <input
                                  name="notes"
                                  type="text"
                                  defaultValue={log.notes || ''}
                                  placeholder="Notes..."
                                  className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="submit"
                                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
                                  >
                                    Save
                                  </button>
                                  <Link
                                    href={`/animals/${id}`}
                                    className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-300"
                                  >
                                    Cancel
                                  </Link>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-3.5 text-sm font-mono text-slate-800">
                              {formatDateDDMMYYYY(log.recorded_date)}
                            </td>
                            <td className="px-6 py-3.5 text-sm font-bold text-green-700 font-mono">
                              {log.weight_kg} kg
                            </td>
                            <td className="px-6 py-3.5 text-sm text-slate-500">
                              {log.notes || '—'}
                            </td>
                            <td className="px-6 py-3.5 text-right text-xs font-medium space-x-2 whitespace-nowrap">
                              <Link
                                href={`/animals/${id}?editLogId=${log.id}`}
                                className="inline-flex items-center px-2.5 py-1 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition"
                              >
                                Edit
                              </Link>
                              <form action={deleteWeightLog} className="inline-block">
                                <input type="hidden" name="logId" value={log.id} />
                                <button
                                  type="submit"
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition"
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
                        <td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-sm">
                          No weight logs recorded yet. Add the first weight entry above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Medical, Deworming & Vaccination History Log */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-blue-950 text-white flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">Medical, Deworming & Vaccination Log</h3>
                  <p className="text-[11px] text-blue-200">Track health protocols, medicine dosage & upcoming booster alerts</p>
                </div>
                <span className="text-xs bg-blue-900 px-2.5 py-1 rounded-lg text-blue-100 font-medium">
                  {medicalLogs?.length || 0} records
                </span>
              </div>

              {/* Add Medical Log Form */}
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <form action={addMedicalLog} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Protocol Type *</label>
                      <select
                        name="treatment_type"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="Deworming">Deworming</option>
                        <option value="Vaccination">Vaccination</option>
                        <option value="Medication">Medication / Treatment</option>
                        <option value="Multivitamin">Multivitamin / Liver Tonic</option>
                        <option value="Health Checkup">Health Checkup</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Medicine / Vaccine Name *</label>
                      <input
                        name="medicine_name"
                        type="text"
                        required
                        placeholder="e.g., Abentin, Ivermectin, ETV"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Dosage / Route</label>
                      <input
                        name="dosage"
                        type="text"
                        placeholder="e.g., 10ml Oral, 2cc Subcut"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Date Given *</label>
                      <input
                        name="administered_date"
                        type="date"
                        required
                        defaultValue={todayStr}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Next Due Date (Alert)</label>
                      <input
                        name="next_due_date"
                        type="date"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Notes</label>
                      <div className="flex gap-1.5">
                        <input
                          name="notes"
                          type="text"
                          placeholder="Optional..."
                          className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-600"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shrink-0 transition"
                        >
                          Log
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              {/* Medical History Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date Given</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Type & Medicine</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Dosage</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Next Due</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {medicalLogs && medicalLogs.length > 0 ? (
                      medicalLogs.map((med) => {
                        const isDueSoon = med.next_due_date && med.next_due_date <= sevenDaysFromNow
                        return (
                          <tr key={med.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-3.5 text-xs font-mono text-slate-700">
                              {formatDateDDMMYYYY(med.administered_date)}
                            </td>
                            <td className="px-6 py-3.5">
                              <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200 mr-1.5">
                                {med.treatment_type}
                              </span>
                              <span className="text-xs font-semibold text-slate-800">{med.medicine_name}</span>
                              {med.notes && <p className="text-[11px] text-slate-400 mt-0.5">{med.notes}</p>}
                            </td>
                            <td className="px-6 py-3.5 text-xs text-slate-600">{med.dosage || '—'}</td>
                            <td className="px-6 py-3.5 text-xs font-mono">
                              {med.next_due_date ? (
                                <span className={`px-2 py-0.5 rounded-md font-semibold ${
                                  isDueSoon ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'text-slate-600'
                                }`}>
                                  {formatDateDDMMYYYY(med.next_due_date)}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              <form action={deleteMedicalLog} className="inline-block">
                                <input type="hidden" name="medId" value={med.id} />
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
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-xs">
                          No deworming, vaccination, or medical records logged yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Automated Financial Ledger & Live P&L */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="font-bold text-sm">Automated Financial Ledger & P&L</h3>
                  <p className="text-[11px] text-slate-400">Track per-animal expenses, Palai fees & real-time profitability</p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-rose-300">
                    Outflow: Rs. {totalCostOutflow.toLocaleString()}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-emerald-300">
                    Inflow: Rs. {loggedRevenue.toLocaleString()}
                  </span>
                  <span className={`px-2.5 py-1 rounded-lg font-bold ${netPnL >= 0 ? 'bg-emerald-500 text-slate-950' : 'bg-rose-500 text-white'}`}>
                    Net P&L: {netPnL >= 0 ? `+Rs. ${netPnL.toLocaleString()}` : `-Rs. ${Math.abs(netPnL).toLocaleString()}`}
                  </span>
                </div>
              </div>

              {/* Add Financial Entry Form */}
              <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <form action={addFinancialLog} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Type *</label>
                    <select
                      name="entry_type"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-green-600"
                    >
                      <option value="Expense">Expense (-)</option>
                      <option value="Revenue">Revenue (+)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category *</label>
                    <select
                      name="category"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-green-600"
                    >
                      <option value="Feed & Ration">Feed & Ration</option>
                      <option value="Medicine & Vaccine">Medicine & Vaccine</option>
                      <option value="Palai Monthly Fee">Palai Monthly Fee</option>
                      <option value="Sale / Qurbani">Sale / Qurbani</option>
                      <option value="Transport / Mandi">Transport / Mandi</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Amount (PKR) *</label>
                    <input
                      name="amount"
                      type="number"
                      step="1"
                      required
                      placeholder="e.g., 5000"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-green-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Date *</label>
                    <input
                      name="transaction_date"
                      type="date"
                      required
                      defaultValue={todayStr}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-green-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Notes</label>
                    <div className="flex gap-1.5">
                      <input
                        name="notes"
                        type="text"
                        placeholder="Optional..."
                        className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-green-600"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shrink-0 transition"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* Financial Transactions Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date (DD/MM/YYYY)</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Notes</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {financialLogs && financialLogs.length > 0 ? (
                      financialLogs.map((fin) => (
                        <tr key={fin.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3.5 text-xs font-mono text-slate-700">
                            {formatDateDDMMYYYY(fin.transaction_date)}
                          </td>
                          <td className="px-6 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold rounded-full ${
                              fin.entry_type === 'Revenue'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}>
                              {fin.category}
                            </span>
                          </td>
                          <td className={`px-6 py-3.5 text-xs font-bold font-mono ${
                            fin.entry_type === 'Revenue' ? 'text-emerald-700' : 'text-rose-700'
                          }`}>
                            {fin.entry_type === 'Revenue' ? '+' : '-'} Rs. {Number(fin.amount).toLocaleString()}
                          </td>
                          <td className="px-6 py-3.5 text-xs text-slate-500">{fin.notes || '—'}</td>
                          <td className="px-6 py-3.5 text-right">
                            <form action={deleteFinancialLog} className="inline-block">
                              <input type="hidden" name="finId" value={fin.id} />
                              <button
                                type="submit"
                                className="px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium transition"
                              >
                                Delete
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-xs">
                          No financial transactions logged yet. Purchase Cost Basis (Rs. {purchaseCost.toLocaleString()}) is already factored into Net P&L.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  )
}