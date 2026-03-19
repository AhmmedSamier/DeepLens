import { beforeEach, describe, expect, it } from 'bun:test';
import { ActivityTracker } from './activity-tracker';
import { SearchItemType } from './types';

describe('ActivityTracker', () => {
    let tracker: ActivityTracker;
    const mockStorage = {
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        },
    };

    beforeEach(async () => {
        tracker = new ActivityTracker(mockStorage);
        await tracker.waitForLoaded();
    });

    it('should calculate scores correctly on single access', async () => {
        const item = {
            id: 'test-1',
            name: 'test.ts',
            type: SearchItemType.FILE,
            filePath: '/test.ts',
        };

        tracker.recordAccess(item);
        await new Promise((r) => setTimeout(r, 10));
        const score = tracker.getActivityScore(item.id);

        expect(score).toBeGreaterThan(0.9);
    });

    it('should update relative scores when multiple items exist', async () => {
        const item1 = { id: '1', name: '1', type: SearchItemType.FILE, filePath: '/1' };
        const item2 = { id: '2', name: '2', type: SearchItemType.FILE, filePath: '/2' };

        tracker.recordAccess(item1);
        tracker.recordAccess(item1);

        tracker.recordAccess(item2);

        await new Promise((r) => setTimeout(r, 10));

        const score1 = tracker.getActivityScore('1');
        const score2 = tracker.getActivityScore('2');

        expect(score1).toBeGreaterThan(score2);
        expect(score2).toBeGreaterThan(0);
    });

    it('should remove item when removeItem is called', async () => {
        const item = {
            id: 'test-remove',
            name: 'test.ts',
            type: SearchItemType.FILE,
            filePath: '/test.ts',
        };

        tracker.recordAccess(item);
        await new Promise((r) => setTimeout(r, 10));
        expect(tracker.getActivityScore(item.id)).toBeGreaterThan(0);

        await tracker.removeItem(item.id);
        expect(tracker.getActivityScore(item.id)).toBe(0);
    });

    describe('race conditions', () => {
        it('should handle concurrent access during initialization', async () => {
            let loadResolve: () => void;
            const loadPromise = new Promise<void>((resolve) => {
                loadResolve = resolve;
            });

            const slowMockStorage = {
                workspaceState: {
                    get: async () => {
                        await loadPromise;
                        return undefined;
                    },
                    update: async () => {},
                },
            };

            const slowTracker = new ActivityTracker(slowMockStorage);

            const item = {
                id: 'concurrent-test',
                name: 'test.ts',
                type: SearchItemType.FILE,
                filePath: '/test.ts',
            };

            slowTracker.recordAccess(item);

            loadResolve!();

            await slowTracker.waitForLoaded();

            expect(slowTracker.getActivityScore(item.id)).toBeGreaterThan(0);
        });

        it('should queue operations until init completes', async () => {
            let loadResolve: () => void;
            const loadPromise = new Promise<void>((resolve) => {
                loadResolve = resolve;
            });

            const slowMockStorage = {
                workspaceState: {
                    get: async () => {
                        await loadPromise;
                        return {
                            'existing-item': {
                                itemId: 'existing-item',
                                lastAccessed: Date.now(),
                                accessCount: 5,
                                score: 0.5,
                            },
                        };
                    },
                    update: async () => {},
                },
            };

            const slowTracker = new ActivityTracker(slowMockStorage);

            const item = {
                id: 'new-item',
                name: 'new.ts',
                type: SearchItemType.FILE,
                filePath: '/new.ts',
            };

            slowTracker.recordAccess(item);

            expect(slowTracker.getActivityScore('new-item')).toBe(0);

            loadResolve!();

            await slowTracker.waitForLoaded();

            expect(slowTracker.getActivityScore('new-item')).toBeGreaterThan(0);
        });
    });
});
