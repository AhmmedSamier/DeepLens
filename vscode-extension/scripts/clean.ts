import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const distPath = path.join(__dirname, '..', 'dist');
const exeName = 'deeplens-lsp.exe';

console.log('Cleaning build artifacts...');

// 1. Kill the process if running (Windows only for now as requested)
try {
    console.log(`Attempting to kill ${exeName}...`);
    execSync(`taskkill /F /IM ${exeName}`, { stdio: 'ignore' });
    console.log(`${exeName} killed.`);
} catch (e) {
    // Ignore error if process not running
    console.log(`${exeName} was not running.`);
}

// 2. Clean dist folder
if (fs.existsSync(distPath)) {
    console.log(`Cleaning ${distPath}...`);
    try {
        fs.rmSync(distPath, { recursive: true, force: true });
        console.log('Dist folder cleaned.');
    } catch (e) {
        console.error(`Failed to clean dist folder: ${e}`);
        process.exit(1);
    }
}
