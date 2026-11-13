/* "Pergunte ao PMO": caderno das perguntas que o bot NAO soube responder. A UNICA escrita e este caderno no armazenamento COMPARTILHADO do
 * proprio Power-Up neste quadro (so o texto digitado e a data; nunca nome de pessoa, card, lista, etiqueta ou comentario do Trello).
 * O PMO le a lista para ampliar o catalogo. Guarda as ultimas 15 e corta cada texto em 100 caracteres (o Trello limita o valor guardado a 4096). */
const CHAVE_PERGUNTAS = "pmo_perguntas_sem_resposta";
window.PmoPerguntas = {
  MAX: 15,
  ler: async (t) => { const v = await t.get("board", "shared", CHAVE_PERGUNTAS); return Array.isArray(v) ? v : []; },
  registrar: async (t, texto, agora) => {
    const q = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (q.length < 3) return;
    const lista = await window.PmoPerguntas.ler(t);
    lista.push({ q, em: (agora || new Date()).toISOString() });
    await t.set("board", "shared", CHAVE_PERGUNTAS, lista.slice(-window.PmoPerguntas.MAX));
  },
};
