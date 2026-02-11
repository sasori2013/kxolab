import { GoogleAuth } from "google-auth-library"

export interface NanoBananaGenerateArgs {
    imageUrl?: string
    prompt: string
    strength?: number
    category?: string
    rewrite?: number
    temperature?: number
    resolution?: "2K" | "4K"
    aspectRatio?: string
    referenceImageUrls?: string[]
    seed?: number
    model?: string
}

export interface NanoBananaResult {
    ok: true
    imageBase64?: string
    imageUrl?: string
    mimeType?: string
    raw?: any
}

export interface NanoBananaError {
    ok: false
    error: string
    raw?: any
}

let _googleClient: GoogleAuth | null = null
async function getGoogleClient(options: any) {
    if (!_googleClient) {
        _googleClient = new GoogleAuth(options)
    }
    return _googleClient
}

async function ensureJpeg(buffer: Buffer): Promise<Buffer> {
    const sharp = (await import("sharp")).default
    return await sharp(buffer).jpeg().toBuffer()
}

const VERCEL_DEADLINE_MS = 290000 // 290s

async function withRetry<T>(fn: () => Promise<T>, options: { maxTries?: number, initialDelay?: number, startTime: number }): Promise<T> {
    const maxTries = options.maxTries || 10
    let delay = options.initialDelay || 3000
    const startTime = options.startTime

    for (let i = 0; i < maxTries; i++) {
        try {
            return await fn()
        } catch (e: any) {
            const elapsed = Date.now() - startTime
            const isLastTry = i === maxTries - 1
            const msg = String(e?.message || "")
            const is429 = /429|resource exhausted|rate limit|quota/i.test(msg)
            const isRetryable = is429 || /limit|503|502|server error/i.test(msg)

            if (i === 0 && is429 && !options.initialDelay) {
                // If it's a 429 (Resource Exhausted), we wait 15 seconds.
                // Since the limit is often 1 RPM (request per minute), 
                // waiting 15s + exponential backoff is much more likely to succeed.
                delay = 15000
            }

            const tooCloseToDeadline = elapsed + (delay * 1.5) > VERCEL_DEADLINE_MS

            if (!isRetryable || isLastTry || tooCloseToDeadline) {
                if (tooCloseToDeadline) console.warn(`[Vertex AI] Stopping retries: too close to Vercel deadline (${Math.round(elapsed / 1000)}s elapsed)`)
                if (isLastTry) console.error(`[Vertex AI] Max retries reached (${maxTries}). Final error: ${msg}`)
                throw e
            }

            console.warn(`[Vertex AI] Rate/Server error encountered (Attempt ${i + 1}/${maxTries}). Waiting ${delay}ms before next try... Message: ${msg.slice(0, 100)}`)
            await new Promise(resolve => setTimeout(resolve, delay))
            delay *= 2
        }
    }
    throw new Error("Retry logic failed to return or throw")
}

