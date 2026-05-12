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
        const CONCURRENCY = 15;

        // ⚡ Bolt: Remove head-of-line blocking by using a concurrency task pool
        // instead of chunked Promise.all
        const limit = pLimit(CONCURRENCY);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let batchItems: any[] = [];
        let batchProcessedFiles = 0;
        let totalCompleted = 0;

        await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    try {
                        const items = await parser.parseFile(filePath);
                        // ⚡ Bolt: Fast manual loop pushing to avoid Maximum Call Stack Size Exceeded
                        for (let i = 0; i < items.length; i++) {
                            batchItems.push(items[i]);
                        }
                    } catch {
                        // Ignore
                    } finally {
                        totalCompleted++;
                        batchProcessedFiles++;

                        if (batchProcessedFiles >= BATCH_SIZE || totalCompleted === filePaths.length) {
                            parentPort?.postMessage({
                                type: 'result',
                                items: batchItems,
                                count: batchProcessedFiles,
                                isPartial: totalCompleted < filePaths.length,
                            });
                            batchItems = [];
                            batchProcessedFiles = 0;
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
