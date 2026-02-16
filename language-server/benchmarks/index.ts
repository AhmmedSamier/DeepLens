import * as path from 'path';
import { runActivityTrackerBenchmarks } from './activity-tracker.bench';
import { runActivityBenchmarks } from './activity.bench';
import { runConcurrencyBenchmarks } from './concurrency.bench';
import { runEndpointBenchmarks } from './endpoint_search.bench';
import { runGitProviderBenchmarks } from './git-provider.bench';
import { runIncrementalBenchmarks } from './incremental.bench';
import { runIndexingBatchBenchmarks } from './indexing-batch.bench';
import { runIndexingFileExtensionsBenchmarks } from './indexing-extensions.bench';
import { runIndexingDensityBenchmarks } from './indexing-density.bench';
import { runIndexingScalingBenchmarks } from './indexing-scaling.bench';
import { runIndexingBenchmark } from './indexing.bench';
import { runLanguageBenchmarks } from './languages.bench';
import { runModifiedFilesBenchmark } from './modified-files.bench';
import { runParserBenchmarks } from './parser.bench';
import { runPruneCacheBenchmarks } from './prune_cache.bench';
import { runRouteMatcherBenchmarks } from './route-matcher.bench';
import { runSearchBenchmarks } from './search.bench';
import { runTextSearchBenchmarks } from './text-search.bench';

import { saveBenchmarks } from './utils';

async function main() {
    console.log('Starting DeepLens Benchmarks...\n');

    await runModifiedFilesBenchmark();
    await runEndpointBenchmarks();
    await runSearchBenchmarks();
    await runConcurrencyBenchmarks();
    await runRouteMatcherBenchmarks();
    await runParserBenchmarks();
    await runLanguageBenchmarks();
    await runTextSearchBenchmarks();
    await runIndexingBenchmark();
    await runIndexingScalingBenchmarks();
    await runIndexingBatchBenchmarks();
    await runIndexingDensityBenchmarks();
    await runIndexingFileExtensionsBenchmarks();
    await runIncrementalBenchmarks();
    await runActivityTrackerBenchmarks();

    await runActivityBenchmarks();
    await runPruneCacheBenchmarks();
    await runGitProviderBenchmarks();

    console.log('Benchmarks completed.');

    const outputPath = process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, 'benchmarks.json');
    saveBenchmarks(outputPath);
}

main().catch(console.error);
