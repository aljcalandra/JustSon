type Child = Node | string | number | null | undefined | false;
type Props = {
  class?: string;
  title?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
} & Record<string, unknown>;

/**
 * Element builder. Strings always become text nodes, never HTML, so document content
 * (keys and values from user JSON) can't inject markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (name === "class") el.className = value as string;
      else if (name === "dataset") Object.assign(el.dataset, value);
      else if (name === "attrs") {
        for (const [k, v] of Object.entries(value as Record<string, string>)) el.setAttribute(k, v);
      } else if (name === "on") {
        for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
          el.addEventListener(event, handler);
        }
      } else (el as unknown as Record<string, unknown>)[name] = value;
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function formatChars(chars: number): string {
  // localStorage stores UTF-16, so 2 bytes per char is the honest estimate of quota use.
  const bytes = chars * 2;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
