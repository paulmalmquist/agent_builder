import { parseRequestedSelfTestWidths, rectanglesOverlap } from './selftest-runner';

describe('self-test runner primitives', () => {
  it('selects one supported matrix width without accepting arbitrary values', () => {
    expect(parseRequestedSelfTestWidths('390')).toEqual([390]);
    expect(parseRequestedSelfTestWidths('768')).toEqual([768]);
    expect(parseRequestedSelfTestWidths('1440')).toEqual([1440]);
    expect(parseRequestedSelfTestWidths('391')).toEqual([390, 768, 1440]);
    expect(parseRequestedSelfTestWidths(null)).toEqual([390, 768, 1440]);
  });

  it('requires positive rendered area before declaring a rectangle collision', () => {
    const left = new DOMRect(0, 0, 44, 44);
    expect(rectanglesOverlap(left, new DOMRect(44, 0, 44, 44))).toBe(false);
    expect(rectanglesOverlap(left, new DOMRect(43, 12, 44, 44))).toBe(true);
  });
});
