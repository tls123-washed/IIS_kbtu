// Автотест учебного демо: запусти `npm run demo`, затем `npm run test:demo`.
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8080/';
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push(e.message));
const step = async (name, fn) => { await fn(); console.log('✓', name); };

await step('PostgreSQL загрузился', async () => {
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.quick-u', { timeout: 90000 });
});
await step('вход как первый тестовый пользователь', async () => {
  await p.click('.quick-u >> nth=0'); await p.waitForSelector('.tabbar');
});
await step('лайк', async () => { await p.click('.act.like >> nth=0'); await p.waitForTimeout(500); });
await step('ответ в треде', async () => {
  await p.click('.act[data-act=thread] >> nth=1');
  await p.fill('.reply-box input', 'Автотест #бд'); await p.click('.reply-box button');
  await p.waitForSelector('text=Автотест');
});
await step('проверки ограничений', async () => {
  await p.click('.db-tabs [data-tab=checks]'); await p.click('[data-dbact=checkall]'); await p.waitForTimeout(3000);
});
await p.screenshot({ path: 'test-results.png' });
await b.close();
if (errs.length) { console.error('Ошибки в консоли:', errs); process.exit(1); }
console.log('Все шаги прошли, ошибок в консоли нет');
