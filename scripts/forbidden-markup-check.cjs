#!/usr/bin/env node
"use strict";

/**
 * Toolchain-provided forbidden markup check.
 * Projects can call this script directly from node_modules to hard-fail on disallowed UI patterns.
 */

const fs = require("fs");
const path = require("path");
const { parseCli } = require("./cli-args.cjs");
const { readBatchV2 } = require("./ui/ui-batch-v2.cjs");

const ROOT = process.cwd();

const DEFAULT_CONSTRAINTS_PATH = path.join(ROOT, "ui-hard-constraints.json");
const DEFAULT_POLICY_PATH = path.join(ROOT, "ui-policy.json");
const DEFAULT_PLATFORM = "web-vue";
const PACKAGE_DEFAULT_CONSTRAINTS_PATH = path.join(
  __dirname,
  "..",
  "cursor-bootstrap",
  "examples",
  "ui-hard-constraints.json"
);
const PACKAGE_DEFAULT_POLICY_PATH = path.join(__dirname, "..", "cursor-bootstrap", "examples", "ui-policy.json");

function parseArgsFromEnv() {
  const r = parseCli(process.argv, {
    strings: ["batch", "cacheKey", "constraints", "policy", "platform", "adapter"],
    arrays: ["file"],
    booleanFlags: [],
  });
  const batch = (r.values.batch || "").trim() || path.join(ROOT, "figma-e2e-batch.json");
  const constraints = (r.values.constraints || "").trim() || DEFAULT_CONSTRAINTS_PATH;
  const policy = (r.values.policy || "").trim() || DEFAULT_POLICY_PATH;
  const platform = (r.values.platform || "").trim() || DEFAULT_PLATFORM;
  const files = [...(r.arrays.file || [])];
  r.positionals.forEach((p) => {
    if (/\.(vue|html|tsx|jsx)$/i.test(p)) files.push(p);
  });
  return {
    batch,
    files: Array.from(new Set(files.map((p) => path.normalize(String(p || "").trim())).filter(Boolean))),
    cacheKey: (r.values.cacheKey || "").trim(),
    constraints,
    policy,
    platform,
    adapter: (r.values.adapter || "").trim(),
    unknownCli: r.unknown,
  };
}

