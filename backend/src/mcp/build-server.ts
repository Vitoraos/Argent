// Builds an McpServer instance exposing each active provider as a tool.
// This is glue code against @modelcontextprotocol/server (currently beta,
// per the 2026-07-28 spec RC) — not unit tested here, same reasoning as
// not unit-testing the real Solana/pg-boss calls: it needs the live SDK
// to mean anything. The pure pieces it depends on (jsonSchemaToStandardSchema,
// toToolName, buildToolDescription) ARE fully unit tested.
//
// NOTE: this is beta-SDK code. If registerTool's exact signature has
// shifted since this was written, the fix is almost always mechanical —
// check the SDK's own migration notes before assuming deeper breakage.

import { McpServer } from "@modelcontextprotocol/server";
import { jsonSchemaToStandardSchema } from "./json-schema-adapter.js";
import { toToolName, buildToolDescription } from "./tool-mapper.js";
import { proxyCall, type CallCreator, type ProviderRecord } from "../proxy/handler.js";
import type { SettlementService } from "../settlement/service.js";

export interface McpProviderListing {
  id: string;
  name: string;
  mcpDescription: string;
  priceUsdc: number;
  endpointUrl: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface BuildMcpServerDeps {
  // Resolved once per connection from the authenticated session — never
  // trust a developerId passed in the tool call arguments themselves.
  developerId: string;
  providers: McpProviderListing[];
  callCreator: CallCreator;
  settlement: SettlementService;
}

export function buildMcpServer(deps: BuildMcpServerDeps): McpServer {
  const server = new McpServer({ name: "gateway", version: "0.1.0" });

  for (const provider of deps.providers) {
    const toolName = toToolName(provider.name);
    const description = buildToolDescription(provider);
    const inputSchema = jsonSchemaToStandardSchema(provider.inputSchema);

    server.registerTool(
      toolName,
      { description, inputSchema },
      async (args: unknown) => {
        const providerRecord: ProviderRecord = {
          id: provider.id,
          endpointUrl: provider.endpointUrl,
          priceUsdc: provider.priceUsdc,
          outputSchema: provider.outputSchema,
        };

        const result = await proxyCall(
          {
            developerId: deps.developerId,
            provider: providerRecord,
            requestPayload: args as Record<string, unknown>,
          },
          { callCreator: deps.callCreator, settlement: deps.settlement },
        );

        if (result.call.status === "rejected") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Call failed structural validation — no charge applied. (call id: ${result.call.id})`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result.responseBody) },
          ],
          structuredContent: result.responseBody as Record<string, unknown>,
        };
      },
    );
  }

  return server;
}
