#!/usr/bin/env node
"use strict";

/**
 * 把 batch(v2) 的目标产物挂载/注入到页面（用于运行时验证）。
 *
 * 读取：
 * - figma-e2e-batch.json（默认；v2）
 * - figma-ui-batch.config.json（可选）：uiBatch.mountPage（当 case 未显式配置 mount.mountPage 时兜底）
 *
 * 用法：
 *   node scripts/ui-mount-batch.cjs --batch=./figma-e2e-batch.json [--case=0] [--all] [--mount-page=src/pages/main/index.vue] [--create-stub-on-miss]
 *
 * 支持：
 * - Vue mountPage（*.vue）：注入到 <template> 与 <script setup>
 * - React mountPage（*.tsx|*.jsx）：注入 import + JSX 使用
 * - HTML mountPage（*.html）：按 marker 容器注入 HTML 片段（幂等替换）
 */

const fs = require("fs");
const path = require("path");
const { readBatchV2 } = require("./ui-batch-v2.cjs");

const ROOT = process.cwd();
const DEFAULT_BATCH = "figma-e2e-batch.json";
const DEFAULT_UI_BATCH_CONFIG = "figma-ui-batch.config.json";

function readJsonOrThrow(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readJsonOrNull(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeSlash(p) {
  return String(p || "").replace(/\\/g, "/");
}

function resolveAbs(maybeRel) {
  const trimmed = String(maybeRel || "").trim();
  if (!trimmed) return "";
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.join(ROOT, trimmed);
}

function parseArgs(argv) {
  const out = {
    batch: DEFAULT_BATCH,
    caseIndex: 0,
    all: false,
    mountPage: "",
    createStubOnMiss: true,
  };
  argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--batch=")) out.batch = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--case=")) out.caseIndex = Number(arg.split("=").slice(1).join("=").trim());
    else if (arg.startsWith("--mount-page=")) out.mountPage = arg.split("=").slice(1).join("=").trim();
    else if (arg === "--all") out.all = true;
    else if (arg === "--no-create-stub-on-miss") out.createStubOnMiss = false;
    else if (arg === "--create-stub-on-miss") out.createStubOnMiss = true;
  });
  if (!Number.isFinite(out.caseIndex) || out.caseIndex < 0) out.caseIndex = 0;
  out.caseIndex = Math.floor(out.caseIndex);
  return out;
}

function readUiBatchConfig() {
  const configAbs = path.join(ROOT, DEFAULT_UI_BATCH_CONFIG);
  const raw = readJsonOrNull(configAbs);
  const config = raw && raw.uiBatch && typeof raw.uiBatch === "object" ? raw.uiBatch : raw;
  return { configAbs, config: config && typeof config === "object" ? config : null };
}

function inferComponentNameFromTarget(targetRel) {
  const rel = normalizeSlash(targetRel);
  const base = rel.split("/").filter(Boolean).slice(-1)[0] || "";
  // If target is a file like Foo.tsx, use basename (without extension) as component name.
  if (/\.(tsx|jsx|ts|js|vue)$/i.test(base) && !/\/index\.vue$/i.test(rel)) {
    return String(base).replace(/\.(tsx|jsx|ts|js|vue)$/i, "").trim();
  }
  // Else assume target is .../<Component>/index.vue or similar; use parent dir as component name.
  const dir = rel.split("/").slice(0, -1).join("/");
  const name = dir.split("/").filter(Boolean).slice(-1)[0] || "";
  return String(name).trim();
}

function ensureLeadingDotSlash(p) {
  const v = normalizeSlash(p);
  if (!v) return "./";
  if (v.startsWith(".")) return v;
  return `./${v}`;
}

function computeImportPath(fromFileAbs, targetAbs) {
  const rel = normalizeSlash(path.relative(path.dirname(fromFileAbs), targetAbs));
  const ext = path.extname(rel).toLowerCase();
  // TS default disallows importing with ts/tsx extensions unless allowImportingTsExtensions is enabled.
  const stripped =
    ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx"
      ? rel.slice(0, -ext.length)
      : rel;
  return ensureLeadingDotSlash(stripped);
}

function ensureDirForFile(fileAbs) {
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
}

