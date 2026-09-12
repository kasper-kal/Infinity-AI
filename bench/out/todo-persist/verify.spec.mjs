/**
 * todo-persist acceptance criteria:
 * Add / complete / delete / filter all work · state survives reload · empty-state · no console errors.
 */
export const readySelector = "#todos";

export async function checks(page) {
  const r = [];

  const counts = () =>
    page.evaluate(() => ({
      rows: document.querySelectorAll("#todos li").length,
      done: document.querySelectorAll("#todos li.done").length,
      counter: document.querySelector("#counter").textContent.trim(),
      fullEmptyVisible: document.querySelector("#full-empty").hidden === false,
      filterEmptyVisible: document.querySelector("#filter-empty").hidden === false,
      addDisabled: document.querySelector("#add-todo").disabled,
      visibleRows: Array.from(document.querySelectorAll("#todos li")).filter((li) => li.offsetParent !== null).length,
    }));

  const add = async (text) => {
    await page.focus("#new-todo");
    await page.type("#new-todo", text);
    await page.click("#add-todo");
  };

  // ---- empty-input guard + full empty-state
  let c = await counts();
  r.push(
    { name: "add_disabled_on_empty_input", pass: c.addDisabled === true, detail: `button.disabled=${c.addDisabled}` },
    { name: "empty_state_renders", pass: c.fullEmptyVisible === true, detail: "“No todos yet” shown on a fresh store" }
  );

  // ---- add three
  await add("Alpha");
  await add("Beta");
  await add("Gamma");
  c = await counts();
  r.push({ name: "add_creates", pass: c.rows === 3, detail: `rows=${c.rows}` });

  // ---- complete the second item
  await page.evaluate(() => {
    document.querySelectorAll("#todos li")[1].querySelector("input[type=checkbox]").click();
  });
  c = await counts();
  const texts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#todos li")).map((li) => `${li.dataset.text}:${li.dataset.done}`)
  );
  r.push(
    { name: "complete_works", pass: c.done === 1, detail: `checked=${c.done} [${texts}]` },
    { name: "counter_updates", pass: c.counter === "2 items left", detail: `"${c.counter}"` }
  );

  // ---- filters: active / completed / all
  await page.click('[data-filter="active"]');
  c = await counts();
  r.push({ name: "filter_active", pass: c.visibleRows === 2, detail: `visible=${c.visibleRows}` });

  await page.click('[data-filter="completed"]');
  c = await counts();
  r.push({ name: "filter_completed", pass: c.visibleRows === 1, detail: `visible=${c.visibleRows}` });

  await page.click('[data-filter="all"]');
  c = await counts();
  r.push({ name: "filter_all", pass: c.visibleRows === 3, detail: `visible=${c.visibleRows}` });

  // ---- empty state for a filter with nothing in it:
  //      selectively hide "active" rows, then filter "completed"→1, "active"→2, so test the REAL filtered-empty by
  //      deleting the completed item first, then "completed" filter shows the empty message.
  await page.evaluate(() => {
    document.querySelector("#todos li button.del").click(); // deletes Alpha (first, active)
  });
  await page.click('[data-filter="completed"]');
  await page.evaluate(() => {
    for (const li of document.querySelectorAll("#todos li")) {
      if (li.dataset.done === "true") li.querySelector("button.del").click(); // deletes Beta (completed)
    }
  });
  c = await counts();
  r.push(
    { name: "filtered_empty_state", pass: c.visibleRows === 0 && c.filterEmptyVisible === true, detail: `visible=${c.visibleRows} emptyMsg=${c.filterEmptyVisible}` },
    { name: "delete_works", pass: c.rows === 0, detail: `rows=${c.rows}` }
  );

  await page.click('[data-filter="all"]');
  c = await counts();
  r.push({ name: "filter_all_after_deletes", pass: c.rows === 1, detail: `rows=${c.rows} (Gamma remains)` });

  // delete the last remaining item → the full empty-state shows again
  await page.evaluate(() => { document.querySelector("#todos li button.del").click(); });
  c = await counts();
  r.push({ name: "full_empty_returns", pass: c.rows === 0 && c.fullEmptyVisible === true, detail: `rows=${c.rows}` });

  // ---- persistence: start from a known-clean store, then reload
  await page.evaluate(() => localStorage.removeItem("bench.todos.v1"));
  await page.reload({ waitUntil: "networkidle0" });
  await add("Alpha");
  await add("Beta");
  await page.evaluate(() => { document.querySelectorAll("#todos li")[1].querySelector("input[type=checkbox]").click(); });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#todos li:nth-child(2)", { timeout: 5000 }).catch(() => {});
  c = await counts();
  const afterReload = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#todos li")).map((li) => `${li.dataset.text}:${li.dataset.done}`)
  );
  r.push(
    { name: "persists_across_reload", pass: afterReload.join(",") === "Alpha:false,Beta:true", detail: `[${afterReload}]` },
    { name: "completed_state_persists", pass: afterReload.some((s) => s === "Beta:true"), detail: `[${afterReload}]` }
  );

  return r;
}