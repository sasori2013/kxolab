import "server-only"
import type { NanoBananaGenerateArgs, NanoBananaResult, NanoBananaError } from "./nanobanana"
import { ensureJpeg } from "./image-helper"

const getGoogleClient = async (authOptions: any) => {
    const { GoogleAuth } = await import('google-auth-library')
    return new GoogleAuth(authOptions)
}

/**
 * Exponential backoff helper for retryable errors (429, 503, etc.)
 * Enhanced with deadline awareness to avoid Vercel 300s timeouts.
 */
async function withRetry<T>(fn: () => Promise<T>, options: { maxTries?: number, initialDelay?: number, startTime?: number } = {}): Promise<T> {
    const maxTries = options.maxTries || 5
    const startTime = options.startTime || Date.now()
    const VERCEL_DEADLINE_MS = 290000 // 290s safety limit for 300s maxDuration
    let delay = options.initialDelay || 3000

    for (let i = 0; i < maxTries; i++) {
        try {
            return await fn()
        } catch (e: any) {
            const elapsed = Date.now() - startTime
            const isLastTry = i === maxTries - 1
            const msg = String(e?.message || "")
            const is429 = /429|resource exhausted|rate limit|quota/i.test(msg)
            const isRetryable = is429 || /limit|503|502|server error/i.test(msg)

            // If it's a 429, we might want to wait longer initially
            if (i === 0 && is429 && !options.initialDelay) {
                delay = 10000
            }

            // If we are getting close to the 5-minute mark, don't try again.
            const tooCloseToDeadline = elapsed + (delay * 1.5) > VERCEL_DEADLINE_MS

            if (!isRetryable || isLastTry || tooCloseToDeadline) {
                if (tooCloseToDeadline) console.warn(`[Vertex AI] Stopping retries: too close to Vercel deadline (${Math.round(elapsed / 1000)}s elapsed)`)
                if (isLastTry) console.error(`[Vertex AI] Max retries reached (${maxTries}). Final error: ${msg}`)
                throw e
            }

            console.warn(`[Vertex AI] Rate/Server error encountered (Attempt ${i + 1}/${maxTries}). Waiting ${delay}ms before next try... Message: ${msg.slice(0, 100)}`)
            await new Promise(resolve => setTimeout(resolve, delay))
            delay *= 2 // Exponential backoff (3s, 6s, 12s, 24s...)
        }
    }
    throw new Error("Retry logic failed to return")
}

