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
                project: './tsconfig.json',
                tsconfigRootDir: __dirname,
            },
            globals: {
                ...globals.node,
                ...globals.es2020,
                ...globals.mocha,
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
            // Enable all sonarjs rules
            ...Object.keys(sonarjs.rules).reduce((acc, rule) => {
                acc[`sonarjs/${rule}`] = 'error';
                return acc;
            }, {}),
            'sonarjs/os-command': 'off',
            'sonarjs/no-os-command-from-path': 'off',
            'sonarjs/file-header': 'off',
            'sonarjs/no-implicit-dependencies': 'off',
            'sonarjs/declarations-in-global-scope': 'off',
            'sonarjs/max-lines': 'off',
            'sonarjs/max-lines-per-function': 'off',
            'sonarjs/cyclomatic-complexity': 'off',
            'sonarjs/nested-control-flow': 'off',
            'sonarjs/no-small-switch': 'off',
            'sonarjs/elseif-without-else': 'off',
            'sonarjs/too-many-break-or-continue-in-loop': 'off',
            'sonarjs/expression-complexity': 'off',
            'sonarjs/regular-expr': 'off',
            'sonarjs/no-inconsistent-returns': 'off',
            'sonarjs/no-wildcard-import': 'off',
            'sonarjs/arrow-function-convention': 'off',
            'sonarjs/no-duplicate-string': 'off',
            'sonarjs/for-in': 'off',
            'sonarjs/shorthand-property-grouping': 'off',
            'sonarjs/no-unused-function-argument': 'off',
            'sonarjs/no-collapsible-if': 'off',
            'sonarjs/destructuring-assignment-syntax': 'off',
            'sonarjs/no-nested-incdec': 'off',
            'sonarjs/prefer-object-literal': 'off',
            'sonarjs/no-identical-functions': 'off',
            'no-throw-literal': 'warn',
            'no-undef': 'error',
        },
    },
    {
        ignores: ['out/**', 'dist/**', '**/*.d.ts', '.eslintcache', 'eslint.config.js'],
    },
];
