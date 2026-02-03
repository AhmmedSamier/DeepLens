const { spawn } = require('child_process');
const path = require('path');

const workspaceRoot = 'D:\\source-code\\enozom\\dayoff-dotnet';

console.log('=== Testing actual Git output ===');
console.log('Workspace root:', workspaceRoot);
console.log('Platform:', process.platform);
console.log('');

function execGit(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Git exited with code ${code}: ${stderr}`));
            }
        });
    });
}

async function testGit() {
    try {
        console.log('Running: git diff --name-only');
        const modifiedOutput = await execGit(['diff', '--name-only'], workspaceRoot);
        console.log('Output length:', modifiedOutput.length);
        console.log('Output:');
        console.log(modifiedOutput);
        console.log('');

        if (modifiedOutput.trim()) {
            const lines = modifiedOutput.split('\n');
            console.log('First line:', lines[0]);
            console.log('First line JSON:', JSON.stringify(lines[0]));
            console.log('');

            // Test normalization
            const normalized = path.normalize(path.join(workspaceRoot, lines[0]));
            console.log('After path.join:', path.join(workspaceRoot, lines[0]));
            console.log('After normalize:', normalized);
            console.log('');

            // Check if it needs conversion
            const match = normalized.match(/^[/\\]([a-z])[/\\](.+)$/i);
            if (match) {
                const drive = match[1].toUpperCase();
                const restPath = match[2].replace(/\//g, '\\');
                const converted = `${drive}:\\${restPath}`;
                console.log('Needs conversion:', true);
                console.log('Converted:', converted);
            } else {
                console.log('Needs conversion:', false);
            }
        } else {
            console.log('No modified files');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testGit();
