import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'https';
import { execSync } from 'child_process';
// @ts-ignore
import { rgPath } from '@vscode/ripgrep';

const distDir = path.join(__dirname, '../dist/bin');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// 1. Copy local binary (Windows/Current Platform)
const destPath = path.join(distDir, path.basename(rgPath));
console.log(`Copying local ripgrep binary from ${rgPath} to ${destPath}`);
fs.copyFileSync(rgPath, destPath);

// 2. Download Linux Binary (for Ubuntu support in single VSIX)
const RG_VERSION = "15.0.0";
const linuxBinName = "rg-linux-x64";
const linuxDestPath = path.join(distDir, linuxBinName);
const linuxUrl = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz`;

// Run download
downloadBinaries().catch(e => console.error(e));

async function downloadBinaries() {
   await downloadBinary("Linux x64", "rg-linux-x64", `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz`, `ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl/rg`);
   await downloadBinary("macOS x64", "rg-darwin-x64", `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-apple-darwin.tar.gz`, `ripgrep-${RG_VERSION}-x86_64-apple-darwin/rg`);
   await downloadBinary("macOS ARM64", "rg-darwin-arm64", `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-apple-darwin.tar.gz`, `ripgrep-${RG_VERSION}-aarch64-apple-darwin/rg`);
}

async function downloadBinary(label: string, binName: string, url: string, extractPath: string) {
    const destPath = path.join(distDir, binName);
    if (fs.existsSync(destPath)) {
        console.log(`${label} binary already exists, skipping download.`);
        return;
    }

    console.log(`Downloading ${label} binary from ${url}...`);
    const tempTgz = path.join(distDir, `${binName}.tar.gz`);
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }
        await Bun.write(tempTgz, response);

        console.log(`Extracting ${label} binary...`);
        // Extract specific file from tarball to stdout and write to file
        const tarCmd = `tar -xOzf "${tempTgz}" "${extractPath}" > "${destPath}"`;
        execSync(tarCmd, { cwd: distDir });
        
        console.log(`${label} binary extracted to ${destPath}`);
        
        // chmod if we are on linux/mac
        if (process.platform !== 'win32') {
             fs.chmodSync(destPath, 0o755);
        }
    } catch (e) {
        console.error(`Failed to setup ${label} binary.`, e);
    } finally {
         if (fs.existsSync(tempTgz)) fs.unlinkSync(tempTgz);
    }
}

// Make executable
if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755);
}
// chmod for linux binary if we are on linux (not needed on windows build host, but good practice)
if (process.platform !== 'win32' && fs.existsSync(linuxDestPath)) {
   fs.chmodSync(linuxDestPath, 0o755);
}

console.log('Ripgrep setup complete.');
