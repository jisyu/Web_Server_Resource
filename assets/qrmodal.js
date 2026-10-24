/**
 * 二维码弹窗：展示/保存/复制某资源的扫码地址与直下链接。
 */
import { el, copyText, toast, downloadBlob, sanitizeFileName } from './util.js';
import { qrSvg, qrPngBlob } from './qr.js';

/**
 * @param {object} opts { title, pageUrl, directUrl, fileName }
 */
export function openQrModal(opts) {
  const { title, pageUrl, directUrl, fileName } = opts;
  const mask = el('div.modal-mask');

  const svg = qrSvg(pageUrl, { cell: 8, margin: 2 });
  const qrBox = el('div.qr-box');
  const svgWrap = el('div.qr-svg');
  svgWrap.innerHTML = svg; // 内容由本地生成，非用户输入，可安全插入
  qrBox.append(svgWrap);

  const btnDirect = el('button.btn.btn-primary', {
    text: '下载 PNG',
    onclick: async () => {
      const blob = await qrPngBlob(pageUrl, { cell: 12 });
      downloadBlob(blob, `${sanitizeFileName(fileName || 'qrcode')}-qrcode.png`);
    }
  });

  const btnSvg = el('button.btn.btn-ghost', {
    text: '下载 SVG',
    onclick: () =>
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${sanitizeFileName(fileName || 'qrcode')}.svg`)
  });

  const btnCopyPage = el('button.btn.btn-ghost', {
    text: '复制扫码链接',
    onclick: async () => {
      const ok = await copyText(pageUrl);
      toast(ok ? '扫码链接已复制' : '复制失败，请手动选择', ok ? 'ok' : 'error');
    }
  });

  const btnCopyDirect = el('button.btn.btn-ghost', {
    text: '复制直下链接',
    onclick: async () => {
      const ok = await copyText(directUrl);
      toast(ok ? '直下链接已复制' : '复制失败，请手动选择', ok ? 'ok' : 'error');
    }
  });

  const card = el('div.modal.modal-qr', null,
    el('h3', { text: title || '二维码' }),
    qrBox,
    el('p.modal-tip', { text: '扫码后打开下载页；也可直接用“直下链接”扫码即下载' }),
    el('div.url-list', null,
      el('label', { text: '扫码链接' }),
      el('input.input', { readonly: true, value: pageUrl, onclick: (e) => e.target.select() }),
      el('label', { text: '直下链接' }),
      el('input.input', { readonly: true, value: directUrl, onclick: (e) => e.target.select() })
    ),
    el('div.modal-actions', null, btnCopyPage, btnCopyDirect, btnSvg, btnDirect,
      el('button.btn.btn-ghost', { text: '关闭', onclick: () => mask.remove() })
    )
  );

  mask.append(card);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) mask.remove();
  });
  document.body.append(mask);
  return mask;
}
