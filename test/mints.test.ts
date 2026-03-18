import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isMintAddress,
  getTokenDecimals,
  resolveDecimals,
  parsePairSymbols,
  resolveSymbolToMint,
  TOKEN_MINTS,
  SOL_MINT,
} from "../src/data/mints";
import { clearDecimalsCache } from "../src/data/solana";

describe("isMintAddress", () => {
  it("recognizes a valid Solana mint address", () => {
    expect(isMintAddress("So11111111111111111111111111111111111111112")).toBe(true);
  });

  it("recognizes a typical 44-char base58 address", () => {
    expect(isMintAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
  });

  it("rejects short strings", () => {
    expect(isMintAddress("SOL")).toBe(false);
  });

  it("rejects strings with invalid base58 characters (0, O, I, l)", () => {
    expect(isMintAddress("0O1111111111111111111111111111111111111112")).toBe(false);
    expect(isMintAddress("Il1111111111111111111111111111111111111112")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isMintAddress("")).toBe(false);
  });
});

describe("getTokenDecimals", () => {
  it("returns 9 for SOL mint", () => {
    expect(getTokenDecimals(SOL_MINT)).toBe(9);
  });

  it("returns 6 for USDC mint", () => {
    expect(getTokenDecimals(TOKEN_MINTS["USDC"])).toBe(6);
  });

  it("returns 6 for unknown mints", () => {
    expect(getTokenDecimals("UnknownMint11111111111111111111111111111111")).toBe(6);
  });
});

describe("resolveSymbolToMint", () => {
  it("resolves known symbol to mint address", () => {
    expect(resolveSymbolToMint("SOL")).toBe(SOL_MINT);
    expect(resolveSymbolToMint("USDC")).toBe(TOKEN_MINTS["USDC"]);
  });

  it("is case-insensitive for symbols", () => {
    expect(resolveSymbolToMint("sol")).toBe(SOL_MINT);
    expect(resolveSymbolToMint("usdc")).toBe(TOKEN_MINTS["USDC"]);
  });

  it("passes through mint addresses directly", () => {
    const mint = "CqfkEoMDz7SVQ8HbKR13bDQjav3jkHPsGK8MZJtPvMz";
    expect(resolveSymbolToMint(mint)).toBe(mint);
  });

  it("returns null for unknown symbols", () => {
    expect(resolveSymbolToMint("FAKECOIN")).toBeNull();
  });
});

describe("parsePairSymbols", () => {
  it("parses standard pair", () => {
    expect(parsePairSymbols("SOL/USDC")).toEqual({ input: "SOL", output: "USDC" });
  });

  it("trims whitespace", () => {
    expect(parsePairSymbols(" SOL / USDC ")).toEqual({ input: "SOL", output: "USDC" });
  });

  it("uppercases both sides", () => {
    expect(parsePairSymbols("sol/usdc")).toEqual({ input: "SOL", output: "USDC" });
  });

  it("returns null for string without separator", () => {
    expect(parsePairSymbols("SOLUSDC")).toBeNull();
  });

  it("returns null for too many separators", () => {
    expect(parsePairSymbols("SOL/USDC/BONK")).toBeNull();
  });
});

describe("resolveDecimals", () => {
  afterEach(() => {
    clearDecimalsCache();
    vi.restoreAllMocks();
  });

  it("returns hardcoded decimals for SOL without RPC call", async () => {
    const result = await resolveDecimals(SOL_MINT);
    expect(result).toBe(9);
  });

  it("returns hardcoded decimals for USDC without RPC call", async () => {
    const result = await resolveDecimals(TOKEN_MINTS["USDC"]);
    expect(result).toBe(6);
  });

  it("returns null for unknown mint when SOLANA_RPC_URL is not set", async () => {
    delete process.env.SOLANA_RPC_URL;
    const result = await resolveDecimals("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(result).toBeNull();
  });

  it("fetches decimals on-chain for unknown mint", async () => {
    // Build a fake 82-byte SPL Token Mint account with decimals = 5
    const mintData = Buffer.alloc(82);
    mintData[44] = 5; // decimals byte
    mintData[45] = 1; // is_initialized
    const base64Data = mintData.toString("base64");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { value: { data: [base64Data, "base64"] } },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    process.env.SOLANA_RPC_URL = "https://fake-rpc.example.com";

    const result = await resolveDecimals("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(result).toBe(5);
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second call should use cache, not RPC
    const cached = await resolveDecimals("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(cached).toBe(5);
    expect(mockFetch).toHaveBeenCalledOnce(); // still 1 call

    delete process.env.SOLANA_RPC_URL;
  });

  it("returns null when RPC returns no account data", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { value: null } }),
    });
    vi.stubGlobal("fetch", mockFetch);
    process.env.SOLANA_RPC_URL = "https://fake-rpc.example.com";

    const result = await resolveDecimals("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(result).toBeNull();

    delete process.env.SOLANA_RPC_URL;
  });

  it("returns null when RPC call fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", mockFetch);
    process.env.SOLANA_RPC_URL = "https://fake-rpc.example.com";

    const result = await resolveDecimals("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    expect(result).toBeNull();

    delete process.env.SOLANA_RPC_URL;
  });
});
