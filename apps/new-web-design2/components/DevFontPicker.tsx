"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type FontOption = {
  family: string;
  category: string;
  weights: string[];
};

const STORAGE_KEY = "leash-dev-font-v2";
const FONT_LINK_ID = "leash-dev-google-font";
const PREVIEW_LINK_ID = "leash-dev-google-font-previews";
const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
const RESULT_LIMIT = 60;

function encodeFamily(family: string) {
  return encodeURIComponent(family).replace(/%20/g, "+");
}

function upsertFontLink(id: string, href: string) {
  const existingLink = document.getElementById(id);
  const link = existingLink instanceof HTMLLinkElement ? existingLink : document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  if (!link.isConnected) document.head.appendChild(link);
}

function applyFont(font: FontOption | { family: string; weights: string[] }) {
  const root = document.documentElement;

  if (font.family === "system") {
    document.getElementById(FONT_LINK_ID)?.remove();
    root.style.setProperty("--font-sans", SYSTEM_STACK);
    return;
  }

  if (font.family === "Akt") {
    document.getElementById(FONT_LINK_ID)?.remove();
    root.style.setProperty("--font-sans", `"Akt", ${SYSTEM_STACK}`);
    return;
  }

  const weightSpec = font.weights.length ? `:wght@${font.weights.join(";")}` : "";
  const href = `https://fonts.googleapis.com/css2?family=${encodeFamily(font.family)}${weightSpec}&display=swap`;
  upsertFontLink(FONT_LINK_ID, href);
  root.style.setProperty("--font-sans", `"${font.family}", ${SYSTEM_STACK}`);
}

export function DevFontPicker() {
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [selectedFont, setSelectedFont] = useState("Akt");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedFont = window.localStorage.getItem(STORAGE_KEY) ?? "Akt";
    setSelectedFont(savedFont);
    applyFont({ family: savedFont, weights: [] });

    const controller = new AbortController();
    fetch("/api/dev-fonts", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load Google Fonts");
        return response.json() as Promise<{ families: FontOption[] }>;
      })
      .then(({ families }) => setFonts(families))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadFailed(true);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedFont === "system") return;
    const selected = fonts.find((font) => font.family === selectedFont);
    if (selected) applyFont(selected);
  }, [fonts, selectedFont]);

  useEffect(() => {
    if (open) window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const visibleFonts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = normalizedQuery
      ? fonts.filter((font) => font.family.toLocaleLowerCase().includes(normalizedQuery))
      : fonts;
    return matches.slice(0, RESULT_LIMIT);
  }, [fonts, query]);

  const previewKey = visibleFonts.map((font) => font.family).join("|");

  useEffect(() => {
    if (!open || !previewKey) {
      document.getElementById(PREVIEW_LINK_ID)?.remove();
      return;
    }

    const familyParams = previewKey
      .split("|")
      .map((family) => `family=${encodeFamily(family)}`)
      .join("&");
    upsertFontLink(PREVIEW_LINK_ID, `https://fonts.googleapis.com/css2?${familyParams}&display=swap`);
  }, [open, previewKey]);

  const chooseFont = (font: FontOption | { family: "system"; category: string; weights: string[] }) => {
    setSelectedFont(font.family);
    window.localStorage.setItem(STORAGE_KEY, font.family);
    applyFont(font);
    setOpen(false);
    setQuery("");
  };

  return (
    <aside className={`dev-font-lab ${open ? "dev-font-lab--open" : ""}`} aria-label="Development font selector">
      <button
        className="dev-font-lab__trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dev-font-lab__glyph">Aa</span>
        <span><small>Font lab</small><b>{selectedFont === "system" ? "System / Apple" : selectedFont}</b></span>
        <i aria-hidden="true">{open ? "−" : "+"}</i>
      </button>

      {open ? (
        <div className="dev-font-browser">
          <div className="dev-font-browser__head">
            <label htmlFor="dev-font-search">Search Google Fonts</label>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close font browser">×</button>
          </div>
          <input
            ref={searchRef}
            id="dev-font-search"
            type="search"
            value={query}
            placeholder={`Search ${fonts.length ? fonts.length.toLocaleString() : "all"} families…`}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="dev-font-browser__meta">
            <span>{fonts.length ? `${fonts.length.toLocaleString()} Google Fonts` : loadFailed ? "Could not load fonts" : "Loading fonts…"}</span>
            <span>Showing {visibleFonts.length}</span>
          </div>
          <div className="dev-font-browser__list" role="listbox" aria-label="Google Font families">
            <button
              className={`dev-font-option ${selectedFont === "system" ? "dev-font-option--selected" : ""}`}
              type="button"
              role="option"
              aria-selected={selectedFont === "system"}
              onClick={() => chooseFont({ family: "system", category: "Native", weights: [] })}
            >
              <span style={{ fontFamily: SYSTEM_STACK }}>System / Apple</span><small>Native</small>
            </button>
            {visibleFonts.map((font) => (
              <button
                className={`dev-font-option ${selectedFont === font.family ? "dev-font-option--selected" : ""}`}
                type="button"
                role="option"
                aria-selected={selectedFont === font.family}
                key={font.family}
                onClick={() => chooseFont(font)}
              >
                <span style={{ fontFamily: `"${font.family}", sans-serif` }}>{font.family}</span>
                <small>{font.category || "Google Font"}</small>
              </button>
            ))}
          </div>
          {!query && fonts.length > RESULT_LIMIT ? <p>Type to search the complete catalog.</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
