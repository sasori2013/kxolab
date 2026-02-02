import { createClient } from '@supabase/supabase-js'

let _adminClient: any

export const supabase = new Proxy({} as any, {
    get(target, prop) {
        if (!_adminClient) {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL
            const key = process.env.SUPABASE_SERVICE_ROLE_KEY
            if (!url || !key) {
                // During build time, return a safer fallback
                return (...args: any[]) => {
                    console.warn("Supabase Admin client accessed but environment variables are missing.")
                    return { data: null, error: new Error("Admin environment variables are missing.") }
                }
            }
            _adminClient = createClient(url, key, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            })
        }
        return (_adminClient as any)[prop]
    }
})
