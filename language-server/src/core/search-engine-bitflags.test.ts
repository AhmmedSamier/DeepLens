import { expect, test } from 'bun:test';
import { SearchEngine } from './search-engine';
import { SearchableItem, SearchItemType } from './types';

// Access private methods using type assertion
type PrivateEngine = SearchEngine & {
    calculateBitflags(str: string): number;
    computeItemBitflags(item: SearchableItem): { nameFlags: number; aggregateFlags: number };
};

test('SearchEngine bitflags ignore path separators', () => {
    const engine = new SearchEngine() as unknown as PrivateEngine;

    // Item with backslashes
    const item1: SearchableItem = {
        id: '1',
        name: 'file.ts',
        type: SearchItemType.FILE,
        filePath: 'C:\\project\\src\\file.ts',
        relativeFilePath: 'src\\file.ts',
        fullName: 'src\\file.ts',
        detail: 'detail',
    };

    // Item with forward slashes
    const item2: SearchableItem = {
        id: '2',
        name: 'file.ts',
        type: SearchItemType.FILE,
        filePath: '/project/src/file.ts',
        relativeFilePath: 'src/file.ts',
        fullName: 'src/file.ts',
        detail: 'detail',
    };

    // Calculate flags
    const flags1 = engine.computeItemBitflags(item1);
    const flags2 = engine.computeItemBitflags(item2);

    // Both should be identical regardless of slash type
    // This confirms that '/' and '\' map to the same bitmask (or are effectively ignored/normalized)
    expect(flags1.nameFlags).toBe(flags2.nameFlags);
    expect(flags1.aggregateFlags).toBe(flags2.aggregateFlags);
});

test('SearchEngine.calculateBitflags correctness', () => {
    const engine = new SearchEngine() as unknown as PrivateEngine;

    // "hello" -> h(7), e(4), l(11), o(14)
    // bits: 1<<7 | 1<<4 | 1<<11 | 1<<14
    const expected = (1 << 7) | (1 << 4) | (1 << 11) | (1 << 14);

    const flags = engine.calculateBitflags('hello');
    expect(flags).toBe(expected);

    // Verify forward slash and backslash map to same
    const slash = engine.calculateBitflags('/');
    const backslash = engine.calculateBitflags('\\');
    expect(slash).toBe(backslash);
    // Both should be bit 30 (non-alphanumeric ascii)
    expect(slash).toBe(1 << 30);
});
