#!/usr/bin/env node
/**
 * 本地命令行管理工具（零依赖，Node 18+）：
 *   node tools/manage.mjs list                 列出清单
 *   node tools/manage.mjs import <目录> [-r]   批量导入文件到 files/ 并写入清单
 *   node tools/manage.mjs sync                 扫描 files/，补齐缺失条目（--prune 同时清理失效条目）
 *   node tools/manage.mjs qr [id]              生成二维码 SVG 到 qr/
 *   node tools/manage.mjs set <id> --name=xx   修改字段（--version --weight --category --desc --tags --visible --pinned）
 *   node tools/manage.mjs rm <id> [--file]     从清单移除（--file 同时删除文件）
 *
 * 用途：批量导入、超大文件（走 git 上传而非 API）、断网整理。
 * 仓库路径等配置从 assets/config.js 读取，保持单一数据源。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import qrcode from '../assets/vendor/qrcode.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 assets/config.js 中提取仓库配置，避免两处维护 */
function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'config.js'), 'utf8');
  const get = (k) => {
    const m = src.match(new RegExp(`${k}:\\s*'([^']+)'`));
    return m ? m[1] : '';
  };
  const cats = (src.match(/categories:\s*\[([^\]]+)\]/) || [, ''])[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  return {
    owner: get('owner'),
    repo: get('repo'),
    branch: get('branch'),
    dataPath: get('dataPath'),
    fileDir: get('fileDir'),
    qrDir: get('qrDir'),
    categories: cats.length ? cats : ['apk', 'doc', 'image', 'other']
  };
}

const CFG = readConfig();
const DATA_FILE = path.join(ROOT, CFG.dataPath);
const FILES_DIR = path.join(ROOT, CFG.fileDir);
const QR_DIR = path.join(ROOT, CFG.qrDir);
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const CAT_EXT = {
  apk: ['apk', 'ipa', 'exe', 'msi'],
  doc: ['doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
};

function newId(len = 8) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += ID_CHARS[crypto.randomInt(0, ID_CHARS.length)];
  return s;
}

function guessCategory(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  for (const [cat, exts] of Object.entries(CAT_EXT)) if (exts.includes(ext)) return cat;
  return 'other';
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function readManifest() {
  if (!fs.existsSync(DATA_FILE)) return { version: 1, updatedAt: '', categories: CFG.categories, items: [] };
  const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return { version: 1, updatedAt: '', categories: CFG.categories, ...j };
}

function writeManifest(data) {
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function pageUrl(id) {
  return `https://${CFG.owner}.github.io/${CFG.repo}/#/r/${id}`;
}

function makeItem({ fileName, relPath, size, sha, category, weight }) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: path.basename(fileName, path.extname(fileName)),
    fileName,
    path: relPath,
    category: category || guessCategory(fileName),
    tags: [],
    description: '',
    version: '',
    size,
    sha1: sha,
    mime: '',
    weight: Number.isFinite(weight) ? weight : 100,
    pinned: false,
    visible: true,
    releaseNotes: '',
    createdAt: now,
    updatedAt: now
  };
}

/* ------------------------------- 命令 ------------------------------- */

function cmdList(args) {
  const data = readManifest();
  const items = data.items.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
  if (!items.length) {
    console.log('清单为空。');
    return;
  }
  console.log('ID        权重  分类     大小        名称');
  for (const it of items) {
    console.log(
      `${it.id.padEnd(10)}${String(it.weight).padStart(4)}  ${(it.category || '').padEnd(8)}${fmtSize(it.size || 0).padEnd(11)}${it.name}`
    );
  }
  if (args.includes('--url')) {
    console.log('\n扫码地址：');
    for (const it of items) console.log(`  ${pageUrl(it.id)}  ${it.name}`);
  }
}

function cmdImport(args) {
  const dir = args.find((a) => !a.startsWith('-'));
  if (!dir) throw new Error('用法：import <目录> [-r] [--category=apk] [--weight=100]');
  const recursive = args.includes('-r') || args.includes('--recursive');
  const catOpt = (args.find((a) => a.startsWith('--category=')) || '').split('=')[1] || '';
  const weightOpt = Number((args.find((a) => a.startsWith('--weight=')) || '').split('=')[1]) || 100;

  const absDir = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(absDir)) throw new Error(`目录不存在：${absDir}`);

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.join(absDir, e.name);
    if (e.isFile()) files.push(p);
    else if (e.isDirectory() && recursive) walk(p, files);
  }

  const data = readManifest();
  const known = new Set(data.items.map((i) => i.sha1));
  const taken = new Set(data.items.map((i) => i.path));
  let added = 0;

  for (const file of files) {
    if (path.extname(file) === '.json' && file.includes('resources')) continue;
    const sha = sha1(file);
    if (known.has(sha)) {
      console.log(`跳过（已存在）：${path.basename(file)}`);
      continue;
    }
    const fileName = path.basename(file);
    const category = catOpt || guessCategory(file);
    let relPath = `${CFG.fileDir}/${category}/${fileName}`;
    let n = 1;
    while (taken.has(relPath) || fs.existsSync(path.join(ROOT, relPath))) {
      const stem = path.basename(fileName, path.extname(fileName));
      relPath = `${CFG.fileDir}/${category}/${stem}-${n}${path.extname(fileName)}`;
      n += 1;
    }
    fs.mkdirSync(path.dirname(path.join(ROOT, relPath)), { recursive: true });
    fs.copyFileSync(file, path.join(ROOT, relPath));
    data.items.push(
      makeItem({ fileName: path.basename(relPath), relPath, size: fs.statSync(file).size, sha, category, weight: weightOpt })
    );
    taken.add(relPath);
    added += 1;
    console.log(`已导入：${relPath} (${fmtSize(fs.statSync(file).size)})`);
  }

  writeManifest(data);
  console.log(`完成：新增 ${added} 项，清单共 ${data.items.length} 项。`);
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile()) out.push(p);
    else if (e.isDirectory()) walk(p, out);
  }
}

