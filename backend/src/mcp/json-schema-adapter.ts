// MCP v2's registerTool requires a "Standard Schema with JSON" compliant
// object (StandardSchemaWithJSON) — Standard Schema V1 plus a `jsonSchema`
// property so the SDK can also advertise the schema to LLM clients that
// prefer JSON Schema. We wrap the same Ajv validator already used in
// structural-check.ts to satisfy that interface directly. Pure, no MCP SDK
// import here — fully testable.

import * as ajvNS from "ajv";
import type { ValidateFunction } from "ajv";

// With `module: NodeNext` + `"type": "module"`, the default import of a CJS
// package like ajv resolves to the namespace object, not the default export.
// Access `.default` explicitly to get the Ajv constructor.
const Ajv = (ajvNS as unknown as {
  default: new (opts?: { allErrors?: boolean; strict?: boolean }) => InstanceType<
    typeof ajvNS.Ajv
  >;
}).default;

const ajv = new Ajv({ allErrors: true, strict: false });

// Standard Schema V1 shape (https://standardschema.dev) — the fields
// MCP's SDK actually reads from `~standard`.
export interface StandardSchemaV1<Output = unknown> {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (
      value: unknown,
    ) => { value: Output; issues?: undefined } | { issues: { message: string }[] };
  };
}

// MCP 2.0.0's registerTool config.inputSchema expects StandardSchema V1
// *plus* a `jsonSchema` field carrying the original JSON Schema object —
// the SDK uses it to advertise the schema shape to LLM clients that prefer
// JSON Schema over the standard-schema validate() interface.
export interface StandardSchemaWithJSON<Output = unknown> extends StandardSchemaV1<Output> {
  jsonSchema: Record<string, unknown>;
}

export function jsonSchemaToStandardSchema<Output = unknown>(
  schema: Record<string, unknown>,
): StandardSchemaWithJSON<Output> {
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
    jsonSchema: schema,
  };
}
