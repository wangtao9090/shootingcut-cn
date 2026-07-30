import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(testDirectory, "..");
const validatorPath = path.join(workspaceRoot, "scripts", "validate-site.mjs");
const temporaryRoots = new Set();
const publicEntries = [
  ".github",
  "assets",
  "CNAME",
  "competitive-shooting-video-editor",
  "faq.html",
  "index.html",
  "on-device-shooting-video-editor",
  "oauth",
  "og-image.svg",
  "privacy.html",
  "robots.txt",
  "sitemap.xml",
  "support.html",
  "terms.html",
];

async function copyCurrentSite() {
  const root = await mkdtemp(path.join(os.tmpdir(), "shootingcut-task-2-"));
  temporaryRoots.add(root);
  for (const entry of publicEntries) {
    await cp(path.join(workspaceRoot, entry), path.join(root, entry), {
      recursive: true,
    });
  }
  return root;
}

after(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function replaceInFile(root, relativePath, before, after) {
  const target = path.join(root, relativePath);
  const source = await readFile(target, "utf8");
  assert.ok(
    source.includes(before),
    `test fixture ${relativePath} does not contain the expected source`,
  );
  await writeFile(target, source.replace(before, after));
}

function runValidator(root) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8",
  });
}

function assertRejected(result, expected) {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, expected);
}

test("accepts the precise privacy boundary and legitimate external JSON-LD URLs", async () => {
  const root = await copyCurrentSite();
  const result = runValidator(root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("requires one matching og:url on every public page", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '    <meta property="og:url" content="https://shootingcut.cn/">\n',
    "",
  );
  const result = runValidator(root);
  assertRejected(result, /index\.html:\d+ expected exactly one og:url/i);
});

test("rejects a cross-domain og:url", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<meta property="og:url" content="https://shootingcut.cn/">',
    '<meta property="og:url" content="https://shootingcut.com/">',
  );
  const result = runValidator(root);
  assertRejected(result, /index\.html:\d+ og:url must be exactly/i);
});

test("rejects a page-owned JSON-LD URL on the wrong domain", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '"url": "https://shootingcut.cn/",',
    '"url": "https://shootingcut.com/",',
  );
  const result = runValidator(root);
  assertRejected(result, /index\.html:\d+ SoftwareApplication url must be exactly/i);
});

test("accepts a same-route object mainEntityOfPage reference", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '"url": "https://shootingcut.cn/",',
    '"url": "https://shootingcut.cn/",\n        "mainEntityOfPage": {"@id": "https://shootingcut.cn/"},',
  );
  const result = runValidator(root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("rejects an object mainEntityOfPage reference on the wrong domain", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '"url": "https://shootingcut.cn/",',
    '"url": "https://shootingcut.cn/",\n        "mainEntityOfPage": {"@id": "https://shootingcut.com/"},',
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /index\.html:\d+ SoftwareApplication mainEntityOfPage\.@id must be exactly/i,
  );
});

test("rejects duplicate HTML ids", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<section class="hero" id="home">',
    '<section class="hero" id="home"><div id="home"></div>',
  );
  const result = runValidator(root);
  assertRejected(result, /index\.html:\d+ duplicate id="home"/i);
});

test("rejects a language switch hidden with an important inline style", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a>',
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en" style="display:none!important">EN</a>',
  );
  const result = runValidator(root);
  assertRejected(result, /index\.html:\d+ language switch must be visible/i);
});

test("rejects a language switch hidden by an ancestor", async () => {
  const root = await copyCurrentSite();
  const languageSwitch =
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a>';
  await replaceInFile(
    root,
    "index.html",
    languageSwitch,
    `<div style="visibility:hidden !important">${languageSwitch}</div>`,
  );
  const result = runValidator(root);
  assertRejected(result, /index\.html:\d+ language switch must be visible/i);
});

test("does not count a commented language switch as visible", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a>',
    '<!-- <a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a> -->',
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /index\.html:\d+ expected exactly one visible English language switch; found 0/i,
  );
});

test("does not count language switches inside script or style elements", async () => {
  const languageSwitch =
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a>';
  for (const element of ["script", "style"]) {
    const root = await copyCurrentSite();
    await replaceInFile(
      root,
      "index.html",
      languageSwitch,
      `<${element}>${languageSwitch}</${element}>`,
    );
    const result = runValidator(root);
    assertRejected(
      result,
      /index\.html:\d+ expected exactly one visible English language switch; found 0/i,
    );
  }
});

test("rejects browser-hidden or non-link language-switch variants", async () => {
  const languageSwitch =
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a>';
  const variants = [
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en" aria-hidden="tr&#117;e">EN</a>',
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en" style="display&colon;none">EN</a>',
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en" style="display:/**/none">EN</a>',
    '<style>.review-hide { display: none; }</style><a class="lang-btn review-hide" href="https://shootingcut.com/" hreflang="en" lang="en">EN</a>',
    `<textarea>${languageSwitch}</textarea>`,
    `<div hidden/>${languageSwitch}</div>`,
    `<dialog>${languageSwitch}</dialog>`,
  ];

  for (const variant of variants) {
    const root = await copyCurrentSite();
    await replaceInFile(root, "index.html", languageSwitch, variant);
    const result = runValidator(root);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, `${variant}\n${output}`);
    assert.match(
      output,
      /index\.html:\d+ (?:language switch must be visible|expected exactly one visible English language switch; found 0)/i,
    );
  }
});

test("rejects an absolute local-media privacy claim", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "support.html",
    "核心音视频分析、剪辑、导出和人物追踪在设备本地运行，原始素材不会上传到 ShootingCut 的媒体处理服务器。",
    "所有视频和音频处理都在设备本地完成，媒体文件绝不会离开设备。",
  );
  const result = runValidator(root);
  assertRejected(result, /support\.html:\d+ absolute local-media privacy claim/i);
});

