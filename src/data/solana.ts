/**
 * On-chain data fetching via Solana JSON-RPC.
 *
 * Uses raw fetch (no SDK dependencies) to keep things simple.
 * All functions are fail-open: return null on any error.
 */

const RPC_TIMEOUT_MS = 3000;

/**
 * In-memory cache for mint decimals.
 * Decimals never change for a given mint, so caching is safe.
 */
const decimalsCache = new Map<string, number>();

/**
 * Fetch the decimals field from an SPL Token Mint account on-chain.
 *
 * SPL Token Mint account layout (82 bytes):
 *   bytes  0–3:  COption tag for mint_authority (u32 LE)
 *   bytes  4–35: mint_authority pubkey (32 bytes)
 *   bytes 36–43: supply (u64 LE)
 *   byte  44:    decimals (u8)  ← this is what we read
 *   byte  45:    is_initialized (bool)
 *   bytes 46–81: freeze_authority
 *
 * Returns null if:
 * - SOLANA_RPC_URL is not set
 * - the RPC call fails or times out
 * - the account doesn't exist or isn't a valid mint
 */
export async function fetchMintDecimals(
  mint: string,
): Promise<number | null> {
  // Check cache first
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "base64" }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = (await response.json()) as {
      result?: { value?: { data?: [string, string] } };
    };

    const data = json.result?.value?.data;
    if (!data || !Array.isArray(data) || data[1] !== "base64") return null;

    const buffer = Buffer.from(data[0], "base64");

    // Mint accounts are 82 bytes. Decimals is byte 44.
    if (buffer.length < 45) return null;

    const decimals = buffer[44];

    // Sanity check: SPL tokens have 0-18 decimals
    if (decimals > 18) return null;

    decimalsCache.set(mint, decimals);
    return decimals;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Exposed for testing — clears the in-memory decimals cache. */
export function clearDecimalsCache(): void {
  decimalsCache.clear();
}
