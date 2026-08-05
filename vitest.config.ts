import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // reference/ 是上游只读参考，不参与构建与测试
    exclude: ['node_modules', 'reference'],
    environment: 'node',
  },
});
