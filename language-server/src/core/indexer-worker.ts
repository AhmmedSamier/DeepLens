import { parentPort, workerData } from 'node:worker_threads';
import { Logger, TreeSitterParser } from './tree-sitter-parser';
import { pLimit } from './p-limit';
import { SearchableItem } from './types';

if (!parentPort) {
    throw new Error('This script must be run as a worker thread');
}

const { extensionPath } = workerData;

// Simple logger that sends logs to the parent
const workerLogger: Logger = {
    appendLine: (message: string) => {
        parentPort?.postMessage({ type: 'log', message });
    },
};

const parser = new TreeSitterParser(extensionPath, workerLogger);
let isInitialized = false;

parentPort.on('message', async (message: { filePaths: string[]; chunkSize?: number }) => {
    try {
        if (!isInitialized) {
            await parser.init();
            isInitialized = true;
        }

        const { filePaths } = message;
        const BATCH_SIZE = message.chunkSize ?? 25;

        // ⚡ Bolt: Fast concurrent streaming optimization
        // Replaces fixed-chunk Promise.all processing with a concurrency-limited task pool (pLimit).
        // This prevents head-of-line blocking where fast files wait for the slowest file in a chunk,
        // reducing indexing latency and streaming results back to the parent thread continuously.
        const limit = pLimit(BATCH_SIZE);
        let chunkItems: SearchableItem[] = [];
        let processedCount = 0;

        await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    let items: SearchableItem[] = [];
                    try {
                        items = await parser.parseFile(filePath);
                    } catch {
                        items = [];
                    }

                    // Push elements directly using a manual loop to avoid spreading large arrays
                    for (let j = 0; j < items.length; j++) {
                        chunkItems.push(items[j]);
                    }

                    processedCount++;

                    // Stream results when chunk reaches BATCH_SIZE or it's the last item
                    if (processedCount % BATCH_SIZE === 0 || processedCount === filePaths.length) {
                        const itemsToSend = chunkItems;
                        chunkItems = []; // Reset for next batch

                        parentPort?.postMessage({
                            type: 'result',
                            items: itemsToSend,
                            count: processedCount % BATCH_SIZE === 0 ? BATCH_SIZE : processedCount % BATCH_SIZE,
                            isPartial: processedCount < filePaths.length,
                        });
                    }
                }),
            ),
        );
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