function readJsonIfExists(absPath) {
  if (!absPath) return null;
  if (!fs.existsSync(absPath)) return null;
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readJsonWithFallback(primaryAbs, fallbackAbs) {
  const primary = readJsonIfExists(primaryAbs);
  if (primary) return primary;
  return readJsonIfExists(fallbackAbs);
}

function resolveAdapterPath(platform, adapterArg) {
  if (adapterArg) return adapterArg;
  const file = `ui-adapter.${platform}.json`;
  return path.join(ROOT, file);
}

function normalizePrimitiveDetectors(raw) {
  if (!raw)
    return { forbiddenTags: [], forbiddenAttrPrefixes: [], forbiddenAttrNames: [], forbiddenPatterns: [] };
  const forbiddenTags = Array.isArray(raw.forbiddenTags) ? raw.forbiddenTags.map(String) : [];
  const forbiddenAttrPrefixes = Array.isArray(raw.forbiddenAttrPrefixes)
    ? raw.forbiddenAttrPrefixes.map(String)
    : [];
  const forbiddenAttrNames = Array.isArray(raw.forbiddenAttrNames) ? raw.forbiddenAttrNames.map(String) : [];
  const forbiddenPatterns = Array.isArray(raw.forbiddenPatterns) ? raw.forbiddenPatterns : [];
  return { forbiddenTags, forbiddenAttrPrefixes, forbiddenAttrNames, forbiddenPatterns };
}

function compileConstraintsFromPolicy(policyRaw, adapterRaw) {
  const policy = policyRaw || {};
  const forbiddenPrimitives = Array.isArray(policy.forbiddenPrimitives)
    ? policy.forbiddenPrimitives.map(String)
    : [];
  const primitives = (adapterRaw && adapterRaw.primitives) || {};

  const acc = {
    forbiddenTags: [],
    forbiddenAttrPrefixes: [],
    forbiddenAttrNames: [],
    forbiddenPatterns: [],
  };

  forbiddenPrimitives.forEach((primitive) => {
    const detectors = normalizePrimitiveDetectors(primitives[primitive]);
    acc.forbiddenTags.push(...detectors.forbiddenTags);
    acc.forbiddenAttrPrefixes.push(...detectors.forbiddenAttrPrefixes);
    acc.forbiddenAttrNames.push(...detectors.forbiddenAttrNames);
    acc.forbiddenPatterns.push(...detectors.forbiddenPatterns);
  });

  acc.forbiddenTags = Array.from(new Set(acc.forbiddenTags));
  acc.forbiddenAttrPrefixes = Array.from(new Set(acc.forbiddenAttrPrefixes));
  acc.forbiddenAttrNames = Array.from(new Set(acc.forbiddenAttrNames));
  acc.forbiddenPatterns = acc.forbiddenPatterns.filter(Boolean);

  return acc;
}

function normalizeConstraintPatternsFromRaw(forbiddenPatterns) {
  if (!Array.isArray(forbiddenPatterns)) return [];
  return forbiddenPatterns
    .map((x) => {
      const vueSliceRaw = String(x && x.vueSlice != null ? x.vueSlice : "all")
        .trim()
        .toLowerCase();
      const vueSlice = vueSliceRaw === "template" ? "template" : "all";
      return {
        id: String(x && x.id ? x.id : "pattern"),
        re: new RegExp(String(x && x.pattern ? x.pattern : ""), "i"),
        vueSlice,
      };
    })
    .filter((x) => x.re && String(x.re) !== String(/(?:)/i));
}

function normalizeConstraints(raw) {
  const g = (raw && raw.global) || raw || {};
  const forbiddenTags = Array.isArray(g.forbiddenTags) ? g.forbiddenTags.map(String) : [];
  const forbiddenAttrPrefixes = Array.isArray(g.forbiddenAttrPrefixes)
    ? g.forbiddenAttrPrefixes.map(String)
    : [];
  const forbiddenAttrNames = Array.isArray(g.forbiddenAttrNames) ? g.forbiddenAttrNames.map(String) : [];
  const forbiddenPatterns = Array.isArray(g.forbiddenPatterns) ? g.forbiddenPatterns : [];

  return {
    forbiddenTags,
    forbiddenAttrPrefixes,
    forbiddenAttrNames,
    forbiddenPatterns: normalizeConstraintPatternsFromRaw(forbiddenPatterns),
  };
}

/**
 * batch case 的 constraints 与基线做并集（破坏性变更：不再用 override 整表替换基线）。
 * 若需收紧单 case，请在 ui-hard-constraints / policy 层处理或后续引入显式 replace 模式。
 */
function mergeConstraintsUnion(base, override) {
  if (!override) return base;
  const next = {
    forbiddenTags: [...(base.forbiddenTags || [])],
    forbiddenAttrPrefixes: [...(base.forbiddenAttrPrefixes || [])],
    forbiddenAttrNames: [...(base.forbiddenAttrNames || [])],
    forbiddenPatterns: [...(base.forbiddenPatterns || [])],
  };
  if (Array.isArray(override.forbiddenTags)) {
    next.forbiddenTags = Array.from(new Set([...next.forbiddenTags, ...override.forbiddenTags.map(String)]));
  }
  if (Array.isArray(override.forbiddenAttrPrefixes)) {
    next.forbiddenAttrPrefixes = Array.from(
      new Set([...next.forbiddenAttrPrefixes, ...override.forbiddenAttrPrefixes.map(String)])
    );
  }
  if (Array.isArray(override.forbiddenAttrNames)) {
    next.forbiddenAttrNames = Array.from(
      new Set([...next.forbiddenAttrNames, ...override.forbiddenAttrNames.map(String)])
    );
  }
  if (Array.isArray(override.forbiddenPatterns)) {
    const map = new Map(next.forbiddenPatterns.map((p) => [String(p.id), p]));
    normalizeConstraintPatternsFromRaw(override.forbiddenPatterns).forEach((p) => {
      map.set(String(p.id), p);
    });
    next.forbiddenPatterns = Array.from(map.values());
  }
  return next;
}

/** Union two normalized constraint objects (tags/prefixes/names deduped; patterns merged by id, later wins). */
function unionNormalizedConstraints(a, b) {
  const A = a || {
    forbiddenTags: [],
    forbiddenAttrPrefixes: [],
    forbiddenAttrNames: [],
    forbiddenPatterns: [],
  };
  const B = b || {
    forbiddenTags: [],
    forbiddenAttrPrefixes: [],
    forbiddenAttrNames: [],
    forbiddenPatterns: [],
  };
  const forbiddenTags = Array.from(new Set([...(A.forbiddenTags || []), ...(B.forbiddenTags || [])].map(String)));
  const forbiddenAttrPrefixes = Array.from(
    new Set([...(A.forbiddenAttrPrefixes || []), ...(B.forbiddenAttrPrefixes || [])].map(String))
  );
  const forbiddenAttrNames = Array.from(
    new Set([...(A.forbiddenAttrNames || []), ...(B.forbiddenAttrNames || [])].map(String))
  );
  const patternMap = new Map();
  [...(A.forbiddenPatterns || []), ...(B.forbiddenPatterns || [])].forEach((p) => {
    if (!p || !p.id) return;
    patternMap.set(String(p.id), p);
  });
  return {
    forbiddenTags,
    forbiddenAttrPrefixes,
    forbiddenAttrNames,
    forbiddenPatterns: Array.from(patternMap.values()),
  };
}

function formatEffectiveSummary(effective) {
  const tags = (effective.forbiddenTags || []).map((t) => `<${t}>`).join(", ") || "(none)";
  const attrs = [
    ...(effective.forbiddenAttrNames || []),
    ...(effective.forbiddenAttrPrefixes || []).map((p) => `${p}*`),
  ].join(", ") || "(none)";
  const pt = (effective.forbiddenPatterns || [])
    .filter((p) => (p.vueSlice || "all") === "template")
    .map((p) => p.id)
    .join("; ");
  const pa = (effective.forbiddenPatterns || [])
    .filter((p) => (p.vueSlice || "all") !== "template")
    .map((p) => p.id)
    .join("; ");
  return `tags=[${tags}] attrs=[${attrs}] patterns(all)=[${pa || "(none)"}] patterns(vue-template)=[${pt || "(none)"}]`;
}

function readBatchTargets(batchPath) {
  const abs = path.isAbsolute(batchPath) ? batchPath : path.join(ROOT, batchPath);
  if (!fs.existsSync(abs)) throw new Error(`batch file missing: ${abs}`);
  const batch = readBatchV2(abs, ROOT);
  return batch.cases
    .filter((item) => String(item && item.target && item.target.kind ? item.target.kind : "").trim() !== "html")
    .map((item) => {
      const target = String(item && item.target ? item.target.entry : "").trim();
      if (!target) throw new Error(`case[${item.index}] missing target.entry`);
      const absTarget = path.isAbsolute(target) ? path.normalize(target) : path.join(ROOT, target);
      return {
        absTarget,
        constraintsOverride: item && item.constraints ? item.constraints : null,
        policyOverride: item && item.policy ? item.policy : null,
        cacheKey: String(item && item.cacheKey ? item.cacheKey : "").trim(),
      };
    });
}

function findIconRegistryAbs() {
  const candidates = [
    path.join(ROOT, "ui-icon-registry.json"),
    path.join(ROOT, "figma-cache", "adapters", "ui-icon-registry.json"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || "";
}

function normalizeNodeId(input) {
  const v = String(input || "").trim();
  if (!v) return "";
  return v.includes(":") ? v : v.replace(/-/g, ":");
}

function rawJsonAbsFromCacheKey(cacheKey) {
  const ck = String(cacheKey || "").trim();
  if (!ck || !ck.includes("#")) return "";
  const [fileKey, nodeIdRaw] = ck.split("#");
  const nodeId = normalizeNodeId(nodeIdRaw);
  const safeNodeDir = String(nodeId).replace(/:/g, "-");
  return path.join(ROOT, "figma-cache", "files", fileKey, "nodes", safeNodeDir, "raw.json");
}

function compileRegistryIconMap(registryRaw, rawJson) {
  const entries = Array.isArray(registryRaw && registryRaw.entries) ? registryRaw.entries : [];
  const metrics = Array.isArray(rawJson && rawJson.iconMetrics) ? rawJson.iconMetrics : [];
  const out = {};
  metrics.forEach((m) => {
    const name = String(m && m.name ? m.name : "").trim();
    const nodeId = String(m && m.nodeId ? m.nodeId : "").trim();
    if (!name || !nodeId) return;
    for (const entry of entries) {
      const className = String(entry && entry.className ? entry.className : "").trim();
      const matchers =
        entry && entry.match && Array.isArray(entry.match.figmaNodeNameRegex) ? entry.match.figmaNodeNameRegex : [];
      if (!className || !matchers.length) continue;
      const ok = matchers.some((pat) => {
        try {
          return new RegExp(String(pat), "i").test(name);
        } catch {
          return false;
        }
      });
      if (ok) {
        out[nodeId] = className;
        break;
      }
    }
  });
  return out;
}

function applyPolicyOverride(basePolicy, policyOverride) {
  if (!policyOverride) return basePolicy;
  const next = { ...(basePolicy || {}) };
  const baseForbidden = Array.isArray(next.forbiddenPrimitives) ? next.forbiddenPrimitives.map(String) : [];
  const addForbidden = Array.isArray(policyOverride.forbiddenPrimitives)
    ? policyOverride.forbiddenPrimitives.map(String)
    : [];
  const allow = Array.isArray(policyOverride.allowPrimitives) ? policyOverride.allowPrimitives.map(String) : [];

  const merged = Array.from(new Set([...baseForbidden, ...addForbidden]));
  next.forbiddenPrimitives = merged.filter((x) => !allow.includes(x));
  return next;
}

function extractVueTemplateBody(content) {
  const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  return templateMatch ? String(templateMatch[1] || "") : "";
}

/**
 * Vue: PascalCase 为 SFC 组件；含连字符多为 kebab 组件或自定义元素。
 */
function skipCursorPointerHeuristicForTag(tag) {
  const t = String(tag || "").trim();
  if (!t) return true;
  if (/^[A-Z]/.test(t)) return true;
  if (t.includes("-")) return true;
  return false;
}

function scanFile(absPath, constraints, cacheKey) {
  const content = fs.readFileSync(absPath, "utf8");
  const violations = [];
  const isVue = String(absPath || "").toLowerCase().endsWith(".vue");
  const vueTemplateBody = isVue ? extractVueTemplateBody(content) : "";

  if (isVue) {
    const firstTagMatch = vueTemplateBody.match(/<(?!\/)([a-zA-Z][\w-]*)([\s\S]*?)(\/?)>/m);
    if (firstTagMatch) {
      const attrs = String(firstTagMatch[2] || "");
      const hasStatic =
        /\bclass\s*=\s*["'][^"']*\bgenerate-ui-reset\b[^"']*["']/i.test(attrs);
      const hasBound =
        /\b:class\s*=\s*["'][^"']*\bgenerate-ui-reset\b[^"']*["']/i.test(attrs) ||
        /\bv-bind:class\s*=\s*["'][^"']*\bgenerate-ui-reset\b[^"']*["']/i.test(attrs);
      if (!hasStatic && !hasBound) {
        violations.push("missing generate-ui-reset on template root element");
      }
    } else {
      violations.push("missing template root element");
    }
  }

  constraints.forbiddenTags.forEach((tag) => {
    const re = new RegExp(`<\\s*${tag}(\\s|>|/)`, "gi");
    if (re.test(content)) violations.push(`forbidden tag: <${tag}>`);
  });

  constraints.forbiddenAttrPrefixes.forEach((prefix) => {
    const re = new RegExp(`\\s${prefix}[a-z0-9_-]+\\s*=`, "gi");
    if (re.test(content)) violations.push(`forbidden attr prefix: ${prefix}*`);
  });

  constraints.forbiddenAttrNames.forEach((name) => {
    const re = new RegExp(`\\s${name}\\s*=`, "gi");
    if (re.test(content)) violations.push(`forbidden attr: ${name}`);
  });

  constraints.forbiddenPatterns.forEach((item) => {
    const slice = item.vueSlice || "all";
    const haystack = isVue && slice === "template" ? vueTemplateBody : content;
    if (item.re.test(haystack)) violations.push(`forbidden pattern: ${item.id}`);
  });

  const cursorScanSource = isVue ? vueTemplateBody : content;
  const clickLike =
    /<([a-zA-Z][\w-]*)([^>]*)(@click|@pointerdown|@mousedown|@mouseup)\s*=\s*["'][^"']+["']([^>]*)>/g;
  let match = null;
  while ((match = clickLike.exec(cursorScanSource))) {
    const tag = String(match[1] || "");
    if (skipCursorPointerHeuristicForTag(tag)) continue;
    const attrs = `${match[2] || ""}${match[4] || ""}`;
    if (!/cursor-pointer/.test(attrs)) {
      violations.push(`missing cursor-pointer on interactive <${tag}>`);
    }
  }

  const imgSizeFullIconLike =
    /<img[^>]*class\s*=\s*["'][^"']*\bmax-w-none\b[^"']*\binset-0\b[^"']*\bsize-full\b[^"']*["'][^>]*>/gi;
  if (imgSizeFullIconLike.test(content)) {
    violations.push("forbidden icon img classes: max-w-none + inset-0 + size-full (causes icon stretching)");
  }

  const registryAbs = findIconRegistryAbs();
  if (registryAbs && cacheKey) {
    const rawAbs = rawJsonAbsFromCacheKey(cacheKey);
    if (rawAbs && fs.existsSync(rawAbs)) {
      try {
        const registryRaw = JSON.parse(fs.readFileSync(registryAbs, "utf8"));
        const rawJson = JSON.parse(fs.readFileSync(rawAbs, "utf8"));
        const iconMap = compileRegistryIconMap(registryRaw, rawJson);
        Object.keys(iconMap).forEach((nodeId) => {
          const cls = iconMap[nodeId];
          if (!cls) return;
          if (content.includes(nodeId) && !content.includes(cls)) {
            violations.push(`icon registry missing class for ${nodeId}: expected ${cls}`);
          }
        });
      } catch {
        // ignore
      }
    }
  }

  return violations;
}

function main() {
  const args = parseArgsFromEnv();

  const policyPath = path.isAbsolute(args.policy) ? args.policy : path.join(ROOT, args.policy);
  const adapterPathRaw = resolveAdapterPath(args.platform, args.adapter);
  const adapterPath = path.isAbsolute(adapterPathRaw) ? adapterPathRaw : path.join(ROOT, adapterPathRaw);

  const policyRaw = readJsonWithFallback(policyPath, PACKAGE_DEFAULT_POLICY_PATH);
  const adapterRaw = readJsonIfExists(adapterPath);
  const canUsePolicy = Boolean(policyRaw && adapterRaw);

  const constraintsPath = path.isAbsolute(args.constraints) ? args.constraints : path.join(ROOT, args.constraints);
  const legacyConstraintsRaw = readJsonWithFallback(constraintsPath, PACKAGE_DEFAULT_CONSTRAINTS_PATH) || {
    global: {
      forbiddenTags: ["button", "p", "ul", "li"],
      forbiddenAttrPrefixes: ["aria-"],
      forbiddenAttrNames: ["role", "tabindex"],
      forbiddenPatterns: [
        { id: "custom scrollbar wrapper: scrollbar-hint", pattern: "\\bscrollbar-hint\\b" },
        { id: "custom scrollbar wrapper: hide-native-scrollbar", pattern: "\\bhide-native-scrollbar\\b" },
        {
          id: "no CSS font-variation-settings (Figma MCP noise)",
          pattern: "font-variation-settings",
          vueSlice: "template",
        },
        {
          id: "no inline fontVariationSettings (React-style MCP dump)",
          pattern: "fontVariationSettings\\s*:",
          vueSlice: "template",
        },
      ],
    },
  };

  const legacyGlobal = normalizeConstraints(legacyConstraintsRaw);
  const globalConstraints = canUsePolicy
    ? unionNormalizedConstraints(
        legacyGlobal,
        normalizeConstraints(compileConstraintsFromPolicy(policyRaw, adapterRaw))
      )
    : legacyGlobal;

  const explicitFiles = (args.files || [])
    .map((p) => (path.isAbsolute(p) ? p : path.join(ROOT, p)))
    .filter(Boolean);

  const batchItems = explicitFiles.length
    ? explicitFiles.map((absTarget) => ({
        absTarget,
        constraintsOverride: null,
        policyOverride: null,
        cacheKey: args.cacheKey,
      }))
    : readBatchTargets(args.batch);

  const missing = batchItems.map((x) => x.absTarget).filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error("[forbidden-markup-check] missing target files:");
    missing.forEach((p) => console.error(`- ${p}`));
    process.exit(2);
  }

  const allViolations = [];
  batchItems.forEach((item) => {
    let baseEffective = legacyGlobal;
    if (canUsePolicy) {
      const policyCase = normalizeConstraints(
        compileConstraintsFromPolicy(applyPolicyOverride(policyRaw, item.policyOverride), adapterRaw)
      );
      baseEffective = unionNormalizedConstraints(legacyGlobal, policyCase);
    }
    const effective = mergeConstraintsUnion(baseEffective, item.constraintsOverride);
    const violations = scanFile(item.absTarget, effective, item.cacheKey);
    if (violations.length) {
      allViolations.push({
        file: item.absTarget,
        violations,
        effectiveSummary: formatEffectiveSummary(effective),
      });
    }
  });

  if (allViolations.length) {
    console.error("[forbidden-markup-check] FAILED. Found forbidden markup.");
    console.error("Baseline summary (legacy ∪ policy, before per-case union):");
    console.error(`- ${formatEffectiveSummary(globalConstraints)}`);
    console.error("");
    allViolations.forEach((item) => {
      console.error(item.file);
      console.error(`  effective: ${item.effectiveSummary}`);
      item.violations.forEach((v) => console.error(`  - ${v}`));
    });
    process.exit(2);
  }

  if (args.unknownCli.length) {
    console.warn(`[forbidden-markup-check] warn: ignored unknown args: ${args.unknownCli.join(", ")}`);
  }

  console.log("[forbidden-markup-check] ok");
}

main();
