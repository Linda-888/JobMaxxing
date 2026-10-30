const $ = id => document.getElementById(id);
const savedKey = 'jobmaxxing-pages-saved-v1';
const guideKey = 'jobmaxxing-pages-guide-v1';
const state = { jobs: [], saved: new Map(), limit: 30, matchIds: null, resumeMatches: [] };

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch (_) { return null; }
}
function storedValue(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function saveValue(key, value) { try { localStorage.setItem(key, value); return true; } catch (_) { return false; } }
function humanDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? 'Date not listed' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function empty(message) { return el('div', 'empty-state', message); }

function restoreSaved() {
  try {
    const entries = JSON.parse(storedValue(savedKey) || '[]');
    if (!Array.isArray(entries)) return;
    for (const job of entries.slice(0, 200)) {
      if (job && typeof job.id === 'string' && typeof job.title === 'string' && safeUrl(job.url))
        state.saved.set(job.id, job);
    }
  } catch (_) { /* Browser storage may be unavailable or malformed. */ }
}
function persistSaved() {
  if (!saveValue(savedKey, JSON.stringify([...state.saved.values()])))
    document.querySelector('.saved-note').textContent = 'Saved jobs are visible for this visit, but browser storage is unavailable.';
}
function toggleSaved(job) {
  if (state.saved.has(job.id)) state.saved.delete(job.id);
  else state.saved.set(job.id, job);
  persistSaved();
  renderSaved();
  renderJobs();
}

function jobCard(job, reason = '') {
  const card = el('article', 'job-card');
  const head = el('div', 'job-head');
  head.append(el('span', 'company-tag', job.company || 'Employer'));
  const save = el('button', 'save-job', state.saved.has(job.id) ? '♥' : '♡');
  save.type = 'button';
  save.setAttribute('aria-label', state.saved.has(job.id) ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`);
  save.setAttribute('aria-pressed', String(state.saved.has(job.id)));
  save.addEventListener('click', () => toggleSaved(job));
  head.append(save);
  card.append(head, el('h3', '', job.title || 'Untitled role'));
  card.append(el('p', 'job-meta', [job.location || 'Location not listed', job.job_type !== 'Not specified' ? job.job_type : '',
    ['Remote', 'Hybrid', 'On-site'].includes(job.workplace) ? job.workplace : ''].filter(Boolean).join(' · ')));
  if (job.summary) card.append(el('p', 'job-summary', String(job.summary).slice(0, 230)));
  if (reason) card.append(el('p', 'job-match-reason', reason));
  if (job.posted_at && Date.now() - Date.parse(job.posted_at) > 365 * 24 * 60 * 60 * 1000)
    card.append(el('p', 'job-age-warning', 'Posted over a year ago · verify that it is still open.'));
  const foot = el('div', 'job-foot');
  foot.append(el('span', '', `${job.source || 'Employer'} · ${humanDate(job.posted_at)}`));
  const url = safeUrl(job.url);
  if (url) {
    const link = el('a', '', 'View original ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.append(link);
  }
  card.append(foot);
  return card;
}

function currentJobs() {
  const filtered = PagesMatcher.filterJobs(state.jobs, {
    query: $('search').value,
    type: $('type-filter').value,
    workplace: $('workplace-filter').value,
    early: $('early-filter').checked,
  });
  return state.matchIds ? filtered.filter(job => state.matchIds.has(job.id)) : filtered;
}
function renderJobs() {
  const list = $('job-list');
  list.replaceChildren();
  if (!state.jobs.length) return;
  const jobs = currentJobs();
  const fragment = document.createDocumentFragment();
  const reasons = new Map(state.resumeMatches.map(match => [match.job.id, match.reasons.join(' · ')]));
  for (const job of jobs.slice(0, state.limit)) fragment.append(jobCard(job, state.matchIds ? reasons.get(job.id) || '' : ''));
  list.append(fragment);
  if (!jobs.length) list.append(empty('No jobs match those choices in this snapshot. Try a broader search or check another day.'));
  $('results-count').textContent = `${jobs.length} public ${jobs.length === 1 ? 'job' : 'jobs'}${jobs.length > state.limit ? ` · showing ${state.limit}` : ''}`;
  $('show-more').hidden = jobs.length <= state.limit;
  $('match-filter-banner').hidden = !state.matchIds;
}
function renderSaved() {
  $('saved-count').textContent = String(state.saved.size);
  const list = $('saved-list');
  list.replaceChildren();
  if (!state.saved.size) { list.append(empty('No saved jobs yet. Choose the heart on any job to add it here.')); return; }
  const current = new Map(state.jobs.map(job => [job.id, job]));
  for (const stored of [...state.saved.values()].reverse()) {
    const job = current.get(stored.id) || stored;
    list.append(jobCard(job, current.has(stored.id) ? '' : 'Not in the latest snapshot · verify that this posting is still open.'));
  }
}

async function loadJobs() {
  try {
    const response = await fetch('jobs.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('The public job snapshot is unavailable right now.');
    const snapshot = await response.json();
    if (!Array.isArray(snapshot.jobs) || !snapshot.jobs.length) throw new Error('The public job snapshot is empty.');
    state.jobs = snapshot.jobs.filter(job => job && typeof job.id === 'string' && safeUrl(job.url));
    const checked = new Date(snapshot.checked_at || '');
    const date = Number.isNaN(checked.getTime()) ? 'date unknown' : checked.toLocaleString();
    const available = Array.isArray(snapshot.sources) ? snapshot.sources.filter(source => source.status !== 'unavailable').length : null;
    const total = Array.isArray(snapshot.sources) ? snapshot.sources.length : null;
    const age = Number.isNaN(checked.getTime()) ? Infinity : Date.now() - checked.getTime();
    $('snapshot-status').textContent = `Snapshot checked ${date}${available === null ? '' : ` · ${available}/${total} sources reached`}${age > 48 * 60 * 60 * 1000 ? ' · may be outdated' : ''}`;
    renderJobs();
    renderSaved();
  } catch (error) {
    $('results-count').textContent = 'Jobs are temporarily unavailable';
    $('snapshot-status').textContent = error.message;
    $('job-list').replaceChildren(empty('We could not load the public job snapshot. Please try again later.'));
  }
}

function runResumeMatch() {
  const text = $('resume-text').value.trim();
  if (!text) { $('resume-status').textContent = 'Add resume text or a TXT file first.'; return; }
  if (!state.jobs.length) { $('resume-status').textContent = 'Job listings are unavailable right now. Please try again later.'; return; }
  const result = PagesMatcher.matchResume(state.jobs, text);
  state.resumeMatches = result.matches;
  const signalBox = $('match-signals');
  signalBox.replaceChildren();
  for (const signal of [...result.signals.roles, ...result.signals.skills].slice(0, 12)) signalBox.append(el('span', '', signal));
  const list = $('match-list');
  list.replaceChildren();
  if (!result.signals.roles.length && !result.signals.skills.length) {
    $('match-intro').textContent = 'No supported role or skill phrase was found. Add more detail about your work, projects, or tools.';
    $('resume-status').textContent = 'No matching signals found in that text.';
  } else if (!result.matches.length) {
    $('match-intro').textContent = 'We found signals in your resume, but no related role in this snapshot. Try again after the job snapshot refreshes.';
    $('resume-status').textContent = 'No related jobs found in this snapshot.';
  } else {
    $('match-intro').textContent = `${result.matches.length} related ${result.matches.length === 1 ? 'role' : 'roles'} based on visible keywords. Review requirements on the employer site.`;
    $('resume-status').textContent = `Found ${result.matches.length} possible ${result.matches.length === 1 ? 'match' : 'matches'}. Nothing was uploaded or saved.`;
    for (const match of result.matches.slice(0, 8)) {
      const row = el('div', 'match-row');
      row.append(el('strong', '', match.job.title), el('small', '', `${match.job.company} · ${match.job.location}`),
        el('p', '', match.reasons.join(' · ')));
      const link = el('a', '', 'View original ↗');
      link.href = safeUrl(match.job.url);
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      row.append(link);
      list.append(row);
    }
  }
  $('browse-matches').hidden = !result.matches.length;
}

function clearResume() {
  $('resume-text').value = '';
  $('resume-file').value = '';
  state.resumeMatches = [];
  state.matchIds = null;
  $('match-signals').replaceChildren();
  $('match-list').replaceChildren();
  $('match-intro').textContent = 'Add resume text to see suggestions here.';
  $('resume-status').textContent = 'Resume text removed from this page.';
  $('browse-matches').hidden = true;
  renderJobs();
}
async function readResume(file) {
  if (!file) return;
  if (!/\.txt$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
    $('resume-status').textContent = 'Choose one TXT resume up to 5 MB. PDF and DOCX are not supported here.';
    return;
  }
  try {
    $('resume-text').value = (await file.text()).slice(0, 30000);
    $('resume-status').textContent = `Reading ${file.name} in this browser…`;
    runResumeMatch();
  } catch (_) { $('resume-status').textContent = 'Could not read that TXT file.'; }
}

const tourSteps = [
  { target: 'search-target', title: 'Search public jobs', description: 'Search by role, employer, or city. Use the filters to narrow this regularly refreshed snapshot.' },
  { target: 'resume-target', title: 'Match resume text', description: 'Drop a TXT file or paste resume text. Matching happens only in your browser; no AI or server reads the file.' },
  { target: 'saved-nav', title: 'Keep a shortlist', description: 'Tap a heart on any job, then open Saved jobs here. Your list stays in this browser.' },
];
let tourIndex = -1;
function positionTour() {
  if (tourIndex < 0) return;
  const target = $(tourSteps[tourIndex].target);
  const rect = target.getBoundingClientRect();
  const card = document.querySelector('.tour-card');
  const width = card.offsetWidth, height = card.offsetHeight, gap = 17;
  let left = rect.right + gap;
  let top = rect.top;
  if (left + width > window.innerWidth - 12) left = rect.left - width - gap;
  if (left < 12) { left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)); top = rect.bottom + gap; }
  if (top + height > window.innerHeight - 12) top = rect.top - height - gap;
  card.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
  card.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
}
function showTourStep(index) {
  document.querySelectorAll('.tour-target').forEach(node => node.classList.remove('tour-target'));
  tourIndex = index;
  const step = tourSteps[index], target = $(step.target);
  $('tour-step').textContent = `Step ${index + 1} of ${tourSteps.length}`;
  $('tour-title').textContent = step.title;
  $('tour-description').textContent = step.description;
  $('tour-back').hidden = index === 0;
  $('tour-next').textContent = index === tourSteps.length - 1 ? 'Finish ✓' : 'Next →';
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  target.classList.add('tour-target');
  requestAnimationFrame(() => { positionTour(); $('tour-title').focus(); });
}
function startTour() { $('tour').hidden = false; showTourStep(0); }
function closeTour() {
  $('tour').hidden = true;
  document.querySelectorAll('.tour-target').forEach(node => node.classList.remove('tour-target'));
  tourIndex = -1;
  saveValue(guideKey, '1');
  $('tour-open').focus();
}

restoreSaved();
renderSaved();
loadJobs();
$('search').addEventListener('input', () => { state.limit = 30; renderJobs(); });
for (const id of ['type-filter', 'workplace-filter', 'early-filter']) $(id).addEventListener('change', () => { state.limit = 30; renderJobs(); });
$('show-more').addEventListener('click', () => { state.limit += 30; renderJobs(); });
document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => {
  $('search').value = button.dataset.query;
  state.matchIds = null;
  state.limit = 30;
  renderJobs();
  $('discover').scrollIntoView({ block: 'start' });
}));
$('match-resume').addEventListener('click', runResumeMatch);
$('clear-resume').addEventListener('click', clearResume);
$('resume-file').addEventListener('change', event => readResume(event.target.files[0]));
$('resume-target').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('resume-file').click(); } });
$('resume-target').addEventListener('dragover', event => { event.preventDefault(); $('resume-target').classList.add('is-dragging'); });
$('resume-target').addEventListener('dragleave', () => $('resume-target').classList.remove('is-dragging'));
$('resume-target').addEventListener('drop', event => {
  event.preventDefault(); $('resume-target').classList.remove('is-dragging');
  if (event.dataTransfer.files.length !== 1) { $('resume-status').textContent = 'Drop one TXT file at a time.'; return; }
  readResume(event.dataTransfer.files[0]);
});
$('browse-matches').addEventListener('click', () => {
  state.matchIds = new Set(state.resumeMatches.map(match => match.job.id));
  $('search').value = ''; $('type-filter').value = ''; $('workplace-filter').value = ''; $('early-filter').checked = false;
  state.limit = 30;
  renderJobs();
  $('discover').scrollIntoView({ block: 'start' });
});
$('clear-match-filter').addEventListener('click', () => { state.matchIds = null; renderJobs(); });
$('tour-open').addEventListener('click', startTour);
$('tour-skip').addEventListener('click', closeTour);
$('tour-back').addEventListener('click', () => showTourStep(tourIndex - 1));
$('tour-next').addEventListener('click', () => tourIndex === tourSteps.length - 1 ? closeTour() : showTourStep(tourIndex + 1));
window.addEventListener('keydown', event => { if (event.key === 'Escape' && tourIndex >= 0) closeTour(); });
window.addEventListener('resize', positionTour);
window.addEventListener('load', () => { if (storedValue(guideKey) !== '1') startTour(); });
