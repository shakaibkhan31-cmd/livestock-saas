import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'

export default async function TeamManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>
}) {
  const params = await searchParams
  const statusMsg = params.msg
  const errorMsg = params.error

  // RBAC: Only Admin can access Team Management
  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')
  if (role !== 'admin') {
    return redirect('/animals?error=' + encodeURIComponent('Access Denied: Team management is restricted to Admin only.'))
  }

  const supabase = await createClient()

  // Fetch all members linked to this farm from farm_users
  const { data: teamMembers } = await supabase
    .from('farm_users')
    .select('*')
    .eq('farm_id', farm.id)

  // Server Action: Add or Assign Team Member by Email
  const addTeamMember = async (formData: FormData) => {
    'use server'
    const email = (formData.get('email') as string)?.trim().toLowerCase()
    const memberRole = (formData.get('role') as string) || 'staff'

    if (!email) {
      return redirect('/team?error=' + encodeURIComponent('Please enter a valid email address.'))
    }

    const supabaseClient = await createClient()

    // 1. Find user ID from auth/profiles or search matching profiles if any. 
    // Since direct auth.users access requires admin client, we search via a secure lookup or check if user exists in auth.
    // In Supabase, we can look up user via RPC or check if they signed up. Let's query user by email using supabase admin or match profile.
    // Alternatively, we can query auth.users if admin client is configured, but here we can invite or match via profiles table.
    // Let's assume a 'profiles' table exists or search farm_users. If profiles table isn't present, we can match user ID.
    // Let's provide a robust lookup using Supabase admin client or prompt email match.
    
    // Let's check if there's a profiles table or if we can get user by email using service role client:
    // (Or we can map user_id directly if user has already signed up).
    
    // For simplicity and security in Next.js Server Actions:
    const { data: targetUserQuery, error: userErr } = await supabaseClient
      .from('profiles') // or fallback lookup
      .select('id')
      .eq('email', email)
      .maybeSingle()

    // If profiles table doesn't exist or user not found in profiles, let's guide or query auth:
    // Let's write a safe check:
    let targetUserId = targetUserQuery?.id

    if (!targetUserId) {
      // If user hasn't signed up yet, we can show an error asking them to sign up first.
      return redirect(`/team?error=${encodeURIComponent('User with this email must sign up to the app first before being assigned a role.')}`)
    }

    // Check if already in farm_users
    const { data: existingMember } = await supabaseClient
      .from('farm_users')
      .select('id')
      .eq('farm_id', farm.id)
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (existingMember) {
      // Update role
      const { error: updateErr } = await supabaseClient
        .from('farm_users')
        .update({ role: memberRole })
        .eq('id', existingMember.id)

      if (updateErr) return redirect(`/team?error=${encodeURIComponent(updateErr.message)}`)
      return redirect(`/team?msg=${encodeURIComponent('Team member role updated successfully.')}`)
    } else {
      // Insert new member
      const { error: insertErr } = await supabaseClient
        .from('farm_users')
        .insert([{ farm_id: farm.id, user_id: targetUserId, role: memberRole }])

      if (insertErr) return redirect(`/team?error=${encodeURIComponent(insertErr.message)}`)
      return redirect(`/team?msg=${encodeURIComponent('Team member added successfully.')}`)
    }
  }

  // Server Action: Remove Team Member
  const removeTeamMember = async (formData: FormData) => {
    'use server'
    const memberId = formData.get('memberId') as string
    const supabaseClient = await createClient()

    const { error } = await supabaseClient
      .from('farm_users')
      .delete()
      .eq('id', memberId)
      .eq('farm_id', farm.id)

    if (error) return redirect(`/team?error=${encodeURIComponent(error.message)}`)
    return redirect(`/team?msg=${encodeURIComponent('Team member removed from farm.')}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                RBAC Access Control
              </span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mt-1">Farm Team & Staff Management</h1>
            <p className="text-sm text-slate-500">Manage staff access, assign permissions, and control farm roles</p>
          </div>

          <Link
            href="/animals"
            className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm"
          >
            ← Back to Livestock Master
          </Link>
        </div>

        {/* Feedback Banners */}
        {statusMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex justify-between">
            <span><strong>Success:</strong> {decodeURIComponent(statusMsg)}</span>
            <Link href="/team" className="font-bold">×</Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex justify-between">
            <span><strong>Error:</strong> {decodeURIComponent(errorMsg)}</span>
            <Link href="/team" className="font-bold">×</Link>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Team Members List */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h2 className="font-bold text-slate-800 text-sm">Assigned Team Members</h2>
              <p className="text-[11px] text-slate-400">List of users with access to {farm.farm_name}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">User ID</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Role</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(teamMembers || []).length > 0 ? (
                    (teamMembers || []).map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 text-xs font-mono text-slate-700 truncate max-w-[200px]">
                          {m.user_id}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-md ${
                            m.role === 'admin'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {m.role}
                          </span>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap text-right">
                          <form action={removeTeamMember} className="inline-block">
                            <input type="hidden" name="memberId" value={m.id} />
                            <button
                              type="submit"
                              className="px-2.5 py-1 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-medium transition"
                            >
                              Remove
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-6 py-10 text-center text-sm text-slate-400">
                        No team members added yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add / Assign Team Member Form */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 h-fit space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Assign Staff Member</h2>
              <p className="text-xs text-slate-500 mt-0.5">Give staff access to daily feed & livestock logs</p>
            </div>

            <form action={addTeamMember} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Staff Email *</label>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="staff@baabaashed.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-600"
                />
                <p className="text-[11px] text-slate-400 mt-1">Note: User must have already signed up in the app.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role *</label>
                <select
                  name="role"
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="staff">Staff (Daily Logs & Feed Only)</option>
                  <option value="admin">Admin (Full Access & Finances)</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition font-semibold text-sm shadow-sm"
              >
                Save Team Member
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}