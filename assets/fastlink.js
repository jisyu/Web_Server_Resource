/**
 * 下载线路测速：
 * 1) no-cors GET 探测所有候选线路的响应耗时（不受跨域限制，任何主机都能测）；
 * 2) 对响应最快的几条做真实吞吐测速（取样前 128KB 算 KB/s）；
 * 3) 无跨域头的线路按响应耗时估算速度，保证国内镜像也能参与排序。
 * 自动把最快的一条设为默认下载线路（缓存 10 分钟，也可手动切换）。
 */
import { candidateLinks, setPreferredMode, isLocalHost, MODE_LABEL } from './config.js';

const CACHE_KEY = 'wsr.fastLink';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟
const TTFB_TIMEOUT = 5000; // 响应探测上限
const SPEED_TIMEOUT = 6000; // 吞吐测速上限
const PROBE_BYTES = 128 * 1024; // 每条线路最多取样 128KB
const SPEED_TOP_N = 3; // 只对响应最快的 N 条做吞吐测速，控制流量

function readCache() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return v && v.mode ? v : null;
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...entry, ts: Date.now() }));
  } catch {
    /* 忽略隐私模式等存储失败 */
  }
}

/** 响应耗时探测：no-cors GET，拿到响应头即中止，不下载正文 */
async function ttfbProbe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TTFB_TIMEOUT);
  const t0 = performance.now();
  try {
    await fetch(`${url}${url.includes('?') ? '&' : '?'}probe=${Date.now()}`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal
    });
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

/** 吞吐测速：取样前 PROBE_BYTES 字节算真实速度（受跨域限制，失败返回 null） */
async function speedProbe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SPEED_TIMEOUT);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }
    });
    if (!res.ok && res.status !== 206) return null;

    let bytes = 0;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      while (bytes < PROBE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
      }
      try { await reader.cancel(); } catch { /* ignore */ }
    } else {
      bytes = (await res.blob()).size;
    }
    const ms = performance.now() - t0;
    if (!bytes || !ms) return null;
    return { kbps: Math.round(bytes / 1024 / (ms / 1000)) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 由响应耗时估算速度（用于无跨域头、无法采样字节的线路） */
function estimateKbps(ttfb) {
  return Math.max(1, Math.round(128 / (Math.max(ttfb || 0, 60) / 1000)));
}

/** 测速所有线路，返回 {list, best} */
export async function measureAll(relPath) {
  const links = candidateLinks(relPath);
  if (isLocalHost()) return null;

  const withTtfb = await Promise.all(
    links.map(async (l) => ({ ...l, ttfb: await ttfbProbe(l.url) }))
  );
  const reachable = withTtfb.filter((x) => x.ttfb !== null).sort((a, b) => a.ttfb - b.ttfb);
  if (!reachable.length) return { list: withTtfb.map((x) => ({ ...x, ok: false })), best: null };

  const top = reachable.slice(0, SPEED_TOP_N);
  const measured = await Promise.all(
    top.map(async (l) => {
      const s = await speedProbe(l.url);
      return s ? { ...l, ...s, ok: true, est: false } : { ...l, kbps: estimateKbps(l.ttfb), ok: true, est: true };
    })
  );
  const rest = reachable.slice(SPEED_TOP_N).map((x) => ({ ...x, kbps: estimateKbps(x.ttfb), ok: true, est: true }));
  const dead = withTtfb.filter((x) => x.ttfb === null).map((x) => ({ ...x, ok: false }));

  const list = [...measured, ...rest, ...dead];
  const best = list.filter((x) => x.ok).sort((a, b) => b.kbps - a.kbps)[0] || null;
  return { list, best };
}

/** 自动测速并应用最快线路 */
export async function detectFastLink(relPath) {
  const cached = readCache();
  if (cached && Date.now() - (cached.ts || 0) < CACHE_TTL) {
    setPreferredMode(cached.mode);
    return { ...cached, cached: true };
  }
  const r = await measureAll(relPath);
  if (!r || !r.best) return null;
  setPreferredMode(r.best.mode);
  writeCache({ mode: r.best.mode, kbps: r.best.kbps, est: !!r.best.est });
  return { ...r.best, cached: false };
}

/** 手动指定线路（写入缓存，后续页面沿用） */
export function setManualMode(mode, kbps = 0) {
  setPreferredMode(mode);
  writeCache({ mode, kbps });
}

export function fmtSpeed(kbps, est = false) {
  if (!kbps) return '';
  const s = kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps} KB/s`;
  return est ? `≈${s}` : s;
}

/** 测速结果的一句话说明 */
export function fastLinkNote(result) {
  if (!result) return '线路测速未成功，已用默认线路；可展开下方手动切换';
  const label = result.label || MODE_LABEL[result.mode] || result.mode;
  const spd = result.kbps ? `（${fmtSpeed(result.kbps, result.est)}）` : '';
  return `已自动选择最快线路：${label}${spd}`;
}
