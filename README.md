# Shooting Cut 中文官网

本仓库只发布 Shooting Cut 简体中文站：
<https://shootingcut.cn/>。

英文站由独立仓库
[`wangtao9090/shootingcut-web`](https://github.com/wangtao9090/shootingcut-web)
维护并发布到 <https://shootingcut.com/>。两个站点不共用发布目录，也不保留
`/zh/` 或 `*-zh.html` 兼容页面。

## 本地校验

在仓库根目录运行：

```bash
node --check scripts/validate-site.mjs
node --test scripts/validate-site.test.mjs
node scripts/validate-site.mjs
xmllint --noout sitemap.xml
```

提交前还应运行 `git diff --check`，启动本地 HTTP 服务检查 sitemap 中的
全部公开路由与 `/llms.txt`，并抽查桌面、移动端和键盘导航。

## 内容维护

- 中文和英文页面使用相同根路径，并通过跨域 reciprocal `hreflang` 成对
  关联。新增、改名或移除页面时，需要在两个独立仓库中分别提交对应变更。
- canonical、`og:url`、JSON-LD 页面 URL 与 sitemap `<loc>` 必须使用
  `https://shootingcut.cn`；英文 alternate 使用同路径
  `https://shootingcut.com`。
- 产品事实以当前 Shooting Cut 产品源码为准。长期未更新的用户手册只能
  作为线索，不能作为当前功能、方案或隐私边界的最终事实来源。
- `llms.txt` 是补充性的机器发现摘要，不替代 HTML 内容、结构化数据或
  XML sitemap，也不保证任何搜索或生成式回答系统采用它。

## GitHub Pages 部署

GitHub Pages 从 `main` 分支的仓库根目录发布。`CNAME` 必须保留为
`shootingcut.cn`。

发布流程：

1. 运行全部本地校验与浏览器抽查。
2. 完成独立内容与代码审查。
3. 使用正常 merge 合入 `main`，不要重写已经推送的历史。
4. 推送 `main`，等待 GitHub Actions 与 Pages 构建到达成功终态。
5. 在线检查 canonical、reciprocal `hreflang`、sitemap、`llms.txt` 和
   所有公开路由。

中文域名的 DNS 与 HTTPS 需要单独运维：确认 apex 和 `www` 记录符合
GitHub Pages 当前官方要求，等待证书覆盖 `shootingcut.cn` 后再启用
HTTPS enforcement，并用生产 HTTPS 请求复核。不要仅凭 Pages 显示
`built` 就判定证书已经可用。
