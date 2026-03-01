/**
 * Simple benchmark utility
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SearchItemType, type SearchableItem } from '../src/core/types';

interface BenchmarkResult {
    name: string;
    avgMs: number;
    totalMs: number;
    minMs: number;
    maxMs: number;
    p95Ms: number;
    stdDevMs: number;
}

const results: BenchmarkResult[] = [];

function percentile(values: number[], percentileValue: number): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
    return sorted[index];
}

function standardDeviation(values: number[], mean: number): number {
    if (values.length === 0) {
        return 0;
    }

    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

export async function benchmark(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 1,
): Promise<BenchmarkResult> {
    console.log(`Running benchmark: ${name} (${iterations} iterations)...`);

    // Warmup
    if (iterations > 1) {
        try {
            await fn();
        } catch (e) {
            console.error(`Warmup failed for ${name}:`, e);
        }
    }

    const samples: number[] = [];
    const totalStart = performance.now();

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fn();
        const end = performance.now();
        samples.push(end - start);
    }

    const totalEnd = performance.now();
    const totalMs = totalEnd - totalStart;
    const avgMs = totalMs / iterations;

    const minMs = samples.length > 0 ? Math.min(...samples) : 0;
    const maxMs = samples.length > 0 ? Math.max(...samples) : 0;
    const p95Ms = percentile(samples, 95);
    const stdDevMs = standardDeviation(samples, avgMs);

    console.log(
        `  -> Avg: ${avgMs.toFixed(3)}ms | Total: ${totalMs.toFixed(3)}ms | Min: ${minMs.toFixed(3)}ms | Max: ${maxMs.toFixed(3)}ms | P95: ${p95Ms.toFixed(3)}ms | StdDev: ${stdDevMs.toFixed(3)}ms`,
    );

    const result: BenchmarkResult = { name, avgMs, totalMs, minMs, maxMs, p95Ms, stdDevMs };
    results.push(result);
    return result;
}

export function saveBenchmarks(outputPath: string): void {
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`Benchmark results saved to ${outputPath}`);
    } catch (error) {
        console.error(`Failed to save benchmark results: ${error}`);
    }
}

export function generateMockFiles(count: number): SearchableItem[] {
    const items: SearchableItem[] = [];
    for (let i = 0; i < count; i++) {
        items.push({
            id: `id-${i}`,
            name: `File${i}.ts`,
            type: SearchItemType.FILE,
            filePath: `/path/to/project/src/components/File${i}.ts`,
            relativeFilePath: `src/components/File${i}.ts`,
            fullName: `File${i}.ts`,
        });
    }
    return items;
}
