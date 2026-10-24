# 资源下载站（Web_Server_Resource）

扫码 → 打开网页 → 下载事先上传的资源文件。站点**托管在 GitHub Pages**，无后端、无构建、无数据库。

- 线上地址：`https://jisyu.github.io/Web_Server_Resource/`
- 仓库地址：`https://github.com/jisyu/Web_Server_Resource`
- 本地预览：`npm run serve` → http://127.0.0.1:8080

## 架构要点

| 层 | 实现 |
| --- | --- |
| 站点 | 纯静态 HTML/CSS/JS（原生 ES Module，无框架、无打包） |
| 存储 | 仓库内 `files/`（资源文件）+ `data/resources.json`（清单，唯一数据源） |
| 管理 | 浏览器直连 GitHub REST API（个人令牌），上传/编辑/权重/删除均写入仓库 |
| 分发 | 默认走 Pages 同源自链（页面能打开就能下载），详情页另提供 raw / jsDelivr 备用链接 |

GitHub Pages 不能运行后端代码，因此"服务器"由「静态站点 + GitHub API」组合实现：读走同源/raw，写走 API。
> jsDelivr 在国内访问不稳定，因此默认下载链路用 Pages 同源；想改回 CDN 优先，把 `assets/config.js` 里的 `downloadPrimary` 改成 `cdn` 即可。

## 目录

```
index.html            入口（hash 路由：#/ 列表、#/r/<id> 详情、#/admin 管理）
data/resources.json   资源清单
files/<分类>/…        资源实体文件（apk / doc / image / other）
qr/                   CLI 生成的二维码 SVG
assets/               页面脚本、样式、内置二维码库与 ZIP 打包
tools/serve.mjs       本地静态预览服务
tools/manage.mjs      本地 CLI：批量导入、清单维护、批量生成二维码
```

## 上线步骤

1. 在 GitHub 创建公开仓库 `jisyu/Web_Server_Resource`，推送本目录内容（默认分支 `main`）。
2. Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`。
3. 等待首次构建完成，访问 `https://jisyu.github.io/Web_Server_Resource/`。
4. 打开 `https://jisyu.github.io/Web_Server_Resource/#/admin`，填入令牌即可管理。

> 若仓库名/账号与默认不同，改 `assets/config.js` 顶部 `CONFIG` 即可，其余全部自动推导。

## 令牌要求

Fine-grained personal access token（https://github.com/settings/personal-access-tokens）：

- Resource owner：`jisyu`，Repository access：仅 `Web_Server_Resource`
- Repository permissions：**Contents: Read and write**
- 令牌只存在本机浏览器 localStorage，可随时清除；页面不会把它发给除 GitHub 之外的任何地址。

## 限制

| 项 | 上限 | 说明 |
| --- | --- | --- |
| 单文件 | 100 MB | Contents API 硬上限；更大的文件用本地 CLI + git 提交 |
| 下载链路 | — | 默认 Pages 同源；jsDelivr 对 >50 MB 文件支持不佳，仅作备用 |
| 仓库体积 | 1 GB（软） | 建议定期清理历史版本 |
| Pages 生效 | 数十秒~数分钟 | 保存后页面会提示"稍后生效" |

## 许可

站点代码 MIT；内置二维码库 `assets/vendor/qrcode.mjs` 来自 Kazuhiko Arase（MIT）。
