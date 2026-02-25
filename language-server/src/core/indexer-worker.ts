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

        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
            const chunk = filePaths.slice(i, i + BATCH_SIZE);
            const limit = pLimit(BATCH_SIZE);

            const results = await Promise.all(
                chunk.map((filePath) =>
                    limit(async () => {
                        try {
                            return await parser.parseFile(filePath);
                        } catch {
                            return [];
                        }
                    }),
                ),
            );

            const chunkItems = results.flat();

            parentPort?.postMessage({
                type: 'result',
                items: chunkItems,
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
