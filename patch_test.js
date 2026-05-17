const fs = require('fs');
const filepath = 'vscode-extension/src/test/suite/reference-code-lens.test.ts';
let content = fs.readFileSync(filepath, 'utf8');

// Also fix the other test: "Provider should handle errors in symbol retrieval gracefully"
content = content.replace(
  /test\('Provider should handle errors in symbol retrieval gracefully', async \(\) => {[\s\S]*?assert.ok\(Array.isArray\(lenses\), 'Should return an array even on error'\);\n    }\);/,
  `test('Provider should handle errors in symbol retrieval gracefully', async () => {
        const token = new vscode.CancellationTokenSource().token;

        // Even with an invalid document, the provider should not throw
        const fakeDoc = { uri: vscode.Uri.parse('fake:test') } as vscode.TextDocument;
        const lenses = await provider.provideCodeLenses(fakeDoc, token);
        assert.ok(Array.isArray(lenses), 'Should return an array even on error');
    });`
);

fs.writeFileSync(filepath, content);
