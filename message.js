(function (root) {
  "use strict";
  const DEFAULT_SETTINGS = {
    companyName: "Impacto Web",
    memberName: "",
    offer: "criação de sites",
    cta: "posso te mostrar uma ideia para a presença digital da empresa?",
    tone: "profissional"
  };
  const DEFAULT_TEMPLATES = {
    profissional: "{saudacao}\n\n{apresentacao}\n\n{contexto}\n\nNa {nossa_empresa}, trabalhamos com {oferta}. Se fizer sentido, {cta}",
    curta: "{saudacao} {apresentacao} {contexto} Trabalhamos com {oferta}. {cta}",
    curiosidade: "{saudacao}\n\n{apresentacao}\n\n{contexto}\n\nVocê já pensou em como um site poderia complementar os canais atuais da {empresa}? {cta}",
    direta: "{saudacao} {apresentacao} A {nossa_empresa} trabalha com {oferta}. {cta}",
    previa_pronta: "{saudacao}\n\n{apresentacao}\n\nPreparei uma prévia para a {empresa}: {preview_url}\n\nSe quiser, posso explicar a proposta."
  };
  const TONES = ["profissional", "curta", "curiosidade", "direta", "previa_pronta"];
  const text = value => String(value ?? "").trim();
  function contextFor(lead) {
    switch (lead.reason) {
      case "SEM_SITE": return "No cadastro consultado, não encontrei um site próprio informado para a empresa.";
      case "SO_WHATSAPP": return "O link digital informado no cadastro direciona para WhatsApp.";
      case "SO_REDES": return "O link digital informado no cadastro direciona para uma rede social.";
      case "SITE_QUEBRADO": return lead.reasonManual ? "O site informado apresentou um problema de acesso na verificação registrada." : "Encontrei uma oportunidade de rever a presença digital da empresa.";
      default: return "Encontrei a empresa enquanto pesquisava negócios da região.";
    }
  }
  function generateMessage(lead, settings = {}, templates = {}, options = {}) {
    const config = { ...DEFAULT_SETTINGS, ...settings };
    const empresa = text(lead.nome) || "empresa";
    const nossa = text(config.companyName) || DEFAULT_SETTINGS.companyName;
    const member = text(config.memberName);
    const previewUrl = text(lead.previewUrl);
    let tone = options.previewReady && /^https?:\/\//i.test(previewUrl) ? "previa_pronta" : options.tone || config.tone;
    if (!TONES.includes(tone) || (tone === "previa_pronta" && !/^https?:\/\//i.test(previewUrl))) tone = "profissional";
    const template = text(templates[tone]) || DEFAULT_TEMPLATES[tone];
    const values = {
      saudacao: `Olá, equipe da ${empresa}, tudo bem?`,
      apresentacao: member ? `Sou ${member}, da ${nossa}.` : `Sou da ${nossa}.`,
      contexto: contextFor(lead), empresa, nossa_empresa: nossa,
      oferta: text(config.offer) || DEFAULT_SETTINGS.offer,
      cta: text(config.cta) || DEFAULT_SETTINGS.cta,
      preview_url: previewUrl
    };
    return template.replace(/\{([a-z_]+)\}/g, (match, key) => key in values ? values[key] : match)
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function validateMessage(value) {
    const content = text(value);
    if (content.length < 40) return { ok: false, error: "Mensagem muito curta." };
    if (/\{[a-z_]+\}/i.test(content)) return { ok: false, error: "Há um placeholder não preenchido." };
    return { ok: true };
  }
  const api = { DEFAULT_SETTINGS, DEFAULT_TEMPLATES, TONES, generateMessage, validateMessage, contextFor };
  root.LeadMessages = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
