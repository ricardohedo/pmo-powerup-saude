/* Conector do Power-Up "PMO BigBox - Saude do projeto" (SO LEITURA, piloto no quadro de teste).
 * Capacidades: selo no card, detalhe com motivos e cadastro guiado, botao de status semanal, painel do quadro.
 * Erros aparecem no selo (nao ficam em silencio) para o piloto ser diagnosticavel no Trello real. */
const COR = { vermelho: "red", amarelo: "yellow", verde: "green" };
const ROTULO = { vermelho: "Atenção", amarelo: "De olho", verde: "Em dia" };
const COR_P = { P1: "red", P2: "orange", P3: "yellow", P4: "green" };   // P1 Critico, P2 Atencao, P3 Preventivo, P4 Informativo
const ICONE = new URL("./icone.svg", location.href).href;

function pontosCadastro(d) {
  const cad = d.alertas.find((a) => a.tipo === "cadastro_incompleto");
  return cad ? String(cad.valor).split(", ") : [];
}

function erro(e) {
  console.error("[PMO Power-Up]", e);
  return String((e && e.message) || e).slice(0, 60);
}

TrelloPowerUp.initialize({
  "card-badges": async (t) => {
    try {
      const d = await PmoDados.cardEmFoco(t);
      const n = d.alertas.filter((a) => d.regras.nivel[a.tipo] !== "verde").length;
      const selos = [d.prioridade
        ? { text: d.prioridade + " " + d.regras.rotulo_prioridade[d.prioridade] + (n ? " · " + n : ""), color: COR_P[d.prioridade] }
        : { text: ROTULO[d.nivel] + (n ? " · " + n : ""), color: COR[d.nivel] }];
      if (d.risco) selos.push({ text: "⏳ " + d.regras.rotulo_risco[d.risco], color: d.risco === "alto" ? "red" : "yellow" });
      return selos;
    } catch (e) {
      return [{ text: "PMO: erro — " + erro(e), color: "orange" }];
    }
  },

  "card-detail-badges": async (t) => {
    try {
      const d = await PmoDados.cardEmFoco(t);
      const badges = [{
        title: "Saúde do projeto", text: ROTULO[d.nivel], color: COR[d.nivel],
        callback: (tt) => tt.popup({
          title: "Por que " + ROTULO[d.nivel].toLowerCase() + "?",
          items: (d.prioridade ? [{ text: d.prioridade + " " + d.regras.rotulo_prioridade[d.prioridade] + " — " + d.regras.fazer_prioridade[d.prioridade] }] : [])
            .concat(d.risco ? [{ text: "⏳ " + d.regras.rotulo_risco[d.risco] + " — " + d.regras.fazer_risco[d.risco] }] : [])
            .concat(d.alertas.length
              ? d.alertas.map((a) => ({ text: PmoMotor.frase(a) + " — " + (d.regras.acao[a.tipo] || "") }))
              : [{ text: "Nenhum sinal automático neste card." }]),
        }),
      }];
      const falta = pontosCadastro(d);
      if (falta.length) {
        badges.push({
          title: "Cadastro", text: falta.length + (falta.length === 1 ? " campo falta" : " campos faltam"), color: "red",
          callback: (tt) => tt.popup({
            title: "Cadastro guiado",
            items: falta.map((f) => ({ text: "Falta: " + f })).concat([{ text: "Preencha no próprio card; o Power-Up só mostra, não altera." }]),
          }),
        });
      }
      return badges;
    } catch (e) {
      return [{ title: "PMO", text: "erro — " + erro(e), color: "orange" }];
    }
  },

  "card-back-section": (t) => ({
    title: "Saúde do projeto",
    icon: ICONE,
    content: { type: "iframe", url: t.signUrl("./secao.html"), height: 260 },
  }),

  "card-buttons": () => [{
    icon: ICONE,
    text: "Status semanal",
    callback: (t) => t.popup({ title: "Status semanal (rascunho)", url: "./status.html", height: 320 }),
  }],

  "board-buttons": () => [{
    icon: ICONE,
    text: "Onde atuar",
    callback: (t) => t.modal({ title: "Onde atuar", url: "./atuar.html", height: 600 }),
  }, {
    icon: ICONE,
    text: "Linha do tempo",
    callback: (t) => t.modal({ title: "Linha do tempo de entregas", url: "./linha.html", height: 600 }),
  }, {
    icon: ICONE,
    text: "Painel PMO",
    callback: (t) => t.modal({ title: "Painel de saúde do quadro", url: "./painel.html", height: 560 }),
  }],
});
