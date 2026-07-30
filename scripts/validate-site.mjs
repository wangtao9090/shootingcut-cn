import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const siteRoot = process.cwd();
const siteOrigin = "https://shootingcut.cn";
const counterpartOrigin = "https://shootingcut.com";
const siteSitemapUrl = `${siteOrigin}/sitemap.xml`;
const pageOwnedSchemaTypes = new Set([
  "aboutpage",
  "article",
  "blogposting",
  "collectionpage",
  "contactpage",
  "faqpage",
  "howto",
  "newsarticle",
  "profilepage",
  "softwareapplication",
  "webpage",
]);
const excludedDirectories = new Set([
  ".git",
  ".worktrees",
  ".superpowers",
  "docs",
]);

const failures = [];
const counts = {
  htmlPages: 0,
  jsonLdBlocks: 0,
  localLinks: 0,
  sitemapLocations: 0,
};

function toPosixPath(...parts) {
  return path.posix.join(...parts);
}

function absolutePath(relativePath) {
  return path.join(siteRoot, ...relativePath.split("/"));
}

function lineNumber(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function addFailure(relativePath, source, index, message) {
  failures.push({
    relativePath,
    line: lineNumber(source, index),
    message: message.replace(/\s+/g, " ").trim(),
  });
}

async function discoverPublicFiles(relativeDirectory = "") {
  const directory = relativeDirectory
    ? absolutePath(relativeDirectory)
    : siteRoot;
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = relativeDirectory
      ? toPosixPath(relativeDirectory, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...(await discoverPublicFiles(relativePath)));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function decodeCharacterReference(reference) {
  const normalized = reference.toLowerCase();
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  if (normalized in named) {
    return named[normalized];
  }
  if (/^#x[0-9a-f]+$/i.test(reference)) {
    return String.fromCodePoint(Number.parseInt(reference.slice(2), 16));
  }
  if (/^#[0-9]+$/.test(reference)) {
    return String.fromCodePoint(Number.parseInt(reference.slice(1), 10));
  }
  return `&${reference};`;
}

function decodeHtmlAttribute(value) {
  return value.replace(
    /&(amp|apos|gt|lt|quot|#x[0-9a-f]+|#[0-9]+);/gi,
    (_, reference) => decodeCharacterReference(reference),
  );
}

function decodeHtmlForScan(value) {
  return value.replace(
    /&(amp|apos|gt|lt|quot|#x[0-9a-f]+|#[0-9]+);/gi,
    (entity, reference) => {
      const decoded = decodeCharacterReference(reference);
      return `${decoded}${" ".repeat(Math.max(0, entity.length - decoded.length))}`;
    },
  );
}

function parseAttributes(attributeSource, sourceIndex) {
  const attributes = [];
  const attributePattern =
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attributePattern.exec(attributeSource)) !== null) {
    const value = match[2] ?? match[3] ?? match[4];
    let valueOffset = match.index;

    if (value !== undefined) {
      const equalsOffset = match[0].indexOf("=");
      const afterEquals = match[0].slice(equalsOffset + 1);
      const whitespaceLength = afterEquals.length - afterEquals.trimStart().length;
      const quoteLength = /^["']/.test(afterEquals.trimStart()) ? 1 : 0;
      valueOffset += equalsOffset + 1 + whitespaceLength + quoteLength;
    }

    attributes.push({
      name: match[1].toLowerCase(),
      value,
      index: sourceIndex + valueOffset,
    });
  }

  return attributes;
}

function scanStartTags(source) {
  const tags = [];
  const scanSource = source.replace(
    /<!--[\s\S]*?-->/g,
    (comment) => " ".repeat(comment.length),
  );
  const tagPattern =
    /<([A-Za-z][A-Za-z0-9:-]*)(?=\s|\/?>)((?:"[^"]*"|'[^']*'|[^'"<>])*)>/g;
  let match;

  while ((match = tagPattern.exec(scanSource)) !== null) {
    tags.push({
      name: match[1].toLowerCase(),
      index: match.index,
      endIndex: tagPattern.lastIndex,
      attributes: parseAttributes(
        match[2],
        match.index + 1 + match[1].length,
      ),
    });
  }

  return tags;
}

function findAttribute(tag, name) {
  return tag.attributes.find((attribute) => attribute.name === name);
}

function currentRoute(relativePath) {
  if (relativePath === "index.html") {
    return "/";
  }
  if (relativePath.endsWith("/index.html")) {
    return `/${relativePath.slice(0, -"index.html".length)}`;
  }
  return `/${relativePath}`;
}

function routeCandidates(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return [];
  }

  const normalizedPath = path.posix
    .normalize(`/${decodedPath}`)
    .replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) {
    return ["index.html"];
  }
  if (pathname.endsWith("/")) {
    return [`${normalizedPath}/index.html`];
  }

  const candidates = [normalizedPath];
  if (!path.posix.extname(normalizedPath)) {
    candidates.push(`${normalizedPath}.html`, `${normalizedPath}/index.html`);
  }
  return [...new Set(candidates)];
}

function resolveRoute(pathname, publicFiles) {
  return (
    routeCandidates(pathname).find((candidate) => publicFiles.has(candidate)) ??
    null
  );
}

function siteUrlRoute(rawUrl, publicFiles) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: `"${rawUrl}" is not a valid absolute URL` };
  }

  if (url.origin !== siteOrigin) {
    return {
      error: `"${rawUrl}" must use ${siteOrigin}`,
    };
  }
  if (url.username || url.password) {
    return { error: `"${rawUrl}" must not include credentials` };
  }
  if (url.search || url.hash) {
    return {
      error: `"${rawUrl}" must not include a query string or fragment`,
    };
  }

  const resolved = resolveRoute(url.pathname, publicFiles);
  if (!resolved || !resolved.endsWith(".html")) {
    return {
      error: `"${rawUrl}" does not resolve to a public HTML page`,
    };
  }
  return { route: resolved };
}

