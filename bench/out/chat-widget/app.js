"use strict";
/* Boxly chat widget — both-way append, scroll pinned to newest, send disabled on empty, retryable error state. */

const els = {
  messages: document.querySelector("#messages"),
  form: document.querySelector("#composer"),
  input: document.querySelector("#input"),
  send: document.querySelector("#send"),
  banner: document.querySelector("#error-banner"),
  retry: document.querySelector("#retry"),
};

let pendingReply = null; // { text, timer } for the current simulated network reply
let lastFailedText = null; // the text of the reply that failed — what Retry re-sends
let forceFailCount = 0; // consumed by the next send (test hook only)

const REPLIES = [
  "Thanks for reaching out — I'll look into it right away.",
  "Understood! Would you like the full walkthrough?",
  "Got it. I've escalated this to our engineers.",
];

function append(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  els.messages.appendChild(div);
  return div;
}

function pinToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function failAfterDelay(replyText, ms) {
  lastFailedText = replyText;
  pendingReply = setTimeout(() => {
    els.banner.hidden = false;
    pendingReply = null;
  }, ms);
}

function replyAfterDelay(replyText, ms) {
  pendingReply = setTimeout(() => {
    append(replyText, "theirs");
    pinToBottom();
    pendingReply = null;
  }, ms);
}

function sendMessage() {
  const text = els.input.value.trim();
  if (!text) return;
  append(text, "mine");
  els.input.value = "";
  els.send.disabled = true;
  pinToBottom();

  // "network" — deterministic counter so the widget replies alternately (but reliably)
  const n = (Array.from(document.querySelectorAll(".msg.mine")).length) % REPLIES.length;
  const reply = `Echo: ${text.slice(0, 40)}… ${REPLIES[n]}`;
  if (forceFailCount > 0) {
    forceFailCount--; // test hook: next reply fails instead of landing
    failAfterDelay(reply, 120);
  } else {
    replyAfterDelay(reply, 500);
  }
}

els.input.addEventListener("input", () => {
  els.send.disabled = els.input.value.trim().length === 0;
});

els.send.disabled = true;
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});

els.retry.addEventListener("click", () => {
  if (!lastFailedText) return;
  const text = lastFailedText;
  lastFailedText = null;
  if (pendingReply) clearTimeout(pendingReply);
  pendingReply = null;
  els.banner.hidden = true;
  append("Retrying…", "theirs");
  replyAfterDelay(text, 500);
});

// expose a hook so the verifier can force a failure deterministically
window.__failNextReply = () => { forceFailCount = 1; };