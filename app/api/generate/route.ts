// app/api/generate/route.ts
import { NextResponse, after } from "next/server"

import { PutObjectCommand } from "@aws-sdk/client-s3"
import { r2, R2_BUCKET } from "@/lib/r2"
import { nanoBananaGenerate } from "@/lib/ai/nanobanana"
import { Category } from "@/lib/ai/categories"
import { createClient } from "@/lib/supabase/server"
import { supabase as adminClient } from "@/lib/supabase/admin"
import { analyzeImageFromUrl, Brightness, People } from "@/lib/ai/analyze"
import crypto from "crypto"

export const runtime = "nodejs"
export const maxDuration = 300 // Vercel Pro Limit (Hobby is 60s, but let's try)

type GenerateReq = {
  sessionId?: string
  imageUrl?: string
  prompt?: string
  debug?: boolean
  strength?: number
  category?: string
  subjectDescription?: string
  visualStrategy?: string
  photoId?: string
  brightness?: string
  people?: string
  tilt?: string
  idempotencyKey?: string
  resolution?: "2K" | "4K"
  aspectRatio?: string
  referenceImageUrls?: string[]
  seed?: number
}


function uid(prefix = "sess") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`
}
function safeString(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function r2PutPng(key: string, bytes: Uint8Array) {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: Buffer.from(bytes),
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    })
  )
}

async function callNanoBanana(args: {
  imageUrl: string
  prompt: string
  strength: number
  rewrite: number
  debug?: boolean
  model?: string
  referenceImageUrls?: string[]
}) {
  const result = await nanoBananaGenerate({
    imageUrl: args.imageUrl,
    prompt: args.prompt,
    strength: args.strength,
    rewrite: args.rewrite,
    model: args.model,
    referenceImageUrls: args.referenceImageUrls,
  })

  if (!result.ok) throw new Error(result.error)

  let outBytes: Uint8Array
  let mime = result.mimeType || "image/png"

  if (result.imageBase64) {
    outBytes = Uint8Array.from(Buffer.from(result.imageBase64, "base64"))
  } else if (result.imageUrl) {
    const res = await fetch(result.imageUrl)
    if (!res.ok) throw new Error(`Failed to fetch result image: ${res.status}`)
    const buf = await res.arrayBuffer()
    outBytes = new Uint8Array(buf)
    const ct = res.headers.get("content-type")
    if (ct) mime = ct
  } else {
    throw new Error("NanoBanana succeeded but no image data found")
  }

  return {
    bytes: outBytes,
    mime,
    meta: args.debug ? { provider: "nanobanana", raw: result.raw } : undefined,
  }
}

export async function POST(req: Request) {
  console.log(">>> [API] POST /api/generate started")
  try {
    const bodyStr = await req.text()
    let body: GenerateReq
    try {
      body = JSON.parse(bodyStr)
    } catch (parseError: any) {
      console.error(">>> [API] JSON Parse Error:", parseError.message, "Body starts with:", bodyStr.slice(0, 100))
      return NextResponse.json({ ok: false, error: "Invalid JSON body: " + parseError.message }, { status: 400 })
    }

    console.log(">>> [API] Incoming Generate Request:", {
      imageUrl: body.imageUrl,
      prompt: body.prompt,
      resolution: body.resolution,
      aspectRatio: body.aspectRatio,
      seed: body.seed
    })
    const imageUrl = safeString(body.imageUrl)
    const prompt = safeString(body.prompt)

    if (!imageUrl && !prompt) return NextResponse.json({ ok: false, error: "imageUrl or prompt is required" }, { status: 400 })

    const sessionId = safeString(body.sessionId) || uid("sess")

    // 0. SUPABASE CLIENT
    const supabase = await createClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.warn("[Generate API] Auth Error (continuing as guest):", authError.message)
    }
    const userId = authData?.user?.id || null

    console.log(`[Generate API] Request from ${userId ? "user: " + userId : "anonymous guest"}`)

    // 0.5 IDEMPOTENCY & CACHE CHECK
    const idempotencyKey = safeString(body.idempotencyKey)
    const seed = body.seed !== undefined ? Number(body.seed) : Math.floor(Math.random() * 2147483647)

    const contentHash = crypto.createHash("sha256")
      .update(JSON.stringify({
        imageUrl,
        prompt: body.prompt,
        category: body.category,
        strength: body.strength,
        seed,
        resolution: body.resolution,
        aspectRatio: body.aspectRatio,
        referenceImageUrls: body.referenceImageUrls
      }))
      .digest("hex")

    if (idempotencyKey) {
      const { data: existingIdem } = await adminClient
        .from('jobs')
        .select('id, status, result_url')
        .eq('execution_metadata->>idempotency_key', idempotencyKey)
        .limit(1)
        .maybeSingle()

      if (existingIdem) {
        console.log(`[Generate API] Idempotency Hit: ${idempotencyKey} -> ${existingIdem.id}`)
        return NextResponse.json({ ok: true, jobId: existingIdem.id, status: existingIdem.status, resultUrl: existingIdem.result_url, cached: true })
      }
    }

    const { data: cachedJob } = await adminClient
      .from('jobs')
      .select('id, status, result_url')
      .in('status', ['completed', 'processing', 'retrying'])
      .eq('execution_metadata->>content_hash', contentHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (cachedJob) {
      console.log(`[Generate API] Content Match Found: ${contentHash} -> ${cachedJob.id} (${cachedJob.status})`)
      return NextResponse.json({
        ok: true,
        jobId: cachedJob.id,
        status: cachedJob.status,
        resultUrl: cachedJob.status === 'completed' ? cachedJob.result_url : undefined,
        cached: true
      })
    }

    // 1. Prepare Metadata & Create Job in Supabase
    const basePrompt = body.prompt || ""
    const protocol = req.headers.get("x-forwarded-proto") || "https"
    const forwardedHost = req.headers.get("x-forwarded-host")
    const host = req.headers.get("host")
    const hostToUse = forwardedHost || host

    const PRODUCTION_URL = "https://kxolab.kenxxxooo.com"
    const isLocalDev = process.env.NODE_ENV === "development"
    const baseUrl = (isLocalDev && host) ? `${protocol}://${hostToUse}` : (process.env.APP_URL || PRODUCTION_URL)
    const workerUrl = `${baseUrl.replace(/\/$/, "")}/api/worker/generate`
    const isPreview = process.env.VERCEL_ENV === "preview" || (host?.includes("vercel.app") && !host?.includes("navy-xi-16"))

    console.log(`[Generate API] Creating job in Supabase...`)
    const { data: job, error: jobError } = await adminClient
      .from('jobs')
      .insert({
        status: 'processing',
        input_url: imageUrl,
        prompt: basePrompt,
        category: body.category || 'other',
        user_id: userId,
        started_at: new Date().toISOString(),
        execution_metadata: {
          queued_at: new Date().toISOString(),
          idempotency_key: idempotencyKey,
          content_hash: contentHash,
          worker_url: workerUrl,
          host_header: host,
          app_url_env: process.env.APP_URL ? "set" : "missing",
          is_preview: isPreview,
          seed,
          strength: body.strength,
          resolution: body.resolution,
          aspectRatio: body.aspectRatio,
          reference_image_urls: body.referenceImageUrls
        }
      })
      .select('id')
      .single()

    if (jobError || !job) {
      console.error(`[Generate API] Failed to create job:`, jobError)
      throw new Error(`Failed to create job: ${jobError?.message || "Unknown error"}`)
    }
    const jobId = job.id
    console.log(`[Generate API] Job created: ${jobId}`)

    // 2. Trigger Background Task
    try {
      const payload = { jobId, sessionId, imageUrl, referenceImageUrls: body.referenceImageUrls, body, userId }

      if (isLocalDev) {
        console.log(`[Generate API] LOCAL DEV: Triggering worker at ${workerUrl}`)
        // Remove the direct nanoBananaGenerate call that was causing a "double-hit" on quotas.
        // The worker will handle the generation and status updates.
        fetch(workerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-bypass-qstash": "true" },
          body: JSON.stringify(payload)
        }).catch(err => {
          console.error("[Generate API] LOCAL DEV fetch to worker failed:", err)
        })
      } else {
        if (!process.env.QSTASH_TOKEN) throw new Error("QSTASH_TOKEN missing")
        const { qstashClient } = await import("@/lib/qstash")
        await qstashClient.publishJSON({ url: workerUrl, concurrency: 1, body: payload })
      }
    } catch (e: any) {
      console.error("[Generate API] Trigger ERROR:", e)
      await adminClient.from('jobs').update({ status: 'failed', error: `Trigger failed: ${e.message}` }).eq('id', jobId)
    }

    return NextResponse.json({ ok: true, jobId, sessionId })

  } catch (e: any) {
    console.error(">>> [API] Generate API Error:", e)
    return NextResponse.json({ ok: false, error: e?.message ?? "generate failed" }, { status: 500 })
  }
}