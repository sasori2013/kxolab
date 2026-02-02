import { createBrowserClient } from '@supabase/ssr'

let _supabase: any

export const supabase = new Proxy({} as any, {
    get(target, prop) {
        if (!_supabase) {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL
            const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            if (!url || !key) {
                // During build time, Next.js might evaluate this. 
                // We return a dummy object or throw a descriptive error only when a method is called.
                return (...args: any[]) => {
                    console.error("Supabase client accessed but NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.")
                    return { data: null, error: new Error("Supabase environment variables are missing.") }
                }
            }
            _supabase = createBrowserClient(url, key)
        }
        return (_supabase as any)[prop]
    }
})
