import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

type HighlightAnswer = {
  lines: unknown[];
  language: string | null;
  theme: string;
  roles?: SyntaxRoles;
};

const rpc = vi.hoisted(() => ({
  call: vi.fn(async (_input: unknown): Promise<HighlightAnswer | null> => null),
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.call }));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({
  Icon: (await import("./helpers/rn-mock")).View,
  copyText: vi.fn(async (_text: string) => {}),
  useToast: () => ({ show: vi.fn(), error: vi.fn() }),
}));

import { buildThemeTokens } from "../../client/components/theme-tokens";
import { readSyntaxRoles } from "../../client/highlight";
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

/** Builds tokens the way a rendering component does, so the palette is current. */
async function draw(options?: Parameters<typeof buildThemeTokens>[2], highlight = false) {
  const tokens = buildThemeTokens(SURFACE, undefined, options);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    // `highlight: false` is what a streaming fence asks for: no daemon answer
    // can have arrived yet, so only the local tokeniser paints.
    renderer = TestRenderer.create(
      React.createElement(SyntaxHighlightBlock, { code: "const x = \"text\";", tokens, highlight }),
    );
  });
  return renderer;
}

afterEach(() => {
  rpc.call.mockReset();
  rpc.call.mockImplementation(async () => null);
});

describe("a streaming fence follows the reader's syntax theme", () => {
  it("draws with the palette the tokens were built from", async () => {
    const plain = await draw();
    expect(paintedColours(plain)).toContain("#f47067");
    act(() => plain.unmount());

    const themed = await draw({ syntaxTheme: "nord", syntaxRoles: NORD });
    const colours = paintedColours(themed);
    expect(colours).toContain(NORD.keyword.toLowerCase());
    expect(colours).not.toContain("#f47067");
    act(() => themed.unmount());
  });

  it("learns the palette from a finished block and keeps it", async () => {
    rpc.call.mockImplementation(async () => ({
      lines: [], language: null, theme: "nord" as const, roles: NORD,
    }));

    // A streaming fence has no answer to learn from yet, so the theme tokens it
    // draws with carry no palette.
    expect(readSyntaxRoles("nord", true)).toBeNull();

    // A closed fence asks for tokens, and its answer carries the six colours.
    const finished = await draw({ syntaxTheme: "nord" }, true);
    act(() => finished.unmount());

    expect(readSyntaxRoles("nord", true)).toEqual(NORD);
    // One ask for tokens, and no extra round trip hunting for the palette alone.
    expect(rpc.call.mock.calls.every(([request]) => (request as { code?: string }).code !== "")).toBe(true);
  });
});
