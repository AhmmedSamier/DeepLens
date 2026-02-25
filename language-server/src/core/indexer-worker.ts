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
        // Use chunkSize as concurrency limit
        const BATCH_SIZE = message.chunkSize ?? 25;
        const limit = pLimit(BATCH_SIZE);

        let processedCount = 0;
        let batchBuffer: SearchableItem[] = [];
        let batchCount = 0;

        const sendBatch = (isFinal: boolean) => {
            if (batchCount > 0 || isFinal) {
                parentPort?.postMessage({
                    type: 'result',
                    items: batchBuffer,
                    count: batchCount,
                    isPartial: !isFinal,
                });
                batchBuffer = [];
                batchCount = 0;
            }
        };

        await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    try {
                        const items = await parser.parseFile(filePath);
                        batchBuffer.push(...items);
                    } catch {
                        // ignore error
                    } finally {
                        processedCount++;
                        batchCount++;

                        // Check if we should flush intermediate batch
                        if (batchCount >= BATCH_SIZE && processedCount < filePaths.length) {
                            sendBatch(false);
                        }
                    }
                }),
            ),
        );

        // Always send final batch to signal completion (!isPartial)
        sendBatch(true);
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
