'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'weekplanner_v2';
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const DAILY_CAP = 5;
const PRIORITY_LABELS = { high: '🔴 High', medium: '🟡 Med', low: '🟢 Low' };
const PRIORITY_SHORT  = { high: 'High', medium: 'Med', low: 'Low' };

// ── State ─────────────────────────────────────────────────────────────────────

let anchorDate = new Date();
let state;
let dragSrc = null;
let checkinDecisions = [];

// ── Storage ───────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      tasks: s.tasks || {},
      weekNotes: s.weekNotes || {},
      lastCheckinDate: s.lastCheckinDate || '',
      settings: { dailyCap: DAILY_CAP, ...(s.settings || {}) },
    };
  } catch {
    return { tasks: {}, weekNotes: {}, lastCheckinDate: '', settings: { dailyCap: DAILY_CAP } };
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { console.warn('Could not save'); }
}

// ── Date Helpers ──────────────────────────────────────────────────────────────

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function todayStr() { return toDateStr(new Date()); }

function getWeekDates(anchor) {
  const mon = new Date(anchor);
  const day = mon.getDay();
  mon.setDate(mon.getDate() + (day === 0 ? -6 : 1 - day));
  mon.setHours(0,0,0,0);
  return Array.from({length:7}, (_,i) => { const d=new Date(mon); d.setDate(mon.getDate()+i); return d; });
}

function formatWeekLabel(dates) {
  const [f, l] = [dates[0], dates[6]];
  if (f.getMonth() === l.getMonth())
    return `${MONTH_NAMES[f.getMonth()]} ${f.getDate()}–${l.getDate()}, ${f.getFullYear()}`;
  if (f.getFullYear() === l.getFullYear())
    return `${MONTH_NAMES[f.getMonth()]} ${f.getDate()} – ${MONTH_NAMES[l.getMonth()]} ${l.getDate()}, ${f.getFullYear()}`;
  return `${MONTH_NAMES[f.getMonth()]} ${f.getDate()}, ${f.getFullYear()} – ${MONTH_NAMES[l.getMonth()]} ${l.getDate()}, ${l.getFullYear()}`;
}

function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay()+6)%7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn = 1 + Math.round(((d-w1)/86400000 - 3 + ((w1.getDay()+6)%7))/7);
  return `${d.getFullYear()}-W${String(wn).padStart(2,'0')}`;
}

function formatCheckinDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAY_NAMES[(d.getDay()+6)%7]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function formatTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')}${h>=12?'pm':'am'}`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Task Mutations ────────────────────────────────────────────────────────────

function getTask(dateStr, id) {
  return (state.tasks[dateStr]||[]).find(t => t.id === id);
}

function activeTasks(dateStr) {
  return (state.tasks[dateStr]||[]).filter(t => !t.completed);
}

function addTask(dateStr, text, priority='medium', time='') {
  text = text.trim();
  if (!text) return false;
  if (activeTasks(dateStr).length >= state.settings.dailyCap) return false;
  if (!state.tasks[dateStr]) state.tasks[dateStr] = [];
  state.tasks[dateStr].push({ id: crypto.randomUUID(), text, priority, time, completed: false, createdAt: Date.now() });
  saveState(); render(); return true;
}

function toggleTask(dateStr, id) {
  const t = getTask(dateStr, id);
  if (t) { t.completed = !t.completed; saveState(); render(); }
}

function deleteTask(dateStr, id) {
  if (!state.tasks[dateStr]) return;
  state.tasks[dateStr] = state.tasks[dateStr].filter(t => t.id !== id);
  saveState(); render();
}

function editTask(dateStr, id, text, priority, time) {
  const t = getTask(dateStr, id);
  if (!t) return;
  if (text !== undefined && text.trim()) t.text = text.trim();
  if (priority !== undefined) t.priority = priority;
  if (time !== undefined) t.time = time;
  saveState(); render();
}