function counterpartUrlRoute(rawUrl, expectedRoute) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: `"${rawUrl}" is not a valid absolute URL` };
  }

  if (url.origin !== counterpartOrigin) {
    return {
      error: `"${rawUrl}" must use ${counterpartOrigin}`,
    };
  }
  if (url.username || url.password) {
    return { error: `"${rawUrl}" must not include credentials` };
  }
  if (url.search || url.hash) {
    return {
      error: `"${rawUrl}" must not include a query string or fragment`,
    };
  }
  if (url.pathname !== expectedRoute) {
    return {
      error: `"${rawUrl}" must use the matching English route "${expectedRoute}"`,
    };
  }

  return { route: url.pathname };
}

function schemaTypeNames(value) {
  const types = Array.isArray(value) ? value : [value];
  return types
    .filter((type) => typeof type === "string")
    .map((type) => type.toLowerCase());
}

function collectPageOwnedJsonLdUrls(value, entries = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPageOwnedJsonLdUrls(item, entries);
    }
    return entries;
  }
  if (!value || typeof value !== "object") {
    return entries;
  }

  const ownerType = schemaTypeNames(value["@type"]).find((type) =>
    pageOwnedSchemaTypes.has(type),
  );
  if (ownerType) {
    for (const field of ["url", "@id", "mainEntityOfPage"]) {
      const fieldValue = value[field];
      const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      for (const candidate of values) {
        if (typeof candidate === "string") {
          entries.push({
            field,
            ownerType,
            value: candidate,
          });
        } else if (
          candidate &&
          typeof candidate === "object" &&
          typeof candidate["@id"] === "string"
        ) {
          entries.push({
            field: `${field}.@id`,
            ownerType,
            value: candidate["@id"],
          });
        }
      }
    }
  }

  for (const child of Object.values(value)) {
    collectPageOwnedJsonLdUrls(child, entries);
  }
  return entries;
}

function validatePageOwnedJsonLdUrls(page, json, sourceIndex) {
  const expectedRoute = currentRoute(page.relativePath);
  const expectedUrl = `${siteOrigin}${expectedRoute}`;

  for (const entry of collectPageOwnedJsonLdUrls(json)) {
    let parsed;
    try {
      parsed = new URL(entry.value);
    } catch {
      parsed = null;
    }

    const allowsFragment =
      entry.field === "@id" || entry.field.endsWith(".@id");
    const valid =
      parsed?.origin === siteOrigin &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === expectedRoute &&
      parsed.search === "" &&
      (allowsFragment || parsed.hash === "");
    if (!valid) {
      const valueIndex = page.source.indexOf(
        JSON.stringify(entry.value),
        sourceIndex,
      );
      addFailure(
        page.relativePath,
        page.source,
        valueIndex === -1 ? sourceIndex : valueIndex,
        `${entry.ownerType === "softwareapplication" ? "SoftwareApplication" : entry.ownerType} ${entry.field} must be exactly "${expectedUrl}"${allowsFragment ? " with an optional fragment" : ""}`,
      );
    }
  }
}

function parseJsonLd(page) {
  const scriptPattern =
    /<script\b((?:"[^"]*"|'[^']*'|[^'"<>])*)>/gi;
  const closingPattern = /<\/script\s*>/gi;
  let opening;

  while ((opening = scriptPattern.exec(page.source)) !== null) {
    const attributes = parseAttributes(
      opening[1],
      opening.index + "<script".length,
    );
    const type = attributes.find((attribute) => attribute.name === "type");
    closingPattern.lastIndex = scriptPattern.lastIndex;
    const closing = closingPattern.exec(page.source);
    const isJsonLd =
      type?.value?.trim().toLowerCase() === "application/ld+json";

    if (!closing) {
      if (isJsonLd) {
        counts.jsonLdBlocks += 1;
        addFailure(
          page.relativePath,
          page.source,
          opening.index,
          "JSON-LD script block is not closed",
        );
      }
      break;
    }

    if (isJsonLd) {
      counts.jsonLdBlocks += 1;
      const jsonSource = page.source.slice(
        scriptPattern.lastIndex,
        closing.index,
      );
      try {
        const json = JSON.parse(jsonSource);
        validatePageOwnedJsonLdUrls(page, json, scriptPattern.lastIndex);
      } catch (error) {
        addFailure(
          page.relativePath,
          page.source,
          scriptPattern.lastIndex,
          `invalid JSON-LD: ${error.message}`,
        );
      }
    }

    scriptPattern.lastIndex = closingPattern.lastIndex;
  }
}

function collectIds(page) {
  const ids = new Set();
  for (const tag of page.tags) {
    const id = findAttribute(tag, "id");
    if (id?.value !== undefined) {
      const value = decodeHtmlAttribute(id.value);
      if (ids.has(value)) {
        addFailure(
          page.relativePath,
          page.source,
          id.index,
          `duplicate id="${value}"`,
        );
      }
      ids.add(value);
    }
  }
  return ids;
}

function isSkippableUrl(value) {
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  return Boolean(
    scheme && !["http", "https"].includes(scheme[1].toLowerCase()),
  );
}

function validateLocalLinks(page, pages, publicFiles) {
  const linkAttributeNames = new Set(["href", "poster", "src"]);
  const baseUrl = `${siteOrigin}${currentRoute(page.relativePath)}`;

  for (const tag of page.tags) {
    for (const attribute of tag.attributes) {
      if (
        !linkAttributeNames.has(attribute.name) ||
        attribute.value === undefined
      ) {
        continue;
      }

      const rawValue = decodeHtmlAttribute(attribute.value).trim();
      if (isSkippableUrl(rawValue)) {
        continue;
      }

      let url;
      try {
        url = new URL(rawValue, baseUrl);
      } catch {
        addFailure(
          page.relativePath,
          page.source,
          attribute.index,
          `${attribute.name}="${attribute.value}" is not a valid local URL`,
        );
        continue;
      }

      if (url.origin !== siteOrigin) {
        continue;
      }

      counts.localLinks += 1;
      const target = resolveRoute(url.pathname, publicFiles);
      if (!target) {
        addFailure(
          page.relativePath,
          page.source,
          attribute.index,
          `local target "${attribute.value}" does not exist`,
        );
        continue;
      }

      if (!url.hash || !target.endsWith(".html")) {
        continue;
      }

      let fragment;
      try {
        fragment = decodeURIComponent(url.hash.slice(1));
      } catch {
        addFailure(
          page.relativePath,
          page.source,
          attribute.index,
          `fragment "${url.hash}" is not valid URL encoding`,
        );
        continue;
      }

      if (fragment && !pages.get(target)?.ids.has(fragment)) {
        addFailure(
          page.relativePath,
          page.source,
          attribute.index,
          `fragment "#${fragment}" does not exist in ${target}`,
        );
      }
    }
  }
}

