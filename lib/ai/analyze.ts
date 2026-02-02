// lib/ai/analyze.ts
import { isCategory, type Category } from "./categories"

export type Brightness = "dark" | "normal" | "bright"
export type People = "none" | "some"

export type AnalysisResult = {
  ok: true
  category: Category
  subjectDescription?: string
  confidence: number
  brightness: Brightness
  people: People
  tilt: "none" | "left" | "right" | "perspective"
  symmetry: "none" | "potential"
  subjectRatio?: number
  distractions?: string[]
  visualStrategy: string
  debug?: {
    raw: string
    bytes: number
    mimeType: string
    model: string
  }
}

export type AnalysisError = { ok: false; error: string }

// Helper types are exported for use in client
export { isCategory } from "./categories"

export async function analyzeImageFromUrl(imageUrl: string, debug = false): Promise<AnalysisResult | AnalysisError> {
  try {
    // Dynamic import of the isolated client
    const { internalAnalyzeImageFromUrl } = await import("./gemini-client")
    return await internalAnalyzeImageFromUrl(imageUrl, debug)
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "analyze failed" }
  }
}