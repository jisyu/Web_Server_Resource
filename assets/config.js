/**
 * 站点与仓库配置。
 * 改仓库名/分支时只需改这里。
 */
export const CONFIG = {
  owner: 'jisyu',
  repo: 'Web_Server_Resource',
  branch: 'main',
  dataPath: 'data/resources.json', // 资源清单（唯一数据源）
  fileDir: 'files', // 资源实体文件根目录
  qrDir: 'qr', // 可选：保存到仓库的二维码图片目录
  categories: ['apk', 'doc', 'image', 'other'],
  apiBase: 'https://api.github.com',
  apiVersion: '2022-11-28',
  maxUploadBytes: 100 * 1024 * 1024, // GitHub Contents API 单文件上限
  cdnSafeBytes: 50 * 1024 * 1024, // 超过此大小不建议使用 jsDelivr
  fileSizeWarnBytes: 50 * 1024 * 1024, // 上传时提示阈值
  // 默认下载链接走哪条链路：pages（Pages 同源，页面能打开就能下载，国内最稳）
  // 可选 cdn（jsDelivr，国内不稳定）/ raw（raw.githubusercontent）
  downloadPrimary: 'pages'
};

export const CATEGORY_LABEL = {
  apk: '安装包',
  doc: '文档',
  image: '图片',
  other: '其他'
};

/** 是否运行在本地预览服务（node tools/serve.mjs） */
export function isLocalHost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** 站点根 URL（线上为 GitHub Pages 地址） */
export function siteBaseUrl() {
  if (isLocalHost()) return location.origin + '/';
  return `https://${CONFIG.owner}.github.io/${CONFIG.repo}/`;
}

/** 扫码落地页地址：站点根 + #/r/<id> */
export function pageUrl(id) {
  return `${siteBaseUrl()}#/r/${id}`;
}

/** 计算资源文件的三组可用链接 */
export function fileUrls(relPath) {
  const rel = String(relPath || '').replace(/^\/+/, '');
  if (isLocalHost()) {
    const abs = new URL(rel, location.href).href;
    return { cdn: abs, raw: abs, pages: abs };
  }
  const base = `https://cdn.jsdelivr.net/gh/${CONFIG.owner}/${CONFIG.repo}@${CONFIG.branch}/`;
  const rawBase = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/`;
  const pagesBase = `https://${CONFIG.owner}.github.io/${CONFIG.repo}/`;
  return { cdn: base + rel, raw: rawBase + rel, pages: pagesBase + rel };
}

/**
 * 主下载链接：默认走 Pages 同源（页面打得开就下得了，国内最稳）。
 * 可通过 CONFIG.downloadPrimary 切换为 cdn / raw；cdn 模式下超 50MB 自动切 raw。
 */
export function primaryDownloadUrl(relPath, size) {
  const urls = fileUrls(relPath);
  const mode = CONFIG.downloadPrimary || 'pages';
  if (mode === 'cdn') {
    return typeof size === 'number' && size > CONFIG.cdnSafeBytes ? urls.raw : urls.cdn;
  }
  if (mode === 'raw') return urls.raw;
  return urls.pages;
}

/**
 * 清单文件的可读取地址。顺序：同源(Pages) → raw → CDN。
 * force 时加时间戳跳过缓存，保证管理端保存后能立刻读到新内容。
 */
export function dataUrlCandidates(force = false) {
  const q = force ? `?t=${Date.now()}` : '';
  const local = new URL(CONFIG.dataPath, location.href).href + q;
  if (isLocalHost()) return [local];
  const rawBase = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/`;
  const cdnBase = `https://cdn.jsdelivr.net/gh/${CONFIG.owner}/${CONFIG.repo}@${CONFIG.branch}/`;
  return [local, rawBase + CONFIG.dataPath + q, cdnBase + CONFIG.dataPath];
}
