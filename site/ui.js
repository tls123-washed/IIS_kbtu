const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HUES = [212, 262, 340, 18, 145, 190, 38, 290];
function avatar(name, id, size = 36, anon = false) {
  if (anon) return `<span class="av av-anon" style="--s:${size}px" aria-hidden="true">?</span>`;
  const parts = String(name || '?').trim().split(/\s+/);
  const ini = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  const h = HUES[(id || 0) % HUES.length];
  return `<span class="av" style="--s:${size}px;--h:${h}" aria-hidden="true">${esc(ini.toUpperCase())}</span>`;
}
function ago(d) {
  const t = new Date(d); const s = (Date.now() - t.getTime()) / 1000;
  if (s < 60) return 'сейчас';
  if (s < 3600) return Math.floor(s / 60) + ' мин';
  if (s < 86400) return Math.floor(s / 3600) + ' ч';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' д';
  return t.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function richText(t) {
  return esc(t).replace(/#([a-zа-яё0-9_]+)/gi, (m, tag) => `<button class="tag" data-act="tag" data-tag="${esc(tag.toLowerCase())}">#${esc(tag)}</button>`);
}
const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 5.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.3 4-6.5 8-6.5s7.2 2.2 8 6.5"/>',
  heart: '<path d="M12 20.5S3.5 15.3 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6c0 6.1-8.5 11.3-8.5 11.3z"/>',
  reply: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20l1.2-4.1A8.5 8.5 0 1 1 20.5 11.5z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.innerHTML = msg;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  $('#phone').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}
function postCard(p, opts = {}) {
  const anon = p.is_anonymous;
  const mine = p.mine ?? p.author_id === opts.viewer;
  const canDelete = p.can_delete ?? mine;
  const name = anon ? 'Аноним' : p.full_name;
  const who = anon ? '' : `<span class="handle">@${esc(p.author)}</span>`;
  const profileAttr = anon ? '' : `data-act="profile" data-id="${p.author_id}"`;
  return `
  <article class="post ${opts.reply ? 'reply' : ''} ${opts.main ? 'main' : ''}" style="--depth:${opts.depth || 0}">
    <div class="post-av" ${profileAttr}>${avatar(name, p.author_id, opts.main ? 40 : 36, anon)}${opts.line ? '<span class="thread-line"></span>' : ''}</div>
    <div class="post-body">
      <header class="post-head">
        <button class="name" ${profileAttr} ${anon ? 'disabled' : ''}>${esc(name)}</button>${who}
        <span class="dot">·</span><time>${ago(p.created_at)}</time>
        ${canDelete ? `<button class="mini-del" data-act="delete" data-id="${p.post_id}" aria-label="Удалить пост">${icon('trash')}</button>` : ''}
      </header>
      ${p.community && !opts.reply ? `<button class="chip-comm" data-act="community" data-id="${p.community_id}">${esc(p.community)}</button>` : ''}
      <div class="post-text" ${opts.main ? '' : `data-act="thread" data-id="${p.post_id}"`}>${richText(p.content)}</div>
      <footer class="post-actions">
        <button class="act like ${p.liked ? 'on' : ''}" data-act="like" data-id="${p.post_id}" data-liked="${p.liked}" aria-label="Нравится">${icon('heart')}<span>${p.like_count}</span></button>
        <button class="act" data-act="thread" data-id="${p.post_id}" aria-label="Ответы">${icon('reply')}<span>${p.reply_count}</span></button>
      </footer>
    </div>
  </article>`;
}

function userRow(u, extra) {
  return `<button class="user-row" data-act="profile" data-id="${u.user_id}">${avatar(u.full_name, u.user_id, 40)}<span><b>${esc(u.full_name)}</b><small>@${esc(u.username)} · ${u.user_type === 'teacher' ? 'преподаватель' : 'студент'}${u.faculty ? ' · ' + esc(u.faculty) : ''}</small></span><small class="mono">${extra || u.followers + ' подп.'}</small></button>`;
}
function backbar(title) {
  return `<div class="topbar"><button class="icon-btn" data-act="back" aria-label="Назад">${icon('back')}</button><span class="top-title">${esc(title)}</span></div>`;
}


export { $, esc, HUES, avatar, icon, toast, postCard, userRow, backbar };
