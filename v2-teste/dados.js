/* Dados do Trello -> formato do motor. SO LEITURA: usa apenas t.card / t.board / t.list / t.lists / t.cards.
 * Nada aqui escreve no Trello (o teste tests/test_powerup.py barra metodos de escrita). */
window.PmoDados = (function () {
  let regrasP = null;
  function regras() {
    if (!regrasP) regrasP = fetch("./regras.json").then((r) => r.json());
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
    };
  }

  /* Avalia o card em foco. Retorna {card, lista, checklists, alertas, regras, nivel}. */
  async function cardEmFoco(t) {
    const [r, c, defs, lista] = await Promise.all([regras(), t.card("all"), t.board("customFields"), t.list("name")]);
    const cd = camposDef(defs.customFields);
    const ck = checklists(c.checklists, c.badges);
    const alertas = PmoMotor.ordenar(PmoMotor.avaliarCard(card(c), lista.name, cd, ck, new Date(), r), r);
    const valores = PmoMotor.valoresCustomfield(card(c), cd);
    const prio = PmoMotor.avaliarProjeto({ card: card(c), listaNome: lista.name, alertas, valores, checklists: ck }, r, new Date());
    return { card: card(c), lista: lista.name, checklists: ck, alertas, regras: r, nivel: PmoMotor.semaforo(alertas, r),
      valores, pontos: PmoMotor.pontuar(alertas, valores, r), prioridade: prio.prioridade, risco: prio.risco, diasPrazo: prio.dias };
  }

  async function quadro(t) {
    const [r, cards, listas, defs, eu] = await Promise.all([regras(), t.cards("all"), t.lists("id", "name"), t.board("customFields"), t.member("id")]);
    const nomes = {}; for (const l of listas) nomes[l.id] = l.name;
    const cd = camposDef(defs.customFields), agora = new Date();
    const itens = cards.map((c) => {
      const ck = checklists(c.checklists, c.badges), cm = card(c);
      const item = { card: cm, listaNome: nomes[c.idList], checklists: ck, valores: PmoMotor.valoresCustomfield(cm, cd),
        alertas: PmoMotor.avaliarCard(cm, nomes[c.idList], cd, ck, agora, r) };
      item.prio = PmoMotor.avaliarProjeto(item, r, agora);
      return item;
    }).filter((i) => !i.card.closed);
    return { regras: r, resumo: PmoMotor.resumoQuadro(itens, r, agora), itens, meuId: eu && eu.id };
  }

  return { regras, cardEmFoco, quadro };
})();
