import { parentPort, workerData } from 'node:worker_threads';
import { Logger, TreeSitterParser } from './tree-sitter-parser';
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
        const BATCH_SIZE = message.chunkSize ?? 25;

        // ⚡ Bolt: Prevent head-of-line blocking by using pLimit
        // Replaces fixed-chunk Promise.all() which waits for the slowest file in a batch.
        const limit = pLimit(BATCH_SIZE);

        let currentBatchItems: unknown[] = [];
        let filesCompletedInBatch = 0;
        let totalFilesCompleted = 0;

        const promises = filePaths.map((filePath) =>
            limit(async () => {
                let items: unknown[] = [];
                try {
                    items = await parser.parseFile(filePath);
                } catch {
                    items = [];
                }

                // ⚡ Bolt: Use a loop instead of spread operator to avoid Maximum Call Stack Size Exceeded errors for large arrays.
                for (let i = 0; i < items.length; i++) {
                    currentBatchItems.push(items[i]);
                }
                filesCompletedInBatch++;
                totalFilesCompleted++;

                const isLast = totalFilesCompleted === filePaths.length;
                if (filesCompletedInBatch >= BATCH_SIZE || isLast) {
                    parentPort?.postMessage({
                        type: 'result',
                        items: currentBatchItems,
                        count: filesCompletedInBatch,
                        isPartial: !isLast,
                    });
                    currentBatchItems = [];
                    filesCompletedInBatch = 0;
                }
            }),
        );

        await Promise.all(promises);
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
