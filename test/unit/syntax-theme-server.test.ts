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

  it("hands back the roles of the theme it highlighted with", async () => {
    const handler = await highlightHandler();
    const one = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "one" });
    const nord = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "nord" });
    const github = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: "github" });

    // The colours are what the theme files say, in whatever case they say them.
    const lower = (roles: SyntaxRoles | undefined) =>
      roles === undefined ? undefined : Object.fromEntries(
        Object.entries(roles).map(([role, color]) => [role, color.toLowerCase()]),
      );
    expect(lower(one.roles)).toMatchObject({ keyword: "#c678dd", comment: "#7f848e" });
    expect(lower(nord.roles)).toMatchObject({ keyword: "#81a1c1", comment: "#616e88" });
    // A palette belongs to one theme: the same request under another id differs.
    expect(nord.roles).not.toEqual(one.roles);
    // And a theme whose rules already match GitHub's answers with GitHub's colours.
    expect(github.roles).toBeDefined();
    for (const [role, color] of Object.entries(github.roles!)) {
      expect(color, role).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    }
  }, 30_000);

  it("tokenises the same text differently per theme", async () => {
    const handler = await highlightHandler();
    const ask = async (syntaxTheme: string) =>
      (await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme })).lines;
    expect(await ask("one")).not.toEqual(await ask("nord"));
  }, 30_000);
});

describe("show", () => {
  it("prints", async () => {
    const handler = await highlightHandler();
    for (const id of ["github", "one", "catppuccin", "gruvbox", "solarized", "tokyo-night", "nord", "dracula"]) {
      const answer = await handler({ code: CODE, language: "typescript", dark: true, syntaxTheme: id });
      console.log(id, answer.theme, JSON.stringify(answer.roles));
    }
    const light = await handler({ code: CODE, language: "typescript", dark: false, syntaxTheme: "one" });
    console.log("one-light", light.theme, JSON.stringify(light.roles));
  }, 30_000);
});
