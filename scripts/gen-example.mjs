// Gera um documento de exemplo + a nota-irmã de comentários (com o bloco JSON
// que o plugin lê). Os offsets das âncoras são calculados a partir do texto real
// para garantir que os realces casem.
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

const CONTEXT = 32; // mesmo padrão do plugin (settings.contextLength)
// Caminho do documento RELATIVO À RAIZ DO VAULT. A nota-irmã precisa ficar em
// `<pasta de comentários>/<este caminho>` também a partir da raiz do vault.
const DOC_VAULT_PATH = "examples/Exemplo Comentários.md";
const COMMENTS_FOLDER = "Comentários";
const OUT_DOC = DOC_VAULT_PATH;
const OUT_SIDE = `${COMMENTS_FOLDER}/${DOC_VAULT_PATH}`;

const doc = `# Relatório de Análise de Logs

Este documento de exemplo serve para testar o plugin de comentários. Ele contém cabeçalhos, parágrafos, imagens, listas, tabelas e blocos de código — incluindo comentários pendentes e concluídos.

## Contexto

A redução de ruído operacional é essencial para a eficiência do SOC. Eventos de logon do tipo 3 geram volume excessivo e devem ser filtrados na origem sempre que possível.

![Diagrama de arquitetura](https://example.com/diagrama.png)

## Metodologia

Foram analisados os logs do período das 18h às 22h. A consulta abaixo foi utilizada para validar a redução observada:

\`\`\`spl
index="example_fortigate" sourcetype=fortigate_traffic
| timechart span=15m count
\`\`\`

## Resultados

Os resultados mostraram uma redução de 62% no volume de eventos após a aplicação do filtro. A tabela a seguir resume os números coletados:

| Período | Antes | Depois |
| --- | --- | --- |
| 18h-19h | 12000 | 4600 |
| 19h-20h | 11500 | 4300 |

> Observação: os valores são aproximados e podem variar conforme o ambiente analisado.

## Conclusão

A estratégia de filtragem na origem mostrou-se eficaz e deve ser estendida aos demais índices monitorados.
`;

const t = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

// Comentários de exemplo (mix de pendentes e concluídos).
const specs = [
  {
    quote: "redução de ruído operacional",
    body: "Precisamos definir a métrica de ruído antes de validar a redução.",
    done: false,
    history: [{ at: t(2026, 6, 10, 9, 15), action: "created" }],
  },
  {
    quote: "logon do tipo 3",
    body: "Confirmado com a equipe de infra: tipo 3 pode ser filtrado na origem.",
    done: true,
    history: [
      { at: t(2026, 6, 10, 9, 20), action: "created" },
      { at: t(2026, 6, 11, 14, 30), action: "done" },
    ],
  },
  {
    quote: "## Metodologia",
    body: "Metodologia revisada e aprovada pela coordenação.",
    done: true,
    history: [
      { at: t(2026, 6, 10, 10, 0), action: "created" },
      { at: t(2026, 6, 10, 10, 5), action: "edited" },
      { at: t(2026, 6, 12, 8, 0), action: "done" },
    ],
  },
  {
    quote: "redução de 62%",
    body: "Recalcular: a base de comparação parece incluir o horário de pico.",
    done: false,
    history: [{ at: t(2026, 6, 11, 11, 0), action: "created" }],
  },
  {
    quote: "os valores são aproximados e podem variar",
    body: "Adicionar a margem de erro estimada para o número final.",
    done: false,
    history: [{ at: t(2026, 6, 12, 10, 0), action: "created" }],
  },
];

const comments = specs.map((s, i) => {
  const idx = doc.indexOf(s.quote);
  if (idx === -1) throw new Error(`Trecho não encontrado: ${s.quote}`);
  const prefix = doc.slice(Math.max(0, idx - CONTEXT), idx);
  const suffix = doc.slice(idx + s.quote.length, idx + s.quote.length + CONTEXT);
  const created = s.history[0].at;
  const modified = s.history[s.history.length - 1].at;
  return {
    id: `ex${i + 1}-${created.toString(36)}`,
    quote: s.quote,
    prefix,
    suffix,
    body: s.body,
    ...(s.done ? { done: true } : {}),
    history: s.history,
    created,
    modified,
  };
});

// ---- nota-irmã (mesmo formato do store.ts) ----
const ACTION_LABEL = {
  created: "criado",
  edited: "editado",
  done: "concluído",
  reopened: "reaberto",
};
const fmt = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const L = [];
L.push("---");
L.push(`source: "${DOC_VAULT_PATH}"`);
L.push("tags: [note-comments]");
L.push("---");
L.push("");
L.push(`# Comentários — Exemplo Comentários`);
L.push("");
for (const c of comments) {
  const q = c.quote.replace(/\s+/g, " ").trim().slice(0, 120);
  L.push(`> [!${c.done ? "success" : "quote"}] ${q}`);
  for (const bl of c.body.split("\n")) L.push(`> ${bl}`);
  L.push(">");
  L.push("> **Histórico:**");
  for (const e of c.history) L.push(`> - ${fmt(e.at)} — ${ACTION_LABEL[e.action]}`);
  L.push("");
}
L.push("%%");
L.push("TEXT_COMMENTS_DATA");
L.push(JSON.stringify(comments, null, 2));
L.push("%%");
L.push("");

mkdirSync(dirname(OUT_DOC), { recursive: true });
mkdirSync(dirname(OUT_SIDE), { recursive: true });
writeFileSync(OUT_DOC, doc);
writeFileSync(OUT_SIDE, L.join("\n"));

console.log(`OK: ${OUT_DOC}`);
console.log(`OK: ${OUT_SIDE}`);
console.log(`Comentários: ${comments.filter((c) => !c.done).length} pendentes, ${comments.filter((c) => c.done).length} concluídos`);
