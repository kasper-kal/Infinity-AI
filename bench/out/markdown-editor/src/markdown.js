// ---- tiny markdown renderer (pure module — imported by both the app and the verify spec)
// ---- tiny markdown renderer (block + inline) — input is UNTRUSTED text */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(src) {
  let s = escapeHtml(src);
  // `code`
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // [text](url) — only http(s) + mailto allowed, everything else stripped to text
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s)]+)|mailto:[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}" rel="noopener" target="_blank">${text}</a>`);
  // **bold**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // *italic*
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  // ~~strike~~
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return s;
}

export function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let listBuf = [];

  const flushList = () => {
    if (listBuf.length) {
      out.push(`<ul>${listBuf.map((l) => `<li>${l}</li>`).join("")}</ul>`);
      listBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(renderInline(line.replace(/^\s*[-*]\s+/, "")));
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushList();
      out.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^```/.test(line)) {
      flushList();
      // gather the fenced block until the closing fence
      const blockLines = [];
      let j = i + 1;
      while (j < lines.length && !/^```/.test(lines[j])) blockLines.push(lines[j++]);
      i = j; // consume through the fence
      out.push(`<pre><code>${escapeHtml(blockLines.join("\n"))}</code></pre>`);
      continue;
    }
    flushList();
    if (line.trim() === "") { out.push(""); continue; }
    out.push(`<p>${renderInline(line)}</p>`);
  }
  flushList();
  return out.join("\n");
}
