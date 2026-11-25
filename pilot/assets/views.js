import { HUES, avatar, backbar, esc, icon, postCard, userRow } from './ui.js';
import { locale, t } from './i18n.js';

const eventDate = () => new Intl.DateTimeFormat(locale(), {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty',
});

function eventCard(event, detail = false) {
  const title = detail ? esc(event.title) : `<button class="link event-title" data-act="event" data-id="${event.event_id}">${esc(event.title)}</button>`;
  const registration = event.started ? '' : event.ticket_id ? `<span class="badge g">${t('Вы записаны')}</span>` :
    event.available ? `<div class="event-footer"><small>${t('Мест осталось')} ${event.available}</small>
      <button class="btn primary sm" data-act="ticket" data-id="${event.event_id}">${t('Получить бесплатный пропуск')}</button></div>` :
      `<span class="badge">${t('Мест нет')}</span>`;
  return `<article class="event-card">
    ${event.has_cover ? `<img class="event-cover" src="/api/events/${event.event_id}/cover" loading="lazy" alt="">` : ''}
    <h2>${title}</h2>
    <p class="event-meta"><time datetime="${esc(event.starts_at)}">${esc(eventDate().format(new Date(event.starts_at)))}</time> · ${esc(event.venue)}</p>
    ${event.description ? `<p>${esc(event.description)}</p>` : ''}
    <p class="event-meta">${t('Выдано пропусков')} ${event.registered} / ${event.capacity} · ${t('Отмеченные посещения')} ${event.checked_in}</p>
    ${event.checked_in_at ? `<span class="badge g">${t('Посещение отмечено')}</span>` : ''}
    ${registration}
  </article>`;
}

function pageControls(view, next) {
  const previous = view.trail?.length || 0;
  if (!previous && !next) return '';
  return `
    <nav class="page-controls" aria-label="${t('Страницы')}">
      <button class="btn sm" data-act="prevPage" ${previous ? '' : 'disabled'}>${t('Назад')}</button>
      <span>${t('Страница')} ${previous + 1}</span>
      <button class="btn sm" data-act="nextPage" data-cursor="${esc(next)}" ${next ? '' : 'disabled'}>${t('Дальше')}</button>
    </nav>`;
}

function studentFields(faculties) {
  return `
    <div class="row2">
      <label>${t('Имя')}<input name="first" autocomplete="given-name" maxlength="50" required></label>
      <label>${t('Фамилия')}<input name="last" autocomplete="family-name" maxlength="50" required></label>
    </div>
    <label>${t('Имя пользователя')}<input name="username" autocomplete="username" pattern="[a-z0-9_.]{3,30}" maxlength="30" required><small>${t('3–30 символов. Латиница в нижнем регистре, цифры, точка и подчёркивание.')}</small></label>
    <div class="row2">
      <label>${t('Факультет')}<select name="faculty" required>${faculties.map(f => `<option value="${f.faculty_id}">${esc(f.short_name)}</option>`).join('')}</select></label>
      <label>${t('Курс')}<select name="year" required>${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select></label>
    </div>`;
}

