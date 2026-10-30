const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const fields = ['role', 'skills', 'location', 'priorities'];
const guestKey = 'jobmaxxing-guest-v1';
const legacyGuestKey = 'resumemaxxing-guest-v1';
const guideSeenKey = 'jobmaxxing-site-guide-v1';
const legacyGuideSeenKey = 'resumemaxxing-site-guide-v1';
const guideSteps = [
  { title: 'AI chat', description: 'This AI bubble opens a career conversation. If AI is offline, a guided chat is still available.',
    screen: 'dashboard', view: 'discover', target: () => $('.dashboard-chat-action'), placement: ['top', 'left', 'right', 'bottom'] },
  { title: 'Resume Maxxing', description: 'Open Resume Maxxing to upload a PDF, DOCX, or TXT and see jobs related to your experience. You do not need to start a chat.',
    screen: 'dashboard', view: 'discover', target: () => window.matchMedia('(max-width: 650px)').matches ?
      $('.mobile-nav button[data-view="resume"]') : $('.side-nav[data-view="resume"]'),
    placement: ['right', 'top', 'bottom', 'left'] },
  { title: 'Search and filter', description: 'Search for a role, employer, or city. Use Filters to narrow the jobs you see.',
    screen: 'dashboard', view: 'discover', target: () => $('.toolbar-left'), placement: ['bottom', 'right', 'left', 'top'] },
  { title: 'Saved jobs', description: 'Open Saved to revisit jobs you kept. Check each employer posting before applying.',
    screen: 'dashboard', view: 'saved', target: () => window.matchMedia('(max-width: 650px)').matches ?
      $('.mobile-nav button[data-view="saved"]') : $('.side-nav[data-view="saved"]'),
    placement: ['right', 'top', 'bottom', 'left'] }
];
const discoverPageSize = 50;
const savedPageSize = 20;
const emptyProfile = () => ({ role: '', skills: '', location: '', priorities: '' });
const chatPathStarts = {
  directed: ["I have a direction", 'Great. What kind of work are you thinking about? You can mention a role, a place, or what matters to you.'],
  explore: ["I'm still exploring", "That's a good place to start. What have you enjoyed doing—helping people, making things, solving problems, or something else?"]
};
const isPathChoiceMessage = item => item.role === 'user' &&
  Object.values(chatPathStarts).some(([choice]) => item.content === choice);
const emptyDirection = () => ({ activities: [], job_type: '', school_year: '', workplace: '',
  location_rule: 'prefer', salary_min: 0, salary_period: 'year' });
function normalizedDirection(value) {
  const defaults = emptyDirection();
  if (!value || typeof value !== 'object') return defaults;
  return { ...defaults, ...value,
    activities: Array.isArray(value.activities) ? value.activities.filter(item =>
      ['build', 'design', 'research', 'analyze', 'teach', 'grow', 'organize'].includes(item)) : [],
    salary_min: Number.isFinite(Number(value.salary_min)) ? Number(value.salary_min) : 0 };
}
const state = { user: null, profile: { role: '', skills: '', location: '', priorities: '' }, messages: [],
  direction: emptyDirection(), directionBrowseActive: false, directionBrowseCriteria: null,
  directionMatchKey: '', directionMatchResults: [],
  chatMode: '',
  saved: new Set(), savedSnapshots: new Map(), jobs: [], checkedAt: null, sources: [], stale: false, ai: false, aiProvider: null, aiVerified: false, publicDemo: false,
  authMode: 'register', guestStage: 'onboarding', hasDiscovered: false, saveChoiceSeen: false, pendingSaveJob: null,
  view: 'discover', internshipYear: '', chatBrowseActive: false, chatBrowseSource: 'conversation', discoverLimit: discoverPageSize, savedLimit: savedPageSize, jobError: '',
  expandedDiscover: null, expandedSaved: null, details: new Map(),
  detailPending: new Set(), detailErrors: new Map(),
  aiMatches: new Map(), aiMatchStatus: '', aiMatchSignature: '', aiMatchRequest: 0,
  resumeName: '', resumeStatus: 'idle', resumeMatches: [], resumeSignals: { roles: [], skills: [] },
  resumePreferences: { job_type: null, location: null, workplace: null, role: null },
  resumeError: '', resumeNotice: '', resumeRequest: 0, resumeController: null };

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (_) {
    throw new Error(['127.0.0.1', 'localhost'].includes(window.location.hostname) ?
      'Cannot reach the local app server. Open http://127.0.0.1:8765/ and make sure the server is running.' :
      'The website is temporarily unavailable. Please try again later.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function showScreen(id) {
  $('#loading-screen').hidden = true;
  for (const screen of $$('.screen')) screen.hidden = screen.id !== id;
  window.scrollTo(0, 0);
}

let guideStep = 0;
let guideReturn = null;
function hasSeenGuide() {
  try { if ([guideSeenKey, legacyGuideSeenKey].some(key => localStorage.getItem(key) === '1')) return true; } catch (_) {}
  try { return [guideSeenKey, legacyGuideSeenKey].some(key => sessionStorage.getItem(key) === '1'); } catch (_) { return false; }
}
function rememberGuide() {
  try { localStorage.setItem(guideSeenKey, '1'); return; } catch (_) {}
  try { sessionStorage.setItem(guideSeenKey, '1'); } catch (_) {}
}
function renderGuide() {
  const step = guideSteps[guideStep];
  $('#guide-step-label').textContent = `Step ${guideStep + 1} of ${guideSteps.length}`;
  $('#guide-title').textContent = state.publicDemo && guideStep === 0 ? 'Career chat' : step.title;
  $('#guide-description').textContent = state.publicDemo && guideStep === 0 ?
    'This bubble opens a guided career conversation. Tell us what interests you to see possible jobs.' :
    state.publicDemo && guideStep === 1 ?
      'Open Resume Maxxing here to upload a PDF, DOCX, or TXT. Private AI compares your experience with current jobs, then discards the file; chat is optional.' : step.description;
  $$('.guide-dots span').forEach((dot, index) => dot.classList.toggle('active', index === guideStep));
  $('#guide-back').hidden = guideStep === 0;
  $('#guide-next').textContent = guideStep === guideSteps.length - 1 ? 'Finish' : 'Next →';
}
function showGuideSurface(step) {
  const screen = step.screen === 'onboarding' ? 'onboarding-screen' : 'dashboard-screen';
  if ($(`#${screen}`).hidden) showScreen(screen);
  if (screen === 'dashboard-screen' && state.view !== step.view) setView(step.view);
}
function clampGuide(value, minimum, maximum) { return Math.min(Math.max(value, minimum), maximum); }
function positionGuide() {
  const dialog = $('#site-guide');
  if (!dialog.open) return;
  const step = guideSteps[guideStep];
  const target = step.target();
  if (!target) return;
  let rect = target.getBoundingClientRect();
  if (rect.top < 8 || rect.bottom > window.innerHeight - 8) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    rect = target.getBoundingClientRect();
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const spotlight = $('#guide-spotlight');
  const padding = 6;
  spotlight.style.left = `${Math.max(0, rect.left - padding)}px`;
  spotlight.style.top = `${Math.max(0, rect.top - padding)}px`;
  spotlight.style.width = `${Math.min(viewportWidth, rect.right + padding) - Math.max(0, rect.left - padding)}px`;
  spotlight.style.height = `${Math.min(viewportHeight, rect.bottom + padding) - Math.max(0, rect.top - padding)}px`;

  const card = dialog.querySelector('.site-guide-card');
  const { width, height } = card.getBoundingClientRect();
  const margin = 12;
  const gap = 18;
  const space = {
    top: rect.top - gap - margin,
    bottom: viewportHeight - rect.bottom - gap - margin,
    left: rect.left - gap - margin,
    right: viewportWidth - rect.right - gap - margin
  };
  const preferred = window.matchMedia('(max-width: 650px)').matches && [1, 3].includes(guideStep) ?
    ['top', 'bottom', 'right', 'left'] : step.placement;
  const fits = side => space[side] >= (side === 'top' || side === 'bottom' ? height : width);
  const side = preferred.find(fits) || [...preferred].sort((a, b) =>
    space[b] / (b === 'top' || b === 'bottom' ? height : width) -
    space[a] / (a === 'top' || a === 'bottom' ? height : width))[0];
  let left;
  let top;
  if (side === 'top' || side === 'bottom') {
    left = clampGuide(rect.left + rect.width / 2 - width / 2, margin, viewportWidth - width - margin);
    top = side === 'top' ? rect.top - gap - height : rect.bottom + gap;
    dialog.style.setProperty('--guide-pointer-x', `${clampGuide(rect.left + rect.width / 2 - left, 22, width - 22)}px`);
  } else {
    left = side === 'left' ? rect.left - gap - width : rect.right + gap;
    top = clampGuide(rect.top + rect.height / 2 - height / 2, margin, viewportHeight - height - margin);
    dialog.style.setProperty('--guide-pointer-y', `${clampGuide(rect.top + rect.height / 2 - top, 22, height - 22)}px`);
  }
  dialog.dataset.placement = side;
  dialog.style.left = `${clampGuide(left, margin, viewportWidth - width - margin)}px`;
  dialog.style.top = `${clampGuide(top, margin, viewportHeight - height - margin)}px`;
}
function openGuide() {
  const dialog = $('#site-guide');
  if (dialog.open) return;
  guideReturn = { screen: $('#onboarding-screen').hidden ? 'dashboard-screen' : 'onboarding-screen',
    view: state.view, scrollY: window.scrollY, focus: document.activeElement,
    miniChatOpen: !$('#mini-chat').hidden, miniChatOpener };
  closeMiniChat(false);
  guideStep = 0;
  renderGuide();
  showGuideSurface(guideSteps[guideStep]);
  dialog.showModal();
  positionGuide();
  $('#guide-title').focus();
}
function closeGuide() {
  rememberGuide();
  $('#site-guide').close();
  if (!guideReturn) return;
  const previous = guideReturn;
  guideReturn = null;
  if (state.view !== previous.view) setView(previous.view);
  if ($(`#${previous.screen}`).hidden) showScreen(previous.screen);
  window.scrollTo(0, previous.scrollY);
  if (previous.miniChatOpen) toggleMiniChat(previous.miniChatOpener || $('.dashboard-chat-action'));
  else if (previous.focus?.isConnected && previous.focus.getClientRects().length) previous.focus.focus({ preventScroll: true });
}
$$('.guide-open').forEach(button => button.addEventListener('click', openGuide));
$('#guide-skip').addEventListener('click', closeGuide);
$('#guide-back').addEventListener('click', () => {
  if (guideStep === 0) return;
  guideStep -= 1;
  renderGuide();
  showGuideSurface(guideSteps[guideStep]);
  positionGuide();
  $('#guide-title').focus();
});
$('#guide-next').addEventListener('click', () => {
  if (guideStep === guideSteps.length - 1) { closeGuide(); return; }
  guideStep += 1;
  renderGuide();
  showGuideSurface(guideSteps[guideStep]);
  positionGuide();
  $('#guide-title').focus();
});
$('#site-guide').addEventListener('cancel', event => {
  event.preventDefault();
  closeGuide();
});
window.addEventListener('resize', positionGuide);

function showStartupError(message, filePage = false) {
  const screen = $('#loading-screen');
  const panel = makeElement('div', 'startup-error');
  panel.append(makeElement('h1', '', ['127.0.0.1', 'localhost'].includes(window.location.hostname) ?
    'JobMaxxing needs its local server' : 'JobMaxxing is temporarily unavailable'), makeElement('p', '', message));
  const link = makeElement('a', 'primary-button', filePage ? 'Open the working app →' : 'Try again →');
  link.href = filePage ? 'http://127.0.0.1:8765/' : window.location.href;
  panel.append(link);
  screen.replaceChildren(panel);
  screen.hidden = false;
}

function safeGuestJob(job) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || typeof job.title !== 'string' ||
      typeof job.company !== 'string' || typeof job.url !== 'string') return null;
  try { if (new URL(job.url).protocol !== 'https:') return null; } catch (_) { return null; }
  return job;
}

