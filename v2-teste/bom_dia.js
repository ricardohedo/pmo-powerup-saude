/* "Bom dia" (popup ao abrir o quadro): a UNICA escrita e uma marca no armazenamento PRIVADO da propria pessoa neste quadro
 * (dia do ultimo popup / "nao mostrar mais"). Nunca escreve em cards, listas, etiquetas, membros nem comentarios do Trello. */
const CHAVE_BOM_DIA = "pmo_bom_dia";
window.PmoBomDia = {
  ler: (t) => t.get("board", "private", CHAVE_BOM_DIA),
  guardar: (t, valor) => t.set("board", "private", CHAVE_BOM_DIA, valor),
};
