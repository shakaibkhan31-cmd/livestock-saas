import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const tag_id = formData.get('tag_id') as string
    const species = formData.get('species') as string
    const breed_name = formData.get('breed_name') as string
    const rawOwnership = formData.get('ownership') as string
    const ownership = rawOwnership === 'Client' ? 'Client' : 'Self'

    const client_name = formData.get('client_name') as string
    const sex = formData.get('sex') as string
    const dob = formData.get('dob') as string
    const acquisition_date = formData.get('acquisition_date') as string
    const status = (formData.get('status') as string) || 'Active'
    const cost_basis = formData.get('cost_basis') as string
    const monthly_boarding_rate = formData.get('monthly_boarding_rate') as string

    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: farm } = await supabase
      .from('farms')
      .select('id')
      .eq('owner_id', user.id)
      .single()

    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 })
    }

    const insertData: Record<string, any> = {
      farm_id: farm.id,
      tag_id,
      species,
      ownership,
      client_name: ownership === 'Client' ? (client_name || 'Client') : null,
      sex,
      status,
      cost_basis: cost_basis ? parseFloat(cost_basis) : 0,
      monthly_boarding_rate: ownership === 'Client' && monthly_boarding_rate ? parseFloat(monthly_boarding_rate) : 0,
    }

    if (breed_name) insertData.breed_name = breed_name
    if (dob) insertData.dob = dob
    if (acquisition_date) insertData.acquisition_date = acquisition_date

    const { error } = await supabase.from('livestock_master').insert([insertData])

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}