"use strict";
const $ = id => document.getElementById(id);
let state = { leads: [], logs: [], run: null };
let renderTimer;
const reasonLabels = { SEM_SITE: "Sem site informado", SO_WHATSAPP: "Só WhatsApp", SO_REDES: "Só redes sociais", SITE_QUEBRADO: "Site quebrado (confirmado)", SITE_A_VERIFICAR: "Site a verificar", DESCONHECIDO: "Dados incompletos" };
for (const stage of LeadCore.STAGES) {
  const option = document.createElement("option"); option.value = stage; option.textContent = stage; $("filter-stage").append(option);
}
function message(value) { $("message").textContent = value; }
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
  $("start").textContent = source === "empresaqui" ? "Importar arquivo" : "Iniciar pesquisa";
}
function filtered() {
  const source = $("filter-source").value, stage = $("filter-stage").value, reason = $("filter-reason").value;
  const search = $("filter-search").value.toLocaleLowerCase("pt-BR").trim();
  return (state.leads || []).filter(lead =>
    (!source || lead.source === source || lead.sources?.includes(source)) &&
    (!stage || lead.stage === stage) && (!reason || lead.reason === reason) &&
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
  const notes = document.createElement("textarea"); notes.placeholder = "Observações e próximo passo"; notes.value = lead.notes || ""; notes.maxLength = 1000; notes.setAttribute("aria-label", `Observações de ${lead.nome}`); card.append(notes);
  const save = addText(card, "button", "Salvar observação", "secondary save");
  save.type = "button";
  save.addEventListener("click", () => send("UPDATE_LEAD", { id: lead.id, notes: notes.value }).then(() => message("Observação salva.")).catch(error => message(error.message)));
  return card;
}
function render() {
  const leads = state.leads || [];
  $("total").textContent = `${leads.length} lead(s)`;
  const running = state.run?.status === "running";
  $("start").disabled = running; $("stop").disabled = !running;
  if (state.run) {
    const run = state.run;
    const label = { running: "em andamento", done: "concluída", error: "erro", stopped: "interrompida", interrupted: "interrompida" }[run.status] || run.status;
    $("message").textContent = `${run.source}: ${label}. ${run.scanned || 0} analisados, ${run.added || 0} novos, ${run.matched || 0} oportunidades. ${run.message || ""}`;
  }
  const stages = $("stages"); stages.replaceChildren();
  for (const stage of LeadCore.STAGES) addText(stages, "span", `${stage}: ${leads.filter(lead => lead.stage === stage).length}`);
  const matches = filtered();
  $("shown").textContent = `${matches.length} resultado(s) no filtro${matches.length > 100 ? "; exibindo os 100 primeiros" : ""}.`;
  $("csv").disabled = !matches.length; $("json").disabled = !matches.length;
  const box = $("leads"); box.replaceChildren(...matches.slice(0, 100).map(renderLead));
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
$("source").addEventListener("change", selectedSource);
$("empresaqui-lookup").addEventListener("click", async () => {
  const button = $("empresaqui-lookup"); button.disabled = true;
  try {
    const result = await send("LOOKUP_EMPRESAQUI", { cnpj: $("empresaqui-cnpj").value, token: $("empresaqui-token").value });
    message(result.added ? "Empresa adicionada ao funil." : "Empresa já existente; dados atualizados.");
  } catch (error) { message(error.message); }
  finally { $("empresaqui-token").value = ""; button.disabled = false; }
});
for (const id of ["filter-source", "filter-stage", "filter-reason", "filter-search"]) $(id).addEventListener(id === "filter-search" ? "input" : "change", scheduleRender);
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
