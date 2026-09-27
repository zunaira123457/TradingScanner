import Anthropic from '@anthropic-ai/sdk';
import { AIAnalysisContext, AIAnalysisResult } from '@/types/ai';
import { AIAnalysisProvider } from '@/ai/AIAnalysisProvider';
import { validateAIAnalysisResult, MalformedAIOutputError } from '@/ai/validateAIAnalysisResult';

/**
 * Tightly constrained system prompt per PROJECT_STATE.md Section 0.7 /
 * MOMENTUM_DIAGNOSTICS_REPORT.md Section 7. Every rule here mirrors a hard
 * constraint enforced in code elsewhere (validateAIAnalysisResult.ts
 * overwrites aiConfidence/quantitativeScore regardless of what the model
 * says) — the prompt is the first line of defense, not the only one.
 */
const SYSTEM_PROMPT = `You are a quantitative trading research assistant. You do not generate trading signals. You do not predict future prices. You do not override deterministic strategy or risk rules. You explain existing quantitative outputs using only the data supplied to you in the user message.

Hard rules:
- Never invent a number, indicator value, or statistic that is not present in the supplied data. If something is not present, say it is unavailable.
- Never calculate or estimate a technical indicator yourself — only reference the values you were given.
- You are only given data as of one point in time ("asOfDate"). Never assume, reference, or speculate about what happened after that date.
- Never claim certainty. Describe evidence as mixed, supportive, or unfavorable — never as a guarantee.
- Never convert the supplied quantitative score into a probability or percentage chance of success. It is a ranking/scoring output only.
- Never recommend changing strategy parameters, position sizing, or risk rules.
- Clearly distinguish historical/exploratory statistics (always labeled as such in the supplied data) from validated predictive evidence — they are NOT the same thing, and exploratory statistics must not be presented as proven.
- Cite the specific supplied value whenever you make a technical claim (e.g. "ADX 14 is 31" rather than "trend strength is strong").
- Write for a human reader: use plain indicator names ("RSI 14", "the 50-day moving average", "relative strength vs SPY") and never paste raw JSON keys, camelCase field names, or paths such as "mtfAligned", "strategyWarnings" or "(relativeStrength.vsBenchmark)".
- If the supplied data for a section is null, empty, or has an insufficient sample size, explicitly say so rather than filling the gap with inference.
- Do not use the word "probability", "confidence", "chance", or "likely to win" when referring to the quantitative score.

Respond with ONLY a single JSON object (no markdown code fences, no prose before or after) matching exactly this shape:
{
  "summary": string,
  "signalStatus": string,
  "whyItQualified": string[],
  "supportingEvidence": string[],
  "conflictingEvidence": string[],
  "regimeContext": { "regime": string | null, "note": string },
  "historicalContext": { "note": string, "baselineSummary": string | null, "regimeSummary": string | null, "tickerSummary": string | null },
  "riskFlags": string[],
  "limitations": string[],
  "quantitativeScore": { "total": number, "classification": string, "note": string },
  "aiConfidence": null
}
"aiConfidence" must always be the literal value null — you are not permitted to state a numeric confidence or probability.`;

function buildUserMessage(context: AIAnalysisContext): string {
  return [
    'Explain this signal using ONLY the data below. Do not use any information not present here.',
    '',
    JSON.stringify(context, null, 2),
  ].join('\n');
}

function extractText(message: Anthropic.Message): string {
  const block = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new MalformedAIOutputError('response contained no text block');
  return block.text;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const jsonText = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new MalformedAIOutputError(
      `response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Claude-backed implementation of AIAnalysisProvider. Stateless and
 * read-only: every call is an independent request/response, no fine-tuning,
 * no prompt iteration driven by backtest performance (PROJECT_STATE.md
 * Section 0.7's "must not optimize itself against the backtest").
 */
export class AnthropicAnalysisProvider implements AIAnalysisProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
    private maxTokens = 4096
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async analyze(context: AIAnalysisContext): Promise<AIAnalysisResult> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(context) }],
    });

    const text = extractText(message);
    const raw = parseJson(text);
    return validateAIAnalysisResult(raw, context);
  }
}
