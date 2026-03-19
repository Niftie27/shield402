/**
 * Jupiter Tokens V2 API client.
 *
 * Fetches rich token metadata including liquidity, organic score,
 * verification status, and audit data.
 *
 * Used for:
 * - Liquidity depth checks (trade size vs total token liquidity)
 * - Organic activity scoring
 * - Verification status
 *
 * Requires JUPITER_API_KEY.
 * Returns null if the API is down or unconfigured (fail-open).
 */

export interface JupiterTokenAudit {
  mintAuthorityDisabled?: boolean;
  freezeAuthorityDisabled?: boolean;
  topHoldersPercentage?: number;
  devBalancePercentage?: number;
  devMints?: number;
  botHoldersPercentage?: number;
}

export interface JupiterTokenResult {
  mint: string;
  symbol?: string;
  isVerified?: boolean;
  organicScore?: number;
  organicScoreLabel?: string;
  liquidity?: number;
  holderCount?: number;
  fdv?: number;
  audit?: JupiterTokenAudit;
  tags?: string[];
}

const TOKENS_V2_URL = "https://api.jup.ag/tokens/v2/search";
const TOKENS_TIMEOUT_MS = 3000;

/**
 * Fetch token metadata from Jupiter Tokens V2 API.
 *
 * Searches by mint address. Returns the first matching result.
 * Returns null if the API key is unset, the call fails, or no match found.
 */
export async function fetchJupiterToken(
  mint: string,
): Promise<JupiterTokenResult | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) return null;

  const url = `${TOKENS_V2_URL}?query=${mint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKENS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Array<Record<string, unknown>>;

    if (!Array.isArray(data) || data.length === 0) return null;

    const token = data[0];

    return {
      mint,
      symbol: token.symbol as string | undefined,
      isVerified: token.isVerified as boolean | undefined,
      organicScore: token.organicScore as number | undefined,
      organicScoreLabel: token.organicScoreLabel as string | undefined,
      liquidity: token.liquidity as number | undefined,
      holderCount: token.holderCount as number | undefined,
      fdv: token.fdv as number | undefined,
      audit: token.audit as JupiterTokenAudit | undefined,
      tags: token.tags as string[] | undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
