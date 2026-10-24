/**
 * 资源清单（data/resources.json）的读取、校验与写回。
 * 清单是全流程的唯一数据源。
 */
import { CONFIG, dataUrlCandidates } from './config.js';
import { api } from './github-api.js';
import { randomId, guessCategory, sortItems } from './util.js';

const EMPTY = { version: 1, updatedAt: '', categories: CONFIG.categories.slice(), items: [] };

let cache = null;

/** 读取清单；本地/线上多地址兜底 */
export async function loadManifest({ force = false } = {}) {
  if (cache && !force) return cache;
  const urls = dataUrlCandidates(force);
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache = normalize(await res.json());
      return cache;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('资源清单加载失败');
}

export function setCache(data) {
  cache = normalize(data);
  return cache;
}

export function getCache() {
  return cache;
}

export function normalize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(data.items) ? data.items : [];
  const cats = Array.isArray(data.categories) && data.categories.length
    ? data.categories
    : CONFIG.categories.slice();
  return {
    version: Number(data.version) || 1,
    updatedAt: data.updatedAt || '',
    categories: cats,
    items: items.map(normalizeItem)
  };
}

function normalizeItem(it) {
  const o = it && typeof it === 'object' ? it : {};
  const now = new Date().toISOString();
  return {
    id: String(o.id || randomId(8)),
    name: String(o.name || o.fileName || '未命名资源'),
    fileName: String(o.fileName || ''),
    path: String(o.path || ''),
    category: CONFIG.categories.includes(o.category) ? o.category : 'other',
    tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
    description: String(o.description || ''),
    version: String(o.version || ''),
    size: Number(o.size) || 0,
    sha1: String(o.sha1 || ''),
    mime: String(o.mime || ''),
    weight: Number.isFinite(Number(o.weight)) ? Number(o.weight) : 100,
    pinned: !!o.pinned,
    visible: o.visible === undefined ? true : !!o.visible,
    releaseNotes: String(o.releaseNotes || ''),
    createdAt: o.createdAt || now,
    updatedAt: o.updatedAt || now
  };
}

export function createItem(opts) {
  const now = new Date().toISOString();
  const fileName = opts.fileName || 'file';
  const item = normalizeItem({
    ...opts,
    fileName,
    category: opts.category || guessCategory(fileName, opts.mime || ''),
    size: Number(opts.size) || 0
  });
  item.createdAt = now;
  item.updatedAt = now;
  return item;
}

/** 排序后的可见条目 */
export function visibleItems(data) {
  return sortItems(data.items.filter((i) => i.visible));
}

/** 推荐的新条目权重：当前最大值 + 10 */
export function suggestWeight(data) {
  const max = data.items.reduce((m, i) => Math.max(m, Number(i.weight) || 0), 0);
  return max ? max + 10 : 100;
}

/** 保存清单到仓库（自动处理 sha 乐观锁） */
export async function saveManifest(data, message = '更新资源清单') {
  const clean = normalize(data);
  clean.updatedAt = new Date().toISOString();
  const text = `${JSON.stringify(clean, null, 2)}\n`;
  let sha = null;
  try {
    const meta = await api.getFile(CONFIG.dataPath);
    sha = meta.sha;
  } catch (err) {
    if (err && err.status !== 404) throw err;
  }
  await api.putTextFile({ path: CONFIG.dataPath, text, message, sha });
  cache = clean;
  return clean;
}

/** 仓库内文件存放路径：files/<分类>/<文件名>，重名自动加序号 */
export function buildFilePath(fileName, category, taken = []) {
  const base = `${CONFIG.fileDir}/${category}/${fileName}`;
  if (!taken.includes(base)) return base;
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let n = 1;
  let candidate = `${CONFIG.fileDir}/${category}/${stem}-${n}${ext}`;
  while (taken.includes(candidate)) {
    n += 1;
    candidate = `${CONFIG.fileDir}/${category}/${stem}-${n}${ext}`;
  }
  return candidate;
}
