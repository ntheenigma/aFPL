/* =====================================================
   aFPL — Ultra-lightweight FPL Client
   Pure vanilla JS, no frameworks, no dependencies.
   ===================================================== */

// --- State ---
const state = {
  teamId: localStorage.getItem('afpl_teamId') || null,
  currentGW: null,
  currentView: 'landing',
  bootstrap: null,
  picks: null,
  entry: null,
  history: null,
  liveData: null,
  fixtures: null,
  playersPage: 0,
  playersPerPage: 50,
  sortedPlayers: [],
};

// --- Team Colors (shirt colors per team) ---
const teamColors = {
  1: '#EF0107',   // Arsenal
  2: '#670E36',   // Aston Villa
  3: '#DA291C',   // Bournemouth
  4: '#0057B8',   // Brentford
  5: '#0057B8',   // Brighton
  6: '#034694',   // Chelsea
  7: '#1B458F',   // Crystal Palace
  8: '#003399',   // Everton
  9: '#FFFFFF',   // Fulham
  10: '#E8112D',  // Ipswich
  11: '#003090',  // Leicester
  12: '#C8102E',  // Liverpool
  13: '#6CABDD',  // Man City
  14: '#DA291C',  // Man Utd
  15: '#241F20',  // Newcastle
  16: '#E53233',  // Nott'm Forest
  17: '#EE2737',  // Southampton
  18: '#132257',  // Spurs
  19: '#1C2D5A',  // West Ham
  20: '#FDB913',  // Wolves
};

const posNames = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// --- API Base ---
// When running as a native Capacitor app, point to deployed backend.
// Set window.AFPL_API_BASE before app.js loads, or it defaults to '' (same origin).
const API_BASE = window.AFPL_API_BASE || '';

// --- Utility Functions ---
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function showLoader() { $('#loader').classList.remove('hidden'); }
function hideLoader() { $('#loader').classList.add('hidden'); }

