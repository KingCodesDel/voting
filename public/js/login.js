// public/js/login.js
// Admin login page logic. Moved out of admin/login.html into its own file
// because the server's Content-Security-Policy blocks inline <script>
// code as a security measure — only scripts loaded from external files
// are allowed to run. (This was the bug: the login form's submit handler
// used to live directly inside the HTML, so the browser silently blocked
// it and clicking "Log In" did nothing.)

(async function () {
  // If already logged in, go straight to the dashboard.
  try {
    const me = await AwardsApp.apiFetch('/api/auth/me');
    if (me.authenticated) window.location.href = '/admin/dashboard.html';
  } catch (e) {}
})();

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  errEl.classList.remove('show');
  btn.disabled = true;
  document.getElementById('loginBtnLabel').innerHTML = '<span class="spinner spinner-dark"></span> Signing in...';

  try {
    await AwardsApp.apiFetch('/api/auth/login', { method: 'POST', body: { username, password } });
    window.location.href = '/admin/dashboard.html';
  } catch (err) {
    errEl.textContent = err.message || 'Login failed.';
    errEl.classList.add('show');
    btn.disabled = false;
    document.getElementById('loginBtnLabel').textContent = 'Log In';
  }
});
