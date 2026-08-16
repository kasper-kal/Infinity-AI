/**
 * Infinity Browser Extension - Content Script
 * Runs in every page to provide DOM access and element interaction
 */

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'get_interactive_elements':
      getInteractiveElements(message.selector)
        .then(elements => sendResponse({ success: true, elements }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'click_element':
      clickElement(message.selector, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'type_text':
      typeText(message.selector, message.text, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'select_option':
      selectOption(message.selector, message.value, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'press_key':
      pressKey(message.selector, message.key, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'scroll_page':
      scrollPage(message.direction, message.amount)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'hover_element':
      hoverElement(message.selector, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'focus_element':
      focusElement(message.selector, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'clear_input':
      clearInput(message.selector, message.index)
        .then(result => sendResponse({ success: true, ...result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'get_page_content':
      getPageContent()
        .then(content => sendResponse({ success: true, ...content }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'evaluate':
      evaluateScript(message.script)
        .then(result => sendResponse({ success: true, result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      return false;
  }
});

function getInteractiveElements(selector) {
  const elements = document.querySelectorAll(selector || 'button, a, input, textarea, select, [role="button"], [onclick], [href]');
  return Array.from(elements).slice(0, 100).map((el, index) => {
    const rect = el.getBoundingClientRect();
    return {
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
      visible: rect.width > 0 && rect.height > 0 && el.offsetParent !== null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  });
}

function clickElement(selector, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  elements[index].click();
  return { clicked: true, tagName: elements[index].tagName };
}

function typeText(selector, text, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  const element = elements[index];
  element.focus();
  element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { typed: true, value: element.value, tagName: element.tagName };
}

function selectOption(selector, value, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  const element = elements[index];
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { selected: true, value: element.value };
}

function pressKey(selector, key, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  const element = elements[index];
  element.focus();
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  element.dispatchEvent(event);
  return { pressed: true, key };
}

function scrollPage(direction, amount = 300) {
  const scrollAmount = direction === 'up' ? -amount : amount;
  window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
  return { scrolled: true, direction, amount: scrollAmount };
}

function hoverElement(selector, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  const event = new MouseEvent('mouseover', { bubbles: true });
  elements[index].dispatchEvent(event);
  return { hovered: true };
}

function focusElement(selector, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  elements[index].focus();
  return { focused: true };
}

function clearInput(selector, index = 0) {
  const elements = document.querySelectorAll(selector);
  if (!elements[index]) throw new Error(`Element not found: ${selector}[${index}]`);
  elements[index].value = '';
  elements[index].dispatchEvent(new Event('input', { bubbles: true }));
  elements[index].dispatchEvent(new Event('change', { bubbles: true }));
  return { cleared: true };
}

function getPageContent() {
  return {
    url: window.location.href,
    title: document.title,
    html: document.documentElement.outerHTML.slice(0, 50000),
    textContent: document.body?.innerText?.slice(0, 50000) || '',
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
}

function evaluateScript(script) {
  // eslint-disable-next-line no-eval
  return eval(script);
}

// Expose a global API for injected scripts
window.__INFINITY_EXTENSION__ = {
  getInteractiveElements,
  clickElement,
  typeText,
  selectOption,
  pressKey,
  scrollPage,
  hoverElement,
  focusElement,
  clearInput,
  getPageContent,
  evaluateScript
};

console.log('[Infinity] Content script loaded');