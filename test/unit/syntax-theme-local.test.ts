import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const rpc = vi.hoisted(() => ({ call: vi.fn((_input: unknown) => Promise.resolve(null)) }));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.call }));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({
  Icon: (await import("./helpers/rn-mock")).View,
  copyText: vi.fn(async (_text: string) => {}),
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SyntaxHighlightBlock } from "../../client/components/syntax-highlight";
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

const NORD: SyntaxRoles = {
  keyword: "#81a1c1",
  string: "#a3be8c",
  number: "#b48ead",
  comment: "#616e88",
  property: "#88c0d0",
  function: "#88c0d0",
};

/** Every colour the block painted, whatever role carried it. */
function paintedColours(renderer: ReactTestRenderer): string[] {
  const found: string[] = [];
  for (const node of renderer.root.findAll((n) => (n.type as unknown) === "Text")) {
    const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
    for (const style of styles) {
      const color = (style as { color?: string } | undefined)?.color;
      if (typeof color === "string") found.push(color.toLowerCase());
    }
  }
  return found;
}

async function draw(tokens: ReturnType<typeof buildThemeTokens>) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    // `highlight: false` is what a streaming fence asks for: no daemon answer
    // can have arrived yet, so only the local tokeniser paints.
    renderer = TestRenderer.create(
      React.createElement(SyntaxHighlightBlock, { code: "const x = \"text\";", tokens, highlight: false }),
    );
  });
  return renderer;
}

afterEach(() => {
  rpc.call.mockClear();
});

describe("a streaming fence follows the reader's syntax theme", () => {
  it("draws its keywords with the palette the daemon named", async () => {
    const plain = await draw(buildThemeTokens(SURFACE));
    expect(paintedColours(plain)).toContain("#f47067");
    act(() => plain.unmount());

    rpc.call.mockClear();
    const themed = await draw(buildThemeTokens(SURFACE, undefined, { syntaxTheme: "nord", syntaxRoles: NORD }));
    const colours = paintedColours(themed);
    expect(colours).toContain(NORD.keyword.toLowerCase());
    expect(colours).not.toContain("#f47067");
    act(() => themed.unmount());
  });

  it("asks for the palette once per theme, with nothing to tokenise", async () => {
    const asked = () =>
      rpc.call.mock.calls.map(([request]) => request as { code: string; language?: string; syntaxTheme?: string });
    const gruvbox = buildThemeTokens(SURFACE, undefined, { syntaxTheme: "gruvbox" });
    const first = await draw(gruvbox);
    const second = await draw(gruvbox);
    expect(asked().filter((r) => r.syntaxTheme === "gruvbox")).toEqual([
      { code: "", language: "text", dark: true, syntaxTheme: "gruvbox" },
    ]);
    act(() => first.unmount());
    act(() => second.unmount());
  });
});
