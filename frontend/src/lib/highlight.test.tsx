import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { highlightFindOccurrences, renderHighlightedText } from "./highlight";

describe("renderHighlightedText", () => {
  it("单段文本按字符拆 span", () => {
    const html = renderToStaticMarkup(renderHighlightedText("你好", null));
    expect(html).toBe("<p class=\"rt-para\"><span class=\"char\">你</span><span class=\"char\">好</span></p>");
  });

  it("空行分段成多个 <p>", () => {
    const html = renderToStaticMarkup(renderHighlightedText("第一段\n\n第二段", null));
    expect(html).toContain("<p class=\"rt-para\">");
    // 保留中间的空段落
    const paragraphs = html.match(/<p class="rt-para">/g);
    expect(paragraphs).toHaveLength(3);
  });

  it("高亮范围内的字符加 char--active", () => {
    const html = renderToStaticMarkup(renderHighlightedText("abc", { start: 1, end: 2 }));
    expect(html).toBe(
      '<p class="rt-para"><span class="char">a</span><span class="char char--active">b</span><span class="char">c</span></p>',
    );
  });

  it("跨段落的字符索引连续", () => {
    // "ab\n\ncd"：a=0, b=1, c=4, d=5（两个 \n 各占索引）
    const html = renderToStaticMarkup(renderHighlightedText("ab\n\ncd", { start: 4, end: 5 }));
    expect(html).toContain('<span class="char char--active">c</span>');
    expect(html).not.toContain('char--active">d');
  });
});

describe("highlightFindOccurrences", () => {
  it("空 query 返回原文", () => {
    const result = highlightFindOccurrences("你好世界", "");
    expect(result).toBe("你好世界");
  });

  it("匹配处用 mark 高亮", () => {
    // split("你好") → ["", "世界", ""]，每个片段一个 <span>，片段间补 <mark>；
    // 末尾空片段会产生一个空 <span>（无害，是 split 的固有结果）。
    const html = renderToStaticMarkup(highlightFindOccurrences("你好世界你好", "你好"));
    expect(html).toBe(
      '<span><mark class="find-highlight">你好</mark></span><span>世界<mark class="find-highlight">你好</mark></span><span></span>',
    );
  });

  it("无匹配时原样输出", () => {
    const html = renderToStaticMarkup(highlightFindOccurrences("abc", "zzz"));
    expect(html).toBe("<span>abc</span>");
  });
});

it("single newline creates a paragraph and emoji keeps UTF-16 highlight offsets", () => {
  const html = renderToStaticMarkup(renderHighlightedText("😀\n甲乙", {start: 3, end: 4}));
  expect(html.match(/<p class="rt-para">/g)).toHaveLength(2);
  expect(html).toContain('<span class="char">😀</span>');
  expect(html).toContain('<span class="char char--active">甲</span>');
});
