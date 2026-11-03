/* Motor do Power-Up: porta SEM ESTADO dos gatilhos de src/pmo/motor.py (so leitura).
 * Nenhuma regra mora aqui: limites, listas e textos vem de regras.json (gerado do pmo.toml).
 * Funciona no navegador (window.PmoMotor) e no node (module.exports) para o teste de paridade. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.PmoMotor = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  const DIA_MS = 86400000;

  function iso(t) { return new Date(t); }
  function diasDesde(isoTxt, agora) { return Math.floor((agora - iso(isoTxt)) / DIA_MS); }

  // round() do Python arredonda .5 para o par; Math.round nao. Paridade exige o mesmo.
  function arredondaPar(x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
  }

  function checkItens(cl) { return (cl && cl.checkItems) || []; }

  /* O Trello NAO entrega os itens dos checklists ao Power-Up (checkItems vem vazio), so os contadores em
   * card.badges: checkItems, checkItemsChecked e checkItemsEarliestDue (prazo mais antigo entre os pendentes).
   * Reconstroi um checklist "aproximado": sem nomes e com no maximo 1 prazo (o mais antigo). */
  function checklistsDeBadges(b) {
    if (!b || !b.checkItems) return [];
    const itens = [];
    for (let i = 0; i < b.checkItemsChecked; i++) itens.push({ state: "complete", name: null });
    for (let j = 0; j < b.checkItems - b.checkItemsChecked; j++) {
      itens.push({ state: "incomplete", name: null, due: j === 0 ? (b.checkItemsEarliestDue || null) : null });
    }
    return [{ name: null, aprox: true, checkItems: itens }];
  }

  function progressoChecklists(checklists) {
    let total = 0, feitos = 0;
    for (const c of checklists) for (const i of checkItens(c)) { total++; if (i.state === "complete") feitos++; }
    return total === 0 ? null : arredondaPar(feitos / total * 100);
  }

  function itensVencidos(checklists, agora) {
    let n = 0;
    for (const c of checklists) for (const i of checkItens(c)) {
      if (!i.due || i.state === "complete" || i.dueComplete) continue;
      if (iso(i.due) < agora) n++;
    }
    return n;
  }

  function checklistPendente(checklists) {
    return checklists.some((c) => checkItens(c).some((i) => i.state !== "complete"));
  }

  function valoresCustomfield(card, camposDef) {
    const v = {};
    for (const it of card.customFieldItems || []) {
      const cd = camposDef[it.idCustomField];
      if (!cd) continue;
      const val = it.value || {};
      if (cd.type === "date") v[cd.name] = val.date || null;
      else if (cd.type === "list") v[cd.name] = (cd.options || {})[it.idValue] || null;
      else v[cd.name] = val.text || null;
    }
    return v;
  }

  function ehLinhaTitulo(linha, regras) {
    const lead = /^[#>\-*_•\d.)\s]+/, trail = /[*_:\s]+$/;
    const s = linha.replace(lead, "").replace(trail, "");
    for (const kw of regras.motor.titulos_conhecidos) {
      if (s.toUpperCase().startsWith(kw) && s.split(/\s+/).filter(Boolean).length <= regras.motor.palavras_max_titulo) return kw;
    }
    return null;
  }

  function secoesDescricao(desc, regras) {
    const out = {}; let titulo = null, corpo = [];
    const limpa = (t) => t.replace(/^[ \n-]+|[ \n-]+$/g, "");
    for (const linha of (desc || "").split("\n")) {
      const kw = ehLinhaTitulo(linha.trim(), regras);
      if (kw) { if (titulo) out[titulo] = limpa(corpo.join("\n")); titulo = kw; corpo = []; }
      else if (titulo) corpo.push(linha);
    }
    if (titulo) out[titulo] = limpa(corpo.join("\n"));
    return out;
  }

  function secaoPreenchida(desc, cabecalho, regras) {
    const s = secoesDescricao(desc, regras);
    for (const t of Object.keys(s)) {
      if (t.includes(cabecalho)) return [...s[t]].length >= regras.motor.corpo_min_secao && !s[t].startsWith("[");
    }
    return false;
  }

  function camposFaltando(card, camposDef, lista, regras) {
    const v = valoresCustomfield(card, camposDef);
    const exec = new Set(regras.campos_execucao);
    const falta = regras.campos_obrigatorios.filter((c) => !exec.has(c) && !v[c]);
    if (regras.fases_execucao.includes(lista)) {
      for (const c of regras.campos_obrigatorios) if (exec.has(c) && !v[c]) falta.push(c);
    }
    if (!secaoPreenchida(card.desc, "OBJETIVO", regras)) falta.push("Objetivo (descrição)");
    if (!secaoPreenchida(card.desc, "ESCOPO", regras)) falta.push("Escopo (descrição)");
    return falta;
  }

  // Data de calendario em Brasilia (AAAA-MM-DD como numero de dias), igual ao motor (nao conta horas).
  function diaBrt(d, regras) { return Math.floor((d.getTime() + regras.fuso_horas * 3600000) / DIA_MS); }

  /* Avalia UM card. card: {id, idList, closed, desc, due, labels, idMembers, dateLastActivity, customFieldItems}
   * listaNome: nome da lista do card; camposDef: {id: {name, type, options:{idOpcao: texto}}};
   * checklists: [{checkItems:[{state, due, dueComplete}]}]; agora: Date.
   * Retorna [{tipo, valor}] (mesmos gatilhos do motor, sem "alerta uma vez" e sem os de comentario). */
  function avaliarCard(card, listaNome, camposDef, checklists, agora, regras) {
    if (card.closed) return [];
    const lista = (listaNome || "").trim().toLowerCase();
    if (regras.listas_ignorar.some((t) => lista.includes(t))) return [];
    const concluido = regras.listas_concluido.includes(lista);
    const backlog = lista === regras.motor.lista_backlog;
    const out = [];
    const add = (tipo, valor) => out.push({ tipo, valor: valor === undefined ? null : valor });

    // G-01 sem_interacao
    const fasesOk = !regras.sem_interacao_fases.length || regras.sem_interacao_fases.includes(lista);
    const ult = card.dateLastActivity;
    if (!concluido && !backlog && fasesOk && ult && diasDesde(ult, agora) >= regras.dias_sem_interacao) add("sem_interacao", diasDesde(ult, agora));

    // G-02 sem_prazo
    const v = valoresCustomfield(card, camposDef);
    const ini = v["Início planejado"], fim = v["Fim planejado"];
    if (lista === regras.motor.lista_execucao && !(ini && fim)) add("sem_prazo");

    // G-03 quase_pronto
    const pct = concluido ? null : progressoChecklists(checklists);
    if (pct !== null && pct >= regras.progresso_min_quase_pronto) add("quase_pronto", pct);

    // G-04 atraso_oculto
    const dueVencido = !!card.due && iso(card.due) < agora;
    const venc = (concluido || backlog || dueVencido) ? 0 : itensVencidos(checklists, agora);
    // Checklist aproximado (so contadores): sabe-se que ha item vencido, nao quantos.
    if (venc > 0) add("atraso_oculto", checklists.some((c) => c.aprox) ? null : venc);

    // G-06 sem_responsavel
    if (regras.fases_sem_responsavel.includes(lista) && !(card.idMembers || []).length) add("sem_responsavel");

    // G-07 prazo_proximo
    if (fim && !concluido) {
      const d = Math.floor((iso(fim) - agora) / DIA_MS);
      if (d >= 0 && d <= regras.dias_prazo_proximo) add("prazo_proximo", d);
    }

    // G-08 checklist_pendente_concluido
    if (concluido && checklistPendente(checklists)) add("checklist_pendente_concluido");

    // G-09 atrasado
    if (fim && !concluido && !backlog && iso(fim) < agora) add("atrasado", diaBrt(agora, regras) - diaBrt(iso(fim), regras));

    // G-10 cadastro_incompleto
    if (!backlog) {
      const f = camposFaltando(card, camposDef, lista, regras);
      if (f.length) add("cadastro_incompleto", f.join(", "));
    }
    return out;
  }

  /* Semaforo do card: o pior nivel entre os alertas (nivel vem de regras.nivel). */
  function semaforo(alertas, regras) {
    let n = "verde";
    for (const a of alertas) {
      const nv = regras.nivel[a.tipo];
      if (nv === "vermelho") return "vermelho";
      if (nv === "amarelo") n = "amarelo";
    }
    return n;
  }

  function frase(a) {
    const v = a.valor;
    switch (a.tipo) {
      case "quase_pronto": return v + "% do checklist";
      case "atraso_oculto": return v === null ? "itens de checklist vencidos" : v === 1 ? "1 item vencido" : v + " itens vencidos";
      case "sem_prazo": return "sem prazo cadastrado";
      case "sem_interacao": return v + "+ dias sem interação";
      case "sem_responsavel": return "sem responsável atribuído";
      case "prazo_proximo": return "vence em " + v + "d";
      case "checklist_pendente_concluido": return "checklist ainda pendente";
      case "atrasado": return v === 0 ? "venceu hoje" : v + "d de atraso";
      case "cadastro_incompleto": return "falta: " + v;
      default: return a.tipo;
    }
  }

  function ordenar(alertas, regras) {
    return [...alertas].sort((a, b) => regras.ordem.indexOf(a.tipo) - regras.ordem.indexOf(b.tipo));
  }

  /* Pontuacao de prioridade: a MESMA de mensagens.pontuacao (pmo_v2). valores = campos do card (Prioridade, Urgente). */
  function pontuar(alertas, valores, regras) {
    const risco = new Set(regras.risco);
    let pts = 0;
    for (const a of alertas) {
      if (!risco.has(a.tipo)) continue;
      pts += regras.pesos[a.tipo] + (a.tipo === "atrasado" && Number.isInteger(a.valor) ? Math.min(a.valor, regras.teto_pontos_atraso) : 0);
    }
    let base = pts;
    if (!pts) {
      let m = 0;
      for (const a of alertas) if (a.tipo === "sem_interacao" && Number.isInteger(a.valor)) m = Math.max(m, a.valor);
      base = m / regras.divisor_sem_interacao;
    }
    const v = valores || {};
    return base + (regras.bonus_prioridade[v[regras.motor.campo_prioridade]] || 0) +
      (v[regras.motor.campo_urgente] === "Sim" ? regras.bonus_urgente : 0);
  }

  /* "Onde atuar": cards que pedem acao, do mais ao menos urgente, cada um com o motivo e o que fazer.
   * itens = [{card, listaNome, alertas, valores}]; meuId (opcional) = so os cards em que a pessoa e membro. */
  function ondeAtuar(itens, regras, meuId) {
    const meus = itens.filter((i) => !meuId || (i.card.idMembers || []).includes(meuId));
    const pedem = [], vitorias = [];
    for (const i of meus) {
      const acao = i.alertas.filter((a) => regras.nivel[a.tipo] !== "verde");
      if (i.alertas.some((a) => a.tipo === "quase_pronto")) vitorias.push({ nome: i.card.name, url: i.card.url, lista: i.listaNome });
      if (!acao.length) continue;
      const ord = ordenar(acao, regras);
      pedem.push({ nome: i.card.name, url: i.card.url, lista: i.listaNome, pontos: pontuar(i.alertas, i.valores, regras),
        motivos: ord.map(frase), fazer: regras.acao[ord[0].tipo] || "", tipo: ord[0].tipo });
    }
    pedem.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
    const topo = regras.top, lim = regras.limite_lista_recolhida;
    return { comece: pedem.slice(0, topo), depois: pedem.slice(topo, lim), resto: Math.max(0, pedem.length - lim),
      vitorias, total: meus.length, semAtencao: meus.length - pedem.length };
  }

  /* Painel do quadro: cards = [{card, listaNome, checklists, alertas}] (alertas de avaliarCard). */
  function resumoQuadro(itens, regras, agora) {
    const r = { total: itens.length, vermelho: 0, amarelo: 0, verde: 0, por_tipo: {}, atrasos_longos: [],
      prazo_curto_pouco_andado: [], quase_prontos: [], cadastro: [] };
    for (const it of itens) {
      const s = semaforo(it.alertas, regras);
      r[s]++;
      for (const a of it.alertas) r.por_tipo[a.tipo] = (r.por_tipo[a.tipo] || 0) + 1;
      const atr = it.alertas.find((a) => a.tipo === "atrasado");
      if (atr && atr.valor >= regras.painel_atraso_dias) r.atrasos_longos.push({ nome: it.card.name, dias: atr.valor, url: it.card.url });
      const pp = it.alertas.find((a) => a.tipo === "prazo_proximo");
      const pct = progressoChecklists(it.checklists || []);
      if (pp && pp.valor <= 1 && (pct === null || pct < regras.painel_prazo_pct_max)) r.prazo_curto_pouco_andado.push({ nome: it.card.name, dias: pp.valor, pct, url: it.card.url });
      if (it.alertas.some((a) => a.tipo === "quase_pronto")) r.quase_prontos.push({ nome: it.card.name, url: it.card.url });
      const cad = it.alertas.find((a) => a.tipo === "cadastro_incompleto");
      if (cad) r.cadastro.push({ nome: it.card.name, falta: cad.valor, url: it.card.url });
    }
    r.atrasos_longos.sort((a, b) => b.dias - a.dias);
    return r;
  }

  /* Texto de status semanal montado SO do que existe no card (checklist, prazo, alertas); nao inventa nada. */
  function textoStatus(card, listaNome, checklists, alertas, regras, hoje) {
    const feitos = [], proximos = [];
    let nFeitos = 0, nTotal = 0;
    for (const c of checklists) for (const i of checkItens(c)) {
      nTotal++;
      if (i.state === "complete") nFeitos++;
      if (i.name) (i.state === "complete" ? feitos : proximos).push(i.name);
    }
    const pct = progressoChecklists(checklists);
    const riscos = ordenar(alertas, regras).filter((a) => regras.nivel[a.tipo] !== "verde").map(frase);
    const L = [];
    L.push("Status — " + card.name + " (" + hoje + ")");
    L.push("Fase: " + (listaNome || "—") + (pct === null ? "" : " · progresso " + pct + "% do checklist"));
    // Sem nomes de item (o Trello so entrega contadores ao Power-Up): diz a conta, nao inventa o conteudo.
    if (nTotal === 0) {
      L.push("Feito: sem checklist neste card");
      L.push("Próximo: sem checklist neste card");
    } else if (!feitos.length && !proximos.length) {
      L.push("Feito: " + nFeitos + " de " + nTotal + " itens do checklist concluídos");
      L.push("Próximo: " + (nTotal - nFeitos ? "faltam " + (nTotal - nFeitos) + " itens (descreva o próximo passo)" : "checklist todo concluído"));
    } else {
      L.push("Feito: " + (feitos.length ? feitos.slice(-3).join("; ") : "nenhum item concluído"));
      L.push("Próximo: " + (proximos.length ? proximos.slice(0, 3).join("; ") : "sem itens pendentes no checklist"));
    }
    L.push("Risco: " + (riscos.length ? riscos.join("; ") : "nenhum sinal automático"));
    L.push("(Rascunho gerado só do Trello. Revise antes de enviar.)");
    return L.join("\n");
  }

  return { avaliarCard, semaforo, frase, ordenar, resumoQuadro, textoStatus, progressoChecklists, camposFaltando,
    checklistsDeBadges, pontuar, ondeAtuar, valoresCustomfield };
});
