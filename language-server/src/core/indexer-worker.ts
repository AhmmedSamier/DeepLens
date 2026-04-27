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
        const BATCH_SIZE = message.chunkSize ?? 25;

        // ⚡ Bolt: Fast concurrent streaming optimization
        // Replace fixed-chunk Promise.all with a concurrency-limited task pool.
        // This prevents head-of-line blocking where one slow file stalls the entire batch,
        // allowing faster files to stream their results immediately.
        const limit = pLimit(BATCH_SIZE);
        let batchItems: SearchableItem[] = [];
        let batchCount = 0;
        let totalCompleted = 0;

        const processFile = async (filePath: string) => {
            let items: SearchableItem[] = [];
            try {
                items = await parser.parseFile(filePath);
            } catch {
                // Ignore parse errors
            }

            for (let j = 0; j < items.length; j++) {
                batchItems.push(items[j]);
            }
            batchCount++;
            totalCompleted++;

            if (batchCount >= BATCH_SIZE || totalCompleted === filePaths.length) {
                const itemsToSend = batchItems;
                const countToSend = batchCount;
                batchItems = [];
                batchCount = 0;

                parentPort?.postMessage({
                    type: 'result',
                    items: itemsToSend,
                    count: countToSend,
                    isPartial: totalCompleted < filePaths.length,
                });
            }
        };

        await Promise.all(filePaths.map((filePath) => limit(() => processFile(filePath))));
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
