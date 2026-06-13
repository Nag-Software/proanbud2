import { randomUUID } from "crypto"

export type GeneratedArticleSection = {
  type: "paragraph" | "h2" | "h3" | "bullet"
  text: string
}

function blockKey() {
  return randomUUID().replace(/-/g, "").slice(0, 12)
}

function span(text: string) {
  return {
    _type: "span" as const,
    _key: blockKey(),
    marks: [] as string[],
    text,
  }
}

function textBlock(text: string, style: "normal" | "h2" | "h3") {
  return {
    _type: "block" as const,
    _key: blockKey(),
    style,
    markDefs: [] as unknown[],
    children: [span(text)],
  }
}

function bulletBlock(text: string) {
  return {
    _type: "block" as const,
    _key: blockKey(),
    style: "normal" as const,
    listItem: "bullet" as const,
    level: 1,
    markDefs: [] as unknown[],
    children: [span(text)],
  }
}

export function sectionsToPortableText(sections: GeneratedArticleSection[]) {
  return sections
    .map((section) => {
      const text = section.text.trim()
      if (!text) return null

      switch (section.type) {
        case "h2":
          return textBlock(text, "h2")
        case "h3":
          return textBlock(text, "h3")
        case "bullet":
          return bulletBlock(text)
        default:
          return textBlock(text, "normal")
      }
    })
    .filter(Boolean)
}

export function slugifyTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
}
