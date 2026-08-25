// MCP v2's registerTool requires a StandardSchemaWithJSON — Standard Schema V1
// PLUS a `jsonSchema` Converter field that lives INSIDE `~standard` (as a
// sibling of `validate`). The SDK uses `~standard.jsonSchema` to advertise
// the tool's argument shape to LLM clients in `tools/list`, and uses
// `~standard.validate` to check incoming arguments on `tools/call`.
//
// The MCP TypeScript SDK ships a built-in helper, `fromJsonSchema`, that
// builds exactly this shape and uses Ajv on Node automatically (and the
// Cloudflare validator on edge). This thin wrapper exists only to keep
// the call site (build-server.ts) decoupled from the SDK's symbol names
// — pure delegation, no behavior of its own, fully testable via the
// round-trip tests in json-schema-adapter.test.ts.

import { fromJsonSchema } from "@modelcontextprotocol/server";

/**
 * Wraps a JSON Schema object as a StandardSchemaWithJSON so it can be
 * passed directly to McpServer.registerTool's `inputSchema` config.
 *
 * The returned object has the shape:
 *   {
 *     "~standard": {
 *       version: 1,
 *       vendor: "mcp",
 *       validate: (value) => { value } | { issues: [{ message }] },
 *       jsonSchema: {
 *         input: (options) => schema,
 *         output: (options) => schema,
 *       },
 *     }
 *   }
 *
 * Uses the SDK's built-in Ajv-backed validator on Node (and Cloudflare's
 * validator on edge). No custom Ajv instance is required — the default
 * config is appropriate for the simple JSON-Schema inputs providers
 * submit at onboarding. If a provider ever submits a schema needing
 * custom formats or strict-mode tweaks, switch to passing a custom
 * AjvJsonSchemaValidator instance as the second arg here.
 */
export function jsonSchemaToStandardSchema<T = unknown>(
  schema: Record<string, unknown>,
) {
  return fromJsonSchema<T>(schema);
}
