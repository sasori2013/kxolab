import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
    try {
        const { jobIds } = await req.json()
        if (!jobIds || !Array.isArray(jobIds)) {
            return NextResponse.json({ error: 'Invalid jobIds' }, { status: 400 })
        }

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        console.log(`[API Delete] Deleting ${jobIds.length} jobs...`)
        const { error } = await supabaseAdmin
            .from('jobs')
            .delete()
            .in('id', jobIds)

        if (error) {
            console.error('[API Delete] Supabase error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ ok: true })
    } catch (e: any) {
        console.error('[API Delete] Fatal error:', e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
