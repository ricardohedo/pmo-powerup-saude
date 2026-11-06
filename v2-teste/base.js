/* Linha de base ("congelar o plano"): guarda, POR CARD, o Inicio e o Fim planejados originais no armazenamento do proprio
 * Power-Up (escopo "card", visibilidade "shared", uma unica chave). So e gravado quando alguem clica em "Congelar plano".
 * Nunca escreve em cards, listas, etiquetas, membros nem comentarios do Trello; o teste tests/test_powerup.py exige
 * exatamente este formato de escrita (alem do da Tendencia). Funcao opcional: desligada em pmo.toml ([powerup_funcoes]). */
window.PmoBase = (function () {
  const CHAVE = "pmo_base_v1";

  async function ler(t) {
    const txt = await t.get("card", "shared", CHAVE);
    try { const b = typeof txt === "string" ? JSON.parse(txt || "null") : txt; return b && b.f ? b : null; } catch (e) { return null; }
  }

  /* ini/fim = AAAA-MM-DD do plano de HOJE. Recusa congelar sem Fim planejado. Devolve {ok, base|erro}. */
  async function congelar(t, hoje, ini, fim) {
    if (!fim) return { ok: false, erro: "Preencha o 'Fim planejado' no card antes de congelar o plano." };
    const base = { e: hoje, i: ini || null, f: fim };
    return gravar(t, base);
  }

  /* Remove a linha de base do card: grava "null" (ler() trata como sem plano). Uma so chamada de escrita no arquivo (gravar). */
  async function remover(t) { return gravar(t, null); }

  async function gravar(t, base) {
    try {
      await t.set("card", "shared", CHAVE, JSON.stringify(base));
      return { ok: true, base };
    } catch (e) {
      return { ok: false, erro: "Não consegui gravar (" + String((e && e.message) || e).slice(0, 80) + ")." };
    }
  }

  return { ler, congelar, remover };
})();