function loadGuestData() {
  try {
    const value = JSON.parse(localStorage.getItem(guestKey) || localStorage.getItem(legacyGuestKey) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch (_) { return {}; }
}

function guestPayload(pendingJob = null) {
  const saved = [...state.saved];
  const snapshots = [...state.savedSnapshots.values()].map(job => ({ ...job, _unverified: undefined }));
  if (pendingJob && !saved.includes(pendingJob.id)) { saved.push(pendingJob.id); snapshots.push(pendingJob); }
  return { stage: state.guestStage, profile: state.profile, direction: state.direction,
    chat_mode: state.chatMode, messages: state.messages.slice(-30),
    saved, saved_jobs: snapshots, saveChoiceSeen: state.saveChoiceSeen };
}

function persistGuest() { localStorage.setItem(guestKey, JSON.stringify(guestPayload())); }

function updateIdentity() {
  const name = state.user?.name || 'Guest';
  $$('svg.match-icon use').forEach(icon => icon.setAttribute('href', state.ai ? '#resume-match-icon' : '#guided-chat-icon'));
  $('#account-name').textContent = name;
  $('#account-initial').textContent = name.slice(0, 1).toUpperCase();
  $('#discover-eyebrow').textContent = 'JOB MATCHING';
  $('#dashboard-greeting').textContent = state.user ? `Hi, ${name}. Find your fit.` : 'Find your fit.';
  $('#sidebar-caption').textContent = state.ai ? 'AI career workspace' : 'Career workspace · guided preview';
  $('#chat-guide-title').textContent = state.ai ? 'Your AI career guide' : 'Your career guide';
  $$('.logout-button').forEach(button => { button.textContent = state.user ? 'Sign out ↗' : 'Sign in ↗'; });
  if (state.publicDemo) {
    $('.resume-match-kicker').textContent = 'GUEST DEMO · NOT STORED';
    $('#resume-match-heading').textContent = 'Resume Maxxing';
    $('#resume-guidance').textContent = 'Add a PDF, DOCX, or TXT (up to 5 MB). A private AI model on this website’s server compares your experience with current jobs. Your file is not saved or sent to another AI service.';
    $('#dashboard-resume-kicker').textContent = 'GUEST DEMO · NOT STORED';
    $('#dashboard-resume-heading').textContent = 'Find jobs from your resume';
    $('#dashboard-resume-guidance').textContent = 'Add a PDF, DOCX, or TXT (up to 5 MB). A private AI model on this website’s server compares your experience with current jobs. Your file is not saved or sent to another AI service.';
    $('#mini-resume-guidance').textContent = 'PDF, DOCX, TXT · read briefly, not saved';
  }
  const local = state.aiProvider === 'local';
  const chatMode = state.ai ?
    (state.aiVerified ? (local ? 'Local AI connected · tailored conversation' : 'AI connected · tailored follow-up questions') :
      (local ? 'Local AI model ready · testing on first message' : 'AI key configured · testing on first request')) :
    'Guided preview · AI not connected';
  $('#chat-mode').textContent = chatMode;
  $('#mini-chat-mode').textContent = chatMode;
  $('#discover-description').textContent = state.publicDemo ?
    'Explore current public jobs, or use Career chat and Resume Maxxing.' : state.ai ?
    'Explore current public jobs, or use AI chat and Resume Maxxing.' :
    'Browse public jobs with guided chat. AI is unavailable.';
  const chatLabel = state.ai ? 'Chat with AI' : 'Career chat';
  $('#dashboard-chat-label').textContent = chatLabel;
  $('#sidebar-chat-label').textContent = chatLabel;
  $('#chat-view-heading').textContent = chatLabel;
  if (state.view === 'chat') $('#breadcrumb-view').textContent = chatLabel;
  $('#mini-chat-title').textContent = chatLabel;
  $$('.open-mini-chat').forEach(button => {
    button.title = state.ai ? 'Continue your AI career conversation' : 'Career chat is in guided preview; AI is not connected';
    button.setAttribute('aria-label', state.ai ? 'Chat with AI' : 'Career chat, guided preview; AI is not connected');
  });
  const disclosure = local ?
    (state.user ? 'AI runs on this Mac · chat saved to your local account' : 'AI runs on this Mac · chat saved on this device') :
    state.ai ?
    (state.user ? 'Chat is saved to your account · sent to OpenAI' : 'Saved on this device · sent to OpenAI') :
    (state.user ? 'Saved to your account · guided preview' : 'Saved on this device · guided preview');
  $('#ai-disclosure').textContent = disclosure;
  $('#mini-chat-disclosure').textContent = disclosure;
}

function resetAiMatches() {
  state.aiMatchRequest++;
  state.aiMatches.clear();
  state.aiMatchStatus = '';
  state.aiMatchSignature = '';
}

function useSession(data) {
  closeMiniChat(false);
  resetAiMatches();
  state.aiVerified = false;
  state.user = data.user;
  state.chatBrowseActive = false;
  state.directionBrowseActive = false;
  state.directionBrowseCriteria = null;
  state.chatBrowseSource = 'conversation';
  state.hasDiscovered = data.stage === 'discover';
  state.profile = data.profile || emptyProfile();
  state.direction = normalizedDirection(data.direction);
  state.messages = data.messages || [];
  state.chatMode = data.chat_mode || (state.messages.length ? 'directed' : '');
  pathChoosing = false;
  state.saved = new Set(data.saved || []);
  state.savedSnapshots = new Map((data.saved_jobs || []).map(job => [job.id, job]));
  state.aiProvider = data.ai_provider || (data.ai ? 'openai' : null);
  state.ai = !!state.aiProvider;
  $('#profile-feedback').textContent = '';
  updateIdentity();
  renderProfile();
  renderMessages();
}

function useGuest(value, aiProvider) {
  closeMiniChat(false);
  resetAiMatches();
  state.aiVerified = false;
  state.user = null;
  state.chatBrowseActive = false;
  state.directionBrowseActive = false;
  state.directionBrowseCriteria = null;
  state.chatBrowseSource = 'conversation';
  state.profile = Object.fromEntries(fields.map(key => [key, typeof value.profile?.[key] === 'string' ? value.profile[key].slice(0, 260) : '']));
  state.direction = normalizedDirection(value.direction);
  state.messages = Array.isArray(value.messages) ? value.messages.filter(item =>
    item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-30) : [];
  state.chatMode = ['directed', 'explore'].includes(value.chat_mode) ? value.chat_mode :
    (state.messages.length ? 'directed' : '');
  pathChoosing = false;
  state.saved = new Set(Array.isArray(value.saved) ? value.saved.filter(id => typeof id === 'string') : []);
  const snapshots = Array.isArray(value.saved_jobs) ? value.saved_jobs.map(safeGuestJob).filter(Boolean) : [];
  state.savedSnapshots = new Map(snapshots.map(job => [job.id, job]));
  state.guestStage = value.stage === 'discover' ? 'discover' : 'onboarding';
  state.hasDiscovered = state.guestStage === 'discover';
  state.saveChoiceSeen = state.publicDemo || value.saveChoiceSeen === true;
  state.aiProvider = aiProvider;
  state.ai = !!aiProvider;
  $('#profile-feedback').textContent = '';
  updateIdentity();
  renderProfile();
  renderMessages();
}

function showAuth(mode = 'login') {
  setAuthMode(mode);
  $('#auth-screen').showModal();
  $('#auth-email').focus();
}

function closeAuth() {
  $('#auth-screen').close();
  state.pendingSaveJob = null;
  $('#auth-error').hidden = true;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  $('#register-tab').setAttribute('aria-selected', String(register));
  $('#login-tab').setAttribute('aria-selected', String(!register));
  $('#name-field').hidden = !register;
  $('#auth-name').required = register;
  $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
  $('#auth-password').placeholder = register ? 'At least 10 characters' : 'Your password';
  $('#auth-title').textContent = register ? 'Create your account' : 'Welcome back';
  $('#auth-subtitle').textContent = register ?
    'Keep your direction and saved jobs together in a personal career profile.' :
    'Return to your saved career profile and current opportunities.';
  $('#auth-submit-label').textContent = register ? 'Create my career profile' : 'Open my career profile';
  $('#password-hint').hidden = !register;
  $('#auth-error').hidden = true;
}

$('#register-tab').addEventListener('click', () => setAuthMode('register'));
$('#login-tab').addEventListener('click', () => setAuthMode('login'));
$('#auth-close').addEventListener('click', closeAuth);
$('#auth-screen').addEventListener('close', () => { state.pendingSaveJob = null; });
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#auth-form button[type=submit]');
  button.disabled = true;
  $('#auth-error').hidden = true;
  try {
    const payload = { email: $('#auth-email').value.trim(), password: $('#auth-password').value };
    if (state.authMode === 'register') payload.name = $('#auth-name').value.trim();
    const pending = state.pendingSaveJob;
    const guest = guestPayload(pending);
    await api(`/api/auth/${state.authMode}`, 'POST', payload);
    $('#auth-password').value = '';
    let importError = null;
    try { await api('/api/guest/import', 'POST', { guest }); }
    catch (error) { importError = error; }
    if (pending && importError) await api('/api/saved', 'POST', { job_id: pending.id, saved: true });
    const session = await api('/api/session');
    useSession(session);
    closeAuth();
    enterDashboard('profile');
    if (importError) alert('Your account is ready, but some guest data could not be copied. It is still saved on this device.');
  } catch (error) {
    $('#auth-error').textContent = error.message;
    $('#auth-error').hidden = false;
  } finally { button.disabled = false; }
});

async function logout() {
  if (!state.user) { showAuth('login'); return; }
  try { await api('/api/auth/logout', 'POST', {}); } catch (_) { /* local session may already be gone */ }
  $('#auth-form').reset();
  useGuest(loadGuestData(), state.aiProvider);
  if (state.guestStage === 'discover') enterDashboard(); else enterOnboarding();
}
$$('.logout-button').forEach(button => button.addEventListener('click', logout));

function progress() { return fields.filter(key => state.profile[key]?.trim()).length; }

function renderMemberProfile() {
  const member = $('#member-profile');
  const active = !!state.user;
  member.hidden = !active;
  $('#profile-edit-heading').hidden = !active;
  $('#profile-nav-label').textContent = active ? 'My profile' : 'My direction';
  $('#profile-page-eyebrow').textContent = active ? 'PERSONAL CAREER PROFILE' : 'YOUR DIRECTION';
  $('#profile-page-title').textContent = active ? 'A clearer picture of your next move.' : 'Where do you want to go?';
  $('#profile-page-subtitle').textContent = active ?
    'Your interests, practical preferences, and saved roles live here. Refine them to explore current postings.' :
    'Choose activities, role details, and practical preferences below to see a live shortlist of current postings.';
  if (!active) {
    for (const id of ['member-avatar', 'member-name', 'member-email', 'member-progress-label',
      'member-saved-count', 'member-chat-count', 'member-leads-count', 'member-overview-text',
      'member-role', 'member-skills', 'member-location', 'member-priorities', 'member-saved-insight',
      'member-leads-insight', 'member-next-text']) $(`#${id}`).textContent = '';
    $('#member-progress-fill').style.width = '0%';
    $('#member-saved-patterns').replaceChildren();
    $('#member-leads-list').replaceChildren();
    return;
  }

  const profile = state.profile;
  const count = progress();
  $('#member-avatar').textContent = state.user.name.slice(0, 1).toUpperCase();
  $('#member-name').textContent = state.user.name;
  $('#member-email').textContent = `${state.user.email} · saved to your account on this Mac`;
  $('#member-progress-label').textContent = `${count} of 4 basic details`;
  $('#member-progress-fill').style.width = `${count * 25}%`;
  for (const key of fields) $(`#member-${key}`).textContent = profile[key]?.trim() || 'Not added yet';

  const areas = categoryTerms.filter(term => term.ask.test(`${profile.role} ${profile.skills}`)).map(term => term.name);
  const overview = [];
  if (areas.length) overview.push(`Your notes mention ${areas.slice(0, 3).join(', ')} roles.`);
  else if (profile.role.trim()) overview.push(`Your current focus is ${profile.role.trim()}.`);
  else if (profile.skills.trim()) overview.push('You have listed experience to build on; adding a role will make this direction clearer.');
  if (profile.location.trim()) overview.push(`You prefer ${profile.location.trim()}.`);
  if (profile.priorities.trim()) overview.push(`You value ${profile.priorities.trim()}.`);
  if (state.direction.job_type) overview.push(`You are exploring ${state.direction.job_type.toLowerCase()} roles.`);
  $('#member-overview-text').textContent = overview.length ? overview.join(' ') :
    'Start by sharing a role, skill, or interest. Your profile will grow as you chat and save jobs.';
  const activityLabels = { build: 'Build or code', design: 'Design', research: 'Understand people',
    analyze: 'Analyze data', teach: 'Teach or help', grow: 'Grow an audience', organize: 'Plan and organize' };
  const directionTags = $('#member-direction-tags');
  directionTags.replaceChildren();
  const choices = [
    ...state.direction.activities.map(activity => activityLabels[activity]),
    state.direction.job_type, state.direction.school_year ? `${state.direction.school_year} year` : '',
    state.direction.workplace,
    state.direction.salary_min ? `From $${state.direction.salary_min.toLocaleString()}/${state.direction.salary_period}` : ''
  ].filter(Boolean);
  if (choices.length) for (const choice of choices) directionTags.append(makeElement('span', '', choice));
  else directionTags.append(makeElement('span', 'member-direction-empty', 'Add interests or practical preferences to narrow your shortlist.'));

  const savedCount = state.saved.size;
  const currentJobs = new Map(state.jobs.map(job => [job.id, job]));
  const savedWithDetails = [...state.saved].map(id => currentJobs.get(id) || state.savedSnapshots.get(id)).filter(Boolean);
  const typeCounts = new Map();
  const typed = savedWithDetails.filter(job => typeof job.job_type === 'string' && job.job_type.trim());
  for (const job of typed) {
    const type = jobTypeCategory(job);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }
  const workstyleKnown = savedWithDetails.filter(job => ['Remote', 'Hybrid', 'On-site'].includes(job.workplace));
  const remoteCount = workstyleKnown.filter(job => job.workplace === 'Remote').length;
  const employers = new Set(savedWithDetails.map(job => job.company).filter(Boolean));
  $('#member-saved-count').textContent = String(savedCount);
  $('#member-chat-count').textContent = String(state.messages.filter(message => message.role === 'user' && !isPathChoiceMessage(message)).length);
  const patterns = $('#member-saved-patterns');
  patterns.replaceChildren();
  if (!savedCount) {
    $('#member-saved-insight').textContent = 'Save a few roles while browsing. This space will show the types of work and employers you keep coming back to.';
  } else {
    $('#member-saved-insight').textContent = `${savedCount} ${savedCount === 1 ? 'role is' : 'roles are'} in your account. Compare them here before deciding where to apply.`;
    if (typeCounts.size) {
      const [type, topCount] = [...typeCounts].sort((a, b) => b[1] - a[1])[0];
      patterns.append(makeElement('li', '', `${type} is your most-saved listed type (${topCount} of ${typed.length} with a known type).`));
    }
    if (workstyleKnown.length) patterns.append(makeElement('li', '',
      `${remoteCount} of ${workstyleKnown.length} saved roles with a stated work style are remote.`));
    if (employers.size) patterns.append(makeElement('li', '',
      `You have saved roles from ${employers.size} ${employers.size === 1 ? 'employer' : 'employers'}.`));
    if (!patterns.children.length) patterns.append(makeElement('li', '',
      'Some older saved jobs have limited details; open them to verify their current requirements.'));
  }

  const leadsList = $('#member-leads-list');
  leadsList.replaceChildren();
  let leads = [];
  if (state.jobError) {
    $('#member-leads-insight').textContent = 'Current job sources are unavailable right now. Your profile and saved jobs are still here.';
    $('#member-leads-count').textContent = '—';
  } else if (!state.checkedAt) {
    $('#member-leads-insight').textContent = 'Checking current job postings. Possible leads will appear here shortly.';
    $('#member-leads-count').textContent = '…';
  } else if (!profile.role.trim() && !profile.skills.trim() && !state.direction.activities.length &&
      !state.direction.job_type && state.resumeStatus !== 'ready') {
    $('#member-leads-insight').textContent = 'Choose an activity, role, or job type to see a more personal shortlist of current postings.';
    $('#member-leads-count').textContent = '0';
  } else {
    leads = suggestedJobs();
    const leadCount = hasStructuredDirection() ? directionMatches().length : leads.length;
    $('#member-leads-count').textContent = String(leadCount);
    $('#member-leads-insight').textContent = leads.length ?
      `${leadCount} possible ${leadCount === 1 ? 'lead' : 'leads'} from current postings. Your preference-based shortlist is below; check each employer's requirements.` :
      'No clear leads in the current feed. Try a broader role or skills description, or browse all jobs.';
    for (const job of leads.slice(0, 3)) {
      const item = makeElement('li', 'member-lead');
      item.append(makeElement('strong', '', job.title),
        makeElement('span', '', `${job.company} · ${job.location || 'Location not listed'}`));
      const link = makeElement('a', '', 'View job posting ↗');
      link.href = job.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(link);
      leadsList.append(item);
    }
  }

  const next = $('#member-next-action');
  const missing = fields.find(key => !profile[key]?.trim());
  if (missing) {
    const labels = { role: 'roles or fields of interest', skills: 'skills or projects',
      location: 'location preference', priorities: 'what matters most to you' };
    $('#member-next-text').textContent = `Add ${labels[missing]} to make your profile and job leads more specific.`;
    next.textContent = 'Add to my profile →';
    next.dataset.action = 'edit';
    next.dataset.field = missing;
  } else if (!state.direction.activities.length && !state.direction.job_type) {
    $('#member-next-text').textContent = 'Choose a few activities or a job type to explore roles beyond a single title or skill.';
    next.textContent = 'Explore my interests →';
    next.dataset.action = 'activity';
  } else if (!savedCount) {
    $('#member-next-text').textContent = 'Your direction is complete. Save a few interesting postings so you can compare patterns and return to them later.';
    next.textContent = 'Explore jobs →';
    next.dataset.action = 'discover';
  } else if (!state.messages.some(message => message.role === 'user' && !isPathChoiceMessage(message))) {
    $('#member-next-text').textContent = 'Talk through your goals with the career guide. Your answers can make your direction more precise.';
    next.textContent = 'Continue the chat →';
    next.dataset.action = 'chat';
  } else {
    $('#member-next-text').textContent = 'Compare a saved role with your stated skills and priorities, then confirm eligibility on the employer posting.';
    next.textContent = 'Review saved jobs →';
    next.dataset.action = 'saved';
  }
}

async function saveProfile(profile, direction = state.direction) {
  if (state.user) return api('/api/profile', 'POST', { profile, direction });
  const previous = state.profile;
  const previousDirection = state.direction;
  state.profile = profile;
  state.direction = direction;
  try { persistGuest(); }
  catch (error) { state.profile = previous; state.direction = previousDirection;
    throw new Error('This browser blocked guest storage. Your changes were not saved.'); }
  return { profile, direction };
}

