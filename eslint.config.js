import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default ts.config(
  { ignores: ['dist', '.vercel'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: globals.node }, rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser }, plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules } },
);
