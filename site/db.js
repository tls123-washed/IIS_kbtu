// Слой работы с базой: настоящий PostgreSQL (PGlite = Postgres, скомпилированный в WebAssembly).
// Каждый запрос проходит через q() и попадает в журнал SQL, который видно справа.
import { PGlite } from './vendor/pglite/index.js';

const SQL_FILES = [
  ['00_demo_reset.sql', 'Сброс учебных таблиц'],
  ['01_schema.sql', 'Создание таблиц (DDL)'],
  ['02_seed.sql', 'Датасет'],
  ['03_views_triggers.sql', 'Представления, триггеры, функция ленты'],
  ['06_moderator_mentor.sql', 'Overlapping: модераторы и менторы'],
];

export const state = { db: null, storage: 'memory', log: [], listeners: new Set(), seq: 0 };

export function onLog(fn) { state.listeners.add(fn); }

function dedent(s) {
  const lines = s.replace(/^\n+|\s+$/g, '').split('\n');
  const first = lines.find(l => l.trim()) || '';
  const ind = first.match(/^ */)[0].length;
  return lines.map(l => l.slice(Math.min(ind, l.match(/^ */)[0].length))).join('\n');
}

function push(entry) {
  entry.id = ++state.seq;
  entry.at = new Date();
  state.log.unshift(entry);
  if (state.log.length > 200) state.log.pop();
  state.listeners.forEach(fn => fn(entry));
}

// Выполнить запрос с параметрами ($1, $2...) и записать его в журнал.
export async function q(label, sql, params = [], conn = null) {
  const text = dedent(sql);
  const t0 = performance.now();
  try {
    const res = await (conn || state.db).query(text, params);
    const ms = performance.now() - t0;
    push({ label, sql: text, params, ms, rows: res.rows.length, affected: res.affectedRows, ok: true });
    return res.rows;
  } catch (e) {
    const ms = performance.now() - t0;
    push({ label, sql: text, params, ms, ok: false, error: e.message });
    throw e;
  }
}

// Транзакция: всё внутри либо выполнится целиком, либо откатится.
export async function tx(label, fn) {
  push({ label, sql: 'BEGIN;', params: [], ms: 0, ok: true, rows: 0, kind: 'tx' });
  try {
    const out = await state.db.transaction(async (t) => fn(t));
    push({ label, sql: 'COMMIT;', params: [], ms: 0, ok: true, rows: 0, kind: 'tx' });
    return out;
  } catch (e) {
    push({ label, sql: 'ROLLBACK;', params: [], ms: 0, ok: false, error: e.message, kind: 'tx' });
    throw e;
  }
}

export async function boot(progress) {
  let db;
  try {
    db = new PGlite('idb://campus-threads-kbtu');
    await db.waitReady;
    state.storage = 'indexeddb';
  } catch (e) {
    db = new PGlite();
    await db.waitReady;
    state.storage = 'memory';
  }
  state.db = db;
  const ver = (await db.query('SELECT version() AS v')).rows[0].v;
  progress({ step: 'pg', text: ver.split(' on ')[0] });
  const exists = (await db.query(`SELECT to_regclass('public.moderators') IS NOT NULL AS ok`)).rows[0].ok;
  if (!exists) {
    await runScripts(progress);
  } else {
    progress({ step: 'restored', text: 'База восстановлена из IndexedDB — данные сохранились после перезагрузки' });
  }
  return ver;
}

export async function runScripts(progress) {
  for (const [file, title] of SQL_FILES) {
    const src = await (await fetch('./sql/' + file)).text();
    const t0 = performance.now();
    await state.db.exec(src);
    const ms = performance.now() - t0;
    const lines = src.split('\n').length;
    push({ label: `Запуск ${file}`, sql: `\\i ${file}   -- ${title}, ${lines} строк SQL`, params: [], ms, ok: true, rows: 0, kind: 'script' });
    progress({ step: 'file', file, title, ms, lines });
  }
}

export async function resetDb(progress) {
  await runScripts(progress);
}

// Консоль: произвольный SQL, можно несколько команд.
export async function runRaw(label, sql) {
  const t0 = performance.now();
  try {
    const results = await state.db.exec(sql);
    const ms = performance.now() - t0;
    const last = [...results].reverse().find(r => r.fields && r.fields.length) || results[results.length - 1];
    push({ label, sql: sql.trim(), params: [], ms, ok: true, rows: last?.rows?.length ?? 0, affected: last?.affectedRows });
    return last;
  } catch (e) {
    push({ label, sql: sql.trim(), params: [], ms: performance.now() - t0, ok: false, error: e.message });
    throw e;
  }
}
