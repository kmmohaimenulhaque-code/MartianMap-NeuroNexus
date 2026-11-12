import catalogue from "./commands.json";

/*
 * Command registry: merges the static catalogue (labels, categories,
 * shortcuts, descriptions) with runtime handlers supplied by the app.
 *
 * handlers: { [commandId]: { run(), available?() → true | "reason why not" } }
 */

export const CATEGORIES = catalogue.categories;
export const COMMANDS = catalogue.commands;
export const TEAM_URL = COMMANDS.find((c) => c.id === "meet-the-team").url;

export function buildRegistry(handlers) {
  return COMMANDS.map((command) => {
    const handler = handlers[command.id];
    const verdict = handler?.available ? handler.available() : true;
    return {
      ...command,
      run: handler?.run ?? null,
      ok: Boolean(handler?.run) && verdict === true,
      reason: verdict === true ? (handler?.run ? null : "Not wired") : verdict,
    };
  });
}

export function missingHandlers(handlers) {
  return COMMANDS.filter((command) => !handlers[command.id]?.run).map((command) => command.id);
}

export function searchCommands(registry, query) {
  const q = query.trim().toLowerCase();
  if (!q) return registry;
  return registry.filter((c) => `${c.label} ${c.description ?? ""} ${c.where ?? ""} ${c.category}`.toLowerCase().includes(q));
}

/* Single-key shortcut → command id (only when no text field is focused). */
export const SHORTCUTS = Object.fromEntries(
  COMMANDS.filter((c) => c.shortcut && c.shortcut.length === 1).map((c) => [c.shortcut.toLowerCase(), c.id]),
);
