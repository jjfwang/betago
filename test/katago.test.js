import test from "node:test";
import assert from "node:assert/strict";
import { fromGtpCoord, toGtpCoord } from "../src/ai/katago.js";

test("toGtpCoord converts internal coordinates for 18x18", () => {
  assert.equal(toGtpCoord(0, 0, 18), "A18");
  assert.equal(toGtpCoord(17, 17, 18), "S1");
  assert.equal(toGtpCoord(8, 9, 18), "J9");
});

test("fromGtpCoord parses place, pass, resign", () => {
  assert.deepEqual(fromGtpCoord("A18", 18), { action: "place", x: 0, y: 0 });
  assert.deepEqual(fromGtpCoord("S1", 18), { action: "place", x: 17, y: 17 });
  assert.deepEqual(fromGtpCoord("pass", 18), { action: "pass" });
  assert.deepEqual(fromGtpCoord("RESIGN", 18), { action: "resign" });
});

test("fromGtpCoord rejects invalid coordinates", () => {
  assert.equal(fromGtpCoord("I10", 18), null);
  assert.equal(fromGtpCoord("T1", 18), null);
  assert.equal(fromGtpCoord("A19", 18), null);
});
