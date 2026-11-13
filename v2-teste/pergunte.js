/* "Pergunte ao PMO": o gestor escolhe uma pergunta pronta ou digita palavras e recebe a resposta montada POR REGRA com os dados do quadro.
 * SEM IA, SO LEITURA: um catalogo fixo de perguntas e as mesmas funcoes do motor (meuDia, pedidosParaMim, datasVarejo, explicar...).
 * Entende: palavras com erro de digitacao, plural/singular e sinonimos; e o NOME de um projeto do quadro ("por que o P.I.V esta vermelho?").
 * O que nao estiver no catalogo recebe "nao sei, fale com o PMO" (regras.pergunte_contato). Funciona no navegador (window.PmoPergunte) e no node. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./motor.js"));
  else raiz.PmoPergunte = fabrica(raiz.PmoMotor);
})(typeof self !== "undefined" ? self : this, function (M) {
  const sem = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);
  const dm = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

  // id, pergunta mostrada, palavras que a ativam (sem acento, minusculas)
  const CATALOGO = [
    { id: "hoje", pergunta: "O que preciso fazer hoje?", palavras: ["hoje", "fazer", "preciso", "comecar", "comeco", "tarefa", "dia", "agora"] },
    { id: "semaforo", pergunta: "Por que meu projeto está vermelho ou amarelo?", palavras: ["vermelho", "amarelo", "verde", "semaforo", "selo", "saude", "atencao", "de olho", "cor"] },
    { id: "cadastro", pergunta: "O que falta no cadastro dos meus projetos?", palavras: ["cadastro", "falta", "campos", "preencher", "obrigatorio", "objetivo", "escopo", "descricao"] },
    { id: "prazos", pergunta: "O que vence esta semana ou está atrasado?", palavras: ["vence", "vencimento", "vencer", "atrasado", "atraso", "semana", "prazo"] },
    { id: "espera", pergunta: "Quem espera a minha área?", palavras: ["espera", "esperando", "aguardando", "pedido", "outra area", "interdependencia", "depende"] },
    { id: "proximo", pergunta: "Qual é o meu próximo prazo?", palavras: ["proximo", "proxima", "quando", "entrega", "fim planejado", "prazo"] },
    { id: "parado", pergunta: "Por que meu projeto aparece como parado?", palavras: ["parado", "interacao", "sem interacao", "comentario", "movimentacao", "esquecido"] },
    { id: "medido", pergunta: "Como sou medido?", palavras: ["medido", "medicao", "regras", "regra", "criterio", "como funciona", "pontuacao", "prioridade", "p1"] },
    { id: "varejo", pergunta: "Quais datas do varejo pedem atenção?", palavras: ["varejo", "data", "pascoa", "natal", "black", "campanha", "sazonal"] },
    { id: "padrao", pergunta: "O que o PMO espera de um projeto?", palavras: ["padrao", "conformidade", "conforme", "leia-me", "leiame", "checklist", "responsavel", "pmo espera", "de um projeto"] },
  ];

  // palavra que o gestor costuma usar -> palavra do catalogo (sem acento). So sinonimos de uso do varejo/PMO; nada de adivinhacao.
  const SINONIMOS = {
    estourou: "atrasado", estourado: "atrasado", vencido: "atrasado", vencida: "atrasado", demorado: "atrasado", atrasada: "atrasado",
    travado: "parado", travou: "parado", abandonado: "parado", esquecida: "parado", parada: "parado",
    pendencia: "falta", pendente: "falta", faltando: "falta", incompleto: "cadastro", incompleta: "cadastro",
    nota: "medido", avaliado: "medido", avaliacao: "medido", status: "semaforo", sinal: "semaforo", alerta: "semaforo",
    amanha: "proximo", cobranca: "espera", cobrando: "espera", solicitacao: "pedido", solicitado: "pedido",
  };

  const radical = (p) => { let w = sem(p).replace(/[^a-z0-9]/g, ""); if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1); return w; };
  const palavras = (texto) => sem(texto).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

  function distancia(a, b) {                       // distancia de edicao (erro de digitacao)
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const igual = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && distancia(a, b) <= (a.length >= 8 ? 2 : 1));

  function buscar(texto) {
    const base = palavras(texto);
    if (base.join("").length < 3) return [];
    const tn = " " + base.join(" ") + " ", orig = base.map(radical), sinon = base.filter((w) => SINONIMOS[w]).map((w) => radical(SINONIMOS[w]));
    // peso: palavra igual (ou sinonimo) = 2; so parecida por erro de digitacao = 1 (o sinonimo nunca vira "parecida": pedido x medido)
    const peso = (p) => {
      if (/[ -]/.test(p)) return tn.includes(" " + palavras(p).join(" ") + " ") ? 2 : 0;
      const r = radical(p);
      if (orig.includes(r) || sinon.includes(r)) return 2;
      return p.length > 3 && orig.some((t) => igual(r, t)) ? 1 : 0;
    };
    const lista = CATALOGO.map((c) => ({ c, n: c.palavras.reduce((s, p) => s + peso(p), 0) })).filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || CATALOGO.indexOf(a.c) - CATALOGO.indexOf(b.c));
    return lista.filter((x) => x.n > lista[0].n / 2).slice(0, 3).map((x) => x.c);       // some quem so tem um resto fraco de acerto
  }

  // Projetos do quadro citados na pergunta. Devolve [{it, inteiro}]: inteiro = o nome todo aparece na pergunta (mais seguro).
  function acharProjetos(itens, texto) {
    const base = palavras(texto), tn = " " + base.join(" ") + " ", toks = base.map(radical), achados = [];
    for (const it of itens) {
      const nome = palavras(it.card.name).join(" ");
      if (!nome) continue;
      if (nome.length >= 3 && tn.includes(" " + nome + " ")) { achados.push({ it, inteiro: true, score: 1 + nome.length / 100 }); continue; }
      const ntoks = nome.split(" ").filter((w) => w.length >= 3).map(radical);
      const achou = ntoks.filter((w) => toks.some((q) => igual(w, q)));
      if (achou.length && achou.some((w) => w.length >= 5)) achados.push({ it, inteiro: false, score: achou.length / ntoks.length });
    }
    achados.sort((a, b) => b.score - a.score || a.it.card.name.localeCompare(b.it.card.name));
    return achados.length ? achados.filter((x) => x.score >= achados[0].score - 0.0001).slice(0, 3) : [];
  }

  // O que fazer com o texto digitado: {tipo:"projeto", itens} | {tipo:"catalogo", perguntas} | {tipo:"talvez_projeto", itens} | {tipo:"nada"}
  function entender(texto, itens) {
    const ps = acharProjetos(itens || [], texto);
    if (ps.length && ps[0].inteiro) return { tipo: "projeto", itens: ps.filter((x) => x.inteiro).map((x) => x.it) };
    const cs = buscar(texto);
    if (cs.length) return { tipo: "catalogo", perguntas: cs };
    if (ps.length) return { tipo: "talvez_projeto", itens: ps.map((x) => x.it) };
    return { tipo: "nada" };
  }

  const meus = (itens, regras, meuId) => itens.filter((it) => meuId && (it.card.idMembers || []).includes(meuId) && M.projetoAtivo(it, regras));
  const link = (x, detalhe) => ({ texto: x.nome, url: x.url, detalhe: detalhe || "" });
  const SEM_CARD = "Você não está em nenhum card deste quadro. As respostas sobre “meus projetos” olham só os cards em que você é membro.";

  function responderProjeto(it, regras, agora) {
    const pct = M.progressoChecklists(it.checklists || [], regras), alertas = it.alertas || [];
    const fim = it.valores && it.valores["Fim planejado"], diasPrazo = fim ? Math.floor((Date.parse(fim) - agora.getTime()) / 86400000) : null;
    const ex = M.explicar(alertas, pct, diasPrazo, regras), cor = M.semaforo(alertas, regras);
    const lista = ex.sinais.slice(0, 6).map((s) => ({ texto: s.frase, url: "", detalhe: s.regra + (s.fazer ? " O que fazer: " + s.fazer : "") }));
    if (ex.risco) lista.push({ texto: "Risco antecipado (" + ex.risco.nivel + ")", url: "", detalhe: ex.risco.texto });
    return { titulo: it.card.name, resumo: "Está " + (cor === "verde" ? "em dia (verde)" : cor) + " na lista " + (it.listaNome || "") +
      (pct !== null ? ", com o checklist em " + pct + "%" : ", sem checklist") + ". " + ex.porquePrioridade +
      (lista.length ? "" : " Nenhum sinal pedindo ação neste card agora."), itens: lista, mais: Math.max(0, ex.sinais.length - 6), nota: "", url: it.card.url };
  }

  function responder(id, itens, regras, meuId, agora) {
    const max = regras.bom_dia_max_itens || 5, cap = (l) => l.slice(0, max);
    const md = M.meuDia(itens, regras, meuId, agora), minhas = meus(itens, regras, meuId);
    const base = (titulo, resumo, lista, nota) => ({ titulo, resumo, itens: lista || [], mais: 0, nota: nota || "" });
    const comMais = (r, total) => { r.mais = Math.max(0, total - r.itens.length); return r; };
    if (!CATALOGO.some((c) => c.id === id)) return naoSei(regras);
    switch (id) {
      case "hoje": {
        if (!md.souMembro) return base("O que fazer hoje", SEM_CARD);
        if (!md.total) return base("O que fazer hoje", "Nada pedindo você hoje. Nenhum dos seus projetos vence hoje, está atrasado, parado ou com item de checklist vencido.");
        return comMais(base("O que fazer hoje", "Comece por " + md.foco.nome + " (" + md.foco.texto + "). " + plural(md.total, "projeto seu pede", "projetos seus pedem") + " atenção.",
          cap([...md.hoje, ...md.atrasadas, ...md.semana, ...md.checklist, ...md.parados]).map((x) => link(x, x.texto))), md.hoje.length + md.atrasadas.length + md.semana.length + md.checklist.length + md.parados.length);
      }
      case "semaforo": {
        if (!minhas.length) return base("Cor dos meus projetos", SEM_CARD);
        const naoVerdes = minhas.map((it) => ({ it, cor: M.semaforo(it.alertas || [], regras) })).filter((x) => x.cor !== "verde");
        if (!naoVerdes.length) return base("Cor dos meus projetos", "Todos os seus " + plural(minhas.length, "projeto está", "projetos estão") + " em dia (verde).");
        return comMais(base("Cor dos meus projetos", plural(naoVerdes.length, "projeto seu não está", "projetos seus não estão") + " verde, e por quê:",
          cap(naoVerdes.sort((a, b) => (a.cor === "vermelho" ? 0 : 1) - (b.cor === "vermelho" ? 0 : 1)).map((x) => link({ nome: x.it.card.name, url: x.it.card.url },
            x.cor + ": " + M.ordenar(x.it.alertas || [], regras).filter((a) => regras.nivel[a.tipo]).map((a) => M.frase(a)).join("; ")))),
        ), naoVerdes.length);
      }
      case "cadastro": {
        if (!minhas.length) return base("Cadastro", SEM_CARD);
        const falta = minhas.map((it) => ({ it, a: (it.alertas || []).find((x) => x.tipo === "cadastro_incompleto") })).filter((x) => x.a);
        if (!falta.length) return base("Cadastro", "O cadastro dos seus projetos está completo.");
        return comMais(base("Cadastro", plural(falta.length, "projeto seu tem", "projetos seus têm") + " cadastro incompleto:",
          cap(falta).map((x) => link({ nome: x.it.card.name, url: x.it.card.url }, M.frase(x.a))), M.regraDoAlerta("cadastro_incompleto", regras)), falta.length);
      }
      case "prazos": {
        if (!md.souMembro) return base("Prazos", SEM_CARD);
        const todos = [...md.hoje, ...md.atrasadas, ...md.semana];
        if (!todos.length) return base("Prazos", "Nenhum projeto seu vence hoje, está atrasado ou vence nos próximos dias úteis.");
        return comMais(base("Prazos", plural(md.hoje.length, "vence hoje", "vencem hoje") + " · " + plural(md.atrasadas.length, "atrasado", "atrasados") + " · " +
          plural(md.semana.length, "vence nos próximos dias úteis", "vencem nos próximos dias úteis") + ".", cap(todos).map((x) => link(x, x.texto)), M.regraDoAlerta("atrasado", regras)), todos.length);
      }
      case "espera": {
        const p = M.pedidosParaMim(itens, regras, meuId, agora);
        if (!p.total) return base("Quem espera a minha área", "Nenhum pedido de outra área está esperando a sua área neste quadro.");
        return comMais(base("Quem espera a minha área", plural(p.total, "pedido de outra área espera", "pedidos de outras áreas esperam") + " a sua área; o mais antigo há " + plural(p.maisAntigo || 0, "dia", "dias") + ".",
          p.itens.map((x) => link(x, "pedido de " + x.origem + (x.dias != null ? " há " + plural(x.dias, "dia", "dias") : "") + (x.semMembro ? " · sem responsável" : "")))), p.total);
      }
      case "proximo": {
        if (!md.souMembro) return base("Próximo prazo", SEM_CARD);
        if (!md.proximo) return base("Próximo prazo", "Nenhum projeto seu tem 'Fim planejado' a partir de hoje.");
        return base("Próximo prazo", "O seu próximo prazo é " + md.proximo.nome + " em " + plural(md.proximo.diasUteis, "dia útil", "dias úteis") + " (" + dm(md.proximo.fim) + ").", [link(md.proximo)]);
      }
      case "parado": {
        if (!md.souMembro) return base("Projetos parados", SEM_CARD);
        if (!md.parados.length) return base("Projetos parados", "Nenhum projeto seu está parado sem interação.", [], M.regraDoAlerta("sem_interacao", regras));
        return comMais(base("Projetos parados", plural(md.parados.length, "projeto seu está parado", "projetos seus estão parados") + " sem interação:", cap(md.parados).map((x) => link(x, x.texto)),
          M.regraDoAlerta("sem_interacao", regras)), md.parados.length);
      }
      case "medido":
        return base("Como sou medido", "As mesmas regras valem aqui e nos avisos do Chat, e nenhuma é decidida por inteligência artificial:",
          ["atrasado", "prazo_proximo", "sem_interacao", "sem_prazo", "sem_responsavel", "cadastro_incompleto"].map((t) => ({ texto: (regras.grupos && regras.grupos[t]) || t, url: "", detalhe: M.regraDoAlerta(t, regras) })),
          "Veja tudo no botão “Como sou medido” (ou nas perguntas abaixo).");
      case "varejo": {
        const dv = M.datasVarejo(itens, regras, agora);
        if (!dv.length) return base("Datas do varejo", "Nenhuma data do varejo está no período de aviso agora.");
        return base("Datas do varejo", plural(dv.length, "data pede atenção", "datas pedem atenção") + ":", cap(dv).map((d) => ({ texto: d.nome + " · " + dm(d.data), url: "",
          detalhe: plural(d.diasUteis, "dia útil", "dias úteis") + (d.emRisco ? " · " + plural(d.emRisco, "projeto em risco", "projetos em risco") : (d.projetos.length ? " · projetos marcados em dia" : " · nenhum projeto marcado")) })));
      }
      case "padrao":
        return base("O que o PMO espera de um projeto", "Para estar em conformidade, o projeto tem:", [
          { texto: "Responsável", url: "", detalhe: "pelo menos um membro atribuído ao card" },
          { texto: "Campos de cadastro", url: "", detalhe: (regras.campos_obrigatorios || []).join(", ") },
          { texto: "Descrição", url: "", detalhe: "seções Objetivo e Escopo preenchidas" },
          { texto: "Checklist de execução", url: "", detalhe: "um checklist cujo nome começa com “" + (regras.plano_prefixo_execucao || "Execução") + "”" },
          { texto: "Checklist de início", url: "", detalhe: "“" + (regras.checklist_inicio || "Início do Projeto") + "”, marcado ao começar de fato" },
          { texto: "Interação ativa", url: "", detalhe: "no máximo " + plural(regras.dias_sem_interacao, "dia", "dias") + " sem atividade" },
        ], "Quadro de projetos é só para projeto: rotinas e tarefas soltas devem ficar em outro quadro.");
    }
    return naoSei(regras);
  }

  function naoSei(regras) {
    return { titulo: "Não sei responder isso", resumo: "Ainda não tenho essa resposta pronta. Fale com " + (regras.pergunte_contato || "o PMO") + ". Anotei a sua pergunta para o PMO ensinar o bot.", itens: [], mais: 0, nota: "" };
  }

  return { CATALOGO, buscar, acharProjetos, entender, responder, responderProjeto, naoSei };
});
