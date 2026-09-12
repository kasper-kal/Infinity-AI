"use strict";
/* Pulse — revenue dashboard: loading state, real data table + SVG-free bar chart, filters, empty states. */

const els = {
  loading: document.querySelector("#loading"),
  chart: document.querySelector("#chart"),
  chartEmpty: document.querySelector("#chart-empty"),
  rowsBody: document.querySelector("#rows"),
  rowsEmpty: document.querySelector("#rows-empty"),
  count: document.querySelector("#count"),
  category: document.querySelector("#filter-category"),
  status: document.querySelector("#filter-status"),
  search: document.querySelector("#filter-search"),
};

const CATS = ["Analytics", "Payments", "Support"];
const STATUSES = ["Active", "Paused", "Failed"];
const PRODUCTS = {
  Analytics: ["Trackr", "Funnely", "Cohort", "Heatmap Pro", "Segment"],
  Payments: ["Checkout", "Invoicer", "Subscriptions", "Payouts"],
  Support: ["Desk", "LiveChat", "Guidebase"],
};
const REGIONS = ["EMEA", "APAC", "US East", "US West", "LATAM"];

/** Deterministic in-page data generator — this is the single source the table AND chart render from. */
function generateData(n = 24) {
  const rng = (seed) => () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const rand = rng(42);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const cat = CATS[Math.floor(rand() * CATS.length)];
    const pool = PRODUCTS[cat];
    rows.push({
      id: i + 1,
      product: pool[Math.floor(rand() * pool.length)],
      category: cat,
      region: REGIONS[Math.floor(rand() * REGIONS.length)],
      status: STATUSES[Math.floor(rand() * STATUSES.length)],
      revenue: Math.round((800 + rand() * 4200) * 100) / 100,
    });
  }
  return rows;
}

/** fake network fetch — proves the loading state is real precedence */
function fetchData() {
  return new Promise((resolve) => setTimeout(() => resolve(generateData()), 450));
}

let rows = [];

function currentFilters() {
  const q = els.search.value.trim().toLowerCase();
  return rows.filter((r) => {
    const catOk = els.category.value === "all" || r.category === els.category.value;
    const stOk = els.status.value === "all" || r.status === els.status.value;
    const qOk =
      !q ||
      r.product.toLowerCase().includes(q) ||
      r.region.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q);
    return catOk && stOk && qOk;
  });
}

const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function renderChart(data) {
  els.chart.innerHTML = "";
  els.chartEmpty.hidden = data.length !== 0;
  els.chart.hidden = data.length === 0;
  if (!data.length) return;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  for (const d of data) {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.max(4, (d.revenue / max) * 100)}%`;
    bar.title = `${d.product} — ${money(d.revenue)}`;
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = d.product;
    bar.appendChild(lbl);
    els.chart.appendChild(bar);
  }
}

function renderTable(data) {
  els.rowsBody.innerHTML = "";
  for (const r of data) {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    const cell = (txt, cls) => {
      const td = document.createElement("td");
      td.textContent = txt;
      if (cls) td.className = cls;
      return td;
    };
    const st = document.createElement("span");
    st.className = `status ${r.status}`;
    st.textContent = r.status;
    const stTd = document.createElement("td");
    stTd.appendChild(st);
    tr.append(
      cell(r.product),
      cell(r.category),
      cell(r.region),
      stTd,
      cell(money(r.revenue), "num")
    );
    els.rowsBody.appendChild(tr);
  }
  els.rowsEmpty.hidden = data.length !== 0;
  els.count.textContent = `${data.length} order${data.length === 1 ? "" : "s"}`;
}

function applyFilters() {
  const data = currentFilters();
  renderChart(data);
  renderTable(data);
}

async function init() {
  try {
    els.loading.hidden = false;
    rows = await fetchData();
    applyFilters();
  } finally {
    els.loading.hidden = true;
  }
}

els.category.addEventListener("change", applyFilters);
els.status.addEventListener("change", applyFilters);
els.search.addEventListener("input", applyFilters);
init();