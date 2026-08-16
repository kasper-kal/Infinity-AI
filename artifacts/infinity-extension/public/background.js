/**
 * Infinity Browser Extension - Background Service Worker
 * Connects to local API server via WebSocket to enable AI control of user's browser
 */

const API_BASE = 'http://127.0.0.1:8080';
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3000;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Infinity] Extension installed');
  connectToServer();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Infinity] Browser started');
  connectToServer();
});

function connectToServer() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket('ws://127.0.0.1:8080/api/jarvis/extension/ws');

    ws.onopen = () => {
      console.log('[Infinity] Connected to API server');
      reconnectAttempts = 0;

      // Register this extension instance
      ws.send(JSON.stringify({
        type: 'register',
        extensionId: chrome.runtime.id,
        timestamp: Date.now()
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (err) {
        console.error('[Infinity] Failed to parse server message:', err);
      }
    };

    ws.onclose = (event) => {
      console.log('[Infinity] Disconnected from API server:', event.code, event.reason);
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.error('[Infinity] WebSocket error:', error);
    };
  } catch (err) {
    console.error('[Infinity] Failed to create WebSocket:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('[Infinity] Max reconnect attempts reached');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts - 1), 30000);
  console.log(`[Infinity] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  setTimeout(connectToServer, delay);
}

async function handleServerMessage(message) {
  console.log('[Infinity] Received message:', message.type);

  switch (message.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    case 'execute_action':
      await executeAction(message.actionId, message.action, message.tabId);
      break;

    case 'navigate':
      await navigateTab(message.tabId, message.url);
      break;

    case 'get_tabs':
      await sendTabsList();
      break;

    case 'get_tab_content':
      await sendTabContent(message.tabId);
      break;

    case 'evaluate_script':
      await evaluateScript(message.tabId, message.script, message.actionId);
      break;

    case 'screenshot':
      await captureScreenshot(message.tabId, message.actionId);
      break;

    case 'get_interactive_elements':
      await getInteractiveElements(message.tabId, message.actionId, message.selector);
      break;

    default:
      console.warn('[Infinity] Unknown message type:', message.type);
  }
}

async function executeAction(actionId, action, tabId) {
  try {
    const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
    if (!tab) throw new Error('No tab available');

    let result;
    switch (action.type) {
      case 'click':
        result = await clickElement(tab.id, action.selector, action.index);
        break;
      case 'type':
        result = await typeText(tab.id, action.selector, action.text, action.index);
        break;
      case 'select':
        result = await selectOption(tab.id, action.selector, action.value, action.index);
        break;
      case 'press':
        result = await pressKey(tab.id, action.selector, action.key, action.index);
        break;
      case 'scroll':
        result = await scrollPage(tab.id, action.direction, action.amount);
        break;
      case 'hover':
        result = await hoverElement(tab.id, action.selector, action.index);
        break;
      case 'focus':
        result = await focusElement(tab.id, action.selector, action.index);
        break;
      case 'clear':
        result = await clearInput(tab.id, action.selector, action.index);
        break;
      case 'wait':
        await sleep(action.ms || 500);
        result = { success: true, action: 'wait' };
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    sendResult(actionId, { success: true, data: result });
  } catch (err) {
    console.error('[Infinity] Action failed:', err);
    sendResult(actionId, { success: false, error: err.message });
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function clickElement(tabId, selector, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      elements[index].click();
      return { clicked: true, tagName: elements[index].tagName };
    },
    args: [selector, index]
  });
}

async function typeText(tabId, selector, text, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index, text) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      const element = elements[index];
      element.focus();
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, value: element.value, tagName: element.tagName };
    },
    args: [selector, index, text]
  });
}

async function selectOption(tabId, selector, value, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index, value) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      const element = elements[index];
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: true, value: element.value };
    },
    args: [selector, index, value]
  });
}

async function pressKey(tabId, selector, key, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index, key) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      const element = elements[index];
      element.focus();
      const event = new KeyboardEvent('keydown', { key, bubbles: true });
      element.dispatchEvent(event);
      return { pressed: true, key };
    },
    args: [selector, index, key]
  });
}

async function scrollPage(tabId, direction, amount = 300) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (direction, amount) => {
      const scrollAmount = direction === 'up' ? -amount : amount;
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      return { scrolled: true, direction, amount: scrollAmount };
    },
    args: [direction, amount]
  });
}

async function hoverElement(tabId, selector, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      const event = new MouseEvent('mouseover', { bubbles: true });
      elements[index].dispatchEvent(event);
      return { hovered: true };
    },
    args: [selector, index]
  });
}

async function focusElement(tabId, selector, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      elements[index].focus();
      return { focused: true };
    },
    args: [selector, index]
  });
}

async function clearInput(tabId, selector, index = 0) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, index) => {
      const elements = document.querySelectorAll(selector);
      if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
      elements[index].value = '';
      elements[index].dispatchEvent(new Event('input', { bubbles: true }));
      elements[index].dispatchEvent(new Event('change', { bubbles: true }));
      return { cleared: true };
    },
    args: [selector, index]
  });
}

async function navigateTab(tabId, url) {
  try {
    const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
    if (!tab) throw new Error('No tab available');

    await chrome.tabs.update(tab.id, { url });

    // Wait for navigation to complete
    await new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout after 30 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);
    });

    sendResult('navigate', { success: true, url, tabId: tab.id });
  } catch (err) {
    sendResult('navigate', { success: false, error: err.message });
  }
}

async function sendTabsList() {
  try {
    const tabs = await chrome.tabs.query({});
    const tabList = tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      active: tab.active,
      pinned: tab.pinned,
      windowId: tab.windowId,
      status: tab.status
    }));
    sendResult('tabs_list', { success: true, tabs: tabList });
  } catch (err) {
    sendResult('tabs_list', { success: false, error: err.message });
  }
}

async function sendTabContent(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error('Tab not found');

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: window.location.href,
        title: document.title,
        html: document.documentElement.outerHTML.slice(0, 50000),
        textContent: document.body?.innerText?.slice(0, 50000) || '',
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })
    });

    sendResult('tab_content', { success: true, data: results[0]?.result });
  } catch (err) {
    sendResult('tab_content', { success: false, error: err.message });
  }
}

async function evaluateScript(tabId, script, actionId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (script) => {
        // eslint-disable-next-line no-eval
        return eval(script);
      },
      args: [script]
    });

    sendResult(actionId || 'evaluate', { success: true, result: results[0]?.result });
  } catch (err) {
    sendResult(actionId || 'evaluate', { success: false, error: err.message });
  }
}

async function captureScreenshot(tabId, actionId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 80 });
    sendResult(actionId || 'screenshot', { success: true, screenshot: dataUrl });
  } catch (err) {
    sendResult(actionId || 'screenshot', { success: false, error: err.message });
  }
}

async function getInteractiveElements(tabId, actionId, selector) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const elements = document.querySelectorAll(selector || 'button, a, input, textarea, select, [role="button"], [onclick]');
        return Array.from(elements).slice(0, 100).map((el, index) => ({
          index,
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          text: el.innerText?.slice(0, 200) || '',
          value: el.value || '',
          type: el.type || '',
          href: el.href || '',
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          role: el.getAttribute('role') || '',
          disabled: el.disabled,
          visible: el.offsetWidth > 0 && el.offsetHeight > 0,
          rect: el.getBoundingClientRect()
        }));
      },
      args: [selector]
    });

    sendResult(actionId || 'interactive_elements', { success: true, elements: results[0]?.result || [] });
  } catch (err) {
    sendResult(actionId || 'interactive_elements', { success: false, error: err.message });
  }
}

function sendResult(actionId, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'action_result',
      actionId,
      ...payload,
      timestamp: Date.now()
    }));
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_connection_status') {
    sendResponse({
      connected: ws && ws.readyState === WebSocket.OPEN,
      reconnectAttempts
    });
    return true;
  }

  if (message.type === 'connect') {
    connectToServer();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'disconnect') {
    if (ws) {
      ws.close(1000, 'User requested disconnect');
      ws = null;
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});

console.log('[Infinity] Background service worker loaded');