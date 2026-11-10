/* Configuracao do Power-Up "Interdependencia entre Areas v2" (SO quadros de teste).
 * Nada aqui e segredo: a chave de API do Trello e PUBLICA (o segredo e o token). Preencha DEPOIS de implantar:
 *  - API_URL: endereco "/exec" do aplicativo da Web do Apps Script (apps_script/Codigo.gs).
 *  - APP_KEY: chave de API do Power-Up no admin do Trello. Tem de ser a MESMA chave de API configurada nas Propriedades do backend.
 * Enquanto estiverem vazios, a tela mostra "Power-Up ainda nao configurado" e NAO chama nada. */
window.INTERDEP2 = {
  API_URL: "https://script.google.com/macros/s/AKfycbwzM5AdfijjTfc7dxR-erX7CcY6dxkdTlpkJ-i7KMNxoqxr5_b6DjFXW5jczDlNy7_0/exec",
  APP_KEY: "d017ef26d1be44e3b4a02cd7784cb808",
  APP_NAME: "PMO BigBox - Interdependência v2",
  // Mesmos quadros liberados no backend (AREAS em Codigo.gs). key = shortLink do quadro.
  AREAS: [
    { key: "7uckGfR4", nome: "Comercial (teste)" },
    { key: "b4kXgCbn", nome: "Processos (teste)" },
  ],
};
