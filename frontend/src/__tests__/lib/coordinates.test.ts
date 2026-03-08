/**
 * Unit tests for coordinate utility functions.
 */

import {
  coordToLabel,
  labelToCoord,
  columnLabel,
  rowLabel,
} from "@/lib/coordinates";

describe("coordToLabel", () => {
  it("converts (0,0) to A9 on a 9x9 board", () => {
    expect(coordToLabel(0, 0, 9)).toBe("A9");
  });

  it("converts (8,8) to J1 on a 9x9 board (I is skipped)", () => {
    expect(coordToLabel(8, 8, 9)).toBe("J1");
  });

  it("converts (3,5) to D4 on a 9x9 board", () => {
    expect(coordToLabel(3, 5, 9)).toBe("D4");
  });

  it("converts (0,0) to A19 on a 19x19 board", () => {
    expect(coordToLabel(0, 0, 19)).toBe("A19");
  });

  it("converts (18,18) to T1 on a 19x19 board", () => {
    expect(coordToLabel(18, 18, 19)).toBe("T1");
  });

  it("returns '?' for out-of-range column index", () => {
    expect(coordToLabel(99, 0, 9)).toBe("?9");
  });
});

describe("labelToCoord", () => {
  it("parses A9 to (0,0) on a 9x9 board", () => {
    expect(labelToCoord("A9", 9)).toEqual({ x: 0, y: 0 });
  });

  it("parses J1 to (8,8) on a 9x9 board", () => {
    expect(labelToCoord("J1", 9)).toEqual({ x: 8, y: 8 });
  });

  it("parses D4 to (3,5) on a 9x9 board", () => {
    expect(labelToCoord("D4", 9)).toEqual({ x: 3, y: 5 });
  });

  it("is case-insensitive for the column letter", () => {
    expect(labelToCoord("a9", 9)).toEqual({ x: 0, y: 0 });
  });

  it("returns null for an empty string", () => {
    expect(labelToCoord("", 9)).toBeNull();
  });

  it("returns null for an unknown column letter (I)", () => {
    // I is skipped in Go notation
    expect(labelToCoord("I5", 9)).toBeNull();
  });

  it("returns null for an out-of-range row number", () => {
    expect(labelToCoord("A0", 9)).toBeNull();
    expect(labelToCoord("A10", 9)).toBeNull();
  });

  it("returns null for a malformed label", () => {
    expect(labelToCoord("XYZ", 9)).toBeNull();
  });

  it("round-trips: coordToLabel -> labelToCoord", () => {
    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 9; y++) {
        const label = coordToLabel(x, y, 9);
        expect(labelToCoord(label, 9)).toEqual({ x, y });
      }
    }
  });
});

describe("columnLabel", () => {
  it("returns A for column 0", () => {
    expect(columnLabel(0)).toBe("A");
  });

  it("skips I (column 8 is J)", () => {
    expect(columnLabel(8)).toBe("J");
  });

  it("returns ? for out-of-range index", () => {
    expect(columnLabel(100)).toBe("?");
  });
});

describe("rowLabel", () => {
  it("returns 9 for row 0 on a 9x9 board", () => {
    expect(rowLabel(0, 9)).toBe(9);
  });

  it("returns 1 for row 8 on a 9x9 board", () => {
    expect(rowLabel(8, 9)).toBe(1);
  });
});
