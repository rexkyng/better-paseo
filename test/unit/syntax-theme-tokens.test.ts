import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import type { SyntaxRoles } from "../../shared/highlight-rpc";

const SURFACE = {
  surface0: "#0f1115",
  surface1: "#16191f",
  surface2: "#1d2128",
  border: "#2a2f37",
  foreground: "#e6e8eb",
  foregroundMuted: "#9aa1ab",
  accent: "#4f8cff",
  accentForeground: "#ffffff",
  statusSuccess: "#4cb782",
  statusWarning: "#d9a53f",
  statusDanger: "#e5484d",
};

/** Nord's own colours, as the daemon sends them. */
const NORD: SyntaxRoles = {
  keyword: "#81a1c1",
  string: "#a3be8c",
  number: "#b48ead",
  comment: "#616e88",
  property: "#88c0d0",
  function: "#88c0d0",
};

describe("the local tokeniser follows the reader's syntax theme", () => {
  it("names a palette before any answer has arrived", () => {
    // Without this the first fences of a fresh session drew the built-in GitHub
    // pair until some block finished and reported the theme's colours.
    expect(buildThemeTokens(SURFACE, undefined, { syntaxTheme: "tokyo-night" }).syntax.keyword).toBe("#9d7cd8");
    expect(buildThemeTokens({ ...SURFACE, surface0: "#fbfcfd" }, undefined, { syntaxTheme: "one" }).syntax.keyword)
      .toBe("#a626a4");
    // A family Shiki ships no light flavour for follows the daemon's mapping.
    expect(buildThemeTokens({ ...SURFACE, surface0: "#fbfcfd" }, undefined, { syntaxTheme: "nord" }).syntax.keyword)
      .toBe("#cf222e");
  });

  it("draws every role from the palette the daemon answered with", () => {
    // What the daemon reported for `property` differs from the copied table,
    // so this also pins the order of trust.
    const syntax = buildThemeTokens(SURFACE, undefined, { syntaxTheme: "nord", syntaxRoles: NORD }).syntax;
    expect(syntax).toMatchObject(NORD);
  });

  it("keeps diff tints on the host's status colours, not the syntax theme", () => {
    const github = buildThemeTokens(SURFACE).syntax;
    const nord = buildThemeTokens(SURFACE, undefined, { syntaxTheme: "nord", syntaxRoles: NORD }).syntax;
    expect(nord.diffAddBg).toBe(github.diffAddBg);
    expect(nord.diffRemoveBg).toBe(github.diffRemoveBg);
    expect(nord.hunk).toBe(github.hunk);
  });

  it("names the theme it was built for, and Paseo's default when told nothing", () => {
    expect(buildThemeTokens(SURFACE).syntaxTheme).toBe("one");
    expect(buildThemeTokens(SURFACE, undefined, { syntaxTheme: "gruvbox" }).syntaxTheme).toBe("gruvbox");
  });
});
