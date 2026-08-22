import { describe, it, expect } from "vitest";
import { toToolName, buildToolDescription } from "../mcp/tool-mapper.js";

describe("toToolName", () => {
  it("lowercases and hyphenates a normal name", () => {
    expect(toToolName("GeoLookup")).toBe("geolookup");
  });

  it("replaces spaces and punctuation with single hyphens", () => {
    expect(toToolName("Geo Lookup: Address -> Coords!")).toBe("geo-lookup-address-coords");
  });

  it("trims leading/trailing hyphens", () => {
    expect(toToolName("  --Weather API--  ")).toBe("weather-api");
  });

  it("throws on a name that produces an empty slug", () => {
    expect(() => toToolName("!!!")).toThrow();
  });
});

describe("buildToolDescription", () => {
  it("appends price to the description", () => {
    const result = buildToolDescription({
      name: "GeoLookup",
      mcpDescription: "Resolves a street address to coordinates.",
      priceUsdc: 0.002,
    });
    expect(result).toContain("Resolves a street address to coordinates.");
    expect(result).toContain("$0.002 USDC per call");
  });

  it("trims trailing zeros in the price display", () => {
    const result = buildToolDescription({
      name: "X",
      mcpDescription: "desc",
      priceUsdc: 0.5,
    });
    expect(result).toContain("$0.5 USDC per call");
  });

  it("handles whole-dollar prices without a decimal artifact", () => {
    const result = buildToolDescription({
      name: "X",
      mcpDescription: "desc",
      priceUsdc: 1,
    });
    expect(result).toContain("$1 USDC per call");
  });
});
