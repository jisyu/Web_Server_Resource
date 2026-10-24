/** 资源详情页（扫码落地页）：移动端优先，下载按钮固定底栏，线路自动测速 */
import { el, fmtSize, fmtDate, toast, copyText, downloadBlob, sanitizeFileName } from '../util.js';
import { CATEGORY_LABEL, fileUrls, primaryDownloadUrl, pageUrl } from '../config.js';
import { loadManifest } from '../store.js';
import { detectFastLink, fastLinkNote } from '../fastlink.js';
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

  document.body.classList.add('has-cta');

  const urls = fileUrls(item.path);
  const qrUrl = pageUrl(item.id);

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
  qrWrap.innerHTML = qrSvg(qrUrl, { cell: 8, margin: 2 });

  const meta = [];
  if (item.version) meta.push(`版本 ${item.version}`);
  meta.push(fmtSize(item.size));
  meta.push(fmtDate(item.updatedAt));
  meta.push(CATEGORY_LABEL[item.category] || item.category);

  /* ---- 底栏：主下载按钮（固定在屏幕底部，手机上单手可点） ---- */
  const downloadBtn = el('a.btn.btn-primary.cta-btn', {
    href: primaryDownloadUrl(item.path, item.size),
    text: `下载 ${item.fileName || item.name}`,
    download: item.fileName || '',
    target: '_blank',
    rel: 'noopener'
  });
  const ctaNote = el('p.cta-note', { text: '正在为你选择最快的下载线路…' });

  /* ---- 二维码面板：访客本身来自扫码，手机上默认折叠 ---- */
  const qrPanel = el('aside.qr-panel', null,
    el('h3', { text: '分享此资源' }),
    qrWrap,
    el('p.modal-tip', { text: '扫码直接打开本页；也可保存此码用于物料印刷。' }),
    el('button.btn.btn-primary', {
      text: '保存二维码 PNG',
      onclick: async () => {
        const blob = await qrPngBlob(qrUrl, { cell: 12 });
        downloadBlob(blob, `${sanitizeFileName(item.fileName || item.id)}-qrcode.png`);
      }
    }),
    el('button.btn.btn-ghost', {
      text: '复制扫码链接',
      onclick: async () => {
        const ok = await copyText(qrUrl);
        toast(ok ? '扫码链接已复制' : '复制失败', ok ? 'ok' : 'error');
      }
    })
  );
  const qrToggle = el('button.btn.btn-ghost.qr-toggle', {
    text: '分享二维码 ▾',
    onclick: () => {
      qrPanel.classList.toggle('open');
      qrToggle.textContent = qrPanel.classList.contains('open') ? '收起二维码 ▴' : '分享二维码 ▾';
    }
  });

  /* ---- 备用线路：折叠，不占首屏 ---- */
  const linkList = el('div.link-list', null,
    linkRow(`Pages（推荐）`, urls.pages),
    linkRow('Raw', urls.raw),
    linkRow('CDN', urls.cdn)
  );
  const linkDetails = el('details.link-details', null,
    el('summary', { text: '下载慢？切换其它线路 ▾' }),
    linkList
  );

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
        item.description ? el('p.detail-desc', { text: item.description }) : null,
        item.releaseNotes ? el('div.detail-notes', { text: item.releaseNotes }) : null,
        item.tags && item.tags.length
          ? el('div.tag-row', null, ...item.tags.map((t) => el('span.badge', { text: `#${t}` })))
          : null,
        qrToggle,
        linkDetails,
        qrPanel
      )
    ),
    el('div.back-row', null, el('a.btn.btn-ghost', { href: '#/', text: '← 返回列表' })),
    el('div.cta-bar', null,
      el('div.cta-inner', null, downloadBtn, ctaNote)
    )
  );

  /* ---- 自动测速：把最快的线路设为主下载链接 ---- */
  const result = await detectFastLink(item.path);
  if (result) {
    downloadBtn.href = primaryDownloadUrl(item.path, item.size);
    if (result.mode === 'cdn' && item.size > 50 * 1024 * 1024) {
      downloadBtn.href = urls.raw;
    }
  }
  ctaNote.textContent = fastLinkNote(result);

  return {
    destroy: () => document.body.classList.remove('has-cta')
  };
}
