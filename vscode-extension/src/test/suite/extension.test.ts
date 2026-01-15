import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('AhmedSamir.deeplens'));
	});

	test('Commands should be registered', async () => {
        // We can check if the command exists in the list of commands
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('deeplens.search'), 'deeplens.search command should be registered');
        assert.ok(commands.includes('deeplens.rebuildIndex'), 'deeplens.rebuildIndex command should be registered');
	});
});
