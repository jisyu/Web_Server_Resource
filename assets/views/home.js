/** 首页：资源列表（搜索 / 分类筛选 / 权重排序） */
import { el, clear, fmtSize, fmtDate, debounce } from '../util.js';
import { CATEGORY_LABEL, primaryDownloadUrl, pageUrl } from '../config.js';
import { loadManifest, visibleItems } from '../store.js';
import { openQrModal } from '../qrmodal.js';

const SORTS = {
  weight: (a, b) => 0, // 沿用清单默认排序（置顶 → 权重 → 时间 → 名称）
  time: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
  name: (a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN')
};

export async function renderHome(root) {
  const data = await loadManifest();
  const state = { kw: '', cat: 'all', sort: 'weight' };

  const grid = el('div.grid');
  const count = el('span', { class: 'badge' });

  const search = el('input.input', {
    type: 'search',
    placeholder: '搜索名称、描述、标签、文件名…',
    oninput: debounce(() => {
      state.kw = search.value.trim().toLowerCase();
      paint();
    }, 180)
  });

  const catSel = el('select.select', {
    onchange: () => {
      state.cat = catSel.value;
      paint();
    }
  }, el('option', { value: 'all', text: '全部分类' }));

  for (const c of data.categories) {
    catSel.append(el('option', { value: c, text: CATEGORY_LABEL[c] || c }));
  }

  const sortSel = el('select.select', {
    onchange: () => {
      state.sort = sortSel.value;
      paint();
    }
  },
    el('option', { value: 'weight', text: '推荐排序（权重）' }),
    el('option', { value: 'time', text: '最近更新' }),
    el('option', { value: 'name', text: '名称' })
  );

  function match(item) {
    if (state.cat !== 'all' && item.category !== state.cat) return false;
    if (!state.kw) return true;
    const hay = [item.name, item.fileName, item.description, item.version, ...(item.tags || [])]
      .join(' ')
      .toLowerCase();
    return hay.includes(state.kw);
  }

  function paint() {
    const list = visibleItems(data).filter(match);
    if (state.sort !== 'weight') list.sort(SORTS[state.sort]);
    clear(grid);
    count.textContent = `${list.length} 个资源`;
    if (!list.length) {
      grid.append(
        el('div.empty', null,
          el('h2', { text: state.kw || state.cat !== 'all' ? '没有匹配的资源' : '还没有资源' }),
          el('p', { text: state.kw || state.cat !== 'all' ? '换个关键词或分类试试' : '到管理页上传第一个资源文件' }),
          el('a.btn.btn-primary', { href: '#/admin', text: '去管理页上传' })
        )
      );
      return;
    }
    for (const item of list) grid.append(card(item, data));
  }

  root.append(
    el('div.page-head', null,
      el('h1', { text: '资源列表' }),
      el('p', { text: '扫码打开对应资源页即可下载；文件由 GitHub 仓库托管分发。' })
    ),
    el('div.toolbar', null,
      el('div.grow', null, search),
      catSel,
      sortSel,
      count
    ),
    grid
  );
  paint();
}

function card(item, data) {
  const url = primaryDownloadUrl(item.path, item.size);
  const meta = [];
  if (item.version) meta.push(`版本 ${item.version}`);
  meta.push(fmtSize(item.size));
  meta.push(fmtDate(item.updatedAt));

  return el('article.card', null,
    el('div.card-top', null,
      el('div.card-title', null,
        el('h3', { text: item.name }),
        el('span.badge.badge-cat', { text: CATEGORY_LABEL[item.category] || item.category }),
        item.pinned ? el('span.badge.badge-pinned', { text: '置顶' }) : null
      ),
      el('p.card-desc', { text: item.description || '（无描述）' }),
      el('div.meta-row', null, ...meta.map((m) => el('span', { text: m }))),
      item.tags && item.tags.length
        ? el('div.tag-row', null, ...item.tags.map((t) => el('span.badge', { text: `#${t}` })))
        : null
    ),
    el('div.card-actions', null,
      el('a.btn.btn-primary', { href: url, text: '下载', download: item.fileName || '', target: '_blank', rel: 'noopener' }),
      el('button.btn.btn-sm', {
        text: '二维码',
        onclick: () =>
          openQrModal({
            title: item.name,
            pageUrl: pageUrl(item.id),
            directUrl: url,
            fileName: item.fileName || item.id
          })
      }),
      el('a.btn.btn-sm.btn-ghost', { href: `#/r/${item.id}`, text: '详情' })
    )
  );
}