function collectLocaleMetadata(page) {
  const canonical = [];
  const alternates = new Map();

  for (const tag of page.tags.filter((candidate) => candidate.name === "link")) {
    const rel = findAttribute(tag, "rel");
    if (!rel?.value) {
      continue;
    }

    const relationships = rel.value.toLowerCase().split(/\s+/);
    const href = findAttribute(tag, "href");
    if (relationships.includes("canonical")) {
      canonical.push({
        href: href?.value,
        index: href?.index ?? tag.index,
      });
    }

    if (relationships.includes("alternate")) {
      const hreflang = findAttribute(tag, "hreflang");
      if (!hreflang?.value) {
        continue;
      }
      const language = hreflang.value.toLowerCase();
      const entries = alternates.get(language) ?? [];
      entries.push({
        href: href?.value,
        index: href?.index ?? tag.index,
      });
      alternates.set(language, entries);
    }
  }

  return { canonical, alternates };
}

function requireSingleMetadataEntry(page, entries, label) {
  if (entries.length !== 1) {
    addFailure(
      page.relativePath,
      page.source,
      entries[1]?.index ?? entries[0]?.index ?? 0,
      `expected exactly one ${label}; found ${entries.length}`,
    );
    return null;
  }
  if (!entries[0].href) {
    addFailure(
      page.relativePath,
      page.source,
      entries[0].index,
      `${label} is missing href`,
    );
    return null;
  }
  return entries[0];
}

function validateOpenGraphUrl(page, publicFiles) {
  const entries = page.tags
    .filter((tag) => tag.name === "meta")
    .map((tag) => ({
      tag,
      property: findAttribute(tag, "property"),
      content: findAttribute(tag, "content"),
    }))
    .filter(
      ({ property }) =>
        property?.value?.trim().toLowerCase() === "og:url",
    )
    .map(({ tag, content }) => ({
      href: content?.value,
      index: content?.index ?? tag.index,
    }));
  const entry = requireSingleMetadataEntry(page, entries, "og:url meta tag");
  if (!entry) {
    return;
  }

  const expectedUrl = `${siteOrigin}${currentRoute(page.relativePath)}`;
  const value = decodeHtmlAttribute(entry.href).trim();
  const result = siteUrlRoute(value, publicFiles);
  if (
    result.error ||
    result.route !== page.relativePath ||
    value !== expectedUrl
  ) {
    addFailure(
      page.relativePath,
      page.source,
      entry.index,
      `og:url must be exactly "${expectedUrl}"`,
    );
  }
}

function validateDocumentLanguage(page) {
  const htmlTags = page.tags.filter((tag) => tag.name === "html");
  if (htmlTags.length !== 1) {
    addFailure(
      page.relativePath,
      page.source,
      htmlTags[1]?.index ?? htmlTags[0]?.index ?? 0,
      `expected exactly one <html> element; found ${htmlTags.length}`,
    );
    return;
  }

  const lang = findAttribute(htmlTags[0], "lang");
  const value = lang?.value
    ? decodeHtmlAttribute(lang.value).trim().toLowerCase()
    : "";
  if (value !== "zh-hans") {
    addFailure(
      page.relativePath,
      page.source,
      lang?.index ?? htmlTags[0].index,
      'Chinese public pages must use lang="zh-Hans"',
    );
  }
}

function validateChineseVisibleText(page) {
  const mask = (value) => " ".repeat(value.length);
  const visibleSource = page.source
    .replace(/<!--[\s\S]*?-->/g, mask)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, mask)
    .replace(/<[^>]*>/g, mask);
  const chineseCharacter =
    /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.exec(
      decodeHtmlForScan(visibleSource),
    );

  if (!chineseCharacter) {
    addFailure(
      page.relativePath,
      page.source,
      0,
      "Chinese public pages must contain visible Chinese text",
    );
  }
}

function validateLocaleMetadata(page, publicFiles) {
  const metadata = collectLocaleMetadata(page);
  const expectedRoute = currentRoute(page.relativePath);
  const expectedSiteUrl = `${siteOrigin}${expectedRoute}`;
  const expectedCounterpartUrl = `${counterpartOrigin}${expectedRoute}`;

  const canonical = requireSingleMetadataEntry(
    page,
    metadata.canonical,
    "canonical link",
  );
  if (canonical) {
    const canonicalUrl = decodeHtmlAttribute(canonical.href).trim();
    const result = siteUrlRoute(canonicalUrl, publicFiles);
    if (result.error) {
      addFailure(
        page.relativePath,
        page.source,
        canonical.index,
        `canonical ${result.error}`,
      );
    } else if (
      result.route !== page.relativePath ||
      canonicalUrl !== expectedSiteUrl
    ) {
      addFailure(
        page.relativePath,
        page.source,
        canonical.index,
        `canonical must be exactly "${expectedSiteUrl}"`,
      );
    }
  }

  const chineseSelf = requireSingleMetadataEntry(
    page,
    metadata.alternates.get("zh-hans") ?? [],
    'alternate link for hreflang="zh-Hans"',
  );
  if (chineseSelf) {
    const alternateUrl = decodeHtmlAttribute(chineseSelf.href).trim();
    const result = siteUrlRoute(alternateUrl, publicFiles);
    if (result.error) {
      addFailure(
        page.relativePath,
        page.source,
        chineseSelf.index,
        `hreflang="zh-Hans" alternate ${result.error}`,
      );
    } else if (
      result.route !== page.relativePath ||
      alternateUrl !== expectedSiteUrl
    ) {
      addFailure(
        page.relativePath,
        page.source,
        chineseSelf.index,
        `hreflang="zh-Hans" must be exactly "${expectedSiteUrl}"`,
      );
    }
  }

  for (const language of ["en", "x-default"]) {
    const entry = requireSingleMetadataEntry(
      page,
      metadata.alternates.get(language) ?? [],
      `alternate link for hreflang="${language}"`,
    );
    if (!entry) {
      continue;
    }

    const alternateUrl = decodeHtmlAttribute(entry.href).trim();
    const result = counterpartUrlRoute(alternateUrl, expectedRoute);
    if (result.error) {
      addFailure(
        page.relativePath,
        page.source,
        entry.index,
        `hreflang="${language}" alternate ${result.error}`,
      );
    } else if (alternateUrl !== expectedCounterpartUrl) {
      addFailure(
        page.relativePath,
        page.source,
        entry.index,
        `hreflang="${language}" must be exactly "${expectedCounterpartUrl}"`,
      );
    }
  }

  for (const entry of metadata.alternates.get("zh") ?? []) {
    addFailure(
      page.relativePath,
      page.source,
      entry.index,
      'use hreflang="zh-Hans" instead of hreflang="zh"',
    );
  }
}

