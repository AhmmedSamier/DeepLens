import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import { WorkspaceIndexer } from './workspace-indexer';
import { Config } from './config';
import { IndexerEnvironment } from './indexer-interfaces';
import { IndexPersistence } from './index-persistence';
import { TreeSitterParser } from './tree-sitter-parser';
import { SearchItemType, SearchableItem } from './types';

// Mock dependencies
const mockConfig = new Config();
const mockEnv: IndexerEnvironment = {
    getWorkspaceFolders: () => ['/root'],
    findFiles: async () => [],
    asRelativePath: (p) => p.replace('/root/', ''),
    log: () => {},
    createFileSystemWatcher: (p, cb) => { return { dispose: () => {} } } // Mock watcher
};

// Mock TreeSitter to return specific symbols
class MockTreeSitter extends TreeSitterParser {
    constructor() {
        super('', { appendLine: () => {} });
    }

    async parseFile(filePath: string) {
        // Return dummy implementation, we will override or mock this dynamically if needed
        return [];
    }
}

describe('WorkspaceIndexer Events', () => {
    let indexer: WorkspaceIndexer;
    let persistence: IndexPersistence;
    let treeSitter: MockTreeSitter;

    beforeEach(() => {
        persistence = new IndexPersistence('/tmp');
        treeSitter = new MockTreeSitter() as any;
        indexer = new WorkspaceIndexer(mockConfig, treeSitter, persistence, mockEnv, '/tmp');

        // Mock fs.promises.stat to avoid ENOENT
        spyOn(fs.promises, 'stat').mockImplementation(async () => ({
            mtime: 200 // newer mtime
        } as any));
    });

    it('should re-index a changed file even if a cached hash exists', async () => {
        const filePath = '/root/file.ts';
        const oldHash = 'old-hash';
        const newHash = 'new-hash';

        const oldSymbol = {
            id: 'old',
            name: 'OldSymbol',
            type: SearchItemType.CLASS,
            filePath,
            relativeFilePath: 'file.ts',
            line: 0,
            column: 0,
            fullName: 'OldSymbol'
        };

        const newSymbol = {
            id: 'new',
            name: 'NewSymbol',
            type: SearchItemType.CLASS,
            filePath,
            relativeFilePath: 'file.ts',
            line: 1,
            column: 0,
            fullName: 'NewSymbol'
        };

        // 1. Setup initial state (Simulate file already indexed)

        // Populate persistence with old data
        spyOn(persistence, 'get').mockImplementation((path) => {
            if (path === filePath) {
                return { mtime: 100, hash: oldHash, symbols: [oldSymbol] };
            }
            return undefined;
        });

        // Populate in-memory hash cache with old hash
        (indexer as any).fileHashes.set(filePath, oldHash);

        // Mock calculateSingleFileHash to return NEW hash (simulating file content change)
        (indexer as any).calculateSingleFileHash = async () => newHash;

        // Mock performSymbolExtraction to return NEW symbols
        (indexer as any).performSymbolExtraction = async () => [newSymbol];

        // 2. Trigger handleFileChanged
        const addedItems: SearchableItem[] = [];
        const removedFiles: string[] = [];
        indexer.onItemsAdded(items => addedItems.push(...items));
        indexer.onItemsRemoved(path => removedFiles.push(path));

        // Access private method
        await (indexer as any).handleFileChanged(filePath);

        // 3. Assertions

        // Should have emitted remove event
        expect(removedFiles).toContain(filePath);

        // Should have emitted add event with new symbols
        const hasOldSymbol = addedItems.some(i => i.name === 'OldSymbol');
        const hasNewSymbol = addedItems.some(i => i.name === 'NewSymbol');

        // We expect OldSymbol to be GONE (never emitted in this batch) and NewSymbol to be PRESENT
        expect(hasOldSymbol).toBe(false);
        expect(hasNewSymbol).toBe(true);
    });
});
