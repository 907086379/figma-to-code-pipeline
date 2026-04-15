#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "figma-cache", "index.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "figma-cache", "mobile-specs");

function parseArgs(argv) {
  const result = {
    url: "",
    platform: "all",
    outDir: DEFAULT_OUT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url") {
      result.url = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--url=")) {
      result.url = token.slice("--url=".length).trim();
      continue;
    }
    if (token === "--platform") {
      result.platform = String(argv[i + 1] || "all").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token.startsWith("--platform=")) {
      result.platform = token.slice("--platform=".length).trim().toLowerCase();
      continue;
    }
    if (token === "--out-dir") {
      const value = String(argv[i + 1] || "").trim();
      if (value) {
        result.outDir = path.isAbsolute(value) ? value : path.join(ROOT, value);
      }
      i += 1;
      continue;
    }
    if (token.startsWith("--out-dir=")) {
      const value = token.slice("--out-dir=".length).trim();
      if (value) {
        result.outDir = path.isAbsolute(value) ? value : path.join(ROOT, value);
      }
    }
  }

  return result;
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readMaybe(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    return "";
  }
  return fs.readFileSync(absPath, "utf8");
}

function resolveEntryPath(relOrAbs) {
  if (!relOrAbs) {
    return "";
  }
  if (path.isAbsolute(relOrAbs)) {
    return relOrAbs;
  }
  return path.join(ROOT, relOrAbs);
}

function extractSection(md, heading) {
  if (!md) {
    return "";
  }
  const marker = "## " + heading;
  const start = md.indexOf(marker);
  if (start < 0) {
    return "";
  }
  const tail = md.slice(start + marker.length);
  const next = tail.search(/\n##\s+/);
  const content = next >= 0 ? tail.slice(0, next) : tail;
  return content.trim();
}

function toNotes(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "object" && value.notes) {
    return String(value.notes).trim();
  }
  return JSON.stringify(value, null, 2);
}

function createTodoWarnings(normalized, missingDimensions) {
  const warnings = [];
  const fields = Object.keys(normalized);
  fields.forEach((field) => {
    const text = String(normalized[field] || "");
    if (!text) {
      warnings.push(field + ": empty");
      return;
    }
    if (/TODO|待补充|待完善/i.test(text)) {
      warnings.push(field + ": contains TODO");
    }
  });

  missingDimensions.forEach((dimension) => {
    warnings.push("coverage missing: " + dimension);
  });
  return warnings;
}

function validatePlatform(platform) {
  const allowed = new Set(["ios", "android", "all"]);
  if (!allowed.has(platform)) {
    throw new Error("--platform 仅支持 ios|android|all");
  }
}

function toSafeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|#]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function pickPlatforms(platform, normalized, warnings) {
  const shared = {
    implementationInputs: normalized,
    riskHints: warnings,
  };

  if (platform === "ios") {
    return {
      ios: {
        ...shared,
        suggestedStack: ["SwiftUI", "Design Tokens", "State-driven ViewModel"],
      },
    };
  }

  if (platform === "android") {
    return {
      android: {
        ...shared,
        suggestedStack: ["Jetpack Compose", "Material Theme", "UI State Holder"],
      },
    };
  }

  return {
    ios: {
      ...shared,
      suggestedStack: ["SwiftUI", "Design Tokens", "State-driven ViewModel"],
    },
    android: {
      ...shared,
      suggestedStack: ["Jetpack Compose", "Material Theme", "UI State Holder"],
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    throw new Error(
      "缺少 --url 参数。示例: npm run figma:cache:mobile:spec -- --url <figma-url>",
    );
  }

  validatePlatform(args.platform);

  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error("未找到 figma-cache/index.json，请先执行 figma:cache:init");
  }

  const index = readJson(INDEX_PATH);
  const items = index && index.items ? index.items : {};
  const match = Object.entries(items).find(
    ([, item]) => item && item.url === args.url,
  );

  if (!match) {
    throw new Error(
      "index.json 未命中该 URL，请先执行 figma:cache:get 或 figma:cache:upsert",
    );
  }

  const cacheKey = match[0];
  const safeOutputKey = toSafeSegment(cacheKey) || "unknown-cache-key";
  const item = match[1];
  const rawPath = resolveEntryPath(item.paths && item.paths.raw);
  const specPath = resolveEntryPath(item.paths && item.paths.spec);
  const metaPath = resolveEntryPath(item.paths && item.paths.meta);

  const raw = rawPath && fs.existsSync(rawPath) ? readJson(rawPath) : {};
  const meta = metaPath && fs.existsSync(metaPath) ? readJson(metaPath) : {};
  const specMd = readMaybe(specPath);

  const normalized = {
    layout: extractSection(specMd, "Layout（结构）"),
    text: extractSection(specMd, "Text（文案）"),
    tokens: extractSection(specMd, "Tokens（变量 / 样式）"),
    interactions: [
      extractSection(specMd, "Interactions（交互）"),
      toNotes(raw.interactions),
    ]
      .filter(Boolean)
      .join("\n\n"),
    states: [extractSection(specMd, "States（状态）"), toNotes(raw.states)]
      .filter(Boolean)
      .join("\n\n"),
    accessibility: [
      extractSection(specMd, "Accessibility（可访问性）"),
      toNotes(raw.accessibility),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  const missingDimensions =
    raw.coverageSummary && Array.isArray(raw.coverageSummary.missing)
      ? raw.coverageSummary.missing
      : [];

  const todoWarnings = createTodoWarnings(normalized, missingDimensions);

  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      cacheKey,
      outputKey: safeOutputKey,
      url: item.url || args.url,
      fileKey: item.fileKey || meta.fileKey || raw.fileKey || "",
      nodeId: item.nodeId || meta.nodeId || raw.nodeId || "",
      syncedAt: item.syncedAt || raw.syncedAt || "",
      completeness: item.completeness || raw.completeness || [],
      coverageMissing: missingDimensions,
      paths: {
        raw: item.paths && item.paths.raw ? item.paths.raw : "",
        spec: item.paths && item.paths.spec ? item.paths.spec : "",
        meta: item.paths && item.paths.meta ? item.paths.meta : "",
      },
    },
    normalized,
    todoWarnings,
    platforms: pickPlatforms(args.platform, normalized, todoWarnings),
  };

  const targetDir = path.join(args.outDir, safeOutputKey);
  fs.mkdirSync(targetDir, { recursive: true });
  const outPath = path.join(targetDir, "mobile-spec.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log(
    "[mobile-spec] generated:",
    path.relative(ROOT, outPath).split(path.sep).join("/"),
  );
}

main();