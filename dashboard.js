"use strict";
const $ = id => document.getElementById(id);
const reasonNames = { SEM_SITE: "Sem site informado", SO_WHATSAPP: "Só WhatsApp", SO_REDES: "Só redes sociais", SITE_QUEBRADO: "Site quebrado (confirmado)", SITE_A_VERIFICAR: "Site a verificar", DESCONHECIDO: "Dados incompletos" };
const statusNames = { nao_gerada: "Não gerada", gerada: "Gerada", copiada: "Copiada", contatada: "Contatada", respondida: "Respondida" };
const toneNames = { profissional: "Profissional", curta: "Curta", curiosidade: "Curiosidade", direta: "Direta", previa_pronta: "Prévia pronta" };
let state = { leads: [], logs: [], run: null };
let source = "maps", page = 1, selectedTone = "profissional", selectedLeadId = null, dueOnly = false, templateDrafts = { ...LeadMessages.DEFAULT_TEMPLATES }, settingsLoaded = false, toastTimer, returnFocus;
const pageSize = 25;

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Falha na extensão.");
  return response;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 4500);
}
function attempt(task) { Promise.resolve().then(task).catch(error => toast(error.message)); }
function textNode(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = String(value ?? "");
  if (className) node.className = className;
  return node;
}
function externalLink(label, value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const link = textNode("a", label);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch { return null; }
}
function setSource(next) {
  source = next;
  for (const item of ["maps", "osm", "empresaqui"]) {
    $("source-" + item).hidden = item !== next;
    const button = document.querySelector(`[data-source="${item}"]`);
    button.classList.toggle("active", item === next);
    button.setAttribute("aria-pressed", String(item === next));
  }
  $("btnStart").textContent = next === "empresaqui" ? "Consultar CNPJ" : "Iniciar pesquisa";
}
function setTab(next) {
  for (const name of ["radar", "playbook", "settings"]) {
    $("tab-" + name).classList.toggle("active", name === next);
    const button = document.querySelector(`[data-tab="${name}"]`);
    button.classList.toggle("active", name === next);
    button.setAttribute("aria-selected", String(name === next));
  }
  if (location.hash !== `#${next}`) history.replaceState(null, "", `#${next}`);
}
function filteredLeads() {
  const query = $("filterSearch").value.trim().toLocaleLowerCase("pt-BR");
  const src = $("filterSource").value, stage = $("filterStage").value, reason = $("filterReason").value, status = $("filterMessage").value;
  const today = new Date().toLocaleDateString("sv-SE");
  const matches = (state.leads || []).filter(lead =>
    (!dueOnly || (lead.followUpDate && lead.followUpDate <= today && !["Fechado", "Descartado"].includes(lead.stage))) &&
    (!src || lead.source === src || lead.sources?.includes(src)) &&
    (!stage || lead.stage === stage) && (!reason || lead.reason === reason) &&
    (!status || (lead.messageStatus || "nao_gerada") === status) &&
    (!query || `${lead.nome} ${lead.cnpj} ${lead.telefone} ${lead.endereco}`.toLocaleLowerCase("pt-BR").includes(query))
  );
  const sort = $("sortBy").value;
  matches.sort(sort === "name" ? (a, b) => a.nome.localeCompare(b.nome, "pt-BR") : sort === "recent" ? (a, b) => (b.collectedAt || 0) - (a.collectedAt || 0) : (a, b) => (b.score || 0) - (a.score || 0) || (b.collectedAt || 0) - (a.collectedAt || 0));
  return matches;
}
function renderStats() {
  const leads = state.leads || [];
  const opportunity = lead => ["SEM_SITE", "SO_WHATSAPP", "SO_REDES", "SITE_QUEBRADO"].includes(lead.reason);
  const today = new Date().toLocaleDateString("sv-SE");
  $("statTotal").textContent = leads.length;
  $("statOpportunity").textContent = leads.filter(opportunity).length;
  $("statMessages").textContent = leads.filter(lead => ["gerada", "copiada"].includes(lead.messageStatus)).length;
  $("statContacted").textContent = leads.filter(lead => ["contatada", "respondida"].includes(lead.messageStatus) || ["Contatado", "Respondeu", "Proposta", "Fechado"].includes(lead.stage)).length;
  $("statFollowup").textContent = leads.filter(lead => lead.followUpDate && lead.followUpDate <= today && !["Fechado", "Descartado"].includes(lead.stage)).length;
  const average = leads.length ? Math.round(leads.reduce((sum, lead) => sum + (lead.score || 0), 0) / leads.length) : 0;
  $("avgScore").textContent = `Média ${average}/100`;
  const chart = $("reasonChart"); chart.replaceChildren();
  const order = ["SEM_SITE", "SO_WHATSAPP", "SO_REDES", "SITE_QUEBRADO", "SITE_A_VERIFICAR", "DESCONHECIDO"];
  const max = Math.max(1, ...order.map(reason => leads.filter(lead => lead.reason === reason).length));
  for (const reason of order) {
    const count = leads.filter(lead => lead.reason === reason).length;
    const row = document.createElement("div"); row.className = "reason-row";
    row.append(textNode("span", reasonNames[reason]));
    const track = document.createElement("span"); track.className = "reason-track";
    const fill = document.createElement("i"); fill.style.width = `${Math.round(count / max * 100)}%`; track.append(fill); row.append(track, textNode("b", count)); chart.append(row);
  }
  const actions = $("nextActions"); actions.replaceChildren();
  const due = leads.filter(lead => lead.followUpDate && lead.followUpDate <= today && !["Fechado", "Descartado"].includes(lead.stage)).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)).slice(0, 4);
  const items = due.length ? due : leads.filter(opportunity).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4);
  if (!items.length) actions.append(textNode("p", "Pesquise ou importe leads para ver os próximos passos.", "empty-mini"));
  for (const lead of items) {
    const button = document.createElement("button"); button.type = "button"; button.className = "next-action";
    const left = document.createElement("span"); left.append(textNode("strong", lead.nome), textNode("small", due.length ? `Próximo contato: ${lead.followUpDate}` : reasonNames[lead.reason] || "Revisar lead"));
    button.append(left, textNode("em", "Abrir →")); button.addEventListener("click", () => openLead(lead.id)); actions.append(button);
  }
}
function renderTable() {
  const matches = filteredLeads();
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  const rows = $("leadRows"); rows.replaceChildren();
  if (!matches.length) { const tr = document.createElement("tr"); const td = textNode("td", "Nenhum lead neste filtro. Pesquise, importe ou ajuste os filtros.", "empty-row"); td.colSpan = 8; tr.append(td); rows.append(tr); }
  for (const lead of matches.slice((page - 1) * pageSize, page * pageSize)) {
    const tr = document.createElement("tr");
    const name = document.createElement("td"); name.append(textNode("strong", lead.nome, "lead-name"), textNode("span", lead.telefone || lead.cnpj || lead.endereco || "Sem contato informado", "lead-sub"));
    const score = textNode("span", `${lead.score || 0}/100`, `score-badge ${(lead.score || 0) < 40 ? "low" : (lead.score || 0) < 70 ? "mid" : ""}`);
    const scoreCell = document.createElement("td"); scoreCell.append(score);
    const status = textNode("span", statusNames[lead.messageStatus] || "Não gerada", `badge ${lead.messageStatus || ""}`);
    const statusCell = document.createElement("td"); statusCell.append(status);
    tr.append(name, textNode("td", reasonNames[lead.reason] || lead.reason || "—"), scoreCell, textNode("td", (lead.sources || [lead.source]).join(" + ")), textNode("td", lead.stage || "Novo"), statusCell, textNode("td", lead.followUpDate || "—"));
    const action = document.createElement("td"); const button = textNode("button", "Abrir lead", "btn ghost small"); button.type = "button"; button.addEventListener("click", () => openLead(lead.id)); action.append(button); tr.append(action); rows.append(tr);
  }
  $("resultsCount").textContent = `${matches.length} resultado(s)`;
  $("pageLabel").textContent = `${page} / ${totalPages}`;
  $("btnPrev").disabled = page <= 1; $("btnNext").disabled = page >= totalPages;
  $("btnCsv").disabled = !matches.length; $("btnJson").disabled = !matches.length;
}
function renderRun() {
  const run = state.run, running = run?.status === "running";
  $("btnStart").disabled = running; $("btnStop").disabled = !running;
  if (!run) { $("runStatus").textContent = "Nenhuma pesquisa em andamento."; return; }
  const status = { running: "Em andamento", done: "Concluída", error: "Erro", blocked: "Bloqueada pelo navegador", stopped: "Interrompida", interrupted: "Interrompida" }[run.status] || run.status;
  $("runStatus").textContent = `${run.source}: ${status} · ${run.scanned || 0} analisados · ${run.added || 0} novos · ${run.matched || 0} oportunidades. ${run.message || ""}`;
}
function renderActivity() {
  const log = $("activityLog"); log.replaceChildren();
  const entries = (state.logs || []).slice(-15).reverse();
  if (!entries.length) log.append(textNode("p", "Nenhuma atividade registrada.", "empty-mini"));
  for (const entry of entries) log.append(textNode("div", entry));
}
function render() { renderStats(); renderTable(); renderRun(); renderActivity(); }

