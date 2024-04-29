const globals = require('globals');

const js = require('@eslint/js');
const stylisticJs = require('@stylistic/eslint-plugin-js');
const { FlatCompat } = require('@eslint/eslintrc');

module.exports = [
    js.configs.recommended,
    ...(new FlatCompat().extends('eslint-config-standard')),
    {
        languageOptions: {
            sourceType: 'commonjs',
            ecmaVersion: 'latest',
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            '@stylistic/js': stylisticJs,
        },
        rules: {
            'linebreak-style': ['error', 'windows'],
            'comma-dangle': ['error', 'always-multiline'],
            indent: ['error', 4],
            semi: ['error', 'always'],
            'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
            '@stylistic/js/indent': ['error', 4],
        },
    },
];
