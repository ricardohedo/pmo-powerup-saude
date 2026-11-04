/* Power-Up "PMO BigBox - Interdependencia entre areas" (PILOTO, so quadros de teste).
 * Mostra no card o que ele depende de outras areas (e o que deve a elas) e liga uma nova dependencia pelo botao.
 * Quem escreve no Trello e o backend (credencial do PMO), nunca o navegador do gestor. */
const ICONE = new URL("./icone.svg", location.href).href;
const COR = { red: "red", yellow: "yellow", green: "green", gray: "light-gray" };

TrelloPowerUp.initialize({
  "card-badges": async (t) => {
    try {
      const { id } = await t.card("id");
      const s = await Interdep.status(id);
      if (!s.vinculos.length) return [];
      return [{ text: "Interdep · " + s.vinculos.length, color: COR[Interdep.pior(s.vinculos).cor] }];
    } catch (e) {
      return [{ text: "Interdep: indisponível", color: "orange" }];
    }
  },
  "card-back-section": () => ({
    title: "Interdependência entre áreas", icon: ICONE,
    content: { type: "iframe", url: "./secao.html", height: 220 },
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
