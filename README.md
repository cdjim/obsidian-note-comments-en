# Note Comments — plugin para Obsidian

Adiciona comentários ancorados a qualquer trecho de texto (uma palavra, frase ou
parágrafo), com **destaque colorido + sublinhado** ligados ao tema, e um
**painel lateral** com ordenação.

## Funcionalidades

- **Comentar via botão direito**: selecione um trecho → menu de contexto →
  *Adicionar comentário*. Também disponível como comando.
- **Destaque** do trecho com fundo (`--text-highlight-bg`) e sublinhado
  (`--text-accent`) — respeita tema claro/escuro. Funciona em Live Preview,
  Source e modo Leitura.
- **Painel à direita** listando todos os comentários do documento, com
  ordenação crescente/decrescente por **posição** ou por **data**.
- **Documento limpo**: nada é inserido no seu markdown. A âncora é o próprio
  trecho + contexto, reencontrado automaticamente (estilo *text quote
  selector*). Se um trecho for muito reescrito, o comentário vira "órfão"
  (mostrado esmaecido no painel) em vez de se perder silenciosamente.
- **Armazenamento**: uma nota por documento, dentro da pasta configurável,
  espelhando o caminho de origem e com backlink `[[documento]]`. A nota é
  legível (callouts) e tem um bloco `%% ... %%` oculto com o JSON, que é a fonte
  da verdade.

## Como a âncora funciona

Ao comentar, guardamos `quote` (o trecho), `prefix` e `suffix` (alguns
caracteres ao redor). Para destacar, reencontramos a posição no texto atual:

1. casamento exato de `prefix + quote + suffix`;
2. se houver várias ocorrências do trecho, escolhemos a de contexto mais
   parecido;
3. se não existe mais, o comentário fica órfão.

Durante a edição, os destaques se movem junto com o texto (mapeamento de
decorations do CodeMirror), então só recorremos ao reencontro ao reabrir.

## Desenvolvimento

```bash
npm install
npm run dev     # build com watch
npm run build   # build de produção + type-check
```

Para testar: copie `main.js`, `manifest.json` e `styles.css` para
`<vault>/.obsidian/plugins/note-comments/` e ative o plugin.

## Limitações conhecidas (v0.1)

- No modo leitura, destacamos a **primeira ocorrência** do trecho dentro de cada
  bloco e apenas quando ele cabe num único nó de texto (sem formatação no meio).
- O reencontro é por texto exato; reescritas grandes do trecho criam órfãos.
- Uma cor por destaque é suportada no modelo de dados (`color`), mas ainda não há
  UI para escolhê-la.
