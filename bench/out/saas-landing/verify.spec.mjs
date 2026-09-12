/**
 * saas-landing acceptance criteria:
 * Marketing sections render · responsive · nav links work · `npm run build` green · no dead links · no [object Object].
 */
export const readySelector = "main";

export async function checks(page) {
  const r = [];

  // ---- marketing sections render (each has non-empty visible text)
  const sections = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main section")).map((s) => ({
      id: s.id,
      textLen: s.innerText.trim().length,
      h: s.querySelector("h1,h2")?.textContent.trim() ?? "",
    }))
  );
  const sectionIds = sections.map((s) => s.id);
  const complete = ["home", "features", "pricing", "testimonials", "faq", "get-started", "contact"];
  const missing = complete.filter((id) => !sectionIds.includes(id) || sections.find((s) => s.id === id).textLen < 40);
  r.push({
    name: "marketing_sections_render",
    pass: missing.length === 0,
    detail: missing.length ? `missing/empty: ${missing.join(",")}` : `all 7 sections: ${sectionIds.join(",")}`,
  });

  // ---- no dead links: every in-page anchor resolves to an existing element id
  const dead = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="#"]'))
      .filter((a) => !["#", "#top", "#home"].includes(a.getAttribute("href")) &&
        !document.getElementById(a.getAttribute("href").slice(1)))
      .map((a) => a.getAttribute("href") + " (" + (a.textContent.trim().slice(0, 20) || "no text") + ")")
  );
  const otherAnchors = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .filter((a) => !a.getAttribute("href").startsWith("#") && !a.getAttribute("href").startsWith("mailto:"))
      .map((a) => a.getAttribute("href"))
  );
  r.push(
    { name: "no_dead_anchor_links", pass: dead.length === 0, detail: dead.length ? dead.join(" | ") : "all in-page anchors have targets" },
    { name: "no_broken_external", pass: otherAnchors.length === 0, detail: `external hrefs needing fetch: ${otherAnchors.length}` }
  );

  // ---- nav links work: clicking #pricing scrolls to the pricing section (desktop nav)
  await page.setViewport({ width: 1024, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('a[href="#pricing"]');
  // smooth-scroll animates — wait until the section is near the top (≤120px, under the sticky nav)
  await page.waitForFunction(
    () => { const el = document.getElementById("pricing"); if (!el) return false; return el.getBoundingClientRect().top < 120; },
    { timeout: 3000 }
  ).catch(() => {});
  const pricingTop = await page.evaluate(() => document.getElementById("pricing").getBoundingClientRect().top);
  r.push({ name: "nav_link_works", pass: pricingTop >= 0 && pricingTop < 120, detail: `#pricing top=${Math.round(pricingTop)}px after click` });

  // ---- mobile menu: at narrow width the hamburger reveals the links and a link closes it
  await page.setViewport({ width: 420, height: 800 });
  const menuBtnVisible = await page.evaluate(() => {
    const b = document.querySelector(".menu-btn");
    return getComputedStyle(b).display !== "none";
  });
  await page.click(".menu-btn");
  const linksOpen = await page.evaluate(() => document.querySelector("#links").classList.contains("open"));
  await page.click('a[href="#features"]');
  const linksClosed = await page.evaluate(() => !document.querySelector("#links").classList.contains("open"));
  r.push(
    { name: "mobile_menu_present", pass: menuBtnVisible === true, detail: `hamburger display=${await page.evaluate(() => getComputedStyle(document.querySelector(".menu-btn")).display)}` },
    { name: "mobile_menu_toggles", pass: linksOpen === true, detail: `open=${linksOpen}` },
    { name: "mobile_menu_closes_on_select", pass: linksClosed === true, detail: `closed=${linksClosed}` }
  );

  // ---- lead form works
  await page.evaluate(() => { document.querySelector("#lead-form").scrollIntoView(); });
  await page.type("#lead-form input", "bench@example.com");
  await page.click("#lead-form button");
  const thanksShown = await page.evaluate(() => document.querySelector("#thanks").hidden === false);
  r.push({ name: "lead_form_submits", pass: thanksShown === true, detail: `thanks shown=${thanksShown}` });

  return r;
}