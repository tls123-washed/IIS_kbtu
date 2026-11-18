import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAMPUS_PLAYWRIGHT || 'playwright');
const root = path.resolve(import.meta.dirname, '../..');
const python = process.env.CAMPUS_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const server = spawn(python, ['-X', 'utf8', 'tests/support_server.py', '--port', '8001'], { cwd: root });
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', data => { serverOutput += data; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
let browser;
let fixtures;
const output = path.join(root, 'tests/reports');
await mkdir(output, { recursive: true });

async function test(name, run) {
  const started = performance.now();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await run(page, context);
    assert.deepEqual(errors, []);
    report.push({ name, passed: true, milliseconds: Math.round(performance.now() - started) });
    console.log('PASS', report.length, name);
  } catch (error) {
    report.push({ name, passed: false, error: error.message, milliseconds: Math.round(performance.now() - started) });
    await page.screenshot({ path: path.join(output, `failed-${report.length}.png`), fullPage: true });
    console.error('FAIL', report.length, name, error.message);
  } finally {
    await context.close();
  }
}
async function signedIn(page, index = 0) {
  await page.context().addCookies([{ name: 'campus_session', value: fixtures.users[index].session, url: fixtures.origin }]);
  await page.goto(fixtures.origin);
  await page.locator('#navigation').getByRole('button', { name: 'Лента', exact: true }).waitFor();
}
const nav = (page, label) => page.locator('#navigation').getByRole('button', { name: label, exact: true }).click();
async function publish(page, content, anonymous = false) {
  await nav(page, 'Новый тред');
  await page.locator('textarea[name=content]').fill(content);
  if (anonymous) await page.locator('input[name=anon]').check({ force: true });
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await page.locator('[data-live=thread] .post-text').getByText(content, { exact: true }).waitFor();
}
async function login(page) {
  await page.goto(fixtures.origin);
  await page.locator('input[name=username]').fill('front_0');
  await page.locator('input[name=password]').fill(fixtures.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.locator('#navigation').getByRole('button', { name: 'Лента', exact: true }).waitFor();
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try {
      if ((await fetch('http://127.0.0.1:8001/api/health')).ok) break;
    } catch {}
    if (attempt === 99) throw new Error('Test server did not become ready. ' + serverOutput);
    await delay(300);
  }
  fixtures = JSON.parse(await readFile(path.join(root, '.runtime/test-fixtures.json'), 'utf8'));
  browser = await chromium.launch(process.env.CAMPUS_BROWSER ? { executablePath: process.env.CAMPUS_BROWSER } : {});

  await test('01 · Сайт открывается без общего пароля', async page => {
    const response = await page.goto(fixtures.origin);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['www-authenticate'], undefined);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).waitFor();
  });
  await test('02 · Вход по имени пользователя и паролю', login);
  await test('03 · Сессия сохраняется после обновления страницы', async page => {
    await signedIn(page);
    await page.reload();
    await page.locator('#sidebarAccount').getByText('@front_0', { exact: true }).waitFor();
  });
  await test('04 · Выход закрывает сессию', async page => {
    await login(page);
    await nav(page, 'Профиль');
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    assert.equal((await page.request.get(fixtures.origin + '/api/auth/me')).status(), 401);
  });
  await test('05 · Регистрация с адресом КБТУ', async page => {
    await page.goto(fixtures.origin);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    for (const [name, value] of Object.entries({ email: 'front_new@kbtu.kz', username: 'front_new', first: 'Тест', last: 'Студент', password: fixtures.password })) {
      await page.locator(`input[name="${name}"]`).fill(value);
    }
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.locator('#sidebarAccount').getByText('@front_new', { exact: true }).waitFor();
  });
  await test('06 · Другой почтовый домен отклоняется', async page => {
    await page.goto(fixtures.origin);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    for (const [name, value] of Object.entries({ email: 'front_bad@example.com', username: 'front_bad', first: 'Тест', last: 'Студент', password: fixtures.password })) {
      await page.locator(`input[name="${name}"]`).fill(value);
    }
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.getByRole('alert').getByText('Введите корпоративную почту с окончанием @kbtu.kz.').waitFor();
  });
  await test('07 · Тёмная тема переключается и сохраняется', async page => {
    await signedIn(page);
    await page.getByRole('button', { name: 'Тёмная тема' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.reload();
    await page.getByRole('button', { name: 'Светлая тема' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.screenshot({ path: path.join(output, 'desktop-dark.png') });
  });
  await test('08 · Десктоп использует боковую навигацию и широкую ленту', async page => {
    await signedIn(page);
    assert.ok((await page.locator('#phone').boundingBox()).width > 500);
    assert.ok((await page.locator('#navigation').boundingBox()).x < (await page.locator('#phone').boundingBox()).x);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'desktop-light.png') });
  });
  await test('09 · Мобильный экран помещается в 390 пикселей', async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#navigation').evaluate(el => getComputedStyle(el).position), 'fixed');
  });
  await test('10 · Нажатие анимируется, reduced motion учитывается', async page => {
    await page.goto(fixtures.origin);
    const toggle = page.locator('#themeToggle');
    const bounds = await toggle.boundingBox();
    await page.mouse.move(bounds.x + 10, bounds.y + 10);
    await page.mouse.down();
    await delay(70);
    assert.notEqual(await toggle.evaluate(el => getComputedStyle(el).transform), 'none');
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(parseFloat(await toggle.evaluate(el => getComputedStyle(el).transitionDuration)) < .01);
  });
  await test('11 · Публикация нового треда', async page => {
    await signedIn(page);
    await publish(page, 'Новый тред из UI');
  });
  await test('12 · Лайк добавляется и убирается', async page => {
    await signedIn(page);
    await publish(page, 'Тред для лайка');
    const button = page.locator('[data-live=thread] .like');
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-live=thread] .like').dataset.liked === 'true');
    assert.equal(await button.locator('span').textContent(), '1');
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-live=thread] .like').dataset.liked === 'false');
    assert.equal(await button.locator('span').textContent(), '0');
  });
  await test('13 · Ответ сохраняется в треде', async page => {
    await signedIn(page);
    await publish(page, 'Обсуждаем архитектуру');
    await page.locator('.reply-box input').fill('Ответ из интерфейса');
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    await page.locator('[data-live=replies]').getByText('Ответ из интерфейса', { exact: true }).waitFor();
  });
  await test('14 · Анонимная публикация скрывает автора', async page => {
    await signedIn(page);
    await publish(page, 'Анонимный вопрос', true);
    await page.locator('[data-live=thread]').getByRole('button', { name: 'Аноним', exact: true }).waitFor();
    assert.equal(await page.locator('[data-live=thread] .handle').count(), 0);
  });
  await test('15 · Удаление своей публикации', async page => {
    await signedIn(page);
    await publish(page, 'Временная публикация');
    const id = await page.locator('[data-live=thread] .mini-del').getAttribute('data-id');
    page.once('dialog', dialog => dialog.accept());
    const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith('/posts/' + id));
    await page.getByRole('button', { name: 'Удалить пост', exact: true }).click();
    assert.equal((await deleted).status(), 204);
    assert.equal((await page.request.get(fixtures.origin + '/api/posts/' + id)).status(), 404);
  });
  await test('16 · Поиск из десктопной шапки', async page => {
    await signedIn(page);
    await page.getByRole('textbox', { name: 'Поиск по кампусу' }).fill('Обсуждение проекта');
    await page.getByRole('button', { name: 'Искать', exact: true }).click();
    await page.locator('[data-live=search] .post').first().waitFor();
  });
  await test('17 · Создание сообщества и вступление', async page => {
    await signedIn(page);
    await nav(page, 'Сообщества');
    await page.getByRole('button', { name: 'Создать сообщество', exact: true }).click();
    await page.locator('input[name=name]').fill('Клуб UI тестов');
    await page.getByRole('button', { name: 'Создать сообщество', exact: true }).click();
    await page.getByRole('heading', { name: 'Клуб UI тестов', exact: true }).waitFor();
    await page.locator('.comm-head').getByRole('button', { name: 'Вы участник', exact: true }).waitFor();
  });
  await test('18 · Организатор публикует мероприятие', async page => {
    await signedIn(page);
    await nav(page, 'Мероприятия');
    await page.getByRole('button', { name: 'Создать мероприятие', exact: true }).click();
    await page.locator('input[name=title]').fill('Тестовое событие');
    await page.locator('input[name=venue]').fill('КБТУ');
    await page.locator('input[name=starts_at]').fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    await page.locator('input[name=capacity]').fill('10');
    await page.getByRole('button', { name: 'Опубликовать мероприятие', exact: true }).click();
    await page.getByRole('heading', { name: 'Тестовое событие', exact: true }).waitFor();
  });
  await test('19 · Получение бесплатного пропуска', async page => {
    await signedIn(page, 1);
    await nav(page, 'Мероприятия');
    const event = page.locator('.event-card').filter({ hasText: 'Встреча разработчиков' });
    await event.getByRole('button', { name: 'Получить бесплатный пропуск', exact: true }).click();
    await page.locator('.ticket-number code').waitFor();
    assert.match(await page.locator('.ticket-number code').first().textContent(), /^[a-f0-9-]{36}$/);
  });
  await test('20 · Страницы ленты переходят без дублей', async page => {
    await signedIn(page);
    const firstIds = await page.locator('[data-live=feed] .like').evaluateAll(els => els.map(el => el.dataset.id));
    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await page.getByText('Страница 2', { exact: true }).waitFor();
    const secondIds = await page.locator('[data-live=feed] .like').evaluateAll(els => els.map(el => el.dataset.id));
    assert.equal(secondIds.some(id => firstIds.includes(id)), false);
  });
} finally {
  if (browser) await browser.close();
  server.kill();
  await writeFile(path.join(output, 'front.json'), JSON.stringify({ testedAt: new Date().toISOString(), tests: report }, null, 2));
}
if (report.length !== 20 || report.some(result => !result.passed)) process.exitCode = 1;
