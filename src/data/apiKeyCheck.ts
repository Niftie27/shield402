/**
 * Check if an API key looks like a real key, not a placeholder from .env.example.
 * Catches patterns like "<YOUR-KEY>", "your-api-key-here", etc.
 *
 * Used by liveContext (to decide which sources to attempt) and by
 * individual clients (to avoid sending garbage headers).
 */
export function isRealApiKey(value: string | undefined): boolean {
  if (!value) return false;
  if (value.includes("<") || value.includes(">")) return false;
  if (/^your[_-]/i.test(value)) return false;
  return true;
}
