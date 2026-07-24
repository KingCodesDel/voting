// public/js/admin.js
// Powers the entire admin dashboard: auth guard, tab navigation,
// category/nominee CRUD (with photo upload), results + charts,
// CSV export, vote reset, and event settings.

(function () {
  const { apiFetch, toast, escapeHtml } = window.AwardsApp;
  let categoriesCache = [];
  let overviewChart1 = null, overviewChart2 = null;
  let pollTimer = null;

  const el = (id) => document.getElementById(id);

  async function init() {
    const me = await guardAuth();
    if (!me) return;
    el('adminUsername').textContent = me.username;

    wireNav();
    wireLogout();
    wireCategoryForm();
    wireNomineeForm();
    wireResultsToolbar();
    wireSettingsForm();
    wireConfirmModal();
    wireNomineeSearch();
    wireMenuToggle();

    await refreshOverview();
    await refreshCategories();
    await refreshNominees();
    await refreshSettings();

    // "Live" updates: poll overview + results every 8s without a full page
    // refresh, so newly cast votes appear automatically.
    pollTimer = setInterval(() => {
      const active = document.querySelector('.tab-panel.active').id;
      if (active === 'tab-overview') refreshOverview();
      if (active === 'tab-results') refreshResults();
      if (active === 'tab-voters') refreshVoters();
    }, 8000);
  }

  async function guardAuth() {
    try {
      const me = await apiFetch('/api/auth/me');
      if (!me.authenticated) {
        window.location.href = '/admin/login.html';
        return null;
      }
      return me;
    } catch (e) {
      window.location.href = '/admin/login.html';
      return null;
    }
  }

  function wireLogout() {
    el('logoutBtn').addEventListener('click', async () => {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/admin/login.html';
    });
  }

  function wireMenuToggle() {
    el('menuToggle').addEventListener('click', () => el('sidebar').classList.toggle('open'));
  }

  // ---------------- Tab navigation ----------------
  function wireNav() {
    document.querySelectorAll('.tab-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = link.dataset.tab;
        document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        link.classList.add('active');
        el(`tab-${tab}`).classList.add('active');
        el('pageTitle').textContent = link.textContent.trim().replace(/^\S+\s/, '');
        el('sidebar').classList.remove('open');

        if (tab === 'results') refreshResults();
        if (tab === 'voters') refreshVoters();
      });
    });
  }

  // ---------------- Overview ----------------
  async function refreshOverview() {
    try {
      const stats = await apiFetch('/api/admin/stats');
      el('statTotalVotes').textContent = stats.totalVotes;
      el('statTotalVoters').textContent = stats.totalVoters;
      el('statTotalCategories').textContent = stats.totalCategories;
      el('statTotalNominees').textContent = stats.totalNominees;
      renderVotesOverTimeChart(stats.votesByDay);
      await renderVotesByCategoryChart();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderVotesOverTimeChart(votesByDay) {
    const ctx = el('votesOverTimeChart');
    if (overviewChart1) overviewChart1.destroy();
    overviewChart1 = new Chart(ctx, {
      type: 'line',
      data: {
        labels: votesByDay.map(d => d.day),
        datasets: [{
          label: 'Votes',
          data: votesByDay.map(d => d.count),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.15)',
          tension: 0.35,
          fill: true
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  async function renderVotesByCategoryChart() {
    const results = await apiFetch('/api/admin/results');
    const ctx = el('votesByCategoryChart');
    if (overviewChart2) overviewChart2.destroy();
    overviewChart2 = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: results.map(c => c.name),
        datasets: [{
          label: 'Total Votes',
          data: results.map(c => c.totalVotes),
          backgroundColor: '#f59e0b'
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  // ---------------- Categories ----------------
  async function refreshCategories() {
    categoriesCache = await apiFetch('/api/categories');
    renderCategoriesTable();
    populateNomineeCategoryDropdown();
  }

  function renderCategoriesTable() {
    const tbody = el('categoriesTableBody');
    if (categoriesCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No categories yet. Add one above.</td></tr>';
      return;
    }
    tbody.innerHTML = categoriesCache.map(cat => `
      <tr>
        <td><strong>${escapeHtml(cat.name)}</strong></td>
        <td>${escapeHtml(cat.description || '')}</td>
        <td>${cat.nominees.length}</td>
        <td>${cat.display_order}</td>
        <td class="actions-row">
          <button class="icon-btn" data-edit-category="${cat.id}">✏️ Edit</button>
          <button class="icon-btn danger" data-delete-category="${cat.id}">🗑️ Delete</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-category]').forEach(btn =>
      btn.addEventListener('click', () => editCategory(Number(btn.dataset.editCategory))));
    tbody.querySelectorAll('[data-delete-category]').forEach(btn =>
      btn.addEventListener('click', () => confirmDeleteCategory(Number(btn.dataset.deleteCategory))));
  }

  function editCategory(id) {
    const cat = categoriesCache.find(c => c.id === id);
    if (!cat) return;
    el('categoryId').value = cat.id;
    el('categoryName').value = cat.name;
    el('categoryDescription').value = cat.description || '';
    el('categoryOrder').value = cat.display_order;
    el('categoryFormTitle').textContent = 'Edit Category';
    el('categorySubmitBtn').textContent = 'Save Changes';
    el('categoryCancelBtn').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetCategoryForm() {
    el('categoryForm').reset();
    el('categoryId').value = '';
    el('categoryFormTitle').textContent = 'Add New Category';
    el('categorySubmitBtn').textContent = 'Add Category';
    el('categoryCancelBtn').style.display = 'none';
  }

  function wireCategoryForm() {
    el('categoryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = el('categoryId').value;
      const payload = {
        name: el('categoryName').value.trim(),
        description: el('categoryDescription').value.trim(),
        display_order: Number(el('categoryOrder').value) || 0
      };
      try {
        if (id) {
          await apiFetch(`/api/categories/${id}`, { method: 'PUT', body: payload });
          toast('Category updated.', 'success');
        } else {
          await apiFetch('/api/categories', { method: 'POST', body: payload });
          toast('Category added.', 'success');
        }
        resetCategoryForm();
        await refreshCategories();
        await refreshOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    el('categoryCancelBtn').addEventListener('click', resetCategoryForm);
  }

  function confirmDeleteCategory(id) {
    const cat = categoriesCache.find(c => c.id === id);
    showConfirm({
      title: 'Delete Category?',
      message: `This will permanently delete "${cat.name}", all its nominees, and all associated votes. This cannot be undone.`,
      onConfirm: async () => {
        await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
        toast('Category deleted.', 'success');
        await refreshCategories();
        await refreshNominees();
        await refreshOverview();
      }
    });
  }

  // ---------------- Nominees ----------------
  function populateNomineeCategoryDropdown() {
    const select = el('nomineeCategory');
    const currentValue = select.value;
    select.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (currentValue) select.value = currentValue;
  }

  async function refreshNominees(query) {
    const tbody = el('nomineesTableBody');
    let nominees;
    if (query) {
      nominees = await apiFetch('/api/admin/nominees/search?q=' + encodeURIComponent(query));
    } else {
      const flat = [];
      categoriesCache.forEach(cat => cat.nominees.forEach(n => flat.push({ ...n, category_name: cat.name })));
      nominees = flat;
    }

    // Attach live vote counts from results
    let results = [];
    try { results = await apiFetch('/api/admin/results'); } catch (e) {}
    const voteCountMap = {};
    results.forEach(cat => cat.nominees.forEach(n => { voteCountMap[n.id] = n.voteCount; }));

    if (nominees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No nominees found.</td></tr>';
      return;
    }

    tbody.innerHTML = nominees.map(nom => `
      <tr>
        <td>${nom.photo_url ? `<img class="thumb" src="${escapeHtml(nom.photo_url)}" alt="">` : '—'}</td>
        <td><strong>${escapeHtml(nom.name)}</strong></td>
        <td>${escapeHtml(nom.category_name || '')}</td>
        <td>${voteCountMap[nom.id] ?? 0}</td>
        <td class="actions-row">
          <button class="icon-btn" data-edit-nominee='${JSON.stringify(nom).replace(/'/g, "&#39;")}'>✏️ Edit</button>
          <button class="icon-btn danger" data-delete-nominee="${nom.id}">🗑️ Delete</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit-nominee]').forEach(btn =>
      btn.addEventListener('click', () => editNominee(JSON.parse(btn.dataset.editNominee))));
    tbody.querySelectorAll('[data-delete-nominee]').forEach(btn =>
      btn.addEventListener('click', () => confirmDeleteNominee(Number(btn.dataset.deleteNominee))));
  }

  function editNominee(nom) {
    el('nomineeId').value = nom.id;
    el('nomineeCategory').value = nom.category_id;
    el('nomineeName').value = nom.name;
    el('nomineeBio').value = nom.bio || '';
    el('nomineeOrder').value = nom.display_order || 0;
    el('nomineeFormTitle').textContent = 'Edit Nominee';
    el('nomineeSubmitBtn').textContent = 'Save Changes';
    el('nomineeCancelBtn').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetNomineeForm() {
    el('nomineeForm').reset();
    el('nomineeId').value = '';
    el('nomineeFormTitle').textContent = 'Add New Nominee';
    el('nomineeSubmitBtn').textContent = 'Add Nominee';
    el('nomineeCancelBtn').style.display = 'none';
  }

  function wireNomineeForm() {
    el('nomineeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = el('nomineeId').value;
      const formData = new FormData();
      formData.append('category_id', el('nomineeCategory').value);
      formData.append('name', el('nomineeName').value.trim());
      formData.append('bio', el('nomineeBio').value.trim());
      formData.append('display_order', el('nomineeOrder').value || 0);
      const photoFile = el('nomineePhoto').files[0];
      if (photoFile) formData.append('photo', photoFile);

      try {
        if (id) {
          await apiFetch(`/api/nominees/${id}`, { method: 'PUT', body: formData, isFormData: true });
          toast('Nominee updated.', 'success');
        } else {
          await apiFetch('/api/nominees', { method: 'POST', body: formData, isFormData: true });
          toast('Nominee added.', 'success');
        }
        resetNomineeForm();
        await refreshCategories();
        await refreshNominees();
        await refreshOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    el('nomineeCancelBtn').addEventListener('click', resetNomineeForm);
  }

  function confirmDeleteNominee(id) {
    showConfirm({
      title: 'Delete Nominee?',
      message: 'This will permanently delete this nominee and all votes cast for them. This cannot be undone.',
      onConfirm: async () => {
        await apiFetch(`/api/nominees/${id}`, { method: 'DELETE' });
        toast('Nominee deleted.', 'success');
        await refreshCategories();
        await refreshNominees();
        await refreshOverview();
      }
    });
  }

  function wireNomineeSearch() {
    let debounceTimer;
    el('nomineeSearch').addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refreshNominees(e.target.value.trim()), 300);
    });
  }

  // ---------------- Results ----------------
  async function refreshResults() {
    const container = el('resultsContainer');
    try {
      const results = await apiFetch('/api/admin/results');
      if (results.length === 0) {
        container.innerHTML = '<p>No categories yet.</p>';
        return;
      }
      container.innerHTML = results.map(cat => `
        <div class="card">
          <h2>${escapeHtml(cat.name)} <span style="color:var(--text-muted); font-weight:400; font-size:0.9rem;">— ${cat.totalVotes} total votes</span></h2>
          ${cat.nominees.map(n => `
            <div style="margin-bottom:14px;">
              <div style="display:flex; justify-content:space-between; font-size:0.92rem; margin-bottom:4px;">
                <strong>${escapeHtml(n.name)}</strong>
                <span>${n.voteCount} votes (${n.percentage}%)</span>
              </div>
              <div class="vote-count-bar"><div class="fill" style="width:${n.percentage}%;"></div></div>
            </div>
          `).join('') || '<p style="color:var(--text-muted);">No nominees in this category.</p>'}
        </div>
      `).join('');
    } catch (e) {
      container.innerHTML = `<p style="color:var(--danger);">${escapeHtml(e.message)}</p>`;
    }
  }

  function wireResultsToolbar() {
    el('exportResultsBtn').addEventListener('click', () => window.location.href = '/api/admin/export/csv');
    el('exportVotesLogBtn').addEventListener('click', () => window.location.href = '/api/admin/export/votes-log-csv');
    el('resetVotesBtn').addEventListener('click', () => {
      showConfirm({
        title: 'Reset ALL Votes?',
        message: 'This will permanently delete every vote and every registered voter phone number. This action cannot be undone.',
        requireResetPhrase: true,
        onConfirm: async (extra) => {
          await apiFetch('/api/admin/reset-votes', { method: 'POST', body: { confirm: extra } });
          toast('All votes have been reset.', 'success');
          await refreshResults();
          await refreshOverview();
          await refreshVoters();
        }
      });
    });
  }

  // ---------------- Voters ----------------
  async function refreshVoters() {
    try {
      const stats = await apiFetch('/api/admin/stats');
      el('votersCount').textContent = stats.totalVoters;
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------------- Settings ----------------
  async function refreshSettings() {
    const s = await apiFetch('/api/admin/settings');
    el('settingEventName').value = s.event_name || '';
    el('settingEventDate').value = s.event_date || '';
    el('settingLogoUrl').value = s.logo_url || '';
    el('settingPrimaryColor').value = s.primary_color || '#6366f1';
    el('settingEventDescription').value = s.event_description || '';
    el('settingVotingEnabled').checked = !!s.voting_enabled;
    el('settingVotingStart').value = s.voting_start ? s.voting_start.slice(0, 16) : '';
    el('settingVotingEnd').value = s.voting_end ? s.voting_end.slice(0, 16) : '';
  }

  function wireSettingsForm() {
    el('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        event_name: el('settingEventName').value.trim(),
        event_date: el('settingEventDate').value,
        logo_url: el('settingLogoUrl').value.trim(),
        primary_color: el('settingPrimaryColor').value,
        event_description: el('settingEventDescription').value.trim(),
        voting_enabled: el('settingVotingEnabled').checked,
        voting_start: el('settingVotingStart').value || null,
        voting_end: el('settingVotingEnd').value || null
      };
      try {
        await apiFetch('/api/admin/settings', { method: 'PUT', body: payload });
        toast('Settings saved.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---------------- Confirmation modal ----------------
  let confirmCallback = null;
  function showConfirm({ title, message, onConfirm, requireResetPhrase }) {
    el('confirmTitle').textContent = title;
    el('confirmMessage').textContent = message;
    el('confirmExtraField').style.display = requireResetPhrase ? 'block' : 'none';
    el('confirmResetInput').value = '';
    confirmCallback = onConfirm;
    el('confirmModal').classList.add('open');
    el('confirmModal').dataset.requirePhrase = requireResetPhrase ? '1' : '0';
  }

  function wireConfirmModal() {
    el('confirmCancelBtn').addEventListener('click', () => el('confirmModal').classList.remove('open'));
    el('confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') el('confirmModal').classList.remove('open'); });
    el('confirmOkBtn').addEventListener('click', async () => {
      const requirePhrase = el('confirmModal').dataset.requirePhrase === '1';
      const extra = requirePhrase ? el('confirmResetInput').value.trim() : undefined;
      if (requirePhrase && extra !== 'RESET') {
        toast('Please type RESET exactly to confirm.', 'error');
        return;
      }
      try {
        await confirmCallback(extra);
      } catch (err) {
        toast(err.message, 'error');
      }
      el('confirmModal').classList.remove('open');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
