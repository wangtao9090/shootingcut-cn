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
  "CNAME",
  "faq.html",
  "index.html",
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

test("rejects a directly hidden language switch", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en">EN</a>',
    '<a href="https://shootingcut.com/" class="lang-btn" hreflang="en" lang="en" hidden>EN</a>',
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
    "",
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /privacy\.html:\d+ must list the actual detection-improvement control labels/i,
  );
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

test("rejects a TikTok direct-upload claim split across source lines", async () => {
  const root = await copyCurrentSite();
  await replaceInFile(
    root,
    "index.html",
    '<section class="hero" id="home">',
    `<section class="hero" id="home">
      <p>TikTok 视频<span> </span>
      直传目前受支持。</p>`,
  );
  const result = runValidator(root);
  assertRejected(
    result,
    /index\.html:\d+ TikTok direct-upload or integration claim/i,
  );
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
