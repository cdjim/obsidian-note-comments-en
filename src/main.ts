import {
  App,
  Editor,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  MarkdownPostProcessorContext,
  setIcon,
} from "obsidian";
import { EditorView } from "@codemirror/view";

import {
  DEFAULT_SETTINGS,
  PluginSettings,
  TextComment,
  resolveHighlight,
} from "./types";
import { CommentStore } from "./store";
import { findAnchor } from "./anchoring";
import {
  buildDecorations,
  commentDecoField,
  setCommentDecos,
} from "./decorations";
import { CommentsView, VIEW_TYPE_COMMENTS } from "./CommentsView";

export default class TextCommentsPlugin extends Plugin {
  settings: PluginSettings;
  store: CommentStore;

  /** Estado do documento atualmente em foco (lido pelo painel). */
  activeFile: TFile | null = null;
  activeComments: TextComment[] = [];
  activeText = "";

  /**
   * Último editor markdown em foco. Mantido mesmo quando o usuário clica no
   * painel de comentários (que não é um MarkdownView), para que os comentários
   * continuem visíveis e editáveis.
   */
  activeMarkdownView: MarkdownView | null = null;

  /** Cache path -> comentários, usado pelo render do modo leitura. */
  private cache = new Map<string, TextComment[]>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new CommentStore(this.app, this.settings);

    // Mantém a pasta de comentários fora da busca/quick-switcher/sugestões.
    this.ensureExcludedFolder();

    // 1. Destaque no editor (Live Preview / Source).
    this.registerEditorExtension([commentDecoField]);

    // 2. Destaque no modo leitura.
    this.registerMarkdownPostProcessor((el, ctx) =>
      this.highlightReadingMode(el, ctx)
    );

    // 3. Painel lateral direito.
    this.registerView(
      VIEW_TYPE_COMMENTS,
      (leaf) => new CommentsView(leaf, this)
    );

    this.addRibbonIcon("message-square", "Comentários", () =>
      this.activateView()
    );

