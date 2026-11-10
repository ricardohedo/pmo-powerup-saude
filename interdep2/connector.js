/* Power-Up "PMO BigBox - Interdependencia v2" (SO quadros de teste).
 * Mostra no verso do card o escopo e o andamento do projeto de outra area (ou o andamento de quem executa para este projeto).
 * Nao escreve no Trello e nao chama a API do Trello: tudo passa pelo backend, que checa quem e o usuario.
 * Sem selo de badge de proposito: um badge faria uma chamada ao backend por card a cada renderizacao do quadro. */
const ICONE = new URL("./icone.svg", location.href).href;
const CFG = window.INTERDEP2 || {};

const capacidades = {
  "card-back-section": (t) => ({
    title: "Interdependência entre áreas", icon: ICONE,
    content: { type: "iframe", url: t.signUrl("./secao.html"), height: 160 },
  }),
  "card-buttons": () => [{
    icon: ICONE, text: "Depende de outra área",
    callback: (t) => t.popup({ title: "Depende de outra área", url: "./vincular.html", height: 230 }),
  }],
};

// So liga a autorizacao quando a chave de API foi configurada (sem chave, getRestApi falha).
const opcoes = {};
if (CFG.APP_KEY) {
  opcoes.appKey = CFG.APP_KEY;
  opcoes.appName = CFG.APP_NAME || "PMO BigBox - Interdependência v2";
  capacidades["authorization-status"] = async (t) => {
    try { return { authorized: await t.getRestApi().isAuthorized() }; } catch (e) { return { authorized: false }; }
  };
  capacidades["show-authorization"] = (t) => t.popup({ title: "Autorizar o Power-Up", url: "./autorizar.html", height: 180 });
}

TrelloPowerUp.initialize(capacidades, opcoes);
