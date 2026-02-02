import "server-only"
// @ts-ignore
import convert from "heic-convert"

/**
 * Detects if a buffer is an HEIC/HEIF image based on magic bytes.
 */
export function isHeic(buffer: Buffer): boolean {
    if (buffer.length < 12) return false
    const brand = buffer.toString("ascii", 8, 12)
    return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)
}

/**
 * Ensures the image buffer is in a format Sharp can handle (converts HEIC to JPEG if needed).
 */
export async function ensureJpeg(buffer: Buffer): Promise<Buffer> {
    if (isHeic(buffer)) {
        console.log("[image-helper] HEIC detected, converting to JPEG on server...")
        try {
            const outputBuffer = await convert({
                buffer,
                format: "JPEG",
                quality: 0.9,
            })
            return Buffer.from(outputBuffer)
        } catch (e) {
            console.error("[image-helper] Server-side HEIC conversion failed:", e)
            // Fallback to original buffer, sharp will likely fail but we tried
            return buffer
        }
    }
    return buffer
}
