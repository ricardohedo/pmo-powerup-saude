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

  /* Igual ao Python (plano.py): o checklist de inicio ("Inicio do Projeto", regras.checklist_inicio) nao entra no
   * progresso. Sem `regras` (ou sem nome de checklist, como nos contadores dos badges) nada e excluido. */
  function progressoChecklists(checklists, regras) {
    const ini = regras && regras.checklist_inicio ? String(regras.checklist_inicio).toLowerCase() : null;
    let total = 0, feitos = 0;
    for (const c of checklists) {
      if (ini && c && c.name && String(c.name).trim().toLowerCase() === ini) continue;
      for (const i of checkItens(c)) { total++; if (i.state === "complete") feitos++; }
    }
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
      if (cd.type === "date") v[cd.name] = val.date && !isNaN(Date.parse(val.date)) ? val.date : null;   // data corrompida = sem data (nao derruba a tela)
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
    const pct = concluido ? null : progressoChecklists(checklists, regras);
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
    const progs = ativos.map((it) => progressoChecklists(it.checklists || [], regras)).filter((p) => p !== null);
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
    const pct = progressoChecklists(it.checklists || [], regras);
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

  /* DIAS UTEIS (so informativo; as regras de alerta seguem em dias de calendario, como o motor do pmo_v2): de "de" (exclusivo)
   * ate "ate" (inclusivo), sem sabado, domingo nem feriado (regras.feriados). Prazo passado = numero negativo. */
  function diasUteis(de, ate, feriados) {
    const fer = new Set(feriados || []);
    const util = (iso) => { const w = new Date(iso + "T00:00:00Z").getUTCDay(); return w !== 0 && w !== 6 && !fer.has(iso); };
    if (de === ate) return 0;
    const [ini, fim, sinal] = de < ate ? [de, ate, 1] : [ate, de, -1];
    let n = 0;
    for (let d = somaDias(ini, 1); d <= fim; d = somaDias(d, 1)) if (util(d)) n++;
    return sinal * n;
  }

  /* MARCOS: cards com a etiqueta de regras.labels_marco (criada pelo gestor; o Power-Up so le), ainda nao concluidos, com
   * "Fim planejado" (ou o prazo do card). Do mais proximo ao mais distante; atrasados primeiro (dias < 0). */
  function marcos(itens, regras, agora) {
    const hoje = dataLocal(agora, regras), alvo = new Set(regras.labels_marco || []);
    const out = [];
    for (const it of itens) {
      const nomes = (it.card.labels || []).map((l) => ((l && l.name) || "").trim().toLowerCase());
      if (!nomes.some((n) => alvo.has(n))) continue;
      if (concluidoOuFechado(it, regras)) continue;
      const iso = it.valores["Fim planejado"] || it.card.due;
      const data = iso ? dataLocal(new Date(iso), regras) : null;
      out.push({ nome: it.card.name, url: it.card.url, lista: it.listaNome, data,
        dias: data ? diasEntre(hoje, data) : null, diasUteis: data ? diasUteis(hoje, data, regras.feriados) : null });
    }
    out.sort((a, b) => (a.data === null) - (b.data === null) || (a.data < b.data ? -1 : a.data > b.data ? 1 : 0) || a.nome.localeCompare(b.nome));
    return out;
  }

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  // fora do portfolio: card fechado, lista concluida ou lista ignorada (Rastreador/placar, templates...), igual ao resto do Power-Up
  const concluidoOuFechado = (it, regras) => {
    const lista = (it.listaNome || "").trim().toLowerCase();
    return it.card.closed || regras.listas_concluido.includes(lista) || regras.listas_ignorar.some((x) => lista.includes(x));
  };

  /* DATAS DO VAREJO (regras.datas_varejo = {nome: AAAA-MM-DD}): para cada data futura a ate aviso_dias_uteis dias uteis, os projetos
   * ATIVOS com a etiqueta de mesmo nome e o que os poe em risco: atrasado, sem prazo ou "Fim planejado" depois da data. So le. */
  function datasVarejo(itens, regras, agora) {
    const hoje = dataLocal(agora, regras), out = [];
    for (const [nome, data] of Object.entries(regras.datas_varejo || {})) {
      const dias = diasEntre(hoje, data);
      if (dias < 0) continue;
      const du = diasUteis(hoje, data, regras.feriados);
      if (du > regras.datas_varejo_aviso_dias_uteis) continue;
      const projetos = [];
      for (const it of itens) {
        if (concluidoOuFechado(it, regras)) continue;
        if (!(it.card.labels || []).some((l) => norm(l && l.name) === norm(nome))) continue;
        const iso = it.valores["Fim planejado"];
        const fim = iso ? dataLocal(new Date(iso), regras) : null;
        const motivos = [];
        if ((it.alertas || []).some((a) => a.tipo === "atrasado")) motivos.push("atrasado");
        if (!fim) motivos.push("sem prazo");
        else if (fim > data) motivos.push("prazo depois da data (" + fim.slice(8, 10) + "/" + fim.slice(5, 7) + ")");
        projetos.push({ nome: it.card.name, url: it.card.url, lista: it.listaNome, motivos });
      }
      projetos.sort((a, b) => b.motivos.length - a.motivos.length || a.nome.localeCompare(b.nome));
      out.push({ nome, data, dias, diasUteis: du, projetos, emRisco: projetos.filter((p) => p.motivos.length).length });
    }
    return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  }

  /* MATRIZ IMPACTO x ESFORCO (campos "Impacto no negocio" e "Esforco estimado": Alto/Medio/Baixo). So projetos nao concluidos.
   * celulas["alto|baixo"] = projetos de impacto ALTO e esforco BAIXO; semClassificar = falta um dos dois campos. */
  function matrizImpactoEsforco(itens, regras) {
    const nivel = (v) => { const n = norm(v); return ["alto", "medio", "baixo"].includes(n) ? n : null; };
    const celulas = {}, semClassificar = [];
    for (const it of itens) {
      if (concluidoOuFechado(it, regras)) continue;
      const imp = nivel(it.valores["Impacto no negócio"]), esf = nivel(it.valores["Esforço estimado"]);
      const dado = { nome: it.card.name, url: it.card.url, lista: it.listaNome, impacto: imp, esforco: esf, prioridade: it.prio ? it.prio.prioridade : null };
      if (!imp || !esf) { semClassificar.push({ ...dado, falta: [!imp ? "Impacto no negócio" : null, !esf ? "Esforço estimado" : null].filter(Boolean) }); continue; }
      (celulas[imp + "|" + esf] = celulas[imp + "|" + esf] || []).push(dado);
    }
    return { celulas, semClassificar };
  }

  /* RESUMO DE UMA AREA (Portfolio): contagens sobre os projetos ATIVOS, com os mesmos alertas do motor.
   * criticos = atraso >= painel_atraso_dias. Semaforo: vermelho se ha critico; amarelo se ha atraso, sem interacao ou cadastro
   * incompleto; senao verde. (A pagina local do pmo_v2 usa a conta do Plano de Acao: atrasados e criticos batem, o amarelo pode diferir.) */
  function resumoArea(itens, regras) {
    const ativos = itens.filter((it) => projetoAtivo(it, regras));
    const tem = (it, tipo) => (it.alertas || []).some((a) => a.tipo === tipo);
    const atras = ativos.filter((it) => tem(it, "atrasado"));
    const criticos = atras.filter((it) => it.alertas.find((a) => a.tipo === "atrasado").valor >= regras.painel_atraso_dias);
    const r = { ativos: ativos.length, atrasados: atras.length, criticos: criticos.length,
      semPrazo: ativos.filter((it) => tem(it, "sem_prazo")).length,
      semResponsavel: ativos.filter((it) => !(it.card.idMembers || []).length).length,
      semInteracao: ativos.filter((it) => tem(it, "sem_interacao")).length,
      cadastro: ativos.filter((it) => tem(it, "cadastro_incompleto")).length };
    r.semaforo = r.criticos ? "vermelho" : (r.atrasados || r.semInteracao || r.cadastro) ? "amarelo" : "verde";
    r.piores = atras.map((it) => ({ nome: it.card.name, url: it.card.url, dias: it.alertas.find((a) => a.tipo === "atrasado").valor }))
      .sort((a, b) => b.dias - a.dias).slice(0, 5);
    return r;
  }

  /* O Portfolio so aparece (e so abre) nos quadros listados em regras.portfolio_so_nos_quadros (nome exato). */
  function portfolioPermitido(nomeDoQuadro, regras) {
    return (regras.portfolio_so_nos_quadros || []).includes(String(nomeDoQuadro || "").trim());
  }

  /* Quais quadros o Portfolio le: do workspace certo, nome contem o texto, sem os prefixos excluidos (ex.: MODELO). */
  function quadrosDoPortfolio(boards, regras) {
    const excl = (regras.portfolio_excluir_prefixos || []).map((s) => s.toLowerCase());
    return boards.filter((b) => !b.closed && b.organization && b.organization.displayName === regras.portfolio_workspace &&
      b.name.includes(regras.portfolio_nome_contem) && !excl.some((x) => b.name.toLowerCase().startsWith(x)))
      .map((b) => ({ id: b.id, nome: b.name.replace(regras.portfolio_nome_contem, "").replace(/[\s—-]+$/, "").trim() }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

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
      const pct = progressoChecklists(it.checklists || [], regras);
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
      const pct = progressoChecklists(it.checklists || [], regras);
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
    const pct = progressoChecklists(checklists, regras);
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
  function antecipar(card, listaNome, alertas, camposDef, agora, regras, fimJa) {     // fimJa (opcional): o Fim planejado ja lido (o radar nao tem camposDef)
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
    const fim = fimJa !== undefined ? fimJa : valoresCustomfield(card, camposDef)["Fim planejado"];
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
  /* ORDENAR LISTA por prioridade (list-sorters): P1 > P2 > P3 > P4 > sem prioridade; empate = pontuacao maior primeiro,
   * depois a ordem atual. ids = cards da lista na ordem atual; itens = {card, alertas, valores, prio}. Devolve so os ids. */
  function ordenarPorPrioridade(ids, itens, regras) {
    const por = new Map(itens.map((i) => [i.card.id, i]));
    const peso = (id) => {
      const i = por.get(id);
      if (!i) return [9, 0];
      const p = i.prio && i.prio.prioridade;
      return [p ? Number(p.slice(1)) : 5, -pontuar(i.alertas, i.valores, regras)];
    };
    return ids.map((id, pos) => ({ id, pos, k: peso(id) }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.pos - b.pos).map((x) => x.id);
  }
  /* LINHA DE BASE: base = {e, i, f} (data do congelamento e Inicio/Fim planejados originais, AAAA-MM-DD). Compara com o
   * Fim planejado de hoje. Sem base = null. dias > 0: escorregou; < 0: adiantou; 0: igual ao plano original. */
  function desvioPlano(base, valores, regras) {
    if (!base || !base.f) return null;
    const br = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
    const atual = valores["Fim planejado"] ? dataLocal(new Date(valores["Fim planejado"]), regras) : null;
    if (!atual) return { dias: null, base: base.f, atual: null, texto: "O 'Fim planejado' saiu do card (o plano original previa " + br(base.f) + ")." };
    const dias = diasEntre(base.f, atual);
    const texto = dias === 0 ? "No plano: fim previsto em " + br(atual) + ", igual ao original."
      : dias > 0 ? "Escorregou " + dias + (dias === 1 ? " dia" : " dias") + ": o plano original previa " + br(base.f) + " e hoje está em " + br(atual) + "."
        : "Adiantou " + (-dias) + (dias === -1 ? " dia" : " dias") + ": o plano original previa " + br(base.f) + " e hoje está em " + br(atual) + ".";
    return { dias, base: base.f, atual, texto };
  }

  /* MEU DIA: o que pede VOCE hoje, pelo tempo. itens = [{card, listaNome, alertas, valores, prio}]; meuId = membro logado (so os cards dele).
   * hoje = Fim planejado e hoje; atrasadas = atrasado (mais dias primeiro); semana = prazo proximo (em dias uteis, descontados
   * fim de semana e feriados); checklist = itens vencidos escondidos (atraso_oculto); parados = sem interacao. Um card pode estar em
   * mais de uma secao; total conta cards distintos. Fora: concluido, backlog, fechado, listas ignoradas (projetoAtivo). So le. */
  function meuDia(itens, regras, meuId, agora) {
    const hoje = dataLocal(agora, regras), r = { hoje: [], atrasadas: [], semana: [], checklist: [], parados: [], total: 0, souMembro: false, meusAtivos: 0, proximo: null };
    const ids = new Set();
    for (const it of itens) {
      if (!meuId || !(it.card.idMembers || []).includes(meuId)) continue;
      r.souMembro = true;
      if (!projetoAtivo(it, regras)) continue;
      const al = (tipo) => (it.alertas || []).find((a) => a.tipo === tipo);
      const base = { nome: it.card.name, url: it.card.url, lista: it.listaNome, prioridade: it.prio ? it.prio.prioridade : null };
      const fimIso = (it.valores || {})["Fim planejado"], fim = fimIso ? dataLocal(new Date(fimIso), regras) : null;
      r.meusAtivos++;
      if (fim && fim >= hoje && (!r.proximo || fim < r.proximo.fim)) r.proximo = { nome: it.card.name, url: it.card.url, fim, diasUteis: diasUteis(hoje, fim, regras.feriados) };
      const atr = al("atrasado"), pp = al("prazo_proximo"), ao = al("atraso_oculto"), si = al("sem_interacao");
      let entrou = false;
      if (fim === hoje) { r.hoje.push({ ...base, texto: "vence hoje" }); entrou = true; }
      else if (atr && atr.valor > 0) { r.atrasadas.push({ ...base, dias: atr.valor, texto: atr.valor + (atr.valor === 1 ? " dia" : " dias") + " de atraso" }); entrou = true; }
      else if (pp && fim && fim > hoje) {
        const du = diasUteis(hoje, fim, regras.feriados);
        r.semana.push({ ...base, dias: pp.valor, diasUteis: du, texto: "vence em " + du + (du === 1 ? " dia útil" : " dias úteis") + " (" + fim.slice(8, 10) + "/" + fim.slice(5, 7) + ")" }); entrou = true;
      }
      if (ao) { r.checklist.push({ ...base, texto: ao.valor === null ? "itens de checklist vencidos" : frase(ao) }); entrou = true; }
      if (si) { r.parados.push({ ...base, dias: si.valor, texto: si.valor + " dias sem interação" }); entrou = true; }
      if (entrou) ids.add(it.card.id);
    }
    const porNome = (a, b) => a.nome.localeCompare(b.nome);
    r.atrasadas.sort((a, b) => b.dias - a.dias || porNome(a, b)); r.semana.sort((a, b) => a.diasUteis - b.diasUteis || porNome(a, b));
    r.parados.sort((a, b) => b.dias - a.dias || porNome(a, b)); r.hoje.sort(porNome); r.checklist.sort(porNome);
    r.total = ids.size;
    r.foco = r.hoje[0] || r.atrasadas[0] || r.semana[0] || r.checklist[0] || r.parados[0] || null;
    return r;
  }

  /* ENGAJAMENTO (funcao opcional, so leitura): reconhecimento sem pressao. Nada aqui pontua pessoas, compara pessoas
   * nem conta sequencia de dias. Tudo e da AREA (o quadro), nunca de uma pessoa.
   * MISSOES (pmo.toml [engajamento_missoes], nome = "metrica | data"): meta coletiva "nenhum projeto ativo com tal problema".
   * Cada missao devolve tambem QUAIS projetos faltam (ate engajamento_max_itens) e o motivo. */
  const METRICA_ALERTA = { cadastro_completo: "cadastro_incompleto", com_responsavel: "sem_responsavel", com_prazo: "sem_prazo",
    sem_atraso: "atrasado", com_interacao: "sem_interacao" };
  const dmCurto = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

  function dataDaMissao(txt, regras, hoje) {                  // "semana" = a proxima sexta (hoje, se hoje e sexta)
    const t = String(txt).trim();
    if (t === "semana") { const dow = new Date(hoje + "T00:00:00Z").getUTCDay(); return somaDias(hoje, (5 - dow + 7) % 7); }
    return (regras.datas_varejo || {})[t] || (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null);
  }

  function missoesDaArea(itens, regras, agora) {
    const hoje = dataLocal(agora, regras), ativos = itens.filter((it) => projetoAtivo(it, regras)), max = regras.engajamento_max_itens || 8;
    if (!ativos.length) return [];
    const out = [];
    for (const [nome, def] of Object.entries(regras.engajamento_missoes || {})) {
      const [metrica, quando] = String(def).split("|").map((x) => x.trim()), tipo = METRICA_ALERTA[metrica], ate = dataDaMissao(quando, regras, hoje);
      if (!tipo || !ate) continue;
      const falham = ativos.map((it) => ({ it, a: (it.alertas || []).find((x) => x.tipo === tipo && (tipo !== "atrasado" || x.valor > 0)) })).filter((x) => x.a);
      const ok = ativos.length - falham.length;
      out.push({ nome, metrica, ate, ateRotulo: (quando === "semana" ? "sexta " : "") + dmCurto(ate), diasUteis: diasUteis(hoje, ate, regras.feriados),
        vencida: ate < hoje, ativos: ativos.length, ok, faltam: falham.length, pct: arredondaPar(100 * ok / ativos.length), completa: falham.length === 0,
        faltantes: falham.sort((x, y) => x.it.card.name.localeCompare(y.it.card.name)).slice(0, max).map((x) => ({ nome: x.it.card.name, url: x.it.card.url, motivo: frase(x.a) })),
        mais: Math.max(0, falham.length - max) });
    }
    return out;
  }

  /* ENTREGAS DA SEMANA: concluidos com atividade nos ultimos engajamento_janela_dias dias. O Trello nao entrega ao Power-Up a data
   * de conclusao; a ultima atividade do card (o movimento para Concluidos conta) e a melhor aproximacao. */
  function entregasDaSemana(itens, regras, agora) {
    const max = regras.engajamento_max_itens || 8, janela = regras.engajamento_janela_dias || 7;
    const lista = itens.filter((it) => !it.card.closed && regras.listas_concluido.includes((it.listaNome || "").trim().toLowerCase()) &&
      it.card.dateLastActivity && diasDesde(it.card.dateLastActivity, agora) <= janela)
      .map((it) => ({ nome: it.card.name, url: it.card.url, dias: diasDesde(it.card.dateLastActivity, agora) }))
      .sort((a, b) => a.dias - b.dias || a.nome.localeCompare(b.nome));
    return { total: lista.length, janela, itens: lista.slice(0, max), mais: Math.max(0, lista.length - max) };
  }

  /* RETA FINAL: projetos ativos que ja bateram o limite de "quase pronto" (regras.progresso_min_quase_pronto), com quantos itens faltam. */
  function retaFinal(itens, regras) {
    const max = regras.engajamento_max_itens || 8, ini = regras.checklist_inicio ? String(regras.checklist_inicio).toLowerCase() : null;
    const lista = itens.filter((it) => projetoAtivo(it, regras) && (it.alertas || []).some((a) => a.tipo === "quase_pronto")).map((it) => {
      let total = 0, feitos = 0;
      for (const c of it.checklists || []) {
        if (ini && c && c.name && String(c.name).trim().toLowerCase() === ini) continue;
        for (const i of checkItens(c)) { total++; if (i.state === "complete") feitos++; }
      }
      return { nome: it.card.name, url: it.card.url, pct: (it.alertas.find((a) => a.tipo === "quase_pronto") || {}).valor, faltam: total ? total - feitos : null };
    }).sort((a, b) => b.pct - a.pct || a.nome.localeCompare(b.nome));
    return { total: lista.length, itens: lista.slice(0, max), mais: Math.max(0, lista.length - max) };
  }

  /* DESTAQUE DA SEMANA: texto escolhido pelo PMO (humano, por evidencia) em pmo.toml [engajamento_destaques]; vale
   * engajamento_janela_dias dias a partir da data. Nada e calculado nem inventado aqui. */
  function destaqueDaSemana(regras, agora) {
    const hoje = dataLocal(agora, regras), janela = regras.engajamento_janela_dias || 7;
    const dias = Object.keys(regras.engajamento_destaques || {}).filter((d) => d <= hoje && diasEntre(d, hoje) < janela).sort();
    return dias.length ? { desde: dias[dias.length - 1], texto: regras.engajamento_destaques[dias[dias.length - 1]] } : null;
  }

  /* RISCOS E PREMISSAS (funcao opcional, so leitura): o gestor registra na DESCRICAO do card, numa secao cujo titulo comeca por
   * regras.riscos_secao (ex.: "#### ***RISCOS E PREMISSAS***"), UMA LINHA por item:
   *   - RISCO: o que pode dar errado | prob: alta | imp: alto | dono: Ana | resposta: o que fazer | revisar: 2026-12-10
   *   - PREMISSA: o que estamos assumindo | dono: Ana | revisar: 2026-12-10
   * Vocabulario (niveis, apelidos de campo, tipos) e limites da matriz vem do pmo.toml. Nada e escrito no Trello. */
  const semAcento = (x) => String(x == null ? "" : x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const ehCaixaAlta = (l) => /[A-ZÀ-Ý]/.test(l) && l === l.toUpperCase() && l.split(/\s+/).length <= 8 && !/[|]/.test(l);

  function dataDeRisco(txt) {                                  // AAAA-MM-DD ou DD/MM/AAAA; o resto vira null (sem data)
    const m = String(txt || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) || String(txt || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const iso = m[1].length === 4 ? m[1] + "-" + m[2] + "-" + m[3] : m[3] + "-" + m[2] + "-" + m[1];
    const d = new Date(iso + "T00:00:00Z");                    // ida e volta: o V8 aceita 30/02 e 31/04 como se fossem datas
    return isNaN(d) || d.toISOString().slice(0, 10) !== iso ? null : iso;
  }

  /* So chave PROPRIA do objeto: "constructor: x" ou "toString: x" escritos na descricao nao podem virar funcao do JavaScript. */
  const temChave = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  const CORTE_AVISO = 24;                                      // so o tamanho do trecho citado nos avisos de linha mal escrita
  const citar = (x) => (String(x).length > CORTE_AVISO ? String(x).slice(0, CORTE_AVISO) + "…" : String(x));

  function parseRiscos(desc, regras) {
    const titulo = semAcento(regras.riscos_secao), niveis = regras.riscos_niveis || {}, campos = regras.riscos_campos || {}, tipos = regras.riscos_tipos || {};
    const maxTexto = regras.riscos_max_texto, corta = (x) => (maxTexto ? String(x).slice(0, maxTexto) : String(x));
    const palavrasTitulo = titulo.split(/\s+/).filter((w) => w.length >= 5), out = []; let dentro = false;
    for (const bruta of String(desc || "").split("\n")) {
      const linha = bruta.trim();
      if (!linha) continue;
      const semDeco = linha.replace(/^[#>*_\s]+/, "").replace(/[*_:\s]+$/, "");
      const ehItem = /^([-*•]|\d+[.)])\s/.test(linha);                                   // linha de lista nunca e titulo (mesmo em CAIXA ALTA)
      const ehNegrito = /^(\*\*|__)[^*_:]+:?(\*\*|__):?$/.test(linha);                    // "**Cronograma**" sozinho na linha = titulo
      const ehTitulo = /^#/.test(linha) || ehNegrito || (!ehItem && ehCaixaAlta(semDeco) && !temChave(tipos, semAcento(semDeco.split(":")[0])));
      if (ehTitulo) { const h = semAcento(semDeco); dentro = h.startsWith(titulo) || palavrasTitulo.includes(h.split(/\s+/)[0]); continue; }   // 'RISCOS' ou 'PREMISSAS' sozinhos tambem valem
      if (!dentro) continue;
      const partes = linha.replace(/^([-*•]|\d+[.)])\s*/, "").split("|").map((x) => x.trim());
      const principal = partes[0].match(/^([A-Za-zÀ-ÿ]+)\s*:\s*(.*)$/);
      const achado = principal && temChave(tipos, semAcento(principal[1])) ? tipos[semAcento(principal[1])] : null;
      const tipo = achado || "risco";
      const texto = corta((achado ? principal[2] : partes[0]).trim());
      if (!texto) continue;
      const r = { tipo, texto, prob: null, imp: null, dono: null, resposta: null, revisar: null, avisos: [] };
      for (const parte of partes.slice(1)) {
        if (!parte) continue;
        const kv = parte.match(/^([^:]+):\s*(.*)$/);
        if (!kv) { r.avisos.push("trecho sem \"campo: valor\": " + citar(parte)); continue; }
        const chave = semAcento(kv[1]), valor = kv[2].trim();
        const campo = temChave(campos, chave) ? campos[chave] : null;
        if (!campo) { r.avisos.push("campo \"" + citar(kv[1].trim()) + "\" não reconhecido"); continue; }
        if (!valor) continue;
        if (campo === "prob" || campo === "imp") {
          const n = temChave(niveis, semAcento(valor)) ? niveis[semAcento(valor)] : null;
          if (n === null) r.avisos.push("nível \"" + citar(valor) + "\" não reconhecido (use alta, média ou baixa)");
          r[campo] = n;
        } else if (campo === "revisar") {
          const d = dataDeRisco(valor);
          if (!d) r.avisos.push("data \"" + citar(valor) + "\" inválida (use AAAA-MM-DD ou DD/MM/AAAA)");
          r.revisar = d;
        } else r[campo] = corta(valor);
      }
      out.push(r);
    }
    return out;
  }

  function avaliarRisco(r, regras, hoje) {
    const score = r.tipo === "risco" && r.prob && r.imp ? r.prob * r.imp : null, flags = [];
    const nivel = r.tipo !== "risco" ? null : score === null ? "indefinido" : score >= regras.riscos_limite_alto ? "alto" : score >= regras.riscos_limite_medio ? "medio" : "baixo";
    if (!r.dono) flags.push("sem dono");
    if (r.tipo === "risco" && nivel === "indefinido") flags.push("falta probabilidade ou impacto");
    if (r.tipo === "risco" && (nivel === "alto" || nivel === "medio") && !r.resposta) flags.push("sem resposta");
    if (r.revisar && r.revisar < hoje) flags.push("revisão vencida");
    return { ...r, score, nivel, flags };
  }

  /* Riscos de UM card (verso do card): os itens ja avaliados, os mais graves primeiro. */
  function riscosDoCard(desc, regras, agora) {
    const hoje = dataLocal(agora, regras);
    return parseRiscos(desc, regras).map((r) => avaliarRisco(r, regras, hoje)).sort((a, b) => (b.score || 0) - (a.score || 0) || b.flags.length - a.flags.length);
  }

  /* Registro do quadro: so projetos ATIVOS. matriz[prob-1][imp-1] = quantos riscos; "atencao" = altos ou com pendencia, os piores primeiro. */
  function registroDeRiscos(itens, regras, agora) {
    const hoje = dataLocal(agora, regras), max = regras.riscos_max_itens || 8, ativos = itens.filter((it) => projetoAtivo(it, regras));
    const todos = [], semRegistro = []; let comRegistro = 0;
    for (const it of ativos) {
      const lista = parseRiscos(it.card.desc, regras).map((r) => ({ ...avaliarRisco(r, regras, hoje), projeto: it.card.name, url: it.card.url }));
      if (lista.length) { comRegistro++; todos.push(...lista); } else semRegistro.push({ nome: it.card.name, url: it.card.url });
    }
    const riscos = todos.filter((r) => r.tipo === "risco"), matriz = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const porNivel = { alto: 0, medio: 0, baixo: 0, indefinido: 0 };
    for (const r of riscos) { porNivel[r.nivel]++; if (r.prob && r.imp) matriz[r.prob - 1][r.imp - 1]++; }
    const cont = (f) => todos.filter((r) => r.flags.includes(f)).length;
    const atencao = todos.filter((r) => r.nivel === "alto" || r.flags.length)
      .sort((a, b) => (b.score || 0) - (a.score || 0) || b.flags.length - a.flags.length || a.projeto.localeCompare(b.projeto) || a.texto.localeCompare(b.texto));
    const comAviso = todos.filter((r) => r.avisos.length).sort((a, b) => a.projeto.localeCompare(b.projeto) || a.texto.localeCompare(b.texto));
    return { ativos: ativos.length, comRegistro, semRegistro: semRegistro.sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, max), semRegistroTotal: semRegistro.length,
      linhasComAviso: comAviso.length, comAviso: comAviso.slice(0, max).map((r) => ({ projeto: r.projeto, url: r.url, texto: r.texto, avisos: r.avisos })), maisComAviso: Math.max(0, comAviso.length - max),
      riscos: riscos.length, premissas: todos.length - riscos.length, porNivel, matriz,
      semDono: cont("sem dono"), semResposta: cont("sem resposta"), revisaoVencida: cont("revisão vencida"), incompletos: cont("falta probabilidade ou impacto"),
      atencao: atencao.slice(0, max), atencaoTotal: atencao.length, mais: Math.max(0, atencao.length - max), maisSemRegistro: Math.max(0, semRegistro.length - max) };
  }

  /* ROADMAP (funcao opcional, so leitura): barras do "Inicio planejado" ao "Fim planejado" dos projetos ATIVOS numa janela de
   * roadmap_meses_atras meses para tras e roadmap_meses_adiante para a frente (mes atual incluso). Posicoes em % da janela
   * (left, width); marca o hoje e as datas do varejo. Projeto com so uma das datas aparece como marcador, com aviso; sem datas
   * vai para "semDatas"; fora da janela so e contado. Agrupa por fase (lista). Nada e escrito no Trello. */
  function roadmap(itens, regras, agora) {
    const hoje = dataLocal(agora, regras), r2 = (x) => Math.round(x * 100) / 100;
    const primeiro = (iso, n) => { const x = new Date(iso.slice(0, 7) + "-01T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
    const w0 = primeiro(hoje, -regras.roadmap_meses_atras), w1 = primeiro(hoje, regras.roadmap_meses_adiante + 1), dias = diasEntre(w0, w1);
    const pos = (iso) => Math.max(0, Math.min(100, 100 * diasEntre(w0, iso) / dias));
    const NOME_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    const meses = [];
    for (let m = w0; m < w1; m = primeiro(m, 1)) meses.push({ rotulo: NOME_MES[+m.slice(5, 7) - 1] + "/" + m.slice(2, 4), left: r2(pos(m)), width: r2(pos(primeiro(m, 1)) - pos(m)) });
    const varejo = Object.entries(regras.datas_varejo || {}).filter(([, d]) => d >= w0 && d < w1).sort((a, b) => (a[1] < b[1] ? -1 : 1))
      .map(([nome, d]) => ({ nome, data: d, pos: r2(pos(d)) }));
    const grupos = {}, semDatas = []; let fora = 0;
    const lerData = (v) => (v ? dataLocal(new Date(v), regras) : null);
    for (const it of itens) {
      if (!projetoAtivo(it, regras)) continue;
      const v = it.valores || {}, ini = lerData(v["Início planejado"]), fim = lerData(v["Fim planejado"]);
      const base = { nome: it.card.name, url: it.card.url };
      if (!ini && !fim) { semDatas.push(base); continue; }
      const avisos = [];
      if (!ini) avisos.push("falta o Início planejado"); else if (!fim) avisos.push("falta o Fim planejado");
      const invertida = ini && fim && ini > fim;
      if (invertida) avisos.push("início depois do fim");
      const [x0, x1] = invertida ? [fim, ini] : [ini || fim, fim || ini];
      if (x1 < w0 && fim && fim < hoje && !invertida) {      // MUITO atrasado (o prazo passou antes desta janela): nunca some, fica preso a borda esquerda
        avisos.push("prazo passou em " + dmCurto(fim) + "/" + fim.slice(2, 4) + ", antes desta janela");
        (grupos[it.listaNome || "—"] = grupos[it.listaNome || "—"] || []).push({ ...base, inicio: ini, fim, left: 0, width: 0.9, cortaEsq: true, cortaDir: false,
          marcador: true, atrasado: true, pct: progressoChecklists(it.checklists || [], regras), nivel: semaforo(it.alertas || [], regras), avisos, _x0: x0, _x1: x1 });
        continue;
      }
      if (x1 < w0 || x0 >= w1) { fora++; continue; }
      const left = pos(x0), direita = pos(somaDias(x1, 1));
      (grupos[it.listaNome || "—"] = grupos[it.listaNome || "—"] || []).push({ ...base, inicio: ini, fim, left: r2(left), width: r2(Math.max(0.9, direita - left)),
        cortaEsq: x0 < w0, cortaDir: somaDias(x1, 1) > w1, marcador: !ini || !fim, atrasado: !!fim && fim < hoje && !invertida,
        pct: progressoChecklists(it.checklists || [], regras), nivel: semaforo(it.alertas || [], regras), avisos, _x0: x0, _x1: x1 });
    }
    const ordem = [regras.motor.lista_execucao, regras.motor.lista_revisao];
    const rank = (n) => { const i = ordem.indexOf(String(n).trim().toLowerCase()); return i < 0 ? 99 : i; };
    let restante = regras.roadmap_max_linhas, mais = 0, total = 0;
    const lista = Object.keys(grupos).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((nome) => {
      const todos = grupos[nome].sort((a, b) => (a._x0 < b._x0 ? -1 : a._x0 > b._x0 ? 1 : a._x1 < b._x1 ? -1 : a._x1 > b._x1 ? 1 : a.nome.localeCompare(b.nome)));
      total += todos.length;
      const cabe = todos.slice(0, Math.max(0, restante)); restante -= cabe.length; mais += todos.length - cabe.length;
      return { nome, total: todos.length, itens: cabe.map(({ _x0, _x1, ...resto }) => resto) };
    }).filter((g) => g.itens.length);
    return { janela: { de: w0, ate: somaDias(w1, -1) }, hoje, hojePos: r2(pos(hoje)), meses, varejo, grupos: lista, total, mais, fora,
      semDatas: semDatas.sort((a, b) => a.nome.localeCompare(b.nome)) };
  }

  /* "Melhor semana": compara a area com o PROPRIO passado (retratos da Tendencia, % de projetos em Atencao). So devolve
   * boa noticia: piorar ou ficar igual devolve null (nao se mostra nada, para nao virar cobranca). tipo "melhor" = o melhor
   * momento da janela guardada; "melhor_desde" = o melhor desde uma data; "melhora" = caiu o % de Atencao na janela. */
  function melhorSemana(serie, regras) {
    const ord = (serie || []).filter((x) => x.n > 0).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    if (ord.length < 3) return null;
    const pct = (x) => 100 * x.v / x.n, ult = ord[ord.length - 1], p = pct(ult), ant = ord.slice(0, -1);
    const dm = (d) => d.slice(8, 10) + "/" + d.slice(5, 7), atencao = arredondaPar(p);
    if (!(p < pct(ant[ant.length - 1]))) {
      const t = direcaoTendencia(serie, regras);
      return t && t.direcao === "melhorando" ? melhoraTexto(t) : null;
    }
    if (ant.every((x) => pct(x) > p)) return { tipo: "melhor", texto: "Melhor momento dos últimos " + diasEntre(ord[0].d, ult.d) + " dias: " + atencao + "% dos projetos em Atenção." };
    const igual = ant.slice().reverse().find((x) => pct(x) <= p);
    return { tipo: "melhor_desde", texto: "Melhor momento desde " + dm(igual.d) + ": " + atencao + "% dos projetos em Atenção." };
  }
  function melhoraTexto(t) {
    const pp = arredondaPar(-t.delta_pp);
    return { tipo: "melhora", texto: pp + (pp === 1 ? " ponto a menos" : " pontos a menos") + " de projetos em Atenção em " + t.dias + (t.dias === 1 ? " dia" : " dias") + " (de " + arredondaPar(t.de) + "% para " + arredondaPar(t.para) + "%)." };
  }

  /* PAUTA DA REUNIAO: o que levar a reuniao semanal do quadro, so do que o Trello ja diz (nada inventado).
   * itens = [{card, listaNome, alertas, valores, prio}]. Secoes (cada projeto aparece em UMA so, exceto "Reconhecer"):
   * 1 Decidir hoje (P1), 2 Destravar (sem responsavel, sem comentario obrigatorio, sem interacao), 3 Prazo (atrasado/proximo),
   * 4 Reconhecer (quase pronto), 5 Cadastro (so a contagem), 6 Datas do varejo em risco. Listas cortadas em limite_lista_recolhida.
   * Devolve {titulo, resumo, secoes:[{titulo, linhas:[{texto, url}], resto}], texto} (texto = a pauta pronta para copiar). */
  function pautaReuniao(itens, regras, agora, nomeQuadro) {
    const ativos = itens.filter((i) => projetoAtivo(i, regras));
    const tem = (i, tipo) => (i.alertas || []).some((a) => a.tipo === tipo);
    const frases = (i, tipos) => ordenar((i.alertas || []).filter((a) => !tipos || tipos.includes(a.tipo)), regras).map(frase).join("; ");
    const pts = (i) => pontuar(i.alertas || [], i.valores, regras);
    const porPontos = (a, b) => pts(b) - pts(a) || a.card.name.localeCompare(b.card.name);
    const lim = regras.limite_lista_recolhida, usados = new Set(), secoes = [];
    const secao = (titulo, candidatos, texto, ordem, exclusiva) => {
      const lista = candidatos.filter((i) => !exclusiva || !usados.has(i.card.id)).sort(ordem || porPontos);
      if (!lista.length) return;
      if (exclusiva) lista.forEach((i) => usados.add(i.card.id));
      secoes.push({ titulo, linhas: lista.slice(0, lim).map((i) => ({ texto: i.card.name + " — " + texto(i), url: i.card.url })), resto: Math.max(0, lista.length - lim) });
    };
    const DESTRAVAR = ["sem_responsavel", "sem_comentario_pausado", "em_revisao_sem_comentario", "sem_interacao"];
    secao("Decidir hoje (P1 — Crítico)", ativos.filter((i) => i.prio && i.prio.prioridade === "P1"), (i) => frases(i) || "prazo curto e pouco andado", porPontos, true);
    secao("Destravar (precisa de ajuda)", ativos.filter((i) => DESTRAVAR.some((t) => tem(i, t))), (i) => frases(i, DESTRAVAR), porPontos, true);
    const diasAtraso = (i) => (i.alertas.find((a) => a.tipo === "atrasado") || {}).valor;
    const diasProximo = (i) => (i.alertas.find((a) => a.tipo === "prazo_proximo") || {}).valor;
    secao("Prazo", ativos.filter((i) => tem(i, "atrasado") || tem(i, "prazo_proximo")), (i) => frases(i, ["atrasado", "prazo_proximo"]),
      (a, b) => (tem(b, "atrasado") - tem(a, "atrasado")) || ((diasAtraso(b) || 0) - (diasAtraso(a) || 0)) || ((diasProximo(a) || 0) - (diasProximo(b) || 0)) || a.card.name.localeCompare(b.card.name), true);
    secao("Reconhecer (quase prontos)", ativos.filter((i) => tem(i, "quase_pronto")), (i) => frases(i, ["quase_pronto"]) + ": formalizar o encerramento");
    const semCadastro = ativos.filter((i) => tem(i, "cadastro_incompleto")).length;
    if (semCadastro) secoes.push({ titulo: "Cadastro", linhas: [{ texto: semCadastro + (semCadastro === 1 ? " projeto com cadastro incompleto" : " projetos com cadastro incompleto") + " (veja o Painel PMO)", url: null }], resto: 0 });
    const br = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
    const emRisco = datasVarejo(itens, regras, agora).filter((v) => v.emRisco > 0);
    if (emRisco.length) secoes.push({ titulo: "Datas do varejo em risco", resto: 0, linhas: emRisco.map((v) => ({ url: null,
      texto: v.nome + " (" + br(v.data) + ", " + v.diasUteis + (v.diasUteis === 1 ? " dia útil" : " dias úteis") + "): " + v.emRisco + " em risco — " +
        v.projetos.filter((p) => p.motivos.length).slice(0, 3).map((p) => p.nome).join("; ") })) });
    const nAtraso = ativos.filter((i) => tem(i, "atrasado")).length, nP1 = ativos.filter((i) => i.prio && i.prio.prioridade === "P1").length;
    const hoje = dataLocal(agora, regras);
    const titulo = "Pauta da reunião — " + (nomeQuadro || "quadro") + " — " + br(hoje);
    const resumo = ativos.length + " projetos ativos · " + nAtraso + " atrasados · " + nP1 + " crítico(s) (P1)";
    const linhasTxt = [titulo.toUpperCase(), resumo, ""];
    if (!secoes.length) linhasTxt.push("Nada pedindo decisão nem ajuda agora. Boa reunião para olhar o que vem pela frente.", "");
    secoes.forEach((s, n) => {
      linhasTxt.push((n + 1) + ") " + s.titulo);
      s.linhas.forEach((l) => linhasTxt.push("   - " + l.texto));
      if (s.resto) linhasTxt.push("   - … e mais " + s.resto);
      linhasTxt.push("");
    });
    linhasTxt.push("(Rascunho gerado só do Trello, pelas regras do PMO. Revise antes de usar.)");
    return { titulo, resumo, secoes, texto: linhasTxt.join("\n") };
  }

  /* RADAR: o que vai cair em alerta nos proximos aviso_antecipado_dias dias SE NINGUEM MEXER, no quadro inteiro (usa o mesmo
   * `antecipar` da tela do card: nao inventa limite). itens = [{card, listaNome, alertas, valores}]. Do mais proximo ao mais distante;
   * empate: quem vira P1 (atrasado) primeiro. Devolve {linhas:[{id, nome, url, lista, tipo, dias, texto, prioridade}], porTipo, total, janela}. */
  function radar(itens, regras, agora) {
    const linhas = [];
    for (const i of itens) {
      if (!projetoAtivo(i, regras)) continue;
      for (const a of antecipar(i.card, i.listaNome, i.alertas || [], null, agora, regras, (i.valores || {})["Fim planejado"] || null)) {
        linhas.push({ id: i.card.id, nome: i.card.name, url: i.card.url, lista: i.listaNome, tipo: a.tipo, dias: a.dias, texto: a.texto,
          prioridade: i.prio ? i.prio.prioridade : null });
      }
    }
    linhas.sort((a, b) => a.dias - b.dias || (b.tipo === "atrasado") - (a.tipo === "atrasado") || a.nome.localeCompare(b.nome));
    const porTipo = {};
    for (const l of linhas) porTipo[l.tipo] = (porTipo[l.tipo] || 0) + 1;
    return { linhas, porTipo, total: new Set(linhas.map((l) => l.id)).size, janela: regras.aviso_antecipado_dias };
  }

  /* HISTORICO DE REPLANEJAMENTOS: base = {e, i, f, h:[{e,i,f}...]} (h = planos congelados antes, do mais antigo ao mais novo).
   * Cada passo = um plano e o dia em que foi congelado; o ultimo passo e o plano congelado vigente. Devolve null sem replanejamento
   * (nada em h). escorregou = dias entre o Fim do 1o plano e o Fim de hoje (valores["Fim planejado"]; sem ele, o do ultimo plano). */
  function historicoPlano(base, valores, regras) {
    if (!base || !base.f || !(base.h || []).length) return null;
    const passos = [...base.h, { e: base.e, i: base.i || null, f: base.f }].map((p) => ({ congelado: p.e, fim: p.f }));
    const atual = (valores || {})["Fim planejado"] ? dataLocal(new Date(valores["Fim planejado"]), regras) : base.f;
    return { replanejamentos: passos.length - 1, passos, escorregou: diasEntre(passos[0].fim, atual), atual };
  }

  /* ATRASADAS / A VENCER: usa os alertas que o motor ja calculou. Atrasadas: mais dias de atraso primeiro; a vencer: mais
   * perto primeiro. "atrasado" valor 0 = vence hoje (conta como atrasada, como na regra). */
  function listaPrazos(itens) {
    const atrasadas = [], aVencer = [];
    for (const i of itens) {
      const a = i.alertas.find((x) => x.tipo === "atrasado"), p = i.alertas.find((x) => x.tipo === "prazo_proximo");
      const base = { nome: i.card.name, url: i.card.url, lista: i.listaNome, prioridade: i.prio ? i.prio.prioridade : null };
      if (a) atrasadas.push({ ...base, dias: a.valor });
      else if (p) aVencer.push({ ...base, dias: p.valor });
    }
    atrasadas.sort((x, y) => y.dias - x.dias || x.nome.localeCompare(y.nome));
    aVencer.sort((x, y) => x.dias - y.dias || x.nome.localeCompare(y.nome));
    return { atrasadas, aVencer };
  }
  // "sem prazo" exige os DOIS campos; diz so o que falta de fato (o texto generico cita os dois mesmo faltando um).
  function fazerEspecifico(tipo, card, camposDef, regras) {
    if (tipo === "sem_prazo") {
      const v = valoresCustomfield(card, camposDef);
      const falta = ["Início planejado", "Fim planejado"].filter((n) => !v[n]);
      if (falta.length === 1) return "Falta preencher: " + falta[0] + " (no próprio card).";
    }
    return regras.acao[tipo] || "";
  }
  function prontidao(card, listaNome, camposDef, checklists, agora, regras, atuais) {
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
    const jaAbertos = new Set((atuais || []).map((a) => a.tipo));     // ja listados como sinal do card: a tela nao repete o texto
    const faltam = ordenar(avaliarCard(card, prox, camposDef, checklists, agora, regras), regras)
      .filter((a) => !naoDependeDaFase.has(a.tipo))
      .map((a) => ({ tipo: a.tipo, frase: frase(a), fazer: fazerEspecifico(a.tipo, card, camposDef, regras), jaPendente: jaAbertos.has(a.tipo) }));
    return { proxima: rotulo, faltam };
  }

  return { roadmap, parseRiscos, registroDeRiscos, riscosDoCard, missoesDaArea, entregasDaSemana, retaFinal, destaqueDaSemana, melhorSemana, antecipar, prontidao, ordenarPorPrioridade, desvioPlano, historicoPlano, meuDia, projetoAtivo, pautaReuniao, radar, listaPrazos, diasUteis, marcos, datasVarejo, matrizImpactoEsforco, resumoArea, quadrosDoPortfolio, portfolioPermitido, indicadoresQuadro, explicar, regraDoAlerta, porquePrioridade, avaliarCard, semaforo, frase, ordenar, resumoQuadro, textoStatus, progressoChecklists, camposFaltando,
    checklistsDeBadges, pontuar, ondeAtuar, abaInicialMeus, valoresCustomfield, linhaDoTempo, prioridade, riscoAntecipado, avaliarProjeto, cargaDaEquipe, semEvidencia,
    retrato, registrarRetrato, tamanhoGuardado, direcaoTendencia, dataLocal, diasEntre };
});
