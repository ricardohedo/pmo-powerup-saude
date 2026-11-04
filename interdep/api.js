/* Cliente do backend de interdependencia. O Power-Up nao escreve no Trello: so pede ao backend. */
window.Interdep = (function () {
  // URL do web app do Apps Script (preenchida apos o deploy). Backend so mexe nos quadros de teste.
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
  function sinal(v) {   // semaforo simples e explicavel
    if (v.arquivado) return { cor: "gray", txt: "Arquivado" };
    if (/conclu/i.test(v.lista)) return { cor: "green", txt: "Entregue" };
    if (v.atrasado) return { cor: "red", txt: "Atrasado" };
    if (/backlog|nova demanda/i.test(v.lista)) return { cor: "yellow", txt: "Ainda na fila" };
    return { cor: "green", txt: "Em andamento" };
  }
  const ORDEM = ["red", "yellow", "green", "gray"];
  function pior(vinculos) { return vinculos.map(sinal).sort((a, b) => ORDEM.indexOf(a.cor) - ORDEM.indexOf(b.cor))[0]; }
  return {
    chamar, esc, dataBr, pct, sinal, pior,
    status: (id) => chamar("status", { card: id }),
    areas: (id) => chamar("areas", { card: id }),
    quadro: (id) => chamar("quadro", { board: id }),
    vincular: (card, destino) => chamar("vincular", { card, destino }, true),
    desvincular: (card, copia) => chamar("desvincular", { card, copia }, true),
  };
})();
