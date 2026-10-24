/**
 * 应用入口：hash 路由 + 视图调度。
 * 用 hash 路由是因为 GitHub Pages 不支持 URL 重写，hash 可避免刷新 404。
 */
import { $, $$, clear, el, toast } from './util.js';
import { CONFIG } from './config.js';
import { renderHome } from './views/home.js';
import { renderResource } from './views/resource.js';
import { renderAdmin } from './views/admin.js';

const ROUTES = [
  { pattern: /^\/$/, view: renderHome, nav: '/' },
  { pattern: /^\/r\/([^/?#]+)$/, view: renderResource, nav: '/' },
  { pattern: /^\/admin$/, view: renderAdmin, nav: '/admin' }
];

let currentView = null;
let renderId = 0;

function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  const path = raw.split('?')[0];
  return path && path.startsWith('/') ? path : '/';
}

function syncNav(nav) {
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
}

async function render() {
  const path = currentPath();
  const app = $('#app');
  const route = ROUTES.find((r) => r.pattern.test(path)) || ROUTES[0];
  const params = (path.match(route.pattern) || []).slice(1);

  // 渲染到临时容器，完成后整体替换，避免并发渲染叠加出两份页面
  const my = ++renderId;
  const holder = el('div.view');

  let view = null;
  try {
    view = await route.view(holder, params);
  } catch (err) {
    console.error(err);
    holder.append(
      el('div.empty', null,
        el('h2', { text: '页面加载失败' }),
        el('p', { text: String((err && err.message) || err) }),
        el('a.btn.btn-primary', { href: '#/', text: '回到首页' })
      )
    );
    toast('加载失败', 'error');
  }

  if (my !== renderId) return; // 已有更新的渲染，丢弃本次结果

  if (currentView && typeof currentView.destroy === 'function') currentView.destroy();
  currentView = view || null;
  clear(app).append(holder);
  syncNav(route.nav);
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  $('#footer-repo').textContent = `${CONFIG.owner}/${CONFIG.repo}`;
  if (location.hash) render();
  else location.replace('#/'); // 会触发 hashchange → render
});
