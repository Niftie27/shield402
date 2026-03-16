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
 */
export interface RugcheckResult {
  /** Aggregate risk score (0 = safe, higher = riskier). */
  score: number;
  /** Top risk flags with details. */
  risks: RugcheckRisk[];
}

const RUGCHECK_API_URL = "https://api.rugcheck.xyz/v1/tokens";
const RUGCHECK_TIMEOUT_MS = 3000;

/**
 * Fetch a token risk summary from Rugcheck for a single mint address.
 *
 * Returns null if:
 * - API key is not set
 * - the request fails or times out
 *
 * Never throws.
 */
export async function fetchRugcheckReport(
  mint: string,
): Promise<RugcheckResult | null> {
  const apiKey = process.env.RUGCHECK_API_KEY;
  if (!apiKey) return null;

  const url = `${RUGCHECK_API_URL}/${mint}/report/summary`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUGCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "X-API-KEY": apiKey },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;

    const score = typeof data.score === "number" ? data.score : null;
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

    return { score, risks };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