function renderProfile() {
  const labels = { role: 'known-role', skills: 'known-skills', location: 'known-location', priorities: 'known-priorities' };
  for (const key of fields) {
    $(`#${labels[key]}`).textContent = state.profile[key] || 'Still exploring';
    $('#profile-form').elements[key].value = state.profile[key] || '';
    $('#dialog-profile-form').elements[key].value = state.profile[key] || '';
  }
  const form = $('#profile-form');
  for (const checkbox of form.querySelectorAll('input[name="activities"]'))
    checkbox.checked = state.direction.activities.includes(checkbox.value);
  for (const key of ['job_type', 'school_year', 'workplace', 'location_rule', 'salary_period'])
    form.elements[key].value = state.direction[key];
  form.elements.salary_min.value = state.direction.salary_min || '';
  syncDirectionYear();
  const count = progress();
  $('#progress-count').textContent = `${count} / 4`;
  $('#progress-bar').style.width = `${count * 25}%`;
  $('#finish-onboarding').innerHTML = state.hasDiscovered ? 'Back to jobs <span>→</span>' : 'Browse jobs <span>→</span>';
  if (state.jobs.length) renderJobs();
  renderChatMatches();
  renderMemberProfile();
  renderDirectionPreview();
}

function renderMessages() {
  const name = state.user ? `, ${state.user.name}` : ' there';
  const opening = chatPathStarts[state.chatMode]?.[1] || 'Choose a path to begin.';
  const greeting = `Hi${name}! ${opening}${state.ai ? '' : ' AI is not connected, so this is a guided preview.'}`;
  for (const log of [$('#chat-messages'), $('#mini-chat-messages')]) {
    log.replaceChildren();
    const matchNote = currentChatMatchNote();
    if (!state.messages.length) appendBubble(log, 'assistant', greeting);
    else state.messages.forEach((message, index) => {
      const isLatestReply = index === state.messages.length - 1 && message.role === 'assistant';
      appendBubble(log, message.role, isLatestReply && matchNote && !pendingChatMessage ? matchNote : message.content);
    });
    if (pendingChatMessage) {
      appendBubble(log, 'user', pendingChatMessage);
      appendThinkingBubble(log);
    }
    log.scrollTop = log.scrollHeight;
  }
  $('#chat-presence-label').textContent = pendingChatMessage ? 'Thinking…' : 'In conversation';
  if (pendingChatMessage) $('#mini-chat-mode').textContent = 'Thinking…';
  renderChatPath();
}

let pathChanging = false;
let pathChoosing = false;
function renderChatPath() {
  const selected = !!state.chatMode;
  const choosing = !selected || pathChoosing;
  $$('.chat-path-button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.chatPath === state.chatMode));
    button.disabled = pathChanging || chatSending;
  });
  for (const picker of $$('.chat-path-picker')) picker.hidden = !choosing;
  for (const selector of ['#chat-messages', '.chat-card .chat-bottom', '#mini-chat-messages', '.mini-chat-matches', '.mini-chat-bottom'])
    $(selector).hidden = choosing;
  for (const selector of ['#chat-change-path', '#mini-chat-change-path']) $(selector).hidden = choosing;
  for (const button of $$('.chat-path-cancel')) button.hidden = !selected;
  $('#chat-input').placeholder = selected ? (state.chatMode === 'explore' ? 'Tell me what you enjoy doing…' : 'What kind of job do you have in mind?') : 'Choose a path above to begin…';
  $('#mini-chat-input').placeholder = $('#chat-input').placeholder;
  for (const selector of ['#chat-input', '#mini-chat-input', '#send-button', '#mini-chat-send'])
    $(selector).disabled = choosing || pathChanging || chatSending;
}

for (const selector of ['#chat-change-path', '#mini-chat-change-path']) $(selector).addEventListener('click', () => {
  if (chatSending || pathChanging) return;
  pathChoosing = true;
  renderChatPath();
  renderChatMatches();
  (selector === '#mini-chat-change-path' ? $('.mini-path-picker .chat-path-button') : $('.chat-card .chat-path-button')).focus();
});
$$('.chat-path-cancel').forEach(button => button.addEventListener('click', () => {
  pathChoosing = false;
  renderChatPath();
  renderChatMatches();
  (button.closest('.mini-path-picker') ? $('#mini-chat-input') : $('#chat-input')).focus();
}));

$$('.chat-path-button').forEach(button => button.addEventListener('click', async () => {
  const next = button.dataset.chatPath;
  if (pathChanging || chatSending) return;
  if (next === state.chatMode) {
    pathChoosing = false;
    renderChatPath();
    return;
  }
  pathChanging = true;
  renderChatPath();
  for (const selector of ['#chat-path-error', '#mini-chat-path-error']) $(selector).hidden = true;
  try {
    let entries;
    if (state.user) {
      const result = await api('/api/chat/mode', 'POST', { chat_mode: next });
      if (!Array.isArray(result.messages)) throw new Error('The app server needs a restart. Restart server.py, then reload this page.');
      entries = result.messages;
    } else {
      const old = state.chatMode;
      entries = [{ role: 'user', content: chatPathStarts[next][0] },
        { role: 'assistant', content: chatPathStarts[next][1] }];
      state.chatMode = next;
      state.messages.push(...entries);
      try { persistGuest(); } catch (error) {
        state.chatMode = old;
        state.messages.splice(-entries.length);
        throw new Error('This browser blocked guest storage. Please allow site data to keep your choice.');
      }
    }
    if (state.user) state.messages.push(...entries);
    state.chatMode = next;
    pathChoosing = false;
    renderMessages();
    renderChatMatches();
    const input = button.closest('.mini-path-picker') ? $('#mini-chat-input') : $('#chat-input');
    input.focus();
  } catch (error) {
    for (const selector of ['#chat-path-error', '#mini-chat-path-error']) {
      $(selector).textContent = error.message === 'Not found.' ?
        'The app server needs a restart to use this path. Restart server.py, then reload this page.' : error.message;
      $(selector).hidden = false;
    }
  } finally { pathChanging = false; renderChatPath(); }
}));

function currentChatMatchNote() {
  if (!state.jobs.length || state.resumeStatus === 'ready' || state.resumeStatus === 'empty') return '';
  const lastUser = [...state.messages].reverse().find(message => message.role === 'user' && !isPathChoiceMessage(message));
  if (!lastUser || !/\b(?:jobs?|internships?|opportunities|roles?)\b/i.test(lastUser.content) ||
      !/\b(?:find|finding|looking|seeking|want|need|match|recommend|interested)\b/i.test(lastUser.content)) return '';
  const { jobs, preference } = conversationJobMatches();
  if (!jobs.length) {
    const details = [preference.type, ...preference.categories.map(term => term.name), preference.location?.label].filter(Boolean);
    return `I couldn't find a current ${details.join(' · ') || 'job'} match in these public feeds. The full list is still available; try broadening a location or role.`;
  }
  const examples = jobs.slice(0, 2).map(job => `${job.title} at ${job.company}`);
  return `Current jobs that may fit: ${examples.join('; ')}. ${jobs.length > 2 ? `${jobs.length} total matches. ` : ''}Open the matches beside this chat and check each employer's requirements.`;
}

