/* Cliente do backend (Apps Script). O Power-Up NAO fala com a API do Trello e NAO escreve em quadro:
 * so pede ao backend, levando o token do PROPRIO usuario (o backend confere quem e e se e membro do quadro).
 * O POST vai como texto simples (JSON em string) para nao gerar preflight de CORS, que o Apps Script nao responde. */
window.Interdep2 = (function () {
  const cfg = window.INTERDEP2 || {};

  function erro(msg, codigo) { const e = new Error(msg); e.codigo = codigo; return e; }
  function configurado() { return !!(cfg.API_URL && cfg.APP_KEY); }

  async function token(t) {
    const api = t.getRestApi();
    if (!(await api.isAuthorized())) { throw erro("É preciso autorizar o Power-Up.", "sem_autorizacao"); }
    const tk = await api.getToken();
    if (!tk) { throw erro("É preciso autorizar o Power-Up.", "sem_autorizacao"); }
    return tk;
  }

  // Abre a janela de autorizacao do Trello (so le quem a pessoa e; escopo "read"). Precisa de um clique do usuario.
  async function autorizar(t) { return t.getRestApi().authorize({ scope: "read", expiration: "30days" }); }

  async function chamar(t, corpo) {
    if (!configurado()) { throw erro("Power-Up ainda não configurado.", "sem_config"); }
    const tk = await token(t);
    let r;
    try {
      r = await fetch(cfg.API_URL, { method: "POST", body: JSON.stringify(Object.assign({}, corpo, { token: tk })) });
    } catch (e) { throw erro("Não consegui falar com o servidor do PMO.", "rede"); }
    const j = await r.json().catch(() => ({}));
    if (!j || !j.ok) { throw erro((j && j.erro) || "Falha " + r.status, (j && j.codigo) || r.status); }
    return j;
  }

  return {
    configurado, autorizar, chamar,
    status: (t, cardId) => chamar(t, { acao: "status", cardId }),
    vincular: (t, cardId, areaDestino) => chamar(t, { acao: "vincular", cardId, areaDestino }),
    desfazer: (t, cardId) => chamar(t, { acao: "desfazer", cardId }),
  };
})();
