/**
 * x402 payment configuration.
 *
 * Parsed from environment variables at startup.
 * When x402 is disabled, the API runs free (no payment required).
 * When enabled, POST /check-trade requires x402 payment.
 *
 * dotenv should be loaded before this module is imported.
 */

export interface X402Config {
  enabled: boolean;
  svmAddress: string;
  facilitatorUrl: string;
  network: string;
  price: string;
}

/**
 * Read x402 config from process.env.
 *
 * Returns null if x402 is disabled.
 * Throws if x402 is enabled but required vars are missing.
 */
export function loadX402Config(): X402Config | null {
  const enabled = process.env.X402_ENABLED === "true";

  if (!enabled) {
    return null;
  }

  const svmAddress = process.env.SVM_ADDRESS;
  const facilitatorUrl = process.env.FACILITATOR_URL;
  const network = process.env.X402_NETWORK;
  const price = process.env.X402_PRICE;

  if (!svmAddress) {
    throw new Error("X402_ENABLED=true but SVM_ADDRESS is not set.");
  }

  if (!facilitatorUrl) {
    throw new Error("X402_ENABLED=true but FACILITATOR_URL is not set.");
  }

  if (!network) {
    throw new Error("X402_ENABLED=true but X402_NETWORK is not set.");
  }

  if (!price) {
    throw new Error("X402_ENABLED=true but X402_PRICE is not set.");
  }

  return { enabled, svmAddress, facilitatorUrl, network, price };
}
