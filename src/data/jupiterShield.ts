/**
 * Jupiter Shield API client.
 *
 * Fetches structured token safety warnings from Jupiter's Ultra API.
 * 16 warning types with severity (info/warning/critical).
 *
 * Response format (verified against real endpoint 2026-03-19,
 * sample responses saved in test/fixtures/jupiter-shield-samples.json):
 *   GET /ultra/v1/shield?mints=<mint1>,<mint2>
 *   → { warnings: { [mint: string]: Array<{ type, message, severity }> } }
 *   Clean tokens return empty arrays. Missing/unknown mints are omitted.
 *
 * Requires JUPITER_API_KEY — same key used for quotes.
 * Returns null per-token if the API is down or unconfigured (fail-open).
 */

export interface JupiterShieldWarning {
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface JupiterShieldResult {
  /** Mint address this result is for. */
  mint: string;
  /** Warnings for this token. Empty array = clean. */
  warnings: JupiterShieldWarning[];
}

const SHIELD_URL = "https://api.jup.ag/ultra/v1/shield";
const SHIELD_TIMEOUT_MS = 3000;

/**
 * Fetch Jupiter Shield warnings for one or more mint addresses.
 *
 * Returns a map of mint → warnings. Missing mints are omitted.
 * Returns null if the API key is unset or the call fails.
 */
export async function fetchJupiterShield(
  mints: string[],
): Promise<Map<string, JupiterShieldResult> | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) return null;
  if (mints.length === 0) return null;

  const url = `${SHIELD_URL}?mints=${mints.join(",")}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHIELD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      warnings?: Record<string, JupiterShieldWarning[]>;
    };

    if (!data.warnings) return null;

    const results = new Map<string, JupiterShieldResult>();
    for (const [mint, warnings] of Object.entries(data.warnings)) {
      results.set(mint, { mint, warnings: warnings ?? [] });
    }

    return results;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
