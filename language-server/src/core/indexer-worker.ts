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
        const limit = pLimit(BATCH_SIZE);

        const pendingItems: SearchableItem[] = [];
        let processedCount = 0;
        let batchCount = 0;

        await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    try {
                        const items = await parser.parseFile(filePath);
                        for (let j = 0; j < items.length; j++) {
                            pendingItems.push(items[j]);
                        }
                    } catch {
                        // ignore error
                    } finally {
                        processedCount++;
                        batchCount++;

                        if (batchCount >= BATCH_SIZE || processedCount === filePaths.length) {
                            parentPort?.postMessage({
                                type: 'result',
                                items: pendingItems,
                                count: batchCount,
                                isPartial: processedCount < filePaths.length,
                            });
                            pendingItems.length = 0;
                            batchCount = 0;
                        }
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
