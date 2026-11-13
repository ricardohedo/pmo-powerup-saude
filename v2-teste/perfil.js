/* PERFIS: a escolha da pessoa. A UNICA escrita e o NOME do perfil (uma palavra, ex.: "essencial") no armazenamento PRIVADO da propria
 * pessoa, valido em todos os quadros (escopo member). Nunca vai para o regras.json publico e nunca escreve em card, lista, etiqueta,
 * membro ou comentario do Trello. Vale: escolha da pessoa > perfil da area > perfil padrao da empresa (PmoMotor.perfilEfetivo). */
const CHAVE_PERFIL = "pmo_perfil";
window.PmoPerfil = {
  ler: async (t) => {
    try { const v = await t.get("member", "private", CHAVE_PERFIL); return typeof v === "string" && v ? v : null; } catch (e) { return null; }
  },
  guardar: (t, nome) => t.set("member", "private", CHAVE_PERFIL, nome ? String(nome).slice(0, 40) : ""),
  /* perfil em vigor para esta pessoa neste quadro; null = sem perfis (funcao desligada ou erro): todos veem tudo, como antes */
  atual: async (t, regras) => {
    try {
      if (!(regras && regras.funcoes && regras.funcoes.perfis)) return null;
      const [escolha, quadro] = await Promise.all([window.PmoPerfil.ler(t), t.board("name")]);
      return PmoMotor.perfilEfetivo(regras, escolha, quadro && quadro.name);
    } catch (e) { return null; }
  },
};
