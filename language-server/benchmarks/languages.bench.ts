import * as path from 'node:path';
import * as fs from 'node:fs';
import { TreeSitterParser } from '../src/core/tree-sitter-parser';
import { benchmark } from './utils';

export async function runLanguageBenchmarks() {
    console.log("=== Language Parser Benchmarks ===");

    const extensionPath = path.resolve(__dirname, '..');
    const parser = new TreeSitterParser(extensionPath);
    await parser.init();

    const languages = [
        { id: 'typescript', ext: 'ts', content: 'export class Test { method() { console.log("hi"); } }' },
        { id: 'python', ext: 'py', content: 'class Test:\n    def method(self):\n        print("hi")' },
        { id: 'csharp', ext: 'cs', content: 'public class Test { public void Method() { Console.WriteLine("hi"); } }' },
        { id: 'go', ext: 'go', content: 'package main\nfunc main() { fmt.Println("hi") }' },
        { id: 'java', ext: 'java', content: 'public class Test { public void method() { System.out.println("hi"); } }' },
        { id: 'php', ext: 'php', content: '<?php class Test { public function method() { echo "hi"; } }' },
        { id: 'ruby', ext: 'rb', content: 'class Test\n  def method\n    puts "hi"\n  end\nend' },
        { id: 'cpp', ext: 'cpp', content: 'class Test { public: void method() { std::cout << "hi"; } };' },
        { id: 'c', ext: 'c', content: 'void method() { printf("hi"); }' }
    ];

    for (const lang of languages) {
        const tempFile = path.join(__dirname, `temp_bench.${lang.ext}`);
        // Create a larger version of the content
        let largeContent = '';
        for (let i = 0; i < 100; i++) {
            largeContent += lang.content.replace(/Test/g, `Test${i}`).replace(/method/g, `method${i}`) + "\n";
        }
        fs.writeFileSync(tempFile, largeContent);

        try {
            await benchmark(`Parse ${lang.id} (100 classes/methods)`, async () => {
                await parser.parseFile(tempFile);
            }, 20);
        } catch (e) {
            console.error(`Failed to benchmark ${lang.id}:`, e);
        } finally {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }
    }

    console.log("\n");
}

if (require.main === module) {
    runLanguageBenchmarks();
}
