import { h } from "./dom";

interface ModalOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** In-page confirm; resolves true only when confirmed. Esc, Cancel and backdrop clicks resolve false. */
export function confirmModal(opts: ModalOptions): Promise<boolean> {
  return open(opts, null).then((v) => v !== null);
}

/** In-page text prompt; resolves the trimmed value, or null if cancelled or left empty. */
export function promptModal(opts: ModalOptions & { value?: string; label?: string }): Promise<string | null> {
  const input = h("input", { type: "text", value: opts.value ?? "", attrs: { "aria-label": opts.label ?? opts.title } });
  return open(opts, input).then((v) => (v === null ? null : v.trim() || null));
}

function open(opts: ModalOptions, input: HTMLInputElement | null): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const confirm = h(
      "button",
      { type: "submit", class: opts.danger ? "danger-solid" : "", value: "ok" },
      opts.confirmLabel ?? "OK",
    );
    const dialog = h(
      "dialog",
      { class: "modal" },
      h(
        "form",
        {
          method: "dialog",
          on: {
            submit: (e) => {
              const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
              // Enter in the text field submits with no submitter; treat it as OK.
              if (!submitter || submitter.value === "ok") result = input ? input.value : "";
            },
          },
        },
        h("h2", null, opts.title),
        opts.message ? h("p", null, opts.message) : null,
        input,
        h(
          "div",
          { class: "actions" },
          h("button", { type: "submit", class: "secondary", value: "cancel" }, "Cancel"),
          confirm,
        ),
      ),
    );
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    if (input) {
      input.focus();
      input.select();
    } else {
      confirm.focus();
    }
  });
}
