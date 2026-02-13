import * as path from 'path';
import { runActivityTrackerBenchmarks } from './activity-tracker.bench';
import { runActivityBenchmarks } from './activity.bench';
import { runEndpointBenchmarks } from './endpoint_search.bench';
import { runIndexingBenchmark } from './indexing.bench';
import { runParserBenchmarks } from './parser.bench';
import { runPruneCacheBenchmarks } from './prune_cache.bench';
import { runRouteMatcherBenchmarks } from './route-matcher.bench';
import { runSearchBenchmarks } from './search.bench';
import { runTextSearchBenchmarks } from './text-search.bench';
import { saveBenchmarks } from './utils';

async function main() {
    console.log('Starting DeepLens Benchmarks...\n');

    await runEndpointBenchmarks();
    await runSearchBenchmarks();
    await runRouteMatcherBenchmarks();
    await runParserBenchmarks();
    await runTextSearchBenchmarks();
    await runIndexingBenchmark();
    await runActivityTrackerBenchmarks();
    await runActivityBenchmarks();
    await runPruneCacheBenchmarks();

    console.log('Benchmarks completed.');

    const outputPath = process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, 'benchmarks.json');
    saveBenchmarks(outputPath);
}

main().catch(console.error);
