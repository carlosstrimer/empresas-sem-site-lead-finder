import { spawn } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9400 + process.pid % 300;
const profile = join(root, `.tmp-smoke-profile-${process.pid}`);
const screenshot = join(root, ".tmp-dashboard-live.png");
const mobileScreenshot = join(root, ".tmp-dashboard-mobile.png");
const browser = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.exceptions = [];
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") this.exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id); this.pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    };
  }
  async ready() { await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; }); }
  call(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

const mock = `(() => {
  const listeners = [];
  let value = { leads: [
    { id:'Google Maps:one',source:'Google Maps',sources:['Google Maps'],sourceId:'one',nome:'Barbearia Central',telefone:'11999999999',endereco:'Campinas',reason:'SEM_SITE',score:75,stage:'Novo',messageStatus:'nao_gerada',collectedAt:Date.now(),notes:'' },
    { id:'OpenStreetMap:two',source:'OpenStreetMap',sources:['OpenStreetMap'],sourceId:'two',nome:'Padaria Estação',telefone:'11988888888',endereco:'São Paulo',reason:'SO_REDES',score:85,stage:'Qualificado',messageStatus:'gerada',collectedAt:Date.now()-1,notes:'' }
  ], logs:[], run:null };
  globalThis.chrome = {
    runtime: { sendMessage: async msg => {
      if (msg.type === 'UPDATE_LEAD') { const lead=value.leads.find(item=>item.id===msg.id); if(lead) Object.assign(lead,msg); listeners.forEach(fn=>fn({leadFinder:{newValue:value}},'local')); }
      if (msg.type === 'UPDATE_MESSAGE_SETTINGS') { value.messageSettings=msg.settings; value.messageTemplates=msg.templates; listeners.forEach(fn=>fn({leadFinder:{newValue:value}},'local')); }
      if (msg.type === 'CLEAR_LOG') { value.logs=[]; listeners.forEach(fn=>fn({leadFinder:{newValue:value}},'local')); }
      return {ok:true,added:1};
    } },
    storage: { local: { get: async () => ({leadFinder:value}) }, onChanged: { addListener: fn => listeners.push(fn) } },
    tabs: { query: async () => [], create: async () => ({}) }
  };
  globalThis.__smokeState = () => value;
})();`;

let cdp;
try {
  let page;
  for (let i = 0; i < 50; i++) {
    try { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); page = pages.find(item => item.type === "page"); if (page) break; } catch {}
    await sleep(200);
  }
  if (!page) throw new Error("Chrome DevTools indisponível.");
  cdp = new Cdp(page.webSocketDebuggerUrl); await cdp.ready();
  await cdp.call("Page.enable"); await cdp.call("Runtime.enable");
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", { source: mock });
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.call("Page.navigate", { url: pathToFileURL(join(root, "dashboard.html")).href });
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    ready = await cdp.evaluate("document.getElementById('statTotal')?.textContent === '2'");
    if (ready) break;
  }
  if (!ready) throw new Error(`Dashboard não inicializou: ${cdp.exceptions.join(" | ") || "sem erro registrado"}`);
  const results = await cdp.evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r,ms));
    const assert = (condition,label) => { if(!condition) throw new Error(label); return label; };
    const checks=[];
    checks.push(assert(document.getElementById('statTotal').textContent==='2','indicadores'));
    checks.push(assert(document.querySelectorAll('#leadRows tr').length===2,'tabela'));
    document.querySelector('[data-tab="playbook"]').click(); checks.push(assert(document.getElementById('tab-playbook').classList.contains('active'),'aba playbook'));
    document.querySelector('[data-tab="settings"]').click(); checks.push(assert(document.getElementById('tab-settings').classList.contains('active'),'aba configurações'));
    document.querySelector('[data-tab="radar"]').click();
    document.querySelector('[data-source="osm"]').click(); checks.push(assert(!document.getElementById('source-osm').hidden,'fonte OSM'));
    document.getElementById('filterSearch').value='Padaria'; document.getElementById('filterSearch').dispatchEvent(new Event('input',{bubbles:true}));
    checks.push(assert(document.querySelectorAll('#leadRows tr').length===1,'busca filtrada'));
    document.getElementById('filterSearch').value='Barbearia'; document.getElementById('filterSearch').dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#leadRows button').click(); checks.push(assert(!document.getElementById('leadPanel').hidden,'painel do lead'));
    document.getElementById('panelStage').value='Contatado'; document.getElementById('panelStage').dispatchEvent(new Event('change',{bubbles:true})); await wait(100);
    checks.push(assert(__smokeState().leads[0].stage==='Contatado','edição da etapa'));
    document.getElementById('btnGenerate').click(); await wait(150);
    checks.push(assert(__smokeState().leads[0].messageStatus==='gerada','geração de mensagem'));
    document.getElementById('btnClosePanel').click(); checks.push(assert(document.getElementById('leadPanel').hidden,'fechamento do painel'));
    document.getElementById('btnManual').click(); checks.push(assert(document.getElementById('manualDialog').open,'cadastro manual'));
    document.getElementById('btnCancelManual').click();
    return checks;
  })()`);
  const capture = await cdp.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(screenshot, Buffer.from(capture.data, "base64"));
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(250);
  const mobile = await cdp.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,tabs:[...document.querySelectorAll('.tab')].every(item=>item.getBoundingClientRect().width>0)})");
  if (mobile.scroll > mobile.width || !mobile.tabs) throw new Error(`Layout móvel com overflow: ${JSON.stringify(mobile)}`);
  const mobileCapture = await cdp.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(mobileScreenshot, Buffer.from(mobileCapture.data, "base64"));
  if (cdp.exceptions.length) throw new Error(`Erros no console: ${cdp.exceptions.join(" | ")}`);
  process.stdout.write(`Smoke test: ${results.join(", ")}, layout móvel\nCapturas: ${screenshot}, ${mobileScreenshot}\n`);
} finally {
  cdp?.close(); browser.kill();
  await sleep(500);
  if (profile.startsWith(root + sep) && /^\.tmp-smoke-profile-\d+$/.test(profile.slice(root.length + 1)) && existsSync(profile)) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { process.stderr.write(`Perfil temporário não removido: ${error.message}\n`); }
  }
}