function moveTask(fromDate, id, toDate) {
  if (!state.tasks[fromDate]) return;
  const idx = state.tasks[fromDate].findIndex(t => t.id === id);
  if (idx === -1) return;
  const [task] = state.tasks[fromDate].splice(idx, 1);
  task.completed = false;
  if (!state.tasks[toDate]) state.tasks[toDate] = [];
  state.tasks[toDate].push(task);
  saveState();
}

function reorderTask(dateStr, from, to) {
  const arr = state.tasks[dateStr];
  if (!arr || from === to) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  saveState(); render();
}

// ── Check-in ──────────────────────────────────────────────────────────────────

function getIncompletePast() {
  const today = todayStr();
  const result = [];
  for (const [ds, tasks] of Object.entries(state.tasks)) {
    if (ds >= today) continue;
    const incomplete = tasks.filter(t => !t.completed);
    if (incomplete.length) result.push({ dateStr: ds, tasks: incomplete });
  }
  return result.sort((a,b) => a.dateStr.localeCompare(b.dateStr));
}

function showCheckin() {
  const past = getIncompletePast();
  if (!past.length) { completeCheckin(); return; }
  checkinDecisions = past.flatMap(({ dateStr, tasks }) =>
    tasks.map(task => ({ dateStr, task, decision: null }))
  );
  renderCheckinModal();
  document.getElementById('checkin-overlay').classList.remove('hidden');
}

function renderCheckinModal() {
  const total = checkinDecisions.length;
  const undecided = checkinDecisions.filter(d => d.decision === null).length;

  document.getElementById('checkin-subtitle').textContent =
    `${total} unfinished task${total!==1?'s':''} from previous days — decide what to do with each to continue.`;

  const list = document.getElementById('checkin-list');
  list.innerHTML = '';
  checkinDecisions.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'checkin-item' + (item.decision ? ' decided' : '');

    div.innerHTML = `
      <div class="checkin-item-header">
        <span class="checkin-date-label">${formatCheckinDate(item.dateStr)}</span>
        <span class="checkin-priority priority-${item.task.priority}">${PRIORITY_SHORT[item.task.priority]}</span>
      </div>
      <div class="checkin-task-text">${escHtml(item.task.text)}</div>
      <div class="checkin-actions" id="cka-${i}"></div>
    `;
    list.appendChild(div);
    renderCheckinActions(i);
  });

  const btn = document.getElementById('checkin-start');
  btn.disabled = undecided > 0;
  btn.textContent = undecided > 0
    ? `${undecided} task${undecided!==1?'s':''} left to decide`
    : 'Start my day →';
}

function renderCheckinActions(i) {
  const item = checkinDecisions[i];
  const container = document.getElementById(`cka-${i}`);
  if (!container) return;

  if (item.decision === null) {
    container.innerHTML = `
      <button class="checkin-btn checkin-btn-today"   data-i="${i}">→ Today</button>
      <button class="checkin-btn checkin-btn-pick"    data-i="${i}">📅 Pick day</button>
      <button class="checkin-btn checkin-btn-keep"    data-i="${i}">⏸ Keep</button>
      <button class="checkin-btn checkin-btn-delete"  data-i="${i}">🗑 Delete</button>
    `;
    container.querySelectorAll('.checkin-btn').forEach(b => b.addEventListener('click', onCheckinAction));

  } else if (item.decision === '_picking') {
    const today = todayStr();
    const btns = Array.from({length:8}, (_,k) => {
      const d = new Date(); d.setDate(d.getDate()+k);
      const ds = toDateStr(d);
      const label = ds===today ? 'Today' : `${DAY_NAMES[(d.getDay()+6)%7]} ${d.getDate()}`;
      return `<button class="checkin-day-btn" data-i="${i}" data-date="${ds}">${label}</button>`;
    }).join('');
    container.innerHTML = `<div class="checkin-day-picker">${btns}<button class="checkin-btn checkin-btn-back" data-i="${i}">✕</button></div>`;
    container.querySelectorAll('.checkin-day-btn').forEach(b => b.addEventListener('click', onCheckinDayPick));
    container.querySelector('.checkin-btn-back').addEventListener('click', () => {
      checkinDecisions[i].decision = null; renderCheckinModal();
    });

  } else {
    const labelMap = { today:'→ Moving to today', keep:'⏸ Kept for later', delete:'🗑 Will be deleted' };
    const label = item.decision.startsWith('date:')
      ? `📅 Moving to ${formatCheckinDate(item.decision.slice(5))}`
      : labelMap[item.decision] || item.decision;
    container.innerHTML = `<span class="checkin-decided-label">${label}</span><button class="checkin-undo" data-i="${i}">Undo</button>`;
    container.querySelector('.checkin-undo').addEventListener('click', () => {
      checkinDecisions[i].decision = null; renderCheckinModal();
    });
  }
}

