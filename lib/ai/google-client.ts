import "server-only"
import type { NanoBananaGenerateArgs, NanoBananaResult, NanoBananaError } from "./nanobanana"
import { ensureJpeg } from "./image-helper"

const getGoogleClient = async (authOptions: any) => {
    const { GoogleAuth } = await import('google-auth-library')
    return new GoogleAuth(authOptions)
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
        } catch (e) {
            console.error("Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON", e)
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
    const imgRes = await fetch(args.imageUrl, { cache: "no-store" })
    if (!imgRes.ok) return { ok: false, error: `Failed to fetch input image: ${imgRes.status}` }
    const imgBufRaw = await imgRes.arrayBuffer()
    const buffer = await ensureJpeg(Buffer.from(imgBufRaw))

    const baseSharp = sharp(buffer).rotate()
    const metadata = await baseSharp.metadata()
    const isPortrait = (metadata.width || 0) < (metadata.height || 0)
    let targetRatio = args.aspectRatio || (isPortrait ? "3:4" : "4:3")

    // Handle "original" aspect ratio
    if (targetRatio === "original") {
        targetRatio = `${metadata.width}:${metadata.height}`
    }

    const is4K = args.resolution === "4K"
    const MAX_DIM = is4K ? 3840 : 1536 // 4K or current default
    const imgSharp = baseSharp.resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    // Use JPEG for Vertex AI payload to reduce size (PNG can be too large for 4K)
    const imgBufJpeg = await imgSharp.jpeg({ quality: 90 }).toBuffer()
    const imgB64 = imgBufJpeg.toString("base64")

    console.log(`[Vertex AI] Input image prepared. Size: ${Math.round(imgBufJpeg.length / 1024)}KB`)

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
                // Negative prompt to strictly forbid movement/additions
                // Negative prompt should not forbid orientation changes if we are fixing tilt
                negativePrompt: args.strength && args.strength > 0.7
                    ? "extra objects, moving objects, merged plates, different colors, new items, blurry"
                    : "extra objects, moving objects, merged plates, different colors, new items, blurry",
                referenceImages: [
                    {
                        referenceId: 1,
                        // REFERENCE_TYPE_STRUCTURE is less rigid than CONTROL, allowing for rotation and perspective fix
                        referenceType: args.strength && args.strength > 0.7 ? "REFERENCE_TYPE_STRUCTURE" : "REFERENCE_TYPE_CONTROL",
                        image: { bytesBase64Encoded: imgB64 },
                    }
                ],
                referenceConfig: [
                    {
                        referenceId: 1,
                        // Lower weight (0.1-0.3) allows the AI to "re-imagine" the geometry (fix tilt/perspective)
                        // If strength is high (suggesting distortion), we lower the weight aggressively.
                        // Weight 0.08 allows for structural change while giving hints for texture/pattern
                        // If strength is high (suggesting distortion), we lower the weight but keep some detail hint.
                        weight: args.strength && args.strength > 0.7 ? 0.08 : Math.max(0.08, 1.0 - (args.strength || 0.45))
                    }
                ],
                guidanceScale: args.strength && args.strength > 0.7 ? 90 : (args.strength ? (args.strength * 60) : 30), // Max guidance when transformation is needed
                aspectRatio: targetRatio,
            }
        }
    } else {
        // Fallback for non-Imagen models (Gemini-3 / Nano Banana Pro)
        const lowerPrompt = args.prompt.toLowerCase()
        const category = args.category || "other"
        const isArchitectural = /room|lobby|restaurant|cafe|building|exterior|pool|gym|bathroom|office|meeting/.test(lowerPrompt) ||
            ["hotel_room", "hotel_lobby", "restaurant", "cafe", "pool", "gym", "bathroom", "meeting_room", "exterior"].includes(category)
        const isFood = category === "food"
        const isHighStrength = args.strength && args.strength > 0.7 && isArchitectural

        const parts: any[] = [
            { text: `TASK: Based on the "MAIN SCENE" (Image 1) and the "REFERENCE INSPIRATION" (Images 2+), fulfill this request: ${args.prompt.trim()}` },
            { text: "IMAGE 1 (MAIN SCENE):" },
            {
                inlineData: {
                    mimeType: "image/jpeg",
                    data: imgB64,
                },
            }
        ]

        if (referenceImageParts.length > 0) {
            referenceImageParts.forEach((refPart, i) => {
                parts.push({ text: `IMAGE ${i + 2} (REFERENCE INSPIRATION):` })
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
            }
        }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 180000) // 180s timeout

    let res
    try {
        res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        })
    } finally {
        clearTimeout(timeoutId)
    }

    const text = await res.text()
    let json: any = null
    try {
        json = JSON.parse(text)
    } catch {
        return { ok: false, error: `Vertex AI non-JSON response: ${res.status}`, raw: text }
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

    return {
        ok: true,
        imageBase64: foundB64,
        mimeType: foundMime,
        raw: json
    }
}