async function api(path) {
  const res = await fetch(`${API_BASE}/api${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function formatPrice(cost) { return (cost / 10).toFixed(1); }

function getTeamName(id) {
  if (!state.bootstrap) return '';
  const team = state.bootstrap.teams.find(t => t.id === id);
  return team ? team.short_name : '';
}

function getTeamFullName(id) {
  if (!state.bootstrap) return '';
  const team = state.bootstrap.teams.find(t => t.id === id);
  return team ? team.name : '';
}

function getPlayer(id) {
  if (!state.bootstrap) return null;
  return state.bootstrap.elements.find(p => p.id === id);
}

function getCurrentGW() {
  if (!state.bootstrap) return 1;
  const current = state.bootstrap.events.find(e => e.is_current);
  return current ? current.id : 1;
}

function getGWInfo(gw) {
  if (!state.bootstrap) return null;
  return state.bootstrap.events.find(e => e.id === gw);
}

// --- Init ---
async function init() {
  showLoader();
  try {
    state.bootstrap = await api('/bootstrap-static/');
    state.currentGW = getCurrentGW();
    updateGWBar();

    if (state.teamId) {
      $('#teamIdInput').value = state.teamId;
      await loadTeamData();
      switchView('pitch');
    }

    // Setup event listeners
    $('#teamIdInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') loadTeam();
    });
    $('#playerSearch').addEventListener('input', debounce(filterPlayers, 200));
    $('#playerPosFilter').addEventListener('change', filterPlayers);
    $('#playerSort').addEventListener('change', filterPlayers);

    // Click outside modal to close
    $('#playerModal').addEventListener('click', (e) => {
      if (e.target === $('#playerModal')) closeModal();
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  } catch (e) {
    console.error('Init failed:', e);
  }
  hideLoader();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// --- Team Loading ---
async function loadTeam() {
  const input = $('#teamIdInput').value.trim();
  if (!input || isNaN(input)) return;
  state.teamId = input;
  localStorage.setItem('afpl_teamId', input);
  showLoader();
  try {
    await loadTeamData();
    switchView('pitch');
  } catch (e) {
    alert('Could not find team. Check the ID and try again.');
  }
  hideLoader();
}

async function loadTeamData() {
  const [entry, picks, history] = await Promise.all([
    api(`/entry/${state.teamId}/`),
    api(`/entry/${state.teamId}/event/${state.currentGW}/picks/`).catch(() => null),
    api(`/entry/${state.teamId}/history/`).catch(() => null),
  ]);
  state.entry = entry;
  state.picks = picks;
  state.history = history;

  // Load live data for points
  try {
    state.liveData = await api(`/event/${state.currentGW}/live/`);
  } catch (e) {
    state.liveData = null;
  }

  renderTeam();
  renderPoints();
  renderLeagues();
}

// --- View Switching ---
function switchView(view) {
  state.currentView = view;

  // Update nav
  $$('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // Update views
  $$('.view').forEach(v => v.classList.remove('active'));

  if (view === 'pitch' || view === 'points' || view === 'leagues') {
    if (!state.teamId) {
      $('#landing').classList.add('active');
      return;
    }
  }

  switch (view) {
    case 'pitch':
      $('#pitchView').classList.add('active');
      $('#gwBar').classList.remove('hidden');
      break;
    case 'points':
      $('#pointsView').classList.add('active');
      $('#gwBar').classList.remove('hidden');
      break;
    case 'players':
      $('#playersView').classList.add('active');
      $('#gwBar').classList.add('hidden');
      if (state.sortedPlayers.length === 0) filterPlayers();
      break;
    case 'fixtures':
      $('#fixturesView').classList.add('active');
      $('#gwBar').classList.add('hidden');
      if (!state.fixtures) loadFixtures();
      break;
    case 'leagues':
      $('#leaguesView').classList.add('active');
      $('#gwBar').classList.add('hidden');
      break;
    default:
      $('#landing').classList.add('active');
      $('#gwBar').classList.add('hidden');
  }
}

// --- Gameweek Navigation ---
function updateGWBar() {
  const info = getGWInfo(state.currentGW);
  $('#gwLabel').textContent = `Gameweek ${state.currentGW}`;
  if (info) {
    const status = info.finished ? 'Complete' : info.is_current ? 'Live' : 'Upcoming';
    $('#gwMeta').textContent = status;
  }
}

async function changeGW(delta) {
  const newGW = state.currentGW + delta;
  if (newGW < 1 || newGW > 38) return;
  state.currentGW = newGW;
  updateGWBar();

  if (state.teamId) {
    showLoader();
    try {
      const [picks, liveData] = await Promise.all([
        api(`/entry/${state.teamId}/event/${state.currentGW}/picks/`).catch(() => null),
        api(`/event/${state.currentGW}/live/`).catch(() => null),
      ]);
      state.picks = picks;
      state.liveData = liveData;
      renderTeam();
      renderPoints();
    } catch (e) {
      console.error('GW change error:', e);
    }
    hideLoader();
  }
}

// --- Render Team (Pitch) ---
function renderTeam() {
  if (!state.entry || !state.picks) return;

  $('#teamName').textContent = state.entry.name;
  $('#teamMeta').innerHTML = `
    <span>Manager: <span class="value">${state.entry.player_first_name} ${state.entry.player_last_name}</span></span>
    <span>Overall: <span class="value">${(state.entry.summary_overall_rank || '-').toLocaleString()}</span></span>
    <span>Total Pts: <span class="value">${state.entry.summary_overall_points || 0}</span></span>
    <span>Squad Value: <span class="value">&pound;${formatPrice(state.picks.entry_history?.value || 0)}m</span></span>
    <span>Bank: <span class="value">&pound;${formatPrice(state.picks.entry_history?.bank || 0)}m</span></span>
  `;

  const picks = state.picks.picks || [];
  const starters = picks.filter(p => p.position <= 11);
  const bench = picks.filter(p => p.position > 11);

  // Group by position
  const rows = { GKP: [], DEF: [], MID: [], FWD: [] };
  starters.forEach(pick => {
    const player = getPlayer(pick.element);
    if (player) {
      const pos = posNames[player.element_type];
      rows[pos].push({ pick, player });
    }
  });

  // Render each row
  Object.keys(rows).forEach(pos => {
    const container = $(`#row-${pos}`);
    container.innerHTML = rows[pos].map(({ pick, player }) => playerCardHTML(player, pick)).join('');
  });

  // Render bench
  const benchContainer = $('#benchPlayers');
  benchContainer.innerHTML = bench.map(pick => {
    const player = getPlayer(pick.element);
    return player ? playerCardHTML(player, pick) : '';
  }).join('');
}

function playerCardHTML(player, pick) {
  const points = getPlayerLivePoints(player.id);
  const teamColor = teamColors[player.team] || '#666';
  const captainClass = pick.is_captain ? 'captain' : pick.is_vice_captain ? 'vice-captain' : '';
  const initial = player.web_name.charAt(0);

  return `
    <div class="player-card" onclick="showPlayerDetail(${player.id})">
      <div class="player-shirt ${captainClass}" style="background:${teamColor}">${initial}</div>
      <div class="player-name">${player.web_name}</div>
      <div class="player-pts">${points !== null ? (pick.is_captain ? points * pick.multiplier : points) : '-'}</div>
    </div>
  `;
}

