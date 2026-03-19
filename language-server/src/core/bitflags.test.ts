/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "bun:test";
import { SearchEngine } from "./search-engine";

describe("SearchEngine Bitflags", () => {
  it("should calculate correct bitflags for ASCII characters", () => {
    const engine = new SearchEngine();
    const calculateBitflags = (engine as any).calculateBitflags.bind(engine);

    // 'a' -> bit 0
    expect(calculateBitflags("a")).toBe(1 << 0);
    // 'b' -> bit 1
    expect(calculateBitflags("b")).toBe(1 << 1);
    // 'z' -> bit 25
    expect(calculateBitflags("z")).toBe(1 << 25);
    // 'A' -> bit 0
    expect(calculateBitflags("A")).toBe(1 << 0);
    // '0' -> bit 26
    expect(calculateBitflags("0")).toBe(1 << 26);
    // '9' -> bit 26
    expect(calculateBitflags("9")).toBe(1 << 26);
    // ' ' -> 0
    expect(calculateBitflags(" ")).toBe(0);
    // '-' -> bit 30 (other ascii)
    expect(calculateBitflags("-")).toBe(1 << 30);
  });

  it("should calculate correct bitflags for extended ASCII characters", () => {
    const engine = new SearchEngine();
    const calculateBitflags = (engine as any).calculateBitflags.bind(engine);

    // 'é' (U+00E9) -> normalize('NFD') -> 'e' + '´' -> bit 4 | bit 30/31
    // 'e' is bit 4.
    // combining acute accent (U+0301) is removed by replaceAll in calculateBitflagsSlow?
    // Wait, replaceAll(/[\u0300-\u036f]/g, '') removes it.
    // So 'é' -> 'e'. Bitflags should be just bit 4.
    expect(calculateBitflags("é")).toBe(1 << 4);

    // 'ç' (U+00E7) -> 'c' + '¸'. '¸' (U+0327) is removed.
    // So 'ç' -> 'c'. Bitflags should be just bit 2.
    expect(calculateBitflags("ç")).toBe(1 << 2);

    // 'ñ' (U+00F1) -> 'n' + '~'. '~' (U+0303) is removed.
    // So 'ñ' -> 'n'. Bitflags should be just bit 13.
    expect(calculateBitflags("ñ")).toBe(1 << 13);
  });

  it("should calculate correct bitflags for emojis and other unicode", () => {
    const engine = new SearchEngine();
    const calculateBitflags = (engine as any).calculateBitflags.bind(engine);

    // '💩' -> bit 31 (other utf8)
    // Note: 💩 is a surrogate pair. calculateBitflags iterates code points in slow path.
    expect(calculateBitflags("💩") & (1 << 31)).toBeTruthy();

    // '中' -> bit 31
    expect(calculateBitflags("中") & (1 << 31)).toBeTruthy();
  });
});
