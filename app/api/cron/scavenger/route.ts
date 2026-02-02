
import { NextResponse } from "next/server"
import { supabase as adminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

export async function GET(req: Request) {
    return handle(req)
}

export async function POST(req: Request) {
    return handle(req)
}

async function handle(req: Request) {
    const startTime = Date.now()
    console.log("[Scavenger] Starting stuck job cleanup...")

    // 1. Authorization Check (Vercel Cron Secret)
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        console.error("[Scavenger] Unauthorized: Invalid CRON_SECRET")
        return new Response("Unauthorized", { status: 401 })
    }

    try {
        // 2. Threshold: 10 minutes ago
        const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString()

        /**
         * 3. Atomic Update
         * 
         * Logic:
         * - status = 'processing'
         * - (started_at < threshold OR (started_at IS NULL AND updated_at < threshold))
         * 
         * Limit: 200 (Safety cap)
         * 
         * Note: Supabase JS doesn't support .limit() on .update().
         * We fetch IDs first then update, OR use a raw SQL/RPC if atomicity is strictly required to avoid race with worker.
         * Actually, since we check status='processing' and provide a time condition, 
         * a race condition where a worker finishes at the EXACT same millisecond is rare.
         * To be safe and atomic, we can use a single update with a subquery or RPC.
         */

        // Using a transaction-like approach: fetch IDs of jobs to kill, then update.
        // This is safe because we only update if status is still 'processing'.
        const { data: stuckJobs, error: fetchError } = await adminClient
            .from('jobs')
            .select('id')
            .eq('status', 'processing')
            .or(`started_at.lt.${threshold},and(started_at.is.null,updated_at.lt.${threshold})`)
            .limit(200)

        if (fetchError) throw fetchError

        if (!stuckJobs || stuckJobs.length === 0) {
            console.log("[Scavenger] No stuck jobs found.")
            return NextResponse.json({
                ok: true,
                cleanedCount: 0,
                duration: Date.now() - startTime
            })
        }

        const jobIds = stuckJobs.map(j => j.id)
        console.log(`[Scavenger] Cleaning up ${jobIds.length} jobs: ${jobIds.join(", ")}`)

        const { count, error: updateError } = await adminClient
            .from('jobs')
            .update({
                status: 'failed',
                error: 'job exceeded processing timeout',
                error_code: 'scavenger_timeout',
                finished_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .in('id', jobIds)
            .eq('status', 'processing') // Safety check: only update if still processing

        if (updateError) throw updateError

        const duration = Date.now() - startTime
        console.log(`[Scavenger] Cleanup finished. Updated ${count || 0} jobs in ${duration}ms.`)

        return NextResponse.json({
            ok: true,
            cleanedCount: count || 0,
            duration
        })

    } catch (e: any) {
        console.error("[Scavenger] Error:", e)
        return NextResponse.json({
            ok: false,
            error: e.message,
            duration: Date.now() - startTime
        }, { status: 500 })
    }
}
