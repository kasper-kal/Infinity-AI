/**
 * chat-widget acceptance criteria:
 * Messages append both ways · scroll sane (pinned to newest) · send disabled on empty · error state on failure.
 */
export const readySelector = "#composer";

export async function checks(page) {
  const r = [];

  const disabled = () => page.evaluate(() => document.querySelector("#send").disabled);
  const msgCount = () => page.evaluate(() => document.querySelectorAll("#messages .msg").length);
  const lastText = () => page.evaluate(() => {
    const all = document.querySelectorAll("#messages .msg");
    return all.length ? all[all.length - 1].textContent.trim() : "";
  });
  const scrollPinned = () => page.evaluate(() => {
    const el = document.querySelector("#messages");
    return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  });
  const lastSender = () => page.evaluate(() => {
    const all = document.querySelectorAll("#messages .msg");
    return all.length ? all[all.length - 1].className : "";
  });

  // ---- send disabled on empty input
  r.push({ name: "send_disabled_on_empty", pass: (await disabled()) === true, detail: `disabled=${await disabled()}` });

  // ---- type → send button enables
  await page.type("#input", "Hello from the verifier");
  r.push({ name: "send_enables_with_input", pass: (await disabled()) === false, detail: `disabled=${await disabled()}` });

  // ---- send → user message appended, input cleared, button re-disabled
  await page.click("#send");
  await page.waitForFunction(() => document.querySelectorAll("#messages .msg.mine").length === 1, { timeout: 3000 });
  const mineText = await page.evaluate(() => document.querySelector("#messages .msg.mine")?.textContent.trim());
  const cleared = await page.evaluate(() => document.querySelector("#input").value === "");
  r.push(
    { name: "user_append", pass: mineText === "Hello from the verifier", detail: `"${mineText}"` },
    { name: "input_cleared_after_send", pass: cleared === true, detail: `input=${await page.evaluate(() => document.querySelector("#input").value)}` },
    { name: "send_disabled_after_send", pass: (await disabled()) === true, detail: `disabled=${await disabled()}` }
  );

  // ---- simulated reply arrives (other side), pinned to bottom
  await page.waitForFunction(() => document.querySelectorAll("#messages .msg.theirs").length === 1, { timeout: 5000 });
  const replyText = await lastText();
  const lastIsTheirs = (await lastSender()).includes("theirs");
  r.push(
    { name: "reply_appends_both_ways", pass: lastIsTheirs === true && replyText.startsWith("Echo:"), detail: `"${replyText.slice(0, 60)}"` },
    { name: "scrolled_to_newest", pass: await scrollPinned(), detail: `pinned=${await scrollPinned()}` }
  );

  // ---- add several more messages; scroll must stay pinned to the bottom
  for (const msg of ["Second", "Third", "Fourth"]) {
    await page.evaluate((t) => {
      const input = document.querySelector("#input");
      input.value = t;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, msg);
    await page.click("#send");
    await page.waitForFunction(() => document.querySelectorAll("#messages .msg.mine").length >= 2, { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 550)); // let the reply land
  }
  r.push({
    name: "many_messages_append",
    pass: (await msgCount()) === 8,
    detail: `msgs=${await msgCount()}`,
  });
  r.push({ name: "scroll_pinned_after_stream", pass: await scrollPinned(), detail: `pinned=${await scrollPinned()}` });

  // ---- error state: force the next reply to fail → banner + Retry works
  await page.evaluate(() => window.__failNextReply());
  await page.evaluate((t) => {
    const input = document.querySelector("#input");
    input.value = t;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, "Will this fail?");
  await page.click("#send");
  await page.waitForFunction(() => document.querySelector("#error-banner").hidden === false, { timeout: 5000 });
  const bannerText = await page.evaluate(() => document.querySelector("#error-banner").textContent.trim());
  r.push({ name: "error_state_on_failure", pass: bannerText.includes("failed"), detail: `"${bannerText.slice(0, 60)}"` });

  // retry recovers: banner hides and the deferred echo reply eventually lands
  await page.click("#retry");
  await page.waitForFunction(() => document.querySelector("#error-banner").hidden === true, { timeout: 3000 });
  await page.waitForFunction(
    () => {
      const all = document.querySelectorAll("#messages .msg");
      return all.length ? all[all.length - 1].textContent.trim().startsWith("Echo: Will this fail?") : false;
    },
    { timeout: 5000 }
  );
  const retryMsg = await lastText();
  r.push({
    name: "retry_recovers",
    pass: retryMsg.startsWith("Echo: Will this fail?"),
    detail: `"${retryMsg.slice(0, 50)}"`,
  });

  return r;
}