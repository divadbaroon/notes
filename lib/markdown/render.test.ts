import { describe, it, expect } from "vitest";
import { renderNoteBody } from "./render";

const titles = { evergreen: "Evergreen notes", insight: "Insight accumulates" };

describe("renderNoteBody", () => {
  it("renders a paragraph with bold and italic", () => {
    expect(renderNoteBody("Hello **bold** and *italic*")).toBe(
      "<p>Hello <strong>bold</strong> and <em>italic</em></p>"
    );
  });

  it("renders [[slug]] as an internal link using the live title", () => {
    expect(renderNoteBody("See [[evergreen]] now", titles)).toBe(
      '<p>See <a href="/evergreen" data-slug="evergreen">Evergreen notes</a> now</p>'
    );
  });

  it("renders [alias](slug) with the alias text", () => {
    expect(renderNoteBody("[the leverage](insight)", titles)).toBe(
      '<p><a href="/insight" data-slug="insight">the leverage</a></p>'
    );
  });

  it("marks unknown internal targets as missing", () => {
    expect(renderNoteBody("[x](ghost)", titles)).toBe(
      '<p><a href="/ghost" data-slug="ghost" data-missing="1">x</a></p>'
    );
  });

  it("renders external links in a new tab", () => {
    expect(renderNoteBody("[site](https://papertlab.org)")).toBe(
      '<p><a href="https://papertlab.org" target="_blank" rel="noopener">site</a></p>'
    );
  });

  it("renders an h2 from a single hash (prototype mapping)", () => {
    expect(renderNoteBody("# Heading")).toBe("<h2>Heading</h2>");
  });

  it("escapes HTML in text", () => {
    expect(renderNoteBody("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });
});
