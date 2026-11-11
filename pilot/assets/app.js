import { $, esc, icon, toast } from './ui.js';
import { createViews } from './views.js';

const screen = $('#screen');
const app = { me: null, view: { name: 'login' }, history: [], auth: { code_signup: true } };
const authScreens = new Set(['login', 'register', 'verify', 'microsoftProfile']);
let renderVersion = 0;
let displayedView = null;
let pendingActions = 0;
let actionVersion = 0;
let liveRefreshRunning = false;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Браузер передаёт JSON. Сервер берёт личность пользователя из cookie.
async function api(path, { method = 'GET', body, query, paged = false } = {}) {
  const url = new URL('/api' + path, location.origin);
  if (query) url.search = new URLSearchParams(query);
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Сервер недоступен. Проверьте соединение и повторите попытку.');
  }
  if (response.status === 204) return;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.detail || 'Ошибка сервера. Попробуйте ещё раз.');
  return paged ? {
    items: data,
    next: response.headers.get('X-Next-Cursor'),
    canCreateEvent: response.headers.get('X-Can-Create-Event') === '1',
  } : data;
}

const views = createViews(api, app);
const navigation = [
  ['feed', 'home', 'Лента'], ['search', 'search', 'Поиск'], ['compose', 'plus', 'Новый тред'],
  ['communities', 'people', 'Сообщества'], ['events', 'calendar', 'Мероприятия'], ['profile', 'user', 'Профиль'],
];
$('#navigation').innerHTML = navigation.map(([name, symbol, label]) =>
  `<button data-act="nav" data-go="${name}" aria-label="${label}">${icon(symbol)}<span>${label}</span></button>`).join('');

async function render() {
  const version = ++renderVersion;
  const v = app.view;
  displayedView = null;
  $('#phone').classList.toggle('authed', Boolean(app.me));
  $('#whoami').textContent = app.me ? '@' + app.me.username : '';
  for (const button of $('#navigation').querySelectorAll('button')) {
    const current = button.dataset.go === v.name;
    button.classList.toggle('on', current);
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  try {
    const html = await views[v.name](v);
    if (version !== renderVersion) return;
    screen.innerHTML = html;
    screen.scrollTop = v.scroll || 0;
    displayedView = v;
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401 && app.me) {
      startSession(null);
      toast('Сессия закончилась. Войдите снова.', 'err');
      return;
    }
    screen.innerHTML = `<div class="empty" role="alert">${esc(error.message)}<br><button class="link" data-act="retry">Повторить</button></div>`;
  }
}

// Обновляем только области с данными. Поля поиска, ответа и биографии остаются в DOM.
async function refreshLive() {
  const view = app.view;
  if (!app.me || document.hidden || pendingActions || liveRefreshRunning
      || displayedView !== view || !screen.querySelector('[data-live]')) return;

  const version = renderVersion;
  const actions = actionVersion;
  const stillCurrent = () => version === renderVersion && actions === actionVersion && !document.hidden;
  liveRefreshRunning = true;
  try {
    const html = await views[view.name](view);
    if (!stillCurrent()) return;

    const template = document.createElement('template');
    template.innerHTML = html;
    const scroll = screen.scrollTop;
    for (const region of screen.querySelectorAll('[data-live]')) {
      const next = template.content.querySelector(`[data-live="${region.dataset.live}"]`);
      if (next && region.innerHTML !== next.innerHTML) region.replaceChildren(...next.childNodes);
    }
    screen.scrollTop = scroll;
  } catch (error) {
    if (stillCurrent() && error.status === 401) await startSession(null);
    if (stillCurrent() && error.status === 404) await render();
  } finally {
    liveRefreshRunning = false;
  }
}

function go(name, params = {}, push = true) {
  if (push) app.history.push({ ...app.view, scroll: screen.scrollTop });
  app.view = { name, ...params };
  return render();
}

function back() {
  app.view = app.history.pop() || { name: app.me ? 'feed' : 'login' };
  return render();
}

function refresh() {
  app.view.scroll = screen.scrollTop;
  return render();
}

function startSession(user) {
  app.me = user;
  app.history = [];
  return go(user ? 'feed' : 'login', {}, false);
}

function failure(error) {
  if (error.status === 401 && app.me && !authScreens.has(app.view.name)) {
    startSession(null);
    toast('Сессия закончилась. Войдите снова.', 'err');
  } else {
    toast(esc(error.message), 'err');
  }
}

const send = (path, body) => api(path, { method: 'POST', body });
const toggle = (path, enabled) => api(path, { method: 'PUT', body: { enabled } });

