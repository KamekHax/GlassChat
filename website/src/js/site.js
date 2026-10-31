(() => {
  'use strict';
  const root = document.documentElement;
  const themeButton = document.getElementById('theme-toggle');
  const navButton = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');

  let savedTheme = null;
  try { savedTheme = localStorage.getItem('glasschat-site-theme'); } catch {}
  const preferred = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : preferred, false);

  function setTheme(theme, persist = true) {
    root.dataset.theme = theme;
    if (themeButton) {
      const next = theme === 'dark' ? 'light' : 'dark';
      themeButton.setAttribute('aria-label', `Switch to ${next} theme`);
      themeButton.title = `Switch to ${next} theme`;
      const label = themeButton.querySelector('.theme-label');
      if (label) label.textContent = next === 'light' ? 'Light' : 'Dark';
    }
    if (persist) {
      try { localStorage.setItem('glasschat-site-theme', theme); } catch {}
    }
  }

  themeButton?.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
  navButton?.addEventListener('click', () => {
    const open = navButton.getAttribute('aria-expanded') !== 'true';
    navButton.setAttribute('aria-expanded', String(open));
    navButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    nav?.classList.toggle('is-open', open);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    navButton?.setAttribute('aria-expanded', 'false');
    navButton?.setAttribute('aria-label', 'Open navigation');
  }));
  const current = document.body.dataset.page;
  nav?.querySelector(`[data-nav="${CSS.escape(current || '')}"]`)?.setAttribute('aria-current', 'page');
})();
