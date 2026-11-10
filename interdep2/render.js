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
    return '<div class="barra"><div style="width:' + n + '%"></div></div><small>' + n + '% concluído</small>';
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
      "<button class='mod-primary' id='ok'>Criar vínculos</button><div id='msg'></div>";
  }

  // Resultado por area: [{ nome, ok, jaExistia, erro }] -> linhas de texto (uma por area).
  function resumoVinculos(res) {
    return (res || []).map((r) => {
      if (!r.ok) { return '<div class="erro">✗ ' + esc(r.nome) + ": " + esc(r.erro || "não foi possível criar o vínculo.") + "</div>"; }
      return "<small>" + (r.jaExistia ? "• " + esc(r.nome) + ": o vínculo já existia." : "✓ " + esc(r.nome) + ": criado no Backlog dela.") + "</small>";
    }).join("<br>");
  }

  function etiqueta(codigo) { const s = sit(codigo); return '<span class="t ' + s.cor + '">' + esc(s.txt) + "</span>"; }

  function itens(o) {
    if (!o.itens) { return "A origem ainda não tem checklist."; }
    return esc(o.feitos) + " de " + esc(o.itens) + " itens concluídos";
  }

  function htmlDestino(s) {
    if (s.origemRemovida) {
      return '<div class="l">O projeto de origem foi removido ou arquivado fora do vínculo.</div>' +
        '<button data-acao="desfazer">Desfazer este vínculo</button>';
    }
    const o = s.origem || {};
    return '<div class="l"><b>' + esc(o.titulo) + "</b> " + etiqueta(o.situacao) +
      "<br><small>Projeto da área: " + esc(s.areaOrigem) + "</small>" +
      "<h4>Escopo</h4>" + (o.escopo ? escopoHtml(o.escopo) : "<small>A origem não descreveu o escopo.</small>") +
      "<h4>Andamento da origem</h4>" + barra(o.pct) + "<br><small>" + itens(o) + " · Prazo: " + esc(dataBr(o.prazo)) + "</small></div>" +
      "<small>Você vê só este resumo. O quadro da área de origem continua privado. As atividades de execução da sua área ficam neste card.</small>" +
      '<br><button data-acao="desfazer">Desfazer este vínculo</button>';
  }

  function htmlOrigem(s) {
    const linhas = (s.destinos || []).map((d) => {
      if (d.removido) {
        return '<div class="l"><small>O card na outra área foi removido.</small><br><button data-acao="desfazer" data-id="' + esc(d.cardId) + '">Desfazer</button></div>';
      }
      return '<div class="l"><b>' + esc(d.area) + "</b> " + etiqueta(d.situacao) +
        barra(d.pct) + "<br><small>" + itens(d) + " · Prazo: " + esc(dataBr(d.prazo)) + "</small>" +
        '<br><button data-acao="desfazer" data-id="' + esc(d.cardId) + '">Desfazer</button></div>';
    }).join("");
    return "<h4>Áreas que executam atividades para este projeto</h4>" + linhas +
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
