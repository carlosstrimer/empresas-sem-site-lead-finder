importScripts("core.js", "message.js");
const KEY = "leadFinder";
let queue = Promise.resolve();
let osmAbort = null;
let lastEmpresaquiRequest = 0;

async function readState() {
  const result = await chrome.storage.local.get(KEY);
  return result[KEY] || { leads: [], logs: [], run: null };
}
function changeState(change) {
  const task = queue.catch(() => {}).then(async () => {
    const state = await readState();
    const result = await change(state);
    await chrome.storage.local.set({ [KEY]: state });
    return result;
  });
  queue = task;
  return task;
}
function log(message) {
  return changeState(state => {
    state.logs.push(`${new Date().toLocaleTimeString("pt-BR")} ${message}`);
    state.logs = state.logs.slice(-100);
  });
}
function saveLead(raw, runId) {
  const incoming = LeadCore.normalizeLead(raw);
  if (!incoming.nome || !incoming.sourceId) return Promise.resolve(false);
  return changeState(state => {
    if (runId && (state.run?.id !== runId || state.run.status !== "running")) return false;
    const index = state.leads.findIndex(lead => LeadCore.sameLead(lead, incoming));
    if (index < 0) state.leads.push(incoming);
    else state.leads[index] = LeadCore.mergeLead(state.leads[index], incoming);
    if (runId) {
      state.run.scanned++;
      if (index < 0) {
        state.run.added++;
        if (["SEM_SITE", "SO_WHATSAPP", "SO_REDES", "SITE_QUEBRADO"].includes(incoming.reason)) state.run.matched++;
      }
    }
    return index < 0;
  });
}
async function finish(id, status, message) {
  const changed = await changeState(state => {
    if (state.run?.id !== id || state.run.status !== "running") return false;
    state.run.status = status;
    state.run.finishedAt = Date.now();
    state.run.message = message;
    return true;
  });
  if (changed) await log(message);
}
async function waitForLoad(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("Tempo de carregamento esgotado.")); }, 30000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
async function startMaps(payload) {
  if ((await readState()).run?.status === "running") throw new Error("Já existe uma pesquisa em andamento.");
  const keyword = String(payload.keyword || "").trim().slice(0, 160);
  const limit = Math.max(1, Math.min(500, Number(payload.limit) || 20));
  if (!keyword) throw new Error("Informe a pesquisa do Google Maps.");
  const id = crypto.randomUUID();
  await changeState(state => { state.run = { id, source: "Google Maps", keyword, limit, scanned: 0, added: 0, matched: 0, status: "running", startedAt: Date.now() }; state.logs = []; });
  await log(`Google Maps: ${keyword}`);
  try {
    const tab = await chrome.tabs.create({ url: `https://www.google.com/maps/search/${encodeURIComponent(keyword)}?hl=pt-BR`, active: true });
    await changeState(state => { if (state.run?.id === id) state.run.tabId = tab.id; });
    await waitForLoad(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "RUN_SCRAPE", runId: id, limit });
  } catch (error) {
    if (/ExtensionsSettings policy/i.test(String(error?.message))) {
      await finish(id, "blocked", "O navegador bloqueou scripts da extensão no Google Maps por uma política ExtensionSettings. Abra chrome://policy (ou edge://policy), procure ExtensionSettings e peça ao administrador para verificar runtime_blocked_hosts e runtime_allowed_hosts. OSM e importação continuam disponíveis.");
    } else {
      await finish(id, "error", `Falha no Google Maps: ${error.message}`);
    }
  }
  return { id };
}
async function startOsm(payload) {
  if ((await readState()).run?.status === "running") throw new Error("Já existe uma pesquisa em andamento.");
  const latitude = Number(payload.latitude), longitude = Number(payload.longitude);
  const radius = Math.max(500, Math.min(10000, Number(payload.radius) || 3000));
  const limit = Math.max(1, Math.min(500, Number(payload.limit) || 20));
  const keyword = String(payload.keyword || "").trim().slice(0, 60);
  if (!keyword || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error("Informe segmento e coordenadas válidas.");
  const id = crypto.randomUUID();
  await changeState(state => { state.run = { id, source: "OpenStreetMap", keyword, limit, scanned: 0, added: 0, matched: 0, status: "running", startedAt: Date.now() }; state.logs = []; });
  await log(`OpenStreetMap: ${keyword}, raio ${radius} m.`);
  const controller = new AbortController();
  osmAbort = controller;
  const timer = setTimeout(() => controller.abort(), 28000);
  try {
    const query = LeadCore.buildOverpassQuery({ latitude, longitude, radius, keyword, limit: Math.min(limit * 5, 500) });
    let response;
    try {
      response = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }), signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (firstError) {
      if (controller.signal.aborted) throw firstError;
      await log("Servidor principal do Overpass indisponível; tentando servidor alternativo.");
      response = await fetch("https://overpass.private.coffee/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }), signal: controller.signal });
      if (!response.ok) throw new Error(`Overpass: HTTP ${response.status}. Reduza o raio ou tente mais tarde.`);
    }
    const json = await response.json();
    for (const element of json.elements || []) {
      if (controller.signal.aborted) break;
      const lead = LeadCore.mapOsmElement(element);
      if (!lead) continue;
      const state = await readState();
      if (state.run?.id !== id || state.run.status !== "running" || state.run.matched >= limit) break;
      await saveLead(lead, id);
    }
    const state = await readState();
    if (state.run?.id === id) await finish(id, "done", `${state.run.added} lead(s) novo(s) do OpenStreetMap.`);
  } catch (error) { await finish(id, "error", `Falha no OpenStreetMap: ${error.message}`); }
  finally { clearTimeout(timer); if (osmAbort === controller) osmAbort = null; }
  return { id };
}
async function stopRun() {
  const state = await readState();
  if (state.run?.status !== "running") return;
  osmAbort?.abort();
  if (state.run.tabId) chrome.tabs.sendMessage(state.run.tabId, { type: "STOP_SCRAPE" }).catch(() => {});
  await finish(state.run.id, "stopped", "Pesquisa interrompida. Leads já salvos foram preservados.");
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "START_MAPS": return startMaps(msg.payload || {});
      case "START_OSM": return startOsm(msg.payload || {});
      case "STOP": await stopRun(); return {};
      case "MAPS_LEAD": {
        const state = await readState();
        if (sender.tab?.id === state.run?.tabId && state.run.id === msg.runId) await saveLead({ ...msg.lead, source: "Google Maps" }, msg.runId);
        return {};
      }
      case "MAPS_PROGRESS": await changeState(state => { if (state.run?.id === msg.runId && state.run.status === "running") state.run.scanned = Math.max(state.run.scanned, Number(msg.scanned) || 0); }); return {};
      case "MAPS_DONE": await finish(msg.runId, "done", "Pesquisa no Google Maps concluída."); return {};
      case "MAPS_ERROR": await finish(msg.runId, "error", `Google Maps: ${msg.message || "erro na pesquisa"}`); return {};
      case "IMPORT_LEADS": {
        let added = 0;
        const source = ["EmpresAqui", "Google Maps"].includes(msg.source) ? msg.source : "EmpresAqui";
        const incoming = (msg.rows || []).slice(0, 100).map(row => LeadCore.normalizeLead({ ...row, source })).filter(lead => lead.nome && lead.sourceId);
        await changeState(state => {
          for (const lead of incoming) {
            const index = state.leads.findIndex(old => LeadCore.sameLead(old, lead));
            if (index < 0) { state.leads.push(lead); added++; }
            else state.leads[index] = LeadCore.mergeLead(state.leads[index], lead);
          }
        });
        await log(`${source}: ${added} lead(s) novo(s) importado(s).`);
        return { added };
      }
      case "UPDATE_MESSAGE_SETTINGS": await changeState(state => {
        const input = msg.settings || {};
        state.messageSettings = Object.fromEntries(Object.keys(LeadMessages.DEFAULT_SETTINGS).map(key =>
          [key, String(input[key] ?? LeadMessages.DEFAULT_SETTINGS[key]).trim().slice(0, 300)]));
        const templates = msg.templates || {};
        state.messageTemplates = Object.fromEntries(LeadMessages.TONES.map(key =>
          [key, String(templates[key] || LeadMessages.DEFAULT_TEMPLATES[key]).slice(0, 2000)]));
      }); return {};
      case "LOOKUP_EMPRESAQUI": {
        const cnpj = String(msg.cnpj || "").replace(/\D/g, "");
        const token = String(msg.token || "").trim();
        if (cnpj.length !== 14 || !token || token.length > 200) throw new Error("Informe CNPJ completo e token válido.");
        const wait = Math.max(0, 1100 - (Date.now() - lastEmpresaquiRequest));
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
        lastEmpresaquiRequest = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const url = new URL("https://www.empresaqui.com.br/acesso/RetornoJson.php");
          url.searchParams.set("Token", token);
          url.searchParams.set("Cnpj", cnpj);
          const response = await fetch(url, { signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
          if (!response.ok) throw new Error(`EmpresAqui respondeu HTTP ${response.status}. Confira seu plano, token e CNPJ.`);
          const data = await response.json();
          if (data.Erro) throw new Error(String(data.Erro));
          const row = Array.isArray(data.resultados) ? data.resultados[0] : data;
          const mapped = LeadCore.mapEmpresaquiRow(row);
          if (!mapped) throw new Error("Resposta sem empresa reconhecível.");
          const added = await saveLead(mapped);
          await log(`EmpresAqui: CNPJ ${cnpj} consultado.`);
          return { added: added ? 1 : 0 };
        } finally { clearTimeout(timer); }
      }
      case "UPDATE_LEAD": await changeState(state => {
        const lead = state.leads.find(item => item.id === msg.id);
        if (lead) {
          if (LeadCore.STAGES.includes(msg.stage)) lead.stage = msg.stage;
          if (LeadCore.REASONS.includes(msg.reason)) { lead.reason = msg.reason; lead.reasonManual = true; lead.score = LeadCore.score(lead); }
          if (typeof msg.notes === "string") lead.notes = msg.notes.slice(0, 1000);
          if (typeof msg.messageText === "string") lead.messageText = msg.messageText.slice(0, 4000);
          if (["nao_gerada", "gerada", "copiada", "contatada", "respondida"].includes(msg.messageStatus)) lead.messageStatus = msg.messageStatus;
          if (typeof msg.followUpDate === "string" && /^$|^\d{4}-\d{2}-\d{2}$/.test(msg.followUpDate)) lead.followUpDate = msg.followUpDate;
          if (typeof msg.previewUrl === "string") {
            const value = msg.previewUrl.trim();
            if (!value || /^https?:\/\/[^\s]+$/i.test(value)) lead.previewUrl = value.slice(0, 500);
          }
          lead.updatedAt = Date.now();
        }
      }); return {};
      case "CLEAR_LOG": await changeState(state => { state.logs = []; }); return {};
      default: return {};
    }
  })().then(value => sendResponse({ ok: true, ...value })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.runtime.onStartup.addListener(() => {
  changeState(state => { if (state.run?.status === "running") { state.run.status = "interrupted"; state.run.message = "Navegador reiniciado; inicie outra pesquisa."; } }).catch(() => {});
});
