import { $, avatar, esc, icon, toast } from './ui.js';
import { createViews } from './views.js';
import { language, locale, t } from './i18n.js';

const screen = $('#screen');
const app = { me: null, view: { name: 'login' }, history: [], auth: {} };
const authScreens = new Set(['login', 'register', 'microsoftProfile']);
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 204) return;
    const data = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    if (!response.ok) throw new ApiError(response.status, data?.detail || 'Ошибка сервера. Попробуйте ещё раз.');
    if (data === null) throw new Error('Сервер прислал неполный ответ. Попробуйте ещё раз.');
    return paged ? {
      items: data,
      next: response.headers.get('X-Next-Cursor'),
      canCreateEvent: response.headers.get('X-Can-Create-Event') === '1',
    } : data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new Error(method === 'GET'
      ? 'Сервер не ответил вовремя. Повторите подключение.'
      : 'Ответ сервера задерживается. Обновите страницу перед повторным действием.');
    if (error instanceof TypeError) throw new Error('Сервер недоступен. Проверьте соединение и повторите попытку.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const views = createViews(api, app);
const navigation = [
  ['feed', 'home', 'Лента'], ['search', 'search', 'Поиск'], ['compose', 'plus', 'Новый тред'],
  ['communities', 'people', 'Сообщества'], ['events', 'calendar', 'Мероприятия'], ['profile', 'user', 'Профиль'],
];
const titles = {
  login: 'Добро пожаловать', register: 'Создать аккаунт',
  microsoftProfile: 'Твой профиль', feed: 'Лента кампуса', search: 'Поиск',
  compose: 'Новый тред', communities: 'Сообщества', community: 'Сообщество',
  profile: 'Профиль', events: 'Мероприятия', createCommunity: 'Новое сообщество',
  createEvent: 'Новое мероприятие', event: 'Мероприятие', analytics: 'Сводка команды',
};
document.documentElement.lang = language();
$('#languageSelect').value = language();
$('#languageSelect').addEventListener('change', event => {
  try {
    localStorage.setItem('campus-language', event.target.value);
    location.reload();
  } catch {
    event.target.value = language();
  }
});
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.textContent);
for (const [marker, attribute] of [['data-i18n-aria', 'aria-label'], ['data-i18n-placeholder', 'placeholder']]) {
  for (const element of document.querySelectorAll(`[${marker}]`)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
}
$('#navigation').innerHTML = navigation.map(([name, symbol, label]) =>
  `<button data-act="nav" data-go="${name}" aria-label="${t(label)}">${icon(symbol)}<span>${t(label)}</span></button>`).join('');

async function render() {
  const version = ++renderVersion;
  const v = app.view;
  displayedView = null;
  $('#phone').classList.toggle('authed', Boolean(app.me));
  document.body.classList.toggle('authed', Boolean(app.me));
  $('#pageTitle').textContent = t(titles[v.name] || 'Campus Threads');
  $('#analyticsLink').hidden = !app.me?.site_moderator;
  $('#sidebarAccount').innerHTML = app.me ? `<button data-act="profile" data-id="${app.me.user_id}">
    ${avatar(app.me.full_name, app.me.user_id, 36)}<span><b>${esc(app.me.full_name)}</b><small>@${esc(app.me.username)}</small></span></button>` : '';
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
    window.scrollTo({ top: v.scroll || 0, behavior: 'instant' });
    displayedView = v;
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401 && app.me) {
      startSession(null);
      toast(t('Сессия закончилась. Войдите снова.'), 'err');
      return;
    }
    screen.innerHTML = `<div class="empty" role="alert">${esc(t(error.message))}<br><button class="link" data-act="retry">${t('Повторить')}</button></div>`;
  }
}

