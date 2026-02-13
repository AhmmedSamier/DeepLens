import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { GitProvider } from '../src/core/git-provider';
import { benchmark } from './utils';

// Use a directory that is guaranteed to be writeable and ignored by the main repo's git
const TEMP_DIR = path.join(process.cwd(), 'temp-git-bench');

function setupGitRepo() {
    if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_DIR);

    // Initialize repo
    cp.execSync('git init', { cwd: TEMP_DIR, stdio: 'ignore' });
    // Config needed for commits
    cp.execSync('git config user.email "bench@example.com"', { cwd: TEMP_DIR, stdio: 'ignore' });
    cp.execSync('git config user.name "Benchmark"', { cwd: TEMP_DIR, stdio: 'ignore' });

    // 1. Create a committed file (will modify later)
    fs.writeFileSync(path.join(TEMP_DIR, 'file1.txt'), 'initial content');
    cp.execSync('git add file1.txt', { cwd: TEMP_DIR, stdio: 'ignore' });
    cp.execSync('git commit -m "initial commit"', { cwd: TEMP_DIR, stdio: 'ignore' });

    // Modify the committed file
    fs.writeFileSync(path.join(TEMP_DIR, 'file1.txt'), 'modified content');

    // 2. Create a staged file (modified in index but not committed)
    fs.writeFileSync(path.join(TEMP_DIR, 'file2.txt'), 'staged content');
    cp.execSync('git add file2.txt', { cwd: TEMP_DIR, stdio: 'ignore' });

    // 3. Create an untracked file
    fs.writeFileSync(path.join(TEMP_DIR, 'file3.txt'), 'untracked content');
}

function cleanupGitRepo() {
    if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
}

export async function runGitProviderBenchmarks() {
    console.log('Setting up temporary git repo at:', TEMP_DIR);
    try {
        setupGitRepo();

        const provider = new GitProvider([TEMP_DIR]);

        // Run benchmark
        // We do more iterations to smooth out process spawn overhead
        const result = await benchmark('GitProvider.getModifiedFiles', async () => {
            const files = await provider.getModifiedFiles();
            // Optional: verify we got results
            if (files.size === 0) {
                 console.warn('Warning: No modified files detected in benchmark!');
            }
        }, 20);

    } catch (e) {
        console.error('Benchmark failed:', e);
    } finally {
        cleanupGitRepo();
    }
}

// Allow running directly
if (import.meta.main) {
    runGitProviderBenchmarks();
}
