import { parentPort, workerData } from 'worker_threads';
import { TreeSitterParser, Logger } from './tree-sitter-parser';
import { SearchableItem } from './types';

if (!parentPort) {
    throw new Error('This script must be run as a worker thread');
}

const { extensionPath } = workerData;

// Simple logger that sends logs to the parent
const logger: Logger = {
    appendLine: (message: string) => {
        parentPort?.postMessage({ type: 'log', message });
    }
};

const parser = new TreeSitterParser(extensionPath, logger);
let isInitialized = false;

parentPort.on('message', async (message: { filePaths: string[] }) => {
    try {
        if (!isInitialized) {
            await parser.init();
            isInitialized = true;
        }

        const { filePaths } = message;
        const allItems: SearchableItem[] = [];

        for (const filePath of filePaths) {
            // parser.parseFile handles internal errors and returns empty array if failed
            const items = await parser.parseFile(filePath);
            allItems.push(...items);
        }

        // Send back all items and the count of processed files
        parentPort?.postMessage({
            type: 'result',
            items: allItems,
            count: filePaths.length
        });

    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
