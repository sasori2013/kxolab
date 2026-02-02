
import { NextResponse } from "next/server"
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

        let outputBuffer: Buffer

        // 2. Check if it needs HEIC conversion
        // We assume it's HEIC if the URL ends in .heic OR content-type is heic
        // But simplest is to just try converting if the buffer signature matches or just allow logic based on request.
        // For now, we'll blindly attempt conversion if filename indicates heic, or just assume input IS heic because this endpoint is for that.

        // Actually, let's look at the buffer/conversion.
        // heic-convert expects HEIC buffer.

        console.log("Thumbnail generation: Converting HEIC...")
        const jpegBuffer = await convert({
            buffer: buffer,
            format: 'JPEG',
            quality: 0.8
        })

        // 3. Resize with Sharp to create a thumbnail (save bandwidth/latency)
        outputBuffer = await sharp(jpegBuffer)
            .resize(800, 800, { fit: "inside", withoutEnlargement: true })
            .toFormat("jpeg", { quality: 85 })
            .toBuffer()

        // 4. Return the image with long cache headers
        // Use standard Response for binary data to avoid Type issues with NextResponse and Buffer
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
