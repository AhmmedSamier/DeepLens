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
        let batchedItems: SearchableItem[] = [];
        let processedCount = 0;
        let filesInCurrentBatch = 0;

        await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    try {
                        const items = await parser.parseFile(filePath);
                        for (let i = 0; i < items.length; i++) {
                            batchedItems.push(items[i]);
                        }
                    } catch {
                        // ignore
                    }

                    processedCount++;
                    filesInCurrentBatch++;

                    // Send back chunk result immediately to keep main thread unblocked but processing
                    if (filesInCurrentBatch >= BATCH_SIZE || processedCount === filePaths.length) {
                        const chunkItems = batchedItems;
                        const chunkCount = filesInCurrentBatch;
                        batchedItems = [];
                        filesInCurrentBatch = 0;

                        parentPort?.postMessage({
                            type: 'result',
                            items: chunkItems,
                            count: chunkCount,
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