function settingsInput() { return { companyName: $("cfgCompany").value.trim(), memberName: $("cfgMember").value.trim(), offer: $("cfgOffer").value.trim(), cta: $("cfgCta").value.trim(), tone: $("cfgTone").value }; }
function loadSettings() {
  if (settingsLoaded) return;
  const config = { ...LeadMessages.DEFAULT_SETTINGS, ...(state.messageSettings || {}) };
  $("cfgCompany").value = config.companyName; $("cfgMember").value = config.memberName; $("cfgOffer").value = config.offer; $("cfgCta").value = config.cta; $("cfgTone").value = config.tone;
  templateDrafts = { ...LeadMessages.DEFAULT_TEMPLATES, ...(state.messageTemplates || {}) };
  renderStrategies(); settingsLoaded = true;
}
function renderStrategies() {
  const descriptions = { profissional: "Apresentação e contexto do cadastro", curta: "Abordagem breve", curiosidade: "Convite para pensar no site", direta: "Oferta sem contexto adicional", previa_pronta: "Usa um link de prévia preparado" };
  const list = $("strategyList"); list.replaceChildren();
  for (const tone of LeadMessages.TONES) {
    const button = document.createElement("button"); button.type = "button"; button.className = `strategy-item ${tone === selectedTone ? "active" : ""}`;
    button.append(textNode("strong", toneNames[tone]), textNode("small", descriptions[tone]));
    button.addEventListener("click", () => { templateDrafts[selectedTone] = $("templateText").value; selectedTone = tone; renderStrategies(); }); list.append(button);
  }
  $("templateTitle").textContent = toneNames[selectedTone]; $("templateDescription").textContent = descriptions[selectedTone]; $("templateText").value = templateDrafts[selectedTone];
}
async function saveSettings() {
  templateDrafts[selectedTone] = $("templateText").value;
  await send("UPDATE_MESSAGE_SETTINGS", { settings: settingsInput(), templates: templateDrafts });
  toast("Configurações e modelos salvos neste navegador.");
}
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function readFile(file) {
  if (!file) throw new Error("Selecione um arquivo CSV ou JSON.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Arquivo acima de 20 MB. Divida a exportação em partes.");
  let content = await file.text();
  if (content.includes("\uFFFD")) content = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
  return content;
}
async function importLeads(file) {
  const content = await readFile(file);
  let rows;
  if (/\.json$/i.test(file.name)) { const data = JSON.parse(content); rows = Array.isArray(data) ? data : data.leads || data.resultados || data.empresas || data.results || data.data || []; }
  else rows = LeadCore.parseCsv(content);
  if (!Array.isArray(rows)) throw new Error("O arquivo não contém uma lista de empresas.");
  const origin = source === "empresaqui" ? "EmpresAqui" : "Google Maps";
  const mapped = rows.map((row, index) => origin === "EmpresAqui" ? LeadCore.mapEmpresaquiRow(row, index) : LeadCore.mapImportedRow(row, origin, index)).filter(Boolean);
  if (!mapped.length) throw new Error("Nenhuma empresa reconhecida. Confira a coluna Nome ou Empresa.");
  let added = 0;
  for (let i = 0; i < mapped.length; i += 100) { const response = await send("IMPORT_LEADS", { source: origin, rows: mapped.slice(i, i + 100) }); added += response.added; }
  toast(`${added} lead(s) novo(s) de ${mapped.length} registro(s).`);
}
async function startSearch() {
  if (source === "empresaqui") { const button = $("btnStart"); button.disabled = true; try { const result = await send("LOOKUP_EMPRESAQUI", { cnpj: $("empresaquiCnpj").value, token: $("empresaquiToken").value }); toast(result.added ? "Empresa adicionada ao funil." : "Empresa existente atualizada."); } finally { $("empresaquiToken").value = ""; button.disabled = false; } return; }
  if (source === "maps") { const limit = Math.max(1, Math.min(500, Number($("mapsLimit").value) || 20)); await send("START_MAPS", { payload: { keyword: $("mapsKeyword").value, limit } }); return; }
  const limit = Math.max(1, Math.min(500, Number($("osmLimit").value) || 20));
  await send("START_OSM", { payload: { keyword: $("osmKeyword").value, latitude: $("osmLat").value, longitude: $("osmLon").value, radius: $("osmRadius").value, limit } });
}
async function osmCenter() {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.filter(item => item.url?.startsWith("https://www.openstreetmap.org/")).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) throw new Error("Abra uma aba do OpenStreetMap e posicione o mapa.");
  const match = new URL(tab.url).hash.match(/map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Posicione o mapa na aba OSM e tente novamente.");
  $("osmLat").value = match[1]; $("osmLon").value = match[2]; toast("Centro do OpenStreetMap preenchido.");
}
function openManual() { $("manualDialog").showModal(); $("manualName").focus(); }
async function saveManual(event) {
  event.preventDefault();
  const nome = $("manualName").value.trim(); if (!nome) throw new Error("Informe o nome da empresa.");
  const sourceUrl = $("manualUrl").value.trim();
  const row = { sourceId: sourceUrl || crypto.randomUUID(), sourceUrl, nome, telefone: $("manualPhone").value.trim(), siteInformado: $("manualSite").value.trim(), endereco: $("manualAddress").value.trim(), siteKnown: true };
  const response = await send("IMPORT_LEADS", { source: "Google Maps", rows: [row] });
  $("manualDialog").close(); $("manualForm").reset(); toast(response.added ? "Lead adicionado ao funil." : "Lead existente atualizado.");
}

