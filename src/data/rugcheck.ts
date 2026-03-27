import { isRealApiKey } from "./apiKeyCheck";

/**
 * A single risk flag from Rugcheck.
 */
export interface RugcheckRisk {
  name: string;
  level: string;
  description: string;
  score: number;
}

/**
 * Summary of a Rugcheck token report.
 *
 * Core fields (score, risks) are always present when the API responds.
 * Extended fields are parsed when available but optional — they provide
 * richer context for the token safety rule without being required.
 *
 * IMPORTANT: `score` is the normalized 0-100 score that Rugcheck displays
 * to humans (from `score_normalised` in the API). This is the policy-
 * decisioning field. `scoreRaw` is the additive total (can be >>100)
 * kept only for debug/evidence.
 */
export interface RugcheckResult {
  /** Normalized risk score 0-100 (from Rugcheck's score_normalised). */
  score: number;
  /** Raw additive risk score from Rugcheck (can be >>100, debug only). */
  scoreRaw?: number;
  /** Top risk flags with details. */
  risks: RugcheckRisk[];
  /** Human-readable risk level from Rugcheck (e.g. "good", "warn", "danger"). */
  riskLevel?: string;
  /** Mint authority address, or null if renounced. */
  mintAuthority?: string | null;
  /** Freeze authority address, or null if renounced. */
  freezeAuthority?: string | null;
  /** Whether LP tokens are locked. */
  lpLocked?: boolean;
  /** Percentage of LP locked (0–100). */
  lpLockedPct?: number | null;
  /** Percentage held by top holders. */
  topHoldersPct?: number | null;
}

const RUGCHECK_API_URL = "https://api.rugcheck.xyz/v1/tokens";
const RUGCHECK_TIMEOUT_MS = 3000;

/**
 * Fetch a token risk summary from Rugcheck for a single mint address.
 *
 * The Rugcheck API works without an API key (public endpoint).
 * When RUGCHECK_API_KEY is set, it's sent for better rate limits.
 *
 * Returns null if the API responded but had no useful data (e.g. missing score).
 * Throws on transport failures (network error, timeout, HTTP 5xx) so the caller
 * can detect degraded state.
 */
export async function fetchRugcheckReport(
  mint: string,
): Promise<RugcheckResult | null> {
  const url = `${RUGCHECK_API_URL}/${mint}/report/summary`;

  const headers: Record<string, string> = { "Accept": "application/json" };
  const apiKey = process.env.RUGCHECK_API_KEY;
  if (apiKey && isRealApiKey(apiKey)) {
    headers["X-API-KEY"] = apiKey;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUGCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Rugcheck API returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Prefer score_normalised (0-100, what Rugcheck shows to humans).
    // Fall back to raw score only if normalized is missing.
    const scoreNorm = typeof data.score_normalised === "number" ? data.score_normalised : null;
    const scoreRaw = typeof data.score === "number" ? data.score : null;
    const score = scoreNorm ?? scoreRaw;
    if (score === null) return null;

    const rawRisks = Array.isArray(data.risks) ? data.risks : [];
    const risks: RugcheckRisk[] = rawRisks
      .filter((r: unknown): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && "name" in r,
      )
      .slice(0, 5) // Keep top 5 risks for context
      .map((r) => ({
        name: String(r.name ?? ""),
        level: String(r.level ?? ""),
        description: String(r.description ?? ""),
        score: typeof r.score === "number" ? r.score : 0,
      }));

    // Parse extended fields when available
    const result: RugcheckResult = { score, risks };
    if (scoreRaw != null) result.scoreRaw = scoreRaw;

    if (typeof data.riskLevel === "string") result.riskLevel = data.riskLevel;
    if ("mintAuthority" in data) result.mintAuthority = typeof data.mintAuthority === "string" ? data.mintAuthority : null;
    if ("freezeAuthority" in data) result.freezeAuthority = typeof data.freezeAuthority === "string" ? data.freezeAuthority : null;
    if (typeof data.lpLocked === "boolean") result.lpLocked = data.lpLocked;
    if (typeof data.lpLockedPct === "number") result.lpLockedPct = data.lpLockedPct;
    if (typeof data.topHoldersPct === "number") result.topHoldersPct = data.topHoldersPct;

    return result;
  } finally {
    clearTimeout(timeout);
  }
}
