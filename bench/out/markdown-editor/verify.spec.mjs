/**
 * markdown-editor acceptance criteria:
 * Live preview matches source · source/preview toggle works · unsaved-changes hint · `npm run build` green.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";

const { renderMarkdown } = await import(pathToFileURL(path.join(process.cwd(), "bench/out/markdown-editor/src/markdown.js")).href);

export const readySelector = "#editor";

export async function checks(page, ctx) {
  const r = [];

  // ---- unit: the parser turns real markdown into correct HTML
  const html = renderMarkdown(
    "# Heading\n\n**bold** *italic* `code` [link](https://x.dev)\n\n- one\n- two\n\n> quote\n"
  );
  const unit = {
    h1: html.includes("<h1>Heading</h1>"),
    strong: html.includes("<strong>bold</strong>"),
    em: html.includes("<em>italic</em>"),
    code: html.includes("<code>code</code>"),
    link: html.includes('href="https://x.dev"'),
    list: html.includes("<li>one</li>") && html.includes("<li>two</li>"),
    quote: html.includes("<blockquote>quote</blockquote>"),
    escaped: !renderMarkdown("<script>alert(1)</script>").includes("<script>"),
  };
  const failed = Object.entries(unit).filter(([, v]) => !v).map(([k]) => k);
  r.push({
    name: "parser_renders_markdown",
    pass: failed.length === 0,
    detail: failed.length ? `missing: ${failed.join(",")}` : "h1+strong+em+code+link+list+quote all correct",
  });
  r.push({ name: "parser_escapes_html", pass: unit.escaped === true, detail: "raw <script> stays escaped" });

  // ---- dirty hint must start hidden (clean store)
  const dirtyInitiallyHidden = !(await page.evaluate(() => document.querySelector("#dirty").hidden === false));

  // ---- live preview matches source: type markdown into the editor, read the preview
  await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    editor.value = "# Heading\n\n**bold** and *italic*\n\n- one\n- two";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const previewContent = await page.evaluate(() => document.querySelector("#preview").innerHTML);
  const live = {
    h1: previewContent.includes("<h1>Heading</h1>"),
    strong: previewContent.includes("<strong>bold</strong>"),
    em: previewContent.includes("<em>italic</em>"),
    li: previewContent.includes("<li>one</li>") && previewContent.includes("<li>two</li>"),
  };
  const failedLive = Object.entries(live).filter(([, v]) => !v).map(([k]) => k);
  r.push({
    name: "live_preview_matches_source",
    pass: failedLive.length === 0,
    detail: failedLive.length ? `missing: ${failedLive.join(",")}` : "live preview renders source markup",
  });

  // ---- unsaved-changes hint: typing marks dirty, save clears it, Save disabled while clean
  const dirtyVisible = () => page.evaluate(() => document.querySelector("#dirty").hidden === false);
  const saveDisabled = () => page.evaluate(() => document.querySelector("#save").disabled);
  r.push({
    name: "dirty_hint_shown_on_edit",
    pass: (await dirtyVisible()) === true && dirtyInitiallyHidden === true,
    detail: `dirtyVisible=${await dirtyVisible()} initiallyHidden=${dirtyInitiallyHidden}`,
  });
  r.push({ name: "save_disabled_when_clean", pass: (await saveDisabled()) === false, detail: `save.disabled=${await saveDisabled()}` });

  await page.click("#save");
  const dirtyCleared = (await dirtyVisible()) === false;
  const saveDisabledAfter = await saveDisabled();
  r.push(
    { name: "save_clears_dirty_hint", pass: dirtyCleared === true, detail: `dirtyVisible=${dirtyCleared}` },
    { name: "save_disabled_after_save", pass: saveDisabledAfter === true, detail: `save.disabled=${saveDisabledAfter}` }
  );

  // ---- unsaved-changes guard: navigating while dirty must raise the browser warning
  await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    editor.value += "\n\n# more unsaved";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  let guardDialog = false;
  page.on("dialog", async (d) => {
    guardDialog = true;
    await d.dismiss(); // "stay on page" — cancels the navigation so we keep the editor
  });
  await page
    .goto(ctx.url + "__beforeunload-probe", { waitUntil: "domcontentloaded", timeout: 3000 })
    .catch(() => {}); // dismissed dialog cancels the navigation; the goto rejects — expected
  await new Promise((resolve) => setTimeout(resolve, 200));
  const stayedOnApp = await page.evaluate(() => document.querySelector("#editor") !== null);
  r.push({
    name: "unsaved_changes_guard",
    pass: guardDialog === true && stayedOnApp === true,
    detail: `beforeunload dialog fired=${guardDialog} stayedOnApp=${stayedOnApp}`,
  });

  // ---- toggle works: split → edit-only → preview-only
  const panesVisible = async () => page.evaluate(() => ({
    edit: document.querySelector(".edit-pane").style.display,
    preview: document.querySelector(".preview-pane").style.display,
  }));

  await page.click('[data-mode="edit"]');
  let pv = await panesVisible();
  r.push({ name: "edit_mode", pass: pv.edit === "block" && pv.preview === "none", detail: `edit=${pv.edit} preview=${pv.preview}` });

  await page.click('[data-mode="preview"]');
  pv = await panesVisible();
  r.push({ name: "preview_mode", pass: pv.preview === "block" && pv.edit === "none", detail: `edit=${pv.edit} preview=${pv.preview}` });

  await page.click('[data-mode="split"]');
  pv = await panesVisible();
  r.push({ name: "split_mode", pass: pv.edit === "block" && pv.preview === "block", detail: `edit=${pv.edit} preview=${pv.preview}` });

  return r;
}