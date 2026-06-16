export type SortKey =
  | "position-asc"
  | "position-desc"
  | "created-asc"
  | "created-desc";

/** Ações registradas na trilha de auditoria de um comentário. */
export type HistoryAction = "created" | "edited" | "done" | "reopened";

export interface HistoryEvent {
  /** Timestamp (epoch ms) do evento. */
  at: number;
  action: HistoryAction;
}

export interface TextComment {
  /** Identificador estável do comentário. */
  id: string;
  /** Trecho exato que foi comentado (a "âncora"). */
  quote: string;
  /** Texto imediatamente antes do trecho, usado para desambiguar. */
  prefix: string;
  /** Texto imediatamente depois do trecho, usado para desambiguar. */
  suffix: string;
  /** Corpo do comentário escrito pelo usuário. */
  body: string;
  /** Comentário concluído (resolvido)? Muda a cor do realce. */
  done?: boolean;
  /** Cor opcional específica deste comentário (CSS). Tem prioridade. */
  color?: string;
  /** Trilha de auditoria: cada mudança de estado vira um evento. */
  history: HistoryEvent[];
  created: number;
  modified: number;
}

/** Garante que todo comentário tenha histórico (retrocompatibilidade). */
export function ensureHistory(c: TextComment): TextComment {
  if (!c.history || c.history.length === 0) {
    c.history = [{ at: c.created || c.modified || Date.now(), action: "created" }];
  }
  return c;
}

/** Formata um timestamp como `AAAA-MM-DD HH:mm` (hora local). */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

export interface PluginSettings {
  /** Pasta onde as notas de comentários são gravadas. */
  commentsFolder: string;
  /** Quantos caracteres de contexto guardar antes/depois do trecho. */
  contextLength: number;
  /** Ordenação padrão do painel. */
  defaultSort: SortKey;
  /** Cor do realce para comentários pendentes. Vazio = padrão do tema. */
  pendingColor: string;
  /** Cor do realce para comentários concluídos. */
  doneColor: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  commentsFolder: "Comentários",
  contextLength: 32,
  defaultSort: "position-asc",
  pendingColor: "",
  doneColor: "#4caf50",
};

/**
 * Resolve a cor e o estado do realce de um comentário.
 * `color` nulo significa "usar o padrão do tema".
 */
export function resolveHighlight(
  c: TextComment,
  s: PluginSettings
): { color: string | null; done: boolean } {
  const done = !!c.done;
  if (done) return { color: s.doneColor.trim() || null, done };
  return { color: c.color?.trim() || s.pendingColor.trim() || null, done };
}
