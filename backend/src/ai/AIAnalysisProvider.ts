import { AIAnalysisContext, AIAnalysisResult } from '@/types/ai';

/**
 * Provider-agnostic AI analysis interface, mirroring the ISectorProvider
 * pattern (src/providers/SectorProvider.ts) — the rest of the application
 * depends on this interface, never on a specific vendor SDK, so the
 * implementation can be swapped without touching callers. See
 * AnthropicAnalysisProvider.ts for the current implementation.
 */
export interface AIAnalysisProvider {
  readonly name: string;
  analyze(context: AIAnalysisContext): Promise<AIAnalysisResult>;
}
