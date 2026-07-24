// public/js/home.js
// Home page logic: loads event branding/settings and drives the countdown
// timer. Moved out of index.html into its own file because the server's
// Content-Security-Policy (see server.js) blocks inline <script> code as
// a security measure — only scripts loaded from external files are
// allowed to run.

document.getElementById('year').textContent = new Date().getFullYear();

async function loadSettings() {
  try {
    const settings = await AwardsApp.apiFetch('/api/settings');
    document.getElementById('eventName').textContent = settings.event_name;
    document.getElementById('eventDescription').textContent = settings.event_description;
    document.title = settings.event_name + ' — Voting';
    document.getElementById('brandName').textContent = settings.event_name;
    if (settings.logo_url) document.getElementById('brandLogo').src = settings.logo_url;
    if (settings.primary_color) {
      document.documentElement.style.setProperty('--primary', settings.primary_color);
    }

    if (settings.voting_end) {
      document.getElementById('countdown').style.display = 'flex';
      startCountdown(new Date(settings.voting_end));
    }
  } catch (e) { /* fall back to defaults already in the HTML */ }
}

function startCountdown(endDate) {
  function tick() {
    const diff = endDate.getTime() - Date.now();
    if (diff <= 0) {
      document.getElementById('countdown').innerHTML = '<div class="unit"><span class="num">Voting Closed</span></div>';
      clearInterval(timer);
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('cd-days').textContent = d;
    document.getElementById('cd-hours').textContent = String(h).padStart(2, '0');
    document.getElementById('cd-mins').textContent = String(m).padStart(2, '0');
    document.getElementById('cd-secs').textContent = String(s).padStart(2, '0');
  }
  tick();
  const timer = setInterval(tick, 1000);
}

loadSettings();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
