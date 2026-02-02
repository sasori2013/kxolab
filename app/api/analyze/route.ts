// app/api/analyze/route.ts
import { NextResponse } from "next/server"
import { analyzeImageFromUrl } from "@/lib/ai/analyze"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const imageUrl = String(body?.imageUrl ?? "")
    const debug = Boolean(body?.debug)

    if (!imageUrl) {
      return NextResponse.json({ ok: false, error: "imageUrl is required" }, { status: 400 })
    }

    const analyzed = await analyzeImageFromUrl(imageUrl, debug)
    return NextResponse.json(analyzed, { status: analyzed.ok ? 200 : 500 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "analyze route failed" }, { status: 500 })
  }
}