let contextRunning = false;
async function refreshContext() {
  if (!app.me || document.hidden || contextRunning) return;
  const userId = app.me.user_id;
  contextRunning = true;
  try {
    const [events, communities] = await Promise.all([
      api('/events', { query: { page_size: 3 } }),
      api('/communities', { query: { joined: true } }),
    ]);
    if (app.me?.user_id !== userId) return;
    $('#upcomingEvents').innerHTML = events.map(event => `<button class="context-event" data-act="go" data-go="events">
      <strong>${esc(event.title)}</strong><small>${esc(new Date(event.starts_at).toLocaleString(locale(), {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty',
      }))} · ${esc(event.venue)}</small></button>`).join('') || `<p class="context-empty">${t('Здесь появятся предстоящие мероприятия университета.')}</p>`;
    $('#myCommunities').innerHTML = communities.slice(0, 5).map(c => `<button class="context-community" data-act="community" data-id="${c.community_id}">
      <span class="comm-ico" style="--h:250">${esc(c.name[0])}</span>${esc(c.name)}</button>`).join('') ||
      `<p class="context-empty">${t('Найди свой клуб или создай сообщество.')}</p><button class="link" data-act="go" data-go="communities">${t('Открыть сообщества')}</button>`;
  } catch {
    $('#upcomingEvents').innerHTML = `<p class="context-empty">${t('Афиша временно недоступна.')}</p>`;
  } finally {
    contextRunning = false;
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
    const scroll = window.scrollY;
    for (const region of screen.querySelectorAll('[data-live]')) {
      const next = template.content.querySelector(`[data-live="${region.dataset.live}"]`);
      if (next && region.innerHTML !== next.innerHTML) region.replaceChildren(...next.childNodes);
    }
    window.scrollTo({ top: scroll, behavior: 'instant' });
  } catch (error) {
    if (stillCurrent() && error.status === 401) await startSession(null);
    if (stillCurrent() && error.status === 404) await render();
  } finally {
    liveRefreshRunning = false;
  }
}

function go(name, params = {}, push = true) {
  if (push) app.history.push({ ...app.view, scroll: window.scrollY });
  app.view = { name, ...params };
  return render();
}

function back() {
  app.view = app.history.pop() || { name: app.me ? 'feed' : 'login' };
  return render();
}

function refresh() {
  app.view.scroll = window.scrollY;
  return render();
}

function startSession(user) {
  app.me = user;
  $('#upcomingEvents').innerHTML = '';
  $('#myCommunities').innerHTML = '';
  app.history = [];
  if (user) refreshContext();
  return go(user ? 'feed' : 'login', {}, false);
}

function failure(error) {
  if (error.status === 401 && app.me && !authScreens.has(app.view.name)) {
    startSession(null);
    toast(t('Сессия закончилась. Войдите снова.'), 'err');
  } else {
    toast(esc(t(error.message)), 'err');
  }
}

const send = (path, body) => api(path, { method: 'POST', body });
const toggle = (path, enabled) => api(path, { method: 'PUT', body: { enabled } });

const actions = {
  startup: initialize,
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
  event(el) { return go('event', { id: Number(el.dataset.id) }); },
  profile(el) { return go('profile', { id: Number(el.dataset.id) }); },
  community(el) { return go('community', { id: Number(el.dataset.id) }); },
  tag(el) { return go('search', { tag: el.dataset.tag }); },

  async logout() {
    await send('/auth/logout');
    await startSession(null);
  },
  async like(el) {
    const { liked, like_count } = await toggle(`/posts/${el.dataset.id}/like`, el.dataset.liked !== 'true');
    el.dataset.liked = String(liked);
    el.classList.toggle('on', liked);
    el.querySelector('span').textContent = like_count;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  },
  async follow(el) {
    await toggle(`/users/${el.dataset.id}/follow`, el.dataset.on !== 'true');
    await refresh();
  },
  async join(el) {
    await toggle(`/communities/${el.dataset.id}/membership`, el.dataset.on !== 'true');
    await refresh();
    refreshContext();
  },
  async delete(el) {
    if (!confirm(t('Удалить публикацию вместе с её ответами и лайками?'))) return;
    await api('/posts/' + el.dataset.id, { method: 'DELETE' });
    if (app.view.name === 'thread' && app.view.id === Number(el.dataset.id)) await back();
    else await refresh();
    toast(t('Публикация удалена.'));
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
    toast(t('Пропуск добавлен в «Мои билеты».'));
  },
};

