module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        ecmaFeatures: {
            jsx: false,
        },
    },
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    env: {
        node: true,
        es2020: true,
    },
    ignorePatterns: ['dist/', '.bun/', 'node_modules/'],
    rules: {
        // Allow explicit any type
        '@typescript-eslint/no-explicit-any': 'off',
        // Allow unused variables if prefixed with underscore
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        // Allow console.log for debugging
        'no-console': 'off',
    },
};
