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

parentPort.on('message', async (message: { filePath: string }) => {
    try {
        if (!isInitialized) {
            await parser.init();
            isInitialized = true;
        }

        const { filePath } = message;
        const items = await parser.parseFile(filePath);

        parentPort?.postMessage({ type: 'result', filePath, items });
    } catch (error) {
        parentPort?.postMessage({
            type: 'error',
            filePath: message.filePath,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
