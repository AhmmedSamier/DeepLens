const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tseslint = require('@typescript-eslint/eslint-plugin');
const sonarjs = require('eslint-plugin-sonarjs');
const globals = require('globals');

module.exports = [
    js.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.node,
                ...globals.es2020,
                NodeJS: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
            sonarjs: sonarjs,
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            ...sonarjs.configs.recommended.rules,
            'sonarjs/os-command': 'off',
            'sonarjs/no-os-command-from-path': 'off',
            'no-throw-literal': 'warn',
            'no-undef': 'error',
        },
    },
    {
        ignores: ['out/**', 'dist/**', '**/*.d.ts', '.eslintcache', 'eslint.config.js'],
    },
];
