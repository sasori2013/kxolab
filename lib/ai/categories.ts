// lib/ai/categories.ts
export const CATEGORIES = [
  "hotel_room",
  "hotel_lobby",
  "restaurant",
  "cafe",
  "spa",
  "pool",
  "gym",
  "bathroom",
  "meeting_room",
  "exterior",
  "food",
  "other",
] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v)
}