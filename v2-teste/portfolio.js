/* Portfolio do PMO: le as areas pela API do Trello com o token do PROPRIO usuario (autorizado por ele, so leitura) e calcula
 * tudo no navegador com o mesmo motor. Nao grava nada (so GET), nao guarda dado em lugar nenhum: o que aparece some ao fechar.
 * Os erros nunca mostram a URL (ela leva o token). Descobre os quadros pelo nome (pmo.toml), sem IDs neste repositorio publico. */
window.PmoPortfolio = (function () {
  const API = "https://api.trello.com/1";

  async function get(caminho, params, chave, token) {
    const u = new URL(API + caminho);
    for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
    u.searchParams.set("key", chave); u.searchParams.set("token", token);
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error("HTTP " + r.status + " em " + caminho);
    return r.json();
  }

  async function quadros(chave, token, regras) {
    const bs = await get("/members/me/boards", { filter: "open", fields: "name,closed", organization: "true", organization_fields: "displayName" }, chave, token);
    return PmoMotor.quadrosDoPortfolio(bs, regras);
  }

  /* Uma area: 2 chamadas (quadro com listas e campos; cards com checklists). Devolve {nome, resumo} ou {nome, erro}. */
  async function lerArea(q, chave, token, regras, agora) {
    try {
      const [b, cards] = await Promise.all([
        get("/boards/" + q.id, { fields: "name", lists: "open", list_fields: "name", customFields: "true" }, chave, token),
        get("/boards/" + q.id + "/cards", { fields: "name,due,dateLastActivity,idList,closed,labels,idMembers,desc,shortUrl,badges",
          customFieldItems: "true", checklists: "all", checklist_fields: "name" }, chave, token)]);
      const nomes = {}; for (const l of b.lists || []) nomes[l.id] = l.name;
      for (const c of cards) c.url = c.shortUrl;
      const itens = PmoDados.itensDoBoard(cards, nomes, b.customFields || [], regras, agora);
      return { nome: q.nome, resumo: PmoMotor.resumoArea(itens, regras) };
    } catch (e) {
      return { nome: q.nome, erro: String((e && e.message) || e).slice(0, 80) };
    }
  }

  /* Le todas as areas com no maximo `paralelo` ao mesmo tempo (limite do Trello: 100 chamadas por 10 s por token). */
  async function lerTodas(lista, chave, token, regras, aoAndar, paralelo) {
    const agora = new Date(), saida = [];
    let prox = 0, feitas = 0;
    async function trabalhador() {
      while (prox < lista.length) {
        const i = prox++;
        saida[i] = await lerArea(lista[i], chave, token, regras, agora);
        aoAndar(++feitas, lista.length);
      }
    }
    await Promise.all(Array.from({ length: paralelo || 3 }, trabalhador));
    return saida;
  }

  return { quadros, lerTodas };
})();
