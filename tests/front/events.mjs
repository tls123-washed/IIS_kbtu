import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAMPUS_PLAYWRIGHT || 'playwright');
const root = path.resolve(import.meta.dirname, '../..');
const python = process.env.CAMPUS_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const server = spawn(python, ['-X', 'utf8', 'tests/support_server.py', '--port', '8011', '--empty-events'], { cwd: root });
let serverLog = '';
server.stdout.on('data', data => { serverLog += data; });
server.stderr.on('data', data => { serverLog += data; });
const results = [];
let browser;
let fixture;
const output = path.join(root, 'tests/reports');
await mkdir(output, { recursive: true });
async function signedIn(page, index) {
  await page.context().addCookies([{ name: 'campus_session', value: fixture.users[index].session, url: fixture.origin }]);
  await page.goto(fixture.origin);
  await page.locator('#navigation').getByRole('button', { name: 'Мероприятия', exact: true }).click();
}
async function test(name, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const started = performance.now();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await run(page);
    assert.deepEqual(errors, []);
    results.push({ name, passed: true, milliseconds: Math.round(performance.now() - started) });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.error('FAIL', name, error.message);
  } finally { await context.close(); }
}
try {
  for (let attempt = 0; ; attempt++) {
    if (attempt === 100 || server.exitCode !== null) throw new Error('Event test server failed: ' + serverLog);
    try { if ((await fetch('http://127.0.0.1:8011/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  fixture = JSON.parse(await readFile(path.join(root, '.runtime/test-fixtures.json'), 'utf8'));
  assert.equal(fixture.event, null);
  browser = await chromium.launch(process.env.CAMPUS_BROWSER ? { executablePath: process.env.CAMPUS_BROWSER } : {});
  await test('Пустая афиша объясняет участнику, кто может публиковать мероприятия', async page => {
    await signedIn(page, 1);
    await page.getByText('Предстоящих мероприятий пока нет. Создавать мероприятия могут организаторы и модераторы сайта.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Создать мероприятие', exact: true }).count(), 0);
  });
  await test('Модератор создаёт первое событие из «Моих билетов», участник получает пропуск', async page => {
    await signedIn(page, 2);
    await page.getByText('Предстоящих мероприятий пока нет. Нажмите «Создать мероприятие», чтобы опубликовать первое.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Мои билеты', exact: true }).click();
    await page.getByText('У вас пока нет билетов.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Создать мероприятие', exact: true }).click();
    await page.locator('input[name=title]').fill('Первая встреча модератора');
    await page.locator('input[name=venue]').fill('КБТУ');
    await page.locator('input[name=starts_at]').fill(new Date(Date.now()+2*86400000).toISOString().slice(0,16));
    await page.locator('input[name=capacity]').fill('1');
    await page.getByRole('button', { name: 'Опубликовать мероприятие', exact: true }).click();
    await page.getByRole('heading', { name: 'Первая встреча модератора', exact: true }).waitFor();
    const context = await browser.newContext();
    try {
      const attendee = await context.newPage();
      await signedIn(attendee, 1);
      await attendee.locator('.event-card').filter({ hasText: 'Первая встреча модератора' })
        .getByRole('button', { name: 'Получить бесплатный пропуск', exact: true }).click();
      await attendee.locator('.ticket-number code').waitFor();
      assert.match(await attendee.locator('.ticket-number code').textContent(), /^[a-f0-9-]{36}$/);
    } finally { await context.close(); }
  });
} finally {
  if (browser) await browser.close();
  server.kill();
  await writeFile(path.join(output, 'events.json'), JSON.stringify({ testedAt: new Date().toISOString(), tests: results }, null, 2));
}
if (results.length !== 2 || results.some(result => !result.passed)) process.exitCode = 1;
