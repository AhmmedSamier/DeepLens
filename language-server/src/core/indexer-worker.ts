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
        const limit = pLimit(BATCH_SIZE);

        // We know parser.parseFile returns SearchableItem[], so we can use it, though here we'll use a type import if available or just not use any
        // wait, we don't have SearchableItem imported. Let's use ReturnType<typeof parser.parseFile>
        type SearchableItem = Awaited<ReturnType<typeof parser.parseFile>>[number];
        const pendingItems: SearchableItem[] = [];
        let processedCount = 0;
        let totalProcessed = 0;
        const totalFiles = filePaths.length;

        // ⚡ Bolt: Fast streaming queue optimization
        // Replaces fixed-chunk Promise.all with a continuous task pool (pLimit).
        // This avoids head-of-line blocking where fast files wait for the slowest file in a chunk
        // before results can be sent back to the parent thread.
        await Promise.all(
            filePaths.map((filePath) =>
                limit(async () => {
                    try {
                        const items = await parser.parseFile(filePath);
                        // Prevent call stack limits via flat/spread on large outputs by using manual loop
                        for (let j = 0; j < items.length; j++) {
                            pendingItems.push(items[j]);
                        }
                    } catch {
                        // ignore
                    } finally {
                        processedCount++;
                        totalProcessed++;

                        // Stream results back as soon as we have a batch-worth of files processed
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