    // 4. Menu de contexto (botão direito) na seleção.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        if (!editor.getSelection()) return;
        menu.addItem((item) =>
          item
            .setTitle("Adicionar comentário")
            .setIcon("message-square")
            .onClick(() => this.addComment(editor, view))
        );
      })
    );

    // 5. Comandos.
    this.addCommand({
      id: "add-comment",
      name: "Adicionar comentário ao trecho selecionado",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.addComment(editor, view);
      },
    });
    this.addCommand({
      id: "open-panel",
      name: "Abrir painel de comentários",
      callback: () => this.activateView(),
    });

    // 6. Manter estado sincronizado com o documento ativo.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        // Só troca o documento em foco quando o usuário entra num editor
        // markdown. Clicar no painel de comentários (ou em outro painel)
        // mantém o documento atual visível e editável.
        if (leaf && leaf.view instanceof MarkdownView) {
          this.activeMarkdownView = leaf.view;
          this.refreshActive();
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          this.activeMarkdownView = view;
          this.refreshActive();
        }
      })
    );

    // 7. Cliques: no widget (ícone) abre o menu; no trecho realçado, revela no painel.
    this.registerDomEvent(document, "click", (evt) => {
      const target = evt.target as HTMLElement | null;

      const widget = target?.closest?.(
        ".text-comment-widget"
      ) as HTMLElement | null;
      if (widget) {
        const id = widget.getAttribute("data-comment-id");
        if (id) this.openCommentMenu(evt, id);
        return;
      }

      const span = target?.closest?.(
        ".text-comment-highlight"
      ) as HTMLElement | null;
      if (!span) return;
      const id = span.getAttribute("data-comment-id");
      if (id) void this.revealCommentInPanel(id);
    });

    this.addSettingTab(new TextCommentsSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.activeMarkdownView =
        this.app.workspace.getActiveViewOfType(MarkdownView);
      this.refreshActive();
    });
  }

  onunload(): void {
    this.cache.clear();
  }

  // ---------------------------------------------------------------------------
  // Estado / sincronização
  // ---------------------------------------------------------------------------

  async refreshActive(): Promise<void> {
    const view = this.activeMarkdownView;
    const file = view?.file ?? null;
    this.activeFile = file;
    this.activeText = view?.editor.getValue() ?? "";

    if (file) {
      this.activeComments = await this.store.load(file);
      this.cache.set(file.path, this.activeComments);
    } else {
      this.activeComments = [];
    }

    this.applyDecorations(view);
    this.refreshPanel();
  }

  private applyDecorations(view: MarkdownView | null): void {
    if (!view) return;
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (!cm) return;
    const text = view.editor.getValue();
    cm.dispatch({
      effects: setCommentDecos.of(
        buildDecorations(text, this.activeComments, this.settings)
      ),
    });
  }

  private refreshPanel(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      (leaf.view as CommentsView).render();
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD de comentários
  // ---------------------------------------------------------------------------

  async addComment(editor: Editor, view: MarkdownView): Promise<void> {
    const file = view.file;
    const selection = editor.getSelection();
    if (!file || !selection) {
      new Notice("Selecione um trecho primeiro.");
      return;
    }

    const fromOff = editor.posToOffset(editor.getCursor("from"));
    const toOff = editor.posToOffset(editor.getCursor("to"));
    const text = editor.getValue();
    const ctx = this.settings.contextLength;

    const body = await this.promptBody("");
    if (body === null) return; // cancelado

    const now = Date.now();
    const comment: TextComment = {
      id: genId(),
      quote: selection,
      prefix: text.slice(Math.max(0, fromOff - ctx), fromOff),
      suffix: text.slice(toOff, toOff + ctx),
      body,
      history: [{ at: now, action: "created" }],
      created: now,
      modified: now,
    };

    const comments = await this.store.load(file);
    comments.push(comment);
    await this.store.save(file, comments);
    await this.refreshActive();
    this.rerenderReadingView();
    new Notice("Comentário adicionado.");
  }

  async editComment(comment: TextComment): Promise<void> {
    if (!this.activeFile) return;
    const body = await this.promptBody(comment.body);
    if (body === null) return;
    const comments = await this.store.load(this.activeFile);
    const target = comments.find((c) => c.id === comment.id);
    if (!target) return;
    if (body === target.body) return; // sem mudança real
    const now = Date.now();
    target.body = body;
    target.modified = now;
    target.history.push({ at: now, action: "edited" });
    await this.store.save(this.activeFile, comments);
    await this.refreshActive();
    this.rerenderReadingView();
  }

  async deleteComment(comment: TextComment): Promise<void> {
    if (!this.activeFile) return;
    const comments = (await this.store.load(this.activeFile)).filter(
      (c) => c.id !== comment.id
    );
    await this.store.save(this.activeFile, comments);
    await this.refreshActive();
    this.rerenderReadingView();
  }

  async toggleDone(comment: TextComment): Promise<void> {
    if (!this.activeFile) return;
    const comments = await this.store.load(this.activeFile);
    const target = comments.find((c) => c.id === comment.id);
    if (!target) return;
    const now = Date.now();
    target.done = !target.done;
    target.modified = now;
    target.history.push({ at: now, action: target.done ? "done" : "reopened" });
    await this.store.save(this.activeFile, comments);
    await this.refreshActive();
    this.rerenderReadingView();
  }

  scrollToComment(comment: TextComment): void {
    const view = this.activeMarkdownView;
    if (!view) return;

    // Modo leitura: não há editor — centraliza no destaque renderizado.
    if (view.getMode() === "preview") {
      // Já visível? centraliza direto.
      if (this.tryCenterHighlight(view, comment.id)) return;

      const data = view.getViewData();
      const range = findAnchor(data, comment);
      if (!range) {
        new Notice("Trecho não encontrado no documento.");
        return;
      }
      // Fora da tela: força a renderização da seção pela linha de origem...
      view.setEphemeralState({ line: offsetToLine(data, range.from) });
      // ...e centraliza assim que o destaque aparecer na DOM.
      this.pollCenterHighlight(view, comment.id, 15);
      return;
    }

    // Modo de edição (Source / Live Preview).
    const text = view.editor.getValue();
    const range = findAnchor(text, comment);
    if (!range) {
      new Notice("Trecho não encontrado no documento.");
      return;
    }
    const from = view.editor.offsetToPos(range.from);
    const to = view.editor.offsetToPos(range.to);
    view.editor.setSelection(from, to);

    // EditorView.scrollIntoView centraliza de forma confiável mesmo quando o
    // trecho está longe e a linha ainda não foi medida pelo CodeMirror.
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (cm) {
      cm.dispatch({
        effects: EditorView.scrollIntoView(range.from, { y: "center" }),
      });
    } else {
      view.editor.scrollIntoView({ from, to }, true);
    }
  }

  /** Centraliza no destaque se ele já existir na DOM. Retorna true se achou. */
  private tryCenterHighlight(view: MarkdownView, id: string): boolean {
    const el = view.contentEl.querySelector(
      `.text-comment-highlight[data-comment-id="${id}"]`
    ) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flashElement(el);
    return true;
  }

  /** Tenta centralizar repetidamente até o bloco lazy ser renderizado. */
  private pollCenterHighlight(
    view: MarkdownView,
    id: string,
    attempts: number
  ): void {
    if (this.tryCenterHighlight(view, id)) return;
    if (attempts <= 0) return;
    window.setTimeout(() => this.pollCenterHighlight(view, id, attempts - 1), 40);
  }

  // ---------------------------------------------------------------------------
  // Modo leitura
  // ---------------------------------------------------------------------------

  private async highlightReadingMode(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    let comments = this.cache.get(ctx.sourcePath);
    if (!comments) {
      // Cache ainda não preenchido (ex.: documento aberto direto em leitura).
      const f = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (f instanceof TFile) {
        comments = await this.store.load(f);
        this.cache.set(ctx.sourcePath, comments);
      }
    }
    if (!comments || comments.length === 0) return;
    for (const c of comments) {
      highlightInElement(el, c, this.settings);
    }
  }

  /** Re-renderiza a leitura para refletir comentários adicionados/removidos. */
  private rerenderReadingView(): void {
    const view = this.activeMarkdownView;
    if (view && view.getMode() === "preview") {
      view.previewMode.rerender(true);
    }
  }

  /** Reaplica os realces após mudança de cor nas configurações. */
  refreshAllHighlights(): void {
    void this.refreshActive();
    this.rerenderReadingView();
  }

  // ---------------------------------------------------------------------------
  // UI auxiliar
  // ---------------------------------------------------------------------------

  private promptBody(initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      new CommentModal(this.app, initial, resolve).open();
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  /** Abre o painel (se preciso) e destaca o cartão do comentário clicado. */
  async revealCommentInPanel(id: string): Promise<void> {
    await this.activateView();
    window.setTimeout(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
        (leaf.view as CommentsView).focusComment(id);
      }
    }, 50);
  }

  /** Menu de ações do widget inline (ícone) de um comentário. */
  openCommentMenu(evt: MouseEvent, id: string): void {
    const comment = this.activeComments.find((c) => c.id === id);
    if (!comment) return;

    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setIcon("message-square")
        .setTitle(truncate(comment.body || "Comentário", 60))
        .setDisabled(true)
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setIcon("pencil")
        .setTitle("Editar")
        .onClick(() => this.editComment(comment))
    );
    menu.addItem((item) =>
      item
        .setIcon(comment.done ? "rotate-ccw" : "check-circle-2")
        .setTitle(comment.done ? "Marcar como pendente" : "Marcar como concluído")
        .onClick(() => this.toggleDone(comment))
    );
    menu.addItem((item) =>
      item
        .setIcon("panel-right")
        .setTitle("Ver no painel")
        .onClick(() => void this.revealCommentInPanel(id))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setIcon("trash-2")
        .setTitle("Excluir")
        .setWarning(true)
        .onClick(() => this.deleteComment(comment))
    );
    menu.showAtMouseEvent(evt);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Adiciona a pasta de comentários aos "Excluded files" do Obsidian, para que
   * as notas de comentários não poluam busca, quick-switcher, sugestões de link
   * e "unlinked mentions". (API semi-interna `getConfig`/`setConfig`.)
   */
  ensureExcludedFolder(): void {
    const folder = this.settings.commentsFolder.trim();
    if (!folder) return;
    const vault = this.app.vault as unknown as {
      getConfig?: (key: string) => unknown;
      setConfig?: (key: string, value: unknown) => void;
    };
    if (!vault.getConfig || !vault.setConfig) return;
    const current = vault.getConfig("userIgnoreFilters");
    const list = Array.isArray(current) ? (current as string[]) : [];
    if (!list.includes(folder)) {
      vault.setConfig("userIgnoreFilters", [...list, folder]);
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Encurta um texto para uma prévia de uma linha. */
function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/**
 * Destaca o trecho na DOM renderizada (um bloco/`el` por chamada).
 *
 * Estratégia em camadas:
 *   1. trecho inteiro (caso comum, cabe num bloco só);
 *   2. trecho inteiro sem a sintaxe markdown (ex.: "# Dia 1" -> "Dia 1");
 *   3. se a seleção atravessa blocos (título + parágrafo, etc.), tenta
 *      **linha a linha** — cada bloco destaca a(s) linha(s) que contém.
 */
function highlightInElement(
  root: HTMLElement,
  c: TextComment,
  settings: PluginSettings
): void {
  if (!c.quote) return;

  // 1 + 2: trecho inteiro (exato e sem markdown).
  const whole = tryMatch(root, c.quote, c, settings);
  if (whole) {
    appendCommentIcon(whole, c);
    return;
  }

  // 3: trecho multi-linha (atravessa blocos). Tenta cada linha neste bloco.
  const lines = c.quote
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) return; // já tentado como trecho único
  let last: HTMLElement | null = null;
  for (const line of lines) {
    const el = tryMatch(root, line, c, settings);
    if (el) last = el;
  }
  if (last) appendCommentIcon(last, c);
}

/** Tenta casar `text` (exato) e, falhando, sua versão sem markdown. */
function tryMatch(
  root: HTMLElement,
  text: string,
  c: TextComment,
  settings: PluginSettings
): HTMLElement | null {
  const el = wrapFirstOccurrence(root, text, c, settings);
  if (el) return el;
  const stripped = stripMarkdown(text);
  if (stripped && stripped !== text) {
    return wrapFirstOccurrence(root, stripped, c, settings);
  }
  return null;
}

/** Insere o ícone clicável (mesmo do editor) logo após o trecho realçado. */
function appendCommentIcon(afterEl: HTMLElement, c: TextComment): void {
  const next = afterEl.nextElementSibling;
  if (
    next &&
    next.classList.contains("text-comment-widget") &&
    next.getAttribute("data-comment-id") === c.id
  ) {
    return; // já existe (evita duplicar em reprocessamentos)
  }
  const icon = document.createElement("span");
  icon.className = "text-comment-widget" + (c.done ? " is-done" : "");
  icon.setAttribute("data-comment-id", c.id);
  icon.setAttribute("aria-label", c.body || "Comentário");
  setIcon(icon, "message-square");
  afterEl.insertAdjacentElement("afterend", icon);
}

/** Remove a sintaxe markdown que não aparece no texto renderizado. */
function stripMarkdown(s: string): string {
  return s
    .replace(/^\s*#{1,6}\s+/, "") // títulos
    .replace(/^\s*>+\s?/, "") // citação
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "") // lista
    .replace(/\*\*|__|~~|==/g, "") // negrito / tachado / realce
    .replace(/[*_`]/g, "") // ênfase / código
    .trim();
}

/**
 * Envolve a primeira ocorrência de `searchText` na DOM, mesmo que atravesse
 * vários nós de texto (ex.: uma frase com **negrito** no meio).
 * Retorna o `span` mais à direita do realce (ou null se não encontrou).
 */
function wrapFirstOccurrence(
  root: HTMLElement,
  searchText: string,
  c: TextComment,
  settings: PluginSettings
): HTMLElement | null {
  const quote = searchText;
  if (!quote) return null;

  // Coleta os nós de texto ainda não destacados, em ordem.
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.parentElement as HTMLElement | null)?.closest(".text-comment-highlight")) {
      continue;
    }
    nodes.push(node as Text);
  }

  const full = nodes.map((n) => n.nodeValue ?? "").join("");
  const idx = full.indexOf(quote);
  if (idx === -1) return null;
  const end = idx + quote.length;

  // Mapeia o intervalo global para segmentos (nó, início, fim) locais.
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  let pos = 0;
  for (const n of nodes) {
    const len = (n.nodeValue ?? "").length;
    const segStart = Math.max(idx, pos);
    const segEnd = Math.min(end, pos + len);
    if (segStart < segEnd) {
      segments.push({ node: n, start: segStart - pos, end: segEnd - pos });
    }
    pos += len;
    if (pos >= end) break;
  }

  const { color, done } = resolveHighlight(c, settings);

  // Envolve cada segmento (de trás para frente, para não invalidar offsets).
  // Como vamos da direita para a esquerda, o primeiro sucesso é o mais à direita.
  let rightmost: HTMLElement | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    try {
      const range = document.createRange();
      range.setStart(s.node, s.start);
      range.setEnd(s.node, s.end);
      const span = document.createElement("span");
      span.className = done
        ? "text-comment-highlight is-done"
        : "text-comment-highlight";
      span.setAttribute("data-comment-id", c.id);
      // Tooltip do Obsidian (segue o tema/tipografia), não o `title` nativo.
      if (c.body) span.setAttribute("aria-label", c.body);
      if (color) span.setAttribute("style", `--tc-color: ${color}`);
      range.surroundContents(span);
      if (!rightmost) rightmost = span;
    } catch {
      // Segmento inválido; ignora.
    }
  }
  return rightmost;
}

/** Converte um offset de caractere em número de linha (0-based). */
function offsetToLine(text: string, offset: number): number {
  let line = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Destaca brevemente um elemento ao navegar até ele. */
function flashElement(el: HTMLElement): void {
  el.classList.add("text-comment-flash");
  window.setTimeout(() => el.classList.remove("text-comment-flash"), 1200);
}

// -----------------------------------------------------------------------------
// Modal de edição
// -----------------------------------------------------------------------------

class CommentModal extends Modal {
  constructor(
    app: App,
    private initial: string,
    private onSubmit: (value: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Comentário" });

    const ta = contentEl.createEl("textarea", {
      cls: "text-comment-input",
    });
    ta.value = this.initial;
    ta.rows = 5;

    const row = contentEl.createDiv({ cls: "text-comment-modal-actions" });
    const save = row.createEl("button", { text: "Salvar", cls: "mod-cta" });
    save.onclick = () => {
      this.resolved = true;
      this.onSubmit(ta.value.trim());
      this.close();
    };
    const cancel = row.createEl("button", { text: "Cancelar" });
    cancel.onclick = () => this.close();

    window.setTimeout(() => ta.focus(), 0);
  }

  private resolved = false;

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.onSubmit(null);
  }
}

// -----------------------------------------------------------------------------
// Configurações
// -----------------------------------------------------------------------------

class TextCommentsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TextCommentsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Pasta de comentários")
      .setDesc(
        "Onde as notas de comentários serão gravadas. A pasta é mantida fora da busca e do quick-switcher automaticamente."
      )
      .addText((text) =>
        text
          .setPlaceholder("Comentários")
          .setValue(this.plugin.settings.commentsFolder)
          .onChange(async (value) => {
            this.plugin.settings.commentsFolder = value.trim() || "Comentários";
            await this.plugin.saveSettings();
            this.plugin.ensureExcludedFolder();
          })
      );

    new Setting(containerEl)
      .setName("Contexto da âncora")
      .setDesc(
        "Quantos caracteres antes/depois do trecho guardar para reencontrá-lo após edições."
      )
      .addSlider((slider) =>
        slider
          .setLimits(8, 80, 4)
          .setValue(this.plugin.settings.contextLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.contextLength = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Ordenação padrão do painel")
      .addDropdown((dd) =>
        dd
          .addOption("position-asc", "Posição ↑")
          .addOption("position-desc", "Posição ↓")
          .addOption("created-asc", "Mais antigos")
          .addOption("created-desc", "Mais recentes")
          .setValue(this.plugin.settings.defaultSort)
          .onChange(async (value) => {
            this.plugin.settings.defaultSort = value as PluginSettings["defaultSort"];
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Cores do realce" });

    this.colorSetting(
      containerEl,
      "Pendentes",
      "pendingColor",
      "Realce dos comentários ainda não concluídos. Vazio = padrão do tema.",
      "#ffd966"
    );

    this.colorSetting(
      containerEl,
      "Concluídos",
      "doneColor",
      "Realce dos comentários marcados como concluídos.",
      "#4caf50"
    );
  }

  /** Linha de configuração com seletor de cor + botão de reset ao tema. */
  private colorSetting(
    container: HTMLElement,
    name: string,
    key: "pendingColor" | "doneColor",
    desc: string,
    fallback: string
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings[key] || fallback)
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshAllHighlights();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Padrão do tema")
          .onClick(async () => {
            this.plugin.settings[key] = "";
            await this.plugin.saveSettings();
            this.plugin.refreshAllHighlights();
            this.display();
          })
      );
  }
}
