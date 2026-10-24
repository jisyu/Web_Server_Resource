/** 资源详情页（扫码落地页） */
import { el, fmtSize, fmtDate, toast, copyText, downloadBlob, sanitizeFileName } from '../util.js';
import { CATEGORY_LABEL, fileUrls, primaryDownloadUrl, pageUrl } from '../config.js';
import { loadManifest } from '../store.js';
import { qrSvg, qrPngBlob } from '../qr.js';

export async function renderResource(root, params) {
  const id = decodeURIComponent(params[0] || '');
  const data = await loadManifest();
  const item = data.items.find((i) => i.id === id);

  if (!item) {
    root.append(
      el('div.empty', null,
        el('h2', { text: '资源不存在' }),
        el('p', { text: `未找到标识为 ${id} 的资源，可能已被删除。` }),
        el('a.btn.btn-primary', { href: '#/', text: '回到首页' })
      )
    );
    return;
  }

  const urls = fileUrls(item.path);
  const mainUrl = primaryDownloadUrl(item.path, item.size);
  const tooBig = item.size > 50 * 1024 * 1024;

  const linkRow = (label, url) =>
    el('div.link-item', null,
      el('span', { text: `${label}：${url}` }),
      el('button.btn.btn-sm.btn-ghost', {
        text: '复制',
        onclick: async () => {
          const ok = await copyText(url);
          toast(ok ? '已复制链接' : '复制失败', ok ? 'ok' : 'error');
        }
      })
    );

  const qrWrap = el('div.qr-svg');
  qrWrap.innerHTML = qrSvg(pageUrl(item.id), { cell: 8, margin: 2 });

  const meta = [];
  if (item.version) meta.push(`版本 ${item.version}`);
  meta.push(fmtSize(item.size));
  meta.push(`更新于 ${fmtDate(item.updatedAt)}`);
  meta.push(CATEGORY_LABEL[item.category] || item.category);

  root.append(
    el('div.detail', null,
      el('div.detail-main', null,
        el('div.detail-title', null,
          el('h1', { text: item.name }),
          el('span.badge.badge-cat', { text: CATEGORY_LABEL[item.category] || item.category }),
          item.pinned ? el('span.badge.badge-pinned', { text: '置顶' }) : null,
          item.visible ? null : el('span.badge.badge-hidden', { text: '已隐藏' })
        ),
        el('div.meta-row', null, ...meta.map((m) => el('span', { text: m }))),
        item.description ? el('p', { text: item.description }) : null,
        item.releaseNotes ? el('div.detail-notes', { text: item.releaseNotes }) : null,
        item.tags && item.tags.length
          ? el('div.tag-row', null, ...item.tags.map((t) => el('span.badge', { text: `#${t}` })))
          : null,
        el('div.download-hero', null,
          el('a.btn.btn-primary', {
            href: mainUrl,
            text: `下载 ${item.fileName || item.name}`,
            download: item.fileName || '',
            target: '_blank',
            rel: 'noopener'
          }),
          tooBig ? el('p.modal-tip', { text: '文件较大，已使用 raw 直链；若下载慢可换用备用链接。' }) : null
        ),
        el('div.link-list', null,
          el('h4', { text: '备用链接' }),
          linkRow('CDN', urls.cdn),
          linkRow('Raw', urls.raw),
          linkRow('文件名', item.fileName || '-')
        )
      ),
      el('aside.qr-panel', null,
        el('h3', { text: '扫码下载' }),
        qrWrap,
        el('p.modal-tip', { text: '扫码后直接打开本页，再点下载即可；也可保存此码用于物料印刷。' }),
        el('button.btn.btn-primary', {
          text: '保存二维码 PNG',
          onclick: async () => {
            const blob = await qrPngBlob(pageUrl(item.id), { cell: 12 });
            downloadBlob(blob, `${sanitizeFileName(item.fileName || item.id)}-qrcode.png`);
          }
        }),
        el('button.btn.btn-ghost', {
          text: '复制扫码链接',
          onclick: async () => {
            const ok = await copyText(pageUrl(item.id));
            toast(ok ? '扫码链接已复制' : '复制失败', ok ? 'ok' : 'error');
          }
        })
      )
    ),
    el('div', { style: { marginTop: '16px' } },
      el('a.btn.btn-ghost', { href: '#/', text: '← 返回列表' })
    )
  );
}
