import { parentPort, workerData } from 'node:worker_threads';
import { Logger, TreeSitterParser } from './tree-sitter-parser';
import { SearchableItem } from './types';
import { pLimit } from './p-limit';

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

        if (filePaths.length === 0) {
            parentPort?.postMessage({
                type: 'result',
                items: [],
                count: 0,
                isPartial: false,
            });
            return;
        }

        if (message.chunkSize !== undefined) {
            if (
                typeof message.chunkSize !== 'number' ||
                !Number.isFinite(message.chunkSize) ||
                !Number.isInteger(message.chunkSize) ||
                message.chunkSize <= 0
            ) {
                parentPort?.postMessage({
                    type: 'error',
                    error: `Invalid chunkSize: ${message.chunkSize}. Must be a finite positive integer.`,
                });
                return;
            }
        }

        const BATCH_SIZE = message.chunkSize ?? 25;
        const limit = pLimit(BATCH_SIZE);

        const pendingItems: SearchableItem[] = [];
        let processedCount = 0;
        let totalProcessed = 0;
        const totalFiles = filePaths.length;

        // ⚡ Bolt: Bounded producer loop optimization
        // Replaces eager filePaths.map with a worker pool to avoid allocating all closures upfront.
        // This ensures memory usage remains bounded even for massive workspaces.
        let currentIndex = 0;
        const workers = [];
        const numWorkers = Math.min(BATCH_SIZE, totalFiles);

        for (let i = 0; i < numWorkers; i++) {
            workers.push(
                (async () => {
                    while (currentIndex < totalFiles) {
                        const filePath = filePaths[currentIndex++];
                        if (!filePath) break;

                        // schedules work through limit but only creates tasks as concurrency frees up
                        await limit(() =>
                            parser
                                .parseFile(filePath)
                                .then((items) => {
                                    for (let j = 0; j < items.length; j++) {
                                        pendingItems.push(items[j]);
                                    }
                                })
                                .catch(() => {
                                    // ignore errors
                                })
                                .finally(() => {
                                    processedCount++;
                                    totalProcessed++;

                                    // Stream results back as soon as we have a batch-worth of items processed
                                    if (processedCount >= BATCH_SIZE || totalProcessed === totalFiles) {
                                        const chunkItems = pendingItems.slice();
                                        const currentCount = processedCount;

                                        pendingItems.length = 0;
                                        processedCount = 0;

                                        parentPort?.postMessage({
                                            type: 'result',
                                            items: chunkItems,
                                            count: currentCount,
                                            isPartial: totalProcessed < totalFiles,
                                        });
                                    }
                                }),
                        );
                    }
                })(),
            );
        }

        await Promise.all(workers);
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
