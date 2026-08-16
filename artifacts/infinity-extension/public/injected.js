/**
 * Infinity Browser Extension - Injected Script
 * Runs in the page context (not content script context) for direct DOM access
 * This is used for operations that need direct access to page variables
 */

// Expose a minimal API for page-level operations
window.__INFINITY_INJECTED__ = {
  // Get all cookies for the current domain
  getCookies() {
    return document.cookie.split(';').map(c => c.trim()).filter(c => c);
  },

  // Get localStorage items
  getLocalStorage() {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) items[key] = localStorage.getItem(key);
    }
    return items;
  },

  // Get sessionStorage items
  getSessionStorage() {
    const items = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) items[key] = sessionStorage.getItem(key);
    }
    return items;
  },

  // Execute code in page context (use with caution)
  eval(script) {
    // eslint-disable-next-line no-eval
    return eval(script);
  },

  // Get performance timing
  getPerformanceTiming() {
    return window.performance.timing ? JSON.parse(JSON.stringify(window.performance.timing)) : null;
  },

  // Get network information
  getNetworkInfo() {
    if (navigator.connection) {
      return {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      };
    }
    return null;
  }
};

// Signal that injection is ready
document.dispatchEvent(new CustomEvent('infinity:injected-ready', {
  detail: { timestamp: Date.now() }
}));

console.log('[Infinity] Injected script loaded');