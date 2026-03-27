/**
 * Single source of truth for Shield402 version.
 *
 * Every surface (health endpoint, policy engine, MCP server, server log)
 * imports from here. Bump this when rules or response contract change.
 */
export const VERSION = "0.5.0";
