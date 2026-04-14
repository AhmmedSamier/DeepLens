import { parentPort, workerData } from 'node:worker_threads';
import { pLimit } from './p-limit';
import { Logger, TreeSitterParser } from './tree-sitter-parser';

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

        // ⚡ Bolt: Fast streaming pool optimization
        // Replace fixed-chunk Promise.all with a concurrency-limited task pool
        const limit = pLimit(BATCH_SIZE);
        let chunkItems: import('./types').SearchableItem[] = [];
        let batchFileCount = 0;
        let totalProcessed = 0;

        const tasks = filePaths.map((filePath) =>
            limit(async () => {
                let items: import('./types').SearchableItem[] = [];
                try {
                    items = await parser.parseFile(filePath);
                } catch {
                    items = [];
                }

                // Fast array concatenation
                chunkItems = chunkItems.concat(items);

                batchFileCount++;
                totalProcessed++;

                // Send back chunk result immediately when batch size is reached or at the end
                if (batchFileCount >= BATCH_SIZE || totalProcessed === filePaths.length) {
                    const currentFileCount = batchFileCount;
                    const currentItems = chunkItems;

                    // Reset accumulators
                    batchFileCount = 0;
                    chunkItems = [];

                    parentPort?.postMessage({
                        type: 'result',
                        items: currentItems,
                        count: currentFileCount,
                        isPartial: totalProcessed < filePaths.length,
                    });
                }
            }),
        );

        await Promise.all(tasks);
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
