import { AnalysisResult } from "./analyze"

export type CompositionPlan = {
    crop: {
        enabled: boolean
        instruction: string
    }
    subjectRatio: {
        target: number
        instruction: string
    }
    verticals: {
        fix: boolean
        instruction: string
    }
    distractions: {
        items: string[]
        instruction: string
    }
    allowedChanges: {
        composition: number // e.g. 0.15 for 15%
        outpaint: number // e.g. 0.18
    }
    summaryInstruction: string
}

export function createCompositionPlan(analysis: AnalysisResult): CompositionPlan {
    const isArchitecture = ["exterior", "hotel_lobby", "hotel_room", "bathroom", "meeting_room"].includes(analysis.category)
    const isPortrait = analysis.people === "some"

    // 1. Verticals
    const fixVerticals = analysis.tilt !== "none" || isArchitecture

    // 2. Subject Ratio
    const currentRatio = analysis.subjectRatio || 0.5

    // In Phase 1.2 (Emergency Fix), we DISABLE all ratio-based adjustments.
    // The target is exactly what is there now.
    let targetRatio = currentRatio
    const needsRatioFix = false

    // 3. Distractions
    const distractions = analysis.distractions || []

    // 4. Crop logic
    // We only crop for explicit distractions. Ratio and tilt (horizontal/vertical) 
    // are ignored in this baseline to prevent the model from reframing the scene.
    const shouldCrop = distractions.length > 0

    let summary = `Recompose image. `
    if (fixVerticals) summary += `Straighten vertical lines. `
    if (shouldCrop) summary += `Adjust framing to balance the subject. `
    if (distractions.length > 0) summary += `Remove clutter: ${distractions.join(", ")}. `

    return {
        crop: {
            enabled: shouldCrop,
            instruction: `Crop to balance the composition, keeping the ${analysis.subjectDescription} as the clear focus.`
        },
        subjectRatio: {
            target: targetRatio,
            instruction: `Ensure the ${analysis.subjectDescription} occupies approx ${Math.round(targetRatio * 100)}% of the frame.`
        },
        verticals: {
            fix: fixVerticals,
            instruction: fixVerticals ? "Ensure all vertical lines (walls, windows, pillars) are perfectly specific straight and parallel." : ""
        },
        distractions: {
            items: distractions,
            instruction: distractions.length > 0 ? `Remove these specific items: ${distractions.join(", ")}.` : "Ensure a clean, clutter-free environment."
        },
        allowedChanges: {
            composition: 0.20, // 20% flexibility
            outpaint: 0.10 // 10% outpaint margin
        },
        summaryInstruction: summary.trim()
    }
}
