/**
 * dashboard acceptance criteria:
 * Data table + chart render REAL data · loading + empty states exist · filters work · responsive.
 */
export const readySelector = "#rows tr";

export async function checks(page) {
  const r = [];

  const rowCount = () => page.evaluate(() => document.querySelectorAll("#rows tr").length);
  const barCount = () => page.evaluate(() => document.querySelectorAll("#chart .bar").length);

  // ---- loading state must exist in the DOM up front
  r.push({
    name: "loading_state_exists",
    pass: (await page.evaluate(() => document.querySelectorAll("#loading").length === 1)),
    detail: "#loading present",
  });

  // ---- real data: table rows === chart bars, non-zero revenue formatted as $
  await page.waitForSelector("#rows tr", { timeout: 10000 });
  const rows = await rowCount();
  const bars = await barCount();
  const sample = await page.evaluate(() => {
    const tr = document.querySelector("#rows tr");
    return { revenueText: tr?.children[4]?.textContent.trim() ?? "", product: tr?.children[0]?.textContent.trim() ?? "" };
  });
  const moneyOK = /^\$\d/.test(sample.revenueText);
  r.push(
    { name: "table_renders_real_data", pass: rows > 0 && moneyOK, detail: `rows=${rows} sample="${sample.product} ${sample.revenueText}"` },
    { name: "chart_renders_real_data", pass: bars > 0 && bars === rows, detail: `bars=${bars} rows=${rows}` },
    { name: "count_shown", pass: (await page.evaluate(() => document.querySelector("#count").textContent)).includes(String(rows)), detail: `count=${rows}` }
  );

  // ---- filters work (category + status + search)
  await page.select("#filter-category", "Payments");
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length > 0, { timeout: 3000 }).catch(() => {});
  let rows2 = await rowCount();
  const allPayments = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#rows tr")).every((tr) => tr.children[1].textContent.trim() === "Payments")
  );
  r.push({
    name: "category_filter_works",
    pass: allPayments && rows2 > 0 && rows2 < rows,
    detail: `rows ${rows}→${rows2} allPayments=${allPayments}`,
  });

  // chart follows the filter too
  const bars2 = await barCount();
  r.push({ name: "chart_follows_filter", pass: bars2 === rows2, detail: `bars=${bars2} rows=${rows2}` });

  // status filter narrows the category result
  await page.select("#filter-status", "Active");
  await page.waitForFunction((n) => document.querySelectorAll("#rows tr").length !== n, { timeout: 3000, args: [rows2] }).catch(() => {});
  let rows3 = await rowCount();
  const statusOK = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#rows tr")).every((tr) => tr.children[3].textContent.trim() === "Active")
  );
  r.push({ name: "status_filter_works", pass: rows3 >= 0 && rows3 < rows2 && statusOK, detail: `rows ${rows2}→${rows3} allActive=${statusOK}` });

  // search narrows further
  await page.type("#filter-search", "qqqqzzzz-no-match");
  await page.waitForFunction(() => document.querySelector("#rows-empty").hidden === false, { timeout: 3000 }).catch(() => {});
  const rowsEmpty = await rowCount();
  const emptyVisible = await page.evaluate(() => document.querySelector("#rows-empty").hidden === false);
  const chartEmptyVisible = await page.evaluate(() => document.querySelector("#chart-empty").hidden === false);
  r.push(
    { name: "search_filter_empty_state", pass: rowsEmpty === 0 && emptyVisible === true, detail: `rows=${rowsEmpty} emptyShown=${emptyVisible}` },
    { name: "chart_empty_state", pass: chartEmptyVisible === true, detail: `chartEmptyShown=${chartEmptyVisible}` }
  );

  // clear search → data returns, empty hides
  await page.evaluate(() => { document.querySelector("#filter-search").value = ""; document.querySelector("#filter-search").dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length > 0, { timeout: 3000 });
  const restored = await rowCount();
  const restoredEmpty = await page.evaluate(() =>
    document.querySelector("#rows-empty").hidden === true
  );
  r.push({ name: "data_restores_after_clear", pass: restored > 0 && restoredEmpty === true, detail: `rows=${restored}` });

  return r;
}