test("rejects detection reports described as anonymous instead of pseudonymous", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "privacy.html",
    "Apple CloudKit 发送有限的伪匿名派生字段",
    "Apple CloudKit 发送匿名派生字段",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /privacy\.html:\d+ detection reports must be described as pseudonymous/i,
  );
});

test("requires the current default state of the detection-improvement switch", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "privacy.html",
    "是用户可控制的功能，在当前版本中默认开启",
    "是用户可控制的功能",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /privacy\.html:\d+ must state that detection improvement is currently enabled by default/i,
  );
});

test("requires the custom RevenueCat App User ID KVS boundary", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "privacy.html",
    "非匿名 RevenueCat App User ID",
    "RevenueCat 标识符",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /privacy\.html:\d+ must disclose the custom RevenueCat App User ID KVS boundary/i,
  );
});

test("requires all real detection-improvement control labels", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "privacy.html",
    "或简称“改进”",
    "<!--\n或简称“改进”\n-->",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /privacy\.html:\d+ must list the actual detection-improvement control labels/i,
  );
});

test("does not let hidden CSS or an unclosed comment satisfy required labels", async () => {
  for (const replacement of [
    '<style>.review-hide { display: none; }</style><span class="review-hide">或简称“改进”</span>',
    '<!--\n或简称“改进”',
  ]) {
    const root = await copyCurrentSite();
    await replaceInFile(
      root,
      "privacy.html",
      "或简称“改进”",
      replacement,
    );
    const result = runValidator(root);
    assertRejected(
      result,
      /privacy\.html:\d+ must list the actual detection-improvement control labels/i,
    );
  }
});

test("requires support to list all real detection-improvement control labels", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "support.html",
    "或简称“改进”",
    "",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /support\.html:\d+ support must list the actual detection-improvement control labels/i,
  );
});

test("rejects a TikTok direct-upload claim split by an inline tag", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<section class="hero" id="home">',
    `<section class="hero" id="home">
      <p>TikTok 视频直<span>传</span>目前受支持。</p>`,
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /index\.html:\d+ TikTok direct-upload or integration claim/i,
  );
});

test("does not let a legal negative sentence excuse an adjacent positive claim", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "privacy.html",
    "当前 1.1.3 不提供 TikTok 视频直传。",
    "当前 1.1.3 不提供 TikTok 视频直传。TikTok 视频直传目前受支持。",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /privacy\.html:\d+ TikTok direct-upload or integration claim/i,
  );
});

test("does not let a negative clause or ellipsis excuse a positive claim", async () => {
  const legalSentence = "当前 1.1.3 不提供 TikTok 视频直传。";
  const variants = [
    "当前不提供 TikTok 视频直传，但 TikTok 视频直传目前受支持。",
    "当前不提供 TikTok 视频直传……TikTok 视频直传目前受支持。",
  ];

  for (const variant of variants) {
    const root = await copyCurrentSite();
    await replaceInFile(root, "privacy.html", legalSentence, variant);
    const result = runValidator(root);
    assertRejected(
      result,
      /privacy\.html:\d+ TikTok direct-upload or integration claim/i,
    );
  }
});

test("scans facts that remain visually rendered inside inert or aria-hidden content", async () => {
  for (const attribute of ["inert", 'aria-hidden="true"']) {
    const root = await copyCurrentSite();
    await replaceInFile(
      root,
      "index.html",
      '<section class="hero" id="home">',
      `<section class="hero" id="home"><p ${attribute}>所有视频都完全在本地处理。TikTok 视频直传目前受支持。</p>`,
    );
    const result = runValidator(root);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /absolute local-media privacy claim/i);
    assert.match(output, /TikTok direct-upload or integration claim/i);
  }
});

test("follows browser comment and optional paragraph-closing semantics", async () => {
  const variants = [
    '<section class="hero" id="home"><!-- <script> --><p>TikTok 视频直传目前受支持。</p>',
    '<section class="hero" id="home"><p>Tik<!-- marker --!>Tok 视频直传目前受支持。</p>',
    '<section class="hero" id="home"><p hidden>占位<p>TikTok 视频直传目前受支持。</p>',
  ];

  for (const variant of variants) {
    const root = await copyCurrentSite();
    await replaceInFile(
      root,
      "index.html",
      '<section class="hero" id="home">',
      variant,
    );
    const result = runValidator(root);
    assertRejected(
      result,
      /index\.html:\d+ TikTok direct-upload or integration claim/i,
    );
  }
});

test("rejects protected facts split across adjacent visible blocks", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<section class="hero" id="home">',
    '<section class="hero" id="home"><p>TikTok 视频直</p><p>传目前受支持。</p><p>Stage Mix 支持</p><p>三机位以上。</p>',
  );
  const result = runValidator(root);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /TikTok direct-upload or integration claim/i);
  assert.match(output, /stale Stage Mix input-count claim/i);
});

test("ignores forbidden claims that are statically hidden", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<section class="hero" id="home">',
    '<section class="hero" id="home"><p hidden>所有视频都完全在本地处理。TikTok 视频直传。Stage Mix 支持三机位以上。</p>',
  );
  const result = runValidator(root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("requires robots.txt to reference only the Chinese sitemap", async () => {
  const root = await copyCurrentSite();
  const robotsPath = path.join(root, "robots.txt");
  const robots = await readFile(robotsPath, "utf8");
  await writeFile(
    robotsPath,
    `${robots}\nSitemap: https://shootingcut.com/sitemap.xml\n`,
  );
  const result = runValidator(root);
  assertRejected(result, /robots\.txt:\d+ sitemap directive must be exactly/i);
});
