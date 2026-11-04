/* Cliente do backend de interdependencia. O Power-Up nao escreve no Trello: so pede ao backend (Apps Script). */
window.Interdep = (function () {
  // URL do web app do Apps Script. Backend so mexe nos quadros de teste.
  const BASE = window.INTERDEP_API || "https://script.google.com/macros/s/AKfycbyCICuGXTwbBSTZWAxEioZputtWFB22eeuI8tg51n-Qhk23KEWbU3QArzKchmRkcjaMgg/exec";
  async function chamar(rota, params, escrita) {
    let r;
    if (escrita) {   // text/plain evita preflight de CORS, que o Apps Script nao responde
      r = await fetch(BASE, { method: "POST", body: JSON.stringify({ rota, ...params }) });
    } else {
      r = await fetch(BASE + "?" + new URLSearchParams({ rota, ...params }).toString());
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.erro) throw new Error(j.erro || "Falha " + r.status);
    return j;
  }
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => MAPA[c]);
  function dataBr(iso) { return iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "sem prazo"; }
  function pct(v) { return v.total ? Math.round((100 * v.feitos) / v.total) + "%" : "sem checklist"; }
  function sinal(v) {   // dependencia de CARD: semaforo simples e explicavel
    if (v.arquivado) return { cor: "gray", txt: "Arquivado" };
    if (/conclu/i.test(v.lista)) return { cor: "green", txt: "Entregue" };
    if (v.atrasado) return { cor: "red", txt: "Atrasado" };
    if (/backlog|nova demanda/i.test(v.lista)) return { cor: "yellow", txt: "Ainda na fila" };
    return { cor: "green", txt: "Em andamento" };
  }
  // dependencia de ITEM (codigo vem do backend: situacao_)
  const SIT = {
    atrasado: { cor: "red", ordem: 0 }, espelho_removido: { cor: "red", ordem: 1 }, area_desconhecida: { cor: "orange", ordem: 2 },
    sem_espelho: { cor: "yellow", ordem: 3 }, pendente: { cor: "yellow", ordem: 4 }, liberado: { cor: "green", ordem: 5 },
  };
  function sinalItem(i) { const s = SIT[i.situacao] || { cor: "gray", ordem: 9 }; return { cor: s.cor, txt: i.rotulo || i.situacao, ordem: s.ordem }; }
  const ORDEM = ["red", "orange", "yellow", "green", "gray"];
  function pior(sinais) { return sinais.slice().sort((a, b) => ORDEM.indexOf(a.cor) - ORDEM.indexOf(b.cor))[0]; }
  return {
    chamar, esc, dataBr, pct, sinal, sinalItem, pior,
    status: (id) => chamar("status", { card: id }),
    deps: (id) => chamar("deps", { card: id }),
    areas: (id) => chamar("areas", { card: id }),
    quadro: (id) => chamar("quadro", { board: id }),
    bloqueios: (id) => chamar("bloqueios", { board: id }),
    vincular: (card, destino) => chamar("vincular", { card, destino }, true),
    sincronizar: (card) => chamar("sincronizar", { card }, true),
    desvincular: (card, copia) => chamar("desvincular", { card, copia }, true),
  };
})();
