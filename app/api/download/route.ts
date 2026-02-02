// app/api/download/route.ts
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { r2, R2_BUCKET } from "@/lib/r2"
import { Readable } from "node:stream"

export const runtime = "nodejs"

function sanitizeKey(key: string) {
  // 余計な先頭スラッシュ除去
  let k = key.trim().replace(/^\/+/, "")

  // パストラバーサル防止
  if (k.includes("..")) throw new Error("Invalid key")

  // 必要なら private/ 配下だけ許可（安全）
  // ※要件に合わせて外してOK
  if (!k.startsWith("private/")) throw new Error("Invalid key (must start with private/)")

  return k
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const keyParam = url.searchParams.get("key")
    if (!keyParam) {
      return Response.json({ ok: false, error: "Missing key" }, { status: 400 })
    }

    const key = sanitizeKey(decodeURIComponent(keyParam))

    const obj = await r2.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    )

    if (!obj.Body) {
      return Response.json({ ok: false, error: "No body" }, { status: 404 })
    }

    const contentType = obj.ContentType || "application/octet-stream"

    // できるだけファイル名を自然に
    const filename = key.split("/").pop() || "download.bin"

    // AWS SDK の Body は Node Readable のことが多いので WebStream に変換
    const body =
      obj.Body instanceof Readable ? Readable.toWeb(obj.Body) : (obj.Body as unknown as ReadableStream)

    return new Response(body as any, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        // キャッシュしたくない（毎回最新）
        "Cache-Control": "no-store",
      },
    })
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "download failed" }, { status: 500 })
  }
}