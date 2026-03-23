import { describe, it, expect } from "vitest";
import { getTokenCategory, STABLE_EXPECTED_WARNINGS } from "../src/data/tokenCategory";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";

describe("getTokenCategory", () => {
  it("classifies USDC as stable", () => {
    expect(getTokenCategory(TOKEN_MINTS["USDC"])).toBe("stable");
  });

  it("classifies USDT as stable", () => {
    expect(getTokenCategory("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")).toBe("stable");
  });

  it("classifies SOL as major", () => {
    expect(getTokenCategory(SOL_MINT)).toBe("major");
  });

  it("classifies BONK as meme", () => {
    expect(getTokenCategory(TOKEN_MINTS["BONK"])).toBe("meme");
  });

  it("returns unknown for unrecognized mints", () => {
    expect(getTokenCategory("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("unknown");
  });
});

describe("STABLE_EXPECTED_WARNINGS", () => {
  it("includes HAS_MINT_AUTHORITY and HAS_FREEZE_AUTHORITY", () => {
    expect(STABLE_EXPECTED_WARNINGS.has("HAS_MINT_AUTHORITY")).toBe(true);
    expect(STABLE_EXPECTED_WARNINGS.has("HAS_FREEZE_AUTHORITY")).toBe(true);
  });

  it("does not include non-expected warnings", () => {
    expect(STABLE_EXPECTED_WARNINGS.has("HAS_PERMANENT_DELEGATE")).toBe(false);
    expect(STABLE_EXPECTED_WARNINGS.has("NOT_SELLABLE")).toBe(false);
  });
});