function validateLanguageSwitch(page) {
  const expectedUrl = `${counterpartOrigin}${currentRoute(page.relativePath)}`;
  const switches = page.tags
    .filter((tag) => tag.name === "a")
    .map((tag) => ({
      tag,
      href: findAttribute(tag, "href"),
      hreflang: findAttribute(tag, "hreflang"),
      lang: findAttribute(tag, "lang"),
    }))
    .filter(
      ({ hreflang }) =>
        hreflang?.value?.trim().toLowerCase() === "en",
    );

  if (switches.length !== 1) {
    addFailure(
      page.relativePath,
      page.source,
      switches[1]?.tag.index ?? switches[0]?.tag.index ?? 0,
      `expected exactly one visible English language switch; found ${switches.length}`,
    );
    return;
  }

  const languageSwitch = switches[0];
  const hidden = findAttribute(languageSwitch.tag, "hidden");
  const inert = findAttribute(languageSwitch.tag, "inert");
  const ariaHidden = findAttribute(languageSwitch.tag, "aria-hidden");
  const style = findAttribute(languageSwitch.tag, "style");
  const isDirectlyHidden =
    Boolean(hidden) ||
    Boolean(inert) ||
    ariaHidden?.value?.trim().toLowerCase() === "true" ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i.test(
      style?.value ?? "",
    );
  if (isDirectlyHidden) {
    addFailure(
      page.relativePath,
      page.source,
      hidden?.index ??
        inert?.index ??
        ariaHidden?.index ??
        style?.index ??
        languageSwitch.tag.index,
      "language switch must be visible",
    );
  }

  const href = languageSwitch.href?.value
    ? decodeHtmlAttribute(languageSwitch.href.value).trim()
    : "";
  const lang = languageSwitch.lang?.value
    ? decodeHtmlAttribute(languageSwitch.lang.value).trim().toLowerCase()
    : "";
  if (href !== expectedUrl) {
    addFailure(
      page.relativePath,
      page.source,
      languageSwitch.href?.index ?? languageSwitch.tag.index,
      `visible language switch must point to "${expectedUrl}"`,
    );
  }
  if (lang !== "en") {
    addFailure(
      page.relativePath,
      page.source,
      languageSwitch.lang?.index ?? languageSwitch.tag.index,
      'visible English language switch must use lang="en"',
    );
  }

  const closingAnchor = page.source.indexOf("</a>", languageSwitch.tag.endIndex);
  const label =
    closingAnchor === -1
      ? ""
      : visibleLine(
          page.source.slice(languageSwitch.tag.endIndex, closingAnchor),
        ).trim();
  if (!["English", "EN"].includes(label)) {
    addFailure(
      page.relativePath,
      page.source,
      languageSwitch.tag.endIndex,
      'visible English language switch must use the label "English" or "EN"',
    );
  }
}

function validateRepositorySeparation(discoveredFiles) {
  for (const relativePath of discoveredFiles) {
    if (
      relativePath.startsWith("zh/") ||
      /(?:^|\/)[^/]+-zh\.html$/i.test(relativePath)
    ) {
      failures.push({
        relativePath,
        line: 1,
        message: "duplicate same-domain Chinese locale paths must not be tracked",
      });
    }
    if (relativePath === ".github/workflows/sync-cn.yml") {
      failures.push({
        relativePath,
        line: 1,
        message: "the retired Chinese-site sync workflow must not be tracked",
      });
    }
  }
}

const directFactRules = [
  {
    pattern: /\bshot\s*streamer\b/i,
    message: "prohibited competitor name: Shot Streamer",
  },
  {
    pattern: /\bcyfrtimer\b/i,
    message: "prohibited competitor name: cyfrTimer",
  },
  {
    pattern: /\bcapcut\b/i,
    message: "prohibited competitor name: CapCut",
  },
  {
    pattern: /\bmatchchaser\b/i,
    message: "prohibited competitor name: MatchChaser",
  },
  {
    pattern:
      /\b(?:one[\s-]+purchase|single[\s-]+purchase|one[\s-]+time[\s-]+purchase|lifetime[\s-]+(?:purchase|access))\b/i,
    message: "stale purchase claim",
  },
  {
    pattern: /一次\s*购买|买断|终身/i,
    message: "stale purchase claim",
  },
  {
    pattern: /\b100\s*%\s*secure\b/i,
    message: "absolute privacy claim",
  },
  {
    pattern: /\bno\s+analytics\b/i,
    message: "absolute privacy claim",
  },
  {
    pattern: /\bno\s+third\s+part(?:y|ies)\b/i,
    message: "absolute privacy claim",
  },
  {
    pattern: /\bno\s+data\s+leaves\b/i,
    message: "absolute privacy claim",
  },
  {
    pattern:
      /\beverything\s+stays\s+entirely\s+on\s+(?:the\s+)?device\b/i,
    message: "absolute privacy claim",
  },
  {
    pattern:
      /\b(?:all\s+(?:video|audio|media)(?:\s+and\s+(?:video|audio|media))?\s+processing\s+is\s+(?:performed\s+)?locally|your\s+media\s+files?\s+never\s+leaves?\s+your\s+device|(?:video|audio|media)\s+files?\s+(?:are|is)\s+never\s+(?:uploaded|transmitted)\s+to\s+(?:our|any)\s+servers?)\b/i,
    message: "absolute local-media privacy claim",
  },
  {
    pattern:
      /(?:所有|全部)[^。；]{0,40}(?:视频|音频|媒体)[^。；]{0,60}(?:都|完全)[^。；]{0,30}(?:本地|设备端)|媒体文件[^。；]{0,30}(?:绝不|永不|从不)[^。；]{0,20}(?:离开|上传)/i,
    message: "absolute local-media privacy claim",
  },
  {
    pattern:
      /\banonymous\b.{0,120}\b(?:detection|telemetry)\b|\b(?:detection|telemetry)\b.{0,120}\banonymous\b/i,
    message: "detection reports must be described as pseudonymous",
  },
  {
    pattern:
      /(?<!伪)匿名(?:的)?(?:派生|检测|遥测|报告|字段)|(?:检测|遥测)报告[^。；]{0,80}(?<!伪)匿名/i,
    message: "detection reports must be described as pseudonymous",
  },
  {
    pattern: /\ball\s+features\b.{0,40}\boffline\b|\bfull(?:y)?\s+offline\b/i,
    message: "absolute offline claim",
  },
  {
    pattern: /100\s*%\s*安全|无任何分析|无第三方|没有任何数据离开|完全离线可用/i,
    allowedPattern: /(?:不承诺|不保证|不存在)[^。；]{0,80}100\s*%\s*安全/i,
    message: "absolute privacy or offline claim",
  },
];

