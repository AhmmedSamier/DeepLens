import * as path from 'path';
import { runIndexingBenchmark } from './indexing.bench';
import { runParserBenchmarks } from './parser.bench';
import { runSearchBenchmarks } from './search.bench';
import { runTextSearchBenchmarks } from './text-search.bench';
import { saveBenchmarks } from './utils';

async function main() {
    console.log('Starting DeepLens Benchmarks...\n');

    await runSearchBenchmarks();
    await runParserBenchmarks();
    await runTextSearchBenchmarks();
    await runIndexingBenchmark();
    await runActivityTrackerBenchmark();
    await runActivityBenchmarks();

    console.log('Benchmarks completed.');

    const outputPath = process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, 'benchmarks.json');
    saveBenchmarks(outputPath);
}

main().catch(console.error);