function cmdSync(args) {
  const prune = args.includes('--prune');
  const data = readManifest();
  const byPath = new Map(data.items.map((i) => [i.path, i]));

  // 扫描 files/ 下所有文件，补齐缺失条目
  const found = new Set();
  if (fs.existsSync(FILES_DIR)) {
    for (const file of walkAll(FILES_DIR)) {
      const relPath = path.relative(ROOT, file).split(path.sep).join('/');
      found.add(relPath);
      if (byPath.has(relPath)) continue;
      const category = relPath.split('/')[1] || guessCategory(file);
      data.items.push(
        makeItem({
          fileName: path.basename(file),
          relPath,
          size: fs.statSync(file).size,
          sha: sha1(file),
          category: CFG.categories.includes(category) ? category : 'other'
        })
      );
      console.log(`补齐：${relPath}`);
    }
  }

  if (prune) {
    const before = data.items.length;
    data.items = data.items.filter((i) => {
      const exists = found.has(i.path) || fs.existsSync(path.join(ROOT, i.path));
      if (!exists) console.log(`清理失效条目：${i.path}`);
      return exists;
    });
    console.log(`清理 ${before - data.items.length} 条`);
  }

  writeManifest(data);
  console.log(`完成：清单共 ${data.items.length} 项，请先核对名称/版本/权重。`);
}

function walkAll(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile()) out.push(p);
    else if (e.isDirectory()) out.push(...walkAll(p));
  }
  return out;
}

function cmdQr(args) {
  const id = args.find((a) => !a.startsWith('-'));
  const data = readManifest();
  const targets = id ? data.items.filter((i) => i.id === id) : data.items;
  if (id && !targets.length) throw new Error(`未找到资源：${id}`);
  fs.mkdirSync(QR_DIR, { recursive: true });
  for (const it of targets) {
    const qr = qrcode(0, 'M');
    qr.addData(pageUrl(it.id), 'Byte');
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    const out = path.join(QR_DIR, `${it.id}.svg`);
    fs.writeFileSync(out, svg, 'utf8');
    console.log(`生成：${path.relative(ROOT, out)}  ${it.name}`);
  }
  console.log(`完成：${targets.length} 张，站点 ${pageUrl('')}`);
}

function cmdSet(args) {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) throw new Error('用法：set <id> --name=xx --weight=100 --visible=true');
  const data = readManifest();
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error(`未找到资源：${id}`);

  const flags = {
    '--name': 'name',
    '--version': 'version',
    '--desc': 'description',
    '--category': 'category',
    '--tags': 'tags',
    '--notes': 'releaseNotes'
  };
  for (const a of args) {
    if (!a.startsWith('--')) continue;
    const [k, v = ''] = a.split('=');
    if (flags[k]) {
      if (flags[k] === 'tags') item.tags = v.split(',').map((s) => s.trim()).filter(Boolean);
      else item[flags[k]] = v;
    } else if (k === '--weight') item.weight = Number(v) || 0;
    else if (k === '--visible') item.visible = v !== 'false';
    else if (k === '--pinned') item.pinned = v === 'true';
  }
  item.updatedAt = new Date().toISOString();
  writeManifest(data);
  console.log(`已更新：${item.id} ${item.name}`);
}

function cmdRm(args) {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) throw new Error('用法：rm <id> [--file]');
  const data = readManifest();
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error(`未找到资源：${id}`);
  data.items = data.items.filter((i) => i.id !== id);
  writeManifest(data);
  if (args.includes('--file')) {
    const p = path.join(ROOT, item.path);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`已删除文件：${item.path}`);
    }
    const q = path.join(QR_DIR, `${item.id}.svg`);
    if (fs.existsSync(q)) fs.unlinkSync(q);
  }
  console.log(`已移除：${item.name}`);
}

function cmdHelp() {
  console.log(`资源站本地管理工具

  node tools/manage.mjs list [--url]              列出清单
  node tools/manage.mjs import <目录> [-r]        批量导入（--category --weight）
  node tools/manage.mjs sync [--prune]            扫描 files/ 补齐清单条目
  node tools/manage.mjs qr [id]                   生成二维码 SVG
  node tools/manage.mjs set <id> --name=xx        修改字段（--desc --notes --tags --weight）
  node tools/manage.mjs rm <id> [--file]          移除条目

  仓库：${CFG.owner}/${CFG.repo}@${CFG.branch}
  站点：https://${CFG.owner}.github.io/${CFG.repo}/`);
}

/* ------------------------------- 入口 ------------------------------- */

const [cmd, ...args] = process.argv.slice(2);
const map = { list: cmdList, import: cmdImport, sync: cmdSync, qr: cmdQr, set: cmdSet, rm: cmdRm, help: cmdHelp };

try {
  if (!cmd || !map[cmd]) cmdHelp();
  else map[cmd](args);
} catch (err) {
  console.error(`错误：${err.message}`);
  process.exitCode = 1;
}