function onCheckinAction(e) {
  const i = parseInt(e.currentTarget.dataset.i);
  const cls = e.currentTarget.className;
  if (cls.includes('today'))  checkinDecisions[i].decision = 'today';
  if (cls.includes('pick'))   checkinDecisions[i].decision = '_picking';
  if (cls.includes('keep'))   checkinDecisions[i].decision = 'keep';
  if (cls.includes('delete')) checkinDecisions[i].decision = 'delete';
  renderCheckinModal();
}

function onCheckinDayPick(e) {
  const i = parseInt(e.currentTarget.dataset.i);
  const date = e.currentTarget.dataset.date;
  checkinDecisions[i].decision = date === todayStr() ? 'today' : `date:${date}`;
  renderCheckinModal();
}

function applyCheckinDecisions() {
  const today = todayStr();
  for (const { dateStr, task, decision } of checkinDecisions) {
    if (decision === 'today')              moveTask(dateStr, task.id, today);
    else if (decision === 'delete')        deleteTask(dateStr, task.id);
    else if (decision?.startsWith('date:')) moveTask(dateStr, task.id, decision.slice(5));
    // 'keep' and null: leave in place
  }
}

function completeCheckin() {
  state.lastCheckinDate = todayStr();
  saveState();
  document.getElementById('checkin-overlay').classList.add('hidden');
  render();
}

// ── Week Notes ────────────────────────────────────────────────────────────────

