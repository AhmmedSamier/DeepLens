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

        const limit = pLimit(BATCH_SIZE);
        let pendingItems: import('./types').SearchableItem[] = [];
        let processedCount = 0;
        let totalCompleted = 0;

        const flushBatch = (isPartial: boolean) => {
            if (pendingItems.length > 0 || !isPartial) {
                parentPort?.postMessage({
                    type: 'result',
                    items: pendingItems,
                    count: processedCount,
                    isPartial,
                });
                pendingItems = [];
                processedCount = 0;
            }
        };

        const tasks = filePaths.map((filePath) => {
            return limit(async () => {
                try {
                    const parsedItems = await parser.parseFile(filePath);

                    // Avoid array spread to prevent Call Stack Size Exceeded
                    for (let i = 0; i < parsedItems.length; i++) {
                        pendingItems.push(parsedItems[i]);
                    }
                } catch {
                    // Ignore parse errors for individual files
                } finally {
                    processedCount++;
                    totalCompleted++;

                    // Flush when we hit batch size or it's the very last item
                    const isLast = totalCompleted === filePaths.length;
                    if (processedCount >= BATCH_SIZE || isLast) {
                        flushBatch(!isLast);
                    }
                }
            });
        });

        await Promise.all(tasks);
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