const forms = {
  async login(data) { await startSession(await send('/auth/login', data)); },
  async register(data) {
    const user = await send('/auth/register', {
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
    toast(t('Сообщество создано.'));
    refreshContext();
  },
  async createEvent(data) {
    const { photo, ...fields } = data;
    const cover = photo?.size ? await encodeCover(photo) : null;
    const event = await send('/events', { ...fields, cover, capacity: Number(fields.capacity) });
    app.history = [{ name: 'events' }];
    await go('event', { id: event.event_id }, false);
    toast(t('Мероприятие опубликовано.'));
    refreshContext();
  },
  async checkIn(data, form) {
    const result = await send(`/events/${form.dataset.id}/check-in`, { ticket_id: data.ticket_id.trim() });
    await refresh();
    toast(t(result.already_checked_in ? 'Этот пропуск уже отмечен.' : 'Посещение отмечено'));
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
    toast(t('Био обновлено.'));
  },
  search(data) {
    const term = data.term.trim();
    const tag = /^#([a-zа-яё0-9_]{1,50})$/i.exec(term);
    return go('search', tag ? { tag: tag[1].toLowerCase() } : { term }, false);
  },
};

async function encodeCover(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error(t('Выберите фото JPG, PNG или WebP до 8 МБ.'));
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let encoded = canvas.toDataURL('image/jpeg', .75).split(',')[1];
    if (encoded.length > 280_000) encoded = canvas.toDataURL('image/jpeg', .5).split(',')[1];
    if (encoded.length > 280_000) throw new Error();
    return encoded;
  } catch {
    throw new Error(t('Не удалось обработать фото мероприятия.'));
  } finally {
    bitmap?.close();
  }
}

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
  if (form.dataset.form === 'search') document.activeElement?.blur();
  run(button, () => forms[form.dataset.form](data, form));
});

screen.addEventListener('input', event => {
  if (event.target.name === 'content' && event.target.form?.dataset.form === 'compose') {
    $('[data-count]').textContent = event.target.value.length;
  }
});
setInterval(() => { if (app.view.name !== 'analytics') refreshLive(); }, 4000);
setInterval(() => { if (app.view.name === 'analytics') refreshLive(); }, 10000);
setInterval(refreshContext, 30000);
document.addEventListener('visibilitychange', refreshLive);
document.addEventListener('visibilitychange', refreshContext);

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

let initializing = false;
async function initialize() {
  if (initializing) return;
  initializing = true;
  window.campusStartup?.ready();
  try {
    const bootstrap = JSON.parse($('#app-bootstrap')?.textContent || 'null');
    app.auth = bootstrap?.auth || await api('/auth/options');
    if (bootstrap?.has_session === false) {
      // Гость сразу видит вход. База понадобится после отправки формы.
      await startSession(null);
    } else {
      screen.innerHTML = `<p class="empty" role="status">${t('Проверяем сохранённый вход…')}</p>`;
      try {
        const user = await api('/auth/me');
        await startSession(user);
      } catch (error) {
        if (error.status !== 401) throw error;
        await startSession(null);
      }
    }
    if (microsoftResult === 'profile' && app.auth.microsoft && !app.me) {
      await go('microsoftProfile', {}, false);
    } else if (Object.hasOwn(microsoftMessages, microsoftResult)) {
      toast(t(microsoftMessages[microsoftResult]), microsoftResult === 'linked' ? 'ok' : 'err');
    }
  } catch (error) {
    screen.innerHTML = `<div class="empty" role="alert"><p>${esc(t(error.message))}</p>
      <button class="btn primary" data-act="startup">${t('Повторить подключение')}</button></div>`;
  } finally {
    initializing = false;
  }
}
await initialize();
