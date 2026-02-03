
import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType, SearchScope } from '../src/core/types';
import { benchmark } from './utils';

export async function runEndpointBenchmarks() {
    console.log("=== Endpoint Search Benchmarks ===");

    const engine = new SearchEngine();
    const endpointCount = 10000;

    // Setup items
    const items = [];
    for (let i = 0; i < endpointCount; i++) {
        items.push({
            id: `endpoint-${i}`,
            name: `[GET] api/v1/users/${i}/details`,
            type: SearchItemType.ENDPOINT,
            filePath: `/project/src/controllers/UserController.ts`,
            relativeFilePath: `src/controllers/UserController.ts`,
            fullName: `UserController.getUserDetails${i}`
        });
    }

    engine.setItems(items);
    console.log(`Initialized engine with ${items.length} endpoints.`);

    // Query that looks like a URL
    const query = "api/v1/users/500/details";

    await benchmark("Endpoint Search (Unified)", async () => {
        await engine.search({ query, scope: SearchScope.EVERYTHING });
    }, 50);

    await benchmark("Endpoint Search (Burst)", async () => {
        engine.burstSearch({ query, scope: SearchScope.ENDPOINTS });
    }, 50);

    console.log("\n");
}
