import { App, TFile, normalizePath } from "obsidian";
import {
  HistoryAction,
  PluginSettings,
  TextComment,
  ensureHistory,
  formatTimestamp,
} from "./types";

const DATA_MARKER = "TEXT_COMMENTS_DATA";

/**
 * Persiste os comentários como UMA nota por documento, dentro da pasta
 * configurada, espelhando o caminho do documento de origem.
 *
 *   Notes/Estudo.md  ->  Comentários/Notes/Estudo.md
 *
 * A nota é legível (callouts) e ao mesmo tempo tem um bloco %% ... %% oculto
 * com o JSON, que é a fonte da verdade lida pelo plugin.
 */
export class CommentStore {
  constructor(private app: App, private settings: PluginSettings) {}

  sidecarPath(file: TFile): string {
    const rel = file.path.replace(/\.md$/i, "");
    return normalizePath(`${this.settings.commentsFolder}/${rel}.md`);
  }

  async load(file: TFile): Promise<TextComment[]> {
    const f = this.app.vault.getAbstractFileByPath(this.sidecarPath(file));
    if (!(f instanceof TFile)) return [];
    const content = await this.app.vault.cachedRead(f);
    return parse(content).map(ensureHistory);
  }

  async save(file: TFile, comments: TextComment[]): Promise<void> {
    const path = this.sidecarPath(file);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (comments.length === 0) {
      if (existing instanceof TFile) await this.app.vault.delete(existing);
      return;
    }

    await this.ensureFolder(path);
    const content = serialize(file, comments);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  private async ensureFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop();
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur).catch(() => {});
      }
    }
  }
}

function parse(content: string): TextComment[] {
  const start = content.indexOf(DATA_MARKER);
  if (start === -1) return [];
  const after = content.slice(start + DATA_MARKER.length);
  const end = after.indexOf("%%");
  const json = (end === -1 ? after : after.slice(0, end)).trim();
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function serialize(file: TFile, comments: TextComment[]): string {
  const lines: string[] = [];
  lines.push("---");
  // Caminho em texto puro (sem [[link]]) para NÃO gerar aresta no grafo.
  // A navegação até o documento é feita pelo painel do plugin.
  lines.push(`source: "${file.path}"`);
  lines.push("tags: [note-comments]");
  lines.push("---");
  lines.push("");
  lines.push(`# Comentários — ${file.basename}`);
  lines.push("");

  for (const c of comments) {
    const q = c.quote.replace(/\s+/g, " ").trim().slice(0, 120);
    const callout = c.done ? "success" : "quote";
    lines.push(`> [!${callout}] ${q}`);
    for (const bl of c.body.split("\n")) lines.push(`> ${bl}`);

    // Trilha de auditoria, legível dentro do próprio callout.
    const hist = c.history && c.history.length ? c.history : [];
    if (hist.length) {
      lines.push(">");
      lines.push("> **Histórico:**");
      for (const e of hist) {
        lines.push(`> - ${formatTimestamp(e.at)} — ${ACTION_LABEL[e.action]}`);
      }
    }
    lines.push("");
  }

  // Bloco oculto com a fonte da verdade.
  lines.push("%%");
  lines.push(DATA_MARKER);
  lines.push(JSON.stringify(comments, null, 2));
  lines.push("%%");
  lines.push("");
  return lines.join("\n");
}

const ACTION_LABEL: Record<HistoryAction, string> = {
  created: "criado",
  edited: "editado",
  done: "concluído",
  reopened: "reaberto",
};
