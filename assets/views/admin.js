/**
 * 管理页：连接 GitHub → 上传资源 → 编辑/权重排序/上下架/删除 → 提交到仓库。
 * 页面本身无后端，所有写操作直接调用 GitHub REST API。
 */
import {
  el, clear, fmtSize, fmtDate, toast, confirmDialog, sanitizeFileName, guessCategory,
  toBase64, sha1Hex, copyText, downloadBlob, sortItems
} from '../util.js';
import { CONFIG, CATEGORY_LABEL, pageUrl, primaryDownloadUrl } from '../config.js';
import { api } from '../github-api.js';
import { loadManifest, saveManifest, createItem, buildFilePath, suggestWeight, normalize } from '../store.js';
import { openQrModal } from '../qrmodal.js';
import { qrPngBlob } from '../qr.js';
import { makeZip } from '../zip.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens';

export async function renderAdmin(root) {
  let data = await loadManifest();
  let snapshot = JSON.stringify(data);
  let dirty = false;
  let authed = false;
  let pending = [];

  const tbody = el('tbody');
  const dirtyTip = el('span.dirty-tip', { text: '' });
  const connState = el('span', { class: 'badge', text: '未连接（只读）' });
  const writeCtrls = [];

  /* ---------------- 连接 ---------------- */
  const tokenInput = el('input.input', {
    type: 'password',
    placeholder: 'github_pat_…（Contents: Read and write）',
    autocomplete: 'off'
  });
  const remember = el('input', { type: 'checkbox' });
  const btnConnect = el('button.btn.btn-primary', { text: '连接', onclick: connect });
  const btnDisconnect = el('button.btn.btn-ghost', {
    text: '断开并清除令牌',
    onclick: () => {
      api.clearToken();
      tokenInput.value = '';
      authed = false;
      connState.textContent = '未连接（只读）';
      connState.className = 'badge';
      syncAuthUI();
      toast('已断开');
    }
  });

  async function connect(token) {
    const t = (token || tokenInput.value).trim();
    if (!t) {
      toast('请先填写令牌', 'error');
      return;
    }
    btnConnect.disabled = true;
    btnConnect.textContent = '连接中…';
    try {
      api.setToken(t, remember.checked);
      const user = await api.whoami();
      authed = true;
      connState.textContent = `已连接 @${user}`;
      connState.className = 'badge badge-cat';
      tokenInput.value = '';
      toast('已连接 GitHub，可开始上传与编辑', 'ok');
    } catch (err) {
      api.clearToken();
      authed = false;
      toast(`连接失败：${err.message}`, 'error');
    } finally {
      btnConnect.disabled = false;
      btnConnect.textContent = '连接';
      syncAuthUI();
    }
  }

  /* ---------------- 上传 ---------------- */
  const catSel = el('select.select', null, el('option', { value: 'auto', text: '自动识别分类' }));
  for (const c of data.categories) catSel.append(el('option', { value: c, text: CATEGORY_LABEL[c] || c }));

  const nameInput = el('input.input', { placeholder: '留空则用文件名' });
  const verInput = el('input.input', { placeholder: '如 1.1.0' });
  const weightInput = el('input.input', { type: 'number', value: String(suggestWeight(data)) });
  const descInput = el('textarea.textarea', { placeholder: '描述（可选，将用于列表展示）' });

  const fileInput = el('input', {
    type: 'file',
    multiple: true,
    style: { display: 'none' },
    onchange: (e) => {
      addFiles(Array.from(e.target.files || []));
      e.target.value = '';
    }
  });

  const dropzone = el('div.dropzone', {
    onclick: () => fileInput.click(),
    ondragover: (e) => {
      e.preventDefault();
      dropzone.classList.add('over');
    },
    ondragleave: () => dropzone.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault();
      dropzone.classList.remove('over');
      addFiles(Array.from(e.dataTransfer.files || []));
    }
  },
    el('strong', { text: '点击选择文件，或拖拽到此处' }),
    el('span', { text: `单文件上限 ${fmtSize(CONFIG.maxUploadBytes)}，建议 ≤ ${fmtSize(CONFIG.fileSizeWarnBytes)}` })
  );

  const queue = el('div.queue');
  const btnUpload = el('button.btn.btn-primary', { text: '开始上传', onclick: () => doUpload() });

  function addFiles(files) {
    for (const f of files) {
      if (pending.some((p) => p.name === f.name && p.size === f.size)) continue;
      pending.push({ file: f, name: f.name, size: f.size });
    }
    renderQueue();
  }

  function renderQueue() {
    clear(queue);
    for (const p of pending) {
      const bar = el('i');
      queue.append(
        el('div.queue-item', null,
          el('div', { style: { flex: '1 1 auto' } },
            el('div.qname', { text: `${p.name} · ${fmtSize(p.size)}` }),
            el('div.progress', null, bar),
            el('div.qstate', { text: p.state || '待上传' })
          ),
          el('button.btn.btn-sm.btn-ghost', {
            text: '移除',
            onclick: () => {
              pending = pending.filter((x) => x !== p);
              renderQueue();
            }
          })
        )
      );
      p.bar = bar;
      p.stateEl = queue.lastChild.querySelector('.qstate');
    }
    btnUpload.disabled = !authed || !pending.length;
    btnUpload.textContent = pending.length ? `开始上传（${pending.length}）` : '开始上传';
  }

  async function doUpload() {
    if (!authed) {
      toast('请先连接 GitHub', 'error');
      return;
    }
    if (!pending.length) {
      toast('请先选择文件', 'error');
      return;
    }
    const batch = pending.slice();
    btnUpload.disabled = true;

    const opts = {
      category: catSel.value,
      name: nameInput.value.trim(),
      version: verInput.value.trim(),
      description: descInput.value.trim(),
      weight: Number(weightInput.value)
    };

    for (const p of batch) {
      if (p.file.size > CONFIG.maxUploadBytes) {
        p.state = `超出 ${fmtSize(CONFIG.maxUploadBytes)}，已跳过`;
        if (p.stateEl) p.stateEl.textContent = p.state;
        continue;
      }
      try {
        if (p.stateEl) p.stateEl.textContent = '读取中…';
        const buf = await p.file.arrayBuffer();
        const sha1 = await sha1Hex(buf);
        const base64 = toBase64(buf);
        const fileName = sanitizeFileName(p.file.name) || 'file';
        const cat = opts.category === 'auto' ? guessCategory(fileName, p.file.type) : opts.category;
        const path = buildFilePath(fileName, cat, data.items.map((i) => i.path));

        await api.putBase64({
          path,
          base64,
          message: `上传资源：${fileName}`,
          onProgress: (r) => {
            if (p.bar) p.bar.style.width = `${Math.round(r * 100)}%`;
            if (p.stateEl) p.stateEl.textContent = `上传中 ${Math.round(r * 100)}%`;
          }
        });

        const item = createItem({
          name: opts.name || stripExt(fileName),
          fileName,
          path,
          size: p.file.size,
          mime: p.file.type || '',
          sha1,
          category: cat,
          version: opts.version,
          description: opts.description,
          weight: Number.isFinite(opts.weight) ? opts.weight : suggestWeight(data)
        });
        data.items.push(item);
        dirty = true;
        p.state = '已完成，待保存清单';
        if (p.stateEl) p.stateEl.textContent = p.state;
      } catch (err) {
        p.state = `失败：${err.message}`;
        if (p.stateEl) p.stateEl.textContent = p.state;
      }
    }

    pending = pending.filter((p) => !batch.includes(p));
    renderTable();
    renderQueue();
    updateDirty();
    btnUpload.disabled = !authed || !pending.length;
    toast('上传处理完成，别忘了保存清单', 'ok');
  }

  /* ---------------- 列表 ---------------- */
  function row(item) {
    const tr = el('tr');
    tr.dataset.id = item.id;

    const nameInputRow = el('input.input.w-input', {
      value: item.name,
      disabled: !authed,
      oninput: (e) => {
        item.name = e.target.value;
        touch(tr);
      }
    });

    const cat = el('select.select.w-select', {
      disabled: !authed,
      onchange: (e) => {
        item.category = e.target.value;
        touch(tr);
      }
    });
    for (const c of data.categories) {
      cat.append(el('option', { value: c, text: CATEGORY_LABEL[c] || c, selected: item.category === c }));
    }

    const ver = el('input.input.w-input', {
      value: item.version,
      placeholder: '-',
      disabled: !authed,
      oninput: (e) => {
        item.version = e.target.value;
        touch(tr);
      }
    });

    const weight = el('input.input.w-num', {
      type: 'number',
      value: String(item.weight),
      disabled: !authed,
      onchange: (e) => {
        item.weight = Number(e.target.value) || 0;
        touch(tr);
      }
    });

    const pin = el('input', {
      type: 'checkbox',
      checked: !!item.pinned,
      disabled: !authed,
      onchange: (e) => {
        item.pinned = e.target.checked;
        touch(tr);
      }
    });

    const vis = el('input', {
      type: 'checkbox',
      checked: !!item.visible,
      disabled: !authed,
      onchange: (e) => {
        item.visible = e.target.checked;
        touch(tr);
      }
    });

    const url = primaryDownloadUrl(item.path, item.size);

    tr.append(
      el('td.name-cell', { dataset: { label: '名称' } }, nameInputRow,
        el('div', { class: 'meta-row' }, el('span', { text: item.fileName || item.path }))),
      el('td', { dataset: { label: '分类' } }, cat),
      el('td', { dataset: { label: '版本' } }, ver),
      el('td', { dataset: { label: '权重' } }, weight,
        el('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } },
          el('button.btn.btn-sm.btn-ghost', {
            text: '▲',
            title: '提高权重',
            disabled: !authed,
            onclick: () => adjust(item, 10)
          }),
          el('button.btn.btn-sm.btn-ghost', {
            text: '▼',
            title: '降低权重',
            disabled: !authed,
            onclick: () => adjust(item, -10)
          })
        )),
      el('td', { dataset: { label: '置顶' } }, el('label.checkbox', null, pin, '置顶')),
      el('td', { dataset: { label: '显示' } }, el('label.checkbox', null, vis, '显示')),
      el('td', { dataset: { label: '大小' } }, el('span', { text: fmtSize(item.size) })),
      el('td', { dataset: { label: '更新时间' } }, el('span', { text: fmtDate(item.updatedAt) })),
      el('td', { dataset: { label: '操作' } },
        el('div.admin-row-actions', null,
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
          el('button.btn.btn-sm.btn-ghost', {
            text: '复制链接',
            onclick: async () => {
              const ok = await copyText(pageUrl(item.id));
              toast(ok ? '扫码链接已复制' : '复制失败', ok ? 'ok' : 'error');
            }
          }),
          el('button.btn.btn-sm.btn-danger', { text: '删除', onclick: () => removeItem(item) })
        ))
    );
    return tr;
  }

  function adjust(item, delta) {
    item.weight = (Number(item.weight) || 0) + delta;
    dirty = true;
    renderTable();
    updateDirty();
  }

  function touch(tr) {
    tr.classList.add('dirty');
    dirty = true;
    updateDirty();
  }

  function renderTable() {
    clear(tbody);
    const items = sortItems(data.items);
    if (!items.length) {
      tbody.append(
        el('tr', null,
          el('td', { colspan: '9' },
            el('div.empty', null,
              el('h2', { text: '暂无资源' }),
              el('p', { text: '用上方上传区添加第一个文件' })
            )
          )
        )
      );
      return;
    }
    for (const item of items) tbody.append(row(item));
  }

  /* ---------------- 删除 ---------------- */
  async function removeItem(item) {
    if (!authed) {
      toast('请先连接 GitHub', 'error');
      return;
    }
    const ok = await confirmDialog('删除资源', `将删除仓库文件 ${item.path} 并从清单移除，不可撤销。`, '确认删除');
    if (!ok) return;
    try {
      const meta = await api.getFile(item.path);
      await api.deleteFile({ path: item.path, sha: meta.sha, message: `删除资源：${item.name}` });
    } catch (err) {
      if (err && err.status !== 404) {
        toast(`删除文件失败：${err.message}`, 'error');
        return;
      }
    }
    data.items = data.items.filter((i) => i.id !== item.id);
    dirty = true;
    renderTable();
    await saveAll();
  }

  /* ---------------- 保存 / 撤销 / 刷新 ---------------- */
  const btnSave = el('button.btn.btn-primary', { text: '保存全部改动', onclick: () => saveAll() });
  const btnUndo = el('button.btn.btn-ghost', {
    text: '撤销未保存改动',
    onclick: () => {
      data = normalize(JSON.parse(snapshot));
      dirty = false;
      renderTable();
      updateDirty();
      toast('已撤销');
    }
  });
  const btnRefresh = el('button.btn.btn-ghost', {
    text: '刷新',
    onclick: async () => {
      data = await loadManifest({ force: true });
      snapshot = JSON.stringify(data);
      dirty = false;
      renderTable();
      updateDirty();
      toast('已从仓库刷新');
    }
  });
  const btnExport = el('button.btn.btn-ghost', { text: '导出全部二维码', onclick: exportAll });

  async function saveAll() {
    if (!authed) {
      toast('请先连接 GitHub', 'error');
      return;
    }
    btnSave.disabled = true;
    btnSave.textContent = '提交中…';
    try {
      const saved = await saveManifest(data, `更新资源清单（${data.items.length} 项）`);
      data = saved;
      snapshot = JSON.stringify(data);
      dirty = false;
      renderTable();
      updateDirty();
      toast('已提交到 GitHub，Pages 稍后生效', 'ok');
    } catch (err) {
      toast(`保存失败：${err.message}`, 'error');
    } finally {
      btnSave.disabled = !authed;
      btnSave.textContent = '保存全部改动';
    }
  }

  async function exportAll() {
    const files = [];
    for (const it of sortItems(data.items)) {
      if (!it.visible) continue;
      const blob = await qrPngBlob(pageUrl(it.id), { cell: 10 });
      files.push({
        name: `${sanitizeFileName(it.fileName || it.id)}-${it.id}.png`,
        data: new Uint8Array(await blob.arrayBuffer())
      });
    }
    if (!files.length) {
      toast('没有可导出的资源', 'error');
      return;
    }
    downloadBlob(makeZip(files), 'qrcodes.zip');
    toast(`已导出 ${files.length} 张二维码`, 'ok');
  }

  function updateDirty() {
    dirtyTip.textContent = dirty ? '有未保存的改动' : '';
    btnSave.disabled = !authed || !dirty;
    btnUndo.disabled = !dirty;
  }

  function syncAuthUI() {
    for (const c of writeCtrls) c.disabled = !authed;
    btnSave.disabled = !authed || !dirty;
    btnUpload.disabled = !authed || !pending.length;
    btnExport.disabled = false;
    btnRefresh.disabled = false;
  }

  writeCtrls.push(nameInput, verInput, weightInput, descInput, catSel);

  root.append(
    el('div.page-head', null,
      el('h1', { text: '资源管理' }),
      el('p', { text: '上传、编辑、权重排序与删除都会直接写入 GitHub 仓库；清单改动需点“保存全部改动”提交。' })
    ),
    el('div.panel', null,
      el('h2', { text: '连接 GitHub' }),
      el('p.panel-hint', { text: '需要 Fine-grained 令牌，权限 Contents: Read and write，且仅限本仓库。令牌只保存在本机浏览器，不会上传给任何第三方。' }),
      el('div.form-grid', null,
        el('div.field', null, el('label', { text: '个人访问令牌' }), tokenInput),
        el('div.field', null, el('label', { text: '记住' }), el('label.checkbox', null, remember, '在本机保存')),
        el('div.field', null, el('label', { text: '状态' }), connState)
      ),
      el('div.form-actions', null,
        btnConnect,
        btnDisconnect,
        el('a.btn.btn-ghost', { href: TOKEN_URL, target: '_blank', rel: 'noopener', text: '创建令牌 ↗' })
      )
    ),
    el('div.panel', null,
      el('h2', { text: '上传资源' }),
      el('p.panel-hint', { text: '每个文件会单独提交一次，清单改动需随后保存；文件直接写入仓库，公开可下载。' }),
      fileInput,
      dropzone,
      el('div.form-grid', { style: { marginTop: '12px' } },
        el('div.field', null, el('label', { text: '分类' }), catSel),
        el('div.field', null, el('label', { text: '名称（可选）' }), nameInput),
        el('div.field', null, el('label', { text: '版本（可选）' }), verInput),
        el('div.field', null, el('label', { text: '权重' }), weightInput),
        el('div.field', { style: { gridColumn: '1 / -1' } }, el('label', { text: '描述（可选）' }), descInput)
      ),
      queue,
      el('div.form-actions', null, btnUpload)
    ),
    el('div.panel', null,
      el('h2', { text: '资源清单' }),
      el('p.panel-hint', { text: '权重越大越靠前；勾选“置顶”可固定在最前；取消“显示”即下架（文件保留，仅不在列表展示）。' }),
      el('div.table-wrap', null, el('table.admin-table', null,
        el('thead', null,
          el('tr', null,
            el('th', { text: '名称' }),
            el('th', { text: '分类' }),
            el('th', { text: '版本' }),
            el('th', { text: '权重' }),
            el('th', { text: '置顶' }),
            el('th', { text: '显示' }),
            el('th', { text: '大小' }),
            el('th', { text: '更新' }),
            el('th', { text: '操作' })
          )
        ),
        tbody
      )),
      el('div.sticky-actions', null,
        btnSave,
        btnUndo,
        dirtyTip,
        el('div.spacer'),
        btnRefresh,
        btnExport
      )
    )
  );

  renderTable();
  renderQueue();
  syncAuthUI();
  updateDirty();

  if (api.authed) connect(api.token);

  return { destroy: () => {} };
}

function stripExt(name) {
  const i = String(name).lastIndexOf('.');
  return i > 0 ? String(name).slice(0, i) : String(name);
}
