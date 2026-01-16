/**
 * Simple benchmark utility
 */
import { SearchItemType } from '../src/core/types';

export async function benchmark(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 1
): Promise<{ name: string, avgMs: number, totalMs: number }> {
    console.log(`Running benchmark: ${name} (${iterations} iterations)...`);

    // Warmup
    if (iterations > 1) {
        try {
            await fn();
        } catch (e) {
            console.error(`Warmup failed for ${name}:`, e);
        }
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await fn();
    }
    const end = performance.now();

    const totalMs = end - start;
    const avgMs = totalMs / iterations;

    console.log(`  -> Avg: ${avgMs.toFixed(3)}ms | Total: ${totalMs.toFixed(3)}ms`);
    return { name, avgMs, totalMs };
}

export function generateMockFiles(count: number): any[] {
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push({
            id: `id-${i}`,
            name: `File${i}.ts`,
            type: SearchItemType.FILE,
            filePath: `/path/to/project/src/components/File${i}.ts`,
            relativeFilePath: `src/components/File${i}.ts`,
            fullName: `File${i}.ts`
        });
    }
    return items;
}