export async function internalNanoBananaGenerate(args: NanoBananaGenerateArgs): Promise<NanoBananaResult | NanoBananaError> {
    const model = (args.model || process.env.NANOBANANA_MODEL || process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview").trim()
    const isImagen = model.startsWith("imagegeneration") || model.includes("imagen")

    // User requested 'global' for stability
    const effectiveLocation = model === "gemini-3-pro-image-preview"
        ? "global"
        : (isImagen ? "us-central1" : (process.env.GOOGLE_VERTEX_LOCATION || "us-central1").trim())
    const projectId = process.env.GOOGLE_VERTEX_PROJECT_ID?.trim()

    if (!projectId) return { ok: false, error: "GOOGLE_VERTEX_PROJECT_ID is missing" }

    const authOptions: any = {
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        projectId,
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        try {
            const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
            authOptions.credentials = creds
        } catch (e: any) {
            console.error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON", e.message)
        }
    }

    if (!authOptions.credentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return { ok: false, error: "Missing Google Credentials" }
    }

    const auth = await getGoogleClient(authOptions)
    const client = await auth.getClient()
    const accessToken = await client.getAccessToken()
    const token = accessToken.token
    if (!token) return { ok: false, error: "Failed to get Google Access Token" }

    const sharp = (await import("sharp")).default

    let imgB64: string | undefined
    const metadata = args.imageUrl ? await sharp(await (async () => {
        const res = await fetch(args.imageUrl!, { cache: "no-store" })
        if (!res.ok) throw new Error(`Failed to fetch input image: ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
    })()).metadata() : null

    const isPortrait = metadata ? (metadata.width || 0) < (metadata.height || 0) : false
    let targetRatio = args.aspectRatio || (metadata ? (isPortrait ? "3:4" : "4:3") : "1:1")

    if (args.imageUrl) {
        if (targetRatio === "original" && metadata) {
            targetRatio = `${metadata.width}:${metadata.height}`
        }

        const imgRes = await fetch(args.imageUrl, { cache: "no-store" })
        if (!imgRes.ok) return { ok: false, error: `Failed to fetch input image: ${imgRes.status}` }
        const buffer = await ensureJpeg(Buffer.from(await imgRes.arrayBuffer()))

        const MAX_INPUT_DIM = 768
        const imgSharp = sharp(buffer).rotate().resize(MAX_INPUT_DIM, MAX_INPUT_DIM, { fit: "inside", withoutEnlargement: true })
        const imgBufJpeg = await imgSharp.jpeg({ quality: 85 }).toBuffer()
        imgB64 = imgBufJpeg.toString("base64")
    }

    const referenceImageParts: any[] = []
    if (!isImagen && args.referenceImageUrls && args.referenceImageUrls.length > 0) {
        const refs = args.referenceImageUrls.slice(0, 3)
        for (const refUrl of refs) {
            try {
                const res = await fetch(refUrl, { cache: "no-store" })
                if (res.ok) {
                    const buf = await res.arrayBuffer()
                    const optimized = await sharp(Buffer.from(buf)).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer()
                    referenceImageParts.push({
                        inlineData: { mimeType: "image/jpeg", data: optimized.toString("base64") }
                    })
                }
            } catch (e) {
                console.error(`Failed to fetch reference image: ${refUrl}`, e)
            }
        }
    }

    const isImagenClassic = model.startsWith("imagegeneration")
    const isImagen3 = model.startsWith("imagen-3.0")
    const isGeminiImage = model.includes("gemini-3")

    // Modern Imagen 3 and Gemini models use generateContent
    const useGenerateContent = isImagen3 || isGeminiImage
    const method = useGenerateContent ? "generateContent" : "predict"
    const apiVersion = useGenerateContent ? "v1beta1" : "v1"

    const hostname = effectiveLocation === "global" ? "aiplatform.googleapis.com" : `${effectiveLocation}-aiplatform.googleapis.com`
    const endpoint = `https://${hostname}/${apiVersion}/projects/${projectId}/locations/${effectiveLocation}/publishers/google/models/${model}:${method}`

    let payload: any = {}
    if (!useGenerateContent) {
        // Legacy Imagen structure
        payload = {
            instances: [{ prompt: args.prompt.trim() }],
            parameters: { sampleCount: 1, aspectRatio: targetRatio }
        }
        if (imgB64) {
            payload.parameters.referenceImages = [{
                referenceId: 1,
                referenceType: args.strength && args.strength > 0.7 ? "REFERENCE_TYPE_STRUCTURE" : "REFERENCE_TYPE_CONTROL",
                image: { bytesBase64Encoded: imgB64 }
            }]
            payload.parameters.referenceConfig = [{
                referenceId: 1,
                weight: args.strength && args.strength > 0.7 ? 0.08 : Math.max(0.08, 1.0 - (args.strength || 0.45))
            }]
            payload.parameters.guidanceScale = args.strength && args.strength > 0.7 ? 90 : (args.strength ? (args.strength * 60) : 30)
        }
        // Seed removed to avoid "Seed is not supported when watermark is enabled" across all Imagen variants
    } else {
        // Modern generateContent structure (Gemini & Imagen 3)
        const parts: any[] = []
        if (imgB64) {
            parts.push({
                text: `TASK: Use IMAGE 1 (MAIN) as the foundation. Synthesis elements from the prompt: ${args.prompt.trim()}`
            })
            parts.push({ text: "IMAGE 1 (MAIN):" })
            parts.push({ inlineData: { mimeType: "image/jpeg", data: imgB64 } })
        } else {
            parts.push({ text: args.prompt.trim() })
        }
        if (referenceImageParts.length > 0) {
            referenceImageParts.forEach((refPart, i) => {
                parts.push({ text: `IMAGE ${i + 2} (REFERENCE):` })
                parts.push(refPart)
            })
        }
        payload = {
            contents: [{ role: "user", parts }],
            generationConfig: {
                temperature: args.temperature || 0.7,
                maxOutputTokens: 2048
                // Seed removed to avoid "Seed is not supported when watermark is enabled" 400 error
            }
        }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), VERCEL_DEADLINE_MS)
    const apiStartTime = Date.now()
    let res: Response | null = null

    try {
        res = await withRetry(async () => {
            const r = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
                signal: controller.signal
            })

            if (!r.ok) {
                const errText = await r.text()
                if (r.status === 429) {
                    const headers: Record<string, string> = {}
                    r.headers.forEach((v, k) => { headers[k] = v })
                    console.error(`[Vertex AI] 429 RESOURCE EXHAUSTED. Headers: ${JSON.stringify(headers)} Body: ${errText}`)
                }

                let detail = errText
                try {
                    const errJson = JSON.parse(errText)
                    detail = errJson?.error?.message || errJson?.message || errText
                } catch { }
                throw new Error(`Vertex AI error ${r.status}: ${detail.slice(0, 250)}`)
            }
            return r
        }, { startTime: apiStartTime })
    } finally {
        clearTimeout(timeoutId)
    }

    if (!res) return { ok: false, error: "Generation skipped or failed to return response" }

    const text = await res.text()
    let json: any = null
    try {
        json = JSON.parse(text)
    } catch {
        return { ok: false, error: `Vertex AI non-JSON response: ${res.status}`, raw: text.slice(0, 1000) }
    }

    if (!res.ok) {
        const errDetail = json?.error?.message || JSON.stringify(json)
        return { ok: false, error: `Vertex AI error ${res.status}: ${errDetail}`, raw: json }
    }

    let foundB64: string | undefined
    let foundMime: string = "image/png"

    if (!useGenerateContent) {
        if (json.predictions && json.predictions[0]?.bytesBase64Encoded) {
            foundB64 = json.predictions[0].bytesBase64Encoded
            foundMime = json.predictions[0].mimeType || "image/png"
        }
    } else {
        const parts = json?.candidates?.[0]?.content?.parts ?? []
        for (const p of parts) {
            if (p?.inlineData?.data) {
                foundB64 = p.inlineData.data
                foundMime = p.inlineData.mimeType || "image/png"
                break
            }
        }
    }

    if (!foundB64) {
        console.error("[Nanobanana] No image data found:", JSON.stringify(json, null, 2))
        return { ok: false, error: "No image data in response", raw: json }
    }

    if (args.resolution === "2K" || args.resolution === "4K") {
        try {
            const upscaleFactor = args.resolution === "4K" ? "x4" : "x2"
            const upscaleLocation = "us-central1"
            const upscaleEndpoint = `https://${upscaleLocation}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${upscaleLocation}/publishers/google/models/image-upscaling-001:predict`
            const upscalePayload = {
                instances: [{ image: { bytesBase64Encoded: foundB64 } }],
                parameters: { upscaleFactor }
            }
            const upscaleRes = await withRetry(async () => {
                const r = await fetch(upscaleEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify(upscalePayload),
                })
                if (!r.ok) throw new Error(`Upscale error ${r.status}`)
                return r
            }, { startTime: Date.now() })

            if (upscaleRes.ok) {
                const upscaleJson = await upscaleRes.json()
                if (upscaleJson.predictions?.[0]?.bytesBase64Encoded) {
                    foundB64 = upscaleJson.predictions[0].bytesBase64Encoded
                }
            }
        } catch (e) { console.error("[Vertex AI] Upscale failed:", e) }
    }

    return { ok: true, imageBase64: foundB64, mimeType: foundMime, raw: json }
}
