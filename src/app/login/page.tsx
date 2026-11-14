import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export default function LoginPage() {
  const handleLogin = async (formData: FormData) => {
    'use server'
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient() // <--- await lagaya

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return redirect('/login?message=Could not authenticate user')
    }

    return redirect('/')
  }

  const handleSignup = async (formData: FormData) => {
    'use server'
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient() // <--- await lagaya
    const headersList = await headers()
    const origin = headersList.get('origin')

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
      },
    })

    if (error) {
      return redirect('/login?message=Could not create user')
    }

    return redirect('/login?message=Check email to continue sign in process')
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
      <div className="p-8 bg-white rounded-lg shadow-md w-96">
        <h1 className="mb-6 text-2xl font-bold text-center text-gray-800">BAA BAA Shed SaaS</h1>
        <form className="flex flex-col gap-4">
          <input
            name="email"
            type="email"
            placeholder="Email address"
            required
            className="px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            required
            className="px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            formAction={handleLogin}
            className="py-2 text-white bg-green-600 rounded-md hover:bg-green-700 transition"
          >
            Sign In
          </button>
          <button
            formAction={handleSignup}
            className="py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition"
          >
            Sign Up
          </button>
        </form>
      </div>
    </div>
  )
}