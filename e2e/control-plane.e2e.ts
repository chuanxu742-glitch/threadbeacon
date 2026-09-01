import { expect, test, type Page } from '@playwright/test';

const username = process.env['E2E_USERNAME'] ?? 'threadbeacon';
const password = process.env['E2E_PASSWORD'] ?? 'release-drill-password-2026';

async function login(page: Page, suppliedPassword = password) {
  await page.goto('/');
  await page.getByLabel('用户名').fill(username);
  await page.locator('input[name="password"]').fill(suppliedPassword);
  await page.getByRole('button', { name: /登录/ }).click();
}

test('拒绝错误凭据且不进入工作区', async ({ page }) => {
  await login(page, 'definitely-wrong-password');
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  await expect(page.getByLabel('用户名')).toBeVisible();
});

test('关键研究闭环与只读社媒域可在浏览器完成', async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = Date.now().toString(36);
  const projectName = `Release Drill ${suffix}`;
  const sourceName = `Official Site ${suffix}`;
  const workflowName = `Evidence Loop ${suffix}`;
  const monitorName = `Public Signal ${suffix}`;

  await login(page);
  await expect(page.getByRole('heading', { name: '今天要处理什么？' })).toBeVisible();
  await expect(page.getByText('控制面已连接')).toBeVisible();

  await page.goto('/projects/new');
  await page.getByLabel('项目名称').fill(projectName);
  await page.getByLabel('研究目标').fill('验证来源、不可变流程、运行与只读社媒监控的完整发布链路。');
  await page.getByRole('button', { name: /创建并进入项目/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/').at(-1)!;

  await page.goto(`/projects/${projectId}/settings`);
  await page.getByLabel('名称').fill(sourceName);
  await page.getByLabel('类型').fill('web');
  await page.getByLabel('目标').fill('https://example.com/');
  await page.getByRole('button', { name: '保存来源' }).click();
  const sourceCard = page.locator('.tb-source-list article').filter({ hasText: sourceName });
  await expect(sourceCard.getByText(sourceName, { exact: true })).toBeVisible();
  await sourceCard.getByRole('button', { name: '探测来源' }).click();
  await expect.poll(async () => {
    await page.reload();
    return sourceCard.locator('.tb-status').textContent();
  }, { intervals: [1_000, 2_000, 3_000], timeout: 60_000 }).toBe('active');

  await page.goto(`/projects/${projectId}/orchestration`);
  await page.getByPlaceholder('新流程名称').fill(workflowName);
  await page.getByPlaceholder('一句话说明（可选）').fill('发布演练的最小证据流程');
  await page.getByRole('button', { name: '创建草稿' }).click();
  await expect(page.getByText(workflowName).first()).toBeVisible();
  await page.getByRole('button', { name: '校验草稿' }).click();
  await expect(page.getByText('查看最近校验/发布响应')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '发布版本' }).click();
  await expect(page.getByRole('button', { name: '运行此版本' })).toBeVisible();
  await page.getByRole('button', { name: '运行此版本' }).click();

  await page.goto(`/projects/${projectId}/operations`);
  await expect(page.getByRole('heading', { name: '运行', exact: true })).toBeVisible();
  const runCard = page.locator('.tb-run-list button').first();
  await expect(runCard).toBeVisible();
  await expect(runCard.locator('.tb-status')).not.toHaveText('unknown');

  await page.goto(`/projects/${projectId}/social`);
  await expect(page.getByRole('heading', { name: '社媒态势', exact: true })).toBeVisible();
  const monitorForm = page.locator('.tb-social-monitor-form');
  await monitorForm.getByLabel('名称').fill(monitorName);
  await monitorForm.getByLabel('平台').selectOption('bluesky');
  await monitorForm.getByLabel('关键词 / 主题').fill('open source research intelligence');
  await monitorForm.getByRole('button', { name: '创建监控', exact: true }).click();
  const monitorCard = page.locator('.tb-social-monitor-list article').filter({ hasText: monitorName });
  await expect(monitorCard.getByText(monitorName, { exact: true })).toBeVisible();
  await monitorCard.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(monitorCard.getByRole('button', { name: '启用', exact: true })).toBeVisible();

  for (const [path, title] of [
    ['streams', '监听流'],
    ['accounts', '账号投影与来源连接'],
    ['content', '内容'],
    ['insights', '趋势与洞察'],
    ['alerts', '告警'],
  ] as const) {
    await page.goto(`/projects/${projectId}/social/${path}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('.tb-social-readonly')).toBeVisible();
  }

  const forbiddenWrite = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v2/projects/${encodeURIComponent(id)}/social/posts`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    return response.status;
  }, projectId);
  expect([404, 405]).toContain(forbiddenWrite);

  for (const [path, title] of [
    ['/today', '今天要处理什么？'], ['/projects', '项目'], ['/social', '社媒态势'],
    ['/reports', '报告'], ['/automation', '自动化'], ['/setup', '设置中心'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }

  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByLabel('用户名')).toBeVisible();
});
