/* Power-Up "PMO BigBox - Interdependencia entre areas" (PILOTO, so quadros de teste).
 * Mostra no card o que ele depende de outras areas (card inteiro e itens de checklist [DEPENDE: Area]).
 * Quem escreve no Trello e o backend (credencial do PMO), nunca o navegador do gestor.
 * Selo: so consulta o backend se o card JA tem vinculo (anexo INTERDEP), para nao disparar uma chamada por card a cada renderizacao do quadro. */
const ICONE = new URL("./icone.svg", location.href).href;
const COR = { red: "red", orange: "orange", yellow: "yellow", green: "green", gray: "light-gray" };

TrelloPowerUp.initialize({
  "card-badges": async (t) => {
    try {
      const { attachments } = await t.card("attachments");
      if (!(attachments || []).some((a) => /^INTERDEP/.test(a.name || ""))) return [];
      const { id } = await t.card("id");
      const [s, d] = await Promise.all([Interdep.status(id), Interdep.deps(id)]);
      const sinais = s.vinculos.map(Interdep.sinal).concat(d.itens.map(Interdep.sinalItem));
      if (!sinais.length) return [];
      const p = Interdep.pior(sinais);
      const bloq = d.itens.filter((i) => i.situacao !== "liberado").length;
      const texto = bloq ? "Aguarda outra área · " + bloq : "Interdep · " + sinais.length;
      return [{ text: texto, color: COR[p.cor] }];
    } catch (e) {
      return [{ text: "Interdep: indisponível", color: "orange" }];
    }
  },
  "card-back-section": (t) => ({
    title: "Interdependência entre áreas", icon: ICONE,
    content: { type: "iframe", url: t.signUrl("./secao.html"), height: 220 },
  }),
  "card-buttons": () => [{
    icon: ICONE, text: "Depende de outra área",
    callback: (t) => t.popup({ title: "Depende de outra área", url: "./vinculo.html", height: 230 }),
  }],
  "board-buttons": () => [{
    icon: ICONE, text: "Interdependências",
    callback: (t) => t.modal({ title: "Interdependências do quadro", url: "./painel.html", height: 560 }),
  }],
});