const contextualFactRules = [
  {
    pattern:
      /(?:\bstage\s*mix\b|\bcameras?\b|\bvideos?\b|机位|视频).{0,120}(?:\b3\s*\+|three\s+or\s+more|3\s*个\s*或\s*更多|三\s*机位\s*以上)|(?:\b3\s*\+|three\s+or\s+more|3\s*个\s*或\s*更多|三\s*机位\s*以上).{0,120}(?:\bstage\s*mix\b|\bcameras?\b|\bvideos?\b|机位|视频)/i,
    message: "stale Stage Mix input-count claim",
  },
  {
    pattern:
      /\bstrings\b.{0,80}\b(?:editing\s+)?(?:mode|workflow)\b|\b(?:editing\s+)?(?:mode|workflow)s?\b.{0,80}\bstrings\b/i,
    message: 'obsolete "Strings" editing-mode claim',
  },
  {
    pattern:
      /\btiktok\b.{0,100}\b(?:direct(?:ly)?\s+upload|upload(?:ed|ing|s)?|integrat(?:e|ed|es|ing|ion)|connect(?:ed|ing|ion|s)?|share\s+(?:directly\s+)?to|post(?:ed|ing|s)?\s+to|publish(?:ed|ing|es)?\s+to)\b|(?:direct(?:ly)?\s+upload|upload(?:ed|ing|s)?|integrat(?:e|ed|es|ing|ion)|connect(?:ed|ing|ion|s)?|share\s+(?:directly\s+)?to|post(?:ed|ing|s)?\s+to|publish(?:ed|ing|es)?\s+to).{0,100}\btiktok\b/i,
    allowedPattern:
      /\b(?:does\s+not|do\s+not|doesn't|not\s+currently|currently\s+does\s+not|no\s+current)\b.{0,120}\b(?:tiktok|direct(?:ly)?\s+upload)\b/i,
    message: "TikTok direct-upload or integration claim",
  },
  {
    pattern:
      /tiktok.{0,100}(?:直传|直接上传|上传|集成|整合|连接|分享到|发布到)|(?:直传|直接上传|上传|集成|整合|连接|分享到|发布到).{0,100}tiktok/i,
    allowedPattern:
      /(?:不提供|不支持|尚未提供|当前没有).{0,80}tiktok|tiktok.{0,80}(?:不提供|不支持|尚未提供|当前没有)/i,
    message: "TikTok direct-upload or integration claim",
  },
];

function isFactLintPage(relativePath) {
  return relativePath !== "oauth" && !relativePath.startsWith("oauth/");
}

function visibleLine(line) {
  return line
    .replace(/<!--.*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ");
}

function visibleSourceForFactScan(source) {
  const mask = (value) => " ".repeat(value.length);
  return decodeHtmlForScan(
    source
      .replace(/<!--[\s\S]*?-->/g, mask)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, mask)
      .replace(/<[^>]*>/g, mask)
      .replace(/&nbsp;/gi, mask),
  ).replace(/\r?\n/g, mask);
}

const requiredPrivacyBoundaryRules = [
  {
    pattern:
      /核心视频与音频分析[\s\S]{0,80}剪辑[\s\S]{0,80}导出[\s\S]{0,80}人物追踪[\s\S]{0,80}设备上运行/i,
    message: "must preserve the precise on-device core-processing boundary",
  },
  {
    pattern:
      /原始素材不会上传到\s*ShootingCut\s*的媒体处理服务器/i,
    message: "must preserve the original-footage processing-server boundary",
  },
  {
    pattern:
      /素材别名[\s\S]*机位视角[\s\S]*枪械类型[\s\S]*成绩的关联[\s\S]*导入的比赛记录[\s\S]*射手和比赛字段/i,
    message: "must list the metadata that can use iCloud KVS",
  },
  {
    pattern:
      /非匿名\s*RevenueCat App User ID[\s\S]{0,280}\$RCAnonymousID:/i,
    message:
      "must disclose the custom RevenueCat App User ID KVS boundary",
  },
  {
    pattern:
      /原始媒体文件[\s\S]*PCM\s*音频[\s\S]*人物追踪路径[\s\S]*不会放入\s*KVS/i,
    message: "must list media and tracking data excluded from iCloud KVS",
  },
  {
    pattern:
      /RevenueCat[\s\S]*接收[\s\S]*标识符[\s\S]*订阅状态/i,
    message: "must describe RevenueCat identifiers and subscription status",
  },
  {
    pattern:
      /读取该\s*ID[\s\S]{0,120}登录\s*RevenueCat/i,
    message:
      "must describe restoring a custom RevenueCat App User ID from KVS",
  },
  {
    pattern:
      /帮助改进枪声检测[\s\S]{0,160}用户可控制[\s\S]{0,80}默认开启/i,
    message:
      "must state that detection improvement is currently enabled by default",
  },
  {
    pattern:
      /编辑界面的行内开关[\s\S]{0,160}“改进检测”[\s\S]{0,80}“改进”[\s\S]{0,180}导出设置[\s\S]{0,100}“帮助改进枪声检测”/i,
    message: "must list the actual detection-improvement control labels",
  },
  {
    pattern: /CloudKit[\s\S]{0,160}有限的伪匿名派生/i,
    message: "detection reports must be described as pseudonymous",
  },
  {
    pattern:
      /随机会话标识符和分析标识符[\s\S]*纠错事件/i,
    message: "must list detection-report identifiers and correction events",
  },
  {
    pattern:
      /报告不包含原始视频[\s\S]*原始音频[\s\S]*PCM\s*音频/i,
    message: "must state that detection reports exclude original media and PCM",
  },
  {
    pattern:
      /不会创建新的报告[\s\S]{0,80}不会重试发送本地待处理队列/i,
    message: "must state what disabling detection improvement stops",
  },
  {
    pattern:
      /不会删除此前已经提交的报告[\s\S]{0,120}不会清空[\s\S]{0,40}本地重试队列/i,
    message: "must state what disabling detection improvement does not erase",
  },
  {
    pattern: /成绩导入[\s\S]{0,180}(?:需要网络连接|使用网络)/i,
    message: "must state that score import uses the network",
  },
  {
    pattern:
      /所选导出视频[\s\S]*YouTube\s*或\s*Facebook[\s\S]*账号或视频元数据/i,
    message: "must describe user-initiated YouTube and Facebook uploads",
  },
  {
    pattern:
      /iCloud\s*数据[\s\S]{0,200}自定义\s*RevenueCat App User ID/i,
    message:
      "must include the custom RevenueCat App User ID in KVS retention",
  },
];

const requiredSupportBoundaryRules = [
  {
    pattern:
      /编辑界面的行内开关[\s\S]{0,160}“改进检测”[\s\S]{0,80}“改进”[\s\S]{0,180}导出设置[\s\S]{0,100}“帮助改进枪声检测”/i,
    message: "support must list the actual detection-improvement control labels",
  },
];

function validatePrivacyBoundary(page) {
  if (page.relativePath !== "privacy.html") {
    return;
  }

  const visibleText = page.source
    .split("\n")
    .map((line) => visibleLine(line))
    .join(" ");
  for (const rule of requiredPrivacyBoundaryRules) {
    if (!rule.pattern.test(visibleText)) {
      addFailure(page.relativePath, page.source, 0, rule.message);
    }
  }
}

function validateSupportBoundary(page) {
  if (page.relativePath !== "support.html") {
    return;
  }

  const visibleText = page.source
    .split("\n")
    .map((line) => visibleLine(line))
    .join(" ");
  for (const rule of requiredSupportBoundaryRules) {
    if (!rule.pattern.test(visibleText)) {
      addFailure(page.relativePath, page.source, 0, rule.message);
    }
  }
}

function validateMarketingFacts(page) {
  if (!isFactLintPage(page.relativePath)) {
    return;
  }

  const visibleSource = visibleSourceForFactScan(page.source);
  for (const rule of [...directFactRules, ...contextualFactRules]) {
    const flags = rule.pattern.flags.includes("g")
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    let match;

    while ((match = pattern.exec(visibleSource)) !== null) {
      const contextStart = Math.max(0, match.index - 180);
      const contextEnd = Math.min(
        visibleSource.length,
        match.index + match[0].length + 180,
      );
      const context = visibleSource.slice(contextStart, contextEnd);
      const allowedPattern = rule.allowedPattern
        ? new RegExp(
            rule.allowedPattern.source,
            rule.allowedPattern.flags.replaceAll("g", ""),
          )
        : null;

      if (!allowedPattern?.test(context)) {
        addFailure(
          page.relativePath,
          page.source,
          match.index,
          rule.message,
        );
        break;
      }
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }

  const stringsHeading =
    /<(?:h[1-6]|dt|strong)\b[^>]*>\s*strings\s*<\/(?:h[1-6]|dt|strong)>/i.exec(
      page.source,
    );
  if (stringsHeading) {
    addFailure(
      page.relativePath,
      page.source,
      stringsHeading.index,
      'obsolete "Strings" editing-mode heading',
    );
  }
}

function decodeXmlText(text) {
  const invalidReference = text.match(
    /&(?!(?:amp|apos|gt|lt|quot|#x[0-9a-f]+|#[0-9]+);)/i,
  );
  if (invalidReference) {
    return { error: "contains an unescaped or invalid XML entity" };
  }
  return {
    value: text.replace(
      /&(amp|apos|gt|lt|quot|#x[0-9a-f]+|#[0-9]+);/gi,
      (_, reference) => decodeCharacterReference(reference),
    ),
  };
}

function parseSitemap(source) {
  const locations = [];
  const stack = [];
  const tokenPattern =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>|[^<]+/g;
  let rootSeen = false;
  let rootClosed = false;
  let lastIndex = 0;
  let token;

  const closeNode = (node, index) => {
    if (node.localName === "loc") {
      const decoded = decodeXmlText(node.text.trim());
      if (decoded.error) {
        addFailure("sitemap.xml", source, node.index, `sitemap <loc> ${decoded.error}`);
      } else if (!decoded.value) {
        addFailure("sitemap.xml", source, node.index, "sitemap <loc> must not be empty");
      } else {
        locations.push({ value: decoded.value, index: node.index });
      }
    }
    if (node.localName === "url" && node.locCount !== 1) {
      addFailure(
        "sitemap.xml",
        source,
        node.index,
        `sitemap <url> must contain exactly one direct <loc>; found ${node.locCount}`,
      );
    }
    if (node.localName === "urlset") {
      rootClosed = true;
    }
    node.closedAt = index;
  };

  while ((token = tokenPattern.exec(source)) !== null) {
    if (token.index !== lastIndex) {
      addFailure(
        "sitemap.xml",
        source,
        lastIndex,
        "sitemap contains malformed XML syntax",
      );
    }
    lastIndex = tokenPattern.lastIndex;
    const value = token[0];

    if (value.startsWith("<!--") || value.startsWith("<?")) {
      continue;
    }
    if (value.startsWith("<![CDATA[")) {
      addFailure(
        "sitemap.xml",
        source,
        token.index,
        "CDATA is not allowed in sitemap.xml",
      );
      continue;
    }
    if (!value.startsWith("<")) {
      const current = stack.at(-1);
      if (current?.localName === "loc") {
        current.text += value;
      } else if (
        value.trim() &&
        !["changefreq", "lastmod", "priority"].includes(current?.localName)
      ) {
        addFailure(
          "sitemap.xml",
          source,
          token.index,
          "unexpected text outside sitemap <loc>",
        );
      }
      continue;
    }

    if (value.startsWith("</")) {
      const name = value.slice(2, -1).trim();
      const current = stack.at(-1);
      if (!current || current.name !== name) {
        addFailure(
          "sitemap.xml",
          source,
          token.index,
          `mismatched closing tag </${name}>`,
        );
        continue;
      }
      stack.pop();
      closeNode(current, token.index);
      continue;
    }

    const nameMatch = value.match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)/);
    const name = nameMatch?.[1] ?? "";
    const localName = name.includes(":") ? name.split(":").at(-1) : name;
    const parent = stack.at(-1);
    const selfClosing = /\/\s*>$/.test(value);

    if (!parent) {
      if (rootSeen || rootClosed) {
        addFailure(
          "sitemap.xml",
          source,
          token.index,
          "sitemap must contain exactly one root element",
        );
      }
      rootSeen = true;
      if (localName !== "urlset") {
        addFailure(
          "sitemap.xml",
          source,
          token.index,
          "sitemap root element must be <urlset>",
        );
      }
    } else if (parent.localName === "urlset" && localName !== "url") {
      addFailure(
        "sitemap.xml",
        source,
        token.index,
        `<${name}> is not a valid direct child of <urlset>`,
      );
    } else if (localName === "url" && parent.localName !== "urlset") {
      addFailure(
        "sitemap.xml",
        source,
        token.index,
        "<url> must be a direct child of <urlset>",
      );
    } else if (localName === "loc" && parent.localName !== "url") {
      addFailure(
        "sitemap.xml",
        source,
        token.index,
        "<loc> must be a direct child of <url>",
      );
    } else if (parent.localName === "loc") {
      addFailure(
        "sitemap.xml",
        source,
        token.index,
        "<loc> must contain text only",
      );
    }

    const node = {
      name,
      localName,
      index: token.index,
      locCount: 0,
      text: "",
    };
    if (localName === "loc" && parent?.localName === "url") {
      parent.locCount += 1;
    }
    stack.push(node);

    if (selfClosing) {
      stack.pop();
      closeNode(node, token.index);
    }
  }

  if (lastIndex !== source.length) {
    addFailure(
      "sitemap.xml",
      source,
      lastIndex,
      "sitemap contains malformed XML syntax",
    );
  }
  if (!rootSeen) {
    addFailure("sitemap.xml", source, 0, "sitemap root <urlset> is missing");
  }
  if (stack.length) {
    addFailure(
      "sitemap.xml",
      source,
      stack.at(-1).index,
      `unclosed sitemap element <${stack.at(-1).name}>`,
    );
  }

  return locations;
}

async function validateRobots() {
  let source;
  try {
    source = await readFile(absolutePath("robots.txt"), "utf8");
  } catch (error) {
    failures.push({
      relativePath: "robots.txt",
      line: 1,
      message: `cannot read robots.txt: ${error.message}`,
    });
    return;
  }

  const sitemapDirectives = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    const match = line.match(/^\s*Sitemap\s*:\s*(.*?)\s*$/i);
    if (match) {
      sitemapDirectives.push({
        index: offset,
        value: match[1],
      });
    }
    offset += line.length + 1;
  }

  if (sitemapDirectives.length !== 1) {
    addFailure(
      "robots.txt",
      source,
      sitemapDirectives[1]?.index ?? sitemapDirectives[0]?.index ?? 0,
      `sitemap directive must be exactly one "${siteSitemapUrl}"; found ${sitemapDirectives.length}`,
    );
  }
  for (const directive of sitemapDirectives) {
    if (directive.value !== siteSitemapUrl) {
      addFailure(
        "robots.txt",
        source,
        directive.index,
        `sitemap directive must be exactly "${siteSitemapUrl}"`,
      );
    }
  }
}

function collectSitemapLocaleGroups(source) {
  const groups = [];
  const urlPattern = /<url(?:\s[^>]*)?>([\s\S]*?)<\/url\s*>/gi;
  let match;

  while ((match = urlPattern.exec(source)) !== null) {
    const block = match[0];
    const locationMatch = block.match(
      /<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc\s*>/i,
    );
    let location = null;
    if (locationMatch) {
      const decoded = decodeXmlText(locationMatch[1].trim());
      if (!decoded.error) {
        location = decoded.value;
      }
    }

    const alternates = [];
    for (const tag of scanStartTags(block)) {
      if (tag.name !== "xhtml:link") {
        continue;
      }
      const rel = findAttribute(tag, "rel");
      const hreflang = findAttribute(tag, "hreflang");
      const href = findAttribute(tag, "href");
      alternates.push({
        rel: rel?.value ? decodeHtmlAttribute(rel.value).trim() : "",
        language: hreflang?.value
          ? decodeHtmlAttribute(hreflang.value).trim()
          : "",
        href: href?.value ? decodeHtmlAttribute(href.value).trim() : "",
        index: match.index + (href?.index ?? hreflang?.index ?? tag.index),
      });
    }

    groups.push({
      location,
      index: match.index,
      alternates,
    });
  }

  return groups;
}

function validateSitemapAlternates(
  source,
  groups,
  publicFiles,
  expectedPages,
) {
  for (const group of groups) {
    if (!group.location) {
      continue;
    }

    let locationUrl;
    try {
      locationUrl = new URL(group.location);
    } catch {
      continue;
    }
    if (locationUrl.origin !== siteOrigin) {
      continue;
    }

    const target = resolveRoute(locationUrl.pathname, publicFiles);
    if (!target || !expectedPages.has(target)) {
      continue;
    }

    const route = currentRoute(target);
    const expectedAlternates = new Map([
      ["zh-hans", `${siteOrigin}${route}`],
      ["en", `${counterpartOrigin}${route}`],
      ["x-default", `${counterpartOrigin}${route}`],
    ]);
    const alternatesByLanguage = new Map();

    for (const alternate of group.alternates) {
      if (alternate.rel.toLowerCase() !== "alternate") {
        addFailure(
          "sitemap.xml",
          source,
          alternate.index,
          'sitemap xhtml:link must use rel="alternate"',
        );
      }

      const language = alternate.language.toLowerCase();
      if (!language) {
        addFailure(
          "sitemap.xml",
          source,
          alternate.index,
          "sitemap alternate link is missing hreflang",
        );
        continue;
      }
      if (!alternate.href) {
        addFailure(
          "sitemap.xml",
          source,
          alternate.index,
          `sitemap alternate hreflang="${alternate.language}" is missing href`,
        );
        continue;
      }
      if (!expectedAlternates.has(language)) {
        addFailure(
          "sitemap.xml",
          source,
          alternate.index,
          `unexpected sitemap hreflang="${alternate.language}"`,
        );
        continue;
      }

      const entries = alternatesByLanguage.get(language) ?? [];
      entries.push(alternate);
      alternatesByLanguage.set(language, entries);
    }

    for (const [language, expectedHref] of expectedAlternates) {
      const entries = alternatesByLanguage.get(language) ?? [];
      const label = language === "zh-hans" ? "zh-Hans" : language;
      if (entries.length !== 1) {
        addFailure(
          "sitemap.xml",
          source,
          entries[1]?.index ?? entries[0]?.index ?? group.index,
          `expected exactly one sitemap alternate for hreflang="${label}"; found ${entries.length}`,
        );
        continue;
      }
      if (entries[0].href !== expectedHref) {
        addFailure(
          "sitemap.xml",
          source,
          entries[0].index,
          `sitemap hreflang="${label}" must be exactly "${expectedHref}"`,
        );
      }
    }
  }
}

async function validateSitemap(publicFiles, expectedPages) {
  let source;
  try {
    source = await readFile(absolutePath("sitemap.xml"), "utf8");
  } catch (error) {
    failures.push({
      relativePath: "sitemap.xml",
      line: 1,
      message: `cannot read sitemap.xml: ${error.message}`,
    });
    return;
  }

  if (/<!DOCTYPE/i.test(source)) {
    addFailure(
      "sitemap.xml",
      source,
      source.search(/<!DOCTYPE/i),
      "DOCTYPE is not allowed in sitemap.xml",
    );
  }

  const locations = parseSitemap(source);
  counts.sitemapLocations = locations.length;
  const seen = new Map();
  const targetCounts = new Map();

  for (const location of locations) {
    let url;
    try {
      url = new URL(location.value);
    } catch {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `sitemap location "${location.value}" is not a valid absolute URL`,
      );
      continue;
    }

    if (url.origin !== siteOrigin || url.username || url.password) {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `sitemap location "${location.value}" must use ${siteOrigin}`,
      );
      continue;
    }
    if (url.search || url.hash) {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `sitemap location "${location.value}" must not include a query or fragment`,
      );
    }

    if (seen.has(url.href)) {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `duplicate sitemap location "${location.value}"`,
      );
    } else {
      seen.set(url.href, location.index);
    }

    const target = resolveRoute(url.pathname, publicFiles);
    if (!target || !target.endsWith(".html")) {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `sitemap location "${location.value}" does not resolve to a public page`,
      );
      continue;
    }

    if (!expectedPages.has(target)) {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `sitemap location "${location.value}" must not include OAuth or non-public HTML`,
      );
      continue;
    }

    const expectedLocation = `${siteOrigin}${currentRoute(target)}`;
    if (location.value !== expectedLocation) {
      addFailure(
        "sitemap.xml",
        source,
        location.index,
        `sitemap location must be exactly "${expectedLocation}"`,
      );
    }
    targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  }

  for (const relativePath of [...expectedPages].sort()) {
    const count = targetCounts.get(relativePath) ?? 0;
    if (count !== 1) {
      addFailure(
        "sitemap.xml",
        source,
        0,
        `public page "${relativePath}" must appear exactly once in sitemap.xml; found ${count}`,
      );
    }
  }

  const localeGroups = collectSitemapLocaleGroups(source);
  if (localeGroups.length !== locations.length) {
    addFailure(
      "sitemap.xml",
      source,
      0,
      `expected one locale group per sitemap location; found ${localeGroups.length} groups for ${locations.length} locations`,
    );
  }
  validateSitemapAlternates(source, localeGroups, publicFiles, expectedPages);
}