function getPlayerLivePoints(playerId) {
  if (!state.liveData) return null;
  const el = state.liveData.elements.find(e => e.id === playerId);
  return el ? el.stats.total_points : null;
}

// --- Render Points ---
function renderPoints() {
  if (!state.picks || !state.liveData) return;

  const picks = state.picks.picks || [];
  const eh = state.picks.entry_history || {};
  let gwPoints = 0;

  const rows = picks.map(pick => {
    const player = getPlayer(pick.element);
    if (!player) return '';
    const liveEl = state.liveData.elements.find(e => e.id === pick.element);
    const stats = liveEl ? liveEl.stats : {};
    const pts = (stats.total_points || 0) * pick.multiplier;
    if (pick.position <= 11) gwPoints += pts;

    return `<tr>
      <td><span class="player-link" onclick="showPlayerDetail(${player.id})">${player.web_name}${pick.is_captain ? ' (C)' : pick.is_vice_captain ? ' (V)' : ''}</span></td>
      <td>${posNames[player.element_type]}</td>
      <td class="fw-bold ${pts > 0 ? 'text-green' : pts < 0 ? 'text-red' : ''}">${pts}</td>
      <td>${stats.minutes || 0}</td>
      <td>${stats.goals_scored || 0}</td>
      <td>${stats.assists || 0}</td>
      <td>${stats.clean_sheets || 0}</td>
      <td>${stats.bps || 0}</td>
    </tr>`;
  });

  $('#pointsSummary').innerHTML = `
    <div class="stat-card highlight">
      <div class="stat-value">${gwPoints}</div>
      <div class="stat-label">GW${state.currentGW} Points</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${state.entry.summary_overall_points || 0}</div>
      <div class="stat-label">Total Points</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${(state.entry.summary_overall_rank || '-').toLocaleString()}</div>
      <div class="stat-label">Overall Rank</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${eh.event_transfers || 0}</div>
      <div class="stat-label">GW Transfers</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${eh.event_transfers_cost || 0}</div>
      <div class="stat-label">Hit Cost</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">&pound;${formatPrice(eh.value || 0)}m</div>
      <div class="stat-label">Team Value</div>
    </div>
  `;

  $('#pointsBody').innerHTML = rows.join('');
}

// --- Players View ---
function filterPlayers() {
  if (!state.bootstrap) return;

  const search = ($('#playerSearch').value || '').toLowerCase();
  const pos = parseInt($('#playerPosFilter').value);
  const sortKey = $('#playerSort').value;

  let players = [...state.bootstrap.elements];

  // Filter
  if (search) players = players.filter(p => p.web_name.toLowerCase().includes(search) || getTeamName(p.team).toLowerCase().includes(search));
  if (pos > 0) players = players.filter(p => p.element_type === pos);

  // Sort
  players.sort((a, b) => {
    const av = parseFloat(a[sortKey]) || 0;
    const bv = parseFloat(b[sortKey]) || 0;
    return bv - av;
  });

  state.sortedPlayers = players;
  state.playersPage = 0;
  renderPlayers();
}

function renderPlayers() {
  const start = 0;
  const end = (state.playersPage + 1) * state.playersPerPage;
  const visible = state.sortedPlayers.slice(start, end);

  const html = visible.map(p => `
    <tr>
      <td><span class="player-link" onclick="showPlayerDetail(${p.id})">${p.web_name}</span></td>
      <td>${getTeamName(p.team)}</td>
      <td>${posNames[p.element_type]}</td>
      <td>&pound;${formatPrice(p.now_cost)}</td>
      <td class="fw-bold">${p.total_points}</td>
      <td>${p.form}</td>
      <td>${p.selected_by_percent}%</td>
      <td>${p.points_per_game}</td>
    </tr>
  `).join('');

  $('#playersBody').innerHTML = html;
  $('#playersLoadMore').classList.toggle('hidden', end >= state.sortedPlayers.length);
}

function loadMorePlayers() {
  state.playersPage++;
  renderPlayers();
}

// --- Fixtures ---
async function loadFixtures() {
  showLoader();
  try {
    state.fixtures = await api('/fixtures/');
    renderFixtures();
  } catch (e) {
    console.error('Fixtures error:', e);
  }
  hideLoader();
}

