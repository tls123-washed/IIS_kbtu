// Копирует библиотеки из node_modules в site/vendor (после `npm install`).
// Мы держим их в vendor/, чтобы сайт работал без сборщика и без CDN.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
cpSync('node_modules/@electric-sql/pglite/dist', 'site/vendor/pglite', { recursive: true });
// bcryptjs пытается подключить node:crypto — в браузере его нет, поэтому отключаем.
let src = readFileSync('node_modules/bcryptjs/index.js', 'utf8');
src = src.replace(/import nodeCrypto from "crypto";/, 'const nodeCrypto = null;');
writeFileSync('site/vendor/bcrypt.js', src);
console.log('vendor обновлён');
