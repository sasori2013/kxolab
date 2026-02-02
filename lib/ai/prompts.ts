
import { buildPromptDirectEnhancement as buildV2 } from "./prompts-v2"
import { AnalysisResult } from "./analyze"

/** 
 * LEGACY PROMPT BUILDER
 * This file is deprecated. All logic has moved to prompts-v2.ts.
 * We now redirect all calls to v2 to ensure consistent geometric mandates.
 */

export function buildPromptDirectEnhancement(analysis: AnalysisResult): string {
  return buildV2(analysis)
}

/** @deprecated Use buildPromptDirectEnhancement */
export function buildUnifiedPrompt(analysis: any) {
  return buildV2(analysis)
}