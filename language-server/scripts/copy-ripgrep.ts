import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
import { rgPath } from '@vscode/ripgrep';

const distDir = path.join(__dirname, '../dist/bin');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const destPath = path.join(distDir, path.basename(rgPath));

console.log(`Copying ripgrep binary from ${rgPath} to ${destPath}`);
fs.copyFileSync(rgPath, destPath);

// Make executable
if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755);
}

console.log('Ripgrep copied successfully.');
