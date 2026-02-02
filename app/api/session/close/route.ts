import { NextResponse } from "next/server"
import { r2, R2_BUCKET } from "../../../../lib/r2"
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3"

export const runtime = "nodejs" // ← これが最重要

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sessionId = body?.sessionId

    if (!sessionId) {
      return NextResponse.json({ ok: true })
      // セッションIDがなくても失敗扱いにしない（UX優先）
    }

    const prefix = `private/sessions/${sessionId}/`

    // 1. 一覧取得
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
      })
    )

    const objects =
      list.Contents?.map((o) => ({ Key: o.Key! })) ?? []

    if (objects.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 })
    }

    // 2. 削除
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: objects },
      })
    )

    return NextResponse.json({
      ok: true,
      deleted: objects.length,
    })
  } catch (err) {
    // 失敗しても UX を壊さない
    console.error("[session/close] cleanup failed:", err)
    return NextResponse.json({ ok: true })
  }
}