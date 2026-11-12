export const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々〆ヶヵ]/;
export const JP_RE = /[぀-ヿ㐀-鿿]/;
export const toKata = s => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