function appendBubble(log, role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role === 'user' ? 'user' : 'assistant'}`;
  bubble.textContent = text;
  log.append(bubble);
}

function appendThinkingBubble(log) {
  const bubble = makeElement('div', 'chat-bubble assistant chat-thinking');
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-label', 'AI is thinking');
  bubble.append(makeElement('span', '', 'Thinking'), makeElement('span', 'thinking-dots', '•••'));
  log.append(bubble);
}

let pendingChatMessage = '';
let chatSending = false;
function enterOnboarding() {
  closeMiniChat(false);
  moveFullChat(false);
  renderMessages();
  renderProfile();
  renderChatMatches();
  $('#chat-stage-label').textContent = state.ai ? 'AI CAREER CHAT · EXPLORE AT YOUR PACE' : 'CAREER CHAT · GUIDED PREVIEW';
  $('#chat-kicker').textContent = state.ai ? 'TALK WITH AI · EXPLORE JOBS' : 'GUIDED CAREER CHAT';
  $('#chat-side-title').innerHTML = state.hasDiscovered ? 'Find your<br><span>next move.</span>' : 'Tell us<br><span>about you.</span>';
  $('#chat-side-description').textContent = state.hasDiscovered ?
    (state.ai ? 'Talk with AI about your direction, then inspect matching public jobs. Return to the list anytime.' :
      'Clarify your direction and inspect matching public jobs. Return to the list anytime.') :
    (state.ai ? 'Tell the AI what interests you. Current public jobs appear after your first answer; check requirements with employers.' :
      'Tell us what interests you. Current public jobs appear after your first answer.');
  showScreen('onboarding-screen');
  const log = $('#chat-messages');
  log.scrollTop = log.scrollHeight;
  if (!state.checkedAt) loadJobs();
  (state.chatMode ? $('#chat-input') : $('.chat-card .chat-path-button')).focus();
}

async function sendChatMessage(source) {
  if (chatSending || pathChanging || !state.chatMode) return;
  const input = source === 'mini' ? $('#mini-chat-input') : $('#chat-input');
  const message = input.value.trim();
  if (!message) return;
  chatSending = true;
  pendingChatMessage = message;
  renderChatPath();
  for (const selector of ['#chat-error', '#mini-chat-error']) $(selector).hidden = true;
  input.value = '';
  renderMessages();
  renderChatMatches();
  let guidedFallback = false;
  try {
    const result = state.user ? await api('/api/chat', 'POST', { message }) :
      await api('/api/guest/chat', 'POST', { message, chat_mode: state.chatMode, profile: state.profile, messages: state.messages.slice(-24) });
    state.messages.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
    pendingChatMessage = '';
    state.profile = result.profile;
    if (result.mode === 'ai') {
      state.ai = true;
      state.aiProvider = result.ai_provider || state.aiProvider;
      state.aiVerified = true;
    } else if (result.ai_provider) {
      state.ai = true;
      state.aiProvider = result.ai_provider;
      state.aiVerified = false;
      guidedFallback = true;
    }
    else if (state.aiProvider) {
      state.aiProvider = null;
      state.ai = false;
      state.aiVerified = false;
    }
    renderProfile();
    if (!state.user) {
      try { persistGuest(); }
      catch (_) {
        for (const selector of ['#chat-error', '#mini-chat-error']) {
          $(selector).textContent = 'This browser blocked guest storage. The conversation may not persist after you close it.';
          $(selector).hidden = false;
        }
      }
    }
  } catch (error) {
    input.value = message;
    for (const selector of ['#chat-error', '#mini-chat-error']) {
      $(selector).textContent = error.message;
      $(selector).hidden = false;
    }
  } finally {
    pendingChatMessage = '';
    chatSending = false;
    renderMessages();
    renderChatMatches();
    updateIdentity();
    if (guidedFallback) {
      $('#chat-mode').textContent = 'AI temporarily unavailable · guided reply';
      $('#mini-chat-mode').textContent = 'AI temporarily unavailable · guided reply';
    }
    renderChatPath();
    const activeScreen = source === 'mini' ? !$('#mini-chat').hidden :
      (!$('#onboarding-screen').hidden || (!$('#dashboard-screen').hidden && state.view === 'chat'));
    if (activeScreen && (document.activeElement === document.body ||
      (source === 'mini' ? $('#mini-chat').contains(document.activeElement) : $('.chat-workspace').contains(document.activeElement)))) input.focus();
  }
}
$('#chat-form').addEventListener('submit', event => {
  event.preventDefault();
  sendChatMessage('full');
});
$('#mini-chat-form').addEventListener('submit', event => {
  event.preventDefault();
  sendChatMessage('mini');
});
for (const [input, form] of [['#chat-input', '#chat-form'], ['#mini-chat-input', '#mini-chat-form']]) {
  $(input).addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $(form).requestSubmit(); }
  });
}

async function openJobsFromChat() {
  const button = $('#finish-onboarding');
  const chatButton = $('#view-chat-jobs');
  if (button.disabled || chatButton.disabled) return;
  button.disabled = true;
  chatButton.disabled = true;
  try {
    if (!state.hasDiscovered) {
      if (state.user) await api('/api/onboarding/complete', 'POST', {});
      else {
        state.guestStage = 'discover';
        try { persistGuest(); }
        catch (error) { state.guestStage = 'onboarding'; throw error; }
      }
      state.hasDiscovered = true;
    }
    const resumeSearch = state.resumeStatus === 'ready' || state.resumeStatus === 'empty';
    state.chatBrowseSource = resumeSearch ? 'resume' : 'conversation';
    state.chatBrowseActive = resumeSearch ? state.resumeMatches.length > 0 :
      !!(pendingChatMessage || state.messages.some(item => item.role === 'user' && !isPathChoiceMessage(item))) && conversationJobMatches().total > 0;
    state.directionBrowseActive = false;
    state.directionBrowseCriteria = null;
    $('#job-search').value = '';
    $('#job-filters-form').reset();
    $('#country-filter-wrap').hidden = true;
    state.internshipYear = '';
    resetDiscoverList();
    enterDashboard('discover');
    renderProfile();
    $('#job-cards').scrollTop = 0;
  } catch (error) {
    $('#chat-error').textContent = state.user ? error.message : 'This browser blocked guest storage. Please enable it to keep your progress.';
    $('#chat-error').hidden = false;
  } finally {
    button.disabled = false;
    chatButton.disabled = false;
  }
}
$('#finish-onboarding').addEventListener('click', openJobsFromChat);
$('#view-chat-jobs').addEventListener('click', openJobsFromChat);
$('#clear-chat-browse').addEventListener('click', () => {
  state.chatBrowseActive = false;
  state.chatBrowseSource = 'conversation';
  state.directionBrowseActive = false;
  state.directionBrowseCriteria = null;
  resetDiscoverList();
  renderJobs();
});

function openChatProfileDialog() {
  for (const key of fields) $('#dialog-profile-form').elements[key].value = state.profile[key] || '';
  $('#profile-dialog').showModal();
}
$('#edit-onboarding-profile').addEventListener('click', openChatProfileDialog);
$('#edit-chat-profile').addEventListener('click', openChatProfileDialog);
$('#close-profile-dialog').addEventListener('click', () => $('#profile-dialog').close());
$('#dialog-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const profile = Object.fromEntries(fields.map(key => [key, $('#dialog-profile-form').elements[key].value.trim()]));
  try {
    const result = await saveProfile(profile);
    state.profile = result.profile;
    renderProfile();
    $('#profile-dialog').close();
  } catch (error) { alert(error.message); }
});

function enterDashboard(view = 'discover') {
  showScreen('dashboard-screen');
  setView(view);
  if (!state.checkedAt) loadJobs(); else loadAiMatches();
}

function moveFullChat(toDashboard) {
  const destination = toDashboard ? $('#dashboard-chat-layout') : $('.onboarding-main');
  if ($('#chat-match-panel').parentElement === destination) return;
  destination.append($('#chat-match-panel'), $('.chat-workspace'));
}

function setView(view) {
  if (view === 'chat') closeMiniChat(false);
  moveFullChat(view === 'chat');
  state.view = view;
  for (const name of ['discover', 'chat', 'resume', 'saved', 'profile']) $(`#${name}-view`).hidden = name !== view;
  $('#dashboard-screen').classList.toggle('chat-page', view === 'chat');
  $$('.side-nav,.mobile-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#breadcrumb-view').textContent = { discover: 'Discover jobs', resume: 'Resume Maxxing', saved: 'Saved jobs',
    profile: state.user ? 'My career profile' : 'My direction', chat: $('#sidebar-chat-label').textContent }[view];
  if (view === 'saved') renderSaved();
  if (view === 'resume') renderResumeResults();
  if (view === 'profile') renderProfile();
  if (view === 'chat') {
    renderMessages();
    renderProfile();
    renderChatMatches();
    const log = $('#chat-messages');
    log.scrollTop = log.scrollHeight;
  }
  window.scrollTo(0, 0);
}
function openFullChat() {
  if ($('#dashboard-screen').hidden) enterDashboard('chat');
  else setView('chat');
  (state.chatMode ? $('#chat-input') : $('.chat-card .chat-path-button')).focus();
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.view === 'chat') openFullChat();
  else setView(button.dataset.view);
}));
let miniChatOpener = null;
function closeMiniChat(restoreFocus = true) {
  const panel = $('#mini-chat');
  if (panel.hidden) return;
  panel.hidden = true;
  $$('.open-mini-chat').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-open');
  });
  if (restoreFocus && miniChatOpener?.isConnected) miniChatOpener.focus();
  miniChatOpener = null;
}
function toggleMiniChat(opener) {
  if (!$('#mini-chat').hidden) { closeMiniChat(); return; }
  miniChatOpener = opener;
  $('#mini-chat').hidden = false;
  $$('.open-mini-chat').forEach(button => {
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('is-open');
  });
  renderMessages();
  renderMiniMatches();
  (state.chatMode ? $('#mini-chat-input') : $('.mini-path-picker .chat-path-button')).focus();
}
$$('.open-mini-chat').forEach(button => button.addEventListener('click', event => toggleMiniChat(event.currentTarget)));
$('#mini-chat-close').addEventListener('click', () => closeMiniChat());
$('#mini-chat-expand').addEventListener('click', openFullChat);
$('#mini-chat').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeMiniChat(); }
});
$('#mini-chat-view-jobs').addEventListener('click', () => {
  const resumeSearch = state.resumeStatus === 'ready' || state.resumeStatus === 'empty';
  state.chatBrowseSource = resumeSearch ? 'resume' : 'conversation';
  state.chatBrowseActive = resumeSearch ? currentResumeMatches().length > 0 :
    hasChatDirection() && conversationJobMatches().total > 0;
  state.directionBrowseActive = false;
  state.directionBrowseCriteria = null;
  $('#job-search').value = '';
  $('#job-filters-form').reset();
  $('#country-filter-wrap').hidden = true;
  state.internshipYear = '';
  resetDiscoverList();
  setView('discover');
  renderJobs();
  closeMiniChat(false);
  $('#results-count').focus({ preventScroll: true });
  $('#job-cards').scrollIntoView({ block: 'start' });
});
$('#return-to-chat').addEventListener('click', openFullChat);
$('#jump-direction').addEventListener('click', () => $('#profile-form').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('#direction-browse').addEventListener('click', () => {
  const { profile, direction } = directionFormValues();
  browseDirection(null, profile, direction);
});
$('#member-open-saved').addEventListener('click', () => setView('saved'));
$('#member-open-jobs').addEventListener('click', () => {
  state.chatBrowseActive = false;
  state.directionBrowseActive = false;
  state.directionBrowseCriteria = null;
  $('#job-search').value = '';
  resetDiscoverList();
  setView('discover');
  renderJobs();
});
$('#member-next-action').addEventListener('click', event => {
  const { action, field } = event.currentTarget.dataset;
  if (action === 'edit') $('#profile-form').elements[field]?.focus();
  else if (action === 'activity') {
    $('#profile-form .direction-activities').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#profile-form input[name="activities"]')?.focus({ preventScroll: true });
  }
  else if (action === 'chat') openFullChat();
  else if (action === 'saved' || action === 'discover') setView(action);
});

function currentResumeMatches() {
  const byId = new Map(state.jobs.map(job => [job.id, job]));
  return state.resumeMatches.filter(match => byId.has(match.id)).map(match => ({ match, job: byId.get(match.id) }));
}

function renderResumeCriteria(container) {
  container.replaceChildren();
  container.append(makeElement('span', '', 'Resume-based'),
    makeElement('span', '', state.publicDemo ? 'Private AI matching' : 'On-device AI matching'));
  const labels = [state.resumePreferences.role, state.resumePreferences.job_type,
    state.resumePreferences.location, state.resumePreferences.workplace,
    ...state.resumeSignals.roles.slice(0, 2), ...state.resumeSignals.skills.slice(0, 4)].filter(Boolean);
  for (const value of [...new Set(labels)]) container.append(makeElement('span', '', value));
}

function resumeMatchSummary(count) {
  if (count) return state.publicDemo ?
    'Private AI compares the meaning of your experience with current public postings. These are suggestions, not an eligibility decision; check each employer’s requirements.' :
    'On-device AI reads resume evidence; a private semantic model compares it with current postings. Scores show relevance, not hiring chances. Check each employer’s requirements.';
  return state.resumeSignals.roles.length || state.resumeSignals.skills.length ?
    'No current public jobs matched these resume signals and any stated job-type, location, or work-setup preferences. Try a different resume or browse all jobs.' :
    'The resume did not provide clear role or skill signals. Try a text-based resume with project or skills details.';
}

function makeResumeMatchItem(match, job) {
  const item = makeElement('article', 'chat-match-item resume-result-item');
  item.setAttribute('role', 'listitem');
  const top = makeElement('div', 'chat-match-item-top');
  top.append(makeElement('strong', '', job.company), makeElement('span', '', `Relevance ${match.score}/100`));
  item.append(top, makeElement('h3', '', job.title),
    makeElement('p', 'chat-match-location', `${job.location || 'Location not listed'}${job.job_type ? ` · ${job.job_type}` : ''}${job.workplace === 'Remote' ? ' · Remote' : ''}`),
    makeElement('p', 'chat-match-reason', match.reason));
  const link = makeElement('a', 'chat-match-link', 'View job posting ↗');
  link.href = job.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  item.append(link);
  return item;
}

function renderResumeResults() {
  const list = $('#resume-results-list');
  const criteria = $('#resume-results-signals');
  const status = $('#resume-results-status');
  const count = $('#resume-results-count');
  list.replaceChildren();
  criteria.replaceChildren();
  count.textContent = '';
  if (state.resumeStatus === 'idle') {
    status.textContent = 'Add a resume above to see possible job matches here.';
    return;
  }
  if (state.resumeStatus === 'loading') {
    status.textContent = state.publicDemo ? 'Analyzing your experience with private AI and checking current jobs…' :
      'Reading your resume with on-device AI and checking current jobs…';
    return;
  }
  if (state.resumeStatus === 'error') {
    status.textContent = state.resumeError || 'Could not match this resume.';
    return;
  }
  if (jobsLoading || (!state.checkedAt && !state.jobError)) {
    status.textContent = 'Resume checked. Checking the current job list…';
    return;
  }
  if (state.jobError) {
    status.textContent = 'The current job list could not be verified. No listings were created or saved from your resume.';
    return;
  }
  const matches = currentResumeMatches();
  count.textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
  renderResumeCriteria(criteria);
  status.textContent = resumeMatchSummary(matches.length);
  for (const { match, job } of matches) list.append(makeResumeMatchItem(match, job));
}

function updateResumeUpload() {
  const active = !!state.resumeName;
  for (const [dropId, statusId, clearId] of [
    ['resume-dropzone', 'resume-status', 'clear-resume'],
    ['dashboard-resume-dropzone', 'dashboard-resume-status', 'dashboard-clear-resume'],
    ['mini-resume-dropzone', 'mini-resume-status', 'mini-clear-resume']
  ]) {
    const dropzone = $(`#${dropId}`);
    const status = $(`#${statusId}`);
    $(`#${clearId}`).hidden = !active;
    dropzone.classList.toggle('is-matching', state.resumeStatus === 'loading');
    dropzone.setAttribute('aria-busy', String(state.resumeStatus === 'loading'));
    status.hidden = !state.resumeNotice;
    status.textContent = state.resumeNotice || '';
    status.classList.toggle('is-error', state.resumeStatus === 'error');
    status.classList.toggle('is-success', state.resumeStatus === 'ready' || state.resumeStatus === 'empty');
  }
  renderResumeResults();
}

function clearResume() {
  state.resumeRequest++;
  state.resumeController?.abort();
  state.resumeController = null;
  state.resumeName = '';
  state.resumeStatus = 'idle';
  state.resumeMatches = [];
  state.resumeSignals = { roles: [], skills: [] };
  state.resumePreferences = { job_type: null, location: null, workplace: null, role: null };
  state.resumeError = '';
  state.resumeNotice = '';
  if (state.chatBrowseSource === 'resume') state.chatBrowseActive = false;
  for (const input of $$('#resume-file,#dashboard-resume-file,#mini-resume-file')) input.value = '';
  updateResumeUpload();
  renderChatMatches();
  if (state.jobs.length) renderJobs();
}

async function uploadResume(file) {
  if (!file) return;
  state.resumeController?.abort();
  const request = ++state.resumeRequest;
  const controller = new AbortController();
  state.resumeController = controller;
  state.resumeName = file.name;
  state.resumeMatches = [];
  state.resumeSignals = { roles: [], skills: [] };
  state.resumePreferences = { job_type: null, location: null, workplace: null, role: null };
  state.resumeError = '';
  state.resumeStatus = 'loading';
  state.resumeNotice = state.publicDemo ? `Analyzing ${file.name} with private AI…` :
    `Reading ${file.name} and finding current jobs on this Mac…`;
  if (state.chatBrowseSource === 'resume') state.chatBrowseActive = false;
  for (const input of $$('#resume-file,#dashboard-resume-file,#mini-resume-file')) input.value = '';
  updateResumeUpload();
  renderChatMatches();

  const extension = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx', 'txt'].includes(extension)) {
    state.resumeController = null;
    state.resumeStatus = 'error';
    state.resumeError = 'Use a PDF, DOCX, or TXT resume.';
    state.resumeNotice = state.resumeError;
    updateResumeUpload();
    renderChatMatches();
    if (state.jobs.length) renderJobs();
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    state.resumeController = null;
    state.resumeStatus = 'error';
    state.resumeError = 'Resume files must be 5 MB or smaller.';
    state.resumeNotice = state.resumeError;
    updateResumeUpload();
    renderChatMatches();
    if (state.jobs.length) renderJobs();
    return;
  }

  const body = new FormData();
  body.append('resume', file, file.name);
  try {
    let response;
    try {
      response = await fetch('/api/resume-recommendations', {
        method: 'POST', credentials: 'same-origin', body, signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') return;
      throw new Error(state.publicDemo ? 'Could not reach Resume Maxxing. Please try again later.' :
        'Could not reach Resume Maxxing. Your resume was not sent to another service.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || (state.publicDemo ? 'Could not match this resume.' :
      'Could not match this resume locally.'));
    if (request !== state.resumeRequest) return;
    state.resumeMatches = Array.isArray(result.matches) ? result.matches : [];
    state.resumeSignals = result.signals && typeof result.signals === 'object' ? {
      roles: Array.isArray(result.signals.roles) ? result.signals.roles : [],
      skills: Array.isArray(result.signals.skills) ? result.signals.skills : []
    } : { roles: [], skills: [] };
    state.resumePreferences = result.preferences || { job_type: null, location: null, workplace: null, role: null };
    state.resumeStatus = state.resumeMatches.length ? 'ready' : 'empty';
    state.resumeNotice = state.resumeMatches.length ?
      `Found ${state.resumeMatches.length} current job ${state.resumeMatches.length === 1 ? 'match' : 'matches'} for ${file.name}.` :
      state.resumeSignals.roles.length || state.resumeSignals.skills.length ?
        `No current jobs matched ${file.name} with its stated job-type, location, or work-setup preferences. You can keep chatting or browse all jobs.` :
        `Could not find role or skill details in ${file.name}. Try a resume with experience, project, or skills text.`;
    renderChatMatches();
    if (state.jobs.length) renderJobs();
  } catch (error) {
    if (request !== state.resumeRequest) return;
    state.resumeStatus = 'error';
    state.resumeError = error.message;
    state.resumeNotice = error.message;
    renderChatMatches();
    if (state.jobs.length) renderJobs();
  } finally {
    if (request === state.resumeRequest) {
      state.resumeController = null;
      updateResumeUpload();
    }
  }
}

for (const [dropId, inputId, clearId] of [
  ['resume-dropzone', 'resume-file', 'clear-resume'],
  ['dashboard-resume-dropzone', 'dashboard-resume-file', 'dashboard-clear-resume'],
  ['mini-resume-dropzone', 'mini-resume-file', 'mini-clear-resume']
]) {
  const dropzone = $(`#${dropId}`);
  const input = $(`#${inputId}`);
  input.addEventListener('change', event => uploadResume(event.target.files[0]));
  $(`#${clearId}`).addEventListener('click', clearResume);
  dropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
  });
  dropzone.addEventListener('dragover', event => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', event => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('is-dragging');
  });
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    if (event.dataTransfer.files.length > 1) {
      state.resumeRequest++;
      state.resumeController?.abort();
      state.resumeController = null;
      state.resumeName = '';
      state.resumeMatches = [];
      state.resumeSignals = { roles: [], skills: [] };
      state.resumeStatus = 'error';
      state.resumeError = 'Drop one resume at a time.';
      state.resumeNotice = state.resumeError;
      if (state.chatBrowseSource === 'resume') state.chatBrowseActive = false;
      updateResumeUpload();
      renderChatMatches();
      if (state.jobs.length) renderJobs();
      return;
    }
    uploadResume(event.dataTransfer.files[0]);
  });
}

$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const { profile, direction } = directionFormValues();
  $('#profile-feedback').textContent = '';
  try {
    const result = await saveProfile(profile, direction);
    state.profile = result.profile;
    state.direction = normalizedDirection(result.direction);
    if (state.directionBrowseActive) state.directionBrowseCriteria = { profile: { ...state.profile },
      direction: { ...state.direction, activities: [...state.direction.activities] } };
    renderProfile();
    loadAiMatches();
    $('#profile-feedback').textContent = state.user ? 'Your direction has been saved.' : 'Saved on this device.';
  } catch (error) { $('#profile-feedback').textContent = error.message; }
});
$('#profile-form').addEventListener('input', () => {
  if ($('#profile-form').elements.salary_min.validity.badInput) return;
  const { profile, direction } = directionFormValues();
  renderDirectionPreview(profile, direction);
});
$('#profile-form').addEventListener('change', event => {
  if (event.target.name === 'job_type') syncDirectionYear();
  if (event.target.name === 'school_year' && event.target.value) $('#profile-form').elements.job_type.value = 'Internship';
  const { profile, direction } = directionFormValues();
  renderDirectionPreview(profile, direction);
});

let jobsLoading = false;
async function loadJobs(force = false) {
  if (jobsLoading) return;
  jobsLoading = true;
  $('#source-status').textContent = 'Checking job sources…';
  $('#refresh-jobs').disabled = true;
  renderChatMatches();
  let loaded = false;
  try {
    const result = await api(`/api/jobs${force ? '?refresh=1' : ''}`);
    if (force) { state.details.clear(); state.detailErrors.clear(); }
    state.jobs = result.jobs || [];
    state.directionMatchKey = '';
    state.checkedAt = result.checked_at;
    state.sources = result.sources || [];
    state.stale = !!result.stale;
    state.jobError = '';
    loaded = true;
  } catch (error) {
    state.jobs = [];
    state.directionMatchKey = '';
    state.jobError = error.message;
  } finally {
    jobsLoading = false;
    $('#refresh-jobs').disabled = false;
    resetDiscoverList();
    renderJobs();
    renderSaved();
    renderResumeResults();
    renderChatMatches();
    renderMessages();
    renderMemberProfile();
    const draftDirection = directionFormValues();
    renderDirectionPreview(draftDirection.profile, draftDirection.direction);
    if (loaded) loadAiMatches();
  }
}

