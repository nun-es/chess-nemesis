# Chess Nemesis

Treinador pessoal de xadrez. Importe as cinco partidas públicas mais recentes de Rapid, Blitz ou Bullet da Chess.com, reproduza os lances, analise uma partida com Stockfish local e peça explicações em português ao Nemesis AI Coach.

## Executar

Requisitos: Node.js 20.19+ e npm.

```bash
npm install
npm run coach:dev  # terminal 1: API local em 127.0.0.1:8787
```

Em outro terminal:

```bash
npm run dev
```

Abra o endereço indicado pelo Vite, normalmente `http://localhost:5173`. O frontend encaminha `/api/coach` para o servidor local. Sem chave configurada, a importação e a análise Stockfish continuam funcionando; o painel do treinador informa como habilitar o Gemini.

Para habilitar a IA, copie `.env.example` para `.env`, obtenha sua chave no [Google AI Studio](https://aistudio.google.com/apikey) e preencha `GEMINI_API_KEY`. Reinicie `npm run coach:dev`. O modelo padrão é `gemini-3.6-flash`; troque `GEMINI_MODEL` no `.env` se necessário. A [documentação oficial](https://ai.google.dev/gemini-api/docs/models) o lista como estável e a [tabela de preços](https://ai.google.dev/gemini-api/docs/pricing) indica modalidade gratuita, sujeita a cotas e mudanças do Google. A chave é usada exclusivamente em `server/index.ts`, nunca no bundle do navegador.

```bash
npm run build    # TypeScript e build de produção
npm run preview  # build local
npm run lint
npm test
npm run coach    # API local sem watcher
```

## Funcionalidades

- Busca partidas públicas nos arquivos mensais da Chess.com, dos mais recentes para os mais antigos.
- Continua pelos meses anteriores se um mês listado pela Chess.com ainda não tiver arquivo disponível (HTTP 404).
- Reproduz PGNs com navegação por botões, teclado e histórico de lances.
- Analisa todas as posições de uma partida selecionada com Stockfish.js 19 lite single-threaded, via Web Worker e protocolo UCI.
- Mostra progresso real, permite cancelar e descarta resultados parciais ou de partidas anteriores.
- Exibe avaliações da perspectiva das brancas, barra de vantagem, classificações por lance, melhor alternativa em SAN, prévia da alternativa com seta e resumo com links para erros do usuário.
- Mostra **Resumo das Jogadas** com as dez categorias, contagens separadas por brancas e pretas e navegação cíclica ao clicar em cada contador. Os símbolos e cores aparecem também no histórico e nos detalhes da jogada.
- Consulta duas variantes por posição com `MultiPV 2` e identifica linhas teóricas apenas por sequência exata de uma base offline de aberturas.
- Mantém em memória um cache limitado por posição e profundidade para evitar avaliações repetidas na mesma sessão.
- **Nemesis AI Coach**: explicação sob demanda da jogada selecionada, quatro perguntas rápidas, chat contextual por posição, histórico da sessão e diagnóstico educativo da partida. O painel só envia ao Gemini posições, avaliações e variantes necessárias; não envia o PGN inteiro para explicar uma jogada.

### Como o treinador usa a análise

`src/lib/stockfish.ts` preserva até oito lances das duas variantes `MultiPV`, e `src/lib/coach.ts` converte cada sequência UCI para SAN com `chess.js`, validando os lances. A explicação recebe FEN antes/depois, rating disponível, classificação, avaliações, melhor alternativa e variantes verificadas. O diagnóstico envia as contagens do jogador, até dez posições críticas e até três exemplos positivos desta partida. A IA explica esses dados; Stockfish continua sendo a fonte das avaliações. A resposta é limitada por tokens e não há geração automática para todos os lances.

O servidor aplica timeout de 25 segundos, corpo de até 16 KiB, 12 solicitações por minuto e 100 por dia por endereço, além de cache e deduplicação em memória. Ele escuta somente em `127.0.0.1:8787` e aceita apenas origem/host locais. Erros de chave, modelo, quota e indisponibilidade são mostrados sem expor a resposta bruta da API.

### Como funciona a classificação

Esta é uma **aproximação própria**, inspirada nas [categorias públicas do Game Review](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc); não reproduz o algoritmo proprietário do Chess.com. O motor retorna avaliações relativas ao lado a jogar; o aplicativo converte tudo para a perspectiva das brancas e calcula a qualidade pela perspectiva de quem fez a jogada. Para avaliações em centipeões, usa uma curva logística de pontos esperados com escala de 250 cp. Isso reduz falsos erros quando a posição já está claramente ganha ou perdida. Os limites iniciais, centralizados em `src/lib/analysis.ts`, correspondem aproximadamente a perdas de 50, 100 e 200 cp numa posição igualada. A perda bruta em peões continua visível nos detalhes, mas não define sozinha a categoria.

A prioridade é: oportunidade de vitória desperdiçada que volta ao equilíbrio, erro grave, erro, imprecisão, linha teórica, brilhante, ótima, melhor, excelente e boa. Uma oportunidade só é marcada quando a melhor variante é forçante (captura, xeque ou promoção) e a vantagem desaparece. Um erro grave que leva a posição perdida mantém a classificação de erro grave. A categoria brilhante exige lance principal, peça sacrificada capturada na resposta principal, queda real de material e avaliação adequada. Uma ótima jogada exige que a segunda variante `MultiPV` seja claramente pior. Essas duas categorias são deliberadamente raras. Avaliações de mate nunca são convertidas em centipeões; quando a comparação é incerta, o lance fica **indeterminado** e fora dos dez contadores. Cada lance classificado entra em um único contador. Não há nota de precisão.

“Teórica” exige correspondência exata da sequência de lances com um prefixo do [catálogo de aberturas do Lichess](https://github.com/lichess-org/chess-openings), licenciado em [CC0](https://github.com/lichess-org/chess-openings/blob/master/COPYING.txt). O arquivo `src/data/opening-lines.json` é uma árvore compacta gerada dos cinco TSV (`a.tsv` a `e.tsv`), com 3.865 linhas nomeadas e 8.801 prefixos. Um lance cedo na partida sem essa correspondência não recebe o rótulo.

## Organização

- `src/lib/chesscom.ts`: integração com a Chess.com Public API.
- `src/lib/chess.ts`: leitura do PGN e sequência de posições FEN.
- `src/lib/stockfish.ts`: ciclo de vida do Worker e protocolo UCI.
- `src/lib/analysis.ts`: normalização da avaliação, classificação, cache e análise sequencial.
- `src/lib/openings.ts` e `src/data/opening-lines.json`: busca offline de sequências de abertura.
- `src/lib/coach.ts`: montagem do contexto, conversão de variantes e cliente da API local.
- `src/components/AnalysisView.tsx`: tabuleiro, progresso, histórico, avaliações e resumo.
- `src/components/CoachPanel.tsx`: explicação, chat contextual e diagnóstico.
- `server/index.ts` e `server/coach.ts`: integração Gemini pelo SDK oficial e proteção da API local.
- `public/engine/`: motor e arquivos de licença distribuídos localmente.

## Motor e licença

O projeto distribui **Stockfish.js 19.0.0 lite single-threaded** sem modificações. O Worker carrega `stockfish-19-lite-single.js` e o WASM correspondente do mesmo diretório. Estes arquivos são copiados para `dist/engine/` pelo Vite; não há CDN nem necessidade de `SharedArrayBuffer` ou cabeçalhos de isolamento de origem. O host de produção deve servir JavaScript e WASM com os tipos MIME corretos (`text/javascript` e `application/wasm`).

O motor é GPLv3. A [licença](public/engine/COPYING.txt) e o [código-fonte correspondente](public/engine/stockfish-19-source.tar.gz) acompanham os binários e ficam acessíveis na interface. Origem: [Stockfish.js v19.0.0](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0). Ao publicar os binários, mantenha o arquivo de fonte e a licença disponíveis no mesmo host.

## Limites conhecidos

- A profundidade inicial é **10**, com opções 8 e 12. `MultiPV 2` aumenta o tempo de análise em relação a uma única variante. As classificações são heurísticas, não uma revisão definitiva; táticas profundas, sacrifícios e posições de mate podem exigir busca maior. Nas profundidades 8, “Brilhante” e “Ótima jogada” não são emitidas sem a evidência mínima definida para 10.
- O catálogo de aberturas é uma seleção de linhas nomeadas, não uma base exaustiva de lances jogados por mestres. Uma linha conhecida pode permanecer sem “Teórica”; uma correspondência não prova que seja a escolha ideal na posição concreta.
- Uma partida de mais de 150 meios-lances exige uma avaliação sequencial por posição e pode levar mais tempo em celulares lentos. A interface continua responsiva e permite cancelar.
- A análise de cada FEN isolada não conserva todo o histórico de repetição da partida para o motor. Algumas situações de repetição podem, portanto, receber uma avaliação aproximada.
- Partidas sem PGN ou com PGN inválido não podem ser abertas. Não há dados fictícios apresentados como partidas ou avaliações reais.
- O servidor de desenvolvimento encaminha `/chess-api` para a Chess.com e envia um `User-Agent` identificável. Na build estática, o navegador consulta a API diretamente; o proxy do Vite não acompanha a build. Se a hospedagem encontrar bloqueios de CORS ou do provedor, será necessário um proxy de mesma origem. Os arquivos públicos da Chess.com também podem demorar a atualizar por causa do cache.
- No deploy da Vercel, o treinador é público e não exige senha. A chave Gemini fica exclusivamente no servidor. Os limites em memória no `CoachService` **não** são globais/persistentes em funções serverless. Configure limites de quota e gastos no provedor Gemini, acompanhe o uso na Vercel e considere rate limiting persistente e proteção contra abuso.
- A interpretação em linguagem natural pode errar mesmo com contexto verificado. As variantes têm no máximo oito meios-lances no motor e seis enviados por posição; a profundidade 8–12 também limita conclusões táticas. Quando faltam dados, a resposta deve reconhecer a limitação.

## Próximas etapas

Desafios personalizados a partir de fraquezas recorrentes. Autenticação, banco de dados, métricas de precisão e gamificação ainda não fazem parte do projeto.

## Deploy na Vercel (API pública)

O frontend é compilado com `npm run build` e publicado em `dist`. As Vercel Functions `/api/coach` e `/api/coach/status` executam o treinador quando solicitadas; não é necessário rodar `npm run coach:dev` no servidor.

1. Importe o repositório na Vercel com preset **Vite**, build `npm run build` e diretório de saída `dist`.
2. Em Environment Variables configure `GEMINI_API_KEY` (segredo somente do servidor) e opcionalmente `GEMINI_MODEL`.
3. Faça o deploy e teste `/api/coach/status`, Stockfish e uma explicação real.
4. **Nunca** coloque `GEMINI_API_KEY` em `VITE_*`, no GitHub ou no navegador. `COACH_ACCESS_CODE` não é mais utilizado.

**Segurança e custos:** o Coach está aberto a qualquer visitante, sem login ou senha. Limites em memória não garantem proteção entre várias instâncias da Vercel, e cabeçalhos de origem não impedem clientes automatizados. Configure quotas/restrições de custo no Google, monitore o consumo do Gemini e da Vercel e implemente rate limiting persistente antes de divulgar amplamente. Se estiver em um plano com cobrança habilitada, requisições públicas poderão gerar custos. A consulta à Chess.com pode falhar por restrições de CORS; valide o fluxo no ambiente real de produção.