function writeStubIfMissing(targetAbs, componentName, cacheKeyHint) {
  if (fs.existsSync(targetAbs)) return { created: false };
  ensureDirForFile(targetAbs);
  const ext = path.extname(targetAbs).toLowerCase();
  const stub =
    ext === ".vue"
      ? [
          "<template>",
          `  <div class="generate-ui-reset" data-generated="stub"${
            cacheKeyHint ? ` data-cache-key=${JSON.stringify(cacheKeyHint)}` : ""
          }>`,
          `    ${componentName} (stub)`,
          "  </div>",
          "</template>",
          "",
          '<script setup lang="ts">',
          "</script>",
          "",
        ].join("\n")
      : ext === ".html"
      ? [
          `<!-- generated stub: ${cacheKeyHint || componentName} -->`,
          `<div data-generated="stub"${cacheKeyHint ? ` data-cache-key=${JSON.stringify(cacheKeyHint)}` : ""}>`,
          `  ${componentName} (stub)`,
          "</div>",
          "",
        ].join("\n")
      : [
          `export default function ${componentName}() {`,
          "  return (",
          `    <div data-generated="stub"${
            cacheKeyHint ? ` data-cache-key=${JSON.stringify(cacheKeyHint)}` : ""
          }>`,
          `      ${componentName} (stub)`,
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n");
  fs.writeFileSync(targetAbs, stub, "utf8");
  return { created: true };
}

function ensureScriptSetupBlock(sfc) {
  const re = /<script\s+setup(?:\s+lang="ts")?\s*>([\s\S]*?)<\/script>/m;
  if (re.test(sfc)) {
    return { sfc, had: true };
  }
  // Insert an empty <script setup lang="ts"> before end of file (after template if present).
  const insert = `\n<script setup lang="ts">\n</script>\n`;
  if (/<\/template>\s*$/m.test(sfc)) {
    return { sfc: sfc.replace(/<\/template>\s*$/m, `</template>${insert}`), had: false };
  }
  return { sfc: `${sfc.replace(/\s*$/, "")}${insert}`, had: false };
}

function addImportToScriptSetup(sfc, componentName, importPath) {
  const re = /(<script\s+setup(?:\s+lang="ts")?\s*>)([\s\S]*?)(<\/script>)/m;
  const m = sfc.match(re);
  if (!m) return sfc;
  const body = String(m[2] || "");
  const importLine = `import ${componentName} from ${JSON.stringify(importPath)};`;
  if (new RegExp(`\\bimport\\s+${componentName}\\b`).test(body)) {
    return sfc;
  }
  const nextBody = `${importLine}\n${body.replace(/^\s*\n/, "")}`;
  return sfc.replace(re, (full, open, inner, close) => `${open}${nextBody}${close}`);
}

function mountComponentInTemplate(sfc, componentName) {
  // Insert <ComponentName /> right before </section> if present, else before </template>.
  if (!/<template>[\s\S]*<\/template>/m.test(sfc)) {
    // No template: create minimal SFC.
    return `<template>\n  <${componentName} />\n</template>\n\n<script setup lang="ts">\n</script>\n`;
  }

  // Avoid duplicating mount
  if (new RegExp(`<${componentName}\\b`).test(sfc)) {
    return sfc;
  }

  const sectionCloseRe = /<\/section>\s*<\/template>/m;
  if (sectionCloseRe.test(sfc)) {
    return sfc.replace(sectionCloseRe, `  <${componentName} />\n  </section>\n</template>`);
  }

  const templateCloseRe = /<\/template>/m;
  return sfc.replace(templateCloseRe, `  <${componentName} />\n</template>`);
}

function addImportToReactFile(source, componentName, importPath) {
  const importLine = `import ${componentName} from ${JSON.stringify(importPath)};`;
  const existingRe = new RegExp(
    String.raw`(^\s*import\s+${componentName}\s+from\s+)(["'][^"']+["'])(\s*;\s*)$`,
    "m"
  );
  if (existingRe.test(source)) {
    // Replace path if different (e.g. previously imported with ".tsx").
    return source.replace(existingRe, `$1${JSON.stringify(importPath)}$3`);
  }
  // Insert after the last import, else at top.
  const lines = String(source || "").split(/\r?\n/);
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*import\b/.test(lines[i])) lastImportIdx = i;
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine);
    return lines.join("\n");
  }
  return `${importLine}\n${source}`;
}