function renderWeekNotes() {
  const key = getWeekKey(anchorDate);
  const ta = document.getElementById('week-notes');
  ta.value = state.weekNotes[key] || '';
  ta.oninput = () => { state.weekNotes[key] = ta.value; saveState(); };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function loadColor(ratio) {
  if (ratio < 0.5) return '#5a8f65';
  if (ratio < 0.85) return '#c49a1a';
  return '#c9472a';
}

function render() {
  const dates = getWeekDates(anchorDate);
  const today = todayStr();
  const cap = state.settings.dailyCap;

  document.getElementById('week-label').textContent = formatWeekLabel(dates);

  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  dates.forEach((date, i) => {
    const ds = toDateStr(date);
    const isToday = ds === today;
    const isPast = ds < today;
    const tasks = state.tasks[ds] || [];
    const active = tasks.filter(t => !t.completed);
    const atCap = active.length >= cap;
    const ratio = Math.min(active.length / cap, 1);

    const col = document.createElement('div');
    col.className = `day-column${isToday?' today':''}${isPast?' past':''}`;
    col.dataset.date = ds;

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'day-header';
    hdr.innerHTML = `
      <div class="day-name">${DAY_NAMES[i]}</div>
      <div class="day-number">${date.getDate()}</div>
      <div class="load-bar"><div class="load-fill" style="width:${ratio*100}%;background:${loadColor(ratio)}"></div></div>
      <div class="task-count">${active.length}/${cap}</div>
    `;
    col.appendChild(hdr);

    // Task list
    const ul = document.createElement('ul');
    ul.className = 'task-list';
    ul.addEventListener('dragover', e => e.preventDefault());
    ul.addEventListener('drop', e => {
      if (dragSrc && dragSrc.dateStr === ds) {
        reorderTask(ds, dragSrc.index, tasks.length - 1);
      }
    });

    tasks.forEach((task, idx) => {
      ul.appendChild(createTaskEl(ds, task, idx, tasks.length));
    });
    col.appendChild(ul);

    // Add area
    col.appendChild(createAddArea(ds, atCap, i, date.getDate()));
    grid.appendChild(col);
  });

  renderWeekNotes();
}

function createTaskEl(ds, task, index, total) {
  const li = document.createElement('li');
  li.className = `task-item${task.completed?' completed':''}`;
  li.dataset.id = task.id;
  li.draggable = true;

  // Priority strip
  const strip = document.createElement('div');
  strip.className = `priority-strip priority-strip-${task.priority}`;

  // Check
  const check = document.createElement('button');
  check.className = 'check-btn';
  check.innerHTML = '&#10003;';
  check.setAttribute('aria-label', task.completed ? 'Mark incomplete' : 'Mark complete');
  check.addEventListener('click', () => toggleTask(ds, task.id));

  // Content
  const content = document.createElement('div');
  content.className = 'task-content';
  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;
  content.appendChild(span);
  if (task.time) {
    const badge = document.createElement('span');
    badge.className = 'time-badge';
    badge.textContent = formatTime(task.time);
    content.appendChild(badge);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  if (!task.completed) {
    if (index > 0)        actions.appendChild(makeBtn('↑','Move up',  () => reorderTask(ds, index, index-1)));
    if (index < total-1)  actions.appendChild(makeBtn('↓','Move down',() => reorderTask(ds, index, index+1)));
  }
  actions.appendChild(makeBtn('✎', 'Edit',   () => startEdit(li, content, ds, task)));
  const del = makeBtn('✕', 'Delete', () => deleteTask(ds, task.id));
  del.classList.add('delete-btn');
  actions.appendChild(del);

  li.appendChild(strip);
  li.appendChild(check);
  li.appendChild(content);
  li.appendChild(actions);

  // Drag-to-reorder
  li.addEventListener('dragstart', e => {
    dragSrc = { dateStr: ds, id: task.id, index };
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drag-over'); });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', e => {
    e.stopPropagation();
    li.classList.remove('drag-over');
    if (dragSrc && dragSrc.dateStr === ds && dragSrc.id !== task.id)
      reorderTask(ds, dragSrc.index, index);
  });

  return li;
}

function makeBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'action-btn';
  b.innerHTML = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

function createAddArea(ds, atCap, dayIdx, dayNum) {
  const area = document.createElement('div');
  area.className = `add-task${atCap?' at-cap':''}`;

  if (atCap) {
    area.innerHTML = `<div class="cap-msg">Day full (${state.settings.dailyCap}/${state.settings.dailyCap}) — complete a task first</div>`;
    return area;
  }

  let selPriority = 'medium';

  // Input row
  const inputRow = document.createElement('div');
  inputRow.className = 'add-input-row';

  const input = document.createElement('input');
  input.type = 'text'; input.className = 'add-task-input';
  input.placeholder = 'Add task…'; input.maxLength = 200;
  input.setAttribute('aria-label', `Add task for ${DAY_NAMES[dayIdx]} ${dayNum}`);

  const addBtn = document.createElement('button');
  addBtn.className = 'add-btn'; addBtn.innerHTML = '+'; addBtn.setAttribute('type','button');
  addBtn.setAttribute('aria-label','Add task');

  inputRow.appendChild(input); inputRow.appendChild(addBtn);

  // Priority + time row
  const priRow = document.createElement('div');
  priRow.className = 'priority-row';

  [['high','🔴'],['medium','🟡'],['low','🟢']].forEach(([key, emoji]) => {
    const b = document.createElement('button');
    b.className = `priority-pick${key===selPriority?' selected':''}`;
    b.dataset.priority = key; b.textContent = emoji; b.setAttribute('type','button');
    b.title = key.charAt(0).toUpperCase()+key.slice(1)+' priority';
    b.addEventListener('click', () => {
      selPriority = key;
      priRow.querySelectorAll('.priority-pick').forEach(x => x.classList.toggle('selected', x.dataset.priority===key));
    });
    priRow.appendChild(b);
  });

  const timeTog = document.createElement('button');
  timeTog.className = 'time-toggle'; timeTog.textContent = '🕐'; timeTog.title = 'Set time';
  timeTog.setAttribute('type','button');

  const timeIn = document.createElement('input');
  timeIn.type = 'time'; timeIn.className = 'time-input hidden';

  timeTog.addEventListener('click', () => {
    timeIn.classList.toggle('hidden');
    if (!timeIn.classList.contains('hidden')) timeIn.focus();
  });

  priRow.appendChild(timeTog); priRow.appendChild(timeIn);
  area.appendChild(inputRow); area.appendChild(priRow);

  function submit() {
    const ok = addTask(ds, input.value, selPriority, timeIn.value);
    if (ok) {
      const fresh = document.querySelector(`.day-column[data-date="${ds}"] .add-task-input`);
      if (fresh) fresh.focus();
    }
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  addBtn.addEventListener('click', submit);

  return area;
}

function startEdit(li, content, ds, task) {
  const span = content.querySelector('.task-text');
  const badge = content.querySelector('.time-badge');
  if (!span) return;

  const form = document.createElement('div');
  form.className = 'edit-form';

  const textIn = document.createElement('input');
  textIn.type = 'text'; textIn.className = 'task-edit-input';
  textIn.value = task.text; textIn.maxLength = 200;

  const priRow = document.createElement('div');
  priRow.className = 'priority-row edit-priority-row';
  let ePriority = task.priority;

  [['high','🔴'],['medium','🟡'],['low','🟢']].forEach(([key, emoji]) => {
    const b = document.createElement('button');
    b.className = `priority-pick${key===ePriority?' selected':''}`; b.dataset.priority = key;
    b.textContent = emoji; b.setAttribute('type','button');
    b.addEventListener('click', () => {
      ePriority = key;
      priRow.querySelectorAll('.priority-pick').forEach(x => x.classList.toggle('selected', x.dataset.priority===key));
    });
    priRow.appendChild(b);
  });

  const timeIn = document.createElement('input');
  timeIn.type = 'time'; timeIn.className = 'time-input'; timeIn.value = task.time || '';
  priRow.appendChild(timeIn);

  form.appendChild(textIn); form.appendChild(priRow);
  content.replaceChild(form, span);
  if (badge) badge.remove();
  textIn.focus(); textIn.select();

  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const newText = textIn.value.trim();
    if (newText) editTask(ds, task.id, newText, ePriority, timeIn.value);
    else render();
  }
  function cancel() { if (committed) return; committed = true; render(); }

  textIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
    e.stopPropagation();
  });
  textIn.addEventListener('blur', () => setTimeout(() => { if (!form.contains(document.activeElement)) commit(); }, 150));
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.getElementById('prev-week').addEventListener('click', () => { anchorDate.setDate(anchorDate.getDate()-7); render(); });
document.getElementById('next-week').addEventListener('click', () => { anchorDate.setDate(anchorDate.getDate()+7); render(); });
document.getElementById('today-btn').addEventListener('click', () => { anchorDate = new Date(); render(); });
document.getElementById('checkin-start').addEventListener('click', () => { applyCheckinDecisions(); completeCheckin(); });

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  state = loadState();
  const today = todayStr();
  if (state.lastCheckinDate !== today) {
    const past = getIncompletePast();
    if (past.length > 0) showCheckin();
    else { state.lastCheckinDate = today; saveState(); }
  }
  render();
}

init();
