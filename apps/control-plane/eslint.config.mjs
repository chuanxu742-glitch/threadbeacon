import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist-web/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
);
