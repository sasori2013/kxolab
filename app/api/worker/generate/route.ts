import { NextRequest, NextResponse, after } from "next/server"
import { supabase as adminClient } from "@/lib/supabase/admin"
import { nanoBananaGenerate } from "@/lib/ai/nanobanana"
import { r2PutPng } from "@/lib/r2"
import { uploadToGoogleDrive } from "@/lib/ai/google-drive"

export const maxDuration = 300

export async function POST(req: NextRequest) {
    const startTime = Date.now()
    const body = await req.json()
    const { jobId, sessionId, imageUrl } = body
    let currentMetadata: any = {}

    try {
        if (!jobId) throw new Error("Missing jobId")

        // Fetch current job for initial metadata
        const { data: job } = await adminClient
            .from('jobs')
            .select('*')
            .eq('id', jobId)
            .single()

        currentMetadata = job?.execution_metadata || {}

        const updateProgress = async (status: string, metadataUpdates: any = {}) => {
            currentMetadata = {
                ...currentMetadata,
                ...metadataUpdates,
                steps: [...(currentMetadata.steps || []), { name: status, start: Date.now() }]
            }
            await adminClient
                .from('jobs')
                .update({
                    status,
                    updated_at: new Date().toISOString(),
                    execution_metadata: currentMetadata
                })
                .eq('id', jobId)
        }

        // --- ENHANCEMENT ---
        await updateProgress("generating")
        const enhancementPrompt = body.body?.prompt || "Standard professional portrait"

        console.log(`[Worker Job ${jobId}] Calling nanoBananaGenerate...`)
        const enhancementRes = await nanoBananaGenerate({
            imageUrl,
            prompt: enhancementPrompt,
            strength: body.body?.strength ?? 0.45,
            rewrite: body.body?.rewrite ?? 1,
            resolution: body.body?.resolution || '2K',
            aspectRatio: body.body?.aspectRatio || '1:1',
            referenceImageUrls: body.referenceImageUrls || []
        })

        if (!enhancementRes.ok) throw new Error(`Generation failed: ${enhancementRes.error}`)

        // --- FINAL SAVE ---
        await updateProgress("saving")
        const pId = body.photoId || "photo"
        const key = `private/${sessionId}/output/${pId}_${Date.now()}.png`

        const pub = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE?.replace(/\/$/, "")
        if (!pub) throw new Error("NEXT_PUBLIC_R2_PUBLIC_BASE is missing")
        const resultUrl = `${pub}/${key}`

        if (enhancementRes.imageBase64) {
            const bytes = Buffer.from(enhancementRes.imageBase64, 'base64')
            const uploadPromise = r2PutPng(key, bytes)
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("R2_UPLOAD_TIMEOUT")), 60000)
            )
            await Promise.race([uploadPromise, timeoutPromise])
        } else if (enhancementRes.imageUrl) {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 60000)
            try {
                const imgRes = await fetch(enhancementRes.imageUrl, { signal: controller.signal })
                if (!imgRes.ok) throw new Error(`Failed to fetch generation result: ${imgRes.status}`)
                const buf = await imgRes.arrayBuffer()

                const uploadPromise = r2PutPng(key, Buffer.from(buf))
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("R2_UPLOAD_TIMEOUT")), 60000)
                )
                await Promise.race([uploadPromise, timeoutPromise])
            } finally {
                clearTimeout(timeout)
            }
        } else {
            throw new Error("No image data found in generation result")
        }

        // Finalize using adminClient
        currentMetadata.duration = Date.now() - startTime

        console.log(`[Worker Job ${jobId}] Finalizing job...`)
        const { error: finalErr } = await adminClient.from('jobs').update({
            status: 'completed',
            result_url: resultUrl,
            error: null,
            execution_metadata: {
                ...currentMetadata,
                completed: true,
                prompt: enhancementPrompt,
                finished_at: new Date().toISOString()
            }
        }).eq('id', jobId)

        if (finalErr) throw new Error(`Final Update Error: ${finalErr.message}`)
        console.log(`[Worker Job ${jobId}] Job status updated to COMPLETED in Supabase.`)

        // --- GOOGLE DRIVE BACKUP (Non-blocking Background Task via 'after') ---
        const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID
        if (driveFolderId) {
            after(async () => {
                console.log(`[Worker Job ${jobId}] Triggering background Google Drive backup...`);
                try {
                    const imgRes = await fetch(resultUrl)
                    if (imgRes.ok) {
                        const buf = await imgRes.arrayBuffer()
                        const driveFilename = `kxolab_${jobId}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`
                        const driveRes = await uploadToGoogleDrive({
                            buffer: Buffer.from(buf),
                            filename: driveFilename,
                            mimeType: 'image/png',
                            folderId: driveFolderId
                        })
                        if (driveRes.ok) console.log(`[Worker Job ${jobId}] background Google Drive backup complete: ${driveRes.fileId}`)
                        else console.warn(`[Worker Job ${jobId}] background Google Drive backup failed: ${driveRes.error}`)
                    }
                } catch (driveErr: any) {
                    console.warn(`[Worker Job ${jobId}] background Google Drive backup task failed:`, driveErr.message)
                }
            })
        }

        console.log(`[Worker Job ${jobId}] Pipeline Completed Successfully.`)
        return NextResponse.json({ ok: true })

    } catch (e: any) {
        console.error(`[Worker Job ${jobId}] Pipeline Error:`, e)
        await adminClient
            .from('jobs')
            .update({
                status: 'failed',
                error: e.message,
                updated_at: new Date().toISOString(),
                execution_metadata: {
                    ...currentMetadata,
                    error_at: new Date().toISOString()
                }
            })
            .eq('id', jobId)
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
}
