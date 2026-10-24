/**
 * GitHub REST API 封装（只读仓库元数据 + 写入文件）。
 * 站点无后端，全部写操作直接由浏览器打到 GitHub。
 */
import { CONFIG } from './config.js';

const TOKEN_KEY = 'wsr.token';

export class GitHubApi {
  constructor(token = localStorage.getItem(TOKEN_KEY) || '') {
    this.token = token;
  }

  get authed() {
    return !!this.token;
  }

  setToken(token, remember = false) {
    this.token = token || '';
    if (remember && this.token) localStorage.setItem(TOKEN_KEY, this.token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  clearToken() {
    this.token = '';
    localStorage.removeItem(TOKEN_KEY);
  }

  headers(extra = {}) {
    const h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': CONFIG.apiVersion,
      ...extra
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  path(p) {
    return `/repos/${CONFIG.owner}/${CONFIG.repo}/${String(p).replace(/^\/+/, '')}`;
  }

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(`${CONFIG.apiBase}${path}`, {
      method,
      headers: this.headers(headers),
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        if (j && j.message) msg = `${res.status} ${j.message}`;
      } catch {
        /* 忽略解析失败 */
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /** 校验令牌并获取登录用户名 */
  async whoami() {
    const u = await this.request('/user');
    return u && u.login ? u.login : '';
  }

  /** 取文件元信息（主要用于拿 sha，写入时做乐观锁） */
  async getFile(path, ref = CONFIG.branch) {
    const j = await this.request(`${this.path(`contents/${path}`)}?ref=${encodeURIComponent(ref)}`);
    return { sha: j.sha, size: j.size, path: j.path, downloadUrl: j.download_url };
  }

  /**
   * 写入文件（新建或更新）。content 为纯文本，内部转 base64。
   * 带进度时用 XHR（fetch 无法上报上传进度）。
   */
  async putTextFile({ path, text, message, sha, branch = CONFIG.branch }) {
    const b64 = utf8ToBase64(text);
    return this.putBase64({ path, base64: b64, message, sha, branch });
  }

  async putBase64({ path, base64, message, sha, branch = CONFIG.branch, onProgress }) {
    const body = { message, content: base64, branch };
    if (sha) body.sha = sha;
    if (!onProgress) {
      return this.request(this.path(`contents/${path}`), { method: 'PUT', body });
    }
    return xhrUpload({
      url: `${CONFIG.apiBase}${this.path(`contents/${path}`)}`,
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      onProgress
    });
  }

  async deleteFile({ path, sha, message, branch = CONFIG.branch }) {
    return this.request(this.path(`contents/${path}`), {
      method: 'DELETE',
      body: { message, sha, branch }
    });
  }
}

function xhrUpload({ url, method, headers, body, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* 忽略 */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(`${xhr.status} ${data && data.message ? data.message : xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(body);
  });
}

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export const api = new GitHubApi();
