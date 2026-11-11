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
