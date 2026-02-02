
import { AnalysisResult } from "./analyze"
import { getGeminiClient } from "./gemini-client"

export type CandidateScore = {
    url: string
    totalScore: number
    details: {
        subjectCutoff: number // 0-10 (10 = perfect framing, 0 = subject cut off)
        verticals: number // 0-10
        ratioMatch: number // 0-10 (how close to target ratio)
        cleanliness: number // 0-10
        consistency: number // 0-10 (looks like same place/subject)
    }
    reasoning: string
}

export async function scoreCandidates(
    candidates: string[], // URLs
    originalUrl: string,
    originalAnalysis: AnalysisResult,
    targetRatio: number
): Promise<CandidateScore[]> {
    const scores: CandidateScore[] = []

    // Parallelize scoring if possible, or sequential
    // For MVP, let's do sequential to avoid rate limits on Gemini Flash
    for (const url of candidates) {
        try {
            const score = await scoreSingleCandidate(url, originalUrl, originalAnalysis, targetRatio)
            scores.push(score)
        } catch (e) {
            console.error(`Failed to score candidate ${url}:`, e)
            // Push a default low score so we don't crash
            scores.push({
                url,
                totalScore: 0,
                details: { subjectCutoff: 0, verticals: 0, ratioMatch: 0, cleanliness: 0, consistency: 0 },
                reasoning: "Scoring failed"
            })
        }
    }

    // Sort by total score descending
    return scores.sort((a, b) => b.totalScore - a.totalScore)
}

async function scoreSingleCandidate(
    candidateUrl: string,
    originalUrl: string,
    original: AnalysisResult,
    targetRatio: number
): Promise<CandidateScore> {
    const genAI = await getGeminiClient()
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.0-flash" })

    // Fetch both images
    const [resCand, resOrig] = await Promise.all([
        fetch(candidateUrl),
        fetch(originalUrl)
    ])
    const [bufCand, bufOrig] = await Promise.all([
        resCand.arrayBuffer(),
        resOrig.arrayBuffer()
    ])

    const b64Cand = Buffer.from(bufCand).toString("base64")
    const b64Orig = Buffer.from(bufOrig).toString("base64")

    const prompt = `You are a strict photo editor. Compare the [CANDIDATE] image against the [ORIGINAL] image.
    
REQUIREMENTS:
1. The [CANDIDATE] must be in the EXACT SAME room/location as the [ORIGINAL].
2. The furniture, flooring, and background elements must NOT change (except for removal of clutter).
3. The main subject (${original.subjectDescription}) must be preserved in identity.
4. Target Subject Ratio: ${targetRatio}

Rate the [CANDIDATE] on these 5 criteria (0-10 scale):
1. Subject Cutoff: Is the main subject fully visible? (10=perfect, 0=badly cropped)
2. Verticals: Are vertical lines straight? (10=perfect/parallel, 0=tilted/distorted)
3. Ratio Match: Does the subject occupy approx ${targetRatio * 100}% of the frame? (10=perfect match, 0=too small/too big)
4. Cleanliness: Is the image free of artifacts/glitches? (10=clean, 0=glitchy)
5. Consistency: IS IT THE SAME ROOM, FURNITURE, AND ITEM COUNT? (10=Identical setting, item separation, and colors. 0=Background/furniture replaced, items merged/added/moved, or dish colors changed). This is CRITICAL. NO EXTRA BOWLS, NO MERGED DISHES, NO COLOR DRIFT.

Return JSON:
{
  "subjectCutoff": 0,
  "verticals": 0,
  "ratioMatch": 0,
  "cleanliness": 0,
  "consistency": 0,
  "reasoning": "short explanation"
}`

    const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: "image/png", data: b64Orig } }, // Original first
        { inlineData: { mimeType: "image/png", data: b64Cand } }  // Candidate second
    ])

    const text = result.response.text()
    const jsonMatch = text.match(/{[\s\S]*}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

    const details = {
        subjectCutoff: Number(parsed.subjectCutoff || 0),
        verticals: Number(parsed.verticals || 0),
        ratioMatch: Number(parsed.ratioMatch || 0),
        cleanliness: Number(parsed.cleanliness || 0),
        consistency: Number(parsed.consistency || 0)
    }

    // Weighted Total: Consistency (setting preservation) is now a MANDATORY GATE.
    // If consistency is low, the whole score drops drastically.
    const subtotal = (
        details.subjectCutoff * 0.3 +
        details.verticals * 0.25 +
        details.cleanliness * 0.25 +
        details.ratioMatch * 0.2
    )

    // Multiplier effect: 0 consistency = 0 score. 10 consistency = full subtotal.
    const totalScore = subtotal * (details.consistency / 10)

    return {
        url: candidateUrl,
        totalScore,
        details,
        reasoning: parsed.reasoning || "No reasoning"
    }
}
