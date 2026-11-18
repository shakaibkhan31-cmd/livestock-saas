import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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
              </div>
            )}
          </div>

          <div className="flex items-center">
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