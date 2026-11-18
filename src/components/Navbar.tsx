import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getUserFarmAndRole } from '@/utils/rbac'

export default async function Navbar() {
  const { user, role } = await getUserFarmAndRole()
  const isAdmin = role === 'admin'

  const handleSignOut = async () => {
    'use server'
    const supabaseClient = await createClient()
    await supabaseClient.auth.signOut()
    return redirect('/login')
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center space-x-8">
            <Link href="/animals" className="text-xl font-bold text-green-700">
              🐑 BAA BAA Shed
            </Link>
            {user && (
              <div className="hidden md:flex space-x-4">
                <Link
                  href="/animals"
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-green-600 hover:bg-gray-50 transition"
                >
                  Livestock Master
                </Link>
                <Link
                  href="/feed"
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-green-600 hover:bg-gray-50 transition"
                >
                  Feed Logs
                </Link>
                {isAdmin && (
                  <>
                    <Link
                      href="/finances"
                      className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-green-600 hover:bg-gray-50 transition"
                    >
                      Finances & Billing
                    </Link>
                    <Link
                      href="/contacts"
                      className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:text-green-600 hover:bg-gray-50 transition"
                    >
                      Contacts
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {user && role && (
              <span
                className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-full border ${
                  isAdmin
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {role}
              </span>
            )}
            {user ? (
              <form action={handleSignOut}>
                <button
                  type="submit"
                  className="px-4 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-md hover:bg-red-50 transition"
                >
                  Sign Out
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}