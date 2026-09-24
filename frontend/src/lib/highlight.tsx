import type { ReactNode } from "react";

// Render each explicit newline as a paragraph, preserving
// per-character highlight spans. Char indices stay aligned with segment.text so
// the playback highlight keeps matching after the text is split into paragraphs.
export function renderHighlightedText(
  text: string,
  highlightRange: { start: number; end: number } | null,
): ReactNode {
  const parts = text.split(/(\n)/);
  let charOffset = 0;
  return parts.map((part, partIndex) => {
    const isSeparator = partIndex % 2 === 1;
    if (isSeparator) {
      charOffset += part.length;
      return null;
    }
    const paragraphStart = charOffset;
    charOffset += part.length;
    let localOffset = 0;
    return (
      <p className="rt-para" key={partIndex}>
        {part.length === 0 ? <br /> : null}
        {Array.from(part).map((character, charIndex) => {
          const globalIndex = paragraphStart + localOffset;
          localOffset += character.length;
          const active =
            highlightRange !== null &&
            globalIndex >= highlightRange.start &&
            globalIndex < highlightRange.end;
          return (
            <span key={charIndex} className={active ? "char char--active" : "char"}>
              {character}
            </span>
          );
        })}
      </p>
    );
  });
}

/** 只读/查找场景：把文本中所有 query 匹配用 <mark> 高亮（无 textarea 可选中时的替代高亮）。 */
export function highlightFindOccurrences(text: string, query: string): ReactNode {
  if (!query) return text;
  const parts = text.split(query);
  return parts.map((part, index) => (
    <span key={index}>
      {part}
      {index < parts.length - 1 ? <mark className="find-highlight">{query}</mark> : null}
    </span>
  ));
}
