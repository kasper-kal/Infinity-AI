"use strict";
/* DoIt — todo app with localStorage persistence. */
const STORAGE_KEY = "bench.todos.v1";

const state = {
  todos: load(),
  filter: "all",
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) => t && typeof t.text === "string" && t.text.trim() && typeof t.done === "boolean"
    );
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
}

const els = {
  form: document.querySelector("#add-form"),
  input: document.querySelector("#new-todo"),
  addBtn: document.querySelector("#add-todo"),
  counter: document.querySelector("#counter"),
  list: document.querySelector("#todos"),
  fullEmpty: document.querySelector("#full-empty"),
  filterEmpty: document.querySelector("#filter-empty"),
  clearBtn: document.querySelector("#clear-completed"),
  filters: Array.from(document.querySelectorAll(".filter")),
};

let nextId = state.todos.reduce((m, t) => Math.max(m, t.id ?? 0), 0) + 1;

function render() {
  const visible = state.todos.filter((t) => {
    if (state.filter === "active") return !t.done;
    if (state.filter === "completed") return t.done;
    return true;
  });

  els.list.innerHTML = "";
  for (const t of visible) {
    const li = document.createElement("li");
    li.dataset.text = t.text;
    li.dataset.done = String(t.done);
    if (t.done) li.classList.add("done");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = t.done;
    check.setAttribute("aria-label", "Mark done");
    check.addEventListener("change", () => { t.done = check.checked; save(); render(); });

    const span = document.createElement("span");
    span.className = "text";
    span.textContent = t.text;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Delete todo");
    del.addEventListener("click", () => { state.todos = state.todos.filter((x) => x !== t); save(); render(); });

    li.append(check, span, del);
    els.list.appendChild(li);
  }

  const remaining = state.todos.filter((t) => !t.done).length;
  els.counter.textContent = `${remaining} item${remaining === 1 ? "" : "s"} left`;

  els.fullEmpty.hidden = state.todos.length !== 0;
  els.filterEmpty.hidden = !(state.todos.length > 0 && visible.length === 0);
  els.clearBtn.hidden = !state.todos.some((t) => t.done);
  els.input.focus();
}

els.addBtn.disabled = true;
els.input.addEventListener("input", () => {
  els.addBtn.disabled = els.input.value.trim().length === 0;
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  state.todos.push({ id: nextId++, text, done: false });
  save();
  render();
  els.input.value = "";
  els.addBtn.disabled = true;
});

for (const btn of els.filters) {
  btn.addEventListener("click", () => {
    state.filter = btn.dataset.filter;
    for (const other of els.filters) {
      const active = other === btn;
      other.classList.toggle("active", active);
      other.setAttribute("aria-pressed", String(active));
    }
    render();
  });
}

els.clearBtn.addEventListener("click", () => {
  state.todos = state.todos.filter((t) => !t.done);
  save();
  render();
});

render();