async function loadAiMatches() {
  if (state.aiProvider !== 'openai' || !state.jobs.length || (!state.profile.role.trim() && !state.profile.skills.trim())) {
    resetAiMatches();
    if (state.jobs.length) renderJobs();
    return;
  }
  const signature = `${state.checkedAt}|${JSON.stringify(state.profile)}`;
  if (state.aiMatchSignature === signature) return;
  const request = ++state.aiMatchRequest;
  state.aiMatchSignature = signature;
  state.aiMatches.clear();
  state.aiMatchStatus = 'loading';
  renderJobs();
  try {
    const result = await api('/api/recommendations', 'POST', { profile: state.profile });
    if (request !== state.aiMatchRequest) return;
    const available = new Set(state.jobs.map(job => job.id));
    state.aiMatches = new Map((result.matches || []).filter(match => available.has(match.id))
      .map(match => [match.id, match]));
    state.aiMatchStatus = state.aiMatches.size ? 'ready' : 'empty';
    state.aiVerified = true;
    updateIdentity();
  } catch (_) {
    if (request !== state.aiMatchRequest) return;
    state.aiMatchStatus = 'error';
    state.aiMatchSignature = '';
  } finally {
    if (request === state.aiMatchRequest) { renderJobs(); renderMemberProfile(); }
  }
}
function resetDiscoverList() {
  state.discoverLimit = discoverPageSize;
  state.expandedDiscover = null;
  $('#job-cards').scrollTop = 0;
}
$('#refresh-jobs').addEventListener('click', () => loadJobs(true));
let searchTimer;
$('#job-search').addEventListener('input', () => {
  resetDiscoverList();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderJobs, 180);
});

const usStates = `Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|District of Columbia:DC|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY`
  .split('|').map(pair => pair.split(':'));
