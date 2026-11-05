/* Dados do Trello -> formato do motor. SO LEITURA: usa apenas t.card / t.board / t.list / t.lists / t.cards.
 * Nada aqui escreve no Trello (o teste tests/test_powerup.py barra metodos de escrita). */
window.PmoDados = (function () {
  let regrasP = null;
  function regras() {
    if (!regrasP) regrasP = fetch("./regras.json?v=202611051206").then((r) => r.json());
    return regrasP;
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
      idList: c.idList, labels: c.labels || [], idMembers: (c.members || []).map((m) => m.id),
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
    return { card: card(c), lista: lista.name, checklists: ck, alertas, regras: r, nivel: PmoMotor.semaforo(alertas, r),
      valores, pontos: PmoMotor.pontuar(alertas, valores, r), prioridade: prio.prioridade, risco: prio.risco,
      diasPrazo: prio.dias, semEvidencia };
  }

  async function quadro(t) {
    const [r, cards, listas, defs, eu, bm] = await Promise.all([regras(), t.cards("all"), t.lists("id", "name"), t.board("customFields"), t.member("id"), t.board("members")]);
    const nomesMembros = {}; for (const m of (bm && bm.members) || []) nomesMembros[m.id] = m.fullName || m.username || "Sem nome";
    const nomes = {}; for (const l of listas) nomes[l.id] = l.name;
    const cd = camposDef(defs.customFields), agora = new Date();
    const itens = cards.map((c) => {
      const ck = checklists(c.checklists, c.badges), cm = card(c);
      const item = { card: cm, listaNome: nomes[c.idList], checklists: ck, valores: PmoMotor.valoresCustomfield(cm, cd),
        alertas: PmoMotor.avaliarCard(cm, nomes[c.idList], cd, ck, agora, r) };
      item.prio = PmoMotor.avaliarProjeto(item, r, agora);
      item.semEvidencia = r.funcoes.evidencia && PmoMotor.semEvidencia(item, r, agora);   // funcao opcional (pmo.toml)
      return item;
    }).filter((i) => !i.card.closed);
    return { regras: r, resumo: PmoMotor.resumoQuadro(itens, r, agora), itens, meuId: eu && eu.id, membros: nomesMembros };
  }

  return { regras, cardEmFoco, quadro };   // regras() devolve o regras.json (usado tambem pela tendencia)
})();
