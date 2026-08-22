// MCP v2's registerTool requires a "Standard Schema" compliant object
// (the interface Zod v4/Valibot/ArkType all implement) rather than raw
// JSON Schema. Our providers submit raw JSON Schema at onboarding, so
// rather than pull in a lossy JSON-Schema-to-Zod converter, this wraps
// the same Ajv validator already used in structural-check.ts to satisfy
// that interface directly. Pure, no MCP SDK import here — fully testable.

import Ajv, { type ValidateFunction } from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false });

// Minimal Standard Schema V1 shape (https://standardschema.dev) — only
// the fields MCP's SDK actually reads.
export interface StandardSchemaV1<Output = unknown> {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (
      value: unknown,
    ) => { value: Output; issues?: undefined } | { issues: { message: string }[] };
  };
}

export function jsonSchemaToStandardSchema<Output = unknown>(
  schema: Record<string, unknown>,
): StandardSchemaV1<Output> {
  const validateFn: ValidateFunction = ajv.compile(schema);

  return {
    "~standard": {
      version: 1,
      vendor: "gateway-ajv-adapter",
      validate: (value: unknown) => {
        if (validateFn(value)) {
          return { value: value as Output };
        }
        return {
          issues: (validateFn.errors ?? []).map((e) => ({
            message: `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`.trim(),
          })),
        };
      },
    },
  };
}
