(function () {
  if (globalThis.__leadFinderMapsLoaded) return;
  globalThis.__leadFinderMapsLoaded = true;
  let stopped = false;
  let busy = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = message => chrome.runtime.sendMessage(message).catch(() => {});
  const text = element => (element?.textContent || "").trim();
  const label = element => (element?.getAttribute("aria-label") || "").trim();

  function waitFor(selector, timeout = 12000) {
    return new Promise(resolve => {
      const now = document.querySelector(selector);
      if (now) return resolve(now);
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => { observer.disconnect(); resolve(document.querySelector(selector)); }, timeout);
    });
  }
  async function waitForPanel(previousUrl, timeout = 9000) {
    const end = Date.now() + timeout;
    while (!stopped && Date.now() < end) {
      const panel = document.querySelector('div[role="main"]');
      if (panel?.querySelector("h1") && location.href !== previousUrl) return panel;
      await sleep(200);
    }
    return null;
  }
  function details(panel, href) {
    const nome = text(panel.querySelector("h1"));
    if (!nome) return null;
    const phone = panel.querySelector('button[data-item-id*="phone:tel:"], a[href^="tel:"]');
    const phoneValue = phone?.getAttribute("data-item-id")?.split("phone:tel:")[1] || phone?.getAttribute("href")?.replace(/^tel:/, "") || label(phone).replace(/^[^:]+:\s*/, "");
    const address = panel.querySelector('button[data-item-id="address"]');
    const website = panel.querySelector('a[data-item-id="authority"], a[aria-label^="Site"], a[aria-label^="Website"]');
    const site = website?.href || "";
    const category = panel.querySelector('button[jsaction*="category"], button.DkEaL');
    return {
      sourceId: href, sourceUrl: href, nome,
      telefone: phoneValue || "", endereco: label(address).replace(/^[^:]+:\s*/, ""),
      categoria: text(category), siteInformado: site
    };
  }
  async function scrape(runId, limit) {
    if (busy) return;
    busy = true; stopped = false;
    try {
      const feed = await waitFor('div[role="feed"]', 18000);
      if (!feed) throw new Error("Lista de resultados não encontrada. Conclua eventual tela de consentimento e tente novamente.");
      const seen = new Set();
      let scanned = 0, staleRounds = 0;
      const scanCap = Math.min(1500, Math.max(limit * 8, 80));
      while (!stopped && scanned < scanCap) {
        const links = [...feed.querySelectorAll('a[href*="/maps/place/"]')];
        let fresh = 0;
        for (const link of links) {
          if (stopped || scanned >= scanCap) break;
          const href = link.href;
          if (!href || seen.has(href)) continue;
          seen.add(href); fresh++;
          try {
            link.scrollIntoView({ block: "center" });
            await sleep(150);
            const previousUrl = location.href;
            link.click();
            const panel = await waitForPanel(previousUrl);
            if (panel) {
              const lead = details(panel, href);
              if (lead) await send({ type: "MAPS_LEAD", runId, lead });
            }
          } catch (error) { /* Um card inconsistente não encerra a pesquisa. */ }
          scanned++;
          await send({ type: "MAPS_PROGRESS", runId, scanned });
          const state = await chrome.storage.local.get("leadFinder");
          if ((state.leadFinder?.run?.matched || 0) >= limit) break;
          await sleep(650);
        }
        const state = await chrome.storage.local.get("leadFinder");
        if ((state.leadFinder?.run?.matched || 0) >= limit || stopped) break;
        if (!fresh) staleRounds++; else staleRounds = 0;
        if (staleRounds >= 6 || /Você chegou ao fim da lista|You've reached the end of the list/i.test(feed.innerText || "")) break;
        feed.scrollTop = feed.scrollHeight;
        await sleep(1100);
      }
      if (!stopped) await send({ type: "MAPS_DONE", runId });
    } catch (error) { await send({ type: "MAPS_ERROR", runId, message: error.message }); }
    finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === "RUN_SCRAPE") { scrape(msg.runId, Number(msg.limit) || 20); respond({ ok: true }); }
    if (msg.type === "STOP_SCRAPE") { stopped = true; respond({ ok: true }); }
  });
})();
