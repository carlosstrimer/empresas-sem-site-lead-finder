const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

test("classificação usa domínio real e não marca erro de rede como site quebrado", () => {
  assert.equal(core.classifySite("https://instagram.com/loja").reason, "SO_REDES");
  assert.equal(core.classifySite("https://instagram.com.evil.test/").reason, "SITE_A_VERIFICAR");
  assert.equal(core.classifySite("https://wa.me/5511999999999").reason, "SO_WHATSAPP");
  assert.equal(core.classifySite("").reason, "SEM_SITE");
  assert.equal(core.classifySite("https://loja.example/").reason, "SITE_A_VERIFICAR");
});

test("deduplicação preserva etapa e observações ao juntar fontes", () => {
  const maps = core.normalizeLead({ source: "Google Maps", sourceId: "maps/1", nome: "Loja Exemplo", telefone: "11999999999", stage: "Contatado", notes: "Ligou" });
  const company = core.normalizeLead({ source: "EmpresAqui", sourceId: "12345678000199", cnpj: "12345678000199", nome: "Loja Exemplo", telefone: "11999999999", email: "contato@example.test" });
  assert.equal(core.sameLead(maps, company), true);
  const merged = core.mergeLead(maps, company);
  assert.equal(merged.stage, "Contatado");
  assert.equal(merged.notes, "Ligou");
  assert.equal(merged.email, "contato@example.test");
  assert.deepEqual(merged.sources, ["Google Maps", "EmpresAqui"]);
});

test("CSV do EmpresAqui interpreta aspas, separador e dados incompletos", () => {
  const rows = core.parseCsv('Nome Fantasia;CNPJ;Site;Telefone\r\n"ACME; Brasil";12345678000199;;11999999999\r\n');
  const lead = core.normalizeLead(core.mapEmpresaquiRow(rows[0]));
  assert.equal(lead.nome, "ACME; Brasil");
  assert.equal(lead.reason, "SEM_SITE");
  assert.equal(core.normalizeLead(core.mapEmpresaquiRow({ Nome: "Sem coluna site" })).reason, "DESCONHECIDO");
});

test("consulta OSM limita área e escapa termo de pesquisa", () => {
  const query = core.buildOverpassQuery({ latitude: -23.55, longitude: -46.63, radius: 3000, keyword: "barbearia", limit: 50 });
  assert.match(query, /\["shop"="hairdresser"\]/);
  assert.match(query, /around:3000,-23\.55,-46\.63/);
  const other = core.buildOverpassQuery({ latitude: -23.55, longitude: -46.63, radius: 3000, keyword: "Acme.*", limit: 50 });
  assert.equal(other.includes('Acme\\\\.\\\\*'), true);
  assert.throws(() => core.buildOverpassQuery({ latitude: -23.55, longitude: -46.63, radius: 1000000, keyword: "barbearia", limit: 50 }));
});

test("exportação neutraliza fórmulas e atribui OpenStreetMap", () => {
  const lead = core.normalizeLead({ source: "OpenStreetMap", sourceId: "node/1", nome: "=CMD()", siteInformado: "" });
  const csv = core.exportCsv([lead]);
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /OpenStreetMap contributors \(ODbL\)/);
});

test("importação genérica aproveita colunas da pasta de mensagens e preserva dados comerciais", () => {
  const csv = 'Empresa\tTelefone\tSite\tInstagram\tMensagem\tStatus da mensagem\r\nLoja Azul\t11999999999\t\t@lojaazul\tOlá, equipe da Loja Azul. Sou da Impacto Web e gostaria de conversar sobre um site.\tgerada\r\n';
  const rows = core.parseCsv(csv);
  const lead = core.normalizeLead(core.mapImportedRow(rows[0], "Google Maps"));
  assert.equal(lead.nome, "Loja Azul");
  assert.equal(lead.reason, "SO_REDES");
  assert.equal(lead.messageStatus, "gerada");
  assert.match(lead.messageText, /gostaria de conversar/);
});

test("JSON exportado pode ser reimportado com site, origem e mensagem", () => {
  const original = core.normalizeLead({ source: "Google Maps", sourceId: "maps/1", sourceUrl: "https://www.google.com/maps/place/Exemplo", nome: "Loja Exemplo", siteInformado: "https://exemplo.com", messageText: "Olá, equipe da Loja Exemplo. Gostaria de conversar sobre uma proposta de site.", messageStatus: "contatada", followUpDate: "2026-11-20" });
  const imported = core.normalizeLead(core.mapImportedRow(JSON.parse(JSON.stringify(original)), "Google Maps"));
  assert.equal(imported.sourceId, original.sourceId);
  assert.equal(imported.siteInformado, original.siteInformado);
  assert.equal(imported.sourceUrl, original.sourceUrl);
  assert.equal(imported.messageStatus, "contatada");
  assert.equal(imported.followUpDate, "2026-11-20");
});

test("backup preserva a origem de leads que vieram de mais de uma fonte", () => {
  const restored = core.normalizeLead({ source: "Google Maps", sources: ["Google Maps", "OpenStreetMap"], sourceId: "maps/1", nome: "Loja Exemplo" });
  assert.deepEqual(restored.sources, ["Google Maps", "OpenStreetMap"]);
  const merged = core.mergeLead(restored, core.normalizeLead({ source: "EmpresAqui", sourceId: "cnpj/1", nome: "Loja Exemplo", telefone: "11999999999", endereco: "Rua A" }));
  assert.deepEqual(merged.sources, ["Google Maps", "OpenStreetMap", "EmpresAqui"]);
});
