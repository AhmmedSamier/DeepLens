import * as path from 'path';
import * as fs from 'fs';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { benchmark } from './utils';

export async function runParserBenchmarks() {
    console.log("=== Parser Benchmarks ===");

    // Use the language-server root as extensionPath so it finds dist/parsers
    const extensionPath = path.resolve(__dirname, '..');
    const parser = new TreeSitterParser(extensionPath);

    await parser.init();

    // Create a temporary large TypeScript file
    const tempFile = path.join(__dirname, 'temp_bench.ts');
    let content = `
    export class BenchmarkClass {
        private counter: number = 0;
    `;

    for(let i=0; i<500; i++) {
        content += `
        public method${i}(arg: string): void {
            console.log("Method ${i}");
            this.counter++;
        }
        `;
    }
    content += `}`;

    fs.writeFileSync(tempFile, content);

    try {
        await benchmark("Parse 500-method TS Class", async () => {
            await parser.parseFile(tempFile);
        }, 10);
    } finally {
        fs.unlinkSync(tempFile);
    }

    console.log("\n");
}
