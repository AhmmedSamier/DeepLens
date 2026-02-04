const path = require('path');

console.log('=== Debug Path Normalization ===');
console.log('Platform:', process.platform);
console.log('');

// Simulate what Git Bash returns
const gitBashPath = '/d/source-code/enozom/dayoff-dotnet/Code/admin/src/app/pages/customers/customers-list/customers-list.component.ts';
console.log('Git Bash path:', gitBashPath);

// Simulate what VS Code provides as workspace root
const vscodeRoot = 'D:\\source-code\\enozom\\dayoff-dotnet';
console.log('VSCode workspace root:', vscodeRoot);

// What the indexer would have stored
const indexedPath = path.normalize(vscodeRoot + '\\Code\\admin\\src\\app\\pages\\customers\\customers-list\\customers-list.component.ts');
console.log('Indexed file path:', indexedPath);
console.log('');

// Test normalizeGitPath logic
function normalizeGitPath(root, relativePath) {
    const joinedPath = path.join(root, relativePath);
    const normalized = path.normalize(joinedPath);

    if (process.platform === 'win32') {
        return convertWindowsPath(normalized);
    }

    return normalized;
}

function convertWindowsPath(filePath) {
    const match = filePath.match(/^[/\\]([a-z])[/\\](.+)$/i);
    if (match) {
        const drive = match[1].toUpperCase();
        const restPath = match[2].replace(/\//g, '\\');
        return `${drive}:\\${restPath}`;
    }
    return path.normalize(filePath);
}

// Extract relative path from git bash path
const relativePath = gitBashPath.split('/').slice(4).join('/');
console.log('Extracted relative path from git:', relativePath);

const normalizedGitPath = normalizeGitPath(vscodeRoot, relativePath);
console.log('Normalized git path:', normalizedGitPath);
console.log('');

console.log('Do they match?', normalizedGitPath === indexedPath);
console.log('Normalized Git Path:', JSON.stringify(normalizedGitPath));
console.log('Indexed Path:     ', JSON.stringify(indexedPath));
console.log('');

// Test what path.join produces with Unix-style root
const unixRoot = '/d/source-code/enozom/dayoff-dotnet';
const joined1 = path.join(unixRoot, relativePath);
console.log('path.join(unixRoot, relative):', joined1);
console.log('After normalize:', path.normalize(joined1));
console.log('After convertWindowsPath:', convertWindowsPath(path.normalize(joined1)));

// Test the actual case: git returns relative path
const gitRelativePath = 'Code/admin/src/app/pages/customers/customers-list/customers-list.component.ts';
const joined2 = path.join(vscodeRoot, gitRelativePath);
console.log('');
console.log('=== Actual Scenario ===');
console.log('Git relative path:', gitRelativePath);
console.log('path.join(vscodeRoot, gitRelative):', joined2);
console.log('After normalize:', path.normalize(joined2));
const finalPath = normalizeGitPath(vscodeRoot, gitRelativePath);
console.log('After full normalizeGitPath:', finalPath);
console.log('Match indexed?', finalPath === indexedPath);
