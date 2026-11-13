/* Dados do Trello -> formato do motor. SO LEITURA: usa apenas t.card / t.board / t.list / t.lists / t.cards.
 * Nada aqui escreve no Trello (o teste tests/test_powerup.py barra metodos de escrita). */
window.PmoDados = (function () {
  let regrasP = null;
  function regras() {
    if (!regrasP) {
      // Erro de rede/404/HTML no lugar do JSON NAO fica guardado: a proxima chamada tenta de novo (antes a promise
      // rejeitada ficava para sempre e o Power-Up inteiro sumia ate recarregar a pagina).
      regrasP = fetch("./regras.json?v=202611131037").then((r) => {
        if (!r.ok) throw new Error("regras.json respondeu " + r.status);
        return r.json();
      }).catch((e) => { regrasP = null; throw e; });
    }
    return regrasP;
  }

  /* Substitui t.render(fn) nas telas: se algo falhar (Pages fora, Trello com erro, regras.json invalido) o gestor ve
   * uma mensagem em linguagem de loja em vez de "Lendo o quadro..." para sempre. Nada de URL, token ou erro tecnico
   * na tela; o detalhe vai so para o console. */
  function render(t, fn) {
    return t.render(async () => {
      try {
        return await fn();
      } catch (e) {
        try { console.error("PMO tela:", e && e.message ? e.message : e); } catch (_) { /* console indisponivel */ }
        document.body.textContent = "";
        const caixa = document.createElement("div");
        caixa.style.cssText = "padding:14px;font:14px/1.45 system-ui,sans-serif;color:#172b4d";
        const tit = document.createElement("b");
        tit.textContent = "Não consegui carregar agora.";
        const txt = document.createElement("p");
        txt.textContent = "Feche esta janela e abra de novo. Se continuar, avise o PMO.";
        caixa.appendChild(tit);
        caixa.appendChild(txt);
        document.body.appendChild(caixa);
        try { t.sizeTo("body"); } catch (_) { /* sem sizeTo */ }
      }
    });
  }

  function camposDef(defs) {            // board.customFields -> {id: {name, type, options:{idOpcao: texto}}}
    const out = {};
    for (const d of defs || []) {
      const opts = {};
      for (const o of d.options || []) opts[o.id] = (o.value && (o.value.text || o.value)) || "";
      out[d.id] = { name: d.name, type: d.type, options: opts };
    }
    return out;
  }

  function checklists(lista, badges) {  // tolera 'state' (REST) e 'checked' (variacoes do cliente)
    const temItens = (lista || []).some((c) => (c.checkItems || []).length);
    if (!temItens) return PmoMotor.checklistsDeBadges(badges);   // o Trello so entrega contadores (ver motor.js)
    return (lista || []).map((c) => ({
      name: c.name,
      checkItems: (c.checkItems || []).map((i) => ({
        name: i.name, due: i.due || null, dueComplete: !!i.dueComplete,
        state: i.state ? i.state : i.checked ? "complete" : "incomplete",
      })),
    }));
  }

  function card(c) {                    // card do cliente -> card do motor
    return {
      id: c.id, name: c.name, url: c.url || c.shortUrl, desc: c.desc || "", due: c.due || null, closed: !!c.closed,
      idList: c.idList, labels: c.labels || [], idMembers: c.members ? c.members.map((m) => m.id) : (c.idMembers || []),
      dateLastActivity: c.dateLastActivity || null, customFieldItems: c.customFieldItems || [],
      badges: c.badges || null,           // o Trello entrega a contagem de anexos em badges.attachments (usada na evidencia)
    };
  }

  /* Avalia o card em foco. Retorna {card, lista, checklists, alertas, regras, nivel}. */
  async function cardEmFoco(t) {
    const [r, c, defs, lista] = await Promise.all([regras(), t.card("all"), t.board("customFields"), t.list("name")]);
    const cd = camposDef(defs.customFields);
    const ck = checklists(c.checklists, c.badges);
    const alertas = PmoMotor.ordenar(PmoMotor.avaliarCard(card(c), lista.name, cd, ck, new Date(), r), r);
    const valores = PmoMotor.valoresCustomfield(card(c), cd);
    const itemFoco = { card: card(c), listaNome: lista.name, alertas, valores, checklists: ck };
    const prio = PmoMotor.avaliarProjeto(itemFoco, r, new Date());
    // semEvidencia e uma funcao opcional (liga/desliga no pmo.toml, [powerup_funcoes])
    const semEvidencia = r.funcoes.evidencia && PmoMotor.semEvidencia(itemFoco, r, new Date());
    const agora = new Date();
    return { card: card(c), lista: lista.name, checklists: ck, alertas, regras: r, nivel: PmoMotor.semaforo(alertas, r),
      valores, pontos: PmoMotor.pontuar(alertas, valores, r), prioridade: prio.prioridade, risco: prio.risco,
      diasPrazo: prio.dias, semEvidencia,
      antecipacoes: PmoMotor.antecipar(card(c), lista.name, alertas, cd, agora, r),          // "antes que aconteca"
      prontidao: PmoMotor.prontidao(card(c), lista.name, cd, ck, agora, r, alertas) };                // "para mover para a proxima fase falta"
  }

  /* cards do Trello (cliente OU REST com members/idMembers) -> itens do motor. Usado pelo quadro aberto e pelo Portfolio. */
  function itensDoBoard(cards, nomesDasListas, customFields, r, agora) {
    const cd = camposDef(customFields);
    return cards.map((c) => {
      const ck = checklists(c.checklists, c.badges), cm = card(c);
      const item = { card: cm, listaNome: nomesDasListas[c.idList], checklists: ck, valores: PmoMotor.valoresCustomfield(cm, cd),
        alertas: PmoMotor.avaliarCard(cm, nomesDasListas[c.idList], cd, ck, agora, r) };
      item.prio = PmoMotor.avaliarProjeto(item, r, agora);
      item.semEvidencia = r.funcoes.evidencia && PmoMotor.semEvidencia(item, r, agora);   // funcao opcional (pmo.toml)
      return item;
    }).filter((i) => !i.card.closed);
  }

  async function quadro(t) {
    const [r, cards, listas, defs, eu, bm] = await Promise.all([regras(), t.cards("all"), t.lists("id", "name"), t.board("customFields"), t.member("id"), t.board("members")]);
    const nomesMembros = {}; for (const m of (bm && bm.members) || []) nomesMembros[m.id] = m.fullName || m.username || "Sem nome";
    const nomes = {}; for (const l of listas) nomes[l.id] = l.name;
    const agora = new Date();
    const itens = itensDoBoard(cards, nomes, defs.customFields, r, agora);
    return { regras: r, resumo: PmoMotor.resumoQuadro(itens, r, agora), itens, meuId: eu && eu.id, membros: nomesMembros };
  }

  /* Ordem da lista por prioridade (so devolve a ordem; quem reordena e o Trello, na tela de quem clicou). */
  async function ordenarLista(t, cardsDaLista) {
    const q = await quadro(t);
    return PmoMotor.ordenarPorPrioridade((cardsDaLista || []).map((c) => c.id), q.itens, q.regras);
  }

  return { regras, render, cardEmFoco, quadro, ordenarLista, itensDoBoard };   // regras() devolve o regras.json (usado tambem pela tendencia)
})();
