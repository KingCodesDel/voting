// public/js/main.js
// Shared utilities used on every page: dark/light theme toggle, a toast
// notification helper, and a fetch wrapper that automatically attaches
// the CSRF token to mutating admin requests.

(function () {
  // ---------- Theme ----------
  const THEME_KEY = 'awards_theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  window.AwardsApp = window.AwardsApp || {};
  window.AwardsApp.initTheme = initTheme;
  window.AwardsApp.toggleTheme = toggleTheme;

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  });

  // ---------- Toast ----------
  let toastEl = null;
  function toast(message, type = 'default', duration = 3800) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = `toast show ${type}`;
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
  }
  window.AwardsApp.toast = toast;

  // ---------- CSRF-aware fetch wrapper ----------
  let cachedCsrfToken = null;

  async function getCsrfToken() {
    if (cachedCsrfToken) return cachedCsrfToken;
    const res = await fetch('/api/csrf-token', { credentials: 'same-origin' });
    const data = await res.json();
    cachedCsrfToken = data.csrfToken;
    return cachedCsrfToken;
  }

  // apiFetch(url, { method, body, isFormData }) -> parsed JSON (throws on !ok)
  async function apiFetch(url, options = {}) {
    const opts = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: {}
    };

    const needsCsrf = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(opts.method) &&
      url.startsWith('/api/') && !url.startsWith('/api/auth') && !url.startsWith('/api/votes');

    if (needsCsrf) {
      opts.headers['X-CSRF-Token'] = await getCsrfToken();
    }

    if (options.isFormData) {
      opts.body = options.body; // FormData sets its own content-type
    } else if (options.body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(options.body);
    }

    let res = await fetch(url, opts);

    // If the CSRF token was stale (e.g. session restarted), refresh once and retry.
    if (res.status === 403 && needsCsrf) {
      cachedCsrfToken = null;
      opts.headers['X-CSRF-Token'] = await getCsrfToken();
      res = await fetch(url, opts);
    }

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const message = (data && data.error) ? data.error : 'Request failed.';
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  window.AwardsApp.apiFetch = apiFetch;

  // ---------- Small helpers ----------
  window.AwardsApp.escapeHtml = function (str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  };
})();
