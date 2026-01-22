import * as fs from 'fs';
import * as crypto from 'crypto';
import { parentPort, workerData } from 'worker_threads';
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

parentPort.on('message', async (message: { filePaths: string[] }) => {
    try {
        if (!isInitialized) {
            await parser.init();
            isInitialized = true;
        }

        const { filePaths } = message;
        const allItems: SearchableItem[] = [];
        const fileResults: any[] = [];

        for (const filePath of filePaths) {
            try {
                const stats = await fs.promises.stat(filePath);
                const content = await fs.promises.readFile(filePath);
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                
                // parser.parseFile handles internal errors and returns empty array if failed
                const items = await parser.parseFile(filePath);
                allItems.push(...items);

                fileResults.push({
                    filePath,
                    mtime: Number(stats.mtime),
                    hash,
                    symbols: items
                });
            } catch (e) {
                // Skip files that can't be read
            }
        }

        // Send back all items and the count of processed files
        parentPort?.postMessage({
            type: 'result',
            items: allItems,
            fileResults,
            count: filePaths.length,
        });
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
