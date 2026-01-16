import { runSearchBenchmarks } from './search.bench';
import { runParserBenchmarks } from './parser.bench';
import { runTextSearchBenchmarks } from './text-search.bench';

async function main() {
    console.log("Starting DeepLens Benchmarks...\n");

    await runSearchBenchmarks();
    await runParserBenchmarks();
    await runTextSearchBenchmarks();

    console.log("Benchmarks completed.");
}

main().catch(console.error);
