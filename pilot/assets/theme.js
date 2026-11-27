(() => {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let saved;
  try { saved = localStorage.getItem('campus-theme'); } catch {}
  const root = document.documentElement;
  try { root.toggleAttribute('data-winter', localStorage.getItem('campus-winter') === 'on'); } catch {}
  const chosen = saved === 'light' || saved === 'dark' ? saved : null;
  document.documentElement.dataset.theme = chosen || (preference.matches ? 'dark' : 'light');
  function updateControl() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(dark));
      let english = false;
      try { english = localStorage.getItem('campus-language') === 'en'; } catch {}
      document.getElementById('themeLabel').textContent = english
        ? (dark ? 'Light theme' : 'Dark theme') : (dark ? 'Светлая тема' : 'Тёмная тема');
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const winterToggle = document.getElementById('winterToggle');
    winterToggle.checked = root.hasAttribute('data-winter');
    const loadWinter = () => import('/assets/winter.js').then(module => module.updateWinter());
    if (winterToggle.checked) loadWinter();
    winterToggle.addEventListener('change', () => {
      root.toggleAttribute('data-winter', winterToggle.checked);
      try { localStorage.setItem('campus-winter', winterToggle.checked ? 'on' : 'off'); } catch {}
      loadWinter();
    });
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
