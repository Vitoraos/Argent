import { describe, it, expect } from "vitest";
import { jsonSchemaToStandardSchema } from "../mcp/json-schema-adapter.js";

const SCHEMA = {
  type: "object",
  properties: { address: { type: "string" } },
  required: ["address"],
};

describe("jsonSchemaToStandardSchema", () => {
  it("returns a well-formed Standard Schema V1 object", () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    expect(adapted["~standard"].version).toBe(1);
    expect(typeof adapted["~standard"].validate).toBe("function");
  });

  it("validate() returns { value } for valid input", () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    const result = adapted["~standard"].validate({ address: "123 Main St" });
    expect(result).toEqual({ value: { address: "123 Main St" } });
  });

  it("validate() returns { issues } for invalid input", () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    const result = adapted["~standard"].validate({ notAddress: 1 });
    expect("issues" in result).toBe(true);
    if ("issues" in result) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("validate() returns { issues } for wrong type", () => {
    const adapted = jsonSchemaToStandardSchema(SCHEMA);
    const result = adapted["~standard"].validate({ address: 12345 });
    expect("issues" in result).toBe(true);
  });
});
