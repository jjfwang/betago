/**
 * @file ai_schema.test.js
 * @description Unit tests for the strict JSON schema validation of AI move responses.
 *
 * These tests verify that:
 *   - Valid "place", "pass", and "resign" actions pass validation.
 *   - A "place" action without x/y coordinates fails validation.
 *   - An unknown action type fails validation.
 *   - Non-object inputs fail validation.
 *   - Coordinates outside the board range fail validation.
 *   - Rationale exceeding the max length is rejected.
 *   - Numeric strings for x/y are rejected (strict integer type required).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateAIAction } from "../src/ai/schema.js";

// ---------------------------------------------------------------------------
// Valid inputs
// ---------------------------------------------------------------------------

test("validates a valid place action with integer coordinates", () => {
  const input = { action: "place", x: 3, y: 4, rationale: "Good move." };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Valid place action should pass validation");
  assert.strictEqual(validateAIAction.errors, null, "No errors should be reported");
});

test("validates a valid pass action without coordinates", () => {
  const input = { action: "pass", rationale: "I choose to pass." };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Valid pass action should pass validation");
  assert.strictEqual(validateAIAction.errors, null, "No errors should be reported");
});

test("validates a valid resign action without coordinates", () => {
  const input = { action: "resign" };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Valid resign action should pass validation");
  assert.strictEqual(validateAIAction.errors, null, "No errors should be reported");
});

test("validates a place action at board boundary (0, 0)", () => {
  const input = { action: "place", x: 0, y: 0 };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Corner placement should be valid");
});

test("validates a place action at maximum coordinate (18, 18)", () => {
  const input = { action: "place", x: 18, y: 18 };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Maximum coordinate placement should be valid");
});

test("validates a place action without an optional rationale", () => {
  const input = { action: "place", x: 5, y: 5 };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Place action without rationale should be valid");
});

// ---------------------------------------------------------------------------
// Invalid inputs: missing required fields
// ---------------------------------------------------------------------------

test("rejects a place action missing x coordinate", () => {
  const input = { action: "place", y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Place action missing x should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a place action missing y coordinate", () => {
  const input = { action: "place", x: 3 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Place action missing y should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a place action missing both x and y coordinates", () => {
  const input = { action: "place" };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Place action missing x and y should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects an input missing the action field", () => {
  const input = { x: 3, y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Input without action should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

// ---------------------------------------------------------------------------
// Invalid inputs: wrong types
// ---------------------------------------------------------------------------

test("rejects an unknown action value", () => {
  const input = { action: "jump", x: 3, y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Unknown action should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a non-object input (null)", () => {
  const result = validateAIAction(null);
  assert.strictEqual(result, false, "null should fail validation");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a non-object input (string)", () => {
  const result = validateAIAction("place D4");
  assert.strictEqual(result, false, "A raw string should fail validation");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a non-object input (array)", () => {
  const result = validateAIAction(["place", 3, 4]);
  assert.strictEqual(result, false, "An array should fail validation");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects string x coordinate in a place action", () => {
  const input = { action: "place", x: "3", y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "String x coordinate should fail strict integer check");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects float x coordinate in a place action", () => {
  const input = { action: "place", x: 3.5, y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Float x coordinate should fail integer check");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects action field that is not a string", () => {
  const input = { action: 1, x: 3, y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Numeric action should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

// ---------------------------------------------------------------------------
// Invalid inputs: out-of-range values
// ---------------------------------------------------------------------------

test("rejects a negative x coordinate", () => {
  const input = { action: "place", x: -1, y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Negative x should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a negative y coordinate", () => {
  const input = { action: "place", x: 3, y: -1 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Negative y should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects an x coordinate above maximum (19)", () => {
  const input = { action: "place", x: 19, y: 4 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "x=19 should fail (max is 18)");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("rejects a y coordinate above maximum (19)", () => {
  const input = { action: "place", x: 3, y: 19 };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "y=19 should fail (max is 18)");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

// ---------------------------------------------------------------------------
// Invalid inputs: rationale length
// ---------------------------------------------------------------------------

test("rejects a rationale exceeding 240 characters", () => {
  const longRationale = "A".repeat(241);
  const input = { action: "pass", rationale: longRationale };
  const result = validateAIAction(input);
  assert.strictEqual(result, false, "Rationale over 240 chars should fail");
  assert.ok(validateAIAction.errors?.length > 0, "Errors should be reported");
});

test("accepts a rationale of exactly 240 characters", () => {
  const maxRationale = "A".repeat(240);
  const input = { action: "pass", rationale: maxRationale };
  const result = validateAIAction(input);
  assert.strictEqual(result, true, "Rationale of exactly 240 chars should pass");
});
