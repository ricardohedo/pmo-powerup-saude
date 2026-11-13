/* "Pergunte ao PMO": o gestor escolhe uma pergunta pronta ou digita palavras e recebe a resposta montada POR REGRA com os dados do quadro.
 * SEM IA, SO LEITURA: um catalogo fixo de perguntas e as mesmas funcoes do motor (meuDia, pedidosParaMim, datasVarejo, regraDoAlerta...).
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
    { id: "prazos", pergunta: "O que vence esta semana ou está atrasado?", palavras: ["vence", "vencimento", "vencer", "atrasado", "atraso", "atrasados", "semana", "prazo"] },
    { id: "espera", pergunta: "Quem espera a minha área?", palavras: ["espera", "esperando", "aguardando", "pedido", "pedidos", "outra area", "interdependencia", "depende"] },
    { id: "proximo", pergunta: "Qual é o meu próximo prazo?", palavras: ["proximo", "proxima", "quando", "entrega", "fim planejado", "prazo"] },
    { id: "parado", pergunta: "Por que meu projeto aparece como parado?", palavras: ["parado", "parados", "interacao", "sem interacao", "comentario", "movimentacao", "esquecido"] },
    { id: "medido", pergunta: "Como sou medido?", palavras: ["medido", "medicao", "regras", "regra", "criterio", "como funciona", "pontuacao", "prioridade", "p1"] },
    { id: "varejo", pergunta: "Quais datas do varejo pedem atenção?", palavras: ["varejo", "data", "datas", "pascoa", "natal", "black", "campanha", "sazonal"] },
    { id: "padrao", pergunta: "O que o PMO espera de um projeto?", palavras: ["espera", "padrao", "conformidade", "conforme", "leia-me", "leiame", "projeto", "checklist", "responsavel"] },
  ];

  function buscar(texto) {
    const t = " " + sem(texto).replace(/[^a-z0-9\- ]/g, " ").replace(/ +/g, " ").trim() + " ";
    if (t.trim().length < 3) return [];
    return CATALOGO.map((c) => ({ c, n: c.palavras.filter((p) => t.includes(p.length <= 3 ? " " + p + " " : p)).length }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n || CATALOGO.indexOf(a.c) - CATALOGO.indexOf(b.c)).slice(0, 3).map((x) => x.c);
  }

  const meus = (itens, regras, meuId) => itens.filter((it) => meuId && (it.card.idMembers || []).includes(meuId) && M.projetoAtivo(it, regras));
  const link = (x, detalhe) => ({ texto: x.nome, url: x.url, detalhe: detalhe || "" });
  const SEM_CARD = "Você não está em nenhum card deste quadro. As respostas sobre “meus projetos” olham só os cards em que você é membro.";

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
    return { titulo: "Não sei responder isso", resumo: "Ainda não tenho essa resposta pronta. Fale com " + (regras.pergunte_contato || "o PMO") + ".", itens: [], mais: 0, nota: "" };
  }

  return { CATALOGO, buscar, responder, naoSei };
});
