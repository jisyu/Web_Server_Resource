/**
 * 下载线路测速：并发探测 Pages / Raw / CDN 三条链路的响应耗时，
 * 自动把最快的一条设为默认下载线路（结果缓存 10 分钟）。
 */
import { fileUrls, setPreferredMode, isLocalHost } from './config.js';

const CACHE_KEY = 'wsr.fastLink';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟
const PROBE_TIMEOUT = 6000;

export const MODE_LABEL = { pages: 'Pages', raw: 'Raw 直链', cdn: 'CDN 加速' };

function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return v && v.mode && typeof v.ms === 'number' ? v : null;
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...entry, ts: Date.now() }));
  } catch {
    /* 忽略存储失败（隐私模式等） */
  }
}

/** 用 HEAD 请求测量某条线路的可达性与耗时 */
async function probe(url, timeout = PROBE_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测速并应用结果。
 * @param {string} samplePath 任一资源文件路径（三条线路共用主机，测一次即可）
 * @returns {{mode:string, ms:number, cached:boolean}|null}
 */
export async function detectFastLink(samplePath) {
  if (isLocalHost()) return null; // 本地预览三条线路同源，无需测速
  const urls = fileUrls(samplePath);

  const cached = readCache();
  if (cached && Date.now() - (cached.ts || 0) < CACHE_TTL) {
    setPreferredMode(cached.mode);
    return { ...cached, cached: true };
  }

  const entries = [
    ['pages', urls.pages],
    ['raw', urls.raw],
    ['cdn', urls.cdn]
  ];
  const results = await Promise.all(
    entries.map(async ([mode, url]) => {
      const t0 = performance.now();
      const ok = await probe(url);
      return ok ? { mode, ms: Math.round(performance.now() - t0) } : null;
    })
  );
  const good = results.filter(Boolean).sort((a, b) => a.ms - b.ms);
  if (!good.length) return null;

  setPreferredMode(good[0].mode);
  writeCache(good[0]);
  return { ...good[0], cached: false };
}

/** 测速结果的一句说明，如 “已自动选择最快线路：Raw 直链（312ms）” */
export function fastLinkNote(result) {
  if (!result) return '线路测速未成功，已使用默认线路';
  const label = MODE_LABEL[result.mode] || result.mode;
  return result.cached
    ? `已自动选择最快线路：${label}`
    : `已自动选择最快线路：${label}（${result.ms}ms）`;
}
