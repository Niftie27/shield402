import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess, spawn } from "child_process";
import { SOL_MINT, TOKEN_MINTS } from "../src/data/mints";

const USDC_MINT = TOKEN_MINTS["USDC"];

/**
 * MCP integration tests.
 *
 * Spawns the MCP server as a child process over stdio
 * and sends JSON-RPC messages to verify tool discovery
 * and invocation.
 */

let proc: ChildProcess;
let buffer = "";
let messageId = 0;

function nextId(): number {
  return ++messageId;
}

function send(method: string, params: Record<string, unknown> = {}, id?: number): number {
  const reqId = id ?? nextId();
  const msg = JSON.stringify({ jsonrpc: "2.0", id: reqId, method, params });
  proc.stdin!.write(msg + "\n");
  return reqId;
}

function sendNotification(method: string, params: Record<string, unknown> = {}): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  proc.stdin!.write(msg + "\n");
}

async function waitForResponse(id: number, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const lines = buffer.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.id === id) {
          // Remove consumed line from buffer
          lines.splice(i, 1);
          buffer = lines.join("\n");
          return parsed;
        }
      } catch {
        // Not valid JSON yet, skip
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout waiting for response id=${id}`);
}

beforeAll(async () => {
  proc = spawn("npx", ["tsx", "src/mcp/server.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
    // Empty string is falsy — disables live data fetching and RPC calls in child process
    env: { ...process.env, JUPITER_API_KEY: "", RUGCHECK_DISABLED: "true", SOLANA_RPC_URL: "" },
  });

  proc.stdout!.on("data", (data: Buffer) => {
    buffer += data.toString();
  });

  // Initialize the MCP session
  const initId = send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  });
  const initResponse = await waitForResponse(initId);
  expect(initResponse.result).toBeDefined();

  // Send initialized notification
  sendNotification("notifications/initialized");
});

afterAll(() => {
  if (proc) {
    proc.kill();
  }
});

describe("MCP server", () => {
  it("reports server info with correct name and version", async () => {
    // Re-initialize to check server info (already done in beforeAll, but let's verify)
    const id = send("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-verify", version: "1.0.0" },
    });
    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;
    const serverInfo = result.serverInfo as Record<string, unknown>;

    expect(serverInfo.name).toBe("shield402");
    expect(serverInfo.version).toBe("0.5.0");
  });

  it("lists check-trade tool", async () => {
    const id = send("tools/list");
    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("check-trade");
    expect(tools[0].description).toContain("Solana trade");
  });

  it("check-trade tool schema includes required mint fields", async () => {
    const id = send("tools/list");
    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;
    const schema = tools[0].inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;

    expect(properties).toHaveProperty("input_mint");
    expect(properties).toHaveProperty("output_mint");
    expect(properties).toHaveProperty("amount_in");
    expect(properties).toHaveProperty("slippage_bps");
    expect(properties).toHaveProperty("send_mode");
  });

  it("returns allow for a safe trade", async () => {
    const id = send("tools/call", {
      name: "check-trade",
      arguments: {
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 2,
        slippage_bps: 50,
        send_mode: "protected",
        priority_fee_lamports: 5000,
      },
    });

    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const body = JSON.parse(content[0].text as string);

    expect(body.decision).toBe("allow");
    expect(body.risk_level).toBe("low");
    expect(body.policy_version).toBe("0.5.0");
    expect(body.live_sources).toEqual([]);
    // Phase A: degraded mode and provenance fields present
    expect(body.degraded).toBe(false);
    expect(body.degraded_reasons).toEqual([]);
    expect(Array.isArray(body.provenance)).toBe(true);
  });

  it("returns block for a dangerous trade", async () => {
    const id = send("tools/call", {
      name: "check-trade",
      arguments: {
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 60,
        slippage_bps: 500,
        send_mode: "standard",
      },
    });

    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const body = JSON.parse(content[0].text as string);

    expect(body.decision).toBe("block");
    expect(body.risk_level).toBe("high");
    expect(body.triggered_rules.length).toBeGreaterThan(0);
  });

  it("returns error for invalid mint address", async () => {
    const id = send("tools/call", {
      name: "check-trade",
      arguments: {
        input_mint: "not-valid",
        output_mint: USDC_MINT,
        amount_in: 5,
        slippage_bps: 100,
        send_mode: "standard",
      },
    });

    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;

    expect(result.isError).toBe(true);
    const content = result.content as Array<Record<string, unknown>>;
    const body = JSON.parse(content[0].text as string);
    expect(body.error).toBe("invalid_request");
  });

  it("includes 7 rule details in the response", async () => {
    const id = send("tools/call", {
      name: "check-trade",
      arguments: {
        input_mint: SOL_MINT,
        output_mint: USDC_MINT,
        amount_in: 2,
        slippage_bps: 50,
        send_mode: "protected",
      },
    });

    const response = await waitForResponse(id);
    const result = response.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const body = JSON.parse(content[0].text as string);

    expect(body.rule_details).toHaveLength(8);
  });
});
