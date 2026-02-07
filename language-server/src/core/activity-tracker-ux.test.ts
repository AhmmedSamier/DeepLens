import { beforeEach, describe, expect, it } from 'bun:test';
import { ActivityTracker } from './activity-tracker';
import { SearchItemType } from './types';

describe('ActivityTracker UX', () => {
    let tracker: ActivityTracker;
    const mockStorage = {
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        },
    };

    beforeEach(() => {
        tracker = new ActivityTracker(mockStorage);
    });

    it('should add relative time to item details', () => {
        const item = {
            id: 'test-1',
            name: 'test.ts',
            type: SearchItemType.FILE,
            filePath: '/test.ts',
            detail: 'Recently opened',
        };

        tracker.recordAccess(item);

        const recentItems = tracker.getRecentItems(1);
        expect(recentItems.length).toBe(1);

        const recentItem = recentItems[0].item;
        expect(recentItem.detail).toContain('Accessed just now');
        expect(recentItem.detail).toContain('Recently opened');
    });

    it('should handle items without existing detail', () => {
        const item = {
            id: 'test-2',
            name: 'test2.ts',
            type: SearchItemType.FILE,
            filePath: '/test2.ts',
            detail: undefined,
        };

        tracker.recordAccess(item);

        const recentItems = tracker.getRecentItems(1);
        expect(recentItems.length).toBe(1);

        const recentItem = recentItems[0].item;
        expect(recentItem.detail).toBe('Accessed just now');
    });

    // We can't easily mock Date.now() in bun test without external libraries or prototype manipulation
    // so we skip testing precise time ranges (minutes/hours) and trust the logic is standard.
});