function closeLead() {
  selectedLeadId = null; $("leadPanel").hidden = true; $("backdrop").hidden = true; document.body.style.overflow = "";
  document.querySelector("main").inert = false; document.querySelector(".topbar").inert = false;
  if (returnFocus?.isConnected) returnFocus.focus(); else $("filterSearch").focus();
}
function openLead(id) {
  const lead = (state.leads || []).find(item => item.id === id);
  if (!lead) { toast("Lead não encontrado."); return; }
  returnFocus = document.activeElement;
  selectedLeadId = id;
  $("panelTitle").textContent = lead.nome;
  const panel = $("panelBody");
  panel.innerHTML = `<section><div class="lead-summary"><span class="score-badge" id="panelScore"></span><div><strong id="panelReason"></strong><p id="panelSource"></p></div></div><div class="panel-links" id="panelLinks"></div></section>
    <section><h3>Funil e diagnóstico</h3><div class="panel-grid"><label>Etapa<select id="panelStage"></select></label><label>Oportunidade<select id="panelReasonSelect"></select></label></div><div class="panel-grid"><label>Status da mensagem<select id="panelStatus"></select></label><label>Próximo contato<input type="date" id="panelFollow"></label></div><label>Observações<textarea id="panelNotes" rows="4" maxlength="1000" placeholder="Contexto e próximo passo"></textarea></label><button type="button" id="btnSaveNotes" class="btn ghost small">Salvar observações</button></section>
    <section><h3>Mensagem personalizada</h3><p class="muted">Revise o texto antes de copiar ou abrir o canal. Nenhum envio é automático.</p><div class="panel-grid"><label>Tom<select id="panelTone"><option value="profissional">Profissional</option><option value="curta">Curta</option><option value="curiosidade">Curiosidade</option><option value="direta">Direta</option></select></label><label>Link da prévia<input type="url" id="panelPreview" placeholder="https://..."></label></div><label class="check-row"><input type="checkbox" id="panelPreviewReady"> Usar modelo de prévia pronta</label><label>Texto para revisão<textarea id="panelMessage" rows="9" maxlength="4000"></textarea></label><div class="row-buttons"><button type="button" id="btnGenerate" class="btn accent">Gerar texto</button><button type="button" id="btnSaveMessage" class="btn ghost">Salvar texto</button><button type="button" id="btnCopyMessage" class="btn secondary">Copiar</button><button type="button" id="btnOpenWhatsapp" class="btn ghost">Abrir WhatsApp</button></div></section>`;
  $("panelScore").textContent = `${lead.score || 0}/100`;
  $("panelReason").textContent = reasonNames[lead.reason] || "Dados incompletos";
  $("panelSource").textContent = `${(lead.sources || [lead.source]).join(" + ")} · ${lead.telefone || lead.cnpj || "Sem telefone"}`;
  const links = $("panelLinks");
  for (const [label, url] of [["Ver origem", lead.sourceUrl], ["Ver site", lead.siteInformado], ["Instagram", lead.instagram]]) { const link = externalLink(label, url); if (link) links.append(link); }
  for (const stage of LeadCore.STAGES) { const option = textNode("option", stage); option.value = stage; $("panelStage").append(option); }
  for (const reason of LeadCore.REASONS) { const option = textNode("option", reasonNames[reason]); option.value = reason; $("panelReasonSelect").append(option); }
  for (const [status, label] of Object.entries(statusNames)) { const option = textNode("option", label); option.value = status; $("panelStatus").append(option); }
  $("panelStage").value = lead.stage || "Novo"; $("panelReasonSelect").value = lead.reason; $("panelStatus").value = lead.messageStatus || "nao_gerada";
  $("panelFollow").value = lead.followUpDate || ""; $("panelNotes").value = lead.notes || ""; $("panelTone").value = $("cfgTone").value;
  $("panelPreview").value = lead.previewUrl || ""; $("panelMessage").value = lead.messageText || "";
  $("panelStage").addEventListener("change", () => attempt(() => send("UPDATE_LEAD", { id, stage: $("panelStage").value })));
  $("panelReasonSelect").addEventListener("change", () => attempt(async () => { await send("UPDATE_LEAD", { id, reason: $("panelReasonSelect").value }); $("panelReason").textContent = reasonNames[$("panelReasonSelect").value]; }));
  $("panelStatus").addEventListener("change", () => attempt(() => send("UPDATE_LEAD", { id, messageStatus: $("panelStatus").value })));
  $("panelFollow").addEventListener("change", () => attempt(() => send("UPDATE_LEAD", { id, followUpDate: $("panelFollow").value })));
  $("panelPreview").addEventListener("change", () => attempt(() => send("UPDATE_LEAD", { id, previewUrl: $("panelPreview").value })));
  $("btnSaveNotes").addEventListener("click", () => attempt(async () => { await send("UPDATE_LEAD", { id, notes: $("panelNotes").value }); toast("Observações salvas."); }));
  $("btnGenerate").addEventListener("click", () => attempt(async () => {
    const previewUrl = $("panelPreview").value.trim();
    if ($("panelPreviewReady").checked && !/^https?:\/\/[^\s]+$/i.test(previewUrl)) throw new Error("Informe um link de prévia válido.");
    templateDrafts[selectedTone] = $("templateText").value;
    const generated = LeadMessages.generateMessage({ ...lead, reason: $("panelReasonSelect").value, reasonManual: true, previewUrl }, settingsInput(), templateDrafts, { tone: $("panelTone").value, previewReady: $("panelPreviewReady").checked });
    const check = LeadMessages.validateMessage(generated); if (!check.ok) throw new Error(check.error);
    $("panelMessage").value = generated;
    await send("UPDATE_LEAD", { id, previewUrl, messageText: generated, messageStatus: "gerada" });
    $("panelStatus").value = "gerada"; toast("Texto gerado para revisão.");
  }));
  $("btnSaveMessage").addEventListener("click", () => attempt(async () => {
    const value = $("panelMessage").value, check = LeadMessages.validateMessage(value); if (!check.ok) throw new Error(check.error);
    await send("UPDATE_LEAD", { id, messageText: value, messageStatus: "gerada" }); $("panelStatus").value = "gerada"; toast("Mensagem salva.");
  }));
  $("btnCopyMessage").addEventListener("click", () => attempt(async () => {
    const value = $("panelMessage").value, check = LeadMessages.validateMessage(value); if (!check.ok) throw new Error(check.error);
    await navigator.clipboard.writeText(value);
    await send("UPDATE_LEAD", { id, messageText: value, messageStatus: "copiada" }); $("panelStatus").value = "copiada"; toast("Mensagem copiada. Envio manual.");
  }));
  const phone = String(lead.telefone || "").replace(/\D/g, "");
  $("btnOpenWhatsapp").disabled = !(/^\d{10,11}$/.test(phone) || /^55\d{10,11}$/.test(phone));
  $("btnOpenWhatsapp").addEventListener("click", () => attempt(() => chrome.tabs.create({ url: `https://wa.me/${phone.startsWith("55") && phone.length > 11 ? phone : `55${phone}`}` })));
  $("backdrop").hidden = false; $("leadPanel").hidden = false; document.body.style.overflow = "hidden";
  document.querySelector("main").inert = true; document.querySelector(".topbar").inert = true;
  $("btnClosePanel").focus();
}