export function createViews(api, app) {
  function loadPage(path, cursor, query = {}) {
    return api(path, { query: cursor ? { ...query, after: cursor } : query, paged: true });
  }

  return {
    login() {
      return `
      <div class="auth">
        <div class="brand-big"><span class="logo-mark">ct</span><h1>Campus Threads</h1><p>${t('Соцсеть KBTU')}</p></div>
        ${app.auth.microsoft ? `<button class="btn primary" data-act="microsoft">${t('Войти через Microsoft')}</button>` : ''}
        <form class="form" data-form="login">
          <label>${t('Имя пользователя')}<input name="username" autocomplete="username" maxlength="30" required></label>
          <label>${t('Пароль')}<input name="password" type="password" autocomplete="current-password" maxlength="72" required></label>
          <button class="btn ${app.auth.microsoft ? '' : 'primary'}" type="submit">${app.auth.microsoft ? t('Войти по паролю') : t('Войти')}</button>
        </form>
        ${app.auth.domain_signup ? `<button class="link" data-act="go" data-go="register">${t('Создать аккаунт')}</button>` : ''}
      </div>`;
    },

    async microsoftProfile() {
      const [{ email }, faculties] = await Promise.all([api('/auth/microsoft/profile'), api('/auth/faculties')]);
      return `
      <div class="auth">
        <div class="brand-big small"><span class="logo-mark">ct</span><h1>${t('Заполните профиль')}</h1><p>${t('Вы вошли как')} ${esc(email)}</p></div>
        <form class="form" data-form="microsoftProfile">
          ${studentFields(faculties)}
          <button class="btn primary" type="submit">${t('Создать профиль')}</button>
        </form>
        <button class="link" data-act="go" data-go="login">${t('Вернуться ко входу')}</button>
      </div>`;
    },

    async register() {
        const faculties = await api('/auth/faculties');
        return `
        <div class="auth">
          <div class="brand-big small"><span class="logo-mark">ct</span><h1>${t('Регистрация')}</h1><p>${t('Укажи свой адрес @kbtu.kz')}</p></div>
          <form class="form" data-form="register">
            <label>${t('Почта KBTU')}<input name="email" type="email" autocomplete="email" placeholder="name@kbtu.kz" maxlength="100" required></label>
            ${studentFields(faculties)}
            <label>${t('Пароль')}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label>
            <button class="btn primary" type="submit">${t('Создать аккаунт')}</button>
          </form>
          <button class="link" data-act="go" data-go="login">${t('Уже есть аккаунт? Войти')}</button>
        </div>`;
    },

    async feed(v) {
      const tab = v.tab || 'all';
      const { items: rows, next } = await loadPage('/feed', v.cursor, { following: tab === 'follow' });
      const empty = v.cursor ? t('На этой странице пока нет тредов.') :
        tab === 'all' ? t('Лента пока пуста. Опубликуйте первый тред.') : t('Здесь появятся треды тех, на кого вы подписаны.');
      return `
      <div class="seg" role="tablist">
        <button class="${tab === 'all' ? 'on' : ''}" data-act="feedtab" data-tab="all">${t('Для вас')}</button>
        <button class="${tab === 'follow' ? 'on' : ''}" data-act="feedtab" data-tab="follow">${t('Подписки')}</button>
      </div>
      <button class="composer-stub" data-act="go" data-go="compose">${avatar(app.me.full_name, app.me.user_id, 36)}<span>${t('Что нового,')} ${esc(app.me.first_name)}?</span><b>${t('Опубликовать')}</b></button>
      <div data-live="feed">
      ${rows.length ? rows.map(r => postCard(r)).join('') : `<div class="empty">${empty}<br><button class="link" data-act="go" data-go="search">${t('Найти людей')}</button></div>`}
      ${pageControls(v, next)}</div>`;
    },

    async thread(v) {
      const [root, ...replies] = await api('/posts/' + v.id);
      return `
      ${backbar(t('Тред'))}
      <div data-live="thread">${postCard(root, { main: true })}</div>
      <form class="reply-box" data-form="reply" data-id="${root.post_id}">
        ${avatar(app.me.full_name, app.me.user_id, 30)}
        <input name="content" maxlength="500" required placeholder="${t('Ответить')} ${root.is_anonymous ? t('анониму') : esc(root.full_name)}…">
        <button class="btn primary sm" type="submit">${t('Ответить')}</button>
      </form>
      <div data-live="replies"><div class="replies-h">${t('Ответы') + ' ·'} ${replies.length}</div>
      ${replies.map(r => postCard(r, { depth: Math.min(r.depth - 1, 3), reply: true })).join('') || `<div class="empty sm">${t('Пока нет ответов')}</div>`}</div>`;
    },

    async compose() {
      const comms = await api('/communities', { query: { joined: true } });
      return `
      ${backbar(t('Новый тред'))}
      <form class="compose" data-form="compose">
        <div class="compose-row">${avatar(app.me.full_name, app.me.user_id, 40)}
          <div class="compose-main">
            <b>${esc(app.me.full_name)}</b>
            <textarea name="content" maxlength="500" rows="6" required placeholder="${t('Начните тред… Хэштеги через #, например #сессия')}"></textarea>
            <div class="counter"><span data-count>0</span>/500</div>
          </div>
        </div>
        <label class="field">${t('Сообщество')}
          <select name="community"><option value="">${t('Без сообщества')}</option>${comms.map(c => `<option value="${c.community_id}">${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="switch"><input type="checkbox" name="anon"><span></span>${t('Опубликовать анонимно')}</label>
        <button class="btn primary" type="submit">${t('Опубликовать')}</button>
      </form>`;
    },

    async profile(v) {
      const id = v.id;
      const { profile: p, posts } = await api('/users/' + id);
      const me = id === app.me.user_id;
      const badges = [
        p.user_type === 'teacher' ? `<span class="badge t">${esc(p.position || t('Преподаватель'))}</span>` : `<span class="badge">${p.year_of_study} ${t('курс')}</span>`,
        p.faculty ? `<span class="badge">${esc(p.faculty)}</span>` : '',
        p.moderator_level ? `<span class="badge m">${t('Модератор')} ${p.moderator_level} ${t('ур.')}</span>` : '',
        p.is_mentor ? `<span class="badge g">${t('Ментор')}</span>` : '',
        p.scholarship_type ? `<span class="badge">${t('Стипендия')}</span>` : '',
      ].join('');
      return `
      ${me ? `<div class="topbar"><span class="top-title">${t('Профиль')}</span><button class="icon-btn" data-act="logout" aria-label="${t('Выйти')}">${icon('logout')}</button></div>` : backbar(t('Профиль'))}
      <section class="profile">
        <div class="prof-top" data-live="profile">
          <div><h2>${esc(p.full_name)}</h2><span class="handle">@${esc(p.username)}</span></div>
          ${avatar(p.full_name, p.user_id, 64)}
        </div>
        <div class="badges" data-live="badges">${badges}</div>
        ${me ? `<form class="bio-form" data-form="bio"><input name="bio" maxlength="160" value="${esc(p.bio || '')}" placeholder="${t('Добавьте био (до 160 символов)')}"><button class="btn sm" type="submit">${t('Сохранить')}</button></form>`
             : `<div data-live="bio">${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</div>`}
        ${me && app.auth.microsoft ? `<button class="btn sm" data-act="microsoft">${t('Подключить Microsoft')}</button>` : ''}
        <div data-live="profile-stats">
        <div class="stats">
          <span><b>${p.followers}</b> ${t('подписчиков')}</span><span><b>${p.following}</b> ${t('подписок')}</span><span><b>${p.posts}</b> ${t('постов')}</span>
        </div>
        ${me ? '' : `<button class="btn ${p.i_follow ? '' : 'primary'} wide" data-act="follow" data-id="${p.user_id}" data-on="${p.i_follow}">${p.i_follow ? t('Вы подписаны') : t('Подписаться')}</button>`}
        </div>
      </section>
      <div data-live="profile-posts"><div class="replies-h">${t('Треды')}</div>
      ${posts.map(r => postCard(r)).join('') || `<div class="empty sm">${t('Пока нет тредов')}</div>`}</div>`;
    },

    async communities() {
      const rows = await api('/communities');
      return `
      <div class="topbar"><span class="top-title">${t('Сообщества')}</span>
        <button class="btn sm primary" data-act="go" data-go="createCommunity">${t('Создать сообщество')}</button>
      </div>
      <div data-live="communities">
      ${rows.length ? '' : `<div class="empty">${t('Сообществ пока нет.')}</div>`}
      <ul class="comm-list">
        ${rows.map(c => `
        <li>
          <button class="comm-main" data-act="community" data-id="${c.community_id}">
            <span class="comm-ico" style="--h:${HUES[c.community_id % HUES.length]}">${esc(c.name[0])}</span>
            <span><b>${esc(c.name)}</b><small>${esc(c.description || '')}</small><small class="mono">${c.members} ${t('участников')}</small></span>
          </button>
          <button class="btn sm ${c.joined ? '' : 'primary'}" data-act="join" data-id="${c.community_id}" data-on="${!!c.joined}">${c.joined ? t('Вы участник') : t('Вступить')}</button>
        </li>`).join('')}
      </ul></div>`;
    },

    createCommunity() {
      return `
      ${backbar(t('Новое сообщество'))}
      <form class="form manage-form" data-form="createCommunity">
        <label>${t('Название')}<input name="name" maxlength="60" required></label>
        <label>${t('Описание')}<textarea name="description" rows="4" maxlength="300"></textarea></label>
        <button class="btn primary" type="submit">${t('Создать сообщество')}</button>
      </form>`;
    },

    async community(v) {
      const { community: c, posts: rows } = await api('/communities/' + v.id);
      return `
      ${backbar(c.name)}
      <section class="comm-head" data-live="community">
        <span class="comm-ico lg" style="--h:${HUES[c.community_id % HUES.length]}">${esc(c.name[0])}</span>
        <div><h2>${esc(c.name)}</h2><p>${esc(c.description || '')}</p><small class="mono">${c.members} ${t('участников')}</small></div>
        <button class="btn sm ${c.joined ? '' : 'primary'}" data-act="join" data-id="${c.community_id}" data-on="${!!c.joined}">${c.joined ? t('Вы участник') : t('Вступить')}</button>
      </section>
      <div data-live="community-posts">${rows.map(r => postCard({ ...r, community: null })).join('') || `<div class="empty sm">${t('Пока пусто')}</div>`}</div>`;
    },

    async search(v) {
      const term = v.term || '';
      const tag = v.tag || '';
      const data = await api('/search', { query: { term, tag } });
      let body;
      if (tag) {
        body = `<div class="replies-h">#${esc(tag)}</div>${data.posts.map(p => postCard(p)).join('') || `<div class="empty sm">${t('Тредов пока нет')}</div>`}`;
      } else if (term) {
        body = `
          <div class="replies-h">${t('Люди') + ' ·'} ${data.users.length}</div>
          ${data.users.map(u => userRow(u)).join('') || `<div class="empty sm">${t('Никого')}</div>`}
          <div class="replies-h">${t('Треды') + ' ·'} ${data.posts.length}</div>
          ${data.posts.map(p => postCard(p)).join('') || `<div class="empty sm">${t('Ничего')}</div>`}
          <div class="replies-h">${t('Сообщества') + ' ·'} ${data.communities.length}</div>
          ${data.communities.map(c => `<button class="user-row" data-act="community" data-id="${c.community_id}"><span><b>${esc(c.name)}</b><small>${esc(c.description)}</small></span></button>`).join('') || `<div class="empty sm">${t('Нет совпадений')}</div>`}
          <div class="replies-h">${t('Мероприятия') + ' ·'} ${data.events.length}</div>
          ${data.events.map(e => `<button class="user-row" data-act="event" data-id="${e.event_id}"><span><b>${esc(e.title)}</b><small>${esc(eventDate().format(new Date(e.starts_at)))} · ${esc(e.venue)}</small></span></button>`).join('') || `<div class="empty sm">${t('Нет совпадений')}</div>`}`;
      } else {
        body = `
          <div class="replies-h">${t('Популярные хэштеги')}</div>
          <div class="tag-cloud">${data.tags.map(tag => `<button class="tag-pill" data-act="tag" data-tag="${esc(tag.tag)}">#${esc(tag.tag)}<small>${tag.uses}</small></button>`).join('') || t('Пока нет хэштегов')}</div>
          <div class="replies-h">${t('Возможно, вы знакомы')}</div>
          ${data.recommendations.map(u => userRow(u, `${u.mutual} ${t('общих')}`)).join('') || `<div class="empty sm">${t('Подпишитесь на кого-нибудь, чтобы получить рекомендации')}</div>`}`;
      }
      return `
        <div class="topbar"><span class="top-title">${t('Поиск')}</span></div>
        <form class="search" data-form="search">
          <span>${icon('search')}</span><input name="term" aria-label="${t('Поиск по кампусу')}" maxlength="100" value="${esc(tag ? '#' + tag : term)}" placeholder="${t('Люди, #теги, клубы, события')}">
          <button class="btn sm" type="submit">${t('Искать')}</button>
          ${tag ? `<button type="button" class="chip-x" data-act="go" data-go="search">#${esc(tag)} ×</button>` : ''}
        </form><div data-live="search">${body}</div>`;
    },

    async events(v) {
      const mine = v.tab === 'mine';
      const archive = v.tab === 'archive';
      const { items: rows, next, canCreateEvent } = mine ? await api('/tickets', { paged: true }) : await loadPage('/events', v.cursor, { archive });
      return `
        <div class="topbar"><span class="top-title">${t('Мероприятия')}</span>
          <div data-live="event-actions">${canCreateEvent ? `<button class="btn sm primary" data-act="go" data-go="createEvent">${t('Создать мероприятие')}</button>` : ''}</div>
        </div>
        <div class="seg">
          <button class="${mine || archive ? '' : 'on'}" data-act="eventtab" data-tab="upcoming">${t('Предстоящие')}</button>
          <button class="${archive ? 'on' : ''}" data-act="eventtab" data-tab="archive">${t('Архив')}</button>
          <button class="${mine ? 'on' : ''}" data-act="eventtab" data-tab="mine">${t('Мои билеты')}</button>
        </div>
        <div data-live="events">
        ${mine ? rows.map(event => `
          <article class="event-card">
            <h2>${esc(event.title)}</h2>
            <p class="event-meta"><time datetime="${esc(event.starts_at)}">${esc(eventDate().format(new Date(event.starts_at)))}</time> · ${esc(event.venue)}</p>
            <p class="ticket-number">${t('Номер пропуска')} <code>${esc(event.ticket_id)}</code></p>
          </article>`).join('') || `<div class="empty">${t('У вас пока нет билетов.')}</div>` : rows.map(event => eventCard(event)).join('') || `<div class="empty">${archive ? t('В архиве пока нет мероприятий.') : canCreateEvent
            ? t('Предстоящих мероприятий пока нет. Нажмите «Создать мероприятие», чтобы опубликовать первое.')
            : t('Предстоящих мероприятий пока нет. Создавать мероприятия могут организаторы и модераторы сайта.')}</div>`}
        ${mine ? '' : pageControls(v, next)}</div>`;
    },

    async event(v) {
      const data = await api('/events/' + v.id);
      return `${backbar(t('Мероприятие'))}<div data-live="event-detail">${eventCard(data, true)}</div><div data-live="check-in">
        ${data.can_check_in && data.started ? `<form class="form manage-form" data-form="checkIn" data-id="${data.event_id}">
          <label>${t('Номер пропуска')}<input name="ticket_id" maxlength="36" required></label>
          <button class="btn primary" type="submit">${t('Отметить посещение')}</button>
        </form>` : ''}</div>`;
    },

    async analytics() {
      const summary = await api('/analytics');
      const metrics = [
        ['accounts', 'Аккаунты'], ['communities', 'Сообщества'], ['threads', 'Треды'], ['replies', 'Ответы'],
        ['likes', 'Лайки'], ['follows', 'Подписки'], ['memberships', 'Членства в сообществах'],
        ['upcoming', 'Предстоящие мероприятия'], ['past', 'Начавшиеся мероприятия'],
        ['tickets', 'Выданные пропуска'], ['check_ins', 'Отмеченные посещения'],
      ];
      return `${backbar(t('Сводка команды'))}<section class="manage-form" data-live="analytics">
        <p>${t('Данные из PostgreSQL обновляются каждые 10 секунд, пока открыта вкладка.')}</p>
        <dl class="metric-grid">${metrics.map(([key, label]) => `<div><dt>${t(label)}</dt><dd>${summary[key]}</dd></div>`).join('')}</dl>
        <p class="event-meta">${t('Обновлено')} ${esc(new Date(summary.updated_at).toLocaleTimeString(locale(), { timeZone: 'Asia/Almaty' }))}</p>
      </section>`;
    },

    createEvent() {
      return `
      ${backbar(t('Новое мероприятие'))}
      <form class="form manage-form" data-form="createEvent">
        <label>${t('Название')}<input name="title" maxlength="100" required></label>
        <label>${t('Описание')}<textarea name="description" rows="4" maxlength="600"></textarea></label>
        <label>${t('Место')}<input name="venue" maxlength="120" required></label>
        <label>${t('Дата и время по Алматы')}<input type="datetime-local" name="starts_at" required></label>
        <label>${t('Количество пропусков')}<input type="number" name="capacity" min="1" max="2147483647" step="1" required></label>
        <label>${t('Фото мероприятия (необязательно)')}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
        <button class="btn primary" type="submit">${t('Опубликовать мероприятие')}</button>
      </form>`;
    },
  };
}
