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
  // 默认下载链接走哪条链路：auto = 打开页面时自动测速选最快
  // 也可固定为 pages / raw / cdn 或下面的镜像 mode
  downloadPrimary: 'auto',

  // 自建镜像前缀（填了就参与测速，国内最稳的方案）
  // 支持 {owner} {repo} {branch} 占位符，末尾保留 /
  // 例：'https://gitee.com/jisyu/Web_Server_Resource/raw/main/'
  // 例：'https://cdn.example.com/'（对象存储/CDN 根目录，目录结构同仓库）
  mirrors: [],

  // 内置加速节点（免配置，可用性与速度随节点波动，测速后自动取舍）
  builtinMirrors: [
    ['ghfast', 'https://ghfast.top/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/'],
    ['gitmirror', 'https://raw.gitmirror.com/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/'],
    ['ghproxy', 'https://gh-proxy.com/https://raw.githubusercontent.com/{owner}/{repo}/{branch}/'],
    ['jsdfastly', 'https://fastly.jsdelivr.net/gh/{owner}/{repo}@{branch}/'],
    ['jsdgcore', 'https://gcore.jsdelivr.net/gh/{owner}/{repo}@{branch}/']
  ]
};

export const MODE_LABEL = {
  pages: 'GitHub Pages',
  raw: 'GitHub Raw',
  cdn: 'jsDelivr',
  ghfast: '加速节点 A',
  gitmirror: '加速节点 B',
  ghproxy: '加速节点 C',
  jsdfastly: 'jsDelivr(fastly)',
  jsdgcore: 'jsDelivr(gcore)'
};

function fillTemplate(tpl) {
  return String(tpl)
    .replace('{owner}', CONFIG.owner)
    .replace('{repo}', CONFIG.repo)
    .replace('{branch}', CONFIG.branch);
}

/**
 * 所有可下载线路（mode + 名称 + 完整 URL）。
 * 本地预览时只有同源一条。
 */
export function candidateLinks(relPath) {
  const rel = String(relPath || '').replace(/^\/+/, '');
  if (isLocalHost()) {
    const abs = new URL(rel, location.href).href;
    return [{ mode: 'pages', label: '本地预览', url: abs }];
  }
  const list = [
    { mode: 'pages', label: MODE_LABEL.pages, url: `https://${CONFIG.owner}.github.io/${CONFIG.repo}/${rel}` },
    { mode: 'raw', label: MODE_LABEL.raw, url: `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${rel}` },
    { mode: 'cdn', label: MODE_LABEL.cdn, url: `https://cdn.jsdelivr.net/gh/${CONFIG.owner}/${CONFIG.repo}@${CONFIG.branch}/${rel}` }
  ];
  for (const [mode, tpl] of CONFIG.builtinMirrors || []) {
    list.push({ mode, label: MODE_LABEL[mode] || mode, url: fillTemplate(tpl) + rel });
  }
  (CONFIG.mirrors || []).forEach((tpl, i) => {
    list.push({ mode: `m${i}`, label: `自建镜像 ${i + 1}`, url: fillTemplate(tpl) + rel });
  });
  return list;
}

/** 运行时选定的最快线路（由测速写入，优先于 CONFIG.downloadPrimary） */
let runtimeMode = null;

export function setPreferredMode(mode) {
  runtimeMode = mode;
}

export function getPreferredMode() {
  return runtimeMode;
}

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
 * 主下载链接：优先用测速/手动选出的线路，否则用 CONFIG.downloadPrimary。
 * cdn 模式下超 50MB 自动切 raw。
 */
export function primaryDownloadUrl(relPath, size) {
  const links = candidateLinks(relPath);
  let mode = runtimeMode || CONFIG.downloadPrimary || 'pages';
  if (mode === 'auto') mode = 'pages'; // 测速未完成时的兜底
  const pick = (m) => links.find((c) => c.mode === m);
  const tooBig = typeof size === 'number' && size > CONFIG.cdnSafeBytes;
  if (mode === 'cdn' && tooBig) mode = 'raw';
  const hit = pick(mode) || pick('pages');
  return hit ? hit.url : links[0].url;
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
