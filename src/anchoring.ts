import { TextComment } from "./types";

export interface Range {
  from: number;
  to: number;
}

/**
 * Reencontra a posição de um trecho comentado dentro do texto atual.
 *
 * Estratégia (estilo "text quote selector" do W3C / Hypothesis), sem inserir
 * nada no documento:
 *   1. casamento exato de `prefix + quote + suffix`;
 *   2. se houver várias ocorrências do trecho, escolhe a que tem o contexto
 *      (antes/depois) mais parecido;
 *   3. se o trecho não existe mais, retorna null (comentário "órfão").
 */
export function findAnchor(
  text: string,
  c: Pick<TextComment, "quote" | "prefix" | "suffix">
): Range | null {
  if (!c.quote) return null;

  // 1. Casamento exato com contexto.
  const withCtx = c.prefix + c.quote + c.suffix;
  const exactIdx = text.indexOf(withCtx);
  if (exactIdx !== -1) {
    const from = exactIdx + c.prefix.length;
    return { from, to: from + c.quote.length };
  }

  // 2. Todas as ocorrências do trecho.
  const positions: number[] = [];
  let i = text.indexOf(c.quote);
  while (i !== -1) {
    positions.push(i);
    i = text.indexOf(c.quote, i + 1);
  }
  if (positions.length === 0) return null;
  if (positions.length === 1) {
    const from = positions[0];
    return { from, to: from + c.quote.length };
  }

  // Desempate por similaridade de contexto.
  let best = positions[0];
  let bestScore = -1;
  for (const p of positions) {
    const before = text.slice(Math.max(0, p - c.prefix.length), p);
    const after = text.slice(
      p + c.quote.length,
      p + c.quote.length + c.suffix.length
    );
    const score =
      commonSuffixLen(before, c.prefix) + commonPrefixLen(after, c.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return { from: best, to: best + c.quote.length };
}

function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  const m = Math.min(a.length, b.length);
  while (n < m && a[n] === b[n]) n++;
  return n;
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  const m = Math.min(a.length, b.length);
  while (n < m && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
