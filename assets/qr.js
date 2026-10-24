/**
 * 二维码生成（基于内置 MIT 版 qrcode-generator，纯前端，不依赖任何 CDN）。
 * 输出：SVG 字符串（清晰、可缩放）与 PNG Blob（便于保存/打印）。
 */
import qrcode from './vendor/qrcode.mjs';

const LEVEL = { L: 'L', M: 'M', Q: 'Q', H: 'H' };

export function createQrMatrix(text, level = 'M') {
  const qr = qrcode(0, LEVEL[level] || 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const dark = (r, c) => qr.isDark(r, c);
  return { count, dark };
}

/**
 * 生成 SVG 字符串。
 */
export function qrSvg(text, { level = 'M', cell = 8, margin = 2, dark = '#0f172a', light = '#ffffff' } = {}) {
  const { count, dark: isDark } = createQrMatrix(text, level);
  const size = (count + margin * 2) * cell;
  const rects = [];
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (isDark(r, c)) {
        rects.push(
          `<rect x="${(c + margin) * cell}" y="${(r + margin) * cell}" width="${cell}" height="${cell}"/>`
        );
      }
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`,
    `<rect width="${size}" height="${size}" fill="${light}"/>`,
    `<g fill="${dark}">${rects.join('')}</g>`,
    '</svg>'
  ].join('');
}

/** 生成 PNG Blob（用于下载/保存到仓库） */
export function qrPngBlob(text, { level = 'M', cell = 10, margin = 2 } = {}) {
  const { count, dark: isDark } = createQrMatrix(text, level);
  const size = (count + margin * 2) * cell;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** SVG 字符串 → Blob */
export function svgBlob(svg) {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}
