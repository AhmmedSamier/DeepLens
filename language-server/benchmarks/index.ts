import { runSearchBenchmarks } from './search.bench';
import { runParserBenchmarks } from './parser.bench';
import { runTextSearchBenchmarks } from './text-search.bench';
import { saveBenchmarks } from './utils';
import * as path from 'path';

async function main() {
    console.log("Starting DeepLens Benchmarks...\n");

    await runSearchBenchmarks();
    await runParserBenchmarks();
    await runTextSearchBenchmarks();

    console.log("Benchmarks completed.");

    const outputPath = process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, 'benchmarks.json');
    saveBenchmarks(outputPath);
}

main().catch(console.error);