const actions = {
  nav(el) {
    const name = el.dataset.go;
    app.history = [];
    return go(name, name === 'profile' ? { id: app.me.user_id } : {}, false);
  },
  go(el) { return go(el.dataset.go); },
  back,
  retry: render,
  microsoft() { location.assign('/api/auth/microsoft/start'); },
  feedtab(el) { return go('feed', { tab: el.dataset.tab }, false); },
  eventtab(el) { return go('events', { tab: el.dataset.tab }, false); },
  nextPage(el) {
    const { name, tab, cursor, trail = [] } = app.view;
    return go(name, { tab, cursor: el.dataset.cursor, trail: [...trail, cursor] }, false);
  },
  prevPage() {
    const { name, tab, trail = [] } = app.view;
    return go(name, { tab, cursor: trail.at(-1), trail: trail.slice(0, -1) }, false);
  },
  thread(el) { return go('thread', { id: Number(el.dataset.id) }); },
  profile(el) { return go('profile', { id: Number(el.dataset.id) }); },
  community(el) { return go('community', { id: Number(el.dataset.id) }); },
  tag(el) { return go('search', { tag: el.dataset.tag }); },

  async resend() {
    await send('/auth/code', { email: app.view.email });
    toast(app.auth.local_mail ? 'Новый код сохранён в .mailbox.' : 'Новый код отправлен.');
  },
  async logout() {
    await send('/auth/logout');
    await startSession(null);
  },
  async like(el) {
    const { liked, like_count } = await toggle(`/posts/${el.dataset.id}/like`, el.dataset.liked !== 'true');
    el.dataset.liked = String(liked);
    el.classList.toggle('on', liked);
    el.querySelector('span').textContent = like_count;
  },
  async follow(el) {
    await toggle(`/users/${el.dataset.id}/follow`, el.dataset.on !== 'true');
    await refresh();
  },
  async join(el) {
    await toggle(`/communities/${el.dataset.id}/membership`, el.dataset.on !== 'true');
    await refresh();
  },
  async delete(el) {
    if (!confirm('Удалить публикацию вместе с её ответами и лайками?')) return;
    await api('/posts/' + el.dataset.id, { method: 'DELETE' });
    if (app.view.name === 'thread' && app.view.id === Number(el.dataset.id)) await back();
    else await refresh();
    toast('Публикация удалена.');
  },
  async ticket(el) {
    const view = app.view;
    try {
      await send(`/events/${el.dataset.id}/ticket`);
    } catch (error) {
      if (error.status === 409 && app.view === view) await refresh();
      throw error;
    }
    if (app.view === view) await go('events', { tab: 'mine' }, false);
    toast('Пропуск добавлен в «Мои билеты».');
  },
};

const forms = {
  async login(data) { await startSession(await send('/auth/login', data)); },
  async code(data) {
    const view = app.view;
    const email = data.email.trim().toLowerCase();
    await send('/auth/code', { email });
    if (app.view === view) {
      view.email = email;
      await go('verify', { email });
    }
  },
  async register(data) {
    const user = await send('/auth/register', {
      ...data, email: app.view.email, faculty: Number(data.faculty), year: Number(data.year),
    });
    await startSession(user);
  },
  async registerDomain(data) {
    const user = await send('/auth/register-domain', {
      ...data, faculty: Number(data.faculty), year: Number(data.year),
    });
    await startSession(user);
  },
  async microsoftProfile(data) {
    const user = await send('/auth/microsoft/profile', {
      ...data, faculty: Number(data.faculty), year: Number(data.year),
    });
    await startSession(user);
  },
  async createCommunity(data) {
    const community = await send('/communities', data);
    await go('community', { id: community.community_id }, false);
    toast('Сообщество создано.');
  },
  async createEvent(data) {
    await send('/events', { ...data, capacity: Number(data.capacity) });
    await back();
    toast('Мероприятие опубликовано.');
  },
  async compose(data) {
    const post = await send('/posts', {
      content: data.content, community: Number(data.community) || null, anonymous: data.anon === 'on',
    });
    app.history = [{ name: 'feed' }];
    await go('thread', { id: post.post_id }, false);
  },
  async reply(data, form) {
    await send('/posts', { content: data.content, parent: Number(form.dataset.id) });
    await refresh();
  },
  async bio(data) {
    await api('/me/bio', { method: 'PATCH', body: data });
    toast('Био обновлено.');
  },
  search(data) { return go('search', { term: data.term.trim() }, false); },
};

async function run(button, action) {
  actionVersion++;
  pendingActions++;
  if (button) button.disabled = true;
  try {
    await action();
  } catch (error) {
    failure(error);
  } finally {
    pendingActions--;
    if (button) button.disabled = false;
  }
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-act]');
  if (el && !el.disabled) run(el instanceof HTMLButtonElement ? el : null, () => actions[el.dataset.act](el));
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('[type=submit]');
  if (button?.disabled) return;
  const data = Object.fromEntries(new FormData(form));
  run(button, () => forms[form.dataset.form](data, form));
});

screen.addEventListener('input', event => {
  if (event.target.name === 'content' && event.target.form?.dataset.form === 'compose') {
    $('[data-count]').textContent = event.target.value.length;
  }
});
setInterval(refreshLive, 4000);
document.addEventListener('visibilitychange', refreshLive);

const url = new URL(location.href);
const microsoftResult = url.searchParams.get('microsoft');
if (microsoftResult) {
  url.searchParams.delete('microsoft');
  history.replaceState(null, '', url);
}

const microsoftMessages = {
  failed: 'Вход через Microsoft не завершён. Попробуйте ещё раз.',
  university: 'Войдите корпоративным аккаунтом КБТУ с адресом @kbtu.kz.',
  existing: 'Аккаунт уже есть. Войдите по паролю и нажмите «Подключить Microsoft» в профиле.',
  link_failed: 'Подключение не удалось. Выберите корпоративный аккаунт с почтой из профиля.',
  linked: 'Вход через Microsoft подключён.',
};

try {
  app.auth = await api('/auth/options');
  await startSession(await api('/auth/me'));
} catch (error) {
  await startSession(null);
  if (error.status !== 401) failure(error);
}
if (microsoftResult === 'profile' && app.auth.microsoft && !app.me) {
  await go('microsoftProfile', {}, false);
} else if (Object.hasOwn(microsoftMessages, microsoftResult)) {
  toast(microsoftMessages[microsoftResult], microsoftResult === 'linked' ? 'ok' : 'err');
}
