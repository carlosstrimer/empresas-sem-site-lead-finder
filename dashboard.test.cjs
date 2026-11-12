const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const script = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("dashboard da extensão tem navegação e referências válidas", () => {
  assert.equal(manifest.options_page, "dashboard.html");
  assert.match(html, /data-tab="radar"/);
  assert.match(html, /data-tab="playbook"/);
  assert.match(html, /data-tab="settings"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const dynamicIds = [...script.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "IDs duplicados no dashboard");
  for (const [, id] of script.matchAll(/\$\("([A-Za-z][A-Za-z0-9-]*)"\)/g)) {
    assert.ok(ids.includes(id) || dynamicIds.includes(id), `ID usado pelo JavaScript não existe no HTML: ${id}`);
  }
  for (const asset of ["dashboard.css", "dashboard.js", "assets/impacto-web-logo.svg"]) {
    assert.ok(fs.existsSync(path.join(root, asset)), `${asset} ausente`);
  }
});
