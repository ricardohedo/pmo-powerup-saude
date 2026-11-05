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
   * Retorna [{tipo, valor}] (mesmos 11 gatilhos do motor, sem "alerta uma vez"; os de comentario usam badges.comments). */
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

    // G-05 sem_comentario_pausado e G-11 em_revisao_sem_comentario: o Trello entrega a CONTAGEM de comentarios do card
    // (badges.comments; conferido ao vivo contra o motor Python, sem divergencia). Sem a contagem, nao avalia.
    const comentarios = card.badges ? card.badges.comments : undefined;
    if (comentarios !== undefined && comentarios !== null) {
      const semComentario = !(comentarios > 0);
      const nomes = (card.labels || []).map((l) => ((l && l.name) || "").trim().toLowerCase());
      if (!concluido && nomes.some((n) => regras.labels_pausado.includes(n)) && semComentario) add("sem_comentario_pausado");
      if (lista === regras.motor.lista_revisao && semComentario) add("em_revisao_sem_comentario");
    }

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
      case "sem_comentario_pausado": return "sem comentário obrigatório";
      case "em_revisao_sem_comentario": return "sem comentário explicando";
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

  /* Prioridade P1..P4: a MESMA de src/pmo/prioridade.py. pct = progresso do checklist (null se nao ha).
   * P1 = atraso de painel_atraso_dias+ ou prazo curto (<= prioridade_p1_prazo_dias) com pouco andado; o resto vem de
   * prioridade_gatilhos (o menor numero e o mais grave). Sem gatilho aberto = null. */
  function prioridade(alertas, pct, regras) {
    const por = {};
    for (const a of alertas) por[a.tipo] = a.valor;
    if (Number.isInteger(por.atrasado) && por.atrasado >= regras.painel_atraso_dias) return "P1";
    if (Number.isInteger(por.prazo_proximo) && por.prazo_proximo <= regras.prioridade_p1_prazo_dias &&
        (pct === null || pct < regras.painel_prazo_pct_max)) return "P1";
    let melhor = null;
    for (const t of Object.keys(por)) {
      const p = regras.prioridade_gatilhos[t];
      if (p && (melhor === null || p < melhor)) melhor = p;
    }
    return melhor;
  }

  /* Risco antecipado: a MESMA de prioridade.risco_antecipado. dias = dias de calendario ate o "Fim planejado"
   * (null sem prazo; negativo = vencido). Quem chama exclui concluido, backlog e listas ignoradas. -> null | "medio" | "alto". */
  function riscoAntecipado(alertas, dias, pct, regras) {
    if (dias === null || dias === undefined || dias < 0 || dias > regras.ceo_dias_prazo_amarelo) return null;
    if ((pct || 0) >= regras.ceo_pct_prazo_amarelo) return null;
    const n = alertas.filter((a) => regras.risco_agravantes.includes(a.tipo)).length;
    return n >= regras.risco_agravantes_para_alto ? "alto" : "medio";
  }

  /* "Concluido sem evidencia": a MESMA de src/pmo/evidencia.py. Prova = anexo no card (badges.attachments, contado pelo Trello).
   * So cobra card em Concluidos mexido nos ultimos evidencia_dias dias (a data de conclusao nao existe; vale a ultima atividade).
   * Sem a contagem de anexos (undefined/null) nao avalia. NAO e um gatilho de alerta. */
  function semEvidencia(it, regras, agora) {
    const lista = (it.listaNome || "").trim().toLowerCase();
    if (it.card.closed || regras.listas_ignorar.some((t) => lista.includes(t)) || !regras.listas_concluido.includes(lista)) return false;
    const anexos = (it.card.badges || {}).attachments, ultima = it.card.dateLastActivity;
    if (anexos === undefined || anexos === null || !ultima) return false;
    return diasDesde(ultima, agora) <= regras.evidencia_dias && anexos < regras.evidencia_min_anexos;
  }

  /* Tendencia: as MESMAS contas de src/pmo/tendencia.py. O retrato do dia e {d, n, v, a, p1, atr, r}: projetos ativos,
   * em Atencao (vermelho), de olho (amarelo), P1, atrasados e em risco. O Power-Up guarda um por dia no armazenamento
   * do quadro (ver tendencia.js) e compara o de hoje com o de uns tendencia_janela_dias dias atras. */
  function retrato(itens, regras, agora) {
    const r = { d: dataLocal(agora, regras), n: 0, v: 0, a: 0, p1: 0, atr: 0, r: 0 };
    for (const it of itens) {
      if (!projetoAtivo(it, regras)) continue;
      r.n++;
      const s = semaforo(it.alertas || [], regras);
      if (s === "vermelho") r.v++; else if (s === "amarelo") r.a++;
      const p = avaliarProjeto(it, regras, agora);
      if (p.prioridade === "P1") r.p1++;
      if (p.risco) r.r++;
      if ((it.alertas || []).some((a) => a.tipo === "atrasado")) r.atr++;
    }
    return r;
  }

  /* Caracteres que a serie ocupa no armazenamento do Power-Up: o conector grava JSON.stringify(serie) como TEXTO e o
   * Trello serializa de novo (as aspas ganham barra), entao medimos a codificacao dupla. Igual a tendencia.tamanho_guardado. */
  function tamanhoGuardado(serie) { return JSON.stringify(JSON.stringify(serie)).length; }

  /* Troca o retrato do mesmo dia, junta o novo e poda o que passou de tendencia_dias dias. Ordem por data.
   * Se ainda passar de tendencia_max_caracteres (o Trello recusa 4096 ou mais), descarta os dias mais antigos. */
  function registrarRetrato(serie, ret, regras) {
    const por = {};
    for (const x of serie || []) por[x.d] = x;
    por[ret.d] = ret;
    const corte = somaDias(ret.d, -regras.tendencia_dias);
    const guardada = Object.keys(por).sort().filter((d) => d >= corte).map((d) => por[d]);
    while (guardada.length > 1 && tamanhoGuardado(guardada) > regras.tendencia_max_caracteres) guardada.shift();
    return guardada;
  }

  /* null com menos de 2 retratos com projetos; senao {direcao, delta_pp, dias, de, para} (% de projetos em Atencao). */
  function direcaoTendencia(serie, regras) {
    const ord = (serie || []).filter((x) => x.n > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    if (ord.length < 2) return null;
    const ultimo = ord[ord.length - 1];
    const alvo = somaDias(ultimo.d, -regras.tendencia_janela_dias);
    const antigos = ord.slice(0, -1).filter((x) => x.d <= alvo);
    const ref = antigos.length ? antigos[antigos.length - 1] : ord[0];
    const de = 100 * ref.v / ref.n, para = 100 * ultimo.v / ultimo.n, delta = para - de;
    const rumo = delta <= -regras.tendencia_limite_pp ? "melhorando" : delta >= regras.tendencia_limite_pp ? "piorando" : "estavel";
    return { direcao: rumo, delta_pp: delta, dias: diasEntre(ref.d, ultimo.d), de, para };
  }

  /* Projeto ativo = card aberto, fora das listas ignoradas, nao concluido e nao backlog. */
  function projetoAtivo(it, regras) {
    const lista = (it.listaNome || "").trim().toLowerCase();
    return !it.card.closed && !regras.listas_ignorar.some((t) => lista.includes(t)) &&
      !regras.listas_concluido.includes(lista) && lista !== regras.motor.lista_backlog;
  }

  /* Carga da equipe: a MESMA de src/pmo/capacidade.py. Por responsavel do card: ativos, em execucao, atrasados, sem prazo.
   * Sem selo de "sobrecarregado" (o responsavel costuma ser o dono do projeto). itens = [{card, listaNome, alertas}].
   * Chave "__sem__" = projeto ativo sem responsavel. */
  function cargaDaEquipe(itens, regras) {
    const por = {};
    for (const it of itens) {
      if (!projetoAtivo(it, regras)) continue;
      const lista = (it.listaNome || "").trim().toLowerCase();
      const tipos = new Set((it.alertas || []).map((a) => a.tipo));
      const donos = (it.card.idMembers || []).length ? it.card.idMembers : ["__sem__"];
      for (const m of donos) {
        const l = (por[m] = por[m] || { ativos: 0, execucao: 0, atrasados: 0, semPrazo: 0 });
        l.ativos++;
        if (lista === regras.motor.lista_execucao) l.execucao++;
        if (tipos.has("atrasado")) l.atrasados++;
        if (tipos.has("sem_prazo")) l.semPrazo++;
      }
    }
    return por;
  }

  /* Indicadores do quadro (substituem os KPIs de tela do portal): so projetos ATIVOS, tudo calculado pelas regras do PMO.
   * Nao ha "throughput 30d": o Trello nao entrega a data de conclusao ao Power-Up. itens = [{card, listaNome, alertas, checklists}].
   * Percentuais arredondados como o resto do motor (arredondaPar); sem projeto ativo = null (a tela mostra "sem dados"). */
  function indicadoresQuadro(itens, regras) {
    const ativos = itens.filter((it) => projetoAtivo(it, regras));
    const n = ativos.length;
    if (!n) return { ativos: 0, atrasados: null, semPrazo: null, semResponsavel: null, progressoMedio: null };
    const tem = (it, tipo) => (it.alertas || []).some((a) => a.tipo === tipo);
    const pct = (k) => arredondaPar(100 * k / n);
    const progs = ativos.map((it) => progressoChecklists(it.checklists || [])).filter((p) => p !== null);
    return {
      ativos: n,
      atrasados: { qtd: ativos.filter((it) => tem(it, "atrasado")).length, pct: pct(ativos.filter((it) => tem(it, "atrasado")).length) },
      semPrazo: { qtd: ativos.filter((it) => tem(it, "sem_prazo")).length, pct: pct(ativos.filter((it) => tem(it, "sem_prazo")).length) },
      semResponsavel: { qtd: ativos.filter((it) => !(it.card.idMembers || []).length).length, pct: pct(ativos.filter((it) => !(it.card.idMembers || []).length).length) },
      progressoMedio: progs.length ? arredondaPar(progs.reduce((s, p) => s + p, 0) / progs.length) : null,
      comChecklist: progs.length,
    };
  }

  /* Prioridade e risco de UM item do quadro ({card, listaNome, alertas, valores, checklists}). */
  function avaliarProjeto(it, regras, agora) {
    const pct = progressoChecklists(it.checklists || []);
    const prioridadeNivel = prioridade(it.alertas || [], pct, regras);
    let risco = null, dias = null;
    const ativo = projetoAtivo(it, regras);
    const fimIso = (it.valores || {})["Fim planejado"];
    if (ativo && fimIso) {
      dias = diasEntre(dataLocal(agora, regras), dataLocal(new Date(fimIso), regras));
      risco = riscoAntecipado(it.alertas || [], dias, pct, regras);
    }
    return { prioridade: prioridadeNivel, risco, pct, dias };
  }

  /* "Onde atuar": cards que pedem acao, do mais ao menos urgente, cada um com o motivo e o que fazer.
   * itens = [{card, listaNome, alertas, valores}]; meuId (opcional) = so os cards em que a pessoa e membro. */
  function ondeAtuar(itens, regras, meuId) {
    const meus = itens.filter((i) => !meuId || (i.card.idMembers || []).includes(meuId));
    const pedem = [], vitorias = [], emRisco = [];
    for (const i of meus) {
      const acao = i.alertas.filter((a) => regras.nivel[a.tipo] !== "verde");
      if (i.prio && i.prio.risco) emRisco.push({ nome: i.card.name, url: i.card.url, lista: i.listaNome, risco: i.prio.risco, dias: i.prio.dias, pct: i.prio.pct });
      if (i.alertas.some((a) => a.tipo === "quase_pronto")) vitorias.push({ nome: i.card.name, url: i.card.url, lista: i.listaNome });
      if (!acao.length) continue;
      const ord = ordenar(acao, regras);
      pedem.push({ nome: i.card.name, url: i.card.url, lista: i.listaNome, pontos: pontuar(i.alertas, i.valores, regras),
        motivos: ord.map(frase), fazer: regras.acao[ord[0].tipo] || "", tipo: ord[0].tipo,
        prioridade: i.prio ? i.prio.prioridade : null, risco: i.prio ? i.prio.risco : null });
    }
    pedem.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
    emRisco.sort((a, b) => (a.risco === b.risco ? 0 : a.risco === "alto" ? -1 : 1) || a.dias - b.dias || a.nome.localeCompare(b.nome));
    const topo = regras.top, lim = regras.limite_lista_recolhida;
    return { comece: pedem.slice(0, topo), depois: pedem.slice(topo, lim), resto: Math.max(0, pedem.length - lim),
      vitorias, emRisco, total: meus.length, semAtencao: meus.length - pedem.length };
  }

  /* Qual aba "Minhas acoes" abre primeiro: "so os meus" quando a pessoa esta logada e e membro de ao menos um card do quadro;
   * senao "todos" (quem so acompanha o quadro, ou nao esta logado, ve o quadro inteiro em vez de uma tela vazia). */
  function abaInicialMeus(itens, meuId) {
    return !!meuId && (itens || []).some((i) => ((i.card && i.card.idMembers) || []).includes(meuId));
  }

  // Data local (fuso do PMO, Brasilia) como "AAAA-MM-DD"; dias de calendario, igual ao Plano (plano.projetos_do_board).
  function dataLocal(d, regras) { return new Date(d.getTime() + regras.fuso_horas * 3600000).toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DIA_MS); }
  function somaDias(a, n) { return new Date(Date.parse(a + "T00:00:00Z") + n * DIA_MS).toISOString().slice(0, 10); }

  /* Linha do tempo de entregas: a MESMA regra do painel da CEO (ceo.marcos) e do Plano.
   * itens = [{card, listaNome, alertas, valores, checklists}]. Retorna atrasadas, janelas de 7 dias, sem prazo, entregues no mes. */
  function linhaDoTempo(itens, regras, agora) {
    const hoje = dataLocal(agora, regras), mes = hoje.slice(0, 7);
    const r = { hoje, atrasadas: [], proximas: [], janelas: [], semPrazo: [], entregues: [], total: 0 };
    for (const it of itens) {
      if (it.card.closed) continue;
      const lista = (it.listaNome || "").trim().toLowerCase();
      if (regras.listas_ignorar.some((t) => lista.includes(t))) continue;
      r.total++;
      const concluido = regras.listas_concluido.includes(lista), backlog = lista === regras.motor.lista_backlog;
      const fimIso = (it.valores || {})["Fim planejado"];
      const fim = fimIso ? dataLocal(new Date(fimIso), regras) : null;
      const pct = progressoChecklists(it.checklists || []);
      const base = { id: it.card.id, nome: it.card.name, url: it.card.url, lista: it.listaNome, fim, pct,
        nivel: semaforo(it.alertas || [], regras) };
      if (concluido) { if (fim && fim.startsWith(mes)) r.entregues.push(base); continue; }
      if (backlog) continue;
      if (!fim) { r.semPrazo.push(base); continue; }
      const dias = diasEntre(hoje, fim);
      if (dias < 0) r.atrasadas.push({ ...base, dias: -dias });
      else if (dias <= regras.dias_marcos) {
        r.proximas.push({ ...base, dias, pouco: dias <= regras.ceo_dias_prazo_amarelo && (pct || 0) < regras.ceo_pct_prazo_amarelo });
      }
    }
    const porFim = (a, b) => (a.fim < b.fim ? -1 : a.fim > b.fim ? 1 : a.nome.localeCompare(b.nome));
    r.atrasadas.sort((a, b) => b.dias - a.dias || a.nome.localeCompare(b.nome));
    r.proximas.sort(porFim); r.entregues.sort(porFim);
    for (const p of r.proximas) {
      const i = Math.floor(p.dias / 7);
      if (!r.janelas[i]) r.janelas[i] = { de: somaDias(hoje, i * 7), ate: somaDias(hoje, Math.min(i * 7 + 6, regras.dias_marcos)), itens: [] };
      r.janelas[i].itens.push(p);
    }
    r.janelas = r.janelas.filter(Boolean);
    return r;
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

  /* AJUDA AO GESTOR (sem IA): explica, com o numero real e o limite da regra, por que o card esta assim.
   * So texto montado de alertas + regras.json: mesma entrada = mesma resposta. Nao decide nada, so explica. */
  function dias(n) { return n + (n === 1 ? " dia" : " dias"); }
  function regraDoAlerta(tipo, regras) {
    switch (tipo) {
      case "atrasado": return "O 'Fim planejado' já passou. Com " + dias(regras.painel_atraso_dias) + " de atraso ou mais o projeto vira P1 (Crítico).";
      case "atraso_oculto": return "O card não está atrasado, mas há itens de checklist com prazo vencido e ainda abertos (atraso escondido).";
      case "sem_interacao": return "Há " + dias(regras.dias_sem_interacao) + " ou mais sem interação (comentário ou movimentação) em projeto em andamento.";
      case "prazo_proximo": return "O 'Fim planejado' está a " + dias(regras.dias_prazo_proximo) + " ou menos. Se faltar " + dias(regras.prioridade_p1_prazo_dias) + " ou menos e o checklist estiver abaixo de " + regras.painel_prazo_pct_max + "%, vira P1.";
      case "quase_pronto": return "O checklist chegou a " + regras.progresso_min_quase_pronto + "% ou mais, mas o card ainda não está em Concluídos.";
      case "sem_prazo": return "Projeto em andamento sem o 'Fim planejado' preenchido.";
      case "sem_responsavel": return "Projeto em andamento sem nenhum membro atribuído ao card.";
      case "cadastro_incompleto": return "Campos obrigatórios vazios: " + regras.campos_obrigatorios.join(", ") + " (e a descrição com as seções esperadas).";
      case "checklist_pendente_concluido": return "O card está em Concluídos, mas ainda tem itens de checklist abertos.";
      case "em_revisao_sem_comentario": return "O card está em Em Revisão sem nenhum comentário explicando o que falta.";
      case "sem_comentario_pausado": return "O card tem a etiqueta Pausado/Impedimento e nenhum comentário explicando o motivo.";
      default: return "";
    }
  }

  /* Por que o card tem esta prioridade (espelha prioridade(): P1 por atraso, P1 por prazo curto, senao o gatilho mais grave). */
  function porquePrioridade(alertas, pct, regras) {
    const p = prioridade(alertas, pct, regras);
    if (!p) return { prioridade: null, texto: "Sem prioridade: nenhum sinal que peça ação neste card agora." };
    const por = {};
    for (const a of alertas) por[a.tipo] = a.valor;
    if (p === "P1" && Number.isInteger(por.atrasado) && por.atrasado >= regras.painel_atraso_dias)
      return { prioridade: p, texto: "P1 porque o projeto está com " + dias(por.atrasado) + " de atraso (a partir de " + dias(regras.painel_atraso_dias) + " é Crítico)." };
    if (p === "P1")
      return { prioridade: p, texto: "P1 porque o prazo vence em " + dias(por.prazo_proximo) + " e o checklist " + (pct === null ? "não existe" : "está em " + pct + "%") + " (abaixo de " + regras.painel_prazo_pct_max + "%)." };
    const causas = Object.keys(por).filter((t) => regras.prioridade_gatilhos[t] === p).sort((a, b) => regras.ordem.indexOf(a) - regras.ordem.indexOf(b));
    return { prioridade: p, texto: p + " porque: " + causas.map((t) => frase({ tipo: t, valor: por[t] })).join("; ") + "." };
  }

  /* Tudo que a tela de ajuda mostra: prioridade, uma linha por sinal (frase, regra, o que fazer) e o risco. */
  function explicar(alertas, pct, diasPrazo, regras) {
    const prio = porquePrioridade(alertas, pct, regras);
    const risco = riscoAntecipado(alertas, diasPrazo, pct, regras);
    return {
      prioridade: prio.prioridade, porquePrioridade: prio.texto,
      sinais: ordenar(alertas, regras).map((a) => ({ tipo: a.tipo, frase: frase(a), regra: regraDoAlerta(a.tipo, regras), fazer: regras.acao[a.tipo] || "" })),
      risco: risco ? { nivel: risco, texto: "Prazo em " + dias(diasPrazo) + " e " + (pct === null ? "sem checklist" : pct + "% do checklist") + " (alerta quando faltam " + dias(regras.ceo_dias_prazo_amarelo) + " ou menos e menos de " + regras.ceo_pct_prazo_amarelo + "%). " + regras.fazer_risco[risco] } : null,
    };
  }

  /* ANTES QUE ACONTECA (sem IA): quanto falta para o card cair num alerta/prioridade, se ninguem mexer.
   * So mostra quando faltam ate aviso_antecipado_dias (pmo.toml) para cair no alerta (evita ruido tipo "avisa em 60 dias"). Mesma regra do avaliarCard (nao inventa limite).
   * Retorna [{tipo, dias, texto}] do mais urgente ao menos. */
  function antecipar(card, listaNome, alertas, camposDef, agora, regras) {
    if (card.closed) return [];
    const lista = (listaNome || "").trim().toLowerCase();
    if (regras.listas_ignorar.some((t) => lista.includes(t)) || regras.listas_concluido.includes(lista) || lista === regras.motor.lista_backlog) return [];
    const tem = (tipo) => alertas.find((a) => a.tipo === tipo);
    const janela = regras.aviso_antecipado_dias, out = [];
    const fasesOk = !regras.sem_interacao_fases.length || regras.sem_interacao_fases.includes(lista);
    if (card.dateLastActivity && fasesOk && !tem("sem_interacao")) {
      const falta = regras.dias_sem_interacao - diasDesde(card.dateLastActivity, agora);
      if (falta > 0 && falta <= janela) out.push({ tipo: "sem_interacao", dias: falta, texto: "Entra em alerta de 'sem interação' em " + dias(falta) + " se ninguém mexer no card (limite: " + dias(regras.dias_sem_interacao) + ")." });
    }
    const fim = valoresCustomfield(card, camposDef)["Fim planejado"];
    if (fim && !tem("prazo_proximo") && !tem("atrasado")) {
      const d = Math.floor((iso(fim) - agora) / DIA_MS), falta = d - regras.dias_prazo_proximo;
      if (d > regras.dias_prazo_proximo && falta <= janela) out.push({ tipo: "prazo_proximo", dias: falta, texto: "Entra em alerta de 'prazo próximo' em " + dias(falta) + " (o prazo é daqui a " + dias(d) + "; o aviso começa a " + dias(regras.dias_prazo_proximo) + " do prazo)." });
    }
    const atr = tem("atrasado");
    if (atr && Number.isInteger(atr.valor) && atr.valor < regras.painel_atraso_dias) {
      const falta = regras.painel_atraso_dias - atr.valor;
      if (falta <= janela) out.push({ tipo: "atrasado", dias: falta, texto: "Vira P1 (Crítico) em " + dias(falta) + " se o atraso continuar (hoje " + dias(atr.valor) + "; limite: " + dias(regras.painel_atraso_dias) + ")." });
    }
    return out.sort((a, b) => a.dias - b.dias);
  }

  /* PRONTIDAO para a proxima fase (sem IA): reavalia o card COM O MOTOR como se ja estivesse na proxima lista e devolve o que
   * apareceria como pendencia. Fases: Backlog > Priorizados > Em Execucao > Em Revisao > Concluidos. Sem proxima fase = null.
   * Ignora o que nao depende da fase (atrasado, prazo proximo, sem interacao, quase pronto). */
  const NOME_FASE = { execucao: "Em Execução", revisao: "Em Revisão", concluidos: "Concluídos" };
  function prontidao(card, listaNome, camposDef, checklists, agora, regras) {
    if (card.closed) return null;
    const lista = (listaNome || "").trim().toLowerCase();
    if (regras.listas_ignorar.some((t) => lista.includes(t))) return null;
    const m = regras.motor, fe = regras.fases_execucao;
    let prox = null, rotulo = null;
    if (lista === m.lista_backlog) { prox = fe[0]; rotulo = "Priorizados"; }
    else if (lista === fe[0]) { prox = m.lista_execucao; rotulo = NOME_FASE.execucao; }
    else if (lista === m.lista_execucao) { prox = m.lista_revisao; rotulo = NOME_FASE.revisao; }
    else if (lista === m.lista_revisao) { prox = regras.listas_concluido[1] || regras.listas_concluido[0]; rotulo = NOME_FASE.concluidos; }
    if (!prox) return null;
    const naoDependeDaFase = new Set(["atrasado", "prazo_proximo", "sem_interacao", "quase_pronto"]);
    const faltam = ordenar(avaliarCard(card, prox, camposDef, checklists, agora, regras), regras)
      .filter((a) => !naoDependeDaFase.has(a.tipo))
      .map((a) => ({ tipo: a.tipo, frase: frase(a), fazer: regras.acao[a.tipo] || "" }));
    return { proxima: rotulo, faltam };
  }

  return { antecipar, prontidao, indicadoresQuadro, explicar, regraDoAlerta, porquePrioridade, avaliarCard, semaforo, frase, ordenar, resumoQuadro, textoStatus, progressoChecklists, camposFaltando,
    checklistsDeBadges, pontuar, ondeAtuar, abaInicialMeus, valoresCustomfield, linhaDoTempo, prioridade, riscoAntecipado, avaliarProjeto, cargaDaEquipe, semEvidencia,
    retrato, registrarRetrato, tamanhoGuardado, direcaoTendencia, dataLocal };
});
