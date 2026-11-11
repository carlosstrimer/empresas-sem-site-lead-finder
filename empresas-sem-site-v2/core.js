(function (root) {
  "use strict";
  const STAGES = ["Novo", "Qualificado", "Contatado", "Respondeu", "Proposta", "Fechado", "Descartado"];
  const REASONS = ["SEM_SITE", "SO_WHATSAPP", "SO_REDES", "SITE_QUEBRADO", "SITE_A_VERIFICAR", "DESCONHECIDO"];
  const trim = value => String(value ?? "").trim();
  const digits = value => trim(value).replace(/\D/g, "");
  const fold = value => trim(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  function urlOf(value) {
    const input = trim(value);
    if (!input) return "";
    try {
      const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      return ["http:", "https:"].includes(url.protocol) && url.hostname.includes(".") ? url.href : "";
    } catch { return ""; }
  }
  function hasDomain(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
  function classifySite(value) {
    const url = urlOf(value);
    if (!url) return { reason: trim(value) ? "SITE_A_VERIFICAR" : "SEM_SITE", site: trim(value) };
    const host = new URL(url).hostname.toLowerCase();
    if (["wa.me", "whatsapp.com"].some(domain => hasDomain(host, domain))) return { reason: "SO_WHATSAPP", site: url };
    if (["instagram.com", "facebook.com", "fb.com", "tiktok.com", "linkedin.com", "linktr.ee", "beacons.ai", "bio.link", "youtube.com", "x.com"].some(domain => hasDomain(host, domain))) return { reason: "SO_REDES", site: url };
    return { reason: "SITE_A_VERIFICAR", site: url };
  }
  function score(lead) {
    let value = { SEM_SITE: 55, SO_WHATSAPP: 65, SO_REDES: 65, SITE_QUEBRADO: 75, SITE_A_VERIFICAR: 20, DESCONHECIDO: 10 }[lead.reason] || 10;
    if (digits(lead.telefone).length >= 10) value += 20;
    if (lead.email) value += 10;
    if (lead.endereco) value += 5;
    return Math.min(100, value);
  }
  function normalizeLead(raw) {
    const site = classifySite(raw.siteInformado || raw.site || raw.website);
    const reason = raw.siteKnown === false ? "DESCONHECIDO" : site.reason;
    const source = trim(raw.source) || "Importação";
    const cnpj = digits(raw.cnpj);
    const sourceId = trim(raw.sourceId) || (cnpj.length === 14 ? cnpj : `${fold(raw.nome)}|${fold(raw.endereco)}|${digits(raw.telefone)}`);
    const lead = {
      id: trim(raw.id) || `${source}:${sourceId}`, source, sourceId, cnpj: cnpj.length === 14 ? cnpj : "",
      nome: trim(raw.nome), telefone: trim(raw.telefone), email: trim(raw.email), endereco: trim(raw.endereco),
      categoria: trim(raw.categoria), siteInformado: site.site, reason, sourceUrl: urlOf(raw.sourceUrl),
      stage: STAGES.includes(raw.stage) ? raw.stage : "Novo", notes: trim(raw.notes).slice(0, 1000), reasonManual: false,
      collectedAt: Number(raw.collectedAt) || Date.now(), updatedAt: Date.now()
    };
    lead.score = score(lead);
    return lead;
  }
  function sameLead(a, b) {
    if (a.source === b.source && a.sourceId === b.sourceId) return true;
    if (a.cnpj && b.cnpj && a.cnpj === b.cnpj) return true;
    const phoneA = digits(a.telefone), phoneB = digits(b.telefone);
    if (phoneA.length >= 10 && phoneA === phoneB && fold(a.nome) === fold(b.nome)) return true;
    return !!(a.endereco && b.endereco && fold(a.nome) === fold(b.nome) && fold(a.endereco) === fold(b.endereco));
  }
  function mergeLead(old, incoming) {
    const merged = { ...old };
    for (const key of ["cnpj", "telefone", "email", "endereco", "categoria", "siteInformado", "sourceUrl"]) if (!merged[key] && incoming[key]) merged[key] = incoming[key];
    if (incoming.siteInformado && !old.siteInformado && !old.reasonManual) merged.reason = incoming.reason;
    merged.sources = Array.from(new Set([...(old.sources || [old.source]), incoming.source]));
    merged.score = score(merged);
    merged.updatedAt = Date.now();
    return merged;
  }
  const categories = {
    restaurante: ["amenity", "restaurant"], bar: ["amenity", "bar"], cafe: ["amenity", "cafe"],
    padaria: ["shop", "bakery"], farmacia: ["amenity", "pharmacy"], academia: ["leisure", "fitness_centre"],
    barbearia: ["shop", "hairdresser"], salao: ["shop", "hairdresser"], mercado: ["shop", "supermarket"],
    hotel: ["tourism", "hotel"], oficina: ["shop", "car_repair"], dentista: ["amenity", "dentist"],
    advogado: ["office", "lawyer"], imobiliaria: ["office", "estate_agent"]
  };
  function buildOverpassQuery({ latitude, longitude, radius, keyword, limit }) {
    const lat = Number(latitude), lon = Number(longitude), metres = Number(radius), count = Number(limit);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(metres) || !Number.isFinite(count) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || metres < 500 || metres > 10000 || count < 1 || count > 500) throw new Error("Parâmetros inválidos para o OpenStreetMap.");
    const key = fold(keyword).split(/\s+/)[0];
    const mapped = categories[key];
    const escaped = trim(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/["\\]/g, "\\$&");
    const filter = mapped ? `["${mapped[0]}"="${mapped[1]}"]` : `["name"~"${escaped}",i]`;
    return `[out:json][timeout:25];nwr${filter}(around:${Math.round(metres)},${lat},${lon});out center ${Math.round(count)};`;
  }
  function mapOsmElement(element) {
    const tags = element.tags || {};
    if (!tags.name) return null;
    const address = [tags["addr:street"], tags["addr:housenumber"], tags["addr:suburb"], tags["addr:city"]].filter(Boolean).join(", ");
    const instagram = trim(tags["contact:instagram"]);
    const social = instagram ? (/^https?:\/\//i.test(instagram) ? instagram : `https://www.instagram.com/${instagram.replace(/^@/, "")}`) : tags["contact:facebook"] || "";
    const whatsappDigits = digits(tags["contact:whatsapp"]);
    const site = tags.website || tags["contact:website"] || tags.url || social || (whatsappDigits ? `https://wa.me/${whatsappDigits}` : "");
    return { source: "OpenStreetMap", sourceId: `${element.type}/${element.id}`, sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`, nome: tags.name, telefone: tags.phone || tags["contact:phone"] || "", email: tags.email || tags["contact:email"] || "", endereco: address, categoria: tags.shop || tags.amenity || tags.office || tags.craft || tags.tourism || tags.leisure || "", siteInformado: site };
  }
  function parseCsv(text) {
    const input = String(text).replace(/^\uFEFF/, "");
    const firstLine = input.split(/\r?\n/, 1)[0];
    const delimiter = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = []; let row = [], field = "", quoted = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (char === delimiter && !quoted) { row.push(field); field = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && input[i + 1] === "\n") i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
      else field += char;
    }
    row.push(field); if (row.some(Boolean)) rows.push(row);
    if (quoted) throw new Error("CSV com aspas sem fechamento.");
    const headers = (rows.shift() || []).map(fold);
    return rows.map(cells => Object.fromEntries(headers.map((header, i) => [header, cells[i] || ""])));
  }
  function mapEmpresaquiRow(row, index = 0) {
    if (!row || typeof row !== "object") return null;
    const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [fold(key).replace(/[^a-z0-9]+/g, "_"), value]));
    const pick = (...keys) => keys.map(key => normalized[key]).find(value => trim(value)) || "";
    const siteKeys = ["site", "website", "url_site", "site_informado", "site_empresa", "pagina_web"];
    const hasSiteColumn = siteKeys.some(key => Object.hasOwn(normalized, key));
    const cnpj = digits(pick("cnpj", "cnpj_completo"));
    const name = pick("nome_fantasia", "fantasia", "nome", "razao_social", "razao");
    if (!name) return null;
    const phone = pick("telefone", "telefone_1", "celular", "whatsapp") || `${pick("ddd_1")}${pick("tel_1")}`;
    const address = pick("endereco", "logradouro", "log_nome");
    const city = pick("municipio", "cidade", "log_municipio");
    return { source: "EmpresAqui", sourceId: cnpj || `${fold(name)}|${fold(address)}|${fold(city)}|${digits(phone) || index}`, cnpj, nome: name, telefone: phone, email: pick("email", "e_mail"), endereco: [address, city].filter(Boolean).join(", "), categoria: pick("cnae_principal", "atividade_economica", "segmento"), siteInformado: pick(...siteKeys), siteKnown: hasSiteColumn, sourceUrl: "https://www.empresaqui.com.br/" };
  }
  function csvCell(value) {
    let text = trim(value);
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function exportCsv(leads) {
    const columns = [["Nome", "nome"], ["Fonte", "source"], ["CNPJ", "cnpj"], ["Telefone", "telefone"], ["E-mail", "email"], ["Endereço", "endereco"], ["Categoria", "categoria"], ["Site informado", "siteInformado"], ["Motivo", "reason"], ["Pontuação", "score"], ["Etapa", "stage"], ["Observações", "notes"], ["Origem", "sourceUrl"], ["Atribuição", "attribution"]];
    return "\uFEFF" + [columns.map(([label]) => csvCell(label)).join(";"), ...leads.map(lead => columns.map(([, key]) => csvCell(key === "attribution" && (lead.source === "OpenStreetMap" || lead.sources?.includes("OpenStreetMap")) ? "© OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright" : lead[key])).join(";"))].join("\r\n");
  }
  const api = { STAGES, REASONS, score, classifySite, normalizeLead, sameLead, mergeLead, buildOverpassQuery, mapOsmElement, parseCsv, mapEmpresaquiRow, exportCsv };
  root.LeadCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
