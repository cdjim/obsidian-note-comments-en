import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { setIcon } from "obsidian";
import { PluginSettings, TextComment, resolveHighlight } from "./types";
import { findAnchor } from "./anchoring";

/** Ícone clicável inserido ao fim de cada trecho comentado, no editor. */
class CommentWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly done: boolean
  ) {
    super();
  }

  eq(other: CommentWidget): boolean {
    return (
      other.id === this.id &&
      other.done === this.done &&
      other.label === this.label
    );
  }

  toDOM(): HTMLElement {
    const span = activeDocument.createElement("span");
    span.className =
      "text-comment-widget" + (this.done ? " is-done" : "");
    span.setAttribute("data-comment-id", this.id);
    span.setAttribute("aria-label", this.label);
    setIcon(span, "message-square");
    return span;
  }

  ignoreEvent(): boolean {
    return false; // deixa o clique chegar ao nosso handler
  }
}

/** Efeito para substituir o conjunto de destaques no editor ativo. */
export const setCommentDecos = StateEffect.define<DecorationSet>();

/**
 * Campo que guarda os destaques. Importante: `deco.map(tr.changes)` faz os
 * destaques se moverem junto com as edições durante a sessão — re-ancoragem
 * "de graça" enquanto se digita.
 */
export const commentDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setCommentDecos)) deco = e.value;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Constrói os destaques (fundo + sublinhado) para os comentários do texto. */
export function buildDecorations(
  text: string,
  comments: TextComment[],
  settings: PluginSettings
): DecorationSet {
  const ranges = [];
  for (const c of comments) {
    const r = findAnchor(text, c);
    if (!r || r.from >= r.to) continue;
    const { color, done } = resolveHighlight(c, settings);
    const attributes: Record<string, string> = { "data-comment-id": c.id };
    if (color) attributes.style = `--tc-color: ${color}`;
    // Tooltip do Obsidian (segue o tema/tipografia), não o `title` nativo.
    if (c.body) attributes["aria-label"] = c.body;
    ranges.push(
      Decoration.mark({
        class: done
          ? "text-comment-highlight is-done"
          : "text-comment-highlight",
        attributes,
      }).range(r.from, r.to)
    );
    // Ícone clicável logo após o trecho.
    ranges.push(
      Decoration.widget({
        widget: new CommentWidget(c.id, c.body || "Comentário", done),
        side: 1,
      }).range(r.to)
    );
  }
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(ranges, true);
}
