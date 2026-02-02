
import { NextResponse } from "next/server"
// @ts-ignore
import convert from "heic-convert"
import sharp from "sharp"

export const runtime = "nodejs"
// Increase max duration if possible, though Vercel Hobby is limited. 
// Conversion can be slow, so we set a reasonable cache.
export const maxDuration = 30

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const url = searchParams.get("url")

    if (!url) {
        return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
    }

    try {
        // 1. Fetch the remote image
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // 2. Process image (convert HEIC if needed, then resize)
        let outputBuffer: Buffer
        const { isHeic } = await import("@/lib/ai/image-helper")

        let jpegBuffer: Buffer
        if (isHeic(buffer)) {
            console.log("Thumbnail generation: Converting HEIC...")
            jpegBuffer = await convert({
                buffer: buffer,
                format: 'JPEG',
                quality: 0.8
            })
        } else {
            jpegBuffer = buffer
        }

        // 3. Resize with Sharp
        outputBuffer = await sharp(jpegBuffer)
            .resize(800, 800, { fit: "inside", withoutEnlargement: true })
            .toFormat("jpeg", { quality: 85 })
            .toBuffer()

        // 4. Return the image
        return new Response(outputBuffer as any, {
            headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        })

    } catch (e: any) {
        console.error("Thumbnail generation error:", e)
        return NextResponse.json({ error: "Thumbnail generation failed", details: e.message }, { status: 500 })
    }
}
