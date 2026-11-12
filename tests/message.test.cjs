const { test } = require("node:test");
const assert = require("node:assert/strict");
const messages = require("../message.js");

test("mensagem usa apenas sinal do cadastro e não inventa prévia", () => {
  const lead = { nome: "Loja Azul", reason: "SEM_SITE", previewUrl: "" };
  const text = messages.generateMessage(lead, {}, {}, { previewReady: true });
  assert.match(text, /não encontrei um site próprio informado/);
  assert.doesNotMatch(text, /Preparei uma prévia/);
  assert.equal(messages.validateMessage(text).ok, true);
});

test("prévia pronta exige URL real e templates personalizados não deixam campos soltos", () => {
  const lead = { nome: "Loja Azul", reason: "SO_REDES", previewUrl: "https://exemplo.test/previa" };
  const text = messages.generateMessage(lead, { memberName: "Ana", companyName: "Impacto Web" }, {}, { previewReady: true });
  assert.match(text, /Preparei uma prévia/);
  assert.match(text, /https:\/\/exemplo\.test\/previa/);
  assert.match(text, /Sou Ana/);
  assert.equal(messages.validateMessage(text).ok, true);
  assert.equal(messages.validateMessage("Olá {campo_inexistente}, tudo bem? Gostaria de conversar com você.").ok, false);
});