function mountComponentInReactJsx(source, componentName) {
  const text = String(source || "");
  if (new RegExp(`<${componentName}\\b`).test(text)) {
    return text;
  }
  function injectIntoFirstJsxRoot(body) {
    // Prefer injecting as first child inside the first JSX root element.
    // This avoids turning a single-root return into multi-root (invalid) JSX.
    const b = String(body || "");
    const openTagEnd = b.indexOf(">");
    if (openTagEnd >= 0 && b.trimStart().startsWith("<")) {
      const before = b.slice(0, openTagEnd + 1);
      const after = b.slice(openTagEnd + 1);
      const newline = before.endsWith("\n") ? "" : "\n";
      return `${before}${newline}    <${componentName} />\n${after.replace(/^\s*\n/, "")}`;
    }
    // Fallback: prepend (may produce multi-root, so only used when we can't detect root tag)
    return `<${componentName} />\n${b.replace(/^\s*\n/, "")}`;
  }

  // Heuristic A: inside first `return (` JSX block.
  const returnRe = /return\s*\(\s*([\s\S]*?)\)\s*;?\s*/m;
  const returnM = text.match(returnRe);
  if (returnM) {
    const body = String(returnM[1] || "");
    const injected = injectIntoFirstJsxRoot(body);
    return text.replace(returnRe, (full) => full.replace(body, injected));
  }

  // Heuristic B: arrow implicit return: `const X = () => ( ... )`
  const arrowRe = /=>\s*\(\s*([\s\S]*?)\)\s*;?/m;
  const arrowM = text.match(arrowRe);
  if (arrowM) {
    const body = String(arrowM[1] || "");
    const injected = injectIntoFirstJsxRoot(body);
    return text.replace(arrowRe, (full) => full.replace(body, injected));
  }

  // Fallback: do nothing (avoid destructive edits).
  return text;
}

