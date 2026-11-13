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

// "Bom dia": o Trello pode chamar o board-buttons varias vezes na mesma abertura; este marcador de modulo segura as chamadas
// simultaneas e o t.set ANTES do t.modal segura as das aberturas seguintes. Experimento so do palco (funcao bom_dia).
let bomDiaTentado = false;
async function bomDia(t, regras) {
  if (bomDiaTentado) return;
  bomDiaTentado = true;
  try {
    const guardado = await PmoBomDia.ler(t);
    const dec = PmoMotor.bomDiaAbrir(guardado, new Date(), regras);
    if (!dec.abrir) return;
    await PmoBomDia.guardar(t, { dia: dec.hoje });
    await t.modal({ title: "Bom dia: o que pede você hoje", url: "./bom_dia.html", height: 560 });
  } catch (e) { console.error("[PMO Power-Up] bom dia", e); }
}

TrelloPowerUp.initialize({
  "card-badges": async (t) => {
    try {
      const d = await PmoDados.cardEmFoco(t);
      const n = d.alertas.filter((a) => d.regras.nivel[a.tipo] !== "verde").length;
      const selos = [d.prioridade
        ? { text: d.prioridade + " " + d.regras.rotulo_prioridade[d.prioridade] + (n ? " · " + n : ""), color: COR_P[d.prioridade] }
        : { text: ROTULO[d.nivel] + (n ? " · " + n : ""), color: COR[d.nivel] }];
      const marco = (d.card.labels || []).some((l) => (d.regras.labels_marco || []).includes(((l && l.name) || "").trim().toLowerCase()));
      if (marco) selos.push({ text: "🚩 Marco", color: "blue" });
      if (d.risco) selos.push({ text: "⏳ " + d.regras.rotulo_risco[d.risco], color: d.risco === "alto" ? "red" : "yellow" });
      if (d.semEvidencia) selos.push({ text: "📎 " + d.regras.rotulo_evidencia, color: "orange" });
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
        // Clicar no selo abre a mesma tela do botao "Preciso de ajuda" (por que o card esta assim, com a regra e o limite).
        callback: (tt) => tt.popup({ title: "Por que " + ROTULO[d.nivel].toLowerCase() + "?", url: "./ajuda.html", height: 420 }),
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
    text: "Preciso de ajuda",
    callback: (t) => t.popup({ title: "Preciso de ajuda", url: "./ajuda.html", height: 420 }),
  }, {
    icon: ICONE,
    text: "Status semanal",
    callback: (t) => t.popup({ title: "Status semanal (rascunho)", url: "./status.html", height: 320 }),
  }],

  // Menu da lista: "Ordenar por prioridade (P1-P4)". Funcao opcional (pmo.toml); reordena os cards na lista de quem clica.
  "list-sorters": async (t) => {
    let f;
    try { f = (await PmoDados.regras()).funcoes; } catch (e) { return []; }   // regras.json fora do ar: sem botao, mas sem derrubar o Power-Up
    if (!f.ordenar_prioridade) return [];
    return [{
      text: "Prioridade PMO (P1 a P4)",
      callback: async (tt, opts) => ({ sortedIds: await PmoDados.ordenarLista(tt, opts.cards) }),
    }];
  },

  "board-buttons": async (t) => {
    PmoTendencia.automatico(t);          // guarda o retrato do dia (so se a Tendencia estiver ligada), sem travar nada
    let f;
    try { f = (await PmoDados.regras()).funcoes; } catch (e) { return []; }   // regras.json fora do ar: sem botoes, mas sem derrubar o Power-Up; funcoes opcionais ligadas/desligadas no pmo.toml
    if (f.bom_dia) bomDia(t, await PmoDados.regras());        // sem await: nao atrasa os botoes
    const nomeQuadro = f.portfolio ? ((await t.board("name")) || {}).name : "";
    const regrasBt = f.portfolio ? await PmoDados.regras() : null;
    const botao = (text, title, url, height) => ({ icon: ICONE, text, callback: (tt) => tt.modal({ title, url, height }) });
    return [
      ...(f.meu_dia ? [botao("Meu dia", "Meu dia: o que pede você hoje", "./meu_dia.html", 600)] : []),
      ...(f.roadmap ? [botao("Roadmap", "Roadmap do quadro: início e fim de cada projeto ativo", "./roadmap.html", 680)] : []),
      ...(f.riscos ? [botao("Riscos", "Riscos e premissas: matriz, o que falta e projetos sem registro", "./riscos.html", 640)] : []),
      ...(f.engajamento ? [botao("Conquistas", "Conquistas da área: entregas, reta final e destaque", "./conquistas.html", 560)] : []),
      ...(f.paineis ? [botao("Painéis PMO", "Painéis PMO: seus blocos sobre os projetos do quadro", "./paineis.html", 680)] : []),
      ...(f.portfolio && PmoMotor.portfolioPermitido(nomeQuadro, regrasBt) ? [botao("Portfólio PMO", "Portfólio do PMO: as áreas", "./portfolio.html", 640)] : []),   // perto do começo: a barra do Trello pode cortar o fim
      ...(f.pauta ? [botao("Pauta da reunião", "Pauta da reunião: do que o quadro pede", "./pauta.html", 640)] : []),
      ...(f.radar ? [botao("Radar", "Radar: o que vai cair em alerta se ninguém mexer", "./radar.html", 600)] : []),
      botao("Minhas ações", "Minhas ações: onde atuar primeiro", "./atuar.html", 600),
      botao("Atrasadas e a vencer", "Atrasadas, a vencer, marcos e datas do varejo", "./prazos.html", 560),
      botao("Impacto × esforço", "Matriz impacto × esforço", "./matriz.html", 600),
      botao("Linha do tempo", "Linha do tempo de entregas", "./linha.html", 600),
      ...(f.carga_equipe ? [botao("Carga da equipe", "Carga da equipe", "./equipe.html", 520)] : []),
      ...(f.tendencia ? [botao("Tendência", "Tendência do quadro", "./tendencia.html", 560)] : []),
      ...(f.paineis ? [] : [botao("Painel PMO", "Painel de saúde do quadro", "./painel.html", 560)]),   // o novo "Painéis PMO" o substitui: menos botões na barra
      botao("Como sou medido", "Como o PMO mede os projetos", "./como.html", 600),
    ];
  },
}, window.PMO_APP);
