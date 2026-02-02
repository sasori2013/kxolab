import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  const sessionId = crypto.randomUUID()
  const ttlSeconds = Number(process.env.SESSION_TTL_SECONDS || "900") // 15分(保険)

  return NextResponse.json({ sessionId, ttlSeconds })
}