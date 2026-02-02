import { AnalysisResult } from "./analyze"

/**
 * Builds a prompt for "Direct Enhancement" mode.
 * We now favor user-provided prompts, but this provides a baseline style
 * if no custom prompt is available or as a consistent prefix.
 */
export function buildPromptDirectEnhancement(_analysis: AnalysisResult): string {
  // Simplified for Direct User Control
  // The logic in the worker now primarily uses payload.body.prompt
  return "High-end commercial photography, professional lighting, sharp focus, magazine quality."
}

// Backward compatibility
export function buildPromptRecompose(analysis: AnalysisResult, _plan: any): string {
  return buildPromptDirectEnhancement(analysis)
}

export function buildPromptPolish(analysis: AnalysisResult): string {
  return buildPromptDirectEnhancement(analysis)
}
