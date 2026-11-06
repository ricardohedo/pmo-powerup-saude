/* PAINEIS PMO: blocos (contador, pizza, barras, tabela) que cada pessoa monta sobre os projetos do quadro aberto.
 * Os numeros saem do MESMO motor do Power-Up (alertas, prioridade, risco, semaforo); aqui nao mora regra de negocio:
 * limites vem do regras.json (paineis_max_blocos, paineis_max_linhas, paineis_max_caracteres).
 * Guarda so a CONFIGURACAO dos blocos (nao os dados dos cards) no armazenamento do proprio Power-Up, escopo quadro/privado
 * (so a pessoa que montou ve). Nunca escreve em cards, listas, etiquetas, membros nem comentarios do Trello.
 * Funciona no navegador (window.PmoPaineis) e no node (module.exports) para os testes. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica(require("./motor.js"));
  else raiz.PmoPaineis = fabrica(raiz.PmoMotor);
})(typeof self !== "undefined" ? self : this, function (M) {
  const CHAVE_PAINEIS = "pmo_paineis_v1";
  const TIPOS = { contador: "Contador", pizza: "Gráfico de pizza", barras: "Gráfico de barras", tabela: "Tabela de projetos" };
  const CAMPOS = { lista: "Lista (fase)", responsavel: "Responsável", prioridade: "Prioridade (P1 a P4)", semaforo: "Semáforo",
    alerta: "Sinal de alerta", etiqueta: "Etiqueta", risco: "Risco antecipado", prazo: "Faixa de prazo", atividade: "Atividade do card" };
  const ROT_SEMAFORO = { vermelho: "Atenção", amarelo: "De olho", verde: "Em dia" };
  const SEM_VALOR = "(sem valor)";
  const MAX_TITULO = 40, MAX_FILTRO = 40, MAX_GRUPOS = 8;        // limites de tela, nao regra de negocio

  /* ---- dados: um item do motor -> uma linha plana ---- */
  function linhaDoItem(it, regras, membros, agora) {
    const alertas = it.alertas || [], valores = it.valores || {}, hoje = agora || new Date();
    const atr = alertas.find((a) => a.tipo === "atrasado");
    return {
      nome: it.card.name, url: it.card.url, lista: it.listaNome || "",
      ativo: M.projetoAtivo(it, regras),
      responsaveis: (it.card.idMembers || []).map((id) => (membros && membros[id]) || "Sem nome"),
      prioridade: (it.prio && it.prio.prioridade) || null, risco: (it.prio && it.prio.risco) || null,
      semaforo: M.semaforo(alertas, regras), alertas: alertas.map((a) => a.tipo),
      etiquetas: (it.card.labels || []).map((l) => ((l && l.name) || "").trim()).filter(Boolean),
      atraso: atr && Number.isInteger(atr.valor) ? atr.valor : null, fim: valores["Fim planejado"] || null,
      faixaPrazo: faixaDoPrazo(valores["Fim planejado"], regras, hoje), faixaAtividade: faixaDaAtividade(it.card.dateLastActivity, regras, hoje),
    };
  }

  /* Periodos prontos (limites do regras.json: dias_prazo_proximo, dias_marcos, dias_sem_interacao). Dias de calendario na data local do PMO. */
  function faixaDoPrazo(fimIso, regras, agora) {
    if (!fimIso) return "Sem prazo";
    const dias = M.diasEntre(M.dataLocal(agora, regras), M.dataLocal(new Date(fimIso), regras));
    if (dias < 0) return "Atrasado";
    if (dias === 0) return "Vence hoje";
    if (dias <= regras.dias_prazo_proximo) return "Próximos " + regras.dias_prazo_proximo + " dias";
    if (dias <= regras.dias_marcos) return "Até " + regras.dias_marcos + " dias";
    return "Depois";
  }

  function faixaDaAtividade(ultimaIso, regras, agora) {
    if (!ultimaIso) return "Sem registro";
    const dias = Math.floor((agora - new Date(ultimaIso)) / 86400000);
    return dias >= regras.dias_sem_interacao ? "Parado há " + regras.dias_sem_interacao + "+ dias" : "Mexido nos últimos " + regras.dias_sem_interacao + " dias";
  }

  /* valores de um campo numa linha (sempre lista; vazio vira SEM_VALOR). Um projeto com 2 responsaveis conta nos dois. */
  function valoresDoCampo(l, campo, regras) {
    let v;
    if (campo === "lista") v = [l.lista];
    else if (campo === "responsavel") v = l.responsaveis;
    else if (campo === "prioridade") v = l.prioridade ? [l.prioridade + " " + regras.rotulo_prioridade[l.prioridade]] : [];
    else if (campo === "semaforo") v = [ROT_SEMAFORO[l.semaforo]];
    else if (campo === "alerta") v = l.alertas.map((t) => ((regras.grupos && regras.grupos[t]) || t).replace(/^[^\p{L}\p{N}]+/u, "").trim());   // sem o emoji do rotulo
    else if (campo === "etiqueta") v = l.etiquetas;
    else if (campo === "risco") v = l.risco ? [regras.rotulo_risco[l.risco]] : [];
    else if (campo === "prazo") v = [l.faixaPrazo];
    else if (campo === "atividade") v = [l.faixaAtividade];
    else v = [];
    v = v.filter((x) => x !== "" && x != null);
    return v.length ? v : [SEM_VALOR];
  }

  const igual = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  function passa(l, w, regras) {
    if (w.ativos !== false && !l.ativo) return false;
    if (w.filtro && w.filtro.campo) {
      const tem = valoresDoCampo(l, w.filtro.campo, regras).some((x) => igual(x, w.filtro.valor));
      if (w.filtro.nega ? tem : !tem) return false;
    }
    return true;
  }

  const ordemTabela = (a, b) => (a.prioridade || "P9").localeCompare(b.prioridade || "P9") || (b.atraso || 0) - (a.atraso || 0) ||
    a.nome.localeCompare(b.nome);

  /* ---- calculo de um bloco ---- */
  function calcular(w, linhas, regras) {
    const base = linhas.filter((l) => passa(l, w, regras));
    const r = { id: w.id, titulo: w.titulo, tipo: w.tipo, total: base.length };
    if (w.tipo === "contador") {
      r.valor = base.length; r.linhas = base;
      if (w.meta) { r.meta = w.meta; r.ok = w.meta.sentido === "pelo_menos" ? base.length >= w.meta.valor : base.length <= w.meta.valor; }
    } else if (w.tipo === "tabela") {
      r.linhas = [...base].sort(ordemTabela).slice(0, regras.paineis_max_linhas); r.mais = Math.max(0, base.length - r.linhas.length);
    } else {                                        // pizza e barras: agrupa por um campo
      const grupos = new Map();
      for (const l of base) for (const v of new Set(valoresDoCampo(l, w.campo, regras))) {
        if (!grupos.has(v)) grupos.set(v, []);
        grupos.get(v).push(l);
      }
      let partes = [...grupos].map(([rotulo, ls]) => ({ rotulo, valor: ls.length, linhas: ls }))
        .sort((a, b) => b.valor - a.valor || (a.rotulo === SEM_VALOR) - (b.rotulo === SEM_VALOR) || a.rotulo.localeCompare(b.rotulo));   // empate: "(sem valor)" por ultimo
      if (partes.length > MAX_GRUPOS) {              // o resto vira "Outros" (so as linhas distintas)
        const resto = partes.slice(MAX_GRUPOS - 1), ls = [...new Set(resto.flatMap((p) => p.linhas))];
        partes = partes.slice(0, MAX_GRUPOS - 1).concat([{ rotulo: "Outros", valor: ls.length, linhas: ls }]);
      }
      r.campo = w.campo; r.partes = partes;
    }
    return r;
  }

  /* ---- configuracao: valida e normaliza (nunca confia no que veio do armazenamento) ---- */
  function normalizar(w) {
    const x = w || {};
    if (!TIPOS[x.tipo]) return { ok: false, erro: "Tipo de bloco desconhecido." };
    const out = { id: String(x.id || ("w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5))).slice(0, 14),
      tipo: x.tipo, titulo: String(x.titulo || TIPOS[x.tipo]).trim().slice(0, MAX_TITULO) || TIPOS[x.tipo] };
    if (x.tipo === "pizza" || x.tipo === "barras") out.campo = CAMPOS[x.campo] ? x.campo : "lista";
    if (x.ativos === false) out.ativos = false;
    if (x.filtro && CAMPOS[x.filtro.campo] && String(x.filtro.valor || "").trim()) {
      out.filtro = { campo: x.filtro.campo, valor: String(x.filtro.valor).trim().slice(0, MAX_FILTRO) };
      if (x.filtro.nega) out.filtro.nega = true;
    }
    if (x.tipo === "contador" && x.meta && Number.isFinite(Number(x.meta.valor)) && Number(x.meta.valor) >= 0) {
      out.meta = { sentido: x.meta.sentido === "pelo_menos" ? "pelo_menos" : "ate", valor: Math.floor(Number(x.meta.valor)) };
    }
    return { ok: true, widget: out };
  }

  /* Painel que aparece enquanto a pessoa ainda nao montou o dela (nao e gravado ate ela mexer). Sem limite de regra: so contagens. */
  function padrao() {
    return [
      { id: "p1", tipo: "contador", titulo: "Projetos ativos" },
      { id: "p2", tipo: "contador", titulo: "Atrasados", filtro: { campo: "alerta", valor: "Atrasado" } },
      { id: "p3", tipo: "pizza", titulo: "Semáforo dos projetos", campo: "semaforo" },
      { id: "p4", tipo: "barras", titulo: "Projetos por fase", campo: "lista" },
      { id: "p5", tipo: "barras", titulo: "Projetos por responsável", campo: "responsavel" },
      { id: "p6", tipo: "tabela", titulo: "Prioridade P1", filtro: { campo: "prioridade", valor: "P1 Crítico" } },
    ].map((w) => normalizar(w).widget);
  }

  /* Caracteres que a lista ocupa no armazenamento (o conector grava texto e o Trello serializa de novo: codificacao dupla). */
  const tamanho = (lista) => JSON.stringify(JSON.stringify(lista)).length;

  function validarLista(lista, regras) {
    if (lista.length > regras.paineis_max_blocos) return "No máximo " + regras.paineis_max_blocos + " blocos por quadro.";
    if (tamanho(lista) > regras.paineis_max_caracteres) return "Os blocos passaram do espaço guardado no Trello; remova algum.";
    return null;
  }

  /* ---- armazenamento (unica escrita deste Power-Up nos Paineis: a configuracao, escopo quadro/privado) ---- */
  async function ler(t) {
    let txt;
    try { txt = await t.get("board", "private", CHAVE_PAINEIS); } catch (e) { return { lista: padrao(), salvo: false }; }
    try {
      const bruto = typeof txt === "string" ? JSON.parse(txt || "null") : txt;
      if (!Array.isArray(bruto)) return { lista: padrao(), salvo: false };
      return { lista: bruto.map((w) => normalizar(w)).filter((n) => n.ok).map((n) => n.widget), salvo: true };
    } catch (e) { return { lista: padrao(), salvo: false }; }
  }

  async function salvar(t, lista, regras) {
    const erro = validarLista(lista, regras);
    if (erro) return { ok: false, erro };
    try {
      await t.set("board", "private", CHAVE_PAINEIS, JSON.stringify(lista));
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: "Não consegui gravar (" + String((e && e.message) || e).slice(0, 80) + ")." };
    }
  }

  /* ---- desenho (strings HTML/SVG; tudo escapado) ---- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PALETA = ["#0c66e4", "#2e7d4f", "#b8860b", "#c0392b", "#6f42c1", "#0aa6a6", "#d9730d", "#5e6c84"];
  const COR_FIXA = { "Atenção": "#c0392b", "De olho": "#b8860b", "Em dia": "#2e7d4f", "(sem valor)": "#97a0af", "Outros": "#97a0af" };
  const corDe = (rotulo, i) => COR_FIXA[rotulo] || (/^P1/.test(rotulo) ? "#c0392b" : /^P2/.test(rotulo) ? "#d9730d" : /^P3/.test(rotulo) ? "#b8860b" :
    /^P4/.test(rotulo) ? "#2e7d4f" : PALETA[i % PALETA.length]);

  function svgPizza(partes, tam) {
    const total = partes.reduce((s, p) => s + p.valor, 0);
    if (!total) return "<p class='nota'>Sem dados.</p>";
    const c = tam / 2, r = c - 3;
    let ang = -Math.PI / 2, fatias = "";
    partes.forEach((p, i) => {
      if (!p.valor) return;
      if (p.valor === total) { fatias += "<circle cx='" + c + "' cy='" + c + "' r='" + r + "' fill='" + corDe(p.rotulo, i) + "'/>"; return; }
      const fim = ang + 2 * Math.PI * p.valor / total;
      const x1 = c + r * Math.cos(ang), y1 = c + r * Math.sin(ang), x2 = c + r * Math.cos(fim), y2 = c + r * Math.sin(fim);
      fatias += "<path d='M" + c + "," + c + " L" + x1.toFixed(1) + "," + y1.toFixed(1) + " A" + r + "," + r + " 0 " + (fim - ang > Math.PI ? 1 : 0) + " 1 " +
        x2.toFixed(1) + "," + y2.toFixed(1) + " Z' fill='" + corDe(p.rotulo, i) + "'/>";
      ang = fim;
    });
    return "<svg width='" + tam + "' height='" + tam + "' viewBox='0 0 " + tam + " " + tam + "'>" + fatias + "</svg>";
  }

  function htmlBarras(partes, ix) {            // ix (opcional) = indice do bloco: liga cada linha ao "ver dados" da tela
    const maior = Math.max(1, ...partes.map((p) => p.valor));
    return partes.map((p, i) => "<div class='lb'" + (ix === undefined ? "" : " data-ver='" + ix + ":" + i + "'") + "><span class='lbr' title='" + esc(p.rotulo) + "'>" + esc(p.rotulo) + "</span><span class='barra'><i style='width:" +
      Math.max(2, Math.round(100 * p.valor / maior)) + "%;background:" + corDe(p.rotulo, i) + "'></i></span><b>" + p.valor + "</b></div>").join("");
  }

  return { CHAVE_PAINEIS, TIPOS, CAMPOS, SEM_VALOR, linhaDoItem, valoresDoCampo, calcular, normalizar, padrao, tamanho, validarLista, ler, salvar,
    esc, corDe, svgPizza, htmlBarras };
});
