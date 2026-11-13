/* Monta o HTML da secao a partir da resposta do backend. Funcoes PURAS (sem DOM, sem rede): testadas em node.
 * Todo texto que veio do Trello (titulo, escopo, nome de area) passa por esc() antes de virar HTML. */
(function (root) {
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => MAPA[c]);
  // Classe de cor so sai desta tabela (nunca de texto vindo do backend).
  const SIT = {
    atrasado: { cor: "red", txt: "Atrasado" }, no_prazo: { cor: "green", txt: "No prazo" },
    concluido: { cor: "green", txt: "Concluído" }, sem_prazo: { cor: "yellow", txt: "Sem prazo" },
    arquivado: { cor: "gray", txt: "Arquivado" },
  };
  const sit = (c) => SIT[c] || { cor: "gray", txt: "Sem informação" };

  function dataBr(iso) {
    if (!iso) { return "sem prazo"; }
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "sem prazo" : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }

  function barra(pct) {
    if (pct == null) { return '<small>sem checklist</small>'; }
    const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    return '<div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + n + '"><div style="width:' + n + '%"></div></div><small>' + n + '% concluído</small>';
  }

  // Escopo estruturado do backend ("• item", "# subtitulo", texto): vira lista e subtitulos. Tudo passa por esc().
  function escopoHtml(texto) {
    const linhas = String(texto == null ? "" : texto).split("\n").filter((l) => l.trim());
    let h = "", aberta = false;
    const fecha = () => { if (aberta) { h += "</ul>"; aberta = false; } };
    linhas.forEach((l) => {
      if (l.indexOf("• ") === 0) { if (!aberta) { h += "<ul>"; aberta = true; } h += "<li>" + esc(l.substring(2)) + "</li>"; return; }
      fecha();
      if (l.indexOf("# ") === 0) { h += "<h5>" + esc(l.substring(2)) + "</h5>"; }
      else if (l === "…") { h += "<small>… (escopo cortado: o resto está no projeto de origem)</small>"; }
      else { h += "<p>" + esc(l) + "</p>"; }
    });
    fecha();
    return h;
  }

  // Tela de "Depende de outra area": uma caixinha por area (varias de uma vez). Tudo escapado.
  function htmlEscolhaAreas(areas) {
    const itens = (areas || []).map((a) => '<label class="ar"><input type="checkbox" value="' + esc(a.key) + '"> ' + esc(a.nome) + "</label>").join("");
    return "<small>Marque as áreas que vão executar atividades para este projeto. Cada uma verá só o escopo e o andamento; " +
      "o seu quadro continua privado.</small>" + itens +
      "<button class='mod-primary' id='ok'>Criar vínculos</button><div id='msg' aria-live='polite'></div><small>Não feche esta janela até terminar.</small>";
  }

  // Resultado por area: [{ nome, ok, jaExistia, erro }] -> linhas de texto (uma por area).
  function resumoVinculos(res) {
    return (res || []).map((r) => {
      if (!r.ok) { return '<div class="erro">✗ ' + esc(r.nome) + ": " + esc(r.erro || "não foi possível criar o vínculo.") + "</div>"; }
      return "<small>" + (r.jaExistia ? "• " + esc(r.nome) + ": o vínculo já existia." : "✓ " + esc(r.nome) + ": criado no Backlog dela." + (r.doModelo === false ? " (sem os checklists do modelo)" : "")) + "</small>";
    }).join("<br>");
  }

  function etiqueta(codigo) { const s = sit(codigo); return '<span class="t ' + s.cor + '">' + esc(s.txt) + "</span>"; }

  function itens(o, vazio) {
    if (!o.itens) { return vazio || "A origem ainda não tem checklist."; }
    return esc(o.feitos) + " de " + esc(o.itens) + " itens concluídos";
  }

  // Linhas "uma por area" com o andamento dos ganchos (so contagens). Usado na origem e no card encadeado.
  function linhasDestinos(destinos) {
    return (destinos || []).map((d) => {
      if (d.indisponivel) { return '<div class="l"><small>Não foi possível ler esta área agora. Tente de novo em instantes (botão Atualizar).</small></div>'; }
      if (d.removido) {
        return '<div class="l"><small>O card na outra área foi removido.</small><br><button data-acao="desfazer" data-id="' + esc(d.cardId) + '" aria-label="Desfazer o vínculo com esta área">Desfazer</button></div>';
      }
      return '<div class="l"><b>' + esc(d.area) + "</b> " + etiqueta(d.situacao) +
        barra(d.pct) + "<br><small>" + itens(d, "Esta área ainda não montou o checklist.") + " · Prazo: " + esc(dataBr(d.prazo)) + "</small>" +
        '<br><button data-acao="desfazer" data-id="' + esc(d.cardId) + '" aria-label="Desfazer o vínculo com esta área">Desfazer</button></div>';
    }).join("");
  }

  // Card encadeado: este card e gancho de um projeto E tambem foi vinculado a outras areas.
  function blocoFilhos(s) {
    if (!s.destinos || !s.destinos.length) { return ""; }
    return "<h4>Áreas que executam atividades para este card</h4>" + linhasDestinos(s.destinos) +
      "<small>Você vê só o andamento. Quem cria e executa as atividades é a área de destino.</small>";
  }

  // Medida de espera (so numeros do backend): ha quantos dias o pedido existe e ha quantos a origem esta sem atividade.
  function dias(n) { return esc(n) + (n === 1 ? " dia" : " dias"); }
  function espera(s, o) {
    const p = Number.isInteger(s.pedidoDias) && s.pedidoDias >= 0, m = Number.isInteger(o.paradoDias) && o.paradoDias >= 0;
    if (!p && !m) { return ""; }
    return "<br><small>" + (p ? "Pedido há " + dias(s.pedidoDias) : "") + (p && m ? " · " : "") +
      (m ? "origem sem atividade há " + dias(o.paradoDias) : "") + "</small>";
  }

  function htmlDestino(s) {
    if (s.origemRemovida) {
      return '<div class="l">O projeto de origem foi removido ou arquivado fora do vínculo.</div>' + blocoFilhos(s) +
        '<button data-acao="desfazer">Desfazer este vínculo</button>';
    }
    const o = s.origem || {};
    return '<div class="l"><b>' + esc(o.titulo) + "</b> " + etiqueta(o.situacao) +
      "<br><small>Projeto da área: " + esc(s.areaOrigem) + "</small>" +
      (s.donoRaiz && s.donoRaiz !== s.areaOrigem ? "<br><small>Dono do projeto: <b>" + esc(s.donoRaiz) + "</b> (você está no nível " + esc(Number(s.nivel) + 1) + " da cadeia)</small>" : "") +
      "<h4>Escopo</h4>" + (o.escopo ? escopoHtml(o.escopo) : "<small>Não encontrei a seção \"Escopo\" na descrição do projeto de origem (ou ela está vazia). Peça ao dono do projeto para preenchê-la.</small>") +
      "<h4>Andamento da origem</h4>" + barra(o.pct) + "<br><small>" + itens(o) + " · Prazo: " + esc(dataBr(o.prazo)) + "</small>" + espera(s, o) + "</div>" +
      "<small>Você vê só este resumo. O quadro da área de origem continua privado. As atividades de execução da sua área ficam neste card.</small>" +
      blocoFilhos(s) +
      '<br><button data-acao="desfazer">Desfazer este vínculo</button>';
  }

  function htmlOrigem(s) {
    return "<h4>Áreas que executam atividades para este projeto</h4>" + linhasDestinos(s.destinos) +
      "<small>Você vê só o andamento. Quem cria e executa as atividades é a área de destino.</small>";
  }

  function htmlNenhum() {
    return "<small>Este card não depende de outra área. Se precisar de atividades de outra área, use o botão " +
      "<b>Depende de outra área</b> na linha de botões do card.</small>";
  }

  function htmlErro(msg) { return '<div class="l erro">' + esc(msg) + "</div>"; }

  function htmlPorPapel(s) {
    if (s.papel === "destino") { return htmlDestino(s); }
    if (s.papel === "origem") { return htmlOrigem(s); }
    return htmlNenhum();
  }

  const api = { esc, htmlEscolhaAreas, resumoVinculos, escopoHtml, dataBr, barra, htmlDestino, htmlOrigem, htmlNenhum, htmlErro, htmlPorPapel };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  root.InterdepRender = api;
})(typeof window !== "undefined" ? window : globalThis);