async function main() {
  const discoveredFiles = await discoverPublicFiles();
  validateRepositorySeparation(discoveredFiles);
  const publicFiles = new Set(discoveredFiles);
  const htmlFiles = discoveredFiles.filter((file) => file.endsWith(".html"));
  counts.htmlPages = htmlFiles.length;

  const pages = new Map(
    await Promise.all(
      htmlFiles.map(async (relativePath) => {
        const source = await readFile(absolutePath(relativePath), "utf8");
        const page = {
          relativePath,
          source,
          tags: scanStartTags(source),
        };
        page.ids = collectIds(page);
        return [relativePath, page];
      }),
    ),
  );

  for (const page of pages.values()) {
    parseJsonLd(page);
    validateMarketingFacts(page);
    validatePrivacyBoundary(page);
    validateSupportBoundary(page);
  }
  for (const page of pages.values()) {
    validateLocalLinks(page, pages, publicFiles);
  }

  const normalPages = [...pages.values()].filter(
    (page) => !page.relativePath.startsWith("oauth/"),
  );
  for (const page of normalPages) {
    validateDocumentLanguage(page);
    validateChineseVisibleText(page);
    validateLocaleMetadata(page, publicFiles);
    validateOpenGraphUrl(page, publicFiles);
    validateLanguageSwitch(page);
  }

  await validateRobots();
  await validateSitemap(
    publicFiles,
    new Set(normalPages.map((page) => page.relativePath)),
  );

  failures.sort(
    (left, right) =>
      left.relativePath.localeCompare(right.relativePath) ||
      left.line - right.line ||
      left.message.localeCompare(right.message),
  );

  if (failures.length) {
    console.error(`Site validation failed with ${failures.length} error(s):`);
    for (const failure of failures) {
      console.error(
        `- ${failure.relativePath}:${failure.line} ${failure.message}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Validated ${counts.htmlPages} HTML pages, ${counts.jsonLdBlocks} JSON-LD ${
      counts.jsonLdBlocks === 1 ? "block" : "blocks"
    }, ${counts.localLinks} local link targets, and ${
      counts.sitemapLocations
    } sitemap locations.`,
  );
}

await main();