function renderFixtures() {
  if (!state.fixtures) return;

  // Group by gameweek
  const grouped = {};
  state.fixtures.forEach(f => {
    const gw = f.event || 0;
    if (!grouped[gw]) grouped[gw] = [];
    grouped[gw].push(f);
  });

  let html = '';
  // Show current and next few GWs first
  const gwKeys = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  // Find the current GW index and show from 2 before to all after
  const currentIdx = gwKeys.indexOf(state.currentGW);
  const startIdx = Math.max(0, currentIdx - 1);
  const displayGWs = gwKeys.slice(startIdx);

  displayGWs.forEach(gw => {
    if (gw === 0) return;
    const gwInfo = getGWInfo(gw);
    const label = gwInfo ? (gwInfo.finished ? '(Complete)' : gwInfo.is_current ? '(Live)' : '') : '';
    html += `<div class="fixture-gw-header">Gameweek ${gw} ${label}</div>`;

    grouped[gw].forEach(f => {
      const home = getTeamFullName(f.team_h);
      const away = getTeamFullName(f.team_a);
      let score;
      if (f.started) {
        score = `${f.team_h_score ?? 0} - ${f.team_a_score ?? 0}`;
      } else {
        const dt = new Date(f.kickoff_time);
        score = `<span class="fixture-time">${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}<br>${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>`;
      }
      html += `
        <div class="fixture-card">
          <div class="fixture-home">${home}</div>
          <div class="fixture-score">${score}</div>
          <div class="fixture-away">${away}</div>
        </div>
      `;
    });
  });

  $('#fixturesList').innerHTML = html;
}

// --- Leagues ---
function renderLeagues() {
  if (!state.entry) return;
  const leagues = state.entry.leagues?.classic || [];

  const html = leagues.map(l => `
    <div class="league-card" onclick="loadLeagueStandings(${l.id}, '${l.name.replace(/'/g, "\\'")}')">
      <span class="league-name">${l.name}</span>
      <span class="league-rank">Rank <strong>${l.entry_rank?.toLocaleString() || '-'}</strong></span>
    </div>
  `).join('');

  $('#leaguesList').innerHTML = html;
  $('#leagueStandings').classList.add('hidden');
}

async function loadLeagueStandings(leagueId, name) {
  showLoader();
  try {
    const data = await api(`/leagues-classic/${leagueId}/standings/`);
    const results = data.standings?.results || [];

    let html = `
      <h3>
        <button class="league-back" onclick="backToLeagues()">&larr; Back</button>
        ${name}
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team</th>
            <th>Manager</th>
            <th>GW</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
    `;

    results.forEach(r => {
      const isMe = r.entry === parseInt(state.teamId);
      html += `<tr style="${isMe ? 'background:rgba(0,255,135,0.1);font-weight:700;' : ''}">
        <td>${r.rank}</td>
        <td>${r.entry_name}</td>
        <td>${r.player_name}</td>
        <td>${r.event_total || 0}</td>
        <td class="fw-bold">${r.total}</td>
      </tr>`;
    });

    html += '</tbody></table>';

    $('#leagueStandings').innerHTML = html;
    $('#leagueStandings').classList.remove('hidden');
    $('#leaguesList').classList.add('hidden');
  } catch (e) {
    console.error('League error:', e);
  }
  hideLoader();
}

function backToLeagues() {
  $('#leagueStandings').classList.add('hidden');
  $('#leaguesList').classList.remove('hidden');
}