function applyMountToPage(mountPageAbs, mounts) {
  const ext = path.extname(mountPageAbs).toLowerCase();
  const before = fs.readFileSync(mountPageAbs, "utf8");
  let next = before;

  if (ext === ".vue") {
    // Vue SFC: ensure template usage + script setup import(s)
    mounts.forEach(({ componentName }) => {
      next = mountComponentInTemplate(next, componentName);
    });
    const ensured = ensureScriptSetupBlock(next);
    next = ensured.sfc;
    mounts.forEach(({ componentName, importPath }) => {
      next = addImportToScriptSetup(next, componentName, importPath);
    });
  } else if (ext === ".tsx" || ext === ".jsx") {
    mounts.forEach(({ componentName, importPath }) => {
      next = addImportToReactFile(next, componentName, importPath);
    });
    mounts.forEach(({ componentName }) => {
      next = mountComponentInReactJsx(next, componentName);
    });
  } else {
    console.error(`[ui-mount-batch] 不支持的 mountPage 后缀：${ext}`);
    process.exit(2);
  }

  if (next !== before) {
    fs.writeFileSync(mountPageAbs, next, "utf8");
  }
  return { changed: next !== before };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureHtmlMarkerContainer(html, marker) {
  const m = String(marker || "").trim();
  if (!m) return { html, ensured: false };
  const attrRe = new RegExp(`data-figma-mount\\s*=\\s*["']${escapeRegExp(m)}["']`, "i");
  if (attrRe.test(html)) return { html, ensured: false };
  const insert = `\n  <div data-figma-mount="${m}"></div>\n`;
  if (/<\/body>/i.test(html)) {
    return { html: html.replace(/<\/body>/i, `${insert}</body>`), ensured: true };
  }
  return { html: `${html.replace(/\s*$/, "")}${insert}`, ensured: true };
}

function injectHtmlIntoMarkerContainer(html, marker, injected) {
  const m = String(marker || "").trim();
  if (!m) return html;

  const start = `<!-- figma-mount:${m}:start -->`;
  const end = `<!-- figma-mount:${m}:end -->`;
  const payload = `\n    ${start}\n${String(injected || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")}\n    ${end}\n  `;

  // 1) 优先替换已有 start/end 区域（幂等）
  const regionRe = new RegExp(
    `(<!--\\s*figma-mount:${escapeRegExp(m)}:start\\s*-->)[\\s\\S]*?(<!--\\s*figma-mount:${escapeRegExp(m)}:end\\s*-->)`,
    "i"
  );
  if (regionRe.test(html)) {
    return html.replace(regionRe, `${start}${payload.replace(start, "").replace(end, "")}${end}`);
  }

  // 2) 替换容器 innerHTML
  const containerRe = new RegExp(
    `(<([a-zA-Z][\\w-]*)([^>]*\\sdata-figma-mount\\s*=\\s*["']${escapeRegExp(m)}["'][^>]*)>)([\\s\\S]*?)(<\\/\\2>)`,
    "i"
  );
  if (containerRe.test(html)) {
    return html.replace(containerRe, (full, open, tag, attrs, inner, close) => `${open}${payload}${close}`);
  }

  // 3) 处理自闭合容器：<div ... />
  const selfCloseRe = new RegExp(
    `<([a-zA-Z][\\w-]*)([^>]*\\sdata-figma-mount\\s*=\\s*["']${escapeRegExp(m)}["'][^>]*?)\\s*\\/\\s*>`,
    "i"
  );
  if (selfCloseRe.test(html)) {
    return html.replace(selfCloseRe, (full, tag, attrs) => `<${tag}${attrs}>${payload}</${tag}>`);
  }

  // 兜底：不做破坏性替换
  return html;
}

function applyHtmlInjectMount(mountPageAbs, mounts) {
  const before = fs.readFileSync(mountPageAbs, "utf8");
  let next = before;
  mounts.forEach((m) => {
    const ensured = ensureHtmlMarkerContainer(next, m.marker);
    next = ensured.html;
    next = injectHtmlIntoMarkerContainer(next, m.marker, m.injectedHtml);
  });
  if (next !== before) fs.writeFileSync(mountPageAbs, next, "utf8");
  return { changed: next !== before };
}

function main() {
  const args = parseArgs(process.argv);
  const batchAbs = resolveAbs(args.batch);
  if (!batchAbs || !fs.existsSync(batchAbs)) {
    console.error(`[ui-mount-batch] batch not found: ${batchAbs || args.batch}`);
    process.exit(2);
  }

  const batch = readBatchV2(batchAbs, ROOT);
  const cases = args.all ? batch.cases : [batch.cases[args.caseIndex]];
  if (!cases.length || cases.some((c) => !c)) {
    console.error(`[ui-mount-batch] case index 越界：${args.caseIndex}`);
    process.exit(2);
  }

  const { config } = readUiBatchConfig();
  const mountPageRelOverride = String(args.mountPage || "").trim();
  const mountPageRelFallback =
    String(config && config.mountPage ? config.mountPage : "").trim() || "src/pages/main/index.vue";

  function mountPageRelForCase(item) {
    if (mountPageRelOverride) return mountPageRelOverride;
    const fromCase = item && item.mount && item.mount.mountPage ? String(item.mount.mountPage).trim() : "";
    return fromCase || mountPageRelFallback;
  }

  const groups = new Map(); // mountPageRel -> case[]
  cases.forEach((c) => {
    const rel = mountPageRelForCase(c);
    if (!groups.has(rel)) groups.set(rel, []);
    groups.get(rel).push(c);
  });

  let totalMounted = 0;
  const stubsCreated = [];
  groups.forEach((caseList, mountPageRel) => {
    const mountPageAbs = resolveAbs(mountPageRel);
    if (!mountPageAbs || !fs.existsSync(mountPageAbs)) {
      console.error(`[ui-mount-batch] mount page not found: ${mountPageAbs}`);
      process.exit(2);
    }
    const mounts = [];
    caseList.forEach((item) => {
      const targetRel = String(item && item.target && item.target.entry ? item.target.entry : "").trim();
      if (!targetRel) {
        console.error(`[ui-mount-batch] case[${item.index}] 缺失 target.entry`);
        process.exit(2);
      }
      const targetAbs = resolveAbs(targetRel);
      if (!targetAbs) {
        console.error(`[ui-mount-batch] invalid target path: ${targetRel}`);
        process.exit(2);
      }
      const componentName = inferComponentNameFromTarget(targetRel) || String(item.id || `Case${item.index}`);
      const cacheKeyHint = String(item && item.cacheKey ? item.cacheKey : "").trim();
      const stub = args.createStubOnMiss
        ? writeStubIfMissing(targetAbs, componentName, cacheKeyHint)
        : { created: false };
      if (!fs.existsSync(targetAbs)) {
        console.error(`[ui-mount-batch] target path does not exist: ${targetAbs}`);
        console.error("Hint: pass --create-stub-on-miss (default) or generate the target component first.");
        process.exit(2);
      }
      if (stub.created) stubsCreated.push(componentName);

      const targetKind = String(item && item.target ? item.target.kind : "").trim();
      if (String(mountPageAbs).toLowerCase().endsWith(".html") || targetKind === "html") {
        mounts.push({
          componentName,
          targetRel,
          targetAbs,
          marker: String(item && item.mount && item.mount.marker ? item.mount.marker : `case-${item.index}`).trim(),
          injectedHtml: fs.readFileSync(targetAbs, "utf8"),
        });
      } else {
        mounts.push({
          componentName,
          targetRel,
          targetAbs,
          importPath: computeImportPath(mountPageAbs, targetAbs),
        });
      }
    });

    if (String(mountPageAbs).toLowerCase().endsWith(".html")) {
      applyHtmlInjectMount(mountPageAbs, mounts);
    } else {
      applyMountToPage(mountPageAbs, mounts);
    }
    totalMounted += mounts.length;
  });

  console.log("[ui-mount-batch] ok");
  console.log(`- mountPage: ${Array.from(groups.keys()).map(normalizeSlash).join(", ")}`);
  console.log(`- mode: ${args.all ? "all" : `case=${args.caseIndex}`}`);
  console.log(`- mounted: ${totalMounted}`);
  if (stubsCreated.length) {
    console.log(`- stub: created (${stubsCreated.length})`);
  }
}

main();

