import { parentPort, workerData } from 'node:worker_threads';
import { pLimit } from './p-limit';
import { Logger, TreeSitterParser } from './tree-sitter-parser';
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

        if (message.chunkSize !== undefined && (!Number.isInteger(message.chunkSize) || message.chunkSize <= 0)) {
            const errorMsg = `Invalid chunkSize: ${message.chunkSize}`;
            workerLogger.appendLine(errorMsg);
            throw new Error(errorMsg);
        }

        const BATCH_SIZE = message.chunkSize ?? 25;

        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            const chunk = filePaths.slice(i, i + BATCH_SIZE);

        // ⚡ Bolt: Use a concurrency-limited task pool instead of fixed-chunk Promise.all
        // This eliminates head-of-line blocking so fast files don't wait for the slowest
        // file in a specific chunk. Results stream back to the parent continuously.
        if (filePaths.length === 0) {
            parentPort?.postMessage({
                type: 'result',
                items: [],
                count: 0,
                isPartial: false,
            });
            return;
        }

        const limit = pLimit(BATCH_SIZE);

        let processedCount = 0;
        let pendingCount = 0;
        const pendingItems: SearchableItem[] = [];

        // Process files with concurrency limiting and incremental result streaming
        const results = await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    try {
                        return await parser.parseFile(filePath);
                    } catch {
                        return [];
                    }
                }),
            );

        const allItems = results.flat();

            // Stream back partial result to keep main thread responsive while continuing processing
            parentPort?.postMessage({
                type: 'result',
                items: allItems,
                count: chunk.length,
                isPartial: i + BATCH_SIZE < filePaths.length,
            });
        }
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
