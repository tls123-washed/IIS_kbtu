import { state, q, tx, boot, onLog, resetDb, runRaw } from './db.js';
import { $, esc, HUES, avatar, icon, toast, postCard as renderPost, userRow, backbar } from './ui.js';
import bcrypt from './vendor/bcrypt.js';

const app = { me: null, view: { name: 'login' }, history: [], feedTab: 'all' };
const screen = () => $('#screen');

function dbError(e) {
  toast(`<b>PostgreSQL отклонил запрос</b><br>${esc(e.message)}`, 'err');
}

// ---------------------------------------------------------------- навигация
function go(name, params = {}, push = true) {
  if (push && app.view.name !== 'login') app.history.push(app.view);
  app.view = { name, ...params };
  render();
}
function back() { app.view = app.history.pop() || { name: 'feed' }; render(); }

async function render() {
  const v = app.view;
  $('#phone').classList.toggle('authed', !!app.me);
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === v.name || (v.name === 'profile' && b.dataset.go === 'profile' && v.id === app.me?.user_id)));
  try {
    const html = await (VIEWS[v.name] || VIEWS.feed)(v);
    screen().innerHTML = html;
    screen().scrollTop = v.scroll || 0;
  } catch (e) {
    console.error(e);
    screen().innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------- запросы
const POST_COLS = `
  d.post_id, d.parent_post_id, d.author, d.content, d.community, d.created_at,
  d.like_count, d.reply_count, p.author_id, p.is_anonymous, p.community_id,
  u.first_name || ' ' || u.last_name AS full_name,
  EXISTS (SELECT 1 FROM likes l WHERE l.post_id = d.post_id AND l.user_id = $1) AS liked`;

function postCard(p, opts) { return renderPost(p, { viewer: app.me?.user_id, ...opts }); }

// ---------------------------------------------------------------- экраны
const VIEWS = {
  async login() {
    const quick = await q('Быстрый вход: тестовые пользователи', `
      SELECT user_id, username, full_name, user_type, faculty, moderator_level, is_mentor
      FROM v_user_profiles
      WHERE user_id = 1
         OR user_id = (SELECT MIN(user_id) FROM teachers)
         OR user_id = (SELECT MIN(m.user_id) FROM moderators m JOIN mentors me USING (user_id) JOIN students s USING (user_id))
      ORDER BY user_type, user_id`);
    return `
    <div class="auth">
      <div class="brand-big"><span class="logo-mark">ct</span><h1>Campus Threads</h1><p>Соцсеть студентов KBTU</p></div>
      <form class="form" data-form="login" autocomplete="off">
        <label>Имя пользователя<input name="username" required placeholder="adilet_tleu" value="adilet_tleu"></label>
        <label>Пароль<input name="password" type="password" required value="campus123"></label>
        <button class="btn primary" type="submit">Войти</button>
        <p class="hint">Пароль проверяется через bcrypt по хешу из столбца <code>users.password_hash</code>. У тестовых пользователей пароль <code>campus123</code>.</p>
      </form>
      <div class="quick">
        <span class="quick-t">Войти как</span>
        ${quick.map(u => `<button class="quick-u" data-act="quick" data-u="${esc(u.username)}">${avatar(u.full_name, u.user_id, 28)}<span><b>${esc(u.full_name)}</b><small>${u.user_type === 'teacher' ? 'преподаватель' : 'студент'}${u.moderator_level ? ' · модератор' : ''}${u.is_mentor ? ' · ментор' : ''}</small></span></button>`).join('')}
      </div>
      <button class="link" data-act="go" data-go="register">Нет аккаунта? Регистрация</button>
    </div>`;
  },

  async register() {
    const fac = await q('Список факультетов для регистрации', `SELECT faculty_id, short_name, name FROM faculties ORDER BY faculty_id`);
    return `
    <div class="auth">
      <div class="brand-big small"><span class="logo-mark">ct</span><h1>Регистрация</h1><p>Создаст строку в users и в подклассе students</p></div>
      <form class="form" data-form="register" autocomplete="off">
        <div class="row2"><label>Имя<input name="first" required placeholder="Айдана"></label><label>Фамилия<input name="last" required placeholder="Нурланова"></label></div>
        <label>Имя пользователя<input name="username" required placeholder="aidana_n"><small>Только a–z, 0–9, _ и . — проверяет CHECK в базе</small></label>
        <label>Пароль<input name="password" type="password" required minlength="6" placeholder="минимум 6 символов"></label>
        <div class="row2">
          <label>Факультет<select name="faculty">${fac.map(f => `<option value="${f.faculty_id}">${esc(f.short_name)}</option>`).join('')}</select></label>
          <label>Курс<select name="year">${[1, 2, 3, 4].map(y => `<option>${y}</option>`).join('')}</select></label>
        </div>
        <button class="btn primary" type="submit">Создать аккаунт</button>
      </form>
      <button class="link" data-act="go" data-go="login">Уже есть аккаунт? Войти</button>
    </div>`;
  },

  async feed() {
    const tab = app.feedTab;
    let rows;
    if (tab === 'all') {
      rows = await q('Лента «Для вас»: все треды', `
        SELECT ${POST_COLS}
        FROM v_post_details d
        JOIN posts p ON p.post_id = d.post_id
        JOIN users u ON u.user_id = p.author_id
        WHERE d.parent_post_id IS NULL
        ORDER BY d.created_at DESC
        LIMIT 30`, [app.me.user_id]);
    } else {
      rows = await q('Лента «Подписки»: функция get_feed()', `
        SELECT ${POST_COLS.replaceAll('d.', 'f.').replace('f.parent_post_id', 'p.parent_post_id').replace('l.post_id = f.post_id', 'l.post_id = f.post_id')}
        FROM get_feed($1, 30) f
        JOIN posts p ON p.post_id = f.post_id
        JOIN users u ON u.user_id = p.author_id
        ORDER BY f.created_at DESC`, [app.me.user_id]);
    }
    return `
    <div class="topbar"><span class="logo-mark sm">ct</span><span class="top-title">Campus Threads</span></div>
    <div class="seg" role="tablist">
      <button class="${tab === 'all' ? 'on' : ''}" data-act="feedtab" data-tab="all">Для вас</button>
      <button class="${tab === 'follow' ? 'on' : ''}" data-act="feedtab" data-tab="follow">Подписки</button>
    </div>
    <button class="composer-stub" data-act="go" data-go="compose">${avatar(app.me.full_name, app.me.user_id, 36)}<span>Что нового, ${esc(app.me.first_name)}?</span><b>Опубликовать</b></button>
    ${rows.length ? rows.map(r => postCard(r)).join('') : `<div class="empty">Здесь появятся треды тех, на кого вы подписаны.<br><button class="link" data-act="go" data-go="search">Найти людей</button></div>`}`;
  },

  async thread(v) {
    const rows = await q('Тред целиком: рекурсивный CTE по REPLIES_TO', `
      WITH RECURSIVE tree AS (
          SELECT post_id, 0 AS depth, ARRAY[post_id] AS path
          FROM posts WHERE post_id = $2
        UNION ALL
          SELECT p.post_id, t.depth + 1, t.path || p.post_id
          FROM posts p JOIN tree t ON p.parent_post_id = t.post_id
      )
      SELECT t.depth, ${POST_COLS}
      FROM tree t
      JOIN v_post_details d ON d.post_id = t.post_id
      JOIN posts p ON p.post_id = d.post_id
      JOIN users u ON u.user_id = p.author_id
      ORDER BY t.path`, [app.me.user_id, v.id]);
    if (!rows.length) return `${backbar('Тред')}<div class="empty">Пост удалён</div>`;
    const [root, ...replies] = rows;
    return `
    ${backbar('Тред')}
    ${postCard(root, { main: true })}
    <form class="reply-box" data-form="reply" data-id="${root.post_id}">
      ${avatar(app.me.full_name, app.me.user_id, 30)}
      <input name="content" maxlength="500" required placeholder="Ответить ${root.is_anonymous ? 'анониму' : esc(root.full_name)}…">
      <button class="btn primary sm" type="submit">Ответить</button>
    </form>
    <div class="replies-h">Ответы · ${replies.length}</div>
    ${replies.map(r => postCard(r, { depth: Math.min(r.depth - 1, 3), reply: true })).join('') || '<div class="empty sm">Пока нет ответов</div>'}`;
  },

  async compose() {
    const comms = await q('Мои сообщества для публикации', `
      SELECT c.community_id, c.name
      FROM community_members cm JOIN communities c USING (community_id)
      WHERE cm.user_id = $1 ORDER BY c.name`, [app.me.user_id]);
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
      <label class="switch"><input type="checkbox" name="anon"><span></span>Анонимно <small>is_anonymous = TRUE, имя скрыто в v_post_details</small></label>
      <button class="btn primary" type="submit">Опубликовать</button>
    </form>`;
  },

  async profile(v) {
    const id = v.id;
    const [p] = await q('Профиль: представление v_user_profiles', `
      SELECT v.*, u.bio, u.first_name,
             EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = v.user_id) AS i_follow
      FROM v_user_profiles v JOIN users u USING (user_id)
      WHERE v.user_id = $1`, [id, app.me.user_id]);
    if (!p) return `${backbar('Профиль')}<div class="empty">Пользователь не найден</div>`;
    const posts = await q('Треды пользователя', `
      SELECT ${POST_COLS}
      FROM v_post_details d
      JOIN posts p ON p.post_id = d.post_id
      JOIN users u ON u.user_id = p.author_id
      WHERE p.author_id = $2 AND d.parent_post_id IS NULL
        AND (NOT p.is_anonymous OR p.author_id = $1)
      ORDER BY d.created_at DESC LIMIT 20`, [app.me.user_id, id]);
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
      <div class="prof-top">
        <div><h2>${esc(p.full_name)}</h2><span class="handle">@${esc(p.username)}</span></div>
        ${avatar(p.full_name, p.user_id, 64)}
      </div>
      <div class="badges">${badges}</div>
      ${me ? `<form class="bio-form" data-form="bio"><input name="bio" maxlength="160" value="${esc(p.bio || '')}" placeholder="Добавьте био (до 160 символов)"><button class="btn sm" type="submit">Сохранить</button></form>`
           : (p.bio ? `<p class="bio">${esc(p.bio)}</p>` : '')}
      <div class="stats">
        <span><b>${p.followers}</b> подписчиков</span><span><b>${p.following}</b> подписок</span><span><b>${p.posts}</b> постов</span>
      </div>
      ${me ? '' : `<button class="btn ${p.i_follow ? '' : 'primary'} wide" data-act="follow" data-id="${p.user_id}" data-on="${p.i_follow}">${p.i_follow ? 'Вы подписаны' : 'Подписаться'}</button>`}
    </section>
    <div class="replies-h">Треды</div>
    ${posts.map(r => postCard(r)).join('') || '<div class="empty sm">Пока нет тредов</div>'}`;
  },

  async communities() {
    const rows = await q('Сообщества и число участников (GROUP BY)', `
      SELECT c.community_id, c.name, c.description,
             COUNT(cm.user_id)                AS members,
             BOOL_OR(cm.user_id = $1)         AS joined
      FROM communities c
      LEFT JOIN community_members cm ON cm.community_id = c.community_id
      GROUP BY c.community_id
      ORDER BY members DESC`, [app.me.user_id]);
    return `
    <div class="topbar"><span class="top-title">Сообщества</span></div>
    <ul class="comm-list">
      ${rows.map(c => `
      <li>
        <button class="comm-main" data-act="community" data-id="${c.community_id}">
          <span class="comm-ico" style="--h:${HUES[c.community_id % HUES.length]}">${esc(c.name[0])}</span>
          <span><b>${esc(c.name)}</b><small>${esc(c.description || '')}</small><small class="mono">${c.members} участников</small></span>
        </button>
        <button class="btn sm ${c.joined ? '' : 'primary'}" data-act="join" data-id="${c.community_id}" data-on="${!!c.joined}">${c.joined ? 'Вы участник' : 'Вступить'}</button>
      </li>`).join('')}
    </ul>`;
  },

  async community(v) {
    const [c] = await q('Сообщество', `
      SELECT c.*, COUNT(cm.user_id) AS members, BOOL_OR(cm.user_id = $2) AS joined
      FROM communities c LEFT JOIN community_members cm USING (community_id)
      WHERE c.community_id = $1 GROUP BY c.community_id`, [v.id, app.me.user_id]);
    const rows = await q('Треды сообщества (POSTED_IN)', `
      SELECT ${POST_COLS}
      FROM v_post_details d
      JOIN posts p ON p.post_id = d.post_id
      JOIN users u ON u.user_id = p.author_id
      WHERE p.community_id = $2 AND d.parent_post_id IS NULL
      ORDER BY d.created_at DESC LIMIT 30`, [app.me.user_id, v.id]);
    return `
    ${backbar(c.name)}
    <section class="comm-head">
      <span class="comm-ico lg" style="--h:${HUES[c.community_id % HUES.length]}">${esc(c.name[0])}</span>
      <div><h2>${esc(c.name)}</h2><p>${esc(c.description || '')}</p><small class="mono">${c.members} участников</small></div>
      <button class="btn sm ${c.joined ? '' : 'primary'}" data-act="join" data-id="${c.community_id}" data-on="${!!c.joined}">${c.joined ? 'Вы участник' : 'Вступить'}</button>
    </section>
    ${rows.map(r => postCard({ ...r, community: null })).join('') || '<div class="empty sm">Пока пусто</div>'}`;
  },

  async search(v) {
    const term = v.term || '';
    const tag = v.tag || '';
    let body = '';
    if (tag) {
      const rows = await q(`Посты с хэштегом #${tag} (M:N через post_hashtags)`, `
        SELECT ${POST_COLS}
        FROM hashtags h
        JOIN post_hashtags ph ON ph.hashtag_id = h.hashtag_id
        JOIN v_post_details d ON d.post_id = ph.post_id
        JOIN posts p ON p.post_id = d.post_id
        JOIN users u ON u.user_id = p.author_id
        WHERE h.tag = $2
        ORDER BY d.created_at DESC`, [app.me.user_id, tag]);
      body = `<div class="replies-h">#${esc(tag)} · ${rows.length} постов</div>${rows.map(r => postCard(r)).join('')}`;
    } else if (term) {
      const users = await q('Поиск людей (ILIKE)', `
        SELECT user_id, username, full_name, user_type, faculty, followers
        FROM v_user_profiles
        WHERE username ILIKE '%' || $1 || '%' OR full_name ILIKE '%' || $1 || '%'
        ORDER BY followers DESC LIMIT 8`, [term]);
      const posts = await q('Поиск постов (ILIKE)', `
        SELECT ${POST_COLS}
        FROM v_post_details d
        JOIN posts p ON p.post_id = d.post_id
        JOIN users u ON u.user_id = p.author_id
        WHERE d.content ILIKE '%' || $2 || '%'
        ORDER BY d.like_count DESC LIMIT 15`, [app.me.user_id, term]);
      body = `
        <div class="replies-h">Люди · ${users.length}</div>
        ${users.map(u => userRow(u)).join('') || '<div class="empty sm">Никого</div>'}
        <div class="replies-h">Посты · ${posts.length}</div>
        ${posts.map(r => postCard(r)).join('') || '<div class="empty sm">Ничего</div>'}`;
    } else {
      const tags = await q('Популярные хэштеги', `
        SELECT h.tag, COUNT(*) AS uses
        FROM hashtags h JOIN post_hashtags ph USING (hashtag_id)
        GROUP BY h.tag ORDER BY uses DESC, h.tag LIMIT 12`);
      const rec = await q('Рекомендации: друзья друзей (как Q13)', `
        SELECT v.user_id, v.username, v.full_name, v.user_type, v.faculty, v.followers, COUNT(*) AS mutual
        FROM follows f1
        JOIN follows f2 ON f2.follower_id = f1.followee_id
        JOIN v_user_profiles v ON v.user_id = f2.followee_id
        WHERE f1.follower_id = $1
          AND f2.followee_id <> $1
          AND f2.followee_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = $1)
        GROUP BY v.user_id, v.username, v.full_name, v.user_type, v.faculty, v.followers
        ORDER BY mutual DESC LIMIT 5`, [app.me.user_id]);
      body = `
        <div class="replies-h">Популярные хэштеги</div>
        <div class="tag-cloud">${tags.map(t => `<button class="tag-pill" data-act="tag" data-tag="${esc(t.tag)}">#${esc(t.tag)}<small>${t.uses}</small></button>`).join('')}</div>
        <div class="replies-h">Возможно, вы знакомы</div>
        ${rec.map(u => userRow(u, `${u.mutual} общих`)).join('') || '<div class="empty sm">Подпишитесь на кого-нибудь, чтобы получить рекомендации</div>'}`;
    }
    return `
    <div class="topbar"><span class="top-title">Поиск</span></div>
    <form class="search" data-form="search"><span>${icon('search')}</span><input name="term" value="${esc(term)}" placeholder="Люди и посты" autocomplete="off">${tag ? `<button type="button" class="chip-x" data-act="go" data-go="search">#${esc(tag)} ×</button>` : ''}</form>
    ${body}`;
  },
};

// ---------------------------------------------------------------- действия
async function login(username, password) {
  const [u] = await q('Вход: ищем пользователя по username', `
    SELECT user_id, username, first_name, last_name, password_hash, user_type
    FROM users WHERE username = $1`, [username.trim().toLowerCase()]);
  if (!u) { toast('Пользователь не найден', 'err'); return; }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) { toast('Неверный пароль — bcrypt.compare вернул false', 'err'); return; }
  app.me = { ...u, full_name: u.first_name + ' ' + u.last_name };
  delete app.me.password_hash;
  $('#whoami').textContent = '@' + u.username;
  app.history = [];
  app.view = { name: 'feed' };
  render();
}

const ACTIONS = {
  async quick(el) { await login(el.dataset.u, 'campus123'); },
  go(el) { go(el.dataset.go); },
  back() { back(); },
  feedtab(el) { app.feedTab = el.dataset.tab; render(); },
  thread(el) { go('thread', { id: +el.dataset.id }); },
  profile(el) { go('profile', { id: +el.dataset.id }); },
  community(el) { go('community', { id: +el.dataset.id }); },
  tag(el) { go('search', { tag: el.dataset.tag }); },
  logout() { app.me = null; app.history = []; $('#whoami').textContent = 'гость'; app.view = { name: 'login' }; render(); },

  async like(el) {
    const id = +el.dataset.id, liked = el.dataset.liked === 'true';
    try {
      if (liked) await q('Убрать лайк (DELETE из M:N likes)', `DELETE FROM likes WHERE user_id = $1 AND post_id = $2`, [app.me.user_id, id]);
      else await q('Лайк (INSERT в M:N likes)', `INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [app.me.user_id, id]);
      const [{ like_count }] = await q('Пересчёт like_count (производный атрибут)', `SELECT like_count FROM v_post_details WHERE post_id = $1`, [id]);
      document.querySelectorAll(`.like[data-id="${id}"]`).forEach(b => {
        b.dataset.liked = String(!liked); b.classList.toggle('on', !liked); b.querySelector('span').textContent = like_count;
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      });
    } catch (e) { dbError(e); }
  },

  async follow(el) {
    const id = +el.dataset.id, on = el.dataset.on === 'true';
    try {
      if (on) await q('Отписка (рекурсивная связь FOLLOWS)', `DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [app.me.user_id, id]);
      else await q('Подписка (рекурсивная связь FOLLOWS)', `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [app.me.user_id, id]);
      app.view.scroll = screen().scrollTop; render();
    } catch (e) { dbError(e); }
  },

  async join(el) {
    const id = +el.dataset.id, on = el.dataset.on === 'true';
    try {
      if (on) await q('Выйти из сообщества', `DELETE FROM community_members WHERE user_id = $1 AND community_id = $2`, [app.me.user_id, id]);
      else await q('Вступить в сообщество (role = DEFAULT \'member\')', `INSERT INTO community_members (user_id, community_id) VALUES ($1, $2) RETURNING role, joined_at`, [app.me.user_id, id]);
      app.view.scroll = screen().scrollTop; render();
    } catch (e) { dbError(e); }
  },

  async delete(el) {
    const id = +el.dataset.id;
    if (!confirm('Удалить пост? Ответы и лайки удалятся каскадом (ON DELETE CASCADE).')) return;
    try {
      const info = await tx('Удаление поста с каскадом', async (t) => {
        const [c] = await q('Что удалится каскадом', `
          WITH RECURSIVE tree AS (
              SELECT post_id FROM posts WHERE post_id = $1
            UNION ALL
              SELECT p.post_id FROM posts p JOIN tree ON p.parent_post_id = tree.post_id
          )
          SELECT (SELECT COUNT(*) - 1 FROM tree) AS replies,
                 (SELECT COUNT(*) FROM likes WHERE post_id IN (SELECT post_id FROM tree)) AS likes`, [id], t);
        await q('DELETE поста (только свой: author_id = я)', `DELETE FROM posts WHERE post_id = $1 AND author_id = $2`, [id, app.me.user_id], t);
        return c;
      });
      toast(`Удалено: пост, ${info.replies} ответов и ${info.likes} лайков — ON DELETE CASCADE`);
      if (app.view.name === 'thread' && app.view.id === id) back(); else { app.view.scroll = screen().scrollTop; render(); }
    } catch (e) { dbError(e); }
  },
};

