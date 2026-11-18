import { createClient } from '@/utils/supabase/server'

export type UserRole = 'admin' | 'staff'

export async function getUserFarmAndRole() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { user: null, farm: null, role: null as UserRole | null }

  // 1. Check if user is direct farm owner
  const { data: ownedFarm } = await supabase
    .from('farms')
    .select('id, farm_name')
    .eq('owner_id', user.id)
    .single()

  if (ownedFarm) {
    return { user, farm: ownedFarm, role: 'admin' as UserRole }
  }

  // 2. Otherwise check farm_users table for staff/admin assignment
  const { data: memberRecord } = await supabase
    .from('farm_users')
    .select('role, farms (id, farm_name)')
    .eq('user_id', user.id)
    .single()

  if (memberRecord && memberRecord.farms) {
    const farmObj = Array.isArray(memberRecord.farms) ? memberRecord.farms[0] : memberRecord.farms
    const role: UserRole = memberRecord.role === 'admin' ? 'admin' : 'staff'
    return { user, farm: farmObj, role }
  }

  return { user, farm: null, role: null }
}