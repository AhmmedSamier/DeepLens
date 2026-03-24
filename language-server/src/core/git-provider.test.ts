import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { GitProvider } from './git-provider';

class MockChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
}

afterEach(() => {
    mock.restore();
});

describe('GitProvider', () => {
    test('should not warn for non-git repositories', async () => {
        spyOn(cp, 'spawn').mockImplementation((() => {
            const child = new MockChildProcess();
            queueMicrotask(() => {
                child.stderr.emit('data', Buffer.from('fatal: not a git repository'));
                child.emit('close', 128);
            });
            return child as unknown as cp.ChildProcessWithoutNullStreams;
        }) as typeof cp.spawn);

        const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

        const provider = new GitProvider(['/workspace/not-repo']);
        const modified = await provider.getModifiedFiles();

        expect(modified.size).toBe(0);
        expect(warnSpy).toHaveBeenCalledTimes(0);
    });

    test('should warn for unexpected git failures', async () => {
        spyOn(cp, 'spawn').mockImplementation((() => {
            const child = new MockChildProcess();
            queueMicrotask(() => {
                child.stderr.emit('data', Buffer.from('fatal: index.lock exists'));
                child.emit('close', 128);
            });
            return child as unknown as cp.ChildProcessWithoutNullStreams;
        }) as typeof cp.spawn);

        const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);

        const provider = new GitProvider(['/workspace/repo']);
        await provider.getModifiedFiles();

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain('Failed to query git status for /workspace/repo');
        expect(warnSpy.mock.calls[0]?.[0]).toContain('index.lock exists');
    });
});
