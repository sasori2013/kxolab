import { fal } from "@fal-ai/client"
import type { NanoBananaGenerateArgs, NanoBananaResult, NanoBananaError } from "./nanobanana"

// Configure Fal.ai credentials
if (process.env.FAL_KEY) {
    fal.config({
        credentials: process.env.FAL_KEY,
    })
}

export async function internalNanoBananaGenerate(args: NanoBananaGenerateArgs): Promise<NanoBananaResult | NanoBananaError> {
    // Model selection
    let model = "fal-ai/nano-banana-pro"

    if (process.env.FAL_MODEL) {
        model = process.env.FAL_MODEL
    }

    console.log(`[Fal.ai] Generatig with model: ${model}`)

    // 1. Fetch image and convert to Data URI
    let imageUrlInput = args.imageUrl
    let closestRatio = "1:1" // Default for Nano Banana if calc fails

    try {
        if (!imageUrlInput.startsWith("data:")) {
            const resp = await fetch(imageUrlInput)
            if (!resp.ok) throw new Error(`Failed to fetch input image: ${resp.status}`)
            const buf = await resp.arrayBuffer()

            // Resize to 2K (max 2048px on long edge)
            const sharp = (await import("sharp")).default
            const image = sharp(Buffer.from(buf))
            const meta = await image.metadata()

            // Calculate Aspect Ratio for Nano Banana Pro
            if (meta.width && meta.height) {
                const ratio = meta.width / meta.height
                const supportedRatios = {
                    "21:9": 21 / 9,
                    "16:9": 16 / 9,
                    "3:2": 3 / 2,
                    "4:3": 4 / 3,
                    "5:4": 5 / 4,
                    "1:1": 1 / 1,
                    "4:5": 4 / 5,
                    "3:4": 3 / 4,
                    "2:3": 2 / 3,
                    "9:16": 9 / 16
                }

                let minDiff = Infinity
                for (const [key, val] of Object.entries(supportedRatios)) {
                    const diff = Math.abs(ratio - val)
                    if (diff < minDiff) {
                        minDiff = diff
                        closestRatio = key
                    }
                }
                console.log(`[Fal.ai] Calculated Ratio: ${ratio.toFixed(2)} -> Closest: ${closestRatio}`)
            }

            const resizedBuf = await image
                .rotate()
                .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: false }) // false to allow upscaling
                .toBuffer()

            const b64 = resizedBuf.toString("base64")
            const mime = "image/png"
            imageUrlInput = `data:${mime};base64,${b64}`
        }
    } catch (e) {
        console.warn("[Fal.ai] Failed to resize/convert/analyze image.", e)
    }

    try {
        // 2. Submit request to Fal.ai
        console.log(`[Fal.ai] Requesting Nano Banana Pro: strength=${args.strength}, ratio=${closestRatio}`)
        console.log(`[Fal.ai] Payload:`, JSON.stringify({
            prompt: args.prompt,
            image_url: imageUrlInput ? "(base64 data)" : "null",
            strength: args.strength,
            aspect_ratio: closestRatio,
        }, null, 2))

        const result: any = await fal.subscribe(model, {
            input: {
                prompt: args.prompt,
                image_url: imageUrlInput,
                strength: args.strength,
                aspect_ratio: closestRatio,
            },
            logs: true,
            onQueueUpdate: (update: any) => {
                if (update.status === 'IN_PROGRESS' && update.logs) {
                    update.logs.map((log: any) => log.message).forEach((msg: any) => console.log(`[Fal.ai LOG] ${msg}`));
                }
            },
        })

        // 3. Parse result
        let outUrl: string | undefined

        // Handle Nano Banana Pro specific structure: { data: { images: [...] } }
        if (result.data?.images && Array.isArray(result.data.images) && result.data.images.length > 0) {
            outUrl = result.data.images[0].url
        }
        // Handle standard Fal structure: { images: [...] }
        else if (result.images && Array.isArray(result.images) && result.images.length > 0) {
            outUrl = result.images[0].url
        } else if (result.image && result.image.url) {
            outUrl = result.image.url
        } else if (typeof result === 'object' && result !== null) {
            const potentialUrl = Object.values(result).find((v: any) => typeof v === 'string' && v.startsWith('http')) as string
            if (potentialUrl) outUrl = potentialUrl
        }

        if (!outUrl) {
            console.error("[Fal.ai] Unexpected response format:", JSON.stringify(result, null, 2))
            return { ok: false, error: "No image URL in Fal.ai response", raw: result }
        }

        return {
            ok: true,
            imageUrl: outUrl,
            raw: result
        }

    } catch (error: any) {
        console.error("[Fal.ai] Execution Error:", error)
        return { ok: false, error: error.message || "Fal.ai execution failed", raw: error }
    }
}
