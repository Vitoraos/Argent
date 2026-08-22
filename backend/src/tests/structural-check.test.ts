import { describe, it, expect } from "vitest";
import { checkStructuralValidity, type StructuralCheckInput } from "../proxy/structural-check.js";
const SCHEMA = {
  type: "object",
  properties: {
    lat: { type: "number" },
    lng: { type: "number" },
  },
  required: ["lat", "lng"],
};

function baseInput(overrides: Partial<StructuralCheckInput> = {}): StructuralCheckInput {
  return {
    timedOut: false,
    httpStatus: 200,
    rawBody: JSON.stringify({ lat: 6.34, lng: 5.63 }),
    outputSchema: SCHEMA,
    ...overrides,
  };
}

describe("checkStructuralValidity", () => {
  it("passes a well-formed response matching the schema", () => {
    const result = checkStructuralValidity(baseInput());
    expect(result.passed).toBe(true);
  });

  it("fails on timeout regardless of other fields", () => {
    const result = checkStructuralValidity(baseInput({ timedOut: true, httpStatus: 200 }));
    expect(result).toMatchObject({ passed: false, reason: "timeout" });
  });

  it("fails on 5xx server error", () => {
    const result = checkStructuralValidity(baseInput({ httpStatus: 503 }));
    expect(result).toMatchObject({ passed: false, reason: "server_error" });
  });

  it("fails when httpStatus is null (network error, request never completed)", () => {
    const result = checkStructuralValidity(baseInput({ httpStatus: null }));
    expect(result).toMatchObject({ passed: false, reason: "server_error" });
  });

  it("fails on empty body", () => {
    const result = checkStructuralValidity(baseInput({ rawBody: "" }));
    expect(result).toMatchObject({ passed: false, reason: "empty_response" });
  });

  it("fails on whitespace-only body", () => {
    const result = checkStructuralValidity(baseInput({ rawBody: "   " }));
    expect(result).toMatchObject({ passed: false, reason: "empty_response" });
  });

  it("fails on invalid JSON", () => {
    const result = checkStructuralValidity(baseInput({ rawBody: "{not json" }));
    expect(result).toMatchObject({ passed: false, reason: "invalid_json" });
  });

  it("fails on schema mismatch (missing required field)", () => {
    const result = checkStructuralValidity(
      baseInput({ rawBody: JSON.stringify({ lat: 6.34 }) }),
    );
    expect(result).toMatchObject({ passed: false, reason: "schema_mismatch" });
  });

  it("fails on schema mismatch (wrong type)", () => {
    const result = checkStructuralValidity(
      baseInput({ rawBody: JSON.stringify({ lat: "not-a-number", lng: 5.63 }) }),
    );
    expect(result).toMatchObject({ passed: false, reason: "schema_mismatch" });
  });

  it("2xx and non-500 4xx statuses are not auto-failed by status alone (schema still governs)", () => {
    // a 201 with a valid body should still pass — only 5xx is treated as
    // an automatic server-side failure; 4xx isn't judged by status here,
    // it still just falls through to schema validation of whatever body
    // came back, since some providers use 4xx placeholders legitimately.
    const result = checkStructuralValidity(baseInput({ httpStatus: 201 }));
    expect(result.passed).toBe(true);
  });
});
