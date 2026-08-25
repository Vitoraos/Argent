import { describe, it, expect } from "vitest";
import { jsonSchemaToStandardSchema } from "../mcp/json-schema-adapter.js";

const SCHEMA = {
  type: "object",
  properties: { address: { type: "string" } },
  required: ["address"],
};

describe("jsonSchemaToStandardSchema", () => {
  it("returns a well-formed StandardSchemaWithJSON (jsonSchema lives inside ~standard)", () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);

    // Standard Schema V1 fields
    expect(adapted["~standard"].version).toBe(1);
    expect(typeof adapted["~standard"].validate).toBe("function");

    // The jsonSchema field is INSIDE ~standard (sibling of validate), and
    // is a Converter object — i.e., { input(options), output(options) }
    // each returning the raw schema — NOT the schema itself.
    expect(typeof adapted["~standard"].jsonSchema.input).toBe("function");
    expect(typeof adapted["~standard"].jsonSchema.output).toBe("function");
    expect(
      adapted["~standard"].jsonSchema.input({ target: "draft-07" }),
    ).toEqual(SCHEMA);
    expect(
      adapted["~standard"].jsonSchema.output({ target: "draft-07" }),
    ).toEqual(SCHEMA);
  });

  it("validate() returns { value } for valid input", async () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    // validate's declared return type is `Result | Promise<Result>`, so
    // await to handle both sync and async impls uniformly.
    const result = await adapted["~standard"].validate({ address: "123 Main St" });
    expect(result).toEqual({ value: { address: "123 Main St" } });
  });

  it("validate() returns { issues } for invalid input (missing required field)", async () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    const result = await adapted["~standard"].validate({ notAddress: 1 });
    expect("issues" in result).toBe(true);
    if ("issues" in result) {
      expect(result.issues!.length).toBeGreaterThan(0);
    }
  });

  it("validate() returns { issues } for wrong type (string expected, number given)", async () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    const result = await adapted["~standard"].validate({ address: 12345 });
    expect("issues" in result).toBe(true);
  });
});
