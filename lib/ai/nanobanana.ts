import sharp from "sharp"

export type NanoBananaGenerateArgs = {
  imageUrl: string
  prompt: string
  strength: number
  rewrite: number
  seed?: number
  model?: string // Optional model override
  temperature?: number
  category?: string
  resolution?: "2K" | "4K"
  aspectRatio?: string
  referenceImageUrls?: string[]
}


export type NanoBananaResult = {
  ok: true
  imageBase64?: string
  imageUrl?: string
  mimeType?: string
  raw?: any
}

export type NanoBananaError = { ok: false; error: string; raw?: any }

export async function nanoBananaGenerate(args: NanoBananaGenerateArgs): Promise<NanoBananaResult | NanoBananaError> {
  try {
    // Dynamic import of the isolated client
    const { internalNanoBananaGenerate } = await import("./google-client")
    return await internalNanoBananaGenerate(args)
  } catch (e: any) {
    console.error("Vertex AI Generate Error", e)
    return { ok: false, error: e?.message ?? "Vertex AI generate failed" }
  }
}