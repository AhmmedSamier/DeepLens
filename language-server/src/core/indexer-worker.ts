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

        // ⚡ Bolt: Head-of-line blocking optimization
        // Replace fixed-chunk Promise.all processing with a concurrency-limited task pool.
        // This allows results to stream back to the parent thread continuously,
        // preventing one slow file from delaying an entire batch.
        const limit = pLimit(BATCH_SIZE);
        let batchItems: SearchableItem[] = [];
        let batchProcessedFiles = 0;
        let totalProcessedFiles = 0;

        const flushBatch = (isFinal: boolean) => {
            if (batchItems.length > 0 || isFinal) {
                parentPort?.postMessage({
                    type: 'result',
                    items: batchItems,
                    count: batchProcessedFiles,
                    isPartial: !isFinal,
                });
                batchItems = [];
                batchProcessedFiles = 0;
            }
        };

        const promises = filePaths.map((filePath) =>
            limit(async () => {
                let items: SearchableItem[] = [];
                try {
                    items = await parser.parseFile(filePath);
                } catch {
                    items = [];
                }

                // Append items without spread operator to avoid Maximum Call Stack Size Exceeded
                for (let i = 0; i < items.length; i++) {
                    batchItems.push(items[i]);
                }

                batchProcessedFiles++;
                totalProcessedFiles++;

                // Flush if we reach batch size
                if (batchProcessedFiles >= BATCH_SIZE) {
                    flushBatch(totalProcessedFiles === filePaths.length);
                }
            }),
        );

        await Promise.all(promises);

        // Final flush if anything remains
        if (batchProcessedFiles > 0) {
            flushBatch(true);
        }
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
