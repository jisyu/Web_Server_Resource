/** 通用工具函数（无依赖） */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * 创建元素：el('div.card', {text: 'x'}, child1, child2)
 * 选择器支持 tag#id.class1.class2
 * 所有文本一律走 textContent，杜绝 innerHTML 注入。
 */
export function el(spec, props = null, ...children) {
  const parts = String(spec).split('.');
  const tagAndId = parts.shift() || 'div';
  const [tag, id] = tagAndId.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (parts.length) node.className = parts.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else if (k === 'class') node.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k in node && k !== 'list') node[k] = v;
      else node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function fmtSize(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 文件名消毒：剔除控制字符与路径分隔符，防止写入到预期外的位置 */
export function sanitizeFileName(name) {
  const bad = /[\\/:*?"<>|]/g;
  return String(name === null || name === undefined ? '' : name)
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c > 31 && c !== 127;
    })
    .join('')
    .replace(bad, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomId(len = 8) {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < len; i += 1) s += ID_CHARS[buf[i] % ID_CHARS.length];
  return s;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** ArrayBuffer -> base64（分块，避免大文件爆栈） */
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function sha1Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' }, value: text });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i < 0 ? '' : String(name).slice(i + 1).toLowerCase();
}

/** 依据扩展名推断分类 */
export function guessCategory(name, mime = '') {
  const ext = extOf(name);
  if (['apk', 'ipa', 'exe', 'msi'].includes(ext)) return 'apk';
  if (['doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return 'doc';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/') || mime.includes('pdf')) return 'doc';
  return 'other';
}

/** 排序：置顶优先 → 权重降序 → 更新时间降序 → 名称 */
export function sortItems(items) {
  return items.slice().sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    const w = (Number(b.weight) || 0) - (Number(a.weight) || 0);
    if (w) return w;
    const t = new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    if (t) return t;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
  });
}

/** 轻提示 */
export function toast(msg, type = 'info') {
  let box = $('#toast-box');
  if (!box) {
    box = el('div#toast-box.toast-box');
    document.body.append(box);
  }
  const t = el('div.toast', { class: `toast toast-${type}`, text: msg });
  box.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

/** 简单确认弹窗 */
export function confirmDialog(title, message, okText = '确定') {
  return new Promise((resolve) => {
    const mask = el('div.modal-mask');
    const btnOk = el('button.btn.btn-danger', { text: okText, onclick: () => finish(true) });
    const card = el('div.modal', null,
      el('h3', { text: title }),
      el('p.modal-msg', { text: message }),
      el('div.modal-actions', null,
        el('button.btn.btn-ghost', { text: '取消', onclick: () => finish(false) }),
        btnOk
      )
    );
    function finish(v) {
      mask.remove();
      resolve(v);
    }
    mask.append(card);
    mask.addEventListener('click', (e) => {
      if (e.target === mask) finish(false);
    });
    document.body.append(mask);
    btnOk.focus();
  });
}
