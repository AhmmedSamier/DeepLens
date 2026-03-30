import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope, type SearchableItem } from '../src/core/types';
import { benchmark } from './utils';

export async function runRouteMatcherBenchmarks() {
    console.log('=== Route Matcher Benchmarks ===');

    const engine = new SearchEngine();
    const itemCount = 50000;

    // Setup items with many endpoints
    const items: SearchableItem[] = [];

    for (let i = 0; i < itemCount; i++) {
        // Mix of files and endpoints
        if (i % 2 === 0) {
            items.push({
                id: `endpoint-${i}`,
                name: `api/v1/users/${i}/details`,
                type: SearchItemType.ENDPOINT,
                filePath: `/project/src/api/users.ts`,
                relativeFilePath: `src/api/users.ts`,
                fullName: `api/v1/users/${i}/details`,
            });
        } else {
            items.push({
                id: `file-${i}`,
                name: `User${i}Controller.ts`,
                type: SearchItemType.FILE,
                filePath: `/project/src/controllers/User${i}Controller.ts`,
                relativeFilePath: `src/controllers/User${i}Controller.ts`,
                fullName: `User${i}Controller.ts`,
            });
        }
    }

    await engine.setItems(items);

    console.log(`Initialized engine with ${items.length} items.`);

    // Query that triggers URL matching (has slashes)
    await benchmark(
        "Route Match Search 'api/v1/users'",
        async () => {
            await engine.search({ query: 'api/v1/users', scope: SearchScope.EVERYTHING });
        },
        100,
    );

    // Burst search version
    await benchmark(
        "Route Match Burst 'api/v1/users'",
        async () => {
            await engine.burstSearch({ query: 'api/v1/users', scope: SearchScope.EVERYTHING });
        },
        100,
    );

    // Also benchmark `isPotentialUrl`
    const { RouteMatcher } = await import('../src/core/route-matcher');
    const strings = ["api/v1/users", "GET api/users", "POST /api", "customers", "not_a_url_really", "another one", "api customers", "longstring_without_spaces_or_slashes_and_so_on"];
    await benchmark(
        "RouteMatcher.isPotentialUrl",
        async () => {
            for (let i = 0; i < 10000; i++) {
                RouteMatcher.isPotentialUrl(strings[i % strings.length]);
            }
        },
        100,
    );

    await benchmark(
        "RouteMatcher.prepare",
        async () => {
            for (let i = 0; i < 1000; i++) {
                RouteMatcher.prepare("GET /api/v1/users/details");
                RouteMatcher.prepare("api/v1/users/details");
            }
        },
        100,
    );
    console.log('\n');
}
