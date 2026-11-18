import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAMPUS_PLAYWRIGHT || 'playwright');
const root = path.resolve(import.meta.dirname, '../..');
const python = process.env.CAMPUS_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const server = spawn(python, ['-X', 'utf8', 'tests/support_server.py', '--port', '8001'], { cwd: root });
let log = '';
server.stdout.on('data', data => { log += data; });
server.stderr.on('data', data => { log += data; });
let browser;
let fixture;
const results = [];
const output = path.join(root, 'tests/reports');
await mkdir(output, { recursive: true });

async function test(name, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const started = performance.now();
  try {
    await run(page, context);
    results.push({ name, passed: true, milliseconds: Math.round(performance.now() - started) });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.error('FAIL', name, error.message);
  } finally { await context.close(); }
}
async function session(context) {
  await context.addCookies([{ name: 'campus_session', value: fixture.users[0].session, url: fixture.origin }]);
}
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null || attempt === 100) throw new Error('Test server did not start: ' + log);
    try { if ((await fetch('http://127.0.0.1:8001/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  fixture = JSON.parse(await readFile(path.join(root, '.runtime/test-fixtures.json'), 'utf8'));
  browser = await chromium.launch(process.env.CAMPUS_BROWSER ? { executablePath: process.env.CAMPUS_BROWSER } : {});
  await test('Гость видит вход без запросов настроек и сессии', async page => {
    let requests = 0;
    await page.route('**/api/auth/{options,me}', route => { requests++; return route.abort(); });
    await page.goto(fixture.origin);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).waitFor({ timeout: 3000 });
    assert.equal(requests, 0);
  });
  await test('Ошибка проверки сессии допускает повтор без потери cookie', async (page, context) => {
    await session(context);
    await page.route('**/api/auth/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"База временно недоступна"}' }));
    await page.goto(fixture.origin);
    await page.getByRole('alert').getByText('База временно недоступна').waitFor();
    assert.ok((await context.cookies()).some(cookie => cookie.name === 'campus_session'));
    await page.unroute('**/api/auth/me');
    await page.getByRole('button', { name: 'Повторить подключение', exact: true }).click();
    await page.locator('#navigation').getByRole('button', { name: 'Лента', exact: true }).waitFor();
  });
  await test('Зависший запрос сессии завершается сообщением и повтором', async (page, context) => {
    await session(context);
    await page.route('**/api/auth/me', () => {});
    await page.goto(fixture.origin);
    await page.getByRole('status').getByText('Проверяем сохранённый вход…').waitFor();
    await page.getByRole('alert').getByText('Сервер не ответил вовремя. Повторите подключение.').waitFor();
    await page.getByRole('button', { name: 'Повторить подключение', exact: true }).waitFor();
    assert.ok((await context.cookies()).some(cookie => cookie.name === 'campus_session'));
  });
  await test('Сбой загрузки JavaScript показывает независимую кнопку перезагрузки', async page => {
    await page.route('**/assets/app.js', route => route.abort());
    await page.goto(fixture.origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Загрузить заново', exact: true }).waitFor();
    await page.unroute('**/assets/app.js');
    await page.getByRole('button', { name: 'Загрузить заново', exact: true }).click();
    await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
  });
  await test('Зависшая загрузка JavaScript не оставляет бесконечный индикатор', async page => {
    await page.route('**/assets/app.js', () => {});
    await page.goto(fixture.origin, { waitUntil: 'commit' });
    await page.getByRole('button', { name: 'Загрузить заново', exact: true }).waitFor();
    await page.getByRole('alert').getByText('Не удалось загрузить приложение. Проверьте соединение и попробуйте ещё раз.').waitFor();
  });
} finally {
  if (browser) await browser.close();
  server.kill();
  await writeFile(path.join(output, 'startup.json'), JSON.stringify({ testedAt: new Date().toISOString(), tests: results }, null, 2));
}
if (results.length !== 5 || results.some(result => !result.passed)) process.exitCode = 1;
