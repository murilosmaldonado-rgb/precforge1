# PrecForge — projeto pronto para deploy

Este é o mesmo protótipo do PrecForge, já organizado como um projeto Vite +
React "de verdade", pronto para rodar localmente ou publicar em um serviço
de hospedagem.

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse o endereço que aparecer no terminal (normalmente http://localhost:5173).

## Gerar a versão de produção

```bash
npm run build
```

Isso cria a pasta `dist/` com os arquivos estáticos prontos para hospedar.

## Importante

Este projeto é **somente front-end**: os dados vivem em memória no
navegador (recarregar a página volta para os dados de demonstração) e não
há banco de dados, autenticação segura ou envio real de e-mail por trás
dele. Ele serve como protótipo navegável e ponto de partida visual — para
uso real com dados de investidores de verdade, é necessário construir um
backend (API + banco de dados + autenticação) por trás desta interface.
