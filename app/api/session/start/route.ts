import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  const sessionId = `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`
  const ttlSeconds = Number(process.env.SESSION_TTL_SECONDS || "900") // 15分(保険)

  return NextResponse.json({ sessionId, ttlSeconds })
}