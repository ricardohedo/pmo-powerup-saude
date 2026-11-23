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

  // Texto padrao que o backend poe na secao ESCOPO do card gancho (descGancho_): enquanto for so isso, nao ha pedido escrito.
  const ESCOPO_PADRAO = /^Atividades da SUA área para este projeto/;

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

  // "A outra area ja tem este projeto num card?": gera um codigo de convite em vez de criar card novo. Tudo escapado.
  function htmlConvite(areas) {
    const op = (areas || []).map((a) => '<option value="' + esc(a.key) + '">' + esc(a.nome) + "</option>").join("");
    return "<hr><small><b>A outra área já tem este projeto num card?</b> Em vez de criar um card novo, gere um código. " +
      "O gestor dela cola o código no card que ele já tem (botão <b>Aceitar vínculo</b>) e o card dele continua dele.</small>" +
      '<select id="conv-area" aria-label="Área que já tem o card">' + op + "</select>" +
      '<button id="conv-ok">Gerar código de convite</button><div id="conv-msg" aria-live="polite"></div>';
  }

  // Resposta do convite: { codigo, area, expiraEm }. O codigo so tem letras e numeros, mas passa por esc() do mesmo jeito.
  function htmlCodigo(r) {
    return '<div class="l"><b class="cod">' + esc(r && r.codigo) + "</b><br><small>Vale até " + esc(dataBr(r && r.expiraEm)) +
      " e só serve para " + esc(r && r.area) + ". Mande ao gestor de lá.</small></div>";
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
  // Atividades da area que executa (so nome e se esta feita), numa lista que se abre sob demanda. Tudo escapado.
  function atividadesHtml(listas) {
    if (!listas || !listas.length) { return ""; }
    const total = listas.reduce((n, l) => n + (l.itens || []).length, 0);
    // Cada item mostra o prazo (data) ou "sem prazo"; pendente com prazo vencido leva a marca "atrasada".
    const corpo = listas.map((l) => "<h5>" + esc(l.lista) + "</h5><ul>" + (l.itens || []).map((i) =>
      "<li>" + (i.feito ? "✓ " : "○ ") + esc(i.nome) + ' <small>· ' + esc(dataBr(i.prazo)) + "</small>" +
      (i.atrasada ? ' <span class="t red">atrasada</span>' : "") + "</li>").join("") + "</ul>").join("");
    return "<details><summary>Ver as atividades (" + esc(total) + ")</summary>" + corpo + "</details>";
  }

  // O sufixo " (REAL)" e so nosso (tabela de quadros liberados): quem le a tela nao precisa dele.
  function nomeArea(n) { return String(n == null ? "" : n).replace(/\s*\(REAL\)\s*$/, ""); }

  // "Mais ações": o Desfazer fica recolhido para ninguem clicar sem querer. O texto da confirmacao continua em secao.html.
  function maisAcoes(d, nota) {
    return '<details class="mais"><summary>Mais ações</summary><button data-acao="desfazer"' + (d.existente ? ' data-existente="1"' : "") +
      (d.cardId ? ' data-id="' + esc(d.cardId) + '"' : "") + ' aria-label="Desfazer o vínculo com esta área">Desfazer o vínculo</button>' + (nota || "") + "</details>";
  }

  // Gancho que a area ainda nao tocou (nenhum item feito e sem prazo): "Aguardando", nao uma barra em 0% que parece atraso.
  const aguardando = (d) => !d.feitos && !d.prazo && d.situacao === "sem_prazo";

  // Ha quantos dias a area que apoia nao mexe no card (so numero do backend).
  function ultimaAtividade(d) {
    if (!Number.isInteger(d.paradoDias) || d.paradoDias < 0) { return ""; }
    return d.paradoDias === 0 ? "<br><small>A área mexeu no card hoje.</small>" : "<br><small>A área não mexe no card há " + dias(d.paradoDias) + ".</small>";
  }

  // somenteLeitura = linhas dos niveis de baixo da cadeia (sem Desfazer: quem esta na origem nao e membro desses quadros).
  function linhasDestinos(destinos, somenteLeitura) {
    return (destinos || []).map((d) => {
      if (d.indisponivel) { return '<div class="l"><small>Não foi possível ler esta área agora. Tente de novo em instantes (botão Atualizar).</small></div>'; }
      if (d.removido) {
        return '<div class="l"><small>O card na outra área foi removido.</small><br><button data-acao="desfazer" data-id="' + esc(d.cardId) + '" aria-label="Desfazer o vínculo com esta área">Desfazer</button></div>';
      }
      const corpo = aguardando(d)
        ? '<span class="t gray">Aguardando a área</span><br><small>' + (d.itens ? "Ela ainda não começou o plano deste projeto." : "Esta área ainda não montou o checklist.") + "</small>"
        : etiqueta(d.situacao) + barra(d.pct) + "<br><small>" + itens(d, "Esta área ainda não montou o checklist.") + " · Prazo: " + esc(dataBr(d.prazo)) + "</small>";
      return '<div class="l"><b>' + esc(nomeArea(d.area)) + "</b> " + corpo + ultimaAtividade(d) +
        atividadesHtml(d.atividades) +
        (somenteLeitura ? "" : "<br>" + maisAcoes(d)) +
        (d.filhos && d.filhos.length ? '<div class="sub"><small>↳ depende de:</small>' + linhasDestinos(d.filhos, true) + "</div>" : "") + "</div>";
    }).join("");
  }

  // Uma nota so (em vez de repetir em cada linha) quando alguma area ligou um card que ja tinha.
  function notaExistentes(destinos) {
    return (destinos || []).some((d) => d && d.existente)
      ? "<br><small>Nos cards que a área já tinha, desfazer só tira o vínculo: o card dela não é arquivado.</small>" : "";
  }

  // Card encadeado: este card e gancho de um projeto E tambem foi vinculado a outras areas.
  function blocoFilhos(s) {
    if (!s.destinos || !s.destinos.length) { return ""; }
    return "<h4>Quem apoia este card</h4>" + linhasDestinos(s.destinos) +
      "<small>Você vê só o andamento. O plano e as atividades são da área que apoia.</small>" + notaExistentes(s.destinos);
  }

  // Medida de espera (so numeros do backend): ha quantos dias o pedido existe e quando o projeto de origem teve atividade.
  function dias(n) { return esc(n) + (n === 1 ? " dia" : " dias"); }
  function espera(s, o) {
    const p = Number.isInteger(s.pedidoDias) && s.pedidoDias >= 0, m = Number.isInteger(o.paradoDias) && o.paradoDias >= 0;
    if (!p && !m) { return ""; }
    return "<br><small>" + (p ? (s.pedidoDias === 0 ? "Pedido hoje" : "Pedido há " + dias(s.pedidoDias)) : "") + (p && m ? " · " : "") +
      (m ? (o.paradoDias === 0 ? "projeto atualizado hoje" : "última atividade do projeto há " + dias(o.paradoDias)) : "") + "</small>";
  }

  function htmlDestino(s) {
    if (s.origemRemovida) {
      return '<div class="l">O projeto de origem foi removido ou arquivado fora do vínculo.</div>' + blocoFilhos(s) +
        '<button data-acao="desfazer">Desfazer este vínculo</button>';
    }
    const o = s.origem || {};
    const cadeia = s.donoRaiz && s.donoRaiz !== s.areaOrigem;
    return "<h4>Pedido de " + esc(nomeArea(s.areaOrigem)) + " para a sua área</h4>" +
      '<div class="l"><b>' + esc(o.titulo) + "</b> " + etiqueta(o.situacao) +
      (cadeia
        ? "<br><small>Dono do projeto: <b>" + esc(nomeArea(s.donoRaiz)) + "</b> (você está no nível " + esc(Number(s.nivel) + 1) + " da cadeia)</small>"
        : "<br><small>Dono do projeto: <b>" + esc(nomeArea(s.areaOrigem)) + "</b></small>") +
      (o.objetivo && o.situacao !== "arquivado" ? "<h4>Objetivo do projeto</h4><p>" + esc(o.objetivo) + "</p>" : "") +
      "<h4>Escopo do projeto</h4>" + (o.situacao === "arquivado"
        ? "<small>O projeto de origem foi arquivado, então o escopo não é mostrado. Fale com o dono do projeto (" + esc(s.donoRaiz || s.areaOrigem) + ") para saber se este pedido ainda vale.</small>"
        : o.escopo && ESCOPO_PADRAO.test(String(o.escopo).trim())
        ? "<small>A área <b>" + esc(s.areaOrigem) + "</b> ainda não escreveu o que precisa de você: o escopo ainda é o texto padrão do pedido. Peça a ela para preencher a seção ESCOPO do card dela com o que espera da sua área.</small>"
        : o.escopo ? escopoHtml(o.escopo) : "<small>Não encontrei a seção \"Escopo\" na descrição do projeto de origem (ou ela está vazia). Peça ao dono do projeto para preenchê-la.</small>") +
      (o.dependencias && o.situacao !== "arquivado" ? "<h4>Dependências registradas pelo dono</h4><p>" + esc(o.dependencias) + "</p>" : "") +
      "<h4>Andamento do projeto</h4>" + barra(o.pct) + "<br><small>" + itens(o) + " · Prazo: " + esc(dataBr(o.prazo)) + "</small>" + espera(s, o) + "</div>" +
      "<small>Você vê só um resumo do projeto: o quadro do dono continua privado. As atividades da sua área ficam neste card.</small>" +
      "<br><small>A área solicitante, e as áreas acima dela na cadeia do projeto, veem o <b>nome e o andamento das atividades</b> dos checklists deste card, menos o Início do Projeto (não veem comentários, anexos nem membros). Planeje e execute normalmente: Planejamento, Execução, Validação etc.</small>" +
      blocoFilhos(s) +
      "<br>" + maisAcoes({ existente: s.existente }, s.existente ? "<br><small>Este é um card que a sua área já tinha: desfazer só tira o vínculo, o card não é arquivado.</small>" : "");
  }

  // Convites de codigo ainda validos (so o dono ve): codigo, area e validade. Aceito ou vencido nao vem do backend.
  function convitesHtml(convites) {
    if (!convites || !convites.length) { return ""; }
    return "<h4>Convites pendentes</h4>" + convites.map((c) =>
      '<div class="l"><b>' + esc(nomeArea(c.area)) + '</b> · código <b class="cod">' + esc(c.codigo) + "</b><br><small>Ainda não foi aceito. Vale até " +
      esc(dataBr(c.expiraEm)) + ". Gerar outro código para esta área invalida este.</small></div>").join("");
  }

  // Aviso ao DONO quando as areas que apoiam nao estao vendo o escopo (vazio, ausente ou comecando por subtitulo).
  function avisoEscopoVazio(v) {
    return v && v.escopoVazio
      ? '<div class="l aviso"><b>⚠ As áreas que apoiam não estão vendo o escopo do projeto.</b><br><small>A seção ESCOPO do seu card está vazia ou começa direto por um subtítulo. ' +
        "Escreva uma frase de abertura logo abaixo do título ESCOPO.</small></div>" : "";
  }

  // "Ver o que as areas veem do seu projeto": o mesmo recorte que elas recebem (objetivo, escopo e dependencias). Tudo escapado.
  function visaoHtml(v) {
    if (!v) { return ""; }
    const corpo = (v.objetivo ? "<h5>Objetivo</h5><p>" + esc(v.objetivo) + "</p>" : "") +
      "<h5>Escopo</h5>" + (v.escopo ? escopoHtml(v.escopo) : "<small>Vazio: as áreas não veem nada aqui.</small>") +
      (v.dependencias ? "<h5>Dependências</h5><p>" + esc(v.dependencias) + "</p>" : "");
    return "<details><summary>Ver o que as áreas veem do seu projeto</summary>" + corpo + "</details>";
  }

  function htmlOrigem(s) {
    const temDestinos = s.destinos && s.destinos.length;
    return avisoEscopoVazio(s.visao) + convitesHtml(s.convites) +
      (temDestinos
        ? "<h4>Quem apoia este projeto</h4>" + linhasDestinos(s.destinos) +
          "<small>Você vê só o andamento. O plano e as atividades são da área que apoia.</small>" + notaExistentes(s.destinos)
        : "") + visaoHtml(s.visao);
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

  const api = { esc, htmlEscolhaAreas, htmlConvite, htmlCodigo, resumoVinculos, escopoHtml, dataBr, barra, htmlDestino, htmlOrigem, htmlNenhum, htmlErro, htmlPorPapel };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  root.InterdepRender = api;
})(typeof window !== "undefined" ? window : globalThis);
