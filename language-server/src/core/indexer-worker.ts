import { parentPort, workerData } from 'node:worker_threads';
import { pLimit } from './p-limit';
import { Logger, TreeSitterParser } from './tree-sitter-parser';
import type { SearchableItem } from './types';

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

parentPort.on('message', async (message: { filePaths: string[]; chunkSize?: number; concurrency?: number }) => {
    try {
        if (!isInitialized) {
            await parser.init();
            isInitialized = true;
        }

        const { filePaths } = message;

        if (filePaths.length === 0) {
            // Warmup path: parser was initialized above; no response needed.
            // Do NOT post a reply here — a spurious result message would be
            // queued and delivered into the worker pool during real indexing,
            // decrementing activeTasks prematurely and resolving the pool
            // before any symbols are parsed.
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

        if (message.concurrency !== undefined) {
            if (
                typeof message.concurrency !== 'number' ||
                !Number.isFinite(message.concurrency) ||
                !Number.isInteger(message.concurrency) ||
                message.concurrency <= 0
            ) {
                parentPort?.postMessage({
                    type: 'error',
                    error: `Invalid concurrency: ${message.concurrency}. Must be a finite positive integer.`,
                });
                return;
            }
        }

        const BATCH_SIZE = message.chunkSize ?? 25;
        const concurrencyLimit = message.concurrency ?? 15;

        // ⚡ Bolt: Fast concurrent streaming optimization
        // Replaces fixed-chunk Promise.all processing with a concurrency-limited task pool (pLimit).
        // This prevents head-of-line blocking where fast files wait for the slowest file in a chunk,
        // reducing indexing latency and streaming results back to the parent thread continuously.
        const limit = pLimit(concurrencyLimit);
        let pendingItems: SearchableItem[] = [];
        let processedCount = 0;
        let totalCompleted = 0;

        const flushBatch = (isPartial: boolean) => {
            if (pendingItems.length > 0 || !isPartial) {
                parentPort?.postMessage({
                    type: 'result',
                    items: pendingItems,
                    count: processedCount,
                    isPartial,
                });
                pendingItems = [];
                processedCount = 0;
            }
        };

        const tasks = filePaths.map((filePath) => {
            return limit(async () => {
                let itemsCount = 0;
                try {
                    const parsedItems = await parser.parseFile(filePath);
                    itemsCount = parsedItems.length;

                    // Avoid array spread to prevent Call Stack Size Exceeded
                    for (let i = 0; i < itemsCount; i++) {
                        pendingItems.push(parsedItems[i]);
                    }
                } catch {
                    // Ignore parse errors for individual files
                } finally {
                    processedCount += itemsCount;
                    totalCompleted++;

                    // Flush when we hit batch size or it's the very last item
                    const isLast = totalCompleted === filePaths.length;
                    if (processedCount >= BATCH_SIZE || isLast) {
                        flushBatch(!isLast);
                    }
                }
            });
        });

        await Promise.all(tasks);
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
