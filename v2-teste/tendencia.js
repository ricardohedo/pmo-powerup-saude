/* Tendencia ("a area esta melhorando?"): guarda UM retrato por dia no armazenamento do proprio Power-Up.
 *
 * ESTE e o unico arquivo do Power-Up que escreve, e SO no armazenamento do Power-Up neste quadro (escopo "board",
 * visibilidade "shared", uma unica chave). Nunca escreve em cards, listas, etiquetas, membros nem comentarios do Trello. O teste
 * tests/test_powerup.py barra qualquer outro uso de escrita e exige exatamente este formato.
 * O retrato e pequeno ({d, n, v, a, p1, atr, r}, no maximo tendencia_dias dias): cerca de 2 KB.
 * Quando grava: na 1a abertura do quadro de cada dia (por qualquer pessoa com o Power-Up ligado) ou ao abrir "Tendencia".
 * Falha de escrita (ex.: quem abre so observa o quadro, ou o limite de armazenamento) nunca quebra o Power-Up. */
window.PmoTendencia = (function () {
  const CHAVE = "pmo_tendencia_v1";
  let jaTentou = false;

  async function ler(t) {
    const txt = await t.get("board", "shared", CHAVE);
    try { const s = typeof txt === "string" ? JSON.parse(txt || "[]") : (txt || []); return Array.isArray(s) ? s : []; } catch (e) { return []; }
  }

  /* Garante o retrato de hoje. q = PmoDados.quadro(t) ja lido (so e lido se faltar o retrato de hoje). */
  async function garantirHoje(t, quadro) {
    const regras = await PmoDados.regras();
    const agora = new Date();
    const hoje = PmoMotor.dataLocal(agora, regras);
    const serie = await ler(t);
    if (serie.some((x) => x.d === hoje)) return { serie, gravou: false, erro: null };
    const q = quadro || await PmoDados.quadro(t);
    const nova = PmoMotor.registrarRetrato(serie, PmoMotor.retrato(q.itens, regras, agora), regras);
    try {
      await t.set("board", "shared", CHAVE, JSON.stringify(nova));
      return { serie: nova, gravou: true, erro: null };
    } catch (e) {
      console.warn("[PMO Power-Up] nao consegui gravar o retrato do dia:", e);
      return { serie: nova, gravou: false, erro: String((e && e.message) || e).slice(0, 80) };
    }
  }

  /* Ao carregar o quadro: tenta uma vez por carregamento, sem travar nada e sem mostrar erro. */
  function automatico(t) {
    if (jaTentou) return;
    jaTentou = true;
    // Funcao opcional (pmo.toml, [powerup_funcoes]): desligada = nao grava NADA.
    PmoDados.regras().then((r) => (r.funcoes.tendencia ? garantirHoje(t) : null))
      .catch((e) => console.warn("[PMO Power-Up] tendencia:", e));
  }

  return { ler, garantirHoje, automatico };
})();
