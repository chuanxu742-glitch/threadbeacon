import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const controlPlane = join(root, 'apps', 'control-plane');
const app = join(controlPlane, 'app');

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

describe('v2 control-plane architecture', () => {
  it('retires the Studio god component and keeps bootstrap small', () => {
    expect(existsSync(join(app, 'components', 'platform-client.tsx'))).toBe(false);
    expect(filesBelow(join(app, 'components', 'studio'))).toEqual([]);

    const main = readFileSync(join(controlPlane, 'web', 'main.tsx'), 'utf8');
    expect(main.split(/\r?\n/).length).toBeLessThan(150);
    expect(main).toContain('<AppRouter');
  });

  it('prevents new UI features from depending on the legacy Studio API or hash tabs', () => {
    const governed = [join(app, 'features'), join(app, 'shell'), join(app, 'routes')]
      .flatMap(filesBelow)
      .filter(path => /\.(ts|tsx)$/.test(path));

    const violations = governed.flatMap(path => {
      const source = readFileSync(path, 'utf8');
      const reasons = [
        source.includes('/api/studio') ? 'legacy Studio API' : '',
        source.includes('location.hash =') ? 'hash navigation' : '',
        source.includes('platform-client') ? 'retired god component' : '',
      ].filter(Boolean);
      return reasons.map(reason => `${relative(root, path)}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });

  it('centralizes the v2 transport and freezes the stable route set', () => {
    const client = readFileSync(join(app, 'api', 'v2.ts'), 'utf8');
    expect(client).toContain('fetch(`/api/v2${path}`');

    const router = readFileSync(join(app, 'routes', 'router.tsx'), 'utf8');
    for (const route of [
      '/today', '/projects', '/projects/new', '/projects/:projectId',
      '/projects/:projectId/orchestration', '/projects/:projectId/operations',
      '/projects/:projectId/data', '/projects/:projectId/delivery',
      '/projects/:projectId/settings', '/reports', '/reports/:reportId',
      '/automation', '/setup', '/settings/workspace', '/settings/members',
      '/settings/connections', '/settings/execution', '/settings/developer', '/settings/audit',
    ]) expect(router).toContain(`'${route}'`);
  });
});