// --- Player Detail Modal ---
async function showPlayerDetail(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;

  const modal = $('#playerModal');
  const detail = $('#playerDetail');
  const teamColor = teamColors[player.team] || '#666';

  // Show immediately with what we have
  detail.innerHTML = `
    <div class="player-detail-header">
      <div class="player-shirt" style="background:${teamColor};width:56px;height:56px;font-size:1.2rem">${player.web_name.charAt(0)}</div>
      <div class="player-detail-info">
        <h3>${player.first_name} ${player.second_name}</h3>
        <p>${getTeamFullName(player.team)} &middot; ${posNames[player.element_type]} &middot; &pound;${formatPrice(player.now_cost)}m</p>
      </div>
    </div>
    <div class="player-stats-grid">
      <div class="player-stat"><div class="val">${player.total_points}</div><div class="lbl">Total Pts</div></div>
      <div class="player-stat"><div class="val">${player.form}</div><div class="lbl">Form</div></div>
      <div class="player-stat"><div class="val">${player.points_per_game}</div><div class="lbl">PPG</div></div>
      <div class="player-stat"><div class="val">${player.goals_scored}</div><div class="lbl">Goals</div></div>
      <div class="player-stat"><div class="val">${player.assists}</div><div class="lbl">Assists</div></div>
      <div class="player-stat"><div class="val">${player.clean_sheets}</div><div class="lbl">CS</div></div>
      <div class="player-stat"><div class="val">${player.minutes}</div><div class="lbl">Minutes</div></div>
      <div class="player-stat"><div class="val">${player.selected_by_percent}%</div><div class="lbl">Owned</div></div>
      <div class="player-stat"><div class="val">${player.ict_index}</div><div class="lbl">ICT</div></div>
      <div class="player-stat"><div class="val">${player.influence}</div><div class="lbl">Influence</div></div>
      <div class="player-stat"><div class="val">${player.creativity}</div><div class="lbl">Creativity</div></div>
      <div class="player-stat"><div class="val">${player.threat}</div><div class="lbl">Threat</div></div>
      <div class="player-stat"><div class="val">${player.bonus}</div><div class="lbl">Bonus</div></div>
      <div class="player-stat"><div class="val">${player.bps}</div><div class="lbl">BPS</div></div>
      <div class="player-stat"><div class="val">${player.yellow_cards}</div><div class="lbl">Yellows</div></div>
      <div class="player-stat"><div class="val">${player.red_cards}</div><div class="lbl">Reds</div></div>
      <div class="player-stat"><div class="val">${player.saves}</div><div class="lbl">Saves</div></div>
      <div class="player-stat"><div class="val">${player.penalties_saved}</div><div class="lbl">Pen Saves</div></div>
    </div>
    <p class="text-muted" style="font-size:0.8rem;">Loading history...</p>
  `;
  modal.classList.remove('hidden');

  // Fetch detailed history
  try {
    const summary = await api(`/element-summary/${playerId}/`);
    const history = summary.history || [];
    const upcoming = summary.fixtures || [];

    let historyHTML = '<h4 style="margin:12px 0 8px;color:var(--purple);">Gameweek History</h4>';
    if (history.length > 0) {
      historyHTML += `
        <table class="player-history-table">
          <thead><tr><th>GW</th><th>Opp</th><th>Pts</th><th>Min</th><th>G</th><th>A</th><th>CS</th><th>BPS</th></tr></thead>
          <tbody>
      `;
      // Show last 10 gameweeks
      history.slice(-10).reverse().forEach(h => {
        const oppTeam = getTeamName(h.opponent_team);
        const ha = h.was_home ? '(H)' : '(A)';
        historyHTML += `<tr>
          <td>GW${h.round}</td>
          <td>${oppTeam} ${ha}</td>
          <td class="fw-bold">${h.total_points}</td>
          <td>${h.minutes}</td>
          <td>${h.goals_scored}</td>
          <td>${h.assists}</td>
          <td>${h.clean_sheets}</td>
          <td>${h.bps}</td>
        </tr>`;
      });
      historyHTML += '</tbody></table>';
    }

    if (upcoming.length > 0) {
      historyHTML += '<h4 style="margin:16px 0 8px;color:var(--purple);">Upcoming Fixtures</h4>';
      historyHTML += '<table class="player-history-table"><thead><tr><th>GW</th><th>Opponent</th><th>Difficulty</th></tr></thead><tbody>';
      upcoming.slice(0, 5).forEach(f => {
        const oppTeam = f.is_home ? getTeamName(f.team_a) : getTeamName(f.team_h);
        const ha = f.is_home ? '(H)' : '(A)';
        const diff = f.difficulty;
        const diffColor = diff <= 2 ? 'var(--green-dark)' : diff >= 4 ? '#e74c3c' : 'var(--gray-600)';
        historyHTML += `<tr>
          <td>GW${f.event}</td>
          <td>${oppTeam} ${ha}</td>
          <td style="color:${diffColor};font-weight:700">${diff}</td>
        </tr>`;
      });
      historyHTML += '</tbody></table>';
    }

    // Replace loading message
    detail.querySelector('.text-muted')?.remove();
    detail.insertAdjacentHTML('beforeend', historyHTML);
  } catch (e) {
    detail.querySelector('.text-muted').textContent = 'Could not load player history.';
  }
}

function closeModal() {
  $('#playerModal').classList.add('hidden');
}

// --- Service Worker Registration ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// --- Boot ---
init();
