import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

/**
 * Copy WASM files from node_modules to dist/parsers
 */
async function copyWasmFiles() {
    const distDir = path.resolve(__dirname, '../dist');
    const parsersDir = path.join(distDir, 'parsers');

    if (!fs.existsSync(parsersDir)) {
        fs.mkdirSync(parsersDir, { recursive: true });
    }

    console.log(`Setting up WASM files in ${parsersDir}...`);

    try {
        // 1. Copy web-tree-sitter.wasm
        // In bun/node, require.resolve might find it.
        // We can try to locate it relative to node_modules if require.resolve fails or behaves differently in bun for binary files.
        const webTreeSitterWasm = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
        fs.copyFileSync(webTreeSitterWasm, path.join(parsersDir, 'web-tree-sitter.wasm'));
        console.log(`Copied web-tree-sitter.wasm`);
    } catch (e) {
        console.error("Failed to copy web-tree-sitter.wasm", e);
    }

    // 2. Find and copy language parsers
    const languageMap = {
        'tree-sitter-typescript': ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm'],
        'tree-sitter-javascript': ['tree-sitter-javascript.wasm'],
        'tree-sitter-c-sharp': ['tree-sitter-c_sharp.wasm'],
        'tree-sitter-python': ['tree-sitter-python.wasm'],
        'tree-sitter-java': ['tree-sitter-java.wasm'],
        'tree-sitter-go': ['tree-sitter-go.wasm'],
        'tree-sitter-cpp': ['tree-sitter-cpp.wasm'],
        'tree-sitter-c': ['tree-sitter-c.wasm'],
        'tree-sitter-ruby': ['tree-sitter-ruby.wasm'],
        'tree-sitter-php': ['tree-sitter-php.wasm', 'tree-sitter-php_only.wasm'],
    };

    for (const [pkg, files] of Object.entries(languageMap)) {
        try {
            // Find package root
            const pkgJsonPath = require.resolve(`${pkg}/package.json`);
            const pkgRoot = path.dirname(pkgJsonPath);

            // Search only within specific subdirectories to avoid scanning the entire package
            // or use specific known paths where possible
            for (const file of files) {
                // Try direct path first (common case)
                let srcPath = path.join(pkgRoot, file);

                if (!fs.existsSync(srcPath)) {
                    // Search recursively if not found at root
                    const matches = await glob(`**/${file}`, { cwd: pkgRoot, absolute: true });
                    if (matches.length > 0) {
                        srcPath = matches[0];
                    }
                }

                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, path.join(parsersDir, file));
                    console.log(`Copied ${file}`);
                } else {
                    console.warn(`Could not find ${file} in ${pkg}`);
                }
            }

        } catch (e) {
            console.warn(`Could not resolve ${pkg}:`, e);
        }
    }
}

copyWasmFiles().catch(console.error);