async function exportBackup() {
  const data = { format: "empresas-sem-site-backup", version: 1, exportedAt: new Date().toISOString(), attribution: "© OpenStreetMap contributors (ODbL) — https://www.openstreetmap.org/copyright", leads: state.leads || [], messageSettings: state.messageSettings || LeadMessages.DEFAULT_SETTINGS, messageTemplates: state.messageTemplates || LeadMessages.DEFAULT_TEMPLATES };
  download(JSON.stringify(data, null, 2), "empresas-sem-site-backup.json", "application/json"); toast("Backup exportado.");
}
async function importBackup(file) {
  const data = JSON.parse(await readFile(file));
  if (data?.format !== "empresas-sem-site-backup" || !Array.isArray(data.leads)) throw new Error("Este arquivo não é um backup da extensão.");
  const response = await send("IMPORT_BACKUP", { data });
  toast(`${response.added} lead(s) novo(s) importado(s). Configurações de mensagens atualizadas.`);
  state = (await chrome.storage.local.get("leadFinder")).leadFinder || state;
  settingsLoaded = false; loadSettings(); render();
}

for (const button of document.querySelectorAll("[data-tab]")) button.addEventListener("click", () => setTab(button.dataset.tab));
for (const button of document.querySelectorAll("[data-source]")) button.addEventListener("click", () => setSource(button.dataset.source));
for (const id of ["filterSearch", "filterSource", "filterStage", "filterReason", "filterMessage", "sortBy"]) $(id).addEventListener(id === "filterSearch" ? "input" : "change", () => { page = 1; renderTable(); });
for (const stage of LeadCore.STAGES) { const option = textNode("option", stage); option.value = stage; $("filterStage").append(option); }
$("btnPrev").addEventListener("click", () => { page--; renderTable(); });
$("btnNext").addEventListener("click", () => { page++; renderTable(); });
$("btnFocusFollowup").addEventListener("click", () => { dueOnly = !dueOnly; page = 1; $("btnFocusFollowup").textContent = dueOnly ? "Ver todos" : "Ver pendentes"; renderTable(); });
$("btnStart").addEventListener("click", () => attempt(startSearch));
$("btnStop").addEventListener("click", () => attempt(() => send("STOP")));
$("btnOsmCenter").addEventListener("click", () => attempt(osmCenter));
$("btnImportTop").addEventListener("click", () => $("importFile").click());
$("btnImport").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", event => { const file = event.target.files[0]; if (file) attempt(() => importLeads(file)); event.target.value = ""; });
$("btnManual").addEventListener("click", openManual);
$("btnCloseManual").addEventListener("click", () => $("manualDialog").close());
$("btnCancelManual").addEventListener("click", () => $("manualDialog").close());
$("manualForm").addEventListener("submit", event => { event.preventDefault(); attempt(() => saveManual(event)); });
$("btnCsv").addEventListener("click", () => download(LeadCore.exportCsv(filteredLeads()), "empresas-sem-site.csv", "text/csv;charset=utf-8"));
$("btnJson").addEventListener("click", () => download(JSON.stringify({ attribution: "© OpenStreetMap contributors (ODbL) — https://www.openstreetmap.org/copyright", leads: filteredLeads() }, null, 2), "empresas-sem-site.json", "application/json"));
$("btnClearLog").addEventListener("click", () => attempt(() => send("CLEAR_LOG")));
$("btnSaveTemplate").addEventListener("click", () => attempt(saveSettings));
$("btnResetTemplate").addEventListener("click", () => { templateDrafts[selectedTone] = LeadMessages.DEFAULT_TEMPLATES[selectedTone]; $("templateText").value = templateDrafts[selectedTone]; toast("Modelo padrão restaurado. Salve para manter a mudança."); });
$("btnSaveSettings").addEventListener("click", () => attempt(saveSettings));
$("btnExportBackup").addEventListener("click", () => attempt(exportBackup));
$("btnImportBackup").addEventListener("click", () => $("backupFile").click());
$("backupFile").addEventListener("change", event => { const file = event.target.files[0]; if (file) attempt(() => importBackup(file)); event.target.value = ""; });
$("btnClosePanel").addEventListener("click", closeLead);
$("backdrop").addEventListener("click", closeLead);
document.addEventListener("keydown", event => {
  if ($("leadPanel").hidden) return;
  if (event.key === "Escape") { closeLead(); return; }
  if (event.key !== "Tab") return;
  const focusables = [...$("leadPanel").querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")];
  if (!focusables.length) return;
  if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0].focus(); }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.leadFinder) { state = changes.leadFinder.newValue || state; loadSettings(); render(); } });
chrome.storage.local.get("leadFinder").then(data => { state = data.leadFinder || state; loadSettings(); render(); }).catch(error => toast(error.message));
setSource("maps"); setTab(["radar", "playbook", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "radar");
