/**
 * Unit tests for the action id generator.
 */

import { generateActionId } from "@/lib/actionId";

describe("generateActionId", () => {
  it("returns a non-empty string", () => {
    const id = generateActionId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns unique values on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateActionId()));
    expect(ids.size).toBe(100);
  });

  it("returns a UUID-like string when crypto.randomUUID is available", () => {
    // crypto.randomUUID is available in the jsdom test environment.
    const id = generateActionId();
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidPattern);
  });
});