async function createPost({ content, community, anon, parent }) {
  const tags = [...new Set([...content.matchAll(/#([a-zа-яё0-9_]+)/gi)].map(m => m[1].toLowerCase()))];
  return tx(parent ? 'Ответ в треде' : 'Публикация треда', async (t) => {
    const [p] = await q(parent ? 'INSERT ответа: community_id заполнит триггер trg_reply_community' : 'INSERT нового треда', `
      INSERT INTO posts (author_id, community_id, parent_post_id, content, is_anonymous)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING post_id, community_id, created_at`, [app.me.user_id, community || null, parent || null, content, !!anon], t);
    for (const tag of tags) {
      const [h] = await q(`Хэштег #${tag}: найти или создать`, `
        INSERT INTO hashtags (tag) VALUES ($1)
        ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag
        RETURNING hashtag_id`, [tag], t);
      await q('Связь пост–хэштег (M:N TAGGED)', `INSERT INTO post_hashtags (post_id, hashtag_id) VALUES ($1, $2)`, [p.post_id, h.hashtag_id], t);
    }
    return p;
  });
}

const FORMS = {
  async login(f) { await login(f.username.value, f.password.value); },
  async register(f) {
    const username = f.username.value.trim().toLowerCase();
    try {
      const hash = await bcrypt.hash(f.password.value, 10);
      await tx('Регистрация: USER + подкласс STUDENT', async (t) => {
        const [u] = await q('INSERT в суперкласс users', `
          INSERT INTO users (username, email, password_hash, first_name, last_name, user_type)
          VALUES ($1, $2, $3, $4, $5, 'student')
          RETURNING user_id, created_at`, [username, username.replace(/\./g, '_') + '@kbtu.kz', hash, f.first.value.trim(), f.last.value.trim()], t);
        await q('INSERT в подкласс students (проверит триггер trg_students_subtype)', `
          INSERT INTO students (user_id, student_number, year_of_study, faculty_id)
          VALUES ($1, $2, $3, $4)`, [u.user_id, '26B' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'), +f.year.value, +f.faculty.value], t);
      });
      toast('Аккаунт создан. Пароль сохранён только как bcrypt-хеш');
      await login(username, f.password.value);
    } catch (e) { dbError(e); }
  },
  async compose(f) {
    try {
      const p = await createPost({ content: f.content.value, community: f.community.value, anon: f.anon.checked });
      toast(`Тред #${p.post_id} опубликован`);
      app.history = []; app.feedTab = 'all'; app.view = { name: 'thread', id: p.post_id }; app.history.push({ name: 'feed' }); render();
    } catch (e) { dbError(e); }
  },
  async reply(f) {
    try {
      const p = await createPost({ content: f.content.value, parent: +f.dataset.id });
      toast(`Ответ сохранён. Триггер поставил community_id = ${p.community_id ?? 'NULL'}`);
      render();
    } catch (e) { dbError(e); }
  },
  async bio(f) {
    try {
      await q('UPDATE био', `UPDATE users SET bio = NULLIF($1, '') WHERE user_id = $2`, [f.bio.value.trim(), app.me.user_id]);
      toast('Био обновлено');
    } catch (e) { dbError(e); }
  },
  search(f) { go('search', { term: f.term.value.trim() }, false); },
};

// ---------------------------------------------------------------- панель «База данных»
const KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|ON|AND|OR|NOT|IN|EXISTS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|RETURNING|ORDER|BY|GROUP|HAVING|LIMIT|AS|WITH|RECURSIVE|UNION|ALL|DESC|ASC|COUNT|BOOL_OR|CONFLICT|DO|BEGIN|COMMIT|ROLLBACK|NULLIF|IS|NULL|TRUE|FALSE|USING|DEFAULT|CASE|WHEN|THEN|ELSE|END|DISTINCT|EXPLAIN|ANALYZE|CREATE|TABLE|DROP|ALTER)\b/g;
function hl(sql) {
  return esc(sql)
    .replace(/(--[^\n]*)/g, '<i class="c">$1</i>')
    .replace(/(&#39;[^&]*?&#39;)/g, '<i class="s">$1</i>')
    .replace(/(\$\d+)/g, '<i class="p">$1</i>')
    .replace(KW, '<i class="k">$1</i>');
}

function logEntry(e) {
  const meta = e.ok
    ? (e.kind === 'tx' ? 'транзакция' : e.kind === 'script' ? `${e.ms.toFixed(0)} мс` : `${e.rows} стр.${e.affected ? ' · затронуто ' + e.affected : ''} · ${e.ms.toFixed(1)} мс`)
    : 'ОШИБКА';
  return `
  <li class="log-e ${e.ok ? '' : 'bad'} ${e.kind || ''}">
    <div class="log-h"><span class="log-n">#${e.id}</span><span class="log-l">${esc(e.label)}</span><span class="log-m">${meta}</span></div>
    ${e.kind === 'tx' ? `<code class="log-sql tx">${hl(e.sql)}</code>` : `<pre class="log-sql">${hl(e.sql)}</pre>`}
    ${e.params?.length ? `<div class="log-p">${e.params.map((p, i) => `<span><i>$${i + 1}</i> = ${esc(typeof p === 'string' ? (p.startsWith('$2') ? p.slice(0, 14) + '…' : `'${p.length > 40 ? p.slice(0, 40) + '…' : p}'`) : p)}</span>`).join('')}</div>` : ''}
    ${e.ok ? '' : `<div class="log-err">${esc(e.error)}</div>`}
  </li>`;
}

function renderLog() {
  const ul = $('#log');
  if (!ul) return;
  ul.innerHTML = state.log.slice(0, 80).map(logEntry).join('');
  $('#logCount').textContent = state.seq;
}

let logTimer;
onLog(() => {
  clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    if (dbTab === 'log') renderLog();
    $('#logCount').textContent = state.seq;
    const pill = $('#mPillDb'); pill?.classList.remove('ping'); void pill?.offsetWidth; pill?.classList.add('ping');
  }, 30);
});

let dbTab = 'log';
const TABLES = ['faculties', 'users', 'students', 'teachers', 'moderators', 'mentors', 'scholarship_holders', 'communities', 'community_members', 'posts', 'attachments', 'likes', 'follows', 'hashtags', 'post_hashtags'];

async function renderTables(selected) {
  const counts = await q('Сколько строк в каждой таблице', TABLES.map(t => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t}`).join('\nUNION ALL\n'));
  const total = counts.reduce((s, r) => s + Number(r.n), 0);
  const objs = await q('Объекты базы из системного каталога', `
    SELECT 'триггер' AS kind, tgname AS name, relname AS on_table
    FROM pg_trigger JOIN pg_class ON pg_class.oid = tgrelid
    WHERE NOT tgisinternal
    UNION ALL
    SELECT 'представление', viewname, '' FROM pg_views WHERE schemaname = 'public'
    UNION ALL
    SELECT 'функция', proname, '' FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace
    WHERE nspname = 'public'
    UNION ALL
    SELECT 'внешний ключ', conname, conrelid::regclass::text FROM pg_constraint WHERE contype = 'f'
    ORDER BY 1, 2`);
  const fk = objs.filter(o => o.kind === 'внешний ключ').length;
  const others = objs.filter(o => o.kind !== 'внешний ключ');
  let detail = '';
  if (selected) {
    const cols = await q(`Структура таблицы ${selected}`, `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position`, [selected]);
    const res = await runRaw(`Данные таблицы ${selected}`, `SELECT * FROM ${selected} ORDER BY 1 DESC LIMIT 25;`);
    detail = `
      <div class="tbl-detail">
        <div class="tbl-d-h"><b>${selected}</b><span>${cols.length} столбцов · последние 25 строк</span><button class="db-btn" data-dbact="tables">Закрыть</button></div>
        <div class="cols">${cols.map(c => `<span class="col"><b>${c.column_name}</b> ${esc(c.data_type)}${c.is_nullable === 'NO' ? ' <em>NOT NULL</em>' : ''}${c.column_default ? ` <em>= ${esc(c.column_default.slice(0, 28))}</em>` : ''}</span>`).join('')}</div>
        ${resultTable(res)}
      </div>`;
  }
  $('#dbBody').innerHTML = `
    <div class="kpis">
      <div><b>${TABLES.length}</b><span>таблиц</span></div>
      <div><b>${total.toLocaleString('ru-RU')}</b><span>строк сейчас</span></div>
      <div><b>${fk}</b><span>внешних ключей</span></div>
      <div><b>${others.filter(o => o.kind === 'триггер').length}</b><span>триггера</span></div>
    </div>
    ${detail}
    <div class="tbl-grid">${counts.map(r => `<button class="tbl ${r.t === selected ? 'on' : ''}" data-dbact="table" data-t="${r.t}"><span>${r.t}</span><b>${r.n}</b></button>`).join('')}</div>
    <h4 class="db-h">Триггеры, представления, функции</h4>
    <ul class="objs">${others.map(o => `<li><span class="kind">${o.kind}</span><code>${esc(o.name)}</code>${o.on_table ? `<small>ON ${esc(o.on_table)}</small>` : ''}</li>`).join('')}</ul>`;
}

function resultTable(res) {
  if (!res || !res.fields?.length) return `<div class="ok-line">Готово${res?.affectedRows ? ` · затронуто строк: ${res.affectedRows}` : ''}</div>`;
  const f = res.fields.map(x => x.name);
  const cell = (v) => v === null ? '<i class="null">NULL</i>' : v instanceof Date ? esc(v.toISOString().slice(0, 19).replace('T', ' ')) : typeof v === 'object' ? esc(JSON.stringify(v)) : esc(String(v).length > 60 ? String(v).slice(0, 60) + '…' : v);
  return `<div class="res-wrap"><table class="res"><thead><tr>${f.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${res.rows.slice(0, 100).map(r => `<tr>${f.map(n => `<td>${cell(r[n])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="res-n">${res.rows.length} строк</div>`;
}

let PRESETS = [];
async function loadPresets() {
  const src = await (await fetch('./sql/04_queries.sql')).text();
  const partA = src.split('ЧАСТЬ B')[0];
  const re = /-- \[(\d)\] (Q\d+)\. ([^\n]+)\n((?:--[^\n]*\n)*)([\s\S]*?)(?=\n-- \[\d\] Q|\n-- #####|$)/g;
  let m;
  while ((m = re.exec(partA))) PRESETS.push({ level: m[1], id: m[2], title: m[3].trim(), sql: (m[4] + m[5]).trim() });
  PRESETS.push({ level: '3', id: 'EX', title: 'EXPLAIN ANALYZE: как PostgreSQL выполняет ленту (индексы)', sql: `EXPLAIN ANALYZE\nSELECT * FROM get_feed(1, 20);` });
}

function renderConsole(sel = 0, result = '') {
  const p = PRESETS[sel] || PRESETS[0];
  $('#dbBody').innerHTML = `
    <p class="db-note">Запросы взяты из нашего файла <code>04_queries.sql</code> (часть A). Можно изменить или написать свой.</p>
    <label class="pre-sel">Готовый запрос<select id="presetSel">${PRESETS.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${x.id} · ${esc(x.title)}</option>`).join('')}</select></label>
    <textarea id="sqlIn" spellcheck="false">${esc(p?.sql || 'SELECT * FROM v_user_profiles LIMIT 10;')}</textarea>
    <div class="run-row"><button class="db-btn primary" data-dbact="run">Выполнить ▸</button><span class="db-note">Ctrl + Enter</span></div>
    <div id="sqlOut">${result}</div>`;
}

const CHECKS = [
  ['PRIMARY KEY', 'id факультета уникален', `INSERT INTO faculties (faculty_id, name, short_name) VALUES (1, 'Дубль', 'DUP')`],
  ['PRIMARY KEY (составной)', 'один лайк на пост от одного человека', `INSERT INTO likes (user_id, post_id) SELECT user_id, post_id FROM likes LIMIT 1`],
  ['FOREIGN KEY', 'лайк только от существующего пользователя', `INSERT INTO likes (user_id, post_id) VALUES (999, 1)`],
  ['FOREIGN KEY', 'студент только на существующем факультете', `UPDATE students SET faculty_id = 42 WHERE user_id = 1`],
  ['NOT NULL', 'email обязателен', `INSERT INTO users (username, password_hash, first_name, last_name, user_type) VALUES ('no_email', 'h', 'А', 'Б', 'student')`],
  ['NOT NULL', 'у поста обязательно есть автор', `INSERT INTO posts (content) VALUES ('Пост без автора')`],
  ['UNIQUE', 'username не повторяется', `INSERT INTO users (username, email, password_hash, first_name, last_name, user_type) VALUES ('adilet_tleu', 'x@stud.campus.kz', 'h', 'А', 'Б', 'student')`],
  ['CHECK', 'нельзя подписаться на себя', `INSERT INTO follows (follower_id, followee_id) VALUES (1, 1)`],
  ['CHECK', 'курс от 1 до 6', `UPDATE students SET year_of_study = 9 WHERE user_id = 1`],
  ['CHECK', 'username: только a-z, 0-9, _ и .', `UPDATE users SET username = 'Адилет Т!' WHERE user_id = 1`],
  ['CHECK', 'не больше 4 вложений на пост', `INSERT INTO attachments VALUES (1, 5, 'x.jpg', 'image')`],
  ['CHECK', 'пустой пост запрещён', `INSERT INTO posts (author_id, content) VALUES (1, '   ')`],
  ['CHECK', 'пост не длиннее 500 символов', `INSERT INTO posts (author_id, content) VALUES (1, repeat('a', 501))`],
  ['TRIGGER (disjoint)', 'преподаватель не может стать студентом', `INSERT INTO students VALUES ((SELECT MIN(user_id) FROM teachers), '22B00001', 2, 1)`],
  ['CHECK (overlapping)', 'уровень модератора только 1 или 2', `UPDATE moderators SET access_level = 3 WHERE user_id = (SELECT MIN(user_id) FROM moderators)`],
  ['PRIMARY KEY (overlapping)', 'нельзя назначить модератора дважды', `INSERT INTO moderators (user_id) SELECT MIN(user_id) FROM moderators`],
  ['КОНТРОЛЬ', 'правильная вставка должна пройти', `INSERT INTO follows (follower_id, followee_id) SELECT 1, 60 WHERE NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = 1 AND followee_id = 60)`],
];

function renderChecks(results = {}) {
  $('#dbBody').innerHTML = `
    <p class="db-note">Каждая команда нарушает одно правило схемы. Её выполняет настоящий PostgreSQL внутри транзакции, которая потом откатывается (ROLLBACK), поэтому данные не портятся. Тот же набор, что в <code>05_constraint_checks.sql</code>.</p>
    <div class="run-row"><button class="db-btn primary" data-dbact="checkall">Запустить все проверки ▸</button></div>
    <ul class="checks">${CHECKS.map(([type, rule, sql], i) => {
      const r = results[i];
      return `<li class="${r ? (r.blocked ? 'blocked' : 'passed') : ''}">
        <div class="ch-h"><span class="ch-type">${type}</span><span class="ch-rule">${esc(rule)}</span><button class="db-btn sm" data-dbact="check" data-i="${i}">Проверить</button></div>
        <pre class="log-sql">${hl(sql)}</pre>
        ${r ? `<div class="ch-res">${r.blocked ? '✕ ЗАБЛОКИРОВАНО: ' : '✓ ПРОШЛО: '}${esc(r.msg)}</div>` : ''}
      </li>`;
    }).join('')}</ul>`;
}
const checkResults = {};
async function runCheck(i) {
  const [, rule, sql] = CHECKS[i];
  try {
    await state.db.transaction(async (t) => {
      await q(`Проверка: ${rule}`, sql, [], t);
      throw new Error('__passed__');
    });
  } catch (e) {
    checkResults[i] = e.message === '__passed__' ? { blocked: false, msg: 'команда корректна, изменения откачены' } : { blocked: true, msg: e.message };
  }
}

async function setDbTab(tab, arg) {
  dbTab = tab;
  document.querySelectorAll('.db-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'log') { $('#dbBody').innerHTML = '<ul id="log" class="log"></ul>'; renderLog(); }
  if (tab === 'tables') await renderTables(arg);
  if (tab === 'console') renderConsole(arg || 0);
  if (tab === 'checks') renderChecks(checkResults);
}

async function runConsole() {
  const sql = $('#sqlIn').value;
  const out = $('#sqlOut');
  out.innerHTML = '<div class="db-note">Выполняется…</div>';
  try {
    const t0 = performance.now();
    const res = await runRaw('Консоль', sql);
    out.innerHTML = `<div class="ok-line">✓ ${(performance.now() - t0).toFixed(1)} мс</div>` + resultTable(res);
  } catch (e) {
    out.innerHTML = `<div class="log-err">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------- события
document.addEventListener('click', async (ev) => {
  const a = ev.target.closest('[data-act]');
  if (a && !a.disabled) { ev.preventDefault(); const fn = ACTIONS[a.dataset.act]; if (fn) { if (app.view) app.view.scroll = screen().scrollTop; await fn(a); } return; }
  const nav = ev.target.closest('.tabbar [data-go]');
  if (nav) {
    app.history = [];
    if (nav.dataset.go === 'profile') go('profile', { id: app.me.user_id }, false);
    else go(nav.dataset.go, {}, false);
    return;
  }
  const t = ev.target.closest('.db-tabs [data-tab]');
  if (t) { setDbTab(t.dataset.tab); return; }
  const d = ev.target.closest('[data-dbact]');
  if (d) {
    const k = d.dataset.dbact;
    if (k === 'table') setDbTab('tables', d.dataset.t);
    if (k === 'tables') setDbTab('tables');
    if (k === 'preset') renderConsole(+d.dataset.i);
    if (k === 'run') runConsole();
    if (k === 'check') { d.disabled = true; await runCheck(+d.dataset.i); renderChecks(checkResults); }
    if (k === 'checkall') { d.disabled = true; d.textContent = 'Проверяю…'; for (let i = 0; i < CHECKS.length; i++) await runCheck(i); renderChecks(checkResults); }
    return;
  }
  const m = ev.target.closest('[data-mview]');
  if (m) { document.body.dataset.mview = m.dataset.mview; document.querySelectorAll('[data-mview]').forEach(b => b.classList.toggle('on', b === m)); }
});

document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  const btn = f.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try { await FORMS[f.dataset.form](f); } finally { if (btn && document.contains(btn)) btn.disabled = false; }
});

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'presetSel') renderConsole(+ev.target.value);
});
document.addEventListener('input', (ev) => {
  if (ev.target.name === 'content' && ev.target.form?.dataset.form === 'compose') {
    $('[data-count]').textContent = ev.target.value.length;
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'sqlIn' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); runConsole(); }
});

$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('Пересоздать базу заново из SQL-файлов? Все ваши изменения пропадут.')) return;
  $('#resetBtn').disabled = true;
  await resetDb(() => {});
  $('#resetBtn').disabled = false;
  if (app.me) { const [u] = await q('Проверка текущего пользователя', 'SELECT user_id FROM users WHERE user_id = $1', [app.me.user_id]); if (!u) ACTIONS.logout(); }
  app.history = []; app.view = app.me ? { name: 'feed' } : { name: 'login' };
  render(); setDbTab(dbTab);
});

// ---------------------------------------------------------------- старт
(async function start() {
  const steps = $('#bootSteps');
  const add = (html) => { steps.insertAdjacentHTML('beforeend', `<li>${html}</li>`); };
  try {
    const ver = await boot((p) => {
      if (p.step === 'pg') add(`<b>✓</b> Запущен ${esc(p.text)}`);
      if (p.step === 'file') add(`<b>✓</b> <code>${p.file}</code> — ${esc(p.title)} <small>${p.lines} строк · ${p.ms.toFixed(0)} мс</small>`);
      if (p.step === 'restored') add(`<b>✓</b> ${esc(p.text)}`);
    });
    $('#pgVer').textContent = ver.split(' on ')[0].replace('PostgreSQL', 'PostgreSQL');
    $('#storage').textContent = state.storage === 'indexeddb' ? 'сохраняется в браузере (IndexedDB)' : 'в памяти вкладки';
    await loadPresets();
    $('#boot').classList.add('done');
    setTimeout(() => $('#boot').remove(), 500);
    await render();
    setDbTab('log');
  } catch (e) {
    console.error(e);
    add(`<b class="bad">✕</b> ${esc(e.message)}`);
  }
})();
