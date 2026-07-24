// public/js/awards.js
// Drives the voting page: renders categories/nominees, handles the phone
// verification + vote submission flow, and locks categories the current
// phone number has already voted in (persists across refresh/device via
// the server, cached locally just for a smoother UI).

(function () {
  const PHONE_KEY = 'awards_voter_phone';
  let categories = [];
  let votingOpen = true;
  let myVotes = {}; // category_id -> nominee_id
  let pendingVote = null; // { categoryId, nomineeId, nomineeName, categoryName }

  const el = (id) => document.getElementById(id);

  async function init() {
    document.getElementById('year').textContent = new Date().getFullYear();
    await loadBranding();
    await loadVotingStatus();
    await loadCategories();
    await loadMyVotesIfKnown();
    render();
    wireModal();
  }

  async function loadBranding() {
    try {
      const settings = await AwardsApp.apiFetch('/api/settings');
      document.getElementById('brandName').textContent = settings.event_name;
      document.title = 'Vote — ' + settings.event_name;
      if (settings.logo_url) document.getElementById('brandLogo').src = settings.logo_url;
      if (settings.primary_color) document.documentElement.style.setProperty('--primary', settings.primary_color);
    } catch (e) { /* use defaults */ }
  }

  async function loadVotingStatus() {
    try {
      const status = await AwardsApp.apiFetch('/api/votes/status');
      votingOpen = status.voting_open;
      const msg = document.getElementById('votingStatusMsg');
      if (!votingOpen) {
        msg.textContent = 'Voting is currently closed. Check back soon!';
      }
    } catch (e) {
      votingOpen = false;
    }
  }

  async function loadCategories() {
    try {
      categories = await AwardsApp.apiFetch('/api/categories');
    } catch (e) {
      AwardsApp.toast('Failed to load categories. Please refresh.', 'error');
      categories = [];
    }
  }

  async function loadMyVotesIfKnown() {
    const savedPhone = localStorage.getItem(PHONE_KEY);
    if (!savedPhone) return;
    try {
      const res = await AwardsApp.apiFetch('/api/votes/my-votes?phone=' + encodeURIComponent(savedPhone));
      myVotes = {};
      res.votes.forEach(v => { myVotes[v.category_id] = v.nominee_id; });
    } catch (e) { /* ignore — will just re-ask for phone on vote */ }
  }

  function render() {
    const container = el('categoriesContainer');
    if (categories.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);">No award categories have been published yet. Check back soon!</p>';
      return;
    }

    container.innerHTML = categories.map(cat => {
      const votedNomineeId = myVotes[cat.id];
      const hasVoted = votedNomineeId !== undefined;

      const nomineeCards = cat.nominees.map(nom => {
        const isSelected = hasVoted && Number(votedNomineeId) === nom.id;
        const photo = nom.photo_url
          ? `<img class="photo" src="${AwardsApp.escapeHtml(nom.photo_url)}" alt="${AwardsApp.escapeHtml(nom.name)}">`
          : `<div class="photo" style="display:flex;align-items:center;justify-content:center;font-size:2.4rem;color:white;">${AwardsApp.escapeHtml(nom.name.charAt(0))}</div>`;

        const buttonLabel = isSelected ? '✓ Your Vote' : 'Vote';
        const buttonDisabled = (!votingOpen || hasVoted);

        return `
          <div class="nominee-card ${isSelected ? 'selected' : ''}">
            ${photo}
            <div class="body">
              <h3>${AwardsApp.escapeHtml(nom.name)}</h3>
              <p>${AwardsApp.escapeHtml(nom.bio || '')}</p>
              <button class="btn ${isSelected ? 'btn-accent' : 'btn-primary'} btn-full vote-btn"
                data-category-id="${cat.id}" data-category-name="${AwardsApp.escapeHtml(cat.name)}"
                data-nominee-id="${nom.id}" data-nominee-name="${AwardsApp.escapeHtml(nom.name)}"
                ${buttonDisabled ? 'disabled' : ''}>
                ${buttonLabel}
              </button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="category-block">
          <div class="category-header">
            <div>
              <h2>${AwardsApp.escapeHtml(cat.name)}</h2>
              <p>${AwardsApp.escapeHtml(cat.description || '')}</p>
            </div>
            ${hasVoted ? '<span class="badge badge-voted">✓ Voted</span>' : (!votingOpen ? '<span class="badge badge-closed">Closed</span>' : '')}
          </div>
          <div class="nominee-grid">${nomineeCards || '<p style="color:var(--text-muted);">No nominees yet.</p>'}</div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.vote-btn').forEach(btn => {
      btn.addEventListener('click', () => openVoteModal(btn.dataset));
    });
  }

  function openVoteModal(data) {
    pendingVote = {
      categoryId: Number(data.categoryId),
      categoryName: data.categoryName,
      nomineeId: Number(data.nomineeId),
      nomineeName: data.nomineeName
    };
    el('modalNomineeName').textContent = pendingVote.nomineeName;
    el('modalCategoryName').textContent = pendingVote.categoryName;
    el('phoneError').classList.remove('show');
    el('phoneInput').value = localStorage.getItem(PHONE_KEY) || '';
    el('modalStepPhone').style.display = 'block';
    el('modalStepSuccess').style.display = 'none';
    el('voteModal').classList.add('open');
    setTimeout(() => el('phoneInput').focus(), 100);
  }

  function closeModal() {
    el('voteModal').classList.remove('open');
    pendingVote = null;
  }

  function showPhoneError(msg) {
    const errEl = el('phoneError');
    errEl.textContent = msg;
    errEl.classList.add('show');
  }

  async function submitVote() {
    const phone = el('phoneInput').value.trim();
    if (!phone) return showPhoneError('Please enter your phone number.');
    if (!/^\+?\d{7,15}$/.test(phone.replace(/[\s\-()]/g, ''))) {
      return showPhoneError('Please enter a valid phone number (7–15 digits).');
    }

    const submitBtn = el('submitVoteBtn');
    submitBtn.disabled = true;
    el('submitVoteLabel').innerHTML = '<span class="spinner"></span> Submitting...';

    try {
      const result = await AwardsApp.apiFetch('/api/votes', {
        method: 'POST',
        body: { phone, category_id: pendingVote.categoryId, nominee_id: pendingVote.nomineeId }
      });

      localStorage.setItem(PHONE_KEY, phone.replace(/[\s\-()]/g, ''));
      myVotes[pendingVote.categoryId] = pendingVote.nomineeId;

      el('modalStepPhone').style.display = 'none';
      el('modalStepSuccess').style.display = 'block';
      el('successMessage').textContent = result.message;
      render();
    } catch (e) {
      showPhoneError(e.message || 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled = false;
      el('submitVoteLabel').textContent = 'Confirm Vote';
    }
  }

  function wireModal() {
    el('closeModalBtn').addEventListener('click', closeModal);
    el('cancelVoteBtn').addEventListener('click', closeModal);
    el('closeSuccessBtn').addEventListener('click', closeModal);
    el('submitVoteBtn').addEventListener('click', submitVote);
    el('voteModal').addEventListener('click', (e) => { if (e.target.id === 'voteModal') closeModal(); });
    el('phoneInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitVote(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
