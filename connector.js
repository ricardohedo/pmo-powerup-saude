/* Conector do Power-Up "PMO BigBox - Saude do projeto" (SO LEITURA, piloto no quadro de teste).
 * Capacidades: selo no card, detalhe com motivos e cadastro guiado, botao de status semanal, painel do quadro. */
const COR = { vermelho: "red", amarelo: "yellow", verde: "green" };
const ROTULO = { vermelho: "Atenção", amarelo: "De olho", verde: "Em dia" };

function pontosCadastro(d) {
  const cad = d.alertas.find((a) => a.tipo === "cadastro_incompleto");
  return cad ? String(cad.valor).split(", ") : [];
}

TrelloPowerUp.initialize({
  "card-badges": async (t) => {
    const d = await PmoDados.cardEmFoco(t);
    const n = d.alertas.filter((a) => d.regras.nivel[a.tipo] !== "verde").length;
    return [{ text: ROTULO[d.nivel] + (n ? " · " + n : ""), color: COR[d.nivel] }];
  },

  "card-detail-badges": async (t) => {
    const d = await PmoDados.cardEmFoco(t);
    const badges = [{
      title: "Saúde do projeto", text: ROTULO[d.nivel], color: COR[d.nivel],
      callback: (tt) => tt.popup({
        title: "Por que " + ROTULO[d.nivel].toLowerCase() + "?",
        items: d.alertas.length
          ? d.alertas.map((a) => ({ text: PmoMotor.frase(a) + " — " + (d.regras.acao[a.tipo] || "") }))
          : [{ text: "Nenhum sinal automático neste card." }],
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
  },

  "card-buttons": () => [{
    text: "Status semanal",
    callback: (t) => t.popup({ title: "Status semanal (rascunho)", url: "./status.html", height: 320 }),
  }],

  "board-buttons": () => [{
    text: "Painel PMO",
    callback: (t) => t.modal({ title: "Painel de saúde do quadro", url: "./painel.html", height: 560 }),
  }],
});
