import { NextResponse } from "next/server"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { r2, R2_BUCKET } from "@/lib/r2"
import sharp from "sharp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export async function GET(req: Request) {
  return NextResponse.json({ ok: true, message: "Upload API is accessible" })
}

export async function POST(req: Request) {
  try {
    const { filename, contentType, sessionId, photoId, purpose } = await req.json()

    if (!filename || !contentType) {
      return NextResponse.json({ ok: false, error: "filename and contentType required" }, { status: 400 })
    }

    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || ""
    if (!base) {
      return NextResponse.json(
        { ok: false, error: "NEXT_PUBLIC_R2_PUBLIC_BASE is missing" },
        { status: 500 },
      )
    }

    if (!R2_BUCKET) {
      console.error("Critical Error: R2_BUCKET is missing or empty")
      return NextResponse.json(
        { ok: false, error: "Server Configuration Error: R2_BUCKET env var is missing" },
        { status: 500 },
      )
    }

    // Determine extension from content-type or filename
    const ext = filename.split(".").pop() || "jpg"
    const safeKey = `private/${safeName(sessionId)}/${safeName(purpose)}/${safeName(photoId)}.${ext}`

    // Generate Presigned URL for PUT
    const signedUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: safeKey,
        ContentType: contentType,
        // CacheControl: "public, max-age=31536000, immutable", // Client should send this header if signed, but simpler to omit validation
      }),
      { expiresIn: 600 } // 10 minutes
    )

    const imageUrl = `${base.replace(/\/$/, "")}/${safeKey}`

    return NextResponse.json({
      ok: true,
      url: signedUrl, // The temporary upload URL
      key: safeKey,
      imageUrl,       // The final public URL
    })

  } catch (e: any) {
    console.error("Presign error", e)
    return NextResponse.json(
      { ok: false, error: e?.message ?? "presign failed" },
      { status: 500 },
    )
  }
}