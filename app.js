'use strict';

const STORAGE_KEY = 'weekplanner_data';
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

let anchorDate = new Date();
let state = loadState();

// ── Storage ───────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { tasks: {} };
  } catch {
    return { tasks: {} };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('Could not save to localStorage');
  }
}

// ── Date Helpers ──────────────────────────────────────────────────────────────

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function getWeekDates(anchor) {
  const monday = new Date(anchor);
  const day = monday.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatWeekLabel(dates) {
  const first = dates[0];
  const last = dates[6];
  if (first.getMonth() === last.getMonth()) {
    return `${MONTH_NAMES[first.getMonth()]} ${first.getDate()}\u2013${last.getDate()}, ${first.getFullYear()}`;
  }
  if (first.getFullYear() === last.getFullYear()) {
    return `${MONTH_NAMES[first.getMonth()]} ${first.getDate()} \u2013 ${MONTH_NAMES[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
  }
  return `${MONTH_NAMES[first.getMonth()]} ${first.getDate()}, ${first.getFullYear()} \u2013 ${MONTH_NAMES[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
}

// ── Task Mutations ────────────────────────────────────────────────────────────

function addTask(dateStr, text) {
  text = text.trim();
  if (!text) return;
  if (!state.tasks[dateStr]) state.tasks[dateStr] = [];
  state.tasks[dateStr].push({
    id: crypto.randomUUID(),
    text,
    completed: false,
    createdAt: Date.now(),
  });
  saveState();
  render();
}

function toggleTask(dateStr, id) {
  const tasks = state.tasks[dateStr];
  if (!tasks) return;
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveState();
    render();
  }
}

function deleteTask(dateStr, id) {
  if (!state.tasks[dateStr]) return;
  state.tasks[dateStr] = state.tasks[dateStr].filter(t => t.id !== id);
  saveState();
  render();
}

function editTask(dateStr, id, newText) {
  newText = newText.trim();
  if (!newText) return;
  const tasks = state.tasks[dateStr];
  if (!tasks) return;
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.text = newText;
    saveState();
    render();
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const dates = getWeekDates(anchorDate);
  const today = todayStr();

  document.getElementById('week-label').textContent = formatWeekLabel(dates);

  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  dates.forEach((date, i) => {
    const dateStr = toDateStr(date);
    const isToday = dateStr === today;
    const tasks = state.tasks[dateStr] || [];

    const col = document.createElement('div');
    col.className = 'day-column' + (isToday ? ' today' : '');
    col.dataset.date = dateStr;

    // Header
    const header = document.createElement('div');
    header.className = 'day-header';
    header.innerHTML = `
      <div class="day-name">${DAY_NAMES[i]}</div>
      <div class="day-number">${date.getDate()}</div>
    `;
    col.appendChild(header);

    // Task list
    const ul = document.createElement('ul');
    ul.className = 'task-list';

    tasks.forEach(task => {
      const li = createTaskElement(dateStr, task);
      ul.appendChild(li);
    });

    col.appendChild(ul);

    // Add task input
    const addArea = document.createElement('div');
    addArea.className = 'add-task';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'add-task-input';
    input.placeholder = 'Add task\u2026';
    input.maxLength = 200;
    input.setAttribute('aria-label', `Add task for ${DAY_NAMES[i]} ${date.getDate()}`);

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        addTask(dateStr, input.value);
        const newInput = document.querySelector(`.day-column[data-date="${dateStr}"] .add-task-input`);
        if (newInput) newInput.focus();
      }
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.innerHTML = '+';
    addBtn.setAttribute('aria-label', 'Add task');
    addBtn.addEventListener('click', () => {
      addTask(dateStr, input.value);
      const newInput = document.querySelector(`.day-column[data-date="${dateStr}"] .add-task-input`);
      if (newInput) newInput.focus();
    });

    addArea.appendChild(input);
    addArea.appendChild(addBtn);
    col.appendChild(addArea);

    grid.appendChild(col);
  });
}

function createTaskElement(dateStr, task) {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.completed ? ' completed' : '');
  li.dataset.id = task.id;

  // Check button
  const checkBtn = document.createElement('button');
  checkBtn.className = 'check-btn';
  checkBtn.innerHTML = '&#10003;';
  checkBtn.setAttribute('aria-label', task.completed ? 'Mark incomplete' : 'Mark complete');
  checkBtn.addEventListener('click', () => toggleTask(dateStr, task.id));

  // Task content
  const content = document.createElement('div');
  content.className = 'task-content';

  const span = document.createElement('span');
  span.className = 'task-text';
  span.textContent = task.text;
  content.appendChild(span);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn edit-btn';
  editBtn.innerHTML = '&#9998;';
  editBtn.setAttribute('aria-label', 'Edit task');
  editBtn.addEventListener('click', () => startEdit(li, content, dateStr, task));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn delete-btn';
  deleteBtn.innerHTML = '&#10005;';
  deleteBtn.setAttribute('aria-label', 'Delete task');
  deleteBtn.addEventListener('click', () => deleteTask(dateStr, task.id));

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  li.appendChild(checkBtn);
  li.appendChild(content);
  li.appendChild(actions);

  return li;
}

function startEdit(li, content, dateStr, task) {
  const span = content.querySelector('.task-text');
  if (!span) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-edit-input';
  input.value = task.text;
  input.maxLength = 200;

  content.replaceChild(input, span);
  input.focus();
  input.select();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const newText = input.value.trim();
    if (newText && newText !== task.text) {
      editTask(dateStr, task.id, newText);
    } else {
      render(); // restore original
    }
  }

  function cancel() {
    if (committed) return;
    committed = true;
    render();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
    e.stopPropagation();
  });

  input.addEventListener('blur', commit);
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.getElementById('prev-week').addEventListener('click', () => {
  anchorDate.setDate(anchorDate.getDate() - 7);
  render();
});

document.getElementById('next-week').addEventListener('click', () => {
  anchorDate.setDate(anchorDate.getDate() + 7);
  render();
});

document.getElementById('today-btn').addEventListener('click', () => {
  anchorDate = new Date();
  render();
});

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', render);
render();
