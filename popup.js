"use strict";
const $ = id => document.getElementById(id);
let state = { leads: [], logs: [], run: null };
let renderTimer;
const messageDrafts = new Map();
const leadUiDrafts = new Map();
const openEditors = new Set();
let flashUntil = 0;
let flashTimer;
let templateDrafts = { ...LeadMessages.DEFAULT_TEMPLATES };
let settingsLoaded = false;
const reasonLabels = { SEM_SITE: "Sem site informado", SO_WHATSAPP: "Só WhatsApp", SO_REDES: "Só redes sociais", SITE_QUEBRADO: "Site quebrado (confirmado)", SITE_A_VERIFICAR: "Site a verificar", DESCONHECIDO: "Dados incompletos" };
const messageLabels = { nao_gerada: "Não gerada", gerada: "Gerada", copiada: "Copiada", contatada: "Contatada", respondida: "Respondida" };
for (const stage of LeadCore.STAGES) {
  const option = document.createElement("option"); option.value = stage; option.textContent = stage; $("filter-stage").append(option);
}
function message(value) {
  $("message").textContent = value;
  flashUntil = Date.now() + 5000;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashUntil = 0; renderStatus(); }, 5000);
}
function renderStatus() {
  if (Date.now() < flashUntil) return;
  const run = state.run;
  if (!run) { $("message").textContent = ""; return; }
  const label = { running: "em andamento", done: "concluída", error: "erro", blocked: "bloqueada pelo navegador", stopped: "interrompida", interrupted: "interrompida" }[run.status] || run.status;
  $("message").textContent = `${run.source}: ${label}. ${run.scanned || 0} analisados, ${run.added || 0} novos, ${run.matched || 0} oportunidades. ${run.message || ""}`;
  if (run.status === "blocked" && run.source === "Google Maps") document.querySelector(".manual-box").open = true;
}
function uiDraft(id) {
  if (!leadUiDrafts.has(id)) leadUiDrafts.set(id, {});
  return leadUiDrafts.get(id);
}
async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Falha na extensão.");
  return response;
}
function selectedSource() {
  const source = $("source").value;
  $("maps-fields").hidden = source !== "maps";
  $("osm-fields").hidden = source !== "osm";
  $("empresaqui-fields").hidden = source !== "empresaqui";
  $("limit-wrap").hidden = source === "empresaqui";
  $("start").textContent = source === "empresaqui" ? "Importar arquivo" : source === "maps" ? "Tentar coleta automática" : "Iniciar pesquisa";
}
function filtered() {
  const source = $("filter-source").value, stage = $("filter-stage").value, reason = $("filter-reason").value;
  const messageStatus = $("filter-message").value;
  const search = $("filter-search").value.toLocaleLowerCase("pt-BR").trim();
  return (state.leads || []).filter(lead =>
    (!source || lead.source === source || lead.sources?.includes(source)) &&
    (!stage || lead.stage === stage) && (!reason || lead.reason === reason) &&
    (!messageStatus || (lead.messageStatus || "nao_gerada") === messageStatus) &&
    (!search || `${lead.nome} ${lead.cnpj} ${lead.telefone}`.toLocaleLowerCase("pt-BR").includes(search))
  ).sort((a, b) => (b.score || 0) - (a.score || 0) || (b.collectedAt || 0) - (a.collectedAt || 0));
}
function addText(parent, tag, value, className) {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  parent.append(node); return node;
}
function addLink(parent, label, value) {
  if (!value) return;
  let url;
  try { url = new URL(value); if (!["https:", "http:"].includes(url.protocol)) return; } catch { return; }
  const link = addText(parent, "a", label);
  link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
}
function readMessageSettings() {
  return { companyName: $("cfg-company").value.trim(), memberName: $("cfg-member").value.trim(), offer: $("cfg-offer").value.trim(), cta: $("cfg-cta").value.trim(), tone: $("cfg-tone").value };
}
function loadMessageSettings() {
  const config = { ...LeadMessages.DEFAULT_SETTINGS, ...(state.messageSettings || {}) };
  $("cfg-company").value = config.companyName;
  $("cfg-member").value = config.memberName;
  $("cfg-offer").value = config.offer;
  $("cfg-cta").value = config.cta;
  $("cfg-tone").value = config.tone;
  templateDrafts = { ...LeadMessages.DEFAULT_TEMPLATES, ...(state.messageTemplates || {}) };
  $("template-text").value = templateDrafts[$("template-tone").value];
  settingsLoaded = true;
}
function makeField(parent, title, id, value, type = "text") {
  const label = addText(parent, "label", title); label.htmlFor = id;
  const input = document.createElement("input"); input.id = id; input.type = type; input.value = value || ""; parent.append(input); return input;
}
function renderMessageEditor(lead) {
  const box = document.createElement("details"); box.className = "message-editor";
  box.open = openEditors.has(lead.id);
  box.addEventListener("toggle", () => { if (!box.isConnected) return; if (box.open) openEditors.add(lead.id); else openEditors.delete(lead.id); });
  const draft = uiDraft(lead.id);
  addText(box, "summary", `Mensagem · ${messageLabels[lead.messageStatus] || "Não gerada"}`);
  const toneLabel = addText(box, "label", "Tom");
  const tone = document.createElement("select"); toneLabel.append(tone);
  for (const key of ["profissional", "curta", "curiosidade", "direta"]) {
    const option = document.createElement("option"); option.value = key; option.textContent = key[0].toUpperCase() + key.slice(1); tone.append(option);
  }
  tone.value = draft.tone || $("cfg-tone").value;
  tone.addEventListener("change", () => { draft.tone = tone.value; });
  const preview = makeField(box, "Link da prévia preparada (opcional)", `preview-${lead.id}`, draft.previewUrl ?? lead.previewUrl, "url");
  preview.addEventListener("input", () => { draft.previewUrl = preview.value; });
  const previewLabel = addText(box, "label", "Usar modelo de prévia pronta", "check-label");
  const previewCheck = document.createElement("input"); previewCheck.type = "checkbox"; previewLabel.prepend(previewCheck);
  previewCheck.checked = !!draft.previewReady;
  previewCheck.addEventListener("change", () => { draft.previewReady = previewCheck.checked; });
  const messageArea = document.createElement("textarea"); messageArea.setAttribute("aria-label", `Mensagem para ${lead.nome}`);
  messageArea.value = messageDrafts.has(lead.id) ? messageDrafts.get(lead.id) : lead.messageText || "";
  messageArea.maxLength = 4000; messageArea.addEventListener("input", () => messageDrafts.set(lead.id, messageArea.value)); box.append(messageArea);
  const statusLabel = addText(box, "label", "Status da mensagem");
  const status = document.createElement("select"); statusLabel.append(status);
  for (const [key, label] of Object.entries(messageLabels)) { const option = document.createElement("option"); option.value = key; option.textContent = label; status.append(option); }
  status.value = lead.messageStatus || "nao_gerada";
  status.addEventListener("change", () => send("UPDATE_LEAD", { id: lead.id, messageStatus: status.value }).catch(error => message(error.message)));
  const follow = makeField(box, "Próximo contato", `follow-${lead.id}`, draft.followUpDate ?? lead.followUpDate, "date");
  follow.addEventListener("input", () => { draft.followUpDate = follow.value; });
  follow.addEventListener("change", () => send("UPDATE_LEAD", { id: lead.id, followUpDate: follow.value }).then(() => { delete draft.followUpDate; }).catch(error => message(error.message)));
  preview.addEventListener("change", () => send("UPDATE_LEAD", { id: lead.id, previewUrl: preview.value }).then(() => { delete draft.previewUrl; }).catch(error => message(error.message)));
  const actions = document.createElement("div"); actions.className = "actions";
  const generate = addText(actions, "button", "Gerar", "primary"); generate.type = "button";
  generate.addEventListener("click", async () => {
    try {
      if (previewCheck.checked && !/^https?:\/\/[^\s]+$/i.test(preview.value.trim())) throw new Error("Informe o link da prévia antes de usar esse modelo.");
      const currentTone = $("template-tone").value;
      templateDrafts[currentTone] = $("template-text").value;
      const generated = LeadMessages.generateMessage({ ...lead, previewUrl: preview.value }, readMessageSettings(), templateDrafts, { tone: tone.value, previewReady: previewCheck.checked });
      const validation = LeadMessages.validateMessage(generated);
      if (!validation.ok) throw new Error(validation.error);
      messageArea.value = generated; messageDrafts.delete(lead.id);
      await send("UPDATE_LEAD", { id: lead.id, previewUrl: preview.value, messageText: generated, messageStatus: "gerada" });
      message("Mensagem gerada para revisão; nenhum envio foi feito.");
    } catch (error) { message(error.message); }
  });
  const saveMessage = addText(actions, "button", "Salvar texto", "secondary"); saveMessage.type = "button";
  saveMessage.addEventListener("click", async () => {
    try {
      const check = LeadMessages.validateMessage(messageArea.value); if (!check.ok) throw new Error(check.error);
      await send("UPDATE_LEAD", { id: lead.id, messageText: messageArea.value, messageStatus: "gerada" });
      messageDrafts.delete(lead.id); message("Mensagem salva.");
    } catch (error) { message(error.message); }
  });
  const copy = addText(actions, "button", "Copiar", "secondary"); copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      const check = LeadMessages.validateMessage(messageArea.value); if (!check.ok) throw new Error(check.error);
      await navigator.clipboard.writeText(messageArea.value);
      await send("UPDATE_LEAD", { id: lead.id, messageText: messageArea.value, messageStatus: "copiada" });
      messageDrafts.delete(lead.id); message("Mensagem copiada. O envio continua manual.");
    } catch (error) { message(`Não foi possível copiar: ${error.message}`); }
  });
  const phone = String(lead.telefone || "").replace(/\D/g, "");
  const whatsapp = addText(actions, "button", "Abrir WhatsApp", "secondary"); whatsapp.type = "button";
  whatsapp.disabled = !(/^\d{10,11}$/.test(phone) || /^55\d{10,11}$/.test(phone));
  whatsapp.addEventListener("click", () => {
    const number = phone.startsWith("55") && phone.length > 11 ? phone : `55${phone}`;
    chrome.tabs.create({ url: `https://wa.me/${number}` }).catch(error => message(error.message));
  });
  box.append(actions);
  return box;
}
function renderLead(lead) {
  const card = document.createElement("article"); card.className = "lead";
  const head = document.createElement("div"); head.className = "lead-head";
  addText(head, "strong", lead.nome);
  addText(head, "span", `${lead.score || 0}/100`, "score"); card.append(head);
  addText(card, "div", `${lead.source}${lead.sources?.length > 1 ? ` + ${lead.sources.filter(item => item !== lead.source).join(", ")}` : ""} · ${reasonLabels[lead.reason] || lead.reason}`, "meta");
  if (lead.cnpj) addText(card, "div", `CNPJ ${lead.cnpj}`, "meta");
  if (lead.telefone) addText(card, "div", `Telefone ${lead.telefone}`, "meta");
  if (lead.endereco) addText(card, "div", lead.endereco, "meta");
  if (lead.siteInformado) addText(card, "div", `Site informado: ${lead.siteInformado}`, "meta");
  const links = document.createElement("div"); links.className = "lead-links";
  addLink(links, "Ver origem", lead.sourceUrl);
  addLink(links, "Ver site", lead.siteInformado);
  addLink(links, "Instagram", lead.instagram);
  if (lead.telefone && lead.reason === "SO_WHATSAPP") {
    const digits = lead.telefone.replace(/\D/g, "");
    if (digits.length >= 10) addLink(links, "WhatsApp", `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`);
  }
  card.append(links);
  const stage = document.createElement("select"); stage.setAttribute("aria-label", `Etapa de ${lead.nome}`);
  for (const value of LeadCore.STAGES) { const option = document.createElement("option"); option.value = value; option.textContent = value; stage.append(option); }
  stage.value = lead.stage || "Novo";
  stage.addEventListener("change", () => send("UPDATE_LEAD", { id: lead.id, stage: stage.value }).catch(error => message(error.message)));
  card.append(stage);
  const reason = document.createElement("select"); reason.setAttribute("aria-label", `Oportunidade de ${lead.nome}`);
  for (const value of LeadCore.REASONS) { const option = document.createElement("option"); option.value = value; option.textContent = reasonLabels[value]; reason.append(option); }
  reason.value = lead.reason;
  reason.addEventListener("change", () => send("UPDATE_LEAD", { id: lead.id, reason: reason.value }).catch(error => message(error.message)));
  card.append(reason);
  const notes = document.createElement("textarea"); notes.placeholder = "Observações e próximo passo"; notes.value = uiDraft(lead.id).notes ?? lead.notes ?? ""; notes.maxLength = 1000; notes.setAttribute("aria-label", `Observações de ${lead.nome}`); notes.addEventListener("input", () => { uiDraft(lead.id).notes = notes.value; }); card.append(notes);
  const save = addText(card, "button", "Salvar observação", "secondary save");
  save.type = "button";
  save.addEventListener("click", () => send("UPDATE_LEAD", { id: lead.id, notes: notes.value }).then(() => { delete uiDraft(lead.id).notes; message("Observação salva."); }).catch(error => message(error.message)));
  card.append(renderMessageEditor(lead));
  return card;
}
function render() {
  if (!settingsLoaded) loadMessageSettings();
  const leads = state.leads || [];
  $("total").textContent = `${leads.length} lead(s)`;
  const running = state.run?.status === "running";
  $("start").disabled = running; $("stop").disabled = !running;
  renderStatus();
  const stages = $("stages"); stages.replaceChildren();
  for (const stage of LeadCore.STAGES) addText(stages, "span", `${stage}: ${leads.filter(lead => lead.stage === stage).length}`);
  const matches = filtered();
  $("shown").textContent = `${matches.length} resultado(s) no filtro${matches.length > 100 ? "; exibindo os 100 primeiros" : ""}.`;
  $("csv").disabled = !matches.length; $("json").disabled = !matches.length;
  const box = $("leads");
  const focused = document.activeElement;
  const focusedCard = focused?.closest?.("article.lead");
  const focusIndex = focusedCard ? [...focusedCard.querySelectorAll("input, select, textarea, button, summary")].indexOf(focused) : -1;
  const focusId = focusedCard?.dataset.leadId;
  const selection = focusIndex >= 0 && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const cards = matches.slice(0, 100).map(lead => { const card = renderLead(lead); card.dataset.leadId = lead.id; return card; });
  box.replaceChildren(...cards);
  if (focusIndex >= 0) {
    const newCard = cards.find(card => card.dataset.leadId === focusId);
    const target = newCard?.querySelectorAll("input, select, textarea, button, summary")[focusIndex];
    if (target) { target.focus(); if (selection) target.setSelectionRange(...selection); }
  }
  const log = $("log"); log.replaceChildren(...(state.logs || []).slice(-20).map(line => { const div = document.createElement("div"); div.textContent = line; return div; }));
}
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 80); }
function download(text, name, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function importEmpresaqui() {
  const file = $("import-file").files[0];
  if (!file) throw new Error("Selecione um arquivo CSV ou JSON exportado do EmpresAqui.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo acima de 20 MB. Divida a exportação em partes.");
  let text = await file.text();
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
  let rows;
  if (/\.json$/i.test(file.name)) {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : parsed.resultados || parsed.empresas || parsed.data || [];
  } else rows = LeadCore.parseCsv(text);
  if (!Array.isArray(rows)) throw new Error("O JSON não contém uma lista de empresas.");
  const mapped = rows.map(LeadCore.mapEmpresaquiRow).filter(Boolean);
  if (!mapped.length) throw new Error("Nenhuma empresa reconhecida. Confira os cabeçalhos do arquivo.");
  let added = 0;
  for (let index = 0; index < mapped.length; index += 100) {
    const result = await send("IMPORT_LEADS", { rows: mapped.slice(index, index + 100) });
    added += result.added;
  }
  message(`${added} lead(s) novo(s) importado(s) de ${mapped.length} registro(s).`);
}
async function importMaps() {
  const file = $("maps-import-file").files[0];
  if (!file) throw new Error("Selecione um CSV ou JSON com leads do Google Maps.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo acima de 20 MB. Divida em partes.");
  let text = await file.text();
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
  let rows;
  if (/\.json$/i.test(file.name)) {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : parsed.leads || parsed.results || parsed.data || [];
  } else rows = LeadCore.parseCsv(text);
  if (!Array.isArray(rows)) throw new Error("O arquivo não contém uma lista de empresas.");
  const mapped = rows.map((row, index) => LeadCore.mapImportedRow(row, "Google Maps", index)).filter(Boolean);
  if (!mapped.length) throw new Error("Nenhuma empresa reconhecida. O arquivo precisa ter coluna Nome ou Empresa.");
  let added = 0;
  for (let index = 0; index < mapped.length; index += 100) {
    const response = await send("IMPORT_LEADS", { source: "Google Maps", rows: mapped.slice(index, index + 100) });
    added += response.added;
  }
  message(`${added} lead(s) novo(s) importado(s) do arquivo.`);
}
$("source").addEventListener("change", selectedSource);
$("maps-import").addEventListener("click", () => importMaps().catch(error => message(error.message)));
$("manual-add").addEventListener("click", async () => {
  try {
    const nome = $("manual-name").value.trim();
    if (!nome) throw new Error("Informe o nome da empresa.");
    const sourceUrl = $("manual-url").value.trim();
    const row = { sourceId: sourceUrl || crypto.randomUUID(), sourceUrl, nome, telefone: $("manual-phone").value.trim(), siteInformado: $("manual-site").value.trim(), endereco: $("manual-address").value.trim(), siteKnown: true };
    const response = await send("IMPORT_LEADS", { source: "Google Maps", rows: [row] });
    $("manual-name").value = ""; $("manual-phone").value = ""; $("manual-site").value = ""; $("manual-address").value = ""; $("manual-url").value = "";
    message(response.added ? "Lead adicionado ao funil." : "Lead existente atualizado.");
  } catch (error) { message(error.message); }
});
$("template-tone").addEventListener("change", event => {
  if (event.target.dataset.previous) templateDrafts[event.target.dataset.previous] = $("template-text").value;
  $("template-text").value = templateDrafts[event.target.value];
  event.target.dataset.previous = event.target.value;
});
$("template-tone").dataset.previous = $("template-tone").value;
$("reset-template").addEventListener("click", () => {
  const key = $("template-tone").value;
  templateDrafts[key] = LeadMessages.DEFAULT_TEMPLATES[key];
  $("template-text").value = templateDrafts[key];
  message("Modelo padrão restaurado. Salve a configuração para manter a mudança.");
});
$("save-message-settings").addEventListener("click", async () => {
  try {
    templateDrafts[$("template-tone").value] = $("template-text").value;
    await send("UPDATE_MESSAGE_SETTINGS", { settings: readMessageSettings(), templates: templateDrafts });
    message("Configuração de mensagens salva.");
  } catch (error) { message(error.message); }
});
$("empresaqui-lookup").addEventListener("click", async () => {
  const button = $("empresaqui-lookup"); button.disabled = true;
  try {
    const result = await send("LOOKUP_EMPRESAQUI", { cnpj: $("empresaqui-cnpj").value, token: $("empresaqui-token").value });
    message(result.added ? "Empresa adicionada ao funil." : "Empresa já existente; dados atualizados.");
  } catch (error) { message(error.message); }
  finally { $("empresaqui-token").value = ""; button.disabled = false; }
});
for (const id of ["filter-source", "filter-stage", "filter-reason", "filter-message", "filter-search"]) $(id).addEventListener(id === "filter-search" ? "input" : "change", scheduleRender);
$("map-center").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://www.openstreetmap.org/")) throw new Error("Deixe uma aba do OpenStreetMap ativa antes de abrir a extensão.");
    const match = new URL(tab.url).hash.match(/map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    if (!match) throw new Error("Posicione o mapa e tente novamente.");
    $("latitude").value = match[1]; $("longitude").value = match[2]; message("Centro do mapa preenchido.");
  } catch (error) { message(error.message); }
});
$("start").addEventListener("click", async () => {
  try {
    const source = $("source").value;
    if (source === "empresaqui") { await importEmpresaqui(); return; }
    const limit = Math.max(1, Math.min(500, Number($("limit").value) || 20));
    $("limit").value = limit;
    if (source === "maps") await send("START_MAPS", { payload: { keyword: $("maps-keyword").value, limit } });
    else await send("START_OSM", { payload: { keyword: $("osm-keyword").value, latitude: $("latitude").value, longitude: $("longitude").value, radius: $("radius").value, limit } });
  } catch (error) { message(error.message); }
});
$("stop").addEventListener("click", () => send("STOP").catch(error => message(error.message)));
$("clear-log").addEventListener("click", () => send("CLEAR_LOG").catch(error => message(error.message)));
$("csv").addEventListener("click", () => download(LeadCore.exportCsv(filtered()), "empresas-sem-site.csv", "text/csv;charset=utf-8"));
$("json").addEventListener("click", () => download(JSON.stringify({ attribution: "© OpenStreetMap contributors (ODbL) — https://www.openstreetmap.org/copyright", leads: filtered() }, null, 2), "empresas-sem-site.json", "application/json"));
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.leadFinder) { state = changes.leadFinder.newValue; scheduleRender(); } });
chrome.storage.local.get("leadFinder").then(data => { if (data.leadFinder) state = data.leadFinder; render(); });
selectedSource();
