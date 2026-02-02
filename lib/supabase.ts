import { createBrowserClient } from '@supabase/ssr'

// Use placeholders during build time to avoid "supabaseUrl is required" error.
// The actual values will be used at runtime if configured in Vercel.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createBrowserClient(
    supabaseUrl,
    supabaseAnonKey
)
