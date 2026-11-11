import { HUES, avatar, backbar, esc, icon, postCard, userRow } from './ui.js';

const eventDate = new Intl.DateTimeFormat('ru-KZ', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty',
});

function pageControls(view, next) {
  const previous = view.trail?.length || 0;
  if (!previous && !next) return '';
  return `
    <nav class="page-controls" aria-label="Страницы">
      <button class="btn sm" data-act="prevPage" ${previous ? '' : 'disabled'}>Назад</button>
      <span>Страница ${previous + 1}</span>
      <button class="btn sm" data-act="nextPage" data-cursor="${esc(next)}" ${next ? '' : 'disabled'}>Дальше</button>
    </nav>`;
}

function studentFields(faculties) {
  return `
    <div class="row2">
      <label>Имя<input name="first" autocomplete="given-name" maxlength="50" required></label>
      <label>Фамилия<input name="last" autocomplete="family-name" maxlength="50" required></label>
    </div>
    <label>Имя пользователя<input name="username" autocomplete="username" pattern="[a-z0-9_.]{3,30}" maxlength="30" required><small>3–30 символов. Латиница в нижнем регистре, цифры, точка и подчёркивание.</small></label>
    <div class="row2">
      <label>Факультет<select name="faculty" required>${faculties.map(f => `<option value="${f.faculty_id}">${esc(f.short_name)}</option>`).join('')}</select></label>
      <label>Курс<select name="year" required>${[1, 2, 3, 4, 5, 6].map(n => `<option>${n}</option>`).join('')}</select></label>
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
        <div class="brand-big"><span class="logo-mark">ct</span><h1>Campus Threads</h1><p>Соцсеть KBTU</p></div>
        ${app.auth.microsoft ? '<button class="btn primary" data-act="microsoft">Войти через Microsoft</button>' : ''}
        <form class="form" data-form="login">
          <label>Имя пользователя<input name="username" autocomplete="username" maxlength="30" required></label>
          <label>Пароль<input name="password" type="password" autocomplete="current-password" maxlength="72" required></label>
          <button class="btn ${app.auth.microsoft ? '' : 'primary'}" type="submit">${app.auth.microsoft ? 'Войти по паролю' : 'Войти'}</button>
        </form>
        ${app.auth.domain_signup ? '<button class="link" data-act="go" data-go="register">Создать аккаунт</button>' :
          app.auth.code_signup ? '<button class="link" data-act="go" data-go="register">Создать аккаунт по почте</button>' : ''}
      </div>`;
    },

    async microsoftProfile() {
      const [{ email }, faculties] = await Promise.all([api('/auth/microsoft/profile'), api('/auth/faculties')]);
      return `
      <div class="auth">
        <div class="brand-big small"><span class="logo-mark">ct</span><h1>Заполните профиль</h1><p>Вы вошли как ${esc(email)}</p></div>
        <form class="form" data-form="microsoftProfile">
          ${studentFields(faculties)}
          <button class="btn primary" type="submit">Создать профиль</button>
        </form>
        <button class="link" data-act="go" data-go="login">Вернуться ко входу</button>
      </div>`;
    },

    async register(v) {
      if (app.auth.domain_signup) {
        const faculties = await api('/auth/faculties');
        return `
        <div class="auth">
          <div class="brand-big small"><span class="logo-mark">ct</span><h1>Регистрация</h1><p>Укажи свой адрес @kbtu.kz</p></div>
          <form class="form" data-form="registerDomain">
            <label>Почта KBTU<input name="email" type="email" autocomplete="email" placeholder="name@kbtu.kz" maxlength="100" required></label>
            ${studentFields(faculties)}
            <label>Пароль<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label>
            <button class="btn primary" type="submit">Создать аккаунт</button>
          </form>
          <button class="link" data-act="go" data-go="login">Уже есть аккаунт? Войти</button>
        </div>`;
      }
      return `
      <div class="auth">
        <div class="brand-big small"><span class="logo-mark">ct</span><h1>Регистрация</h1><p>Шаг 1 из 2 · Университетская почта</p></div>
        <form class="form" data-form="code">
          <label>Почта KBTU<input name="email" type="email" autocomplete="email" value="${esc(v.email)}" placeholder="name@kbtu.kz" maxlength="100" required></label>
          <button class="btn primary" type="submit">Получить код</button>
        </form>
        ${app.auth.local_mail ? '<p>Локальная проверка сохраняет письмо в папку <code>.mailbox</code> проекта.</p>' : ''}
        <button class="link" data-act="go" data-go="login">Уже есть аккаунт? Войти</button>
      </div>`;
    },

    async verify(v) {
      const faculties = await api('/auth/faculties');
      return `
      <div class="auth">
        <div class="brand-big small"><span class="logo-mark">ct</span><h1>Подтверждение</h1><p>${app.auth.local_mail ? 'Код сохранён в папку .mailbox' : `Шаг 2 из 2 · Код отправлен на ${esc(v.email)}`}</p></div>
        <form class="form" data-form="register">
          <label>Код из письма<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
          ${studentFields(faculties)}
          <label>Пароль<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label>
          <button class="btn primary" type="submit">Подтвердить и войти</button>
        </form>
        <button class="link" data-act="resend">Отправить новый код</button>
        <button class="link" data-act="back">Изменить адрес</button>
      </div>`;
    },

    async feed(v) {
      const tab = v.tab || 'all';
      const { items: rows, next } = await loadPage('/feed', v.cursor, { following: tab === 'follow' });
      const empty = v.cursor ? 'На этой странице пока нет тредов.' :
        tab === 'all' ? 'Лента пока пуста. Опубликуйте первый тред.' : 'Здесь появятся треды тех, на кого вы подписаны.';
      return `
      <div class="topbar"><span class="logo-mark sm">ct</span><span class="top-title">Campus Threads</span></div>
      <div class="seg" role="tablist">
        <button class="${tab === 'all' ? 'on' : ''}" data-act="feedtab" data-tab="all">Для вас</button>
        <button class="${tab === 'follow' ? 'on' : ''}" data-act="feedtab" data-tab="follow">Подписки</button>
      </div>
      <button class="composer-stub" data-act="go" data-go="compose">${avatar(app.me.full_name, app.me.user_id, 36)}<span>Что нового, ${esc(app.me.first_name)}?</span><b>Опубликовать</b></button>
      <div data-live="feed">
      ${rows.length ? rows.map(r => postCard(r)).join('') : `<div class="empty">${empty}<br><button class="link" data-act="go" data-go="search">Найти людей</button></div>`}
      ${pageControls(v, next)}</div>`;
    },

    async thread(v) {
      const [root, ...replies] = await api('/posts/' + v.id);
      return `
      ${backbar('Тред')}
      <div data-live="thread">${postCard(root, { main: true })}</div>
      <form class="reply-box" data-form="reply" data-id="${root.post_id}">
        ${avatar(app.me.full_name, app.me.user_id, 30)}
        <input name="content" maxlength="500" required placeholder="Ответить ${root.is_anonymous ? 'анониму' : esc(root.full_name)}…">
        <button class="btn primary sm" type="submit">Ответить</button>
      </form>
      <div data-live="replies"><div class="replies-h">Ответы · ${replies.length}</div>
      ${replies.map(r => postCard(r, { depth: Math.min(r.depth - 1, 3), reply: true })).join('') || '<div class="empty sm">Пока нет ответов</div>'}</div>`;
    },

    async compose() {
      const comms = await api('/communities', { query: { joined: true } });
      return `
      ${backbar('Новый тред')}
      <form class="compose" data-form="compose">
        <div class="compose-row">${avatar(app.me.full_name, app.me.user_id, 40)}
          <div class="compose-main">
            <b>${esc(app.me.full_name)}</b>
            <textarea name="content" maxlength="500" rows="6" required placeholder="Начните тред… Хэштеги через #, например #сессия"></textarea>
            <div class="counter"><span data-count>0</span>/500</div>
          </div>
        </div>
        <label class="field">Сообщество
          <select name="community"><option value="">Без сообщества</option>${comms.map(c => `<option value="${c.community_id}">${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label class="switch"><input type="checkbox" name="anon"><span></span>Опубликовать анонимно</label>
        <button class="btn primary" type="submit">Опубликовать</button>
      </form>`;
    },

    async profile(v) {
      const id = v.id;
      const { profile: p, posts } = await api('/users/' + id);
      const me = id === app.me.user_id;
      const badges = [
        p.user_type === 'teacher' ? `<span class="badge t">${esc(p.position || 'Преподаватель')}</span>` : `<span class="badge">${p.year_of_study} курс</span>`,
        p.faculty ? `<span class="badge">${esc(p.faculty)}</span>` : '',
        p.moderator_level ? `<span class="badge m">Модератор ${p.moderator_level} ур.</span>` : '',
        p.is_mentor ? `<span class="badge g">Ментор</span>` : '',
        p.scholarship_type ? `<span class="badge">Стипендия</span>` : '',
      ].join('');
      return `
      ${me ? `<div class="topbar"><span class="top-title">Профиль</span><button class="icon-btn" data-act="logout" aria-label="Выйти">${icon('logout')}</button></div>` : backbar('Профиль')}
      <section class="profile">
        <div class="prof-top" data-live="profile">
          <div><h2>${esc(p.full_name)}</h2><span class="handle">@${esc(p.username)}</span></div>
          ${avatar(p.full_name, p.user_id, 64)}
        </div>
        <div class="badges" data-live="badges">${badges}</div>
        ${me ? `<form class="bio-form" data-form="bio"><input name="bio" maxlength="160" value="${esc(p.bio || '')}" placeholder="Добавьте био (до 160 символов)"><button class="btn sm" type="submit">Сохранить</button></form>`
             : `<div data-live="bio">${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</div>`}
        ${me && app.auth.microsoft ? '<button class="btn sm" data-act="microsoft">Подключить Microsoft</button>' : ''}
        <div data-live="profile-stats">
        <div class="stats">
          <span><b>${p.followers}</b> подписчиков</span><span><b>${p.following}</b> подписок</span><span><b>${p.posts}</b> постов</span>
        </div>
        ${me ? '' : `<button class="btn ${p.i_follow ? '' : 'primary'} wide" data-act="follow" data-id="${p.user_id}" data-on="${p.i_follow}">${p.i_follow ? 'Вы подписаны' : 'Подписаться'}</button>`}
        </div>
      </section>
      <div data-live="profile-posts"><div class="replies-h">Треды</div>
      ${posts.map(r => postCard(r)).join('') || '<div class="empty sm">Пока нет тредов</div>'}</div>`;
    },

    async communities() {
      const rows = await api('/communities');
      return `
      <div class="topbar"><span class="top-title">Сообщества</span>
        <button class="btn sm primary" data-act="go" data-go="createCommunity">Создать сообщество</button>
      </div>
      <div data-live="communities">
      ${rows.length ? '' : '<div class="empty">Сообществ пока нет.</div>'}
      <ul class="comm-list">
        ${rows.map(c => `
        <li>
          <button class="comm-main" data-act="community" data-id="${c.community_id}">
            <span class="comm-ico" style="--h:${HUES[c.community_id % HUES.length]}">${esc(c.name[0])}</span>
            <span><b>${esc(c.name)}</b><small>${esc(c.description || '')}</small><small class="mono">${c.members} участников</small></span>
          </button>
          <button class="btn sm ${c.joined ? '' : 'primary'}" data-act="join" data-id="${c.community_id}" data-on="${!!c.joined}">${c.joined ? 'Вы участник' : 'Вступить'}</button>
        </li>`).join('')}
      </ul></div>`;
    },

    createCommunity() {
      return `
      ${backbar('Новое сообщество')}
      <form class="form manage-form" data-form="createCommunity">
        <label>Название<input name="name" maxlength="60" required></label>
        <label>Описание<textarea name="description" rows="4" maxlength="300"></textarea></label>
        <button class="btn primary" type="submit">Создать сообщество</button>
      </form>`;
    },

    async community(v) {
      const { community: c, posts: rows } = await api('/communities/' + v.id);
      return `
      ${backbar(c.name)}
      <section class="comm-head" data-live="community">
        <span class="comm-ico lg" style="--h:${HUES[c.community_id % HUES.length]}">${esc(c.name[0])}</span>
        <div><h2>${esc(c.name)}</h2><p>${esc(c.description || '')}</p><small class="mono">${c.members} участников</small></div>
        <button class="btn sm ${c.joined ? '' : 'primary'}" data-act="join" data-id="${c.community_id}" data-on="${!!c.joined}">${c.joined ? 'Вы участник' : 'Вступить'}</button>
      </section>
      <div data-live="community-posts">${rows.map(r => postCard({ ...r, community: null })).join('') || '<div class="empty sm">Пока пусто</div>'}</div>`;
    },

    async search(v) {
      const term = v.term || '';
      const tag = v.tag || '';
      const data = await api('/search', { query: { term, tag } });
      let body;
      if (tag) {
        body = `<div class="replies-h">#${esc(tag)}</div>${data.posts.map(p => postCard(p)).join('') || '<div class="empty sm">Тредов пока нет</div>'}`;
      } else if (term) {
        body = `
          <div class="replies-h">Люди · ${data.users.length}</div>
          ${data.users.map(u => userRow(u)).join('') || '<div class="empty sm">Никого</div>'}
          <div class="replies-h">Треды · ${data.posts.length}</div>
          ${data.posts.map(p => postCard(p)).join('') || '<div class="empty sm">Ничего</div>'}`;
      } else {
        body = `
          <div class="replies-h">Популярные хэштеги</div>
          <div class="tag-cloud">${data.tags.map(t => `<button class="tag-pill" data-act="tag" data-tag="${esc(t.tag)}">#${esc(t.tag)}<small>${t.uses}</small></button>`).join('') || 'Пока нет хэштегов'}</div>
          <div class="replies-h">Возможно, вы знакомы</div>
          ${data.recommendations.map(u => userRow(u, `${u.mutual} общих`)).join('') || '<div class="empty sm">Подпишитесь на кого-нибудь, чтобы получить рекомендации</div>'}`;
      }
      return `
        <div class="topbar"><span class="top-title">Поиск</span></div>
        <form class="search" data-form="search">
          <span>${icon('search')}</span><input name="term" aria-label="Люди и треды" maxlength="100" value="${esc(term)}" placeholder="Люди и треды">
          ${tag ? `<button type="button" class="chip-x" data-act="go" data-go="search">#${esc(tag)} ×</button>` : ''}
        </form><div data-live="search">${body}</div>`;
    },

    async events(v) {
      const mine = v.tab === 'mine';
      const { items: rows, next, canCreateEvent } = mine ? { items: await api('/tickets') } : await loadPage('/events', v.cursor);
      return `
        <div class="topbar"><span class="top-title">Мероприятия</span>
          <div data-live="event-actions">${canCreateEvent ? '<button class="btn sm primary" data-act="go" data-go="createEvent">Создать мероприятие</button>' : ''}</div>
        </div>
        <div class="seg">
          <button class="${mine ? '' : 'on'}" data-act="eventtab" data-tab="upcoming">Предстоящие</button>
          <button class="${mine ? 'on' : ''}" data-act="eventtab" data-tab="mine">Мои билеты</button>
        </div>
        <div data-live="events">
        ${rows.map(event => `
          <article class="event-card">
            <h2>${esc(event.title)}</h2>
            <p class="event-meta"><time datetime="${esc(event.starts_at)}">${esc(eventDate.format(new Date(event.starts_at)))}</time> · ${esc(event.venue)}</p>
            ${event.description ? `<p>${esc(event.description)}</p>` : ''}
            ${mine ? `<p class="ticket-number">Номер пропуска <code>${esc(event.ticket_id)}</code></p>` :
              event.ticket_id ? '<span class="badge g">Вы записаны</span>' :
              event.available ? `<div class="event-footer"><small>Мест осталось: ${event.available}</small>
                <button class="btn primary sm" data-act="ticket" data-id="${event.event_id}">Получить бесплатный пропуск</button></div>` :
              '<span class="badge">Мест нет</span>'}
          </article>`).join('') || `<div class="empty">${mine ? 'У вас пока нет билетов.' : 'Предстоящих мероприятий пока нет.'}</div>`}
        ${mine ? '' : pageControls(v, next)}</div>`;
    },

    createEvent() {
      return `
      ${backbar('Новое мероприятие')}
      <form class="form manage-form" data-form="createEvent">
        <label>Название<input name="title" maxlength="100" required></label>
        <label>Описание<textarea name="description" rows="4" maxlength="600"></textarea></label>
        <label>Место<input name="venue" maxlength="120" required></label>
        <label>Дата и время по Алматы<input type="datetime-local" name="starts_at" required></label>
        <label>Количество пропусков<input type="number" name="capacity" min="1" max="2147483647" step="1" required></label>
        <button class="btn primary" type="submit">Опубликовать мероприятие</button>
      </form>`;
    },
  };
}
