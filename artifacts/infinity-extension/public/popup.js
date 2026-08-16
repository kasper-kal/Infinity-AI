/**
 * Infinity Browser Extension - Popup Script
 */

const API_BASE = 'http://127.0.0.1:8080';

const statusEl = document.getElementById('status');
const statusDotEl = document.getElementById('statusDot');
const statusTextEl = document.getElementById('statusText');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const getTabsBtn = document.getElementById('getTabsBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const tabListEl = document.getElementById('tabList');
const logContainerEl = document.getElementById('logContainer');

let isConnected = false;

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainerEl.insertBefore(entry, logContainerEl.firstChild);

  // Keep only last 50 entries
  while (logContainerEl.children.length > 50) {
    logContainerEl.removeChild(logContainerEl.lastChild);
  }
}

function setConnected(connected) {
  isConnected = connected;
  if (connected) {
    statusEl.className = 'status connected';
    statusDotEl.className = 'dot pulse';
    statusTextEl.textContent = 'Connected';
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    getTabsBtn.disabled = false;
  } else {
    statusEl.className = 'status disconnected';
    statusDotEl.className = 'dot';
    statusTextEl.textContent = 'Disconnected';
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    getTabsBtn.disabled = true;
  }
}

async function checkConnection() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_connection_status' });
    setConnected(response.connected);
    if (response.connected) {
      log('Already connected to Infinity server', 'success');
    }
  } catch (err) {
    log('Extension context not ready', 'warning');
  }
}

async function connect() {
  log('Connecting to Infinity server...', 'info');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'connect' });
    if (response.success) {
      log('Connection initiated', 'success');
      // Poll for connection status
      const interval = setInterval(async () => {
        const status = await chrome.runtime.sendMessage({ type: 'get_connection_status' });
        if (status.connected) {
          clearInterval(interval);
          setConnected(true);
          log('Connected to Infinity server', 'success');
        }
      }, 500);
      setTimeout(() => clearInterval(interval), 10000);
    }
  } catch (err) {
    log(`Connection failed: ${err.message}`, 'error');
  }
}

async function disconnect() {
  try {
    await chrome.runtime.sendMessage({ type: 'disconnect' });
    setConnected(false);
    log('Disconnected from Infinity server', 'info');
  } catch (err) {
    log(`Disconnect failed: ${err.message}`, 'error');
  }
}

async function getTabs() {
  log('Fetching open tabs...', 'info');
  try {
    const tabs = await chrome.tabs.query({});
    renderTabs(tabs);
    log(`Found ${tabs.length} open tabs`, 'success');
  } catch (err) {
    log(`Failed to get tabs: ${err.message}`, 'error');
  }
}

function renderTabs(tabs) {
  if (tabs.length === 0) {
    tabListEl.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <p>No tabs found</p>
      </div>
    `;
    return;
  }

  tabListEl.innerHTML = tabs.map(tab => `
    <div class="tab-item ${tab.active ? 'active' : ''}" data-tab-id="${tab.id}">
      ${tab.favIconUrl ? `<img class="tab-favicon" src="${tab.favIconUrl}" alt="">` : '<div class="tab-favicon" style="background:#e8e8ed;"></div>'}
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(tab.title || 'New Tab')}</div>
        <div class="tab-url">${escapeHtml(tab.url || '')}</div>
      </div>
      ${tab.active ? '<span class="tab-badge">ACTIVE</span>' : ''}
    </div>
  `).join('');

  // Add click handlers
  tabListEl.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabId = parseInt(item.dataset.tabId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function clearLog() {
  logContainerEl.innerHTML = '';
}

// Event listeners
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
getTabsBtn.addEventListener('click', getTabs);
clearLogBtn.addEventListener('click', clearLog);

// Initialize
checkConnection();
log('Infinity Browser Control loaded', 'info');

// Listen for connection changes from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'connection_changed') {
    setConnected(message.connected);
    log(message.connected ? 'Connected to server' : 'Disconnected from server', message.connected ? 'success' : 'warning');
  }
});