const countryCodes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(' ');
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryAliases = {
  AE: ['UAE', 'United Arab Emirates'], BO: ['Bolivia'], CD: ['Democratic Republic of the Congo', 'DR Congo'],
  CI: ['Ivory Coast', 'Cote d Ivoire'], CZ: ['Czech Republic'], GB: ['UK', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  IR: ['Iran'], KR: ['South Korea', 'Republic of Korea'], KP: ['North Korea'], LA: ['Laos'],
  MD: ['Moldova'], PS: ['Palestine'], RU: ['Russia'], SY: ['Syria'], TR: ['Turkey'], TW: ['Taiwan'],
  TZ: ['Tanzania'], US: ['USA', 'U.S.', 'United States of America'], VE: ['Venezuela'], VN: ['Vietnam']
};

function populateLocationFilters() {
  const states = $('#us-state-options');
  for (const [name, code] of usStates) states.append(new Option(name, `state:${code}`));
  const countries = countryCodes.map(code => [code, regionNames.of(code)]).sort((a, b) => a[1].localeCompare(b[1]));
  for (const [code, name] of countries) $('#job-country-filter').add(new Option(name, code));
}
function syncCountryFilter() {
  const other = $('#job-location-filter').value === 'other-country';
  $('#country-filter-wrap').hidden = !other;
  $('#job-country-filter').required = other;
  if (!other) $('#job-country-filter').value = '';
}
populateLocationFilters();
$('#job-location-filter').addEventListener('change', syncCountryFilter);
$('#open-job-filters').addEventListener('click', () => $('#job-filters-dialog').showModal());
$('#job-filters-form').addEventListener('submit', event => {
  event.preventDefault();
  $('#job-filters-dialog').close();
  if ($('#job-type').value !== 'Internship') state.internshipYear = '';
  resetDiscoverList();
  renderJobs();
});
$('#clear-job-filters').addEventListener('click', () => {
  $('#job-filters-form').reset();
  syncCountryFilter();
  state.internshipYear = '';
  $('#job-filters-dialog').close();
  resetDiscoverList();
  renderJobs();
});
window.addEventListener('resize', () => { if (!$('#dashboard-screen').hidden) { renderJobs(); renderSaved(); } });

const categoryTerms = [
  { name: 'user experience', ask: /\bHCI\b|human.computer interaction|\bUX\b|user experience/i,
    title: /\bUX\b|user research|user experience|interaction design|product design|experience design|product designer/i },
  { name: 'design', ask: /\u8bbe\u8ba1|design/i, title: /\bdesign(?:er|ing)?\b/i },
  { name: 'research', ask: /\u7814\u7a76|research/i, title: /research|researcher|scientist/i },
  { name: 'data', ask: /\u6570\u636e|data|analytics/i, title: /data|analytics|analyst/i },
  { name: 'engineering', ask: /\u5de5\u7a0b|\u8f6f\u4ef6|\u7f16\u7a0b|计算机|computer science|\bcs\b|compu\w*|engineer|software|developer|programming|python/i, title: /engineer|software|developer|programmer/i },
  { name: 'product', ask: /\u4ea7\u54c1|product/i, title: /product/i },
  { name: 'AI', ask: /\u4eba\u5de5\u667a\u80fd|\u673a\u5668\u5b66\u4e60|\bAI\b|machine learning/i, title: /\bAI\b|machine learning|ml /i },
  { name: 'education', ask: /\u6559\u80b2|\u6559\u5b66|education|learning|teaching/i, title: /education|learning|teaching/i },
  { name: 'marketing', ask: /市场|营销|marketing|content/i, title: /marketing|content|growth/i },
  { name: 'finance', ask: /金融|财务|finance|accounting/i, title: /finance|accounting|financial/i },
  { name: 'business', ask: /商业|运营|business|operations/i, title: /business|operations|strategy|analyst/i }
];

function categoryMatches(job, profileText) {
  return categoryTerms.filter(term => term.ask.test(profileText) && term.title.test(job.title)).map(term => term.name);
}
function matchNames(job) { return categoryMatches(job, state.profile.role || state.profile.skills); }
function wantsEarlyCareer() { return /\bintern(ship)?\b|\bnew grad(uate)?\b|\bfirst job\b|\bentry.level\b|\bjunior\b|实习|应届|毕业生|初级/i.test(`${state.profile.role} ${state.profile.priorities}`); }
function wantsInternship() { return /\bintern(ship)?\b|实习/i.test(`${state.profile.role} ${state.profile.priorities}`); }
function isSenior(job) { return /\bsenior\b|\bsr\.?\b|\bstaff\b|\bprincipal\b|\bdirector\b|\bhead of\b|\bvice president\b|\bvp\b|\bmanager\b|\blead\b/i.test(job.title); }
function resumeMatchFor(jobId) {
  return state.resumeStatus === 'ready' ? state.resumeMatches.find(match => match.id === jobId) || null : null;
}
function matchHint(job) {
  const resumeMatch = resumeMatchFor(job.id);
  if (resumeMatch) return `${resumeMatch.reason} This is a resume-based suggestion, not an eligibility decision; check the employer posting.`;
  if (state.directionBrowseActive || hasStructuredDirection()) {
    const criteria = state.directionBrowseCriteria || { profile: state.profile, direction: state.direction };
    const directionMatch = directionMatches(criteria.profile, criteria.direction).find(match => match.job.id === job.id);
    if (directionMatch) return `${directionMatch.reasons.join(' · ')}.${directionMatch.cautions.length ? ` Check: ${directionMatch.cautions.join(' · ')}.` : ''} Verify eligibility on the employer posting.`;
  }
  const aiMatch = state.aiMatchStatus === 'ready' ? state.aiMatches.get(job.id) : null;
  if (aiMatch) return `${aiMatch.reason} Check eligibility on the original posting.`;
  if (!state.profile.role && !state.profile.skills) return 'Tell us about your interests to see a possible connection.';
  const names = matchNames(job);
  const base = names.length ? `The title relates to your interest in ${names.slice(0, 2).join(' and ')}.` : 'The title does not show an obvious match; the full role may tell you more.';
  const remote = /\u8fdc\u7a0b|remote/i.test(state.profile.location) && job.workplace !== 'Remote' &&
    !/remote/i.test(`${job.title} ${job.location}`);
  const level = wantsEarlyCareer() && isSenior(job) ? ' This appears to be a senior role.' : '';
  return base + level + (remote ? ' Check the remote-work policy.' : ' Check requirements on the original posting.');
}
function rank(job) {
  const roleMatches = categoryMatches(job, state.profile.role).length;
  const skillMatches = categoryMatches(job, state.profile.skills).length;
  const early = wantsEarlyCareer();
  const internship = wantsInternship();
  const location = state.profile.location.toLowerCase();
  const remoteFit = /\bremote\b|远程/.test(location) && job.workplace === 'Remote' ? 4 : 0;
  const seniorPenalty = isSenior(job) && !/\bsenior\b|\bmanager\b|高级|经理/i.test(state.profile.role) ? (early ? 60 : 18) : 0;
  return roleMatches * 12 + skillMatches * 3 + remoteFit +
    (job.early_career ? (early ? 24 : 8) : 0) + (job.job_type === 'Internship' ? (internship ? 28 : 3) : 0) -
    seniorPenalty;
}
function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function updateExternalSearchLinks() {
  const query = new URLSearchParams({ f_TPR: 'r604800' });
  const keywords = $('#job-search').value.trim() || state.profile.role.trim();
  const locationChoice = $('#job-location-filter').value;
  const location = locationChoice === 'other-country' ? ($('#job-country-filter').value ? regionNames.of($('#job-country-filter').value) : '') :
    locationChoice === 'country:US' ? 'United States' :
    locationChoice.startsWith('state:') ? `${usStates.find(([, code]) => code === locationChoice.slice(6))?.[0]}, United States` :
    locationChoice === 'remote' ? '' : state.profile.location.trim();
  if (keywords) query.set('keywords', keywords);
  if (location && !/\bremote\b|远程/i.test(location)) query.set('location', location);
  if (locationChoice === 'remote' || $('#job-workplace').value === 'Remote') query.set('f_WT', '2');
  const linkedinTypes = { Internship: 'I', 'Full-time': 'F', 'Part-time': 'P', Contract: 'C' };
  const linkedinType = linkedinTypes[$('#job-type').value];
  if (linkedinType) query.set('f_JT', linkedinType);
  $('#linkedin-search').href = `https://www.linkedin.com/jobs/search/?${query}`;
}
function publishedTime(job) { return Date.parse(job.posted_at || '') || 0; }
function wordMatches(text, word) {
  const alternatives = {
    internship: ['intern'], internships: ['intern'],
    engineering: ['engineer'], engineer: ['engineering'],
    developer: ['engineering', 'engineer'],
    design: ['designer'], designer: ['design'],
    research: ['researcher'], researcher: ['research'],
    analytics: ['analyst'], analyst: ['analytics'],
    science: ['scientist'], scientist: ['science']
  };
  return [word, ...(alternatives[word] || [])].some(option => text.includes(option));
}

const chatSkillWords = /\b(?:python|javascript|typescript|java|sql|excel|figma|react|writing|research|design|analytics|statistics|marketing|sales|programming|machine learning)\b/gi;
const genericLocationReply = /^(?:yes|yeah|yep|no|nope|hi|hello|none|not sure|n\/a)$/i;
function chatPlaceNames() {
  const names = new Set([...usStates.map(([name]) => name), 'United States',
    ...countryCodes.map(code => regionNames.of(code))]);
  for (const job of state.jobs) {
    for (const piece of (job.location || '').split(/[,;•/]/)) {
      const name = piece.trim();
      if (name.length >= 4 && name.length <= 35 && !/\bremote\b|\bhybrid\b|\bworldwide\b|\blocation\b/i.test(name)) names.add(name);
    }
  }
  return [...names].sort((a, b) => b.length - a.length);
}
function locationFromChat(text, places, requireCue = false) {
  const value = text.trim();
  if (!value || genericLocationReply.test(value)) return null;
  if (/^(?:anywhere|flexible|no location preference|open to any(?:where| location)?)\b/i.test(value))
    return { anywhere: true, remote: false, places: [], label: 'Anywhere' };
  const nonRemote = /\b(?:no|not|never|don't|do not)\s+(?:want\s+)?remote\b/i.test(value);
  const remote = /\bremote\b|远程/i.test(value) && !nonRemote;
  const found = places.filter(place => locationHasPhrase(value, place));
  const selected = [];
  for (const place of found) {
    if (!selected.some(other => locationHasPhrase(other, place) || locationHasPhrase(place, other))) selected.push(place);
    if (selected.length === 2) break;
  }
  const cue = /\b(?:in|near|around|based|located|live|living|work|remote|location|city|state|country|relocate|prefer)\b/i.test(value);
  if (requireCue && !cue && !selected.some(place => locationHasPhrase(value, place) && value.length <= place.length + 12)) return null;
  if (remote || selected.length || nonRemote) return { remote, nonRemote, places: selected,
    label: [...selected, ...(remote ? ['Remote'] : []), ...(nonRemote ? ['Not remote'] : [])].join(' or ') };
  if (!requireCue) return { remote: false, places: [value], label: value };
  return null;
}
function chatPreferences() {
  const messages = state.messages.filter(item => item.role === 'user' && !isPathChoiceMessage(item)).map(item => item.content).slice(-16);
  if (pendingChatMessage) messages.push(pendingChatMessage);
  const reversed = [...messages].reverse();
  const typePatterns = [
    ['Internship', /\b(?:intern|internship|internships)\b|实习/i],
    ['Part-time', /\bpart[- ]time\b|兼职/i],
    ['Full-time', /\bfull[- ]time\b|全职/i]
  ];
  const typeFromText = value => typePatterns.map(([type, pattern]) => {
    const match = value.match(pattern);
    if (!match || /\b(?:not|no|never|without)\s*$/i.test(value.slice(Math.max(0, match.index - 12), match.index))) return null;
    return { type, index: match.index };
  }).filter(Boolean).sort((a, b) => b.index - a.index)[0]?.type || '';
  const type = reversed.map(typeFromText).find(Boolean) ||
    typeFromText(`${state.profile.role} ${state.profile.priorities}`);
  const roleText = reversed.find(value =>
    /\b(?:role|job|career|related|engineer|engneer|software|computer|designer|researcher|analyst|product|marketing|finance|business|data)\b|设计|研究|工程|市场|金融/i.test(value) &&
    categoryTerms.some(term => term.ask.test(value))) || `${state.profile.role} ${state.profile.skills}`;
  const categories = categoryTerms.filter(term => term.ask.test(roleText) &&
    !(term.name === 'product' && /\bproduct design\b/i.test(roleText)));
  const skillText = `${state.profile.skills} ${messages.join(' ')}`;
  const skills = [...new Set((skillText.match(chatSkillWords) || []).map(word => word.toLowerCase()))].slice(0, 5);
  const yearText = reversed.find(value => /\b(?:freshm[ae]n|sophomore|first[- ]year|second[- ]year|third[- ]year|fourth[- ]year|(?:i am|i'm|as a) (?:junior|senior))\b/i.test(value)) || '';
  const years = schoolYears.filter(year => new RegExp(`\\b${year}\\b`, 'i').test(yearText));
  if (/\bfreshmen\b/i.test(yearText)) years.push('freshman');
  if (/\bsophomores\b/i.test(yearText)) years.push('sophomore');
  if (/\bfirst[- ]year\b/i.test(yearText)) years.push('freshman');
  if (/\bsecond[- ]year\b/i.test(yearText)) years.push('sophomore');
  if (/\bthird[- ]year\b/i.test(yearText)) years.push('junior');
  if (/\bfourth[- ]year\b/i.test(yearText)) years.push('senior');
  const places = chatPlaceNames();
  const location = reversed.map(value => locationFromChat(value, places, true)).find(Boolean) ||
    locationFromChat(state.profile.location, places);
  return { type, categories, skills, years: [...new Set(years)], location, rounds: messages.length };
}
function chatLocationMatches(job, preference) {
  if (!preference || preference.anywhere) return true;
  if (preference.nonRemote && job.workplace === 'Remote') return false;
  if (preference.nonRemote && !preference.places.length) return true;
  if (preference.remote && job.workplace === 'Remote') return true;
  return preference.places.some(place => {
    const stateMatch = usStates.find(([name]) => name.toLowerCase() === place.toLowerCase());
    if (stateMatch) return locationMatches(job, `state:${stateMatch[1]}`, '');
    if (place.toLowerCase() === 'united states') return locationMatches(job, 'country:US', '');
    const country = countryCodes.find(code => regionNames.of(code).toLowerCase() === place.toLowerCase() ||
      (countryAliases[code] || []).some(alias => alias.toLowerCase() === place.toLowerCase()));
    return country ? locationMatches(job, 'other-country', country) : locationHasPhrase(job.location || '', place);
  });
}
function hasStructuredDirection(direction = state.direction) {
  return !!(direction.activities.length || direction.job_type || direction.school_year ||
    direction.workplace || direction.salary_min || direction.location_rule === 'only');
}
function directionMatches(profile = state.profile, direction = state.direction) {
  const signature = `${state.checkedAt}|${state.jobs.length}|${JSON.stringify(profile)}|${JSON.stringify(direction)}`;
  if (signature === state.directionMatchKey) return state.directionMatchResults;
  const place = profile.location.trim() ? locationFromChat(profile.location, chatPlaceNames()) : null;
  const matches = DirectionMatcher.matchJobs(state.jobs, profile, direction, {
    categoryTerms, isSenior, outsideUndergraduateYear,
    matchesLocation: job => place ? chatLocationMatches(job, place) : null
  });
  state.directionMatchKey = signature;
  state.directionMatchResults = matches;
  return matches;
}
function directionFormValues() {
  const form = $('#profile-form');
  const profile = Object.fromEntries(fields.map(key => [key, form.elements[key].value.trim()]));
  const direction = {
    activities: [...form.querySelectorAll('input[name="activities"]:checked')].map(input => input.value),
    job_type: form.elements.job_type.value, school_year: form.elements.school_year.value,
    workplace: form.elements.workplace.value, location_rule: form.elements.location_rule.value,
    salary_min: Number(form.elements.salary_min.value) || 0, salary_period: form.elements.salary_period.value
  };
  return { profile, direction };
}
function syncDirectionYear() {
  const form = $('#profile-form');
  const type = form.elements.job_type.value;
  const year = form.elements.school_year;
  year.disabled = !!type && type !== 'Internship';
  if (year.disabled) year.value = '';
}
function renderDirectionPreview(profile = state.profile, direction = state.direction) {
  const status = $('#direction-preview-status');
  const list = $('#direction-preview-list');
  const browse = $('#direction-browse');
  list.replaceChildren();
  browse.hidden = true;
  if (state.jobError) { status.textContent = 'Current job sources are unavailable. Your direction is still saved.'; return; }
  if (!state.checkedAt) { status.textContent = 'Checking current public postings…'; return; }
  if (!state.jobs.length) { status.textContent = 'No current postings are available. Try Refresh jobs later.'; return; }
  const matches = directionMatches(profile, direction);
  const unsaved = JSON.stringify(profile) !== JSON.stringify(state.profile) ||
    JSON.stringify(direction) !== JSON.stringify(state.direction);
  if (!matches.length) {
    status.textContent = !(profile.role || profile.skills || direction.activities.length || direction.job_type ||
      direction.school_year || direction.workplace || direction.salary_min || (profile.location && direction.location_rule !== 'any')) ?
      'Choose an activity, role, job type, or other preference to see relevant jobs.' :
      'No current postings fit these choices. Try a broader role, work setup, location, or pay target.';
    return;
  }
  status.textContent = `${matches.length} possible ${matches.length === 1 ? 'connection' : 'connections'} from ${state.jobs.length} current postings${unsaved ? ' · previewing unsaved choices' : ''}. Open one to assess the details.`;
  browse.hidden = false;
  browse.textContent = `Explore all ${matches.length} matches →`;
  for (const match of matches.slice(0, 6)) {
    const { job, reasons, cautions } = match;
    const card = makeElement('article', 'direction-match-card');
    card.setAttribute('role', 'listitem');
    card.append(makeElement('span', 'direction-match-company', `${job.company} · ${job.job_type || 'Type not listed'}`),
      makeElement('h3', '', job.title),
      makeElement('p', 'direction-match-meta', `${job.location || 'Location not listed'} · ${job.workplace || 'Work setup not listed'}${job.pay?.display ? ` · ${job.pay.display}` : ''}`),
      makeElement('p', 'direction-match-reason', `Why it appears: ${reasons.slice(0, 3).join(' · ')}.`));
    if (cautions.length) card.append(makeElement('p', 'direction-match-caution', `Check: ${cautions.slice(0, 2).join(' · ')}.`));
    const open = makeElement('button', 'member-link-button', 'View job details →');
    open.type = 'button';
    open.addEventListener('click', () => browseDirection(job.id, profile, direction));
    card.append(open);
    list.append(card);
  }
}
function browseDirection(jobId = null, profile = state.profile, direction = state.direction) {
  state.directionBrowseActive = true;
  state.directionBrowseCriteria = { profile: { ...profile }, direction: { ...direction, activities: [...direction.activities] } };
  state.chatBrowseActive = false;
  $('#job-search').value = '';
  $('#job-filters-form').reset();
  syncCountryFilter();
  $('#job-type').value = direction.job_type || (direction.school_year ? 'Internship' : '');
  state.internshipYear = direction.school_year;
  resetDiscoverList();
  state.expandedDiscover = jobId;
  setView('discover');
  renderJobs();
  if (jobId) {
    const row = [...$('#job-cards').querySelectorAll('.job-row')].find(item => item.dataset.jobId === jobId);
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector('.job-row-open')?.focus({ preventScroll: true });
  }
}
function conversationJobMatches() {
  const preference = chatPreferences();
  const { type, categories, skills, years, location } = preference;
  const specificity = Number(!!type) + Number(!!categories.length) + Number(!!skills.length) +
    Number(!!location && !location.anywhere) + Number(!!years.length);
  const eligible = job => (!type || job.job_type === type) &&
    (type !== 'Internship' || !outsideUndergraduateYear(job)) &&
    (!years.length || job.job_type !== 'Internship' || years.some(year => internshipMatchesYear(job, year))) &&
    !isSenior(job);
  let pool = state.jobs.filter(job => eligible(job) && chatLocationMatches(job, location));
  if (!type && !categories.length) {
    const early = pool.filter(job => job.early_career || job.job_type === 'Internship');
    if (early.length) pool = early;
  }
  if (categories.length) pool = pool.filter(job => categories.some(term => term.title.test(job.title)));
  const score = job => {
    const text = `${job.title} ${job.department || ''} ${job.summary || ''}`;
    return categories.filter(term => term.title.test(job.title)).length * 30 +
      skills.filter(skill => locationHasPhrase(text, skill)).length * 9 +
      (job.early_career ? 7 : 0) + (job.job_type === 'Internship' && type === 'Internship' ? 5 : 0);
  };
  pool.sort((a, b) => score(b) - score(a) || publishedTime(b) - publishedTime(a) || a.title.localeCompare(b.title));
  return { preference, jobs: pool, allJobs: pool, total: pool.length, specificity };
}
function chatSkillHits(job, skills) {
  const availableText = `${job.title} ${job.department || ''} ${job.summary || ''}`;
  return skills.filter(skill => locationHasPhrase(availableText, skill));
}
function chatMatchReason(job, preference) {
  const points = [];
  if (preference.categories.length) points.push(`${preference.categories.map(term => term.name).join(' / ')} title`);
  if (preference.location && !preference.location.anywhere) points.push(preference.location.remote && job.workplace === 'Remote' ?
    'remote work setup' : preference.location.nonRemote && !preference.location.places.length ?
      'non-remote work setup' : `listed in ${job.location || 'the chosen location'}`);
  const skillHits = chatSkillHits(job, preference.skills);
  if (skillHits.length) points.push(`${skillHits.slice(0, 2).join(' and ')} mentioned`);
  else if (preference.skills.length) points.push('skills not confirmed in the short summary');
  if (!points.length) points.push('possible starting point');
  return `${points.join(' · ')}. Check the full posting.`;
}
function hasChatDirection() {
  return !!(pendingChatMessage || state.messages.some(item => item.role === 'user' && !isPathChoiceMessage(item)) ||
    state.profile.role.trim() || state.profile.skills.trim() || state.profile.location.trim());
}
function renderMiniMatches() {
  const list = $('#mini-chat-match-list');
  const count = $('#mini-chat-match-count');
  const status = $('#mini-chat-match-status');
  const button = $('#mini-chat-view-jobs');
  list.replaceChildren();
  count.textContent = '';
  button.textContent = 'Browse all jobs →';
  if (state.resumeName && state.resumeStatus !== 'idle') {
    if (state.resumeStatus === 'loading') {
      status.textContent = state.publicDemo ? 'Analyzing your experience with private AI…' :
        'Reading your resume with on-device AI…';
      return;
    }
    if (state.resumeStatus === 'error') { status.textContent = state.resumeError; return; }
    if (jobsLoading || (!state.checkedAt && !state.jobError)) {
      status.textContent = 'Checking current job sources for your resume matches…';
      return;
    }
    if (state.jobError) { status.textContent = 'Current jobs could not be verified. Try again later.'; return; }
    const matches = currentResumeMatches();
    count.textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
    status.textContent = resumeMatchSummary(matches.length);
    if (matches.length) button.textContent = `See ${matches.length} resume matches →`;
    for (const { job } of matches.slice(0, 3)) {
      const item = makeElement('div', 'mini-chat-match');
      item.setAttribute('role', 'listitem');
      const link = makeElement('a', '', job.title);
      link.href = job.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(link, makeElement('span', '', `${job.company} · ${job.location || 'Location not listed'}`));
      list.append(item);
    }
    return;
  }
  if (jobsLoading || (!state.checkedAt && !state.jobError)) {
    status.textContent = 'Checking current job sources… You can keep chatting.';
    return;
  }
  if (state.jobError) {
    status.textContent = 'Job sources are unavailable right now. You can still chat.';
    return;
  }
  if (!state.jobs.length) {
    status.textContent = 'No verified openings are available right now. Try refreshing the jobs list later.';
    return;
  }
  if (!hasChatDirection()) {
    status.textContent = 'Tell me a role, location, or school year. Matching jobs will appear after your answer.';
    return;
  }
  const { jobs, total } = conversationJobMatches();
  count.textContent = `${total} ${total === 1 ? 'job' : 'jobs'}`;
  status.textContent = total ? 'A quick preview from current public postings. Check eligibility with each employer.' :
    'No current jobs match all those details. Try broadening your location or field.';
  if (total) button.textContent = `See all ${total} matching jobs →`;
  for (const job of jobs.slice(0, 3)) {
    const item = makeElement('div', 'mini-chat-match');
    item.setAttribute('role', 'listitem');
    const link = makeElement('a', '', job.title);
    link.href = job.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link, makeElement('span', '', `${job.company} · ${job.location || 'Location not listed'}${job.job_type ? ` · ${job.job_type}` : ''}`));
    list.append(item);
  }
}
function renderChatMatches() {
  renderMiniMatches();
  const panel = $('#chat-match-panel');
  if (!panel) return;
  panel.classList.remove('is-empty');
  const rounds = state.messages.filter(item => item.role === 'user' && !isPathChoiceMessage(item)).length + Number(!!pendingChatMessage);
  const resumeActive = !!state.resumeName && state.resumeStatus !== 'idle';
  const showPanel = resumeActive || (!!state.chatMode && !pathChoosing && !!rounds);
  $('#view-chat-jobs').textContent = 'Browse jobs anytime →';
  panel.hidden = !showPanel;
  $('#onboarding-screen').classList.toggle('has-chat-matches', showPanel);
  $('#chat-view').classList.toggle('has-chat-matches', showPanel);
  if (!showPanel) return;
  const list = $('#chat-match-list');
  const criteria = $('#chat-match-criteria');
  list.replaceChildren();
  criteria.replaceChildren();
  $('#chat-match-count').textContent = '';

  if (resumeActive) {
    if (state.resumeStatus === 'loading') {
      $('#chat-match-status').textContent = state.publicDemo ?
        `Analyzing ${state.resumeName} with private AI…` :
        `Reading ${state.resumeName} and matching it to current job listings with on-device AI…`;
      return;
    }
    if (state.resumeStatus === 'error') {
      $('#chat-match-status').textContent = state.resumeError || 'Could not match this resume.';
      return;
    }
    if (jobsLoading || (!state.checkedAt && !state.jobError)) {
      $('#chat-match-status').textContent = 'Resume checked; checking the current job list…';
      return;
    }
    if (state.jobError) {
      $('#chat-match-status').textContent = 'The current job list could not be verified. We did not create or save any listings.';
      return;
    }
    const matches = currentResumeMatches();
    $('#view-chat-jobs').textContent = matches.length ? `See ${matches.length} resume matches →` : 'Browse jobs anytime →';
    renderResumeCriteria(criteria);
    $('#chat-match-count').textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
    $('#chat-match-status').textContent = resumeMatchSummary(matches.length);
    for (const { match, job } of matches) list.append(makeResumeMatchItem(match, job));
    return;
  }

  if (jobsLoading || (!state.checkedAt && !state.jobError)) {
    $('#chat-match-status').textContent = 'Checking current job sources… You can keep chatting while this loads.';
    return;
  }
  if (state.jobError) {
    $('#chat-match-status').textContent = 'Job sources are unavailable right now. Chat still works; try the jobs page again later.';
    return;
  }
  const { preference, jobs, total, specificity } = conversationJobMatches();
  panel.classList.toggle('is-empty', !total);
  $('#view-chat-jobs').textContent = total ? `See all ${total} jobs →` : 'Browse all jobs →';
  const labels = [preference.type, ...preference.categories.map(term => term.name),
    ...preference.skills.slice(0, 2), preference.location?.label,
    ...preference.years.map(year => year[0].toUpperCase() + year.slice(1))].filter(Boolean);
  for (const label of [...new Set(labels)]) criteria.append(makeElement('span', '', label));
  $('#chat-match-count').textContent = `${total} ${total === 1 ? 'job' : 'jobs'}${total ? ' ↓' : ''}`;
  const unconfirmedSkills = preference.skills.filter(skill => !jobs.some(job => chatSkillHits(job, [skill]).length));
  const skillNote = unconfirmedSkills.length && jobs.length ?
    ` ${unconfirmedSkills.slice(0, 2).join(' and ')} ${unconfirmedSkills.length === 1 ? 'is' : 'are'} not confirmed in these short summaries.` : '';
  $('#chat-match-status').textContent = !jobs.length ?
    'No current postings match all these details. Try another location or field, or browse all jobs below.' :
    specificity <= 1 ? `Showing all ${total} broad possibilities. A role or location would narrow them, but you can browse now.` :
    `Showing all ${total} current possibilities based on your answers.${skillNote} Scroll this list or open the full view; check eligibility with the employer.`;
  const items = document.createDocumentFragment();
  for (const job of jobs) {
    const item = makeElement('article', 'chat-match-item');
    item.setAttribute('role', 'listitem');
    const top = makeElement('div', 'chat-match-item-top');
    top.append(makeElement('strong', '', job.company), makeElement('span', '', job.job_type || 'Job'));
    item.append(top, makeElement('h3', '', job.title),
      makeElement('p', 'chat-match-location', `${job.location || 'Location not listed'}${job.workplace === 'Remote' ? ' · Remote' : ''}`));
    item.append(makeElement('p', 'chat-match-reason', chatMatchReason(job, preference)));
    if (preference.years.length && job.job_type === 'Internship' && !(job.class_years || []).length)
      item.append(makeElement('span', 'chat-match-year', 'Student year not stated'));
    const link = makeElement('a', 'chat-match-link', 'View job posting ↗');
    link.href = job.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link);
    items.append(item);
  }
  list.append(items);
}
function suggestedJobs() {
  if (state.resumeStatus === 'ready' || state.resumeStatus === 'empty') {
    const byId = new Map(state.jobs.map(job => [job.id, job]));
    return state.resumeStatus === 'ready' ? state.resumeMatches.map(match => byId.get(match.id)).filter(Boolean) : [];
  }
  if (hasStructuredDirection()) return directionMatches().slice(0, 30).map(match => match.job);
  if (state.aiMatchStatus === 'ready' && state.aiMatches.size) {
    const byId = new Map(state.jobs.map(job => [job.id, job]));
    return [...state.aiMatches.keys()].map(id => byId.get(id)).filter(Boolean);
  }
  const role = state.profile.role.trim();
  const skills = state.profile.skills.trim();
  if (!role && !skills) return [];
  return directionMatches().slice(0, 30).map(match => match.job);
}
const jobTypes = [
  { value: '', label: 'All jobs' },
  { value: 'Internship', label: 'Internships' },
  { value: 'Full-time', label: 'Full-time' },
  { value: 'Part-time', label: 'Part-time' },
  { value: 'Fellowship', label: 'Fellowships' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Other', label: 'Other / not listed' }
];
const namedJobTypes = new Set(jobTypes.slice(1, -1).map(type => type.value));
function jobTypeCategory(job) { return namedJobTypes.has(job.job_type) ? job.job_type : 'Other'; }
function outsideUndergraduateYear(job) {
  if (job.job_type !== 'Internship') return false;
  if (/\bhigh[- ]school\b|\bgraduate intern\b/i.test(job.title)) return true;
  return /\bph\.?d\.?(?=\W|$)|\bdoctoral\b|\bmba\b|\bmaster'?s\b/i.test(job.title) &&
    !/\bundergraduate\b|\bbachelor'?s\b/i.test(job.title);
}
function locationHasPhrase(location, phrase) {
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const needle = normalize(phrase);
  return !!needle && ` ${normalize(location)} `.includes(` ${needle} `);
}
function locationHasCode(location, code) {
  return new RegExp(`(?:^|[\\s,()/|–—-])${code}(?=$|[\\s,()/|–—-])`).test(location);
}
function locationMatches(job, choice, countryCode) {
  if (!choice) return true;
  if (choice === 'remote') return job.workplace === 'Remote';
  const location = job.location || '';
  if (choice.startsWith('state:')) {
    const code = choice.slice(6);
    const stateName = usStates.find(([, abbreviation]) => abbreviation === code)?.[0];
    return !!stateName && (locationHasPhrase(location, stateName) || locationHasCode(location, code) ||
      (code === 'DC' && locationHasPhrase(location, 'D.C.')));
  }
  const code = choice === 'country:US' ? 'US' : choice === 'other-country' ? countryCode : '';
  if (!code) return false;
  if (code === 'US' && usStates.some(([name, abbreviation]) =>
    locationHasPhrase(location, name) || locationHasCode(location, abbreviation))) return true;
  const names = [regionNames.of(code), ...(countryAliases[code] || [])];
  return names.some(name => locationHasPhrase(location, name) &&
    !(code === 'GB' && name === 'England' && locationHasPhrase(location, 'New England'))) ||
    (code === 'US' && locationHasCode(location, 'US'));
}
function matchingJobsWithoutType() {
  const terms = $('#job-search').value.toLowerCase().split(/\s+/).filter(word => word && !['in', 'at', 'for', 'a', 'the'].includes(word));
  const chatIds = state.chatBrowseActive ? new Set(
    (state.chatBrowseSource === 'resume' ? state.resumeMatches.map(match => match.id) :
      conversationJobMatches().allJobs.map(job => job.id))) : null;
  const directionIds = state.directionBrowseActive ? new Set(directionMatches(
    state.directionBrowseCriteria.profile, state.directionBrowseCriteria.direction).map(match => match.job.id)) : null;
  const location = $('#job-location-filter').value;
  const country = $('#job-country-filter').value;
  const workplace = $('#job-workplace').value;
  const earlyOnly = $('#early-filter').checked;
  return state.jobs.filter(job => {
    const searchable = `${job.title} ${job.company} ${job.location} ${job.department} ${job.job_type} ${job.workplace}`.toLowerCase();
    return (!chatIds || chatIds.has(job.id)) && (!directionIds || directionIds.has(job.id)) &&
      terms.every(word => wordMatches(searchable, word)) &&
      locationMatches(job, location, country) &&
      (!workplace || job.workplace === workplace) && (!earlyOnly || job.early_career);
  });
}
function salaryExpectation() {
  const raw = $('#job-min-salary').value;
  const amount = Number(raw);
  return raw && Number.isFinite(amount) && amount > 0 ?
    { amount, period: $('#job-salary-period').value } : null;
}
function comparablePay(job, expectation) {
  const pay = job.pay;
  return pay?.currency === 'USD' && pay.period === expectation.period &&
    Number.isFinite(pay.min) && Number.isFinite(pay.max) && pay.min > 0 && pay.max >= pay.min;
}
function meetsSalaryExpectation(job, expectation) {
  return comparablePay(job, expectation) && job.pay.max >= expectation.amount;
}
function internshipMatchesYear(job, year) {
  return !outsideUndergraduateYear(job) &&
    (!(job.class_years || []).length || job.class_years.includes(year));
}
function filteredJobs(pool) {
  const type = $('#job-type').value;
  const year = type === 'Internship' ? state.internshipYear : '';
  const newest = $('#job-sort').value === 'newest';
  const directionCriteria = state.directionBrowseCriteria || { profile: state.profile, direction: state.direction };
  const directionScores = new Map((state.directionBrowseActive || hasStructuredDirection() ?
    directionMatches(directionCriteria.profile, directionCriteria.direction) : []).map(match => [match.job.id, match.score]));
  const suggested = new Set(state.directionBrowseActive ? directionScores.keys() : suggestedJobs().map(job => job.id));
  return pool.filter(job => (!type || jobTypeCategory(job) === type) &&
    (!year || internshipMatchesYear(job, year)))
    .sort((a, b) => (year ? Number((b.class_years || []).includes(year)) - Number((a.class_years || []).includes(year)) : 0) ||
    Number(suggested.has(b.id)) - Number(suggested.has(a.id)) ||
    (directionScores.get(b.id) || 0) - (directionScores.get(a.id) || 0) ||
    ((resumeMatchFor(b.id)?.score || state.aiMatches.get(b.id)?.score || 0) -
      (resumeMatchFor(a.id)?.score || state.aiMatches.get(a.id)?.score || 0)) ||
    (newest ? publishedTime(b) - publishedTime(a) || rank(b) - rank(a) :
    rank(b) - rank(a) || publishedTime(b) - publishedTime(a) || a.title.localeCompare(b.title)));
}
function renderJobCategories(pool) {
  const counts = Object.fromEntries(jobTypes.map(type => [type.value, 0]));
  counts[''] = pool.length;
  for (const job of pool) counts[jobTypeCategory(job)]++;
  const selected = $('#job-type').value;
  const container = $('#job-categories');
  container.replaceChildren();
  for (const type of jobTypes) {
    if (['Fellowship', 'Contract', 'Other'].includes(type.value) && !counts[type.value] && selected !== type.value) continue;
    const button = makeElement('button', 'job-category-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected === type.value));
    button.append(makeElement('span', '', type.label), makeElement('strong', '', String(counts[type.value])));
    button.addEventListener('click', () => {
      $('#job-type').value = type.value;
      if (type.value !== 'Internship') state.internshipYear = '';
      resetDiscoverList();
      renderJobs();
    });
    container.append(button);
  }
}
const schoolYears = ['freshman', 'sophomore', 'junior', 'senior'];
function renderInternshipYears(pool) {
  const visible = $('#job-type').value === 'Internship';
  $('#internship-years').hidden = !visible;
  $('#discover-view').classList.toggle('year-filter-active', visible);
  if (!visible) return;
  const internships = pool.filter(job => jobTypeCategory(job) === 'Internship');
  const otherLevel = internships.filter(outsideUndergraduateYear).length;
  const unknown = internships.filter(job => !outsideUndergraduateYear(job) && !(job.class_years || []).length).length;
  const container = $('#year-categories');
  container.replaceChildren();
  for (const year of ['', ...schoolYears]) {
    const count = year ? internships.filter(job => internshipMatchesYear(job, year)).length : internships.length;
    const explicit = year ? internships.filter(job => (job.class_years || []).includes(year) && !outsideUndergraduateYear(job)).length : 0;
    const button = makeElement('button', 'job-category-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(state.internshipYear === year));
    if (year) button.title = `${explicit} mention ${year}; ${unknown} do not state a year. Check the posting for eligibility.`;
    button.append(makeElement('span', '', year ? year[0].toUpperCase() + year.slice(1) : 'All years'),
      makeElement('strong', '', String(count)));
    button.addEventListener('click', () => {
      state.internshipYear = year;
      resetDiscoverList();
      renderJobs();
    });
    container.append(button);
  }
  $('#year-guidance').textContent = `${unknown ? `${unknown} internship${unknown === 1 ? '' : 's'} do not state a student year and appear in every undergraduate-year tab.` : 'No internships in this selection leave the student year unstated.'} A tab match does not confirm eligibility; check the original posting.${state.internshipYear && otherLevel ? ` ${otherLevel} high-school or advanced-degree title${otherLevel === 1 ? ' is' : 's are'} excluded here.` : ''}`;
}
function renderJobs() {
  updateExternalSearchLinks();
  const preSalaryPool = matchingJobsWithoutType();
  const salary = salaryExpectation();
  const pool = salary ? preSalaryPool.filter(job => meetsSalaryExpectation(job, salary)) : preSalaryPool;
  const chatResults = state.chatBrowseActive && state.chatBrowseSource === 'conversation' ? conversationJobMatches() : null;
  renderJobCategories(pool);
  renderInternshipYears(pool);
  const result = filteredJobs(pool);
  const salaryStatus = $('#salary-filter-status');
  salaryStatus.hidden = !salary;
  if (salary) {
    const type = $('#job-type').value;
    const year = type === 'Internship' ? state.internshipYear : '';
    const candidates = preSalaryPool.filter(job => (!type || jobTypeCategory(job) === type) &&
      (!year || internshipMatchesYear(job, year)));
    const unknown = candidates.filter(job => !comparablePay(job, salary)).length;
    const below = candidates.length - unknown - result.length;
    const target = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(salary.amount);
    salaryStatus.textContent = `${target}/${salary.period} target · ${result.length} posted ranges reach it · ${unknown} without a comparable USD/${salary.period} rate in this feed excluded${below ? ` · ${below} below target` : ''}. Check the employer posting before applying.`;
  }
  const visible = result.slice(0, state.discoverLimit);
  const suggested = new Set(state.chatBrowseActive || state.directionBrowseActive ? result.map(job => job.id) : suggestedJobs().map(job => job.id));
  const suggestedCount = result.filter(job => suggested.has(job.id)).length;
  $('#chat-browse-banner').hidden = !state.chatBrowseActive && !state.directionBrowseActive;
  $('#chat-browse-summary').textContent = result.length ?
    `Showing ${result.length} current ${result.length === 1 ? 'job' : 'jobs'} based on your ${state.directionBrowseActive ? 'direction choices' : chatResults ? 'conversation' : 'resume'}` :
    `No current jobs match ${state.directionBrowseActive ? 'these direction choices' : 'those details'}. Try broader preferences or show all jobs.`;
  const hasResumeMatches = state.resumeStatus === 'ready' || state.resumeStatus === 'empty';
  const suggestionText = state.directionBrowseActive || hasStructuredDirection() ? `${suggestedCount} direction matches` :
    hasResumeMatches ? `${suggestedCount} resume-based AI suggestions` :
    state.aiMatchStatus === 'ready' ? `${suggestedCount} AI suggestions` :
    state.aiMatchStatus === 'loading' ? `${suggestedCount} keyword suggestions · AI reviewing jobs…` :
    state.aiMatchStatus === 'error' ? `${suggestedCount} keyword suggestions · AI suggestions unavailable` :
    state.aiMatchStatus === 'empty' ? `${suggestedCount} keyword suggestions · no strong AI matches` :
    `${suggestedCount} keyword suggestions`;
  const year = $('#job-type').value === 'Internship' ? state.internshipYear : '';
  const yearMatchCount = year ? result.filter(job => (job.class_years || []).includes(year)).length : 0;
  const yearLabels = year ? {
    first: `Posting mentions ${year} · ${yearMatchCount}`,
    second: `Student year not stated · ${result.length - yearMatchCount}`
  } : null;
  if (!visible.some(job => job.id === state.expandedDiscover)) state.expandedDiscover = null;
  renderJobSet($('#job-cards'), visible, result.length, 'discover', state.jobError || (state.jobs.length ?
    'No matches here. Try another keyword or clear the filters.' : 'No verified jobs are available right now.'),
    year ? yearMatchCount : suggestedCount, yearLabels);
  $('#results-count').textContent = year ?
    `Showing ${visible.length} of ${result.length} internships · ${yearMatchCount} mention ${year} · ${result.length - yearMatchCount} do not state a year` :
    state.directionBrowseActive ? `Showing ${visible.length} of ${result.length} direction matches · ${state.jobs.length} public jobs checked` :
    state.chatBrowseActive ? `Showing ${visible.length} of ${result.length} ${state.chatBrowseSource === 'resume' ? 'resume' : 'chat'} matches · ${state.jobs.length} public jobs checked` :
      `Showing ${visible.length} of ${result.length} matching · ${suggestionText} · ${state.jobs.length} public jobs`;
  const live = state.sources.filter(source => source.status === 'live').length;
  const recent = state.sources.filter(source => source.status === 'recent').length;
  const cached = state.sources.filter(source => source.status === 'cached').length;
  const unavailable = state.sources.filter(source => source.status === 'unavailable').length;
  $('#source-status').textContent = state.jobError || (state.checkedAt ?
    `${live} checked now${recent ? ` · ${recent} recently checked` : ''}${cached ? ` · ${cached} cached after error` : ''}${unavailable ? ` · ${unavailable} unavailable` : ''} · ${formatTime(state.checkedAt)}` : 'Connecting to job sources…');
  $('#source-status').title = state.sources.map(source => `${source.name} (${source.provider}): ${source.status}${source.checked_at ? ` · ${formatTime(source.checked_at)}` : ''}`).join(' · ');
  const activeFilters = [$('#job-type').value, $('#job-location-filter').value, $('#job-workplace').value, salary,
    $('#early-filter').checked, $('#job-sort').value !== 'relevance'].filter(Boolean).length;
  $('#filter-count').textContent = activeFilters ? String(activeFilters) : '';
}
function renderSaved() {
  const current = new Map(state.jobs.map(job => [job.id, job]));
  const result = [...state.saved].map(id => current.get(id) ||
    (state.savedSnapshots.has(id) ? { ...state.savedSnapshots.get(id), _unverified: true } : null)).filter(Boolean);
  const visible = result.slice(0, state.savedLimit);
  if (!visible.some(job => job.id === state.expandedSaved)) state.expandedSaved = null;
  renderJobSet($('#saved-cards'), visible, result.length, 'saved',
    state.saved.size ? 'Saved listings are not currently available. Search again to find them.' : 'No saved jobs yet. Discover a role worth revisiting.');
  const missing = state.saved.size - result.length;
  $('#saved-status').textContent = missing ? `${missing} older saved ${missing === 1 ? 'job has' : 'jobs have'} no stored details.` :
    state.user ? 'Previously saved listings may no longer be open; check the employer page.' :
      'Guest saves stay in this browser. Check the employer page before applying.';
  renderMemberProfile();
}
function makeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function renderJobSet(container, jobs, total, view, emptyText, featuredCount = 0, yearLabels = null) {
  const previousScroll = container.scrollTop;
  container.replaceChildren();
  if (!jobs.length) {
    container.append(makeElement('div', 'empty-state', emptyText));
  } else {
    if (view === 'discover') container.append(makeElement('h2', 'job-list-heading', yearLabels ?
      (featuredCount ? yearLabels.first : yearLabels.second) :
      state.directionBrowseActive ? `From your direction · ${total}` :
      state.chatBrowseActive ? `From your ${state.chatBrowseSource} · ${total}` :
      featuredCount ? `${hasStructuredDirection() ? 'Direction matches' : state.resumeStatus === 'ready' || state.resumeStatus === 'empty' ? 'Resume-based matches' : state.aiMatchStatus === 'ready' ? 'AI suggestions' : 'Keyword suggestions'} · ${featuredCount}` : 'Public jobs'));
    jobs.forEach((job, index) => {
      if (view === 'discover' && featuredCount && index === featuredCount)
        container.append(makeElement('h2', 'job-list-heading', yearLabels ? yearLabels.second : `More public jobs · ${total - featuredCount}`));
      container.append(makeJobRow(job, view));
    });
    if (jobs.length < total) {
      const remaining = total - jobs.length;
      const pageSize = view === 'discover' ? discoverPageSize : savedPageSize;
      const more = makeElement('button', 'show-more-jobs', `Show ${Math.min(pageSize, remaining)} more jobs · ${remaining} remaining ↓`);
      more.type = 'button';
      more.addEventListener('click', () => {
        if (view === 'discover') { state.discoverLimit += discoverPageSize; renderJobs(); }
        else { state.savedLimit += savedPageSize; renderSaved(); }
      });
      container.append(more);
    }
  }
  container.scrollTop = previousScroll;
}
function makeJobRow(job, view) {
  const expanded = (view === 'discover' ? state.expandedDiscover : state.expandedSaved) === job.id;
  const row = makeElement('article', `job-row${expanded ? ' expanded' : ''}`);
  row.setAttribute('role', 'listitem');
  row.dataset.jobId = job.id;
  const top = makeElement('div', 'job-row-top');
  const company = makeElement('span', 'company-badge', job.company);
  const date = makeElement('span', 'job-row-date', job.posted_at ? `Posted ${formatDate(job.posted_at)}` : 'Date not listed');
  const save = makeElement('button', `save-button${state.saved.has(job.id) ? ' saved' : ''}`, state.saved.has(job.id) ? '♥' : '♡');
  save.type = 'button';
  save.textContent = state.saved.has(job.id) ? '♥' : '♡';
  save.setAttribute('aria-label', `${state.saved.has(job.id) ? 'Remove saved' : 'Save'} ${job.title}`);
  save.addEventListener('click', () => toggleSaved(job));
  top.append(company, date, save);
  const open = makeElement('button', 'job-row-open');
  open.type = 'button';
  open.setAttribute('aria-expanded', String(expanded));
  if (expanded) open.setAttribute('aria-controls', `detail-${view}-${job.id}`);
  open.setAttribute('aria-label', `${expanded ? 'Hide' : 'View'} details for ${job.title} at ${job.company}`);
  open.append(makeElement('strong', 'job-row-title', job.title));
  const metadata = makeElement('span', 'job-row-metadata', `Location: ${job.location || 'Not listed'}${job.department ? ` · Team: ${job.department}` : ''}`);
  open.append(metadata);
  if (job.pay?.display) open.append(makeElement('span', 'job-row-pay', `Published pay: ${job.pay.display}`));
  const preview = makeElement('span', 'job-row-preview');
  const resumeMatch = !job._unverified && resumeMatchFor(job.id);
  const aiSuggested = !job._unverified && (resumeMatch || (state.aiMatchStatus === 'ready' && state.aiMatches.has(job.id)));
  const directionSuggested = !job._unverified && (state.directionBrowseActive || hasStructuredDirection()) &&
    directionMatches(state.directionBrowseCriteria?.profile || state.profile,
      state.directionBrowseCriteria?.direction || state.direction).some(match => match.job.id === job.id);
  preview.append(makeElement('span', 'job-row-preview-label', job._unverified ? 'SAVED COPY' :
    job.summary ? (job.source === 'Remotive' ? 'REMOTIVE PREVIEW' : 'ROLE PREVIEW') : 'DETAILS NOT IN FEED'),
  makeElement('span', '', job._unverified ? 'Check whether this role is still open.' :
    job.summary || 'The feed does not include role duties. Open the original posting to review the work and requirements.'));
  open.append(preview);
  const eligibility = makeElement('span', 'job-row-eligibility');
  const eligibilityText = job._unverified ? 'Not verified in the current listing.' :
    job.eligibility_preview || 'Not summarized in this feed. Check the employer posting for requirements.';
  eligibility.append(makeElement('span', 'job-row-eligibility-label', 'ELIGIBILITY'),
    makeElement('span', '', eligibilityText));
  open.append(eligibility);
  const bottom = makeElement('span', 'job-row-bottom');
  const tags = makeElement('span', 'job-row-tags');
  if (aiSuggested) tags.append(makeElement('span', 'ai-suggestion-tag', resumeMatch ? 'Resume match' : 'AI suggestion'));
  if (directionSuggested) tags.append(makeElement('span', 'ai-suggestion-tag', 'Direction match'));
  for (const label of [job.job_type, job.workplace].filter(value => value && value !== 'Not specified')) tags.append(makeElement('span', '', label));
  if (job.early_career && job.job_type !== 'Internship') tags.append(makeElement('span', '', 'Early-career title'));
  if (job.source) tags.append(makeElement('span', 'source-tag', `${job.source} source`));
  if (job._unverified) tags.append(makeElement('span', 'unverified-tag', 'Not currently verified'));
  bottom.append(tags, makeElement('span', 'job-row-cue', expanded ? 'Hide details −' : 'View details +'));
  open.append(bottom);
  open.addEventListener('click', () => {
    const key = view === 'discover' ? 'expandedDiscover' : 'expandedSaved';
    state[key] = state[key] === job.id ? null : job.id;
    if (view === 'discover') renderJobs(); else renderSaved();
    const current = [...containerForView(view).querySelectorAll('.job-row')].find(item => item.dataset.jobId === job.id);
    current?.querySelector('.job-row-open')?.focus({ preventScroll: true });
  });
  const actions = makeElement('div', 'job-row-actions');
  const postingLink = makeElement('a', 'job-posting-link', 'View job posting ↗');
  postingLink.href = job.url;
  postingLink.target = '_blank';
  postingLink.rel = 'noopener noreferrer';
  postingLink.setAttribute('aria-label', `View job posting for ${job.title} at ${job.company}`);
  actions.append(postingLink);
  row.append(top, open, actions);
  if (expanded) {
    const details = makeElement('section', 'job-expanded');
    details.id = `detail-${view}-${job.id}`;
    details.dataset.jobId = job.id;
    renderExpandedJob(details, job);
    row.append(details);
  }
  return row;
}
function containerForView(view) { return view === 'discover' ? $('#job-cards') : $('#saved-cards'); }
function detailLine(label, value) {
  const item = makeElement('div', 'job-detail-field');
  item.append(makeElement('span', '', label), makeElement('strong', '', value || 'Not listed'));
  return item;
}
function requestJobDetail(job) {
  if (state.detailPending.has(job.id) || state.details.has(job.id)) return;
  state.detailPending.add(job.id);
  api(`/api/job-detail?id=${encodeURIComponent(job.id)}`).then(detail => {
    if (detail.id !== job.id) throw new Error('The employer returned a different posting.');
    state.details.set(job.id, detail);
    state.detailErrors.delete(job.id);
  }).catch(error => state.detailErrors.set(job.id, error.message)).finally(() => {
    state.detailPending.delete(job.id);
    for (const section of $$('.job-expanded')) if (section.dataset.jobId === job.id) renderExpandedJob(section, job);
  });
}
function renderExpandedJob(section, job) {
  section.replaceChildren();
  const detail = state.details.get(job.id);
  const error = state.detailErrors.get(job.id);
  const grid = makeElement('div', 'job-detail-grid');
  grid.append(detailLine('Location', job.location), detailLine('Work setup', job.workplace),
    detailLine('Employment', job.job_type), detailLine('Team', job.department),
    detailLine('Posted', job.posted_at ? formatDate(job.posted_at) : ''),
    detailLine('Source', job.source));
  section.append(grid);
  if (job.job_type === 'Internship') {
    section.append(detailLine('Student-year wording', job.year_evidence || 'Not stated in the source text; check the full posting.'));
    section.append(makeElement('p', 'job-detail-note', 'A mentioned year is not a complete eligibility check. Confirm requirements with the employer.'));
  }
  if (job.updated_at && job.updated_at !== job.posted_at) section.append(detailLine('Listing updated', formatDate(job.updated_at)));
  if (detail?.compensation || job.pay?.display) section.append(detailLine('Published pay', detail?.compensation || job.pay.display));
  else section.append(detailLine('Published pay', 'Not listed in this feed'));
  if (detail?.application_deadline) section.append(detailLine('Apply by', formatDate(detail.application_deadline)));
  const match = makeElement('div', 'job-detail-match');
  match.append(makeElement('strong', '', job._unverified ? 'SAVED COPY · NOT CURRENTLY VERIFIED' :
    resumeMatchFor(job.id) ? 'RESUME MATCH · VERIFY ELIGIBILITY' :
      state.aiMatchStatus === 'ready' && state.aiMatches.has(job.id) ? 'AI SUGGESTION · VERIFY ELIGIBILITY' : 'POSSIBLE CONNECTION'),
    makeElement('p', '', job._unverified ?
      'This job is not in the current feed. It may be closed or its source may be unavailable.' : matchHint(job)));
  section.append(match);
  const body = makeElement('div', 'job-detail-description');
  body.append(makeElement('h3', '', job.source === 'Remotive' ? 'Role description from Remotive' : 'Role description from the employer'));
  if (job._unverified) body.append(makeElement('p', 'job-detail-note', 'Full details cannot be verified from the current feed. Open the original posting to check whether it is still available.'));
  else if (detail?.description) {
    const description = makeElement('div', 'job-description-text');
    for (const block of detail.description.split(/\n\s*\n/).filter(Boolean)) description.append(makeElement('p', '', block));
    body.append(description);
    if (detail.description_truncated) body.append(makeElement('p', 'job-detail-note', 'This is an excerpt. Read the original posting for the complete description.'));
  } else if (error) {
    body.append(makeElement('p', 'job-detail-note', error));
    const retry = makeElement('button', 'text-button', 'Try loading details again ↻');
    retry.type = 'button';
    retry.addEventListener('click', () => { state.detailErrors.delete(job.id); renderExpandedJob(section, job); });
    body.append(retry);
  } else if (state.detailPending.has(job.id)) body.append(makeElement('p', 'job-detail-note', 'Loading the employer’s posting…'));
  else if (detail) body.append(makeElement('p', 'job-detail-note', 'The employer has not supplied a full description through this feed.'));
  else {
    body.append(makeElement('p', 'job-detail-note', 'Loading the employer’s posting…'));
    requestJobDetail(job);
  }
  section.append(body);
  const footer = makeElement('div', 'job-detail-footer');
  footer.append(makeElement('span', '', `${detail?.checked_at ? (job.source === 'Remotive' ? 'Feed checked ' : 'Details checked ') + formatTime(detail.checked_at) : state.checkedAt ? 'List checked ' + formatTime(state.checkedAt) : 'Check the original page for current status'}`));
  section.append(footer);
}
async function toggleSaved(job) {
  const id = job.id;
  const next = !state.saved.has(id);
  if (!state.user) {
    if (next && !state.saveChoiceSeen) {
      state.pendingSaveJob = job;
      $('#save-choice-error').hidden = true;
      $('#save-choice-dialog').showModal();
      return;
    }
    try { commitGuestSave(job, next); }
    catch (error) { alert(error.message); }
    return;
  }
  try {
    await api('/api/saved', 'POST', { job_id: id, saved: next });
    if (next) { state.saved.add(id); state.savedSnapshots.set(id, job); }
    else { state.saved.delete(id); state.savedSnapshots.delete(id); }
    renderJobs(); renderSaved();
  } catch (error) { alert(error.message); }
}

function commitGuestSave(job, saved) {
  const previousSaved = new Set(state.saved);
  const previousSnapshots = new Map(state.savedSnapshots);
  if (saved) { state.saved.add(job.id); state.savedSnapshots.set(job.id, job); }
  else { state.saved.delete(job.id); state.savedSnapshots.delete(job.id); }
  try { persistGuest(); }
  catch (_) {
    state.saved = previousSaved;
    state.savedSnapshots = previousSnapshots;
    throw new Error(state.publicDemo ? 'This browser blocked saved jobs. Try allowing site data.' :
      'This browser blocked guest storage. Try allowing site data or choose an account.');
  }
  renderJobs();
  renderSaved();
}

$('#close-save-choice').addEventListener('click', () => { $('#save-choice-dialog').close(); state.pendingSaveJob = null; });
$('#save-choice-dialog').addEventListener('cancel', () => { state.pendingSaveJob = null; });
$('#save-on-device').addEventListener('click', () => {
  const job = state.pendingSaveJob;
  if (!job) return;
  const previousChoice = state.saveChoiceSeen;
  state.saveChoiceSeen = true;
  try {
    commitGuestSave(job, true);
    $('#save-choice-dialog').close();
    state.pendingSaveJob = null;
  } catch (error) {
    state.saveChoiceSeen = previousChoice;
    $('#save-choice-error').textContent = error.message;
    $('#save-choice-error').hidden = false;
  }
});
$('#save-with-account').addEventListener('click', () => {
  $('#save-choice-dialog').close();
  showAuth('register');
});

async function start() {
  if (window.location.protocol === 'file:') {
    showStartupError('This file cannot send messages or load jobs. Start the app server, then use the local web address below.', true);
    return;
  }
  try {
    const session = await api('/api/session');
    state.publicDemo = session.public_demo === true;
    document.body.classList.toggle('public-demo', state.publicDemo);
    if (session.user) {
      useSession(session);
      enterDashboard('profile');
    } else {
      useGuest(loadGuestData(), session.ai_provider || (session.ai ? 'openai' : null));
      if (state.guestStage === 'discover') enterDashboard(); else enterOnboarding();
    }
    if (!hasSeenGuide()) openGuide();
  } catch (error) {
    showStartupError(error.message);
  }
}
start();