export async function internalNanoBananaGenerate(args: NanoBananaGenerateArgs): Promise<NanoBananaResult | NanoBananaError> {
    // Use env variable or default to gemini-3-pro-image-preview
    const model = (args.model || process.env.NANOBANANA_MODEL || process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview").trim()

    // gemini-3-pro-image-preview is a Gemini-class model with image generation (Nano Banana Pro)
    // It currently ONLY supports generateContent (multimodal image-to-image), not the predict endpoint.
    const isImagen = model.startsWith("imagegeneration") || model.includes("imagen")

    // gemini-3-pro-image-preview requires "global" location on Vertex AI
    // Imagen 3 models are most stable in us-central1
    const effectiveLocation = model === "gemini-3-pro-image-preview"
        ? "global"
        : (isImagen ? "us-central1" : (process.env.GOOGLE_VERTEX_LOCATION || "us-central1").trim())
    const projectId = process.env.GOOGLE_VERTEX_PROJECT_ID?.trim()
    const envModel = process.env.NANOBANANA_MODEL?.trim()

    if (!projectId) return { ok: false, error: "GOOGLE_VERTEX_PROJECT_ID is missing" }

    const authOptions: any = {
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        projectId,
    }

    // Handle Vercel Deployment Credentials
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        try {
            const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
            authOptions.credentials = creds
        } catch (e: any) {
            console.error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON in google-client. Check for extra quotes or malformed JSON.", e.message)
        }
    }

    // Double Safety check
    if (!authOptions.credentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return { ok: false, error: "Missing Google Credentials (GOOGLE_APPLICATION_CREDENTIALS_JSON)" }
    }

    const auth = await getGoogleClient(authOptions)
    const client = await auth.getClient()
    const accessToken = await client.getAccessToken()
    const token = accessToken.token
    if (!token) return { ok: false, error: "Failed to get Google Access Token" }

    const sharp = (await import("sharp")).default

    // 1. Fetch Image
    let imgB64: string | undefined
    const metadata = args.imageUrl ? await sharp(await (async () => {
        const res = await fetch(args.imageUrl!, { cache: "no-store" })
        if (!res.ok) throw new Error(`Failed to fetch input image: ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
    })()).metadata() : null

    const isPortrait = metadata ? (metadata.width || 0) < (metadata.height || 0) : false
    let targetRatio = args.aspectRatio || (metadata ? (isPortrait ? "3:4" : "4:3") : "1:1")

    if (args.imageUrl) {
        // Handle "original" aspect ratio
        if (targetRatio === "original" && metadata) {
            targetRatio = `${metadata.width}:${metadata.height}`
        }

        const imgRes = await fetch(args.imageUrl, { cache: "no-store" })
        if (!imgRes.ok) return { ok: false, error: `Failed to fetch input image: ${imgRes.status}` }
        const imgBufRaw = await imgRes.arrayBuffer()
        const buffer = await ensureJpeg(Buffer.from(imgBufRaw))

        // CAPPING INPUT IMAGE: Gemini-3 Pro / Imagen 3 work best with ~768px inputs for speed.
        const MAX_INPUT_DIM = 768
        const imgSharp = sharp(buffer).rotate().resize(MAX_INPUT_DIM, MAX_INPUT_DIM, { fit: "inside", withoutEnlargement: true })

        // Use JPEG for Vertex AI payload to reduce size (PNG can be too large)
        const imgBufJpeg = await imgSharp.jpeg({ quality: 85 }).toBuffer()
        imgB64 = imgBufJpeg.toString("base64")

        console.log(`[Vertex AI] Input image optimized. Dim: ${MAX_INPUT_DIM}, Size: ${Math.round(imgBufJpeg.length / 1024)}KB`)
    }

    // 2. Fetch Reference Images (Gemini only)
    const referenceImageParts: any[] = []
    if (!isImagen && args.referenceImageUrls && args.referenceImageUrls.length > 0) {
        // Limit to 3 references to avoid payload bloat
        const refs = args.referenceImageUrls.slice(0, 3)
        for (const refUrl of refs) {
            try {
                const res = await fetch(refUrl, { cache: "no-store" })
                if (res.ok) {
                    const buf = await res.arrayBuffer()
                    const optimized = await sharp(Buffer.from(buf)).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer()
                    referenceImageParts.push({
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: optimized.toString("base64")
                        }
                    })
                }
            } catch (e) {
                console.error(`[Vertex AI] Failed to fetch reference image: ${refUrl}`, e)
            }
        }
    }

    const method = isImagen ? "predict" : "generateContent"
    const apiVersion = model.includes("gemini-3") ? "v1beta1" : (isImagen ? "v1" : "v1beta1")

    const hostname = effectiveLocation === "global" ? "aiplatform.googleapis.com" : `${effectiveLocation}-aiplatform.googleapis.com`
    const endpoint = `https://${hostname}/${apiVersion}/projects/${projectId}/locations/${effectiveLocation}/publishers/google/models/${model}:${method}`

    console.log(`[Vertex AI] Calling Endpoint: ${endpoint}`)

    let payload: any = {}

    if (isImagen) {
        // High guidance for clarity, but high weight for control to prevent movement
        const gScale = 30

        payload = {
            instances: [
                {
                    prompt: args.prompt.trim(),
                }
            ],
            parameters: {
                sampleCount: 1,
                aspectRatio: targetRatio,
            }
        }

        if (imgB64) {
            payload.parameters.negativePrompt = args.strength && args.strength > 0.7
                ? "extra objects, moving objects, merged plates, different colors, new items, blurry"
                : "extra objects, moving objects, merged plates, different colors, new items, blurry"

            payload.parameters.referenceImages = [
                {
                    referenceId: 1,
                    // REFERENCE_TYPE_STRUCTURE is less rigid than CONTROL, allowing for rotation and perspective fix
                    referenceType: args.strength && args.strength > 0.7 ? "REFERENCE_TYPE_STRUCTURE" : "REFERENCE_TYPE_CONTROL",
                    image: { bytesBase64Encoded: imgB64 },
                }
            ]
            payload.parameters.referenceConfig = [
                {
                    referenceId: 1,
                    // Lower weight (0.1-0.3) allows the AI to "re-imagine" the geometry (fix tilt/perspective)
                    // If strength is high (suggesting distortion), we lower the weight aggressively.
                    // Weight 0.08 allows for structural change while giving hints for texture/pattern
                    // If strength is high (suggesting distortion), we lower the weight but keep some detail hint.
                    weight: args.strength && args.strength > 0.7 ? 0.08 : Math.max(0.08, 1.0 - (args.strength || 0.45))
                }
            ]
            payload.parameters.guidanceScale = args.strength && args.strength > 0.7 ? 90 : (args.strength ? (args.strength * 60) : 30)
        }

        // Move seed outside of imgB64 block so it applies to text-only too
        // and ensure it is a validated integer for Vertex AI
        if (args.seed !== undefined) {
            payload.parameters.seed = Math.floor(Number(args.seed))
        }
    } else {
        // Fallback for non-Imagen models (Gemini-3 / Nano Banana Pro)
        const lowerPrompt = args.prompt.toLowerCase()
        const category = args.category || "other"
        const isArchitectural = /room|lobby|restaurant|cafe|building|exterior|pool|gym|bathroom|office|meeting/.test(lowerPrompt) ||
            ["hotel_room", "hotel_lobby", "restaurant", "cafe", "pool", "gym", "bathroom", "meeting_room", "exterior"].includes(category)
        const isFood = category === "food"
        const isHighStrength = args.strength && args.strength > 0.7 && isArchitectural

        const parts: any[] = []

        if (imgB64) {
            parts.push({
                text: `TASK: Use IMAGE 1 (MAIN) as the absolute structural and visual foundation. Subtly incorporate elements, style, or subjects from the provided REFERENCE IMAGES (Images 2+) into this scene.
            
INSTRUCTIONS:
- CRITICAL: Maintain the EXACT composition, camera perspective, furniture layout, and architectural structure of IMAGE 1.
- LIGHTING & COLOR: Match all added elements to IMAGE 1's light source direction, color temperature, and shadows. Ensure natural blending (light wrap, ambient occlusion).
- RATIO: Strictly respect the framing and aspect ratio of IMAGE 1.
- REQUEST: ${args.prompt.trim() || "Enhance and realistically modify this scene based on references."}`
            })
            parts.push({ text: "IMAGE 1 (MAIN - DO NOT CHANGE STRUCTURE):" })
            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: imgB64,
                },
            })
        } else {
            parts.push({
                text: `TASK: Create an image based on this request: ${args.prompt.trim()}.
            
INSTRUCTIONS:
- Generate a high-quality, professional image.
- If REFERENCE IMAGES are provided, use them for style and subject guidance.`
            })
        }

        if (referenceImageParts.length > 0) {
            referenceImageParts.forEach((refPart, i) => {
                parts.push({ text: `IMAGE ${i + 2} (REFERENCE ${String.fromCharCode(65 + i)}):` })
                parts.push(refPart)
            })
        }

        payload = {
            contents: [
                {
                    role: "user",
                    parts
                },
            ],
            generationConfig: {
                temperature: Math.max(isHighStrength ? 1.0 : 0.7, args.temperature || 0.0),
                maxOutputTokens: 2048,
                seed: args.seed !== undefined ? Math.floor(Number(args.seed)) : undefined // Gemini seed support
            }
        }

        // Log request payload for debugging (omitting base64 for brevity)
        console.log(`[Vertex AI Request] ${model} payload:`, JSON.stringify({
            ...payload,
            instances: payload.instances?.map((inst: any) => ({ ...inst, image: inst.image ? "[IMAGE_BASE64]" : undefined })),
            contents: payload.contents?.map((cont: any) => ({
                ...cont,
                parts: cont.parts?.map((p: any) => p.inlineData ? { ...p, inlineData: { ...p.inlineData, data: "[IMAGE_BASE64]" } } : p)
            }))
        }, null, 2))
    }

    const controller = new AbortController()
    // Standard timeout 280s (Safety cushion for Vercel 300s limit)
    const TIMEOUT_MS = 280000
    const timeoutId = setTimeout(() => {
        console.warn(`[Vertex AI] Global timeout reached (${TIMEOUT_MS}ms). Aborting request.`)
        controller.abort()
    }, TIMEOUT_MS)

    // 3. Request Generation
    const apiStartTime = Date.now()
    let res: Response
    try {
        res = await withRetry(async () => {
            const attemptStartTime = Date.now()
            const attemptLabel = `Attempt ${Math.round((Date.now() - apiStartTime) / 1000)}s into job`
            console.log(`[Vertex AI] Starting fetch... (${attemptLabel})`)

            const r = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    "X-Debug-Job-Id": args.imageUrl ? (args.imageUrl.split('/').pop() || "unknown") : `txt-${args.prompt.slice(0, 10).replace(/\s/g, '_')}-${Date.now()}`,
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            })

            // If it's a 429 or 5xx, throw so withRetry catches it
            if (r.status === 429 || r.status >= 500) {
                const text = await r.text()
                let detail = text
                try {
                    const errJson = JSON.parse(text)
                    detail = errJson?.error?.message || errJson?.message || text
                } catch { }
                throw new Error(`Vertex AI error ${r.status}: ${detail.slice(0, 250)}`)
            }

            console.log(`[Vertex AI] Fetch returned status ${r.status} after ${Date.now() - attemptStartTime}ms`)
            return r
        }, { startTime: apiStartTime })
    } finally {
        clearTimeout(timeoutId)
    }

    const apiDuration = Date.now() - apiStartTime
    console.log(`[Vertex AI] Pipeline Finished. Status: ${res.status}, Total Duration: ${apiDuration}ms`)

    const text = await res.text()
    console.log(`[Vertex AI] Response body received. Length: ${Math.round(text.length / 1024)}KB`)

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

    if (isImagen) {
        if (json.predictions && json.predictions[0]?.bytesBase64Encoded) {
            foundB64 = json.predictions[0].bytesBase64Encoded
            foundMime = json.predictions[0].mimeType || "image/png"
        }
    } else {
        const cand = json?.candidates?.[0]
        const parts = cand?.content?.parts ?? []
        for (const p of parts) {
            if (p?.inlineData?.data) {
                foundB64 = p.inlineData.data
                foundMime = p.inlineData.mimeType || "image/png"
                break
            }
        }
    }

    if (!foundB64) {
        console.error("[Nanobanana] No image data found. Full Response:", JSON.stringify(json, null, 2))
        const candidate = json?.candidates?.[0]
        if (candidate?.finishReason) {
            let msg = `Generation stop: ${candidate.finishReason}`
            if (candidate.safetyRatings) {
                const blocked = candidate.safetyRatings.find((r: any) => r.probability !== "NEGLIGIBLE" && r.probability !== "LOW")
                if (blocked) msg += ` (${blocked.category})`
            }
            return { ok: false, error: msg, raw: json }
        }
        return { ok: false, error: "No image data in response", raw: json }
    }

    // --- UPSCALING (Native Vertex AI) ---
    if (args.resolution === "2K" || args.resolution === "4K") {
        console.log(`[Vertex AI] Upscaling requested: ${args.resolution}`)
        try {
            const upscaleFactor = args.resolution === "4K" ? "x4" : "x2"

            // image-upscaling-001 is most stable in us-central1
            const upscaleLocation = "us-central1"
            const upscaleEndpoint = `https://${upscaleLocation}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${upscaleLocation}/publishers/google/models/image-upscaling-001:predict`

            const upscalePayload = {
                instances: [
                    {
                        image: { bytesBase64Encoded: foundB64 }
                    }
                ],
                parameters: {
                    upscaleFactor: upscaleFactor
                }
            }

            console.log(`[Vertex AI] Calling Upscaler (${upscaleFactor})...`)
            const upscaleRes = await withRetry(async () => {
                const r = await fetch(upscaleEndpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(upscalePayload),
                })

                if (r.status === 429 || r.status >= 500) {
                    const text = await r.text()
                    throw new Error(`Vertex AI Upscale error ${r.status}: ${text.slice(0, 200)}`)
                }
                return r
            }, { startTime: Date.now() }) // Fresh start for upscale retry

            if (upscaleRes.ok) {
                const upscaleJson = await upscaleRes.json()
                if (upscaleJson.predictions && upscaleJson.predictions[0]?.bytesBase64Encoded) {
                    console.log(`[Vertex AI] Upscale Success (${args.resolution})`)
                    foundB64 = upscaleJson.predictions[0].bytesBase64Encoded
                    // Upscaler usually returns same mime as input or png
                } else {
                    console.warn("[Vertex AI] Upscale returned no data, falling back to original.")
                }
            } else {
                console.warn(`[Vertex AI] Upscale failed (${upscaleRes.status}), falling back to original.`)
            }
        } catch (e) {
            console.error("[Vertex AI] Upscale process failed:", e)
            // Fallback to original image
        }
    }

    return {
        ok: true,
        imageBase64: foundB64,
        mimeType: foundMime,
        raw: json // Keep original generation raw for debugging
    }
}
