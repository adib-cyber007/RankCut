(function attachRankingLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RankingLayout = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRankingLayoutApi() {
  'use strict';

  const OUTPUT_WIDTH = 1080;
  const OUTPUT_HEIGHT = 1920;
  const TEXT_SAFE_LEFT = 90;
  const TEXT_SAFE_RIGHT = 990;
  const RANK_LEFT = 74;
  const GLYPH_WIDTHS = {
    A: .72, B: .72, C: .72, D: .72, E: .67, F: .61, G: .78, H: .72,
    I: .28, J: .50, K: .72, L: .56, M: .83, N: .72, O: .78, P: .67,
    Q: .78, R: .72, S: .67, T: .61, U: .72, V: .72, W: .94, X: .72,
    Y: .72, Z: .61, '0': .67, '1': .67, '2': .67, '3': .67, '4': .67,
    '5': .67, '6': .67, '7': .67, '8': .67, '9': .67, '.': .28,
  };

  function clampNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function measureTextWidth(text, fontSize) {
    return Math.max(
      fontSize * .34,
      Array.from(String(text || '')).reduce(
        (width, character) => width + (GLYPH_WIDTHS[character.toUpperCase()] || .56) * fontSize,
        0,
      ),
    );
  }

  function safeTokens(tokens, fallbackText) {
    const supplied = Array.isArray(tokens) ? tokens.filter((token) => String(token?.text || '').trim()) : [];
    if (supplied.length) return supplied.map((token) => ({ ...token, text: String(token.text) }));
    return String(fallbackText || '').trim().split(/\s+/).filter(Boolean).map((text) => ({ text, color: '#FFFFFF' }));
  }

  function wrapTokens(tokens, fontSize, maxWidth, fallbackText) {
    const words = safeTokens(tokens, fallbackText);
    const wordGap = Math.max(9, Math.round(fontSize * .18));
    const lines = [];
    let line = [];
    let lineWidth = 0;
    for (const token of words) {
      const width = measureTextWidth(token.text, fontSize);
      const nextWidth = line.length ? lineWidth + wordGap + width : width;
      if (line.length && nextWidth > maxWidth) {
        lines.push({ words: line, width: lineWidth });
        line = [];
        lineWidth = 0;
      }
      line.push({ ...token, width });
      lineWidth = lineWidth ? lineWidth + wordGap + width : width;
    }
    if (line.length) lines.push({ words: line, width: lineWidth });
    return { lines, wordGap };
  }

  function buildRankingLayout(clips, activeIndex, settings) {
    const items = Array.isArray(clips) ? clips : [];
    const count = Math.max(1, items.length);
    const currentIndex = Math.min(items.length - 1, Math.max(0, Number(activeIndex) || 0));
    const source = settings || items[0]?.list || {};
    const requestedSize = clampNumber(source.size, 60, 24, 110);
    const fontSize = Math.min(requestedSize, Math.max(24, Math.floor(760 / count)));
    const rankSize = Math.round(fontSize * .92);
    const lineHeight = Math.round(fontSize * 1.18);
    const baseRowHeight = Math.round(fontSize * 1.34);
    const rowGap = Math.max(3, Math.round(fontSize * .08));
    const labelPaddingX = Math.max(3, Math.round(fontSize * .06));
    const labelPaddingY = Math.max(2, Math.round(fontSize * .04));

    const entries = items.map((clip, index) => {
      const rankText = `${index + 1}.`;
      const rankWidth = measureTextWidth(rankText, rankSize);
      const rankGap = Math.max(4, Math.round(fontSize * .08));
      const opticalRankWidth = rankWidth - rankSize * .18;
      const titleLeft = Math.round(RANK_LEFT + opticalRankWidth + rankGap);
      const maxTextWidth = Math.max(120, TEXT_SAFE_RIGHT - titleLeft);
      const wrapped = wrapTokens(clip?.list?.tokens, fontSize, maxTextWidth, clip?.list?.text);
      const lineCount = Math.max(1, wrapped.lines.length);
      const labelHeight = lineCount * lineHeight + labelPaddingY * 2;
      const rowHeight = Math.max(baseRowHeight, labelHeight, rankSize);
      return {
        index,
        rank: index + 1,
        rankText,
        titleLeft,
        maxTextWidth,
        lines: wrapped.lines,
        wordGap: wrapped.wordGap,
        labelHeight,
        rowHeight,
        revealed: index >= currentIndex,
      };
    });

    const totalHeight = entries.reduce((sum, entry) => sum + entry.rowHeight, 0) + Math.max(0, entries.length - 1) * rowGap;
    const requestedTop = OUTPUT_HEIGHT * clampNumber(source.y, 73, 15, 92) / 100;
    const maxTop = Math.max(0, OUTPUT_HEIGHT * .91 - totalHeight);
    const top = Math.round(Math.min(requestedTop, maxTop));
    let cursor = top;
    for (const entry of entries) {
      entry.rowTop = cursor;
      entry.numberY = Math.round(cursor + (entry.rowHeight - rankSize) / 2);
      entry.labelY = Math.round(cursor + (entry.rowHeight - entry.labelHeight) / 2);
      entry.textY = entry.labelY + labelPaddingY;
      entry.boxLeft = entry.titleLeft - labelPaddingX;
      entry.boxRight = TEXT_SAFE_RIGHT + labelPaddingX;
      cursor += entry.rowHeight + rowGap;
    }

    return {
      outputWidth: OUTPUT_WIDTH,
      outputHeight: OUTPUT_HEIGHT,
      fontSize,
      rankSize,
      lineHeight,
      rowGap,
      labelPaddingX,
      labelPaddingY,
      rankLeft: RANK_LEFT,
      textSafeRight: TEXT_SAFE_RIGHT,
      top,
      totalHeight,
      activeIndex: currentIndex,
      entries,
    };
  }

  function buildTitleLayout(title) {
    const source = title || {};
    const fontSize = clampNumber(source.size, 78, 28, 140);
    const lineHeight = Math.round(fontSize * 1.18);
    const wrapped = wrapTokens(source.tokens, fontSize, TEXT_SAFE_RIGHT - TEXT_SAFE_LEFT, source.text);
    const boxX = 46;
    const textY = Math.round(OUTPUT_HEIGHT * clampNumber(source.y, 9, 0, 70) / 100);
    const boxY = Math.max(0, textY - 25);
    const boxHeight = Math.max(lineHeight + 46, wrapped.lines.length * lineHeight + 46);
    const align = ['left', 'right'].includes(source.align) ? source.align : 'center';
    const lines = wrapped.lines.map((line, index) => {
      const x = align === 'left'
        ? TEXT_SAFE_LEFT
        : align === 'right' ? TEXT_SAFE_RIGHT - line.width : (OUTPUT_WIDTH - line.width) / 2;
      return { ...line, x: Math.round(x), y: textY + index * lineHeight };
    });
    return {
      outputWidth: OUTPUT_WIDTH,
      outputHeight: OUTPUT_HEIGHT,
      fontSize,
      lineHeight,
      wordGap: wrapped.wordGap,
      align,
      boxX,
      boxY,
      boxWidth: 988,
      boxHeight,
      textY,
      lines,
    };
  }

  return {
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT,
    TEXT_SAFE_LEFT,
    TEXT_SAFE_RIGHT,
    RANK_LEFT,
    measureTextWidth,
    wrapTokens,
    buildTitleLayout,
    buildRankingLayout,
  };
}));
