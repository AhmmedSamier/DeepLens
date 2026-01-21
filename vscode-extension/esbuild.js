const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

/**
 * Copy WASM files from node_modules to dist/parsers
 */
function copyWasmFiles() {
    const parsersDir = path.join(__dirname, 'dist', 'parsers');
    if (!fs.existsSync(parsersDir)) {
        fs.mkdirSync(parsersDir, { recursive: true });
    }

    // 1. Copy web-tree-sitter.wasm
    const webTreeSitterWasm = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
    fs.copyFileSync(webTreeSitterWasm, path.join(parsersDir, 'web-tree-sitter.wasm'));
    console.log(`Copied web-tree-sitter.wasm`);

    // 1.1 Copy sqlite3.wasm
    // We need to resolve where @sqlite.org/sqlite-wasm is located in language-server's node_modules
    // Since we are in vscode-extension, we need to look up relative to repo root or similar.
    // However, esbuild bundles the JS, so the JS will look for sqlite3.wasm relative to itself or similar.
    // The @sqlite.org/sqlite-wasm package usually has the wasm file next to the main entry point.
    try {
        const sqliteWasmPath = require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm', { paths: [path.join(__dirname, '../language-server')] });
        fs.copyFileSync(sqliteWasmPath, path.join(__dirname, 'dist', 'sqlite3.wasm'));
        console.log(`Copied sqlite3.wasm`);
    } catch (e) {
        // Fallback or error if not found
        console.warn('Could not find sqlite3.wasm in language-server dependencies');

        // Try manual path if resolution fails
        const manualPath = path.join(__dirname, '../language-server/node_modules/@sqlite.org/sqlite-wasm/sqlite3.wasm');
        if (fs.existsSync(manualPath)) {
            fs.copyFileSync(manualPath, path.join(__dirname, 'dist', 'sqlite3.wasm'));
            console.log(`Copied sqlite3.wasm (manual path)`);
        } else {
             console.error('Failed to copy sqlite3.wasm');
        }
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
            files.forEach(file => {
                // Try direct path first (common case)
                let srcPath = path.join(pkgRoot, file);

                if (!fs.existsSync(srcPath)) {
                    // Search recursively if not found at root
                    const matches = glob.sync(`**/${file}`, { cwd: pkgRoot, absolute: true });
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
            });

        } catch (e) {
            console.warn(`Could not resolve ${pkg}:`, e.message);
        }
    }
}

async function main() {
    copyWasmFiles();

    const ctx = await esbuild.context({
        entryPoints: {
            extension: 'src/extension.ts',
            server: '../language-server/src/server.ts'
        },
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outdir: 'dist',
        external: ['vscode'], // Exclude vscode API to preserve its internal logic
        logLevel: 'silent',
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    });

    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
