(() => {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem('campus-theme'); } catch {}
  const chosen = saved === 'light' || saved === 'dark' ? saved : null;
  document.documentElement.dataset.theme = chosen || (preference.matches ? 'dark' : 'light');
  function updateControl() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(dark));
      document.getElementById('themeLabel').textContent = dark ? 'Светлая тема' : 'Тёмная тема';
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    updateControl();
    document.getElementById('themeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('campus-theme', next); } catch {}
      updateControl();
    });
  });
  preference.addEventListener('change', event => {
    let stored;
    try { stored = localStorage.getItem('campus-theme'); } catch {}
    if (!stored) {
      document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
      updateControl();
    }
  });
})();
