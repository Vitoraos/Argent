// Pure mapping from a provider record to what an agent sees as an MCP
// tool: name (slug), and a description with price folded in so an agent
// can reason about cost without a separate lookup. No SDK import here.

export interface McpProviderInput {
  name: string;
  mcpDescription: string;
  priceUsdc: number;
}

/**
 * MCP tool names must be stable, simple identifiers. Slugifies the
 * provider's display name — lowercase, alphanumeric + hyphens only.
 */
export function toToolName(providerName: string): string {
  const slug = providerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");

  if (slug.length === 0) {
    throw new Error(`Provider name "${providerName}" produces an empty tool name`);
  }
  return slug;
}

/**
 * Folds price into the description text itself so an agent's reasoning
 * about "should I call this" includes cost without a second lookup.
 * Assumes mcpDescription is already the LLM-generated, human-approved
 * draft — this only appends price, never rewrites the description.
 */
export function buildToolDescription(provider: McpProviderInput): string {
  const price = provider.priceUsdc.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${provider.mcpDescription.trim()}\n\nPrice: $${price} USDC per call.`;
}
