import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import type { SyntaxRoles } from "../../shared/highlight-rpc";

interface Answer {
  lines: unknown[];
  language: string | null;
  theme: string;
  roles?: SyntaxRoles;
}

type Handler = (input: unknown) => Promise<Answer>;

/** Theme files spell their hexes in either case; fixtures do not care. */
function lowerCaseRoles(roles: SyntaxRoles | undefined): Record<keyof SyntaxRoles, string> | undefined {
  return roles === undefined
    ? undefined
    : (Object.fromEntries(Object.entries(roles).map(([role, color]) => [role, color.toLowerCase()])) as Record<keyof SyntaxRoles, string>);
}

/** The daemon's `highlight` handler, out of the route the plugin registers. */
async function highlightHandler(): Promise<Handler> {
  const { default: contribute } = await import("../../index.server");
  const handlers = new Map<string, Handler>();
  const server = new Proxy({}, {
    get: (_, key) => key === "registerSettings"
      ? () => ({ read: async () => ({ status: "invalid", revision: "test", error: "test" }), subscribe: () => () => {} })
      : key === "handle"
        ? (contract: { name: string }, handler: Handler) => handlers.set(contract.name, handler)
        : () => () => {},
  }) as PluginServerContext;
  contribute(server);
  return handlers.get("highlight.tokens")!;
}

const CODE = 'const x = 1;\nobj.method("text");\n// a comment';

describe("the daemon follows Paseo's syntax theme", () => {
  it("answers the GitHub pair and no roles for a client that names none", async () => {
    const handler = await highlightHandler();
    const answer = await handler({ code: CODE, language: "typescript", dark: true });
    expect(answer.theme).toBe("github-dark-default");
    expect(answer.roles).toBeUndefined();
    // The same theme named explicitly does carry colours, so an id that maps to
    // the pair the engine already loaded is not a special case.
    await expect(handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "github" }))
      .resolves.toMatchObject({ theme: "github-dark-default", roles: { keyword: expect.any(String) } });
  }, 30_000);

  it.each([
    ["one", "dark", "one-dark-pro"],
    ["catppuccin", "light", "catppuccin-latte"],
    ["gruvbox", "dark", "gruvbox-dark-medium"],
    ["solarized", "light", "solarized-light"],
    ["tokyo-night", "dark", "tokyo-night"],
    // Shiki ships no light flavour for these three, so the scheme keeps GitHub.
    ["nord", "light", "github-light-default"],
    ["dracula", "light", "github-light-default"],
    // An id from a newer host than this table.
    ["unknown-id", "dark", "github-dark-default"],
  ] as const)("maps %s (%s) to %s", async (syntaxTheme, scheme, theme) => {
    const answer = await (await highlightHandler())({
      code: CODE,
      language: "typescript",
      dark: scheme === "dark",
      syntaxTheme,
    });
    expect(answer.theme).toBe(theme);
  }, 30_000);

  it("hands back the palette it highlighted with, per theme", async () => {
    const handler = await highlightHandler();
    // Golden values, read off a highlighted sample of `const x = 1; // c
    // obj.member = call("s")` for each theme. They catch a derivation that falls
    // back to a theme's generic colours, which is how a mid-stream block ends up
    // a different colour from the finished one.
    const expected: Record<string, SyntaxRoles> = {
      github: { keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", property: "#79c0ff", function: "#d2a8ff" },
      one: { keyword: "#c678dd", string: "#98c379", number: "#d19a66", comment: "#7f848e", property: "#e06c75", function: "#61afef" },
      catppuccin: { keyword: "#cba6f7", string: "#a6e3a1", number: "#fab387", comment: "#9399b2", property: "#fab387", function: "#89b4fa" },
      gruvbox: { keyword: "#fe8019", string: "#b8bb26", number: "#d3869b", comment: "#928374", property: "#83a598", function: "#fabd2f" },
      solarized: { keyword: "#93a1a1", string: "#2aa198", number: "#d33682", comment: "#586e75", property: "#268bd2", function: "#268bd2" },
      "tokyo-night": { keyword: "#9d7cd8", string: "#9ece6a", number: "#ff9e64", comment: "#51597d", property: "#ff9e64", function: "#7aa2f7" },
      nord: { keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", comment: "#616e88", property: "#d8dee9", function: "#88c0d0" },
      dracula: { keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", comment: "#6272a4", property: "#bd93f9", function: "#50fa7b" },
    };
    for (const [syntaxTheme, want] of Object.entries(expected)) {
      // Theme files disagree about hex case, so compare without it.
      const answer = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme });
      expect(lowerCaseRoles(answer.roles), syntaxTheme).toEqual(want);
    }
    // The light scheme resolves through the same table, and an id with no light
    // flavour really does come back with GitHub Light's colours.
    expect(lowerCaseRoles((await handler({ code: CODE, language: "typescript", dark: false, syntaxTheme: "catppuccin" })).roles))
      .toMatchObject({ keyword: "#8839ef", function: "#1e66f5" });
    expect(lowerCaseRoles((await handler({ code: CODE, language: "typescript", dark: false, syntaxTheme: "nord" })).roles))
      .toEqual(lowerCaseRoles((await handler({ code: CODE, language: "typescript", dark: false, syntaxTheme: "github" })).roles));
    // A palette belongs to one theme: the same request under another id differs.
    const one = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "one" });
    const nord = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "nord" });
    expect(nord.roles).not.toEqual(one.roles);
  }, 60_000);

  it("names no palette for a theme it cannot match", async () => {
    const handler = await highlightHandler();
    // Highlighting still follows GitHub, but the client is not told those are the
    // colours of the id it asked for, so it keeps its own fallback instead.
    const answer = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "from-a-newer-host" });
    expect(answer.theme).toBe("github-dark-default");
    expect(answer.roles).toBeUndefined();
  }, 30_000);

  it("tokenises the same text differently per theme", async () => {
    const handler = await highlightHandler();
    const ask = async (syntaxTheme: string) =>
      (await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme })).lines;
    expect(await ask("one")).not.toEqual(await ask("nord"));
  }, 30_000);
});
