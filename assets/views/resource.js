/** 资源详情页（扫码落地页）：移动端优先，下载按钮固定底栏，线路自动测速 */
import { el, fmtSize, fmtDate, toast, copyText, downloadBlob, sanitizeFileName } from '../util.js';
import { CATEGORY_LABEL, candidateLinks, primaryDownloadUrl, pageUrl } from '../config.js';
import { loadManifest } from '../store.js';
import { detectFastLink, fastLinkNote, measureAll, setManualMode, fmtSpeed } from '../fastlink.js';
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

  const qrUrl = pageUrl(item.id);

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

  /* ---- 线路列表：折叠，可看各线路实测速度并手动切换 ---- */
  const links = candidateLinks(item.path);
  const rows = new Map();

  const applyMode = (mode, kbps, auto = false, est = false) => {
    setManualMode(mode, kbps || 0);
    downloadBtn.href = primaryDownloadUrl(item.path, item.size);
    const l = links.find((x) => x.mode === mode);
    const label = l ? l.label : mode;
    const spd = kbps ? `（${fmtSpeed(kbps, est)}）` : '';
    ctaNote.textContent = auto ? `已自动选择最快线路：${label}${spd}` : `已切换线路：${label}${spd}`;
    rows.forEach((r, m) => r.row.classList.toggle('active', m === mode));
  };

  const linkList = el('div.link-list');
  for (const l of links) {
    const speedEl = el('span.diag-speed', { text: '' });
    const row = el('div.link-item', { title: l.url },
      el('span.link-label', { text: l.label }),
      speedEl,
      el('button.btn.btn-sm.btn-ghost', {
        text: '复制',
        onclick: async () => {
          const ok = await copyText(l.url);
          toast(ok ? '已复制链接' : '复制失败', ok ? 'ok' : 'error');
        }
      }),
      el('button.btn.btn-sm', {
        text: '用这条',
        onclick: () => applyMode(l.mode, Number(speedEl.dataset.kbps || 0))
      })
    );
    rows.set(l.mode, { row, speedEl });
    linkList.append(row);
  }

  const remeasureBtn = el('button.btn.btn-sm.btn-ghost', { text: '重新测速', onclick: () => runMeasure() });

  async function runMeasure() {
    remeasureBtn.disabled = true;
    remeasureBtn.textContent = '测速中…';
    const r = await measureAll(item.path);
    if (r) {
      for (const l of r.list) {
        const hit = rows.get(l.mode);
        if (!hit) continue;
        hit.speedEl.textContent = l.ok ? fmtSpeed(l.kbps, l.est) : '不可用';
        hit.speedEl.dataset.kbps = l.ok ? String(l.kbps) : '';
        hit.speedEl.classList.toggle('bad', !l.ok);
      }
      if (r.best) applyMode(r.best.mode, r.best.kbps, true, r.best.est);
      else toast('所有线路均不可用，请稍后重试', 'error');
    }
    remeasureBtn.textContent = '重新测速';
    remeasureBtn.disabled = false;
  }

  const linkDetails = el('details.link-details', null,
    el('summary', { text: '下载慢？查看各线路速度 / 手动切换 ▾' }),
    el('p.modal-tip', { text: '打开页面时已自动测速并选用最快线路；若仍慢，可在此手动切换。' }),
    remeasureBtn,
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
  if (result) applyMode(result.mode, result.kbps || 0, true, result.est);
  else ctaNote.textContent = fastLinkNote(null);

  return {
    destroy: () => document.body.classList.remove('has-cta')
  };
}
