/* global chrome */
"use strict";

const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const exportAuditCsvBtn = document.getElementById("exportAuditCsv");
const crawlCountInput = document.getElementById("crawlCount");

const panelMap = {
  overview: document.getElementById("panel-overview"),
  plan: document.getElementById("panel-plan"),
  onpage: document.getElementById("panel-onpage"),
  content: document.getElementById("panel-content"),
  links: document.getElementById("panel-links"),
  media: document.getElementById("panel-media"),
  schema: document.getElementById("panel-schema"),
  tech: document.getElementById("panel-tech"),
  jsseo: document.getElementById("panel-jsseo"),
  ai: document.getElementById("panel-ai"),
  serp: document.getElementById("panel-serp"),
  regex: document.getElementById("panel-regex")
};

const toggleOverlayBtn = document.getElementById("toggleOverlay");

// SEO Constants - Centralized thresholds for maintainability
const SEO_LIMITS = {
  TITLE_MIN: 30,
  TITLE_MAX: 60,
  META_DESC_MIN: 70,
  META_DESC_MAX: 160,
  WORD_COUNT_MIN: 300,
  LCP_WARN: 2500,
  LCP_DANGER: 4000,
  CLS_WARN: 0.1,
  CLS_DANGER: 0.25,
  INP_WARN: 200,
  INP_DANGER: 500,
  FID_WARN: 100,
  FID_DANGER: 300,
  TTFB_WARN: 800,
  TTFB_DANGER: 1200
};

const state = {
  analysis: null,
  schemaOverride: null,
  previous: null,
  serp: null,
  crawl: null,
  serpGap: null,
  recentAudits: [],
  crawlProgress: { done: 0, total: 0 },
  aiHighlightPayload: null,
  overlayActive: false,
  mediaFilter: null
};

const metricTooltips = {
  // Summary
  "Indexable": "Whether the page is allowed to be indexed by search engines.\nGood: Yes (for public pages)",
  "Title Length": "Length of the <title> tag.\nGood: 30-60 characters",
  "Description Length": "Length of the meta description.\nGood: 120-160 characters",
  "Word Count": "Total word count of the main content.\nImpact: Higher count often correlates with depth.",
  "Text/HTML Ratio": "Percentage of text content relative to HTML code.\nGood: >10%",
  // Performance
  "TTFB": "Time to First Byte - server response time.\nGood: <800ms",
  "FCP": "First Contentful Paint - when content first appears.\nGood: <1.8s",
  "LCP": "Largest Contentful Paint - main content load time.\nGood: <2.5s",
  "CLS": "Cumulative Layout Shift - visual stability.\nGood: <0.1",
  "INP": "Interaction to Next Paint - responsiveness.\nGood: <200ms",
  "FID": "First Input Delay - responsiveness (Legacy).\nGood: <100ms",
  // JS SEO
  "Dependency Score": "Rough estimate of JS weight based on libraries found.\nLower is better.",
  "JS Content %": "Percentage of content rendered by JavaScript vs statically served.\nHigh % means reliance on JS.",
  "Text Added": "Characters added to the DOM after initial load.",
  "Links Added": "Links injected by JavaScript.",
  // Content
  "Reading Ease": "Flesch Reading Ease score (0-100).\nHigher is easier to read.",
  "Grade Level": "Flesch-Kincaid Grade Level.\nGood: 6-8 for general audience.",
  "Sentences": "Total sentence count.",
  "Headings Added": "Headings (H1-H6) injected by JavaScript.",
  "Robots.txt": "Availability of the robots.txt file.",
  "Meta Robots": "Meta tag directives (e.g., noindex, nofollow).",
  "NoAI": "Whether standard AI bot blocking directives are detected.",
  "NoImageAI": "Whether AI image generation bot directives are detected.",
  "JS Text Share": "Percentage of text content that requires JavaScript to render."
};

const ui = {
  metric: (label, value, tooltipKey = null, extraClass = "") => {
    const tooltipAttr = tooltipKey && metricTooltips[tooltipKey]
      ? `data-tooltip="${escapeHtml(metricTooltips[tooltipKey])}"`
      : "";
    return `<div class="metric ${extraClass}" ${tooltipAttr}>
        <span>${escapeHtml(label)}</span>${value}
    </div>`;
  }
};

function setStatus(text, isLoading = false) {
  // Auto-detect states from common keywords
  const loadingKeywords = ["running", "analyzing", "crawling", "loading", "processing"];
  const errorKeywords = ["error", "failed", "unable", "cannot"];
  const successKeywords = ["complete", "success", "done", "ready"];

  const textLower = text.toLowerCase();
  const shouldShowLoading = isLoading || loadingKeywords.some(kw => textLower.includes(kw));
  const isError = errorKeywords.some(kw => textLower.includes(kw));
  const isSuccess = successKeywords.some(kw => textLower.includes(kw)) && !isError;

  // Build class list
  let className = "status";
  if (shouldShowLoading) className += " loading";
  if (isError) className += " error";
  if (isSuccess) className += " success";

  statusEl.className = className;
  statusEl.textContent = text;
}

async function loadRecentAudits() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["atlas:recentAudits"], (result) => {
      state.recentAudits = result["atlas:recentAudits"] || [];
      resolve(state.recentAudits);
    });
  });
}

async function saveRecentAudit(url) {
  const entry = { url, at: new Date().toISOString() };
  const list = [entry, ...state.recentAudits].filter((item, idx, arr) => arr.findIndex((x) => x.url === item.url) === idx).slice(0, 10);
  state.recentAudits = list;
  return new Promise((resolve) => {
    chrome.storage.local.set({ "atlas:recentAudits": list }, () => resolve());
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegexLiteral(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function parseRegexTerms(raw) {
  const parts = (raw || "")
    .split(/\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  parts.forEach((p) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  });
  return out;
}

function escapeRegexToken(value) {
  return value
    .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

function parseKeywordList(text) {
  return (text || "")
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSrcSelector(src) {
  if (typeof CSS !== "undefined" && CSS.escape) {
    return `img[src="${CSS.escape(src)}"]`;
  }
  return `img[src="${src.replace(/\"/g, '\\\"')}"]`;
}

function formatMs(value) {
  if (value === null || value === undefined) return "-";
  return `${value} ms`;
}

function formatKb(value) {
  if (!value || value <= 0) return "-";
  return `${Math.round(value / 10) / 100} KB`;
}

function formatCount(value) {
  if (value === null || value === undefined) return "-";
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}m`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return `${value}`;
}

function isValidTabUrl(url) {
  return url && (url.startsWith("http://") || url.startsWith("https://"));
}

function pickSeverity(value, warn, danger) {
  if (value === null || value === undefined) return "";
  if (danger !== null && value >= danger) return "badge-danger";
  if (warn !== null && value >= warn) return "badge-warn";
  return "";
}

function buildIssues(analysis) {
  const issues = [];
  const title = analysis.title || "";
  const titleLen = title.length;
  if (!title) issues.push("Missing title tag.");
  if (titleLen > 0 && titleLen < SEO_LIMITS.TITLE_MIN) issues.push(`Title is short (< ${SEO_LIMITS.TITLE_MIN} chars).`);
  if (titleLen > SEO_LIMITS.TITLE_MAX) issues.push(`Title is long (> ${SEO_LIMITS.TITLE_MAX} chars).`);

  const metaDesc = analysis.metaDescription || "";
  const metaLen = metaDesc.length;
  if (!metaDesc) issues.push("Missing meta description.");
  if (metaLen > 0 && metaLen < SEO_LIMITS.META_DESC_MIN) issues.push(`Meta description is short (< ${SEO_LIMITS.META_DESC_MIN} chars).`);
  if (metaLen > SEO_LIMITS.META_DESC_MAX) issues.push(`Meta description is long (> ${SEO_LIMITS.META_DESC_MAX} chars).`);

  const headings = analysis.headings || {};
  if ((headings.h1 ?? 0) === 0) issues.push("No H1 found.");
  if ((headings.h1 ?? 0) > 1) issues.push("Multiple H1 tags detected.");

  if (!analysis.canonical) issues.push("Missing canonical tag.");
  if ((analysis.metaRobots || "").toLowerCase().includes("noindex")) issues.push("Meta robots contains noindex.");

  const images = analysis.images || {};
  if ((images.missingAlt ?? 0) > 0) {
    issues.push(`Images missing alt text: ${images.missingAlt}.`);
  }

  if ((analysis.wordCount ?? 0) > 0 && analysis.wordCount < SEO_LIMITS.WORD_COUNT_MIN) {
    issues.push(`Low word count (< ${SEO_LIMITS.WORD_COUNT_MIN} words).`);
  }

  return issues;
}

function tokenize(text) {
  const stopwords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "was", "were", "has", "have", "had",
    "but", "not", "can", "will", "just", "about", "into", "over", "more", "less", "than", "then", "they", "them", "their",
    "its", "our", "out", "use", "used", "using", "how", "why", "what", "when", "where", "which", "who", "a", "an", "of", "to",
    "in", "on", "at", "by", "is", "be", "as", "it", "or", "if", "we", "i"
  ]);
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stopwords.has(word));
}

function buildSnippetPreview(analysis) {
  const title = analysis.title || "";
  const desc = analysis.metaDescription || "";
  const titleTrim = title.length > 60 ? `${title.slice(0, 57)}...` : title;
  const descTrim = desc.length > 160 ? `${desc.slice(0, 157)}...` : desc;
  return { title: titleTrim, description: descTrim };
}

function deriveBrandPattern(url, title) {
  try {
    const host = new URL(url).hostname.replace(/^www\\./, "");
    const parts = host.split(".").filter(Boolean);
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const raw = (title || base || "").split("|")[0].split("–")[0].trim() || base;
    const escaped = raw
      .replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")
      .replace(/\\s+/g, "\\\\s+")
      .replace(/_{2,}/g, "_");
    return escaped || base || "brand";
  } catch (err) {
    return "brand";
  }
}

function buildRegexHelpers(analysis) {
  const brand = deriveBrandPattern(analysis.url || "", analysis.title || "");
  const brandQuery = `(?i)(${brand})`;
  const nonBrandQuery = `(?i)^(?!.*(${brand})).*`;
  const questionQuery = "(?i)^(what|why|how|when|where|who|does|is|are)\\b.*";
  const transactionalQuery = "(?i)(buy|price|pricing|deal|coupon|order|near me|for sale)";
  const blogPath = "^/blog/.*";
  const productPath = "^/(product|products|shop|store|p|item|collections)/.*";
  const localePath = "^/(en|us|uk|ca|au|de|fr|es)/.*";
  const healthParams = "(?i)(fbclid|gclid|_ga)=.*";

  return [
    { scope: "GSC Queries", label: "Brand queries", pattern: brandQuery },
    { scope: "GSC Queries", label: "Non-brand queries", pattern: nonBrandQuery },
    { scope: "GSC Queries", label: "Question intent", pattern: questionQuery },
    { scope: "GSC Queries", label: "Transactional intent", pattern: transactionalQuery },
    { scope: "GSC Pages", label: "Blog section", pattern: blogPath },
    { scope: "GSC Pages", label: "Product/shop", pattern: productPath },
    { scope: "GSC Pages", label: "Locale folders", pattern: localePath },
    { scope: "GA4 Page path", label: "Blog section", pattern: blogPath },
    { scope: "GA4 Page path", label: "Product/shop", pattern: productPath },
    { scope: "GA4 Page path", label: "Locale folders", pattern: localePath },
    { scope: "GA4 URL", label: "Strip tracking params", pattern: healthParams }
  ];
}

function generateCustomRegex(inputText) {
  const tokens = inputText
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => escapeRegexToken(s));
  if (!tokens.length) return { pattern: "", message: "Enter at least one keyword." };
  const body = tokens.length === 1 ? tokens[0] : `(${tokens.join("|")})`;
  const pattern = `(?i)${body}`;
  return { pattern, message: "" };
}

function re2Warnings(pattern) {
  const warns = [];
  if (/\(\?[=!<]/.test(pattern)) warns.push("RE2 does not support lookarounds like (?=...), (?!...), (?<=...), (?<!...).");
  if (/\\[1-9]\d*/.test(pattern)) warns.push("RE2 does not support backreferences like \\1, \\2, etc.");
  if (/^\/.*\/[gimsuy]*$/.test(pattern)) warns.push("Enter regex without surrounding slashes or flags (use (?i) for case-insensitive).");
  return warns;
}

function buildRe2Regex({ target, matchType, terms, escape, wholeWord, caseInsensitive }) {
  const parsed = parseRegexTerms(terms);
  if (!parsed.length) return "";
  const cooked = parsed.map((t) => (escape ? escapeRegexLiteral(t) : t));
  const orGroup = cooked.length === 1 ? cooked[0] : `(?:${cooked.join("|")})`;
  const bounded = wholeWord ? `(?:^|\\W)${orGroup}(?:\\W|$)` : orGroup;

  let core = bounded;
  if (target === "ga4") {
    if (matchType === "contains") core = `.*${bounded}.*`;
    if (matchType === "starts") core = `^${bounded}.*`;
    if (matchType === "ends") core = `.*${bounded}$`;
    if (matchType === "exact") core = `^${bounded}$`;
  } else {
    if (matchType === "contains") core = `${bounded}`;
    if (matchType === "starts") core = `^${bounded}`;
    if (matchType === "ends") core = `${bounded}$`;
    if (matchType === "exact") core = `^${bounded}$`;
  }

  return caseInsensitive ? `(?i)${core}` : core;
}

function collectHeadingTerms(headingText) {
  const combined = []
    .concat(headingText?.h1 || [])
    .concat(headingText?.h2 || [])
    .concat(headingText?.h3 || [])
    .join(" ");
  const terms = tokenize(combined);
  return Array.from(new Set(terms));
}

function mergeTermCounts(lists) {
  const counts = new Map();
  lists.flat().forEach((item) => {
    const term = item.term || item.entity || item;
    if (!term) return;
    counts.set(term, (counts.get(term) || 0) + (item.count || 1));
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([term, count]) => ({ term, count }));
}

function buildDiff(previous, current) {
  const diff = [];
  const add = (label, before, after) => {
    if (before === after) return;
    diff.push({ label, before, after });
  };

  add("Title length", previous.title?.length || 0, current.title?.length || 0);
  add("Meta description length", previous.metaDescription?.length || 0, current.metaDescription?.length || 0);
  add("Word count", previous.wordCount || 0, current.wordCount || 0);
  add("H1 count", previous.headings?.h1 || 0, current.headings?.h1 || 0);
  add("Indexable", previous.metaRobots?.includes("noindex") ? "No" : "Yes", current.metaRobots?.includes("noindex") ? "No" : "Yes");
  add("Canonical", previous.canonical || "-", current.canonical || "-");
  return diff;
}

function renderDiffList(diff) {
  if (!diff || !diff.length) return `<div class="empty">No changes detected.</div>`;
  const items = diff.map((entry) => `<li>${escapeHtml(entry.label || "")}: ${escapeHtml(entry.before || "-")} → ${escapeHtml(entry.after || "-")}</li>`).join("");
  return `<ul class="issue-list">${items}</ul>`;
}

function summarizeCrawl(pages) {
  const summary = {
    missingDescriptions: 0,
    missingH1: 0,
    multipleH1: 0,
    thinPages: 0,
    errorPages: 0,
    missingCanonical: 0,
    offOriginCanonical: 0,
    nonSelfCanonical: 0,
    noindexPages: 0,
    hreflangMissingBack: 0,
    redirects: 0,
    okPages: 0,
    indexable: 0,
    avgDepth: 0,
    maxDepth: 0
  };
  let depthTotal = 0;
  for (const page of pages) {
    const status = typeof page.status === "number" ? page.status : null;
    if (status !== null && status >= 200 && status < 300) summary.okPages += 1;
    if (status !== null && status >= 300 && status < 400) summary.redirects += 1;
    if (status === null || status >= 400 || page.status === "ERR") summary.errorPages += 1;
    if (page.descriptionLength === 0) summary.missingDescriptions += 1;
    if (page.h1Count === 0) summary.missingH1 += 1;
    if (page.h1Count > 1) summary.multipleH1 += 1;
    if (page.wordCount > 0 && page.wordCount < 300) summary.thinPages += 1;
    if (page.noindex) summary.noindexPages += 1;
    if (!page.canonical) summary.missingCanonical += 1;
    if (page.canonical) {
      try {
        const canonical = new URL(page.canonical);
        const pageUrl = new URL(page.url);
        if (canonical.origin !== pageUrl.origin) summary.offOriginCanonical += 1;
        if (normalizeUrl(canonical.toString()) !== normalizeUrl(pageUrl.toString())) summary.nonSelfCanonical += 1;
      } catch (err) {
        summary.offOriginCanonical += 1;
      }
    }
    const depth = typeof page.depth === "number" ? page.depth : pageDepth(page.url);
    depthTotal += depth;
    if (depth > summary.maxDepth) summary.maxDepth = depth;
    if (indexabilityReasons(page) === "Indexable") summary.indexable += 1;
  }
  summary.avgDepth = pages.length ? Math.round((depthTotal / pages.length) * 10) / 10 : 0;
  return summary;
}

function analyzeHreflangReciprocity(pages) {
  const byUrl = new Map(pages.map((page) => [normalizeUrl(page.url), page]));
  const issues = [];

  pages.forEach((page) => {
    const sourceUrl = normalizeUrl(page.url);
    (page.hreflang || []).forEach((entry) => {
      const targetUrl = normalizeUrl(entry.href);
      if (!byUrl.has(targetUrl)) return;
      const targetPage = byUrl.get(targetUrl);
      const backLinks = targetPage.hreflang || [];
      const hasBack = backLinks.some((link) => normalizeUrl(link.href) === sourceUrl);
      if (!hasBack) {
        issues.push({
          source: sourceUrl,
          target: targetUrl,
          lang: entry.lang || ""
        });
      }
    });
  });

  return issues;
}

function indexabilityReasons(page) {
  const reasons = [];
  if (!page.status || page.status >= 400) reasons.push("Status error");
  if (page.status >= 300 && page.status < 400) reasons.push("Redirect");
  if (page.noindex) reasons.push("Noindex");
  if (!page.canonical) reasons.push("Missing canonical");
  if (page.canonical && normalizeUrl(page.canonical) !== normalizeUrl(page.url)) reasons.push("Canonical to other");
  if (!page.inSitemap) reasons.push("Not in sitemap");
  return reasons.length ? reasons.join(", ") : "Indexable";
}

function pageDepth(url, origin) {
  try {
    const urlObj = new URL(url, origin);
    return urlObj.pathname.split("/").filter(Boolean).length;
  } catch (err) {
    return 0;
  }
}

function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    urlObj.hash = "";
    let normalized = urlObj.toString();
    if (normalized.endsWith("/") && urlObj.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (err) {
    return url || "";
  }
}

function formatSources(sourceTally) {
  return Object.entries(sourceTally)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}: ${count}`)
    .join(" | ");
}

function buildIndexabilityBreakdown(pages) {
  const map = new Map();
  pages.forEach((page) => {
    const reasons = [];
    if (!page.status || page.status === "ERR" || page.status >= 400) reasons.push("Status error");
    if (page.status >= 300 && page.status < 400) reasons.push("Redirect");
    if (page.noindex) reasons.push("Noindex");
    if (!page.canonical) reasons.push("Missing canonical");
    if (page.canonical && normalizeUrl(page.canonical) !== normalizeUrl(page.url)) reasons.push("Canonical to other");
    if (!page.inSitemap) reasons.push("Not in sitemap");
    if (!reasons.length) reasons.push("Indexable");
    reasons.forEach((reason) => map.set(reason, (map.get(reason) || 0) + 1));
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));
}

function prioritizeLinks(links, origin, budget, visited, queued, currentDepth = 0, maxDepth = Infinity) {
  if (currentDepth + 1 > maxDepth) return [];
  const unique = Array.from(new Set((links || []).filter((link) => link && link.startsWith(origin)).map((link) => normalizeUrl(link))));
  unique.sort((a, b) => pageDepth(a, origin) - pageDepth(b, origin));
  const result = [];
  for (const link of unique) {
    if (result.length >= budget) break;
    if (visited.has(link) || queued.has(link)) continue;
    result.push(link);
  }
  return result;
}

function detectCannibalization(pages) {
  const items = pages.map((page) => {
    const title = (page.title || "").toLowerCase().replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
    const h1 = (page.headingText?.h1 || []).join(" ").toLowerCase().replace(/[^a-z0-9\\s]/g, " ").replace(/\\s+/g, " ").trim();
    const intent = classifyIntent({ title: page.title, url: page.url, schemaTypes: page.schemaTypes || [] });
    const signature = `${title}|${h1}`;
    return { url: page.url, intent, signature, title, h1 };
  });

  const groups = new Map();
  items.forEach((item) => {
    const key = `${item.intent}::${item.signature}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.url);
  });

  return Array.from(groups.entries())
    .filter((entry) => entry[1].length > 1)
    .slice(0, 8)
    .map(([key, urls]) => ({ intent: key.split("::")[0], urls }));
}

function storeCrawlSnapshot(origin, clusters) {
  return new Promise((resolve) => {
    const key = `atlas:crawlHistory:${origin}`;
    chrome.storage.local.get([key], (result) => {
      const history = result[key] || [];
      const snapshot = {
        at: new Date().toISOString(),
        clusters: clusters.map((cluster) => ({
          signature: cluster.signature,
          count: cluster.count,
          missingDescription: cluster.missingDescription,
          missingH1: cluster.missingH1,
          thin: cluster.thin
        }))
      };
      const next = [snapshot, ...history].slice(0, 5);
      chrome.storage.local.set({ [key]: next }, () => resolve(next));
    });
  });
}

function loadCrawlHistory(origin) {
  return new Promise((resolve) => {
    const key = `atlas:crawlHistory:${origin}`;
    chrome.storage.local.get([key], (result) => resolve(result[key] || []));
  });
}

function diffClusterHistory(history) {
  if (history.length < 2) return [];
  const latest = history[0];
  const prev = history[1];
  const prevMap = new Map(prev.clusters.map((item) => [item.signature, item]));
  return latest.clusters.map((cluster) => {
    const before = prevMap.get(cluster.signature);
    return {
      signature: cluster.signature,
      countDelta: before ? cluster.count - before.count : cluster.count,
      missingDescriptionDelta: before ? cluster.missingDescription - before.missingDescription : cluster.missingDescription,
      missingH1Delta: before ? cluster.missingH1 - before.missingH1 : cluster.missingH1,
      thinDelta: before ? cluster.thin - before.thin : cluster.thin
    };
  }).slice(0, 6);
}

function groupDuplicates(pages, field) {
  const map = new Map();
  for (const page of pages) {
    const value = (page[field] || "").trim().toLowerCase();
    if (!value) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(page.url);
  }
  return Array.from(map.entries())
    .filter((entry) => entry[1].length > 1)
    .slice(0, 10)
    .map(([value, urls]) => ({ value, urls }));
}

function computeInboundLinks(pages) {
  const inbound = new Map();
  pages.forEach((page) => inbound.set(normalizeUrl(page.url), 0));
  for (const page of pages) {
    for (const link of page.internalLinks || []) {
      const normalized = normalizeUrl(link);
      if (inbound.has(normalized)) {
        inbound.set(normalized, inbound.get(normalized) + 1);
      }
    }
  }
  return Array.from(inbound.entries())
    .map(([url, count]) => ({ url, count }))
    .sort((a, b) => a.count - b.count);
}

function buildDepthDistribution(pages, maxDepth = 5) {
  const buckets = Array.from({ length: maxDepth + 1 }, (_, idx) => ({ depth: idx, count: 0 }));
  pages.forEach((page) => {
    const depth = typeof page.depth === "number" ? page.depth : pageDepth(page.url);
    if (depth <= maxDepth) buckets[depth].count += 1;
  });
  return buckets;
}

function buildIntentMix(pages) {
  const map = new Map();
  pages.forEach((page) => {
    const intent = classifyIntent({ title: page.title || "", url: page.url || "", schemaTypes: page.schemaTypes || [] });
    map.set(intent, (map.get(intent) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);
}

function buildPathMap(pages) {
  const map = new Map();
  pages.forEach((page) => {
    let segment = "/";
    try {
      const url = new URL(page.url);
      const parts = url.pathname.split("/").filter(Boolean);
      segment = parts.length ? `/${parts[0]}/` : "/";
    } catch (err) {
      segment = "/";
    }
    if (!map.has(segment)) {
      map.set(segment, { segment, count: 0, missingDescription: 0, missingH1: 0, thin: 0 });
    }
    const entry = map.get(segment);
    entry.count += 1;
    if (page.descriptionLength === 0) entry.missingDescription += 1;
    if (page.h1Count === 0) entry.missingH1 += 1;
    if (page.wordCount > 0 && page.wordCount < 300) entry.thin += 1;
  });
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function buildContentStats(pages) {
  const stats = {
    missingTitle: 0,
    missingDescription: 0,
    missingH1: 0,
    thin: 0,
    avgWords: 0
  };
  let totalWords = 0;
  pages.forEach((page) => {
    if (!page.title) stats.missingTitle += 1;
    if (page.descriptionLength === 0) stats.missingDescription += 1;
    if (page.h1Count === 0) stats.missingH1 += 1;
    if (page.wordCount > 0 && page.wordCount < 300) stats.thin += 1;
    totalWords += page.wordCount || 0;
  });
  stats.avgWords = pages.length ? Math.round(totalWords / pages.length) : 0;
  return stats;
}

function buildSitemapStats(pages, inboundMap) {
  const inSitemap = pages.filter((page) => page.inSitemap);
  const notInSitemap = pages.filter((page) => !page.inSitemap);
  const orphanCandidates = inSitemap
    .filter((page) => (inboundMap.get(normalizeUrl(page.url)) || 0) === 0)
    .slice(0, 10);
  return {
    inSitemapCount: inSitemap.length,
    notInSitemapCount: notInSitemap.length,
    orphanCandidates,
    notInSitemapSamples: notInSitemap.slice(0, 10)
  };
}

function buildBlockerStats(pages) {
  const stats = {
    redirects: 0,
    errors: 0,
    noindex: 0,
    canonicalMissing: 0,
    canonicalOther: 0,
    samples: []
  };
  pages.forEach((page) => {
    if (page.status >= 300 && page.status < 400) stats.redirects += 1;
    if (page.status === "ERR" || page.status >= 400) stats.errors += 1;
    if (page.noindex) stats.noindex += 1;
    if (!page.canonical) stats.canonicalMissing += 1;
    if (page.canonical && normalizeUrl(page.canonical) !== normalizeUrl(page.url)) stats.canonicalOther += 1;
    if (stats.samples.length < 12 && (page.noindex || page.status >= 300 || !page.canonical)) {
      stats.samples.push(page);
    }
  });
  return stats;
}

function pageSignature(page) {
  let depth = 0;
  try {
    const url = new URL(page.url);
    depth = url.pathname.split("/").filter(Boolean).length;
  } catch (err) {
    depth = 0;
  }
  const titlePattern = (page.title || "")
    .replace(/\d+/g, "{#}")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const descBucket = page.descriptionLength === 0 ? "desc0" : page.descriptionLength < 70 ? "descShort" : page.descriptionLength > 160 ? "descLong" : "descOk";
  const wordBucket = page.wordCount < 300 ? "thin" : page.wordCount < 800 ? "mid" : "long";
  return `${depth}|${titlePattern}|h1${page.h1Count}|${descBucket}|${wordBucket}`;
}

function clusterTemplates(pages) {
  const clusters = new Map();
  for (const page of pages) {
    const signature = pageSignature(page);
    if (!clusters.has(signature)) {
      clusters.set(signature, {
        signature,
        count: 0,
        sampleUrl: page.url,
        missingDescription: 0,
        missingH1: 0,
        multipleH1: 0,
        thin: 0
      });
    }
    const cluster = clusters.get(signature);
    cluster.count += 1;
    if (page.descriptionLength === 0) cluster.missingDescription += 1;
    if (page.h1Count === 0) cluster.missingH1 += 1;
    if (page.h1Count > 1) cluster.multipleH1 += 1;
    if (page.wordCount > 0 && page.wordCount < 300) cluster.thin += 1;
  }
  return Array.from(clusters.values())
    .map((cluster) => ({
      ...cluster,
      missingDescriptionRate: cluster.count ? cluster.missingDescription / cluster.count : 0,
      missingH1Rate: cluster.count ? cluster.missingH1 / cluster.count : 0,
      thinRate: cluster.count ? cluster.thin / cluster.count : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function buildClusterAlerts(clusters) {
  const alerts = [];
  clusters.forEach((cluster) => {
    if (cluster.missingDescriptionRate > 0.6) {
      alerts.push(`Template issue: ${cluster.count} pages missing meta descriptions.`);
    }
    if (cluster.missingH1Rate > 0.6) {
      alerts.push(`Template issue: ${cluster.count} pages missing H1 tags.`);
    }
    if (cluster.thinRate > 0.6) {
      alerts.push(`Template issue: ${cluster.count} pages appear thin (< 300 words).`);
    }
  });
  return alerts.slice(0, 5);
}

function loadPreviousAudit(url) {
  return new Promise((resolve) => {
    const key = `atlas:lastAudit:${url}`;
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

function storeAudit(url, analysis) {
  return new Promise((resolve) => {
    const key = `atlas:lastAudit:${url}`;
    chrome.storage.local.set({ [key]: analysis }, () => resolve());
  });
}

function buildFixPlan(analysis, crawl) {
  const tasks = [];
  const title = analysis.title || "";
  const titleLen = title.length;
  const metaDesc = analysis.metaDescription || "";
  const metaLen = metaDesc.length;
  const perf = analysis.performance || {};
  const headings = analysis.headings || {};
  const images = analysis.images || {};
  const og = analysis.og || {};
  const twitter = analysis.twitter || {};
  const metaRobots = analysis.metaRobots || "";

  const addTask = (taskTitle, impact, effort, why) => {
    const score = impact * 10 - effort * 2;
    tasks.push({ title: taskTitle, impact, effort, score, why });
  };

  if (!title) addTask("Add a unique title tag", 9, 2, "Missing title hurts relevance and CTR.");
  if (titleLen > 0 && titleLen < SEO_LIMITS.TITLE_MIN) addTask("Expand short title", 6, 2, "Short titles reduce topical clarity.");
  if (titleLen > SEO_LIMITS.TITLE_MAX) addTask("Shorten long title", 5, 2, "Long titles truncate in SERPs.");

  if (!metaDesc) addTask("Write a meta description", 7, 2, "Missing description reduces SERP control.");
  if (metaLen > 0 && metaLen < SEO_LIMITS.META_DESC_MIN) addTask("Expand short meta description", 5, 2, "Short descriptions reduce messaging.");
  if (metaLen > SEO_LIMITS.META_DESC_MAX) addTask("Trim long meta description", 4, 2, "Long descriptions truncate in SERPs.");

  if ((headings.h1 ?? 0) === 0) addTask("Add an H1", 8, 2, "Missing H1 weakens page structure.");
  if ((headings.h1 ?? 0) > 1) addTask("Reduce to one H1", 6, 3, "Multiple H1s blur topic focus.");

  if (!analysis.canonical) addTask("Add canonical tag", 7, 3, "Canonical prevents duplicate signals.");
  if (metaRobots.toLowerCase().includes("noindex")) addTask("Remove noindex if unintended", 10, 2, "Noindex blocks ranking.");

  if (!analysis.viewport) addTask("Add viewport meta tag", 6, 2, "Improves mobile usability signals.");

  if (!og.title || !og.description) addTask("Improve Open Graph tags", 4, 3, "Boosts social sharing quality.");
  if (!twitter.card) addTask("Add Twitter card meta", 3, 3, "Improves social previews.");

  if ((images.missingAlt ?? 0) > 0) {
    addTask("Add missing image alt text", 6, 4, "Improves accessibility and image SEO.");
  }
  if ((images.shortAlt ?? 0) > 0) {
    addTask("Expand short alt text", 4, 3, "Short alt text reduces relevance signals.");
  }
  if ((images.missingSize ?? 0) > 0) {
    addTask("Add width/height to images", 5, 4, "Reduces layout shifts and CLS.");
  }
  if ((images.largeImages ?? 0) > 0) {
    addTask("Optimize oversized images", 6, 5, "Large images slow LCP and load time.");
  }
  if ((images.genericFilename ?? 0) > 0) {
    addTask("Rename generic image filenames", 3, 4, "Descriptive filenames help image SEO.");
  }

  if ((analysis.wordCount ?? 0) > 0 && analysis.wordCount < SEO_LIMITS.WORD_COUNT_MIN) {
    addTask("Expand thin content", 7, 5, "Low word count often underperforms.");
  }

  if (perf.lcp && perf.lcp > SEO_LIMITS.LCP_DANGER) addTask("Reduce LCP", 8, 6, "Slow LCP hurts rankings and UX.");
  if (perf.cls && perf.cls > SEO_LIMITS.CLS_DANGER) addTask("Reduce layout shifts", 6, 5, "High CLS degrades UX metrics.");
  if (perf.inp && perf.inp > SEO_LIMITS.INP_DANGER) addTask("Reduce INP", 7, 6, "Slow interactions hurt Core Web Vitals.");
  if (perf.fid && perf.fid > SEO_LIMITS.FID_DANGER) addTask("Reduce FID", 6, 5, "High FID delays user interaction.");
  if (perf.ttfb && perf.ttfb > SEO_LIMITS.TTFB_DANGER) addTask("Reduce server response time", 7, 6, "High TTFB slows rendering.");

  if (analysis.structuredData?.issues?.length) {
    addTask("Fix structured data fields", 7, 5, "Schema lint issues can block rich results.");
  }

  if (crawl && crawl.summary) {
    const summary = crawl.summary;
    if (summary.missingDescriptions > 0) {
      addTask("Fix missing meta descriptions sitewide", 8, 6, `${summary.missingDescriptions} pages missing descriptions.`);
    }
    if (summary.missingH1 > 0) {
      addTask("Fix missing H1s sitewide", 8, 6, `${summary.missingH1} pages missing H1s.`);
    }
    if (summary.multipleH1 > 0) {
      addTask("Normalize H1 count across templates", 6, 6, `${summary.multipleH1} pages with multiple H1s.`);
    }
    if (summary.thinPages > 0) {
      addTask("Expand thin pages sitewide", 7, 7, `${summary.thinPages} pages under 300 words.`);
    }
    if (summary.errorPages > 0) {
      addTask("Fix broken pages (4xx/5xx)", 9, 6, `${summary.errorPages} error pages found.`);
    }
    if (summary.missingCanonical > 0) {
      addTask("Add canonical tags sitewide", 7, 6, `${summary.missingCanonical} pages missing canonicals.`);
    }
    if (summary.offOriginCanonical > 0 || summary.nonSelfCanonical > 0) {
      addTask("Review canonical inconsistencies", 7, 6, `${summary.offOriginCanonical + summary.nonSelfCanonical} pages with canonical mismatches.`);
    }
  }

  return tasks.sort((a, b) => b.score - a.score).slice(0, 12);
}

function renderFixPlan(analysis, crawl) {
  const tasks = buildFixPlan(analysis, crawl);
  panelMap.plan.innerHTML = `
    <div class="card">
      <h3>Priority Fix Plan</h3>
      ${tasks.length ? `<table class="table">
        <tr><th>Task</th><th>Impact</th><th>Effort</th></tr>
        ${tasks.map((task) => `<tr><td>${task.title}<div class="footer-note">${task.why}</div></td><td>${task.impact}/10</td><td>${task.effort}/10</td></tr>`).join("")}
      </table>` : `<div class="empty">No obvious fixes detected.</div>`}
    </div>
  `;
}

function renderOverview(analysis) {
  const perf = analysis.performance || {};
  const issues = buildIssues(analysis);
  const previous = state.previous;
  const diff = previous ? buildDiff(previous, analysis) : null;
  const regexHelpers = buildRegexHelpers(analysis);
  const title = analysis.title || "";
  const metaDesc = analysis.metaDescription || "";
  const metaRobots = analysis.metaRobots || "";
  panelMap.overview.innerHTML = `
    <div class="card">
      <h3>Page Summary</h3>
      <div class="metric-grid">
        <div class="metric"><span>URL</span>${analysis.url || "-"}</div>
        ${ui.metric("Indexable", metaRobots.toLowerCase().includes("noindex") ? "No" : "Likely", "Indexable")}
        ${ui.metric("Title Length", title.length, "Title Length")}
        ${ui.metric("Description Length", metaDesc.length, "Description Length")}
        ${ui.metric("Word Count", analysis.wordCount ?? 0, "Word Count")}
        ${ui.metric("Text/HTML Ratio", analysis.textRatio ?? "-", "Text/HTML Ratio")}
      </div>
      <div class="footer-note">Recommended: title 50–60 chars, description 120–160, word count 300+, text/HTML ratio > 0.1.</div>
    </div>
    <div class="card">
      <h3>Performance (current page)</h3>
      <div class="metric-grid">
        ${ui.metric("TTFB", formatMs(perf.ttfb), "TTFB", pickSeverity(perf.ttfb, 800, 1200))}
        ${ui.metric("TTFB (net)", formatMs(perf.ttfbMs), "TTFB", pickSeverity(perf.ttfbMs, 800, 1200))}
        ${ui.metric("FCP", formatMs(perf.fcp), "FCP", pickSeverity(perf.fcp, 1800, 3000))}
        ${ui.metric("LCP", formatMs(perf.lcp), "LCP", pickSeverity(perf.lcp, 2500, 4000))}
        ${ui.metric("CLS", perf.cls ?? "-", "CLS", pickSeverity(perf.cls, 0.1, 0.25))}
        ${ui.metric("INP", formatMs(perf.inp), "INP", pickSeverity(perf.inp, 200, 500))}
        ${ui.metric("FID", formatMs(perf.fid), "FID", pickSeverity(perf.fid, 100, 300))}
        ${ui.metric("DOMContentLoaded", formatMs(perf.domContentLoaded))}
        ${ui.metric("Load", formatMs(perf.load))}
      </div>
      <p class="footer-note">Performance metrics are sampled from the current page load.</p>
      <div class="footer-note">Good ranges: TTFB < 800ms, FCP < 1.8s, LCP < 2.5s, CLS < 0.1, INP < 200ms, FID < 100ms.</div>
    </div>
    <div class="card">
      <h3>Priority Issues</h3>
      ${issues.length ? `<ul class="issue-list">${issues.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<div class="empty">No obvious issues detected.</div>`}
    </div>
    <div class="card">
      <h3>Changes Since Last Audit</h3>
      ${diff ? renderDiffList(diff) : `<div class="empty">No previous audit stored for this URL.</div>`}
    </div>
    <div class="card">
      <h3>Recent Audits</h3>
      ${state.recentAudits.length ? `<ul class="issue-list">${state.recentAudits.map((item) => `<li>${item.url}</li>`).join("")}</ul>` : `<div class="empty">No recent audits yet.</div>`}
    </div>
  `;

}

function renderOnPage(analysis) {
  const snippet = buildSnippetPreview(analysis);
  const headings = analysis.headingText || { h1: [], h2: [], h3: [] };
  const ordered = headings.order || [];
  const jsRender = analysis.jsRender;
  const jsAddedHeadings = jsRender?.added?.headings || [];
  const jsAddedLinks = jsRender?.added?.links || [];
  const jsAddedSchema = jsRender?.added?.schemaTypes || [];
  const jsRemovedHeadings = jsRender?.removed?.headings || [];
  const jsRemovedLinks = jsRender?.removed?.links || [];
  const jsRemovedSchema = jsRender?.removed?.schemaTypes || [];
  const baseline = jsRender?.baseline;
  const rendered = jsRender?.rendered;
  const tagChanges = jsRender?.tagChanges || [];
  const jsHeadingPct = rendered?.headingCount ? Math.round((jsAddedHeadings.length / rendered.headingCount) * 100) : 0;
  const jsLinkPct = rendered?.linkCount ? Math.round((jsAddedLinks.length / rendered.linkCount) * 100) : 0;
  const jsSchemaPct = rendered?.schemaCount ? Math.round((jsAddedSchema.length / rendered.schemaCount) * 100) : 0;
  const dependencyScore = jsRender
    ? Math.round((jsRender.jsTextShare + jsHeadingPct + jsLinkPct + jsSchemaPct) / 4)
    : 0;
  panelMap.onpage.innerHTML = `
    <div class="card">
      <h3>Snippet Preview</h3>
      <div class="footer-note">${analysis.url}</div>
      <div class="metric-grid">
        <div class="metric"><span>Title</span>${snippet.title || "-"}</div>
        <div class="metric"><span>Description</span>${snippet.description || "-"}</div>
      </div>
    </div>
    <div class="card">
      <h3>Core Tags</h3>
      <table class="table">
        <tr><th>Title</th><td>${analysis.title || "-"}</td></tr>
        <tr><th>Description</th><td>${analysis.metaDescription || "-"}</td></tr>
        <tr><th>Canonical</th><td>${analysis.canonical || "-"}</td></tr>
        <tr><th>Meta Robots</th><td>${analysis.metaRobots || "-"}</td></tr>
        <tr><th>Viewport</th><td>${analysis.viewport || "-"}</td></tr>
        <tr><th>Language</th><td>${analysis.language || "-"}</td></tr>
      </table>
      <div class="footer-note">Best practice: 1 self-referencing canonical, noindex only when intentional.</div>
    </div>
  `;
}

function renderContent(analysis) {
  if (!panelMap.content) return;
  const headingCounts = analysis.headings || {};
  const headings = analysis.headingText || { h1: [], h2: [], h3: [] };
  const ordered = headings.order || [];
  const readability = analysis.contentQuality?.readability || {};

  panelMap.content.innerHTML = `
    <div class="card">
      <h3>Heading Structure</h3>
      <div class="metric-grid">
        <div class="metric"><span>H1</span>${headingCounts.h1 ?? 0}</div>
        <div class="metric"><span>H2</span>${headingCounts.h2 ?? 0}</div>
        <div class="metric"><span>H3</span>${headingCounts.h3 ?? 0}</div>
        <div class="metric"><span>H4</span>${headingCounts.h4 ?? 0}</div>
        <div class="metric"><span>H5</span>${headingCounts.h5 ?? 0}</div>
        <div class="metric"><span>H6</span>${headingCounts.h6 ?? 0}</div>
      </div>
      <div class="footer-note">Recommended: exactly one H1, logical H2/H3 hierarchy.</div>
      ${ordered.length ? `<ul class="issue-list line-list">
        ${ordered.map((item) => `<li class="highlight-item jump-item" data-highlight-xpath="${escapeHtml(item.xpath || "")}" data-highlight-selector="${escapeHtml(item.selector || "")}" data-highlight-tag="${item.tag}" data-highlight-text="${escapeHtml(item.text)}">${item.tag.toUpperCase()} — ${escapeHtml(item.text)}</li>`).join("")}
      </ul>` : `<div class="empty">No H1/H2/H3 found.</div>`}
    </div>

    <div class="card">
      <h3>Readability & Quality</h3>
      <div class="metric-grid">
        ${ui.metric("Words", analysis.wordCount || 0, "Word Count")}
        ${ui.metric("Reading Ease", readability.fleschReadingEase ?? "-", "Reading Ease")}
        ${ui.metric("Grade Level", readability.fleschKincaidGrade ?? "-", "Grade Level")}
        ${ui.metric("Sentences", (analysis.html?.text || "").split(/\.\s+/).length || "-", "Sentences")}
      </div>
    </div>

    <div class="card">
      <h3>Top Entities (Keywords)</h3>
      <div class="tag-row">
        ${(analysis.entities || []).map(e => `<span class="tag">${escapeHtml(e.entity)} (${e.count})</span>`).join('') || "<div class='empty'>No key entities found.</div>"}
      </div>
    </div>

    <div class="card">
      <h3>Density Check</h3>
      <label>Target Keywords (comma or new line)</label>
      <textarea id="keywordDensityInput" class="textarea" rows="3" placeholder="keyword 1&#10;keyword 2"></textarea>
      <div class="buttons">
        <button id="keywordDensityRun" class="btn primary">Analyze</button>
      </div>
      <div id="keywordDensityResults" class="table-scroll"></div>
    </div>
  `;
  attachKeywordDensityHandler();
}

function renderJsSeo(analysis) {
  if (!panelMap.jsseo) return;
  const jsRender = analysis.jsRender;
  const jsAddedHeadings = jsRender?.added?.headings || [];
  const jsAddedLinks = jsRender?.added?.links || [];
  const jsAddedSchema = jsRender?.added?.schemaTypes || [];
  const jsRemovedHeadings = jsRender?.removed?.headings || [];
  const jsRemovedLinks = jsRender?.removed?.links || [];
  const jsRemovedSchema = jsRender?.removed?.schemaTypes || [];
  const baseline = jsRender?.baseline;
  const rendered = jsRender?.rendered;
  const tagChanges = jsRender?.tagChanges || [];
  const jsHeadingPct = rendered?.headingCount ? Math.round((jsAddedHeadings.length / rendered.headingCount) * 100) : 0;
  const jsLinkPct = rendered?.linkCount ? Math.round((jsAddedLinks.length / rendered.linkCount) * 100) : 0;
  const jsSchemaPct = rendered?.schemaCount ? Math.round((jsAddedSchema.length / rendered.schemaCount) * 100) : 0;
  const dependencyScore = jsRender
    ? Math.round((jsRender.jsTextShare + jsHeadingPct + jsLinkPct + jsSchemaPct) / 4)
    : 0;

  panelMap.jsseo.innerHTML = `
    <div class="card">
      <h3>JS Dependency Score</h3>
      ${jsRender ? `
        <div class="metric-grid">
          ${ui.metric("Dependency", dependencyScore + "%", "Dependency Score")}
          ${ui.metric("JS Content", jsRender.jsTextShare + "%", "JS Content %")}
          ${ui.metric("Text Added", jsRender.textAdded, "Text Added")}
          ${ui.metric("Links Added", jsAddedLinks.length, "Links Added")}
          ${ui.metric("Headings Added", jsAddedHeadings.length, "Headings Added")}
        </div>
        <div class="footer-note">Dependency Score > 25% suggests heavy reliance on Client-Side Rendering (CSR).</div>
        ${baseline && rendered ? `<table class="table">
          <tr><th>Metric</th><th>HTML (Raw)</th><th>Rendered</th><th>Δ</th></tr>
          <tr><td>Headings</td><td>${baseline.headingCount}</td><td>${rendered.headingCount}</td><td>${rendered.headingCount - baseline.headingCount}</td></tr>
          <tr><td>Links</td><td>${baseline.linkCount}</td><td>${rendered.linkCount}</td><td>${rendered.linkCount - baseline.linkCount}</td></tr>
          <tr><td>Text</td><td>${baseline.textLength}</td><td>${rendered.textLength}</td><td>${rendered.textLength - baseline.textLength}</td></tr>
        </table>` : ""}
      ` : `<div class="empty">JS Render analysis requires page reload or is pending.</div>`}
    </div>

    <div class="card">
      <h3>JS-Only Content</h3>
      ${jsAddedHeadings.length ? `<div class="footer-note">JS-Only Headings</div><ul class="issue-list">${jsAddedHeadings.slice(0, 5).map(h => `<li>${h.tag} - ${h.text}</li>`).join('')}</ul>` : ""}
      ${jsAddedLinks.length ? `<div class="footer-note">JS-Only Links</div><div class="empty">${jsAddedLinks.length} internal links depend on JS.</div>` : ""}
    </div>

    <div class="card">
      <h3>JS-only Schema Types</h3>
      ${jsAddedSchema.length ? jsAddedSchema.map((type) => `<span class="tag">${escapeHtml(type)}</span>`).join("") : `<div class="empty">No JS-only schema types detected.</div>`}
    </div>
    <div class="card">
      <h3>Removed After JS</h3>
      ${(jsRemovedHeadings.length || jsRemovedLinks.length || jsRemovedSchema.length) ? `
        <div class="metric-grid">
          <div class="metric"><span>Headings Removed</span>${jsRemovedHeadings.length}</div>
          <div class="metric"><span>Links Removed</span>${jsRemovedLinks.length}</div>
          <div class="metric"><span>Schema Removed</span>${jsRemovedSchema.length}</div>
        </div>
        ${jsRemovedHeadings.length ? `<div class="footer-note">Removed headings (top 6)</div><ul class="issue-list">
          ${jsRemovedHeadings.slice(0, 6).map((item) => `<li>${item.tag.toUpperCase()} — ${escapeHtml(item.text)}</li>`).join("")}
        </ul>` : ""}
      ` : `<div class="empty">No headings/links/schema removed after JS.</div>`}
    </div>
    <div class="card">
      <h3>JS-rendered Blocks</h3>
      ${analysis.dynamic?.count ? `<div class="footer-note">${analysis.dynamic.count} captured after initial HTML</div>
        <ul class="issue-list">
          ${analysis.dynamic.items.map((item) => `<li class="highlight-item jump-item" data-highlight-xpath="${escapeHtml(item.xpath || "")}" data-highlight-selector="${escapeHtml(item.selector || "")}" data-highlight-tag="${escapeHtml(item.tag)}" data-highlight-text="${escapeHtml(item.text || "")}">
            ${escapeHtml(item.tag.toUpperCase())} — ${escapeHtml(item.text || "(no text)")}${item.addedAt ? ` <span class="footer-note">+${item.addedAt}ms</span>` : ""}
          </li>`).join("")}
        </ul>` : `<div class="empty">No JS-rendered blocks detected yet.</div>`}
    </div>
    <div class="card">
      <h3>Social Tags</h3>
      <table class="table">
        <tr><th>OG Title</th><td>${(analysis.og || {}).title || "-"}</td></tr>
        <tr><th>OG Description</th><td>${(analysis.og || {}).description || "-"}</td></tr>
        <tr><th>OG URL</th><td>${(analysis.og || {}).url || "-"}</td></tr>
        <tr><th>OG Image</th><td>${(analysis.og || {}).image || "-"}</td></tr>
        <tr><th>Twitter Card</th><td>${(analysis.twitter || {}).card || "-"}</td></tr>
      </table>
    </div>
  `;
}

function renderAiVisibility(analysis) {
  if (!panelMap.ai) return;
  const aiVisibility = analysis.aiVisibility || {};
  const aiAgents = aiVisibility.agents || [];
  const aiSections = aiVisibility.sections || [];
  const aiMeta = aiVisibility.meta || {};
  const aiFlags = aiMeta.flags || {};
  const aiRobots = aiVisibility.robots || {};
  const allAgentsBlocked = aiAgents.length ? aiAgents.every((agent) => !agent.allowed) : false;
  const blockedAgents = aiAgents.filter((agent) => !agent.allowed).map((agent) => agent.name);
  const siteBlocked = aiFlags.noai || allAgentsBlocked;
  const sectionVisibility = aiSections.map((row) => {
    if (siteBlocked) {
      return { ...row, visibility: "Invisible (Robots/Meta)", statusClass: "status-blocked" };
    }
    if (row.htmlSignal) {
      return { ...row, visibility: "Visible (HTML)", statusClass: "status-ok" };
    }
    if (row.jsSignal) {
      return { ...row, visibility: "Invisible (JS-only)", statusClass: "status-warn" };
    }
    return { ...row, visibility: "Invisible (Low content)", statusClass: "status-muted" };
  });
  const visibleSections = sectionVisibility.filter((row) => row.visibility.startsWith("Visible")).map((row) => row.section.toUpperCase());
  const invisibleSections = sectionVisibility.filter((row) => row.visibility.startsWith("Invisible")).map((row) => `${row.section.toUpperCase()} — ${row.visibility.replace("Invisible ", "")}`);

  state.aiHighlightPayload = sectionVisibility.length
    ? {
      sections: sectionVisibility.map((row) => ({
        section: row.section,
        visible: row.visibility.startsWith("Visible")
      })),
      siteBlocked,
      noImageAi: aiFlags.noimageai
    }
    : null;

  panelMap.ai.innerHTML = `
    <div class="card">
      <h3>AI Visibility (ChatGPT / Perplexity / Gemini)</h3>
      <div class="metric-grid">
        ${ui.metric("Robots.txt", aiRobots.status === "ok" ? "Fetched" : "Unavailable", "Robots.txt")}
        ${ui.metric("Meta Robots", aiMeta.robots || "-", "Meta Robots")}
        ${ui.metric("Noindex", aiFlags.noindex ? "Yes" : "No", "Meta Robots")}
        ${ui.metric("NoAI", aiFlags.noai ? "Yes" : "No", "NoAI")}
        ${ui.metric("NoImageAI", aiFlags.noimageai ? "Yes" : "No", "NoImageAI")}
        ${ui.metric("JS Text Share", (aiVisibility.jsTextShare ?? "-") + "%", "JS Text Share")}
      </div>
      ${visibleSections.length ? `<div class="footer-note">Visible to AI: ${visibleSections.join(", ")}</div>` : `<div class="footer-note">Visible to AI: none detected</div>`}
      ${invisibleSections.length ? `<div class="footer-note">Not visible to AI: ${invisibleSections.join(", ")}</div>` : ""}
      ${aiAgents.length ? `<div class="table-scroll"><table class="table">
        <tr><th>Agent</th><th>Status</th><th>Rule</th></tr>
        ${aiAgents.map((agent) => `<tr>
          <td>${escapeHtml(agent.name)}</td>
          <td><span class="status-pill ${agent.allowed ? "status-ok" : "status-blocked"}">${agent.allowed ? "Allowed" : "Blocked"}</span></td>
          <td>${escapeHtml(agent.rule || "-")}${agent.reasons?.length ? ` <span class="footer-note">(${agent.reasons.join(", ")})</span>` : ""}</td>
        </tr>`).join("")}
      </table></div>` : `<div class="empty">Robots.txt not available or not parsed.</div>`}
      ${sectionVisibility.length ? `<div class="footer-note">Section visibility for AI (HTML vs JS)</div>
        <div class="table-scroll"><table class="table">
          <tr><th>Section</th><th>Visibility</th><th>HTML Text</th><th>JS Text +</th><th>HTML H</th><th>JS H +</th><th>HTML L</th><th>JS L +</th></tr>
          ${sectionVisibility.map((row) => {
    return `<tr>
            <td>${row.section.toUpperCase()}</td>
            <td><span class="status-pill ${row.statusClass}">${row.visibility}</span></td>
            <td class="mono">${formatCount(row.htmlText)}</td>
            <td class="mono">${formatCount(row.jsTextAdded)}</td>
            <td class="mono">${row.htmlHeadings}</td>
            <td class="mono">${row.jsHeadingsAdded}</td>
            <td class="mono">${row.htmlLinks}</td>
            <td class="mono">${row.jsLinksAdded}</td>
          </tr>`;
  }).join("")}
        </table></div>` : `<div class="empty">Section visibility data not ready yet.</div>`}
      ${blockedAgents.length ? `<div class="footer-note">Blocked agents: ${blockedAgents.join(", ")}</div>` : ""}
      <div class="footer-note">Logic: robots.txt + meta noai/noimageai + HTML vs JS-rendered deltas. JS-only sections may not be accessible to non-rendering bots.</div>
    </div>
  `;
  const activeTab = document.querySelector(".tab.active");
  if (activeTab?.dataset.tab === "ai" && state.aiHighlightPayload?.sections?.length) {
    sendAiHighlight({ type: "aiHoverStart", ...state.aiHighlightPayload });
  }
}

function renderLinks(analysis) {
  const links = analysis.links || {};
  const grouped = {
    header: [],
    body: [],
    footer: [],
    other: []
  };
  (links.internalLinks || []).forEach((link) => {
    const section = link.section === "main" ? "body" : link.section;
    const key = grouped[section] ? section : "other";
    grouped[key].push(link);
  });

  const renderTable = (items, title) => {
    if (!items.length) return `<div class="empty">${title}: none</div>`;
    return `
      <div class="footer-note">${title}</div>
      <div class="table-scroll">
        <table class="table">
          <tr><th>Anchor</th><th>URL</th></tr>
          ${items.map((link) => `
            <tr class="highlight-item jump-item" data-highlight-xpath="${escapeHtml(link.xpath || "")}" data-highlight-selector="${escapeHtml(link.selector || "")}" data-highlight-href="${escapeHtml(link.href)}" data-highlight-text="${escapeHtml(link.text || "")}">
              <td>${escapeHtml(link.text || "-")}</td>
              <td>${escapeHtml(link.href)}</td>
            </tr>`).join("")}
        </table>
      </div>
    `;
  };

  panelMap.links.innerHTML = `
    <div class="card">
      <h3>Link Summary</h3>
      <div class="metric-grid">
        <div class="metric"><span>Total</span>${links.total ?? 0}</div>
        <div class="metric"><span>Internal</span>${links.internal ?? 0}</div>
        <div class="metric"><span>External</span>${links.external ?? 0}</div>
        <div class="metric"><span>Nofollow</span>${links.nofollow ?? 0}</div>
        <div class="metric"><span>UGC</span>${links.ugc ?? 0}</div>
        <div class="metric"><span>Sponsored</span>${links.sponsored ?? 0}</div>
      </div>
      <div class="footer-note">Recommended: internal links > external, nofollow/ugc/sponsored only when required.</div>
    </div>
    <div class="card">
      <h3>Internal Links (Hover to Highlight)</h3>
      ${(links.internalLinks || []).length ? `
        ${renderTable(grouped.header, "Header Links")}
        ${renderTable(grouped.body, "Body Links")}
        ${renderTable(grouped.footer, "Footer Links")}
        ${renderTable(grouped.other, "Other Links")}
      ` : `<div class="empty">No internal links captured.</div>`}
    </div>
  `;
}

function renderMedia(analysis) {
  const images = analysis.images || {};
  let samples = images.samples || [];
  if (state.mediaFilter) {
    samples = samples.filter(s => {
      const ext = (s.src || "").split(".").pop().split(/[?#]/)[0].toLowerCase();
      const fmt = ext === "jpeg" ? "jpg" : ext;
      return fmt === state.mediaFilter;
    });
  }
  const maxDim = images.maxDimensions || {};
  const formatCounts = images.formatCounts || {};

  // Format icon SVGs for visual recognition
  const formatIcons = {
    webp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7v10l4-5 4 5 4-7 4 7V7"/></svg>',
    png: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2" fill="currentColor"/><path d="M21 15l-5-5-8 8"/></svg>',
    jpg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21"/></svg>',
    jpeg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M21 15l-5-5L5 21"/></svg>',
    gif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    avif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/><circle cx="12" cy="12" r="3"/></svg>',
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>',
    bmp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  };

  // Format-specific color classes
  const formatColors = {
    webp: 'format-webp',
    png: 'format-png',
    jpg: 'format-jpg',
    jpeg: 'format-jpg',
    gif: 'format-gif',
    svg: 'format-svg',
    avif: 'format-avif',
    ico: 'format-ico',
    bmp: 'format-bmp',
  };

  const formatTags = Object.keys(formatCounts).length
    ? Object.entries(formatCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([fmt, count]) => {
        const fmtLower = fmt.toLowerCase();
        const icon = formatIcons[fmtLower] || '';
        const colorClass = formatColors[fmtLower] || '';
        const isActive = state.mediaFilter === fmtLower;
        return `<span class="tag format-tag ${colorClass} ${isActive ? "active" : ""}" data-format="${fmtLower}" style="cursor:pointer; opacity:${state.mediaFilter && !isActive ? 0.5 : 1}">${icon}<span class="format-label">${fmt.toUpperCase()}</span><span class="format-count">${count}</span></span>`;
      }).join("")
    : "";
  panelMap.media.innerHTML = `
    <div class="card">
      <h3>Images</h3>
      <div class="metric-grid">
        <div class="metric"><span>Total</span>${images.total ?? 0}</div>
        <div class="metric"><span>Missing Alt</span>${images.missingAlt ?? 0}</div>
        <div class="metric"><span>Short Alt</span>${images.shortAlt ?? 0}</div>
        <div class="metric"><span>Missing Size</span>${images.missingSize ?? 0}</div>
        <div class="metric"><span>Large Images</span>${images.largeImages ?? 0}</div>
        <div class="metric"><span>Generic Filenames</span>${images.genericFilename ?? 0}</div>
        <div class="metric"><span>Total Size</span>${formatKb(images.totalBytes)}</div>
        <div class="metric"><span>Largest File</span>${formatKb(images.maxBytes)}</div>
        <div class="metric"><span>Max Dimensions</span>${maxDim.width ? `${maxDim.width}x${maxDim.height}` : "-"}</div>
      </div>
      <p class="footer-note">Large images use a 2000px threshold. Missing size flags absent width/height attributes.</p>
      ${formatTags ? `<div class="footer-note">Formats</div><div class="tag-row">${formatTags}</div>` : ""}
      <div class="footer-note">Recommendations: prefer WebP/AVIF, largest file < 200 KB, missing alt/size should be 0.</div>
    </div>
    <div class="card">
      <h3>Image Samples</h3>
      ${samples.length ? `<div class="table-scroll"><table class="table media-table">
        <colgroup>
          <col class="col-section" />
          <col class="col-dims" />
          <col class="col-size" />
          <col class="col-alt" style="width:60px" />
          <col />
        </colgroup>
        <tr><th>Section</th><th>Dimensions</th><th>Size</th><th>Alt</th><th>Source</th></tr>
        ${samples.map((img) => {
    const ext = (img.src || "").split(".").pop().split(/[?#]/)[0].toLowerCase();
    const fmt = ext === "jpeg" ? "jpg" : ext;
    const colorClass = formatColors[fmt] || "";
    const hasAlt = img.alt && img.alt.trim().length > 0;
    return `<tr class="highlight-item jump-item" data-highlight-xpath="${escapeHtml(img.xpath || "")}" data-highlight-selector="${escapeHtml(img.selector || buildSrcSelector(img.src))}" data-highlight-src="${escapeHtml(img.src)}">
              <td><span class="pill">${escapeHtml((img.section || "body").toUpperCase())}</span></td>
              <td class="mono">${img.width}x${img.height}</td>
              <td class="mono">${formatKb(img.size)}</td>
              <td><span class="status-pill ${hasAlt ? "status-ok" : "status-error"}">${hasAlt ? "Yes" : "No"}</span></td>
              <td style="display:flex; align-items:center; gap:6px;"><span class="format-dot ${colorClass}" title="${fmt}"></span> ${escapeHtml(img.src)}</td>
            </tr>`;
  }).join("")}
      </table></div>` : `<div class="empty">No images found.</div>`}
    </div>
  `;
  // Attach filter handlers
  panelMap.media.querySelectorAll(".format-tag").forEach(tag => {
    tag.addEventListener("click", () => {
      const fmt = tag.dataset.format;
      state.mediaFilter = state.mediaFilter === fmt ? null : fmt;
      renderMedia(analysis);
    });
  });
}

function renderSchema(analysis) {
  const structured = analysis.structuredData || { types: analysis.structuredDataTypes || [], issues: [], warnings: [], typeCounts: {}, itemsCount: 0 };
  const typeList = structured.types || [];
  const typeCounts = structured.typeCounts || {};
  panelMap.schema.innerHTML = `
    <div class="card">
      <h3>Structured Data</h3>
      ${typeList.length ? typeList.map((type) => `<span class="tag">${type}</span>`).join("") : `<div class="empty">No structured data types detected.</div>`}
  <div class="footer-note">Items detected: ${structured.itemsCount}</div>
        ${Object.keys(typeCounts).length ? `<div class="footer-note">Counts: ${Object.entries(typeCounts).map(([type, count]) => `${type} (${count})`).join(", ")}</div>` : ""}
        ${structured.issues.length ? `<ul class="issue-list">${structured.issues.map((issue) => `<li>${issue}</li>`).join("")}</ul>` : `<div class="empty">No schema lint issues found.</div>`}
        ${structured.warnings.length ? `<div class="footer-note">Warnings:</div><ul class="issue-list">${structured.warnings.map((warning) => `<li>${warning}</li>`).join("")}</ul>` : ""}
  <div class="footer-note">Goal: 0 schema issues/warnings and match visible content.</div>
    </div>
    <div class="card">
      <h3>Hreflang</h3>
      ${(analysis.hreflang || []).length ? `<table class="table">${analysis.hreflang.map((item) => `<tr><td>${escapeHtml(item.lang || "-")}</td><td>${escapeHtml(item.href || "-")}</td></tr>`).join("")}</table>` : `<div class="empty">No hreflang links found.</div>`}
    </div>
    ${renderSchemaGenerator(analysis)}
  `;

  // Attach handlers for generated schema
  setTimeout(() => {
    // Copy Button
    const copyBtn = document.getElementById("copySchema");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const schemaEl = document.getElementById("schemaOutput");
        if (schemaEl) {
          navigator.clipboard.writeText(schemaEl.value)
            .then(() => setStatus("Schema copied to clipboard!"))
            .catch(() => setStatus("Failed to copy schema."));
        }
      });
    }

    // Validate Button
    const validateBtn = document.getElementById("validateSchema");
    if (validateBtn) {
      validateBtn.addEventListener("click", () => {
        const schemaEl = document.getElementById("schemaOutput");
        if (schemaEl) {
          navigator.clipboard.writeText(schemaEl.value)
            .then(() => {
              setStatus("Copied! Opening Rich Results Test...");
              chrome.tabs.create({ url: "https://search.google.com/test/rich-results" });
            });
        }
      });
    }

    // Type Override
    const typeSelect = document.getElementById("schemaTypeSelect");
    if (typeSelect) {
      typeSelect.addEventListener("change", (e) => {
        state.schemaOverride = e.target.value;
        renderSchema(state.analysis);
      });
    }
  }, 0);
}

function renderTech(analysis) {
  const categories = analysis.techCategories || {};
  const sections = [
    { title: "CMS", items: categories.cms },
    { title: "Frameworks", items: categories.frameworks },
    { title: "Ecommerce", items: categories.ecommerce },
    { title: "Analytics", items: categories.analytics },
    { title: "Tag Managers", items: categories.tagManagers },
    { title: "CDN", items: categories.cdn },
    { title: "Other", items: categories.misc }
  ];
  panelMap.tech.innerHTML = `
    <div class="card">
      <h3>Detected Tech</h3>
      ${(analysis.tech || []).length ? (analysis.tech || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("") : `<div class="empty">No tech signals detected.</div>`}
    </div>
    <div class="card">
      <h3>Tech by Category</h3>
      ${sections.map((section) => section.items && section.items.length ? `
        <div class="footer-note">${section.title}</div>
        <div>${section.items.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
      ` : "").join("")}
    </div>
  `;
}

function renderSerp(serp) {
  if (!serp || !serp.isSerp) {
    panelMap.serp.innerHTML = `<div class="empty"> Open a Google search results page to analyze the SERP.</div> `;
    return;
  }
  panelMap.serp.innerHTML = `
    <div class="card">
      <h3>Top Results</h3>
      <table class="table">
        <tr><th>Title</th><th>URL</th></tr>
        ${serp.results.map((item) => `<tr><td>${item.title}</td><td>${item.url}</td></tr>`).join("")}
      </table>
    </div>
    <div class="card">
      <h3>SERP Gap Analysis</h3>
      <div class="control-group">
        <label for="serpTarget">Target URL</label>
        <select id="serpTarget">
          ${serp.results.map((item, idx) => `<option value="${item.url}" ${idx === 0 ? "selected" : ""}>${item.url}</option>`).join("")}
        </select>
        <button id="runSerpGap" class="secondary">Analyze</button>
      </div>
      <div id="serpGapResults">${state.serpGap ? renderSerpGap(state.serpGap) : `<div class="empty">Run analysis to see gaps.</div>`}</div>
    </div>
  `;

  const button = document.getElementById("runSerpGap");
  const select = document.getElementById("serpTarget");
  if (button && select) {
    button.addEventListener("click", async () => {
      setStatus("Analyzing SERP gaps...");
      state.serpGap = await analyzeSerpGap(serp, select.value);
      setStatus("SERP gap analysis complete.");
      renderSerp(serp);
    });
  }
}

function renderSerpGap(gap) {
  return `
    <div class="metric-grid">
      <div class="metric"><span>Compared Pages</span>${gap.compared}</div>
      <div class="metric"><span>Missing Heading Terms</span>${gap.missingHeadingTerms.length}</div>
      <div class="metric"><span>Missing Entities</span>${gap.missingEntities.length}</div>
      <div class="metric"><span>Dominant Intent</span>${gap.dominantIntent || "-"}</div>
      <div class="metric"><span>Target Intent</span>${gap.targetIntent || "-"}</div>
      <div class="metric"><span>Dominant Format</span>${gap.dominantFormat || "-"}</div>
      <div class="metric"><span>Target Format</span>${gap.targetFormat || "-"}</div>
    </div>
    ${gap.intentMismatch ? `<div class="card"><h3>Intent Mismatch</h3><div class="footer-note">${gap.intentMismatch}</div></div>` : ""}
    ${gap.formatMismatch ? `<div class="card"><h3>Format Mismatch</h3><div class="footer-note">${gap.formatMismatch}</div></div>` : ""}
    <div class="card">
      <h3>Missing Heading Terms</h3>
      ${gap.missingHeadingTerms.length ? gap.missingHeadingTerms.slice(0, 12).map((term) => `<span class="tag">${term}</span>`).join("") : `<div class="empty">No major heading gaps.</div>`}
    </div>
    <div class="card">
      <h3>Missing Entities</h3>
      ${gap.missingEntities.length ? gap.missingEntities.slice(0, 12).map((term) => `<span class="tag">${term}</span>`).join("") : `<div class="empty">No missing entities detected.</div>`}
    </div>
  `;
}

async function analyzeSerpGap(serp, targetUrl) {
  const results = serp.results.slice(0, 5).filter((item) => item.url !== targetUrl);
  const pages = [];
  for (const item of results) {
    try {
      const meta = await fetchPageMeta(item.url);
      pages.push(meta);
    } catch (err) {
      // Skip pages that block fetch.
    }
  }

  let targetMeta = null;
  if (state.analysis && state.analysis.url === targetUrl) {
    targetMeta = {
      headingText: state.analysis.headingText,
      entities: state.analysis.entities,
      schemaTypes: state.analysis.structuredData?.types || [],
      title: state.analysis.title,
      url: state.analysis.url
    };
  } else {
    try {
      targetMeta = await fetchPageMeta(targetUrl);
    } catch (err) {
      targetMeta = null;
    }
  }

  const competitorHeadingTerms = mergeTermCounts(
    pages.map((page) => collectHeadingTerms(page.headingText).map((term) => ({ term, count: 1 })))
  );
  const competitorEntities = mergeTermCounts(
    pages.map((page) => page.entities || [])
  );

  const targetHeadingTerms = targetMeta ? new Set(collectHeadingTerms(targetMeta.headingText)) : new Set();
  const targetEntities = targetMeta ? new Set((targetMeta.entities || []).map((e) => e.entity)) : new Set();

  const intentCounts = new Map();
  const formatCounts = new Map();
  pages.forEach((page) => {
    const intent = classifyIntent({ title: page.title, url: page.url, schemaTypes: page.schemaTypes || [] });
    const format = classifyFormat({ title: page.title, url: page.url, schemaTypes: page.schemaTypes || [] });
    intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);
    formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
  });
  const dominantIntent = Array.from(intentCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
  const dominantFormat = Array.from(formatCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
  const targetIntent = targetMeta ? classifyIntent({ title: targetMeta.title || "", url: targetMeta.url || "", schemaTypes: targetMeta.schemaTypes || [] }) : "Unknown";
  const targetFormat = targetMeta ? classifyFormat({ title: targetMeta.title || "", url: targetMeta.url || "", schemaTypes: targetMeta.schemaTypes || [] }) : "Unknown";
  const intentMismatch = dominantIntent !== "Unknown" && targetIntent !== "Unknown" && dominantIntent !== targetIntent
    ? `SERP skews toward ${dominantIntent} intent while target appears ${targetIntent}. Consider aligning content format.`
    : "";
  const formatMismatch = dominantFormat !== "Unknown" && targetFormat !== "Unknown" && dominantFormat !== targetFormat
    ? `SERP favors ${dominantFormat} format while target is ${targetFormat}. Consider reshaping content.`
    : "";

  const missingHeadingTerms = competitorHeadingTerms
    .slice(0, 20)
    .map((item) => item.term)
    .filter((term) => !targetHeadingTerms.has(term));

  const missingEntities = competitorEntities
    .slice(0, 20)
    .map((item) => item.term)
    .filter((term) => !targetEntities.has(term));

  return {
    compared: pages.length,
    missingHeadingTerms,
    missingEntities,
    dominantIntent,
    targetIntent,
    intentMismatch,
    dominantFormat,
    targetFormat,
    formatMismatch
  };
}

function renderCrawl(crawl) {
  if (!panelMap.crawl) return;
  if (!crawl) {
    panelMap.crawl.innerHTML = `<div class="empty"> Run a crawl to see site - level data.</div> `;
    return;
  }
  const progress = state.crawlProgress || { done: 0, total: 0 };
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const pages = crawl.pages || [];
  const summary = crawl.summary || summarizeCrawl(pages);
  const inboundList = crawl.inbound || computeInboundLinks(pages);
  const inboundMap = new Map(inboundList.map((item) => [normalizeUrl(item.url), item.count]));
  const depthDistribution = crawl.depthDistribution || buildDepthDistribution(pages, summary.depthLimit || 5);
  const intentMix = crawl.intentMix || buildIntentMix(pages);
  const pathMap = crawl.pathMap || buildPathMap(pages);
  const contentStats = crawl.contentStats || buildContentStats(pages);
  const sitemapStats = crawl.sitemapStats || buildSitemapStats(pages, inboundMap);
  const blockerStats = crawl.blockerStats || buildBlockerStats(pages);
  const sourcesLabel = summary.sources || crawl.source || "-";
  const maxDepthCount = Math.max(1, ...depthDistribution.map((bucket) => bucket.count));
  const maxIntentCount = Math.max(1, ...intentMix.map((row) => row.count));
  const barRow = (label, value, maxValue) => {
    const pctWidth = maxValue ? Math.round((value / maxValue) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pctWidth}%"></div></div>
      <div class="bar-value">${value}</div>
    </div> `;
  };
  const depthRows = depthDistribution.length
    ? depthDistribution.map((bucket) => barRow(`Depth ${bucket.depth} `, bucket.count, maxDepthCount)).join("")
    : `<div class="empty"> No depth data yet.</div> `;
  const intentRows = intentMix.length
    ? intentMix.slice(0, 6).map((row) => barRow(row.intent, row.count, maxIntentCount)).join("")
    : `<div class="empty"> No intent mix yet.</div> `;
  const orphanList = sitemapStats.orphanCandidates.length
    ? `<div class="table-scroll"> <table class="table">
    <tr><th>Orphan candidates (in sitemap, no inbound)</th></tr>
    ${sitemapStats.orphanCandidates.map((page) => `<tr><td>${page.url}</td></tr>`).join("")}
  </table></div> `
    : `<div class="empty"> No orphan candidates detected.</div> `;
  const notInSitemapList = sitemapStats.notInSitemapSamples.length
    ? `<div class="table-scroll"> <table class="table">
    <tr><th>Discovered, not in sitemap</th></tr>
    ${sitemapStats.notInSitemapSamples.map((page) => `<tr><td>${page.url}</td></tr>`).join("")}
  </table></div> `
    : `<div class="empty"> No off - sitemap samples found.</div> `;
  const blockerList = blockerStats.samples.length
    ? `<div class="table-scroll"> <table class="table">
    <tr><th>Status</th><th>Reason</th><th>URL</th></tr>
    ${blockerStats.samples.map((page) => {
      const reason = indexabilityReasons(page);
      return `<tr><td>${page.status}</td><td>${reason}</td><td>${page.url}</td></tr>`;
    }).join("")}
  </table></div> `
    : `<div class="empty"> No blocker samples yet.</div> `;

  panelMap.crawl.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>Crawl Pulse</h3>
        <span class="tag">Depth limit ${summary.depthLimit || 5}</span>
      </div>
      <div class="progress">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="footer-note">${progress.done}/${progress.total} pages processed</div>
      <div class="metric-grid">
        <div class="metric"><span>Pages</span>${pages.length}</div>
        <div class="metric"><span>Indexable</span>${summary.indexable}</div>
        <div class="metric"><span>Errors</span>${summary.errorPages}</div>
        <div class="metric"><span>Redirects</span>${summary.redirects}</div>
        <div class="metric"><span>Noindex</span>${summary.noindexPages}</div>
        <div class="metric"><span>Avg Depth</span>${summary.avgDepth}</div>
        <div class="metric"><span>Max Depth</span>${summary.maxDepth}</div>
        <div class="metric"><span>In Sitemap</span>${sitemapStats.inSitemapCount}</div>
      </div>
      <div class="footer-note">Sources: ${sourcesLabel}</div>
      ${crawl.errors?.length ? `<ul class="issue-list">${crawl.errors.map((e) => `<li>${e}</li>`).join("")}</ul>` : ""}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Discovery Map</h3>
        <span class="tag">Depth spread</span>
      </div>
      ${depthRows}
      <div class="footer-note">Depth 0 = seed URLs, higher depths indicate internal discovery.</div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Path Map</h3>
        <span class="tag">Top folders</span>
      </div>
      ${pathMap.length ? `<table class="table">
        <tr><th>Segment</th><th>Pages</th><th>Missing Desc</th><th>Missing H1</th><th>Thin</th></tr>
        ${pathMap.map((row) => `<tr><td>${row.segment}</td><td>${row.count}</td><td>${row.missingDescription}</td><td>${row.missingH1}</td><td>${row.thin}</td></tr>`).join("")}
      </table>` : `<div class="empty">No folder data yet.</div>`}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Sitemap Reality Check</h3>
        <span class="tag">Coverage drift</span>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>In Sitemap</span>${sitemapStats.inSitemapCount}</div>
        <div class="metric"><span>Not in Sitemap</span>${sitemapStats.notInSitemapCount}</div>
        <div class="metric"><span>Orphan Candidates</span>${sitemapStats.orphanCandidates.length}</div>
        <div class="metric"><span>Discovered Only</span>${sitemapStats.notInSitemapSamples.length}</div>
      </div>
      ${orphanList}
      ${notInSitemapList}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Blocker Radar</h3>
        <span class="tag">Detours</span>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Redirects</span>${blockerStats.redirects}</div>
        <div class="metric"><span>Errors</span>${blockerStats.errors}</div>
        <div class="metric"><span>Noindex</span>${blockerStats.noindex}</div>
        <div class="metric"><span>Canonical Missing</span>${blockerStats.canonicalMissing}</div>
        <div class="metric"><span>Canonical Other</span>${blockerStats.canonicalOther}</div>
      </div>
      ${blockerList}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Content Footprint</h3>
        <span class="tag">Page quality</span>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Missing Titles</span>${contentStats.missingTitle}</div>
        <div class="metric"><span>Missing Descriptions</span>${contentStats.missingDescription}</div>
        <div class="metric"><span>Missing H1</span>${contentStats.missingH1}</div>
        <div class="metric"><span>Thin Pages</span>${contentStats.thin}</div>
        <div class="metric"><span>Avg Words</span>${contentStats.avgWords}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Intent Mix</h3>
        <span class="tag">Format signals</span>
      </div>
      ${intentRows}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Link Equity Gaps</h3>
        <span class="tag">Lowest inbound</span>
      </div>
      ${inboundList.length ? `<div class="table-scroll"><table class="table">
        <tr><th>Inbound</th><th>URL</th></tr>
        ${inboundList.slice(0, 12).map((item) => `<tr><td>${item.count}</td><td>${item.url}</td></tr>`).join("")}
      </table></div>` : `<div class="empty">No inbound link data.</div>`}
      <p class="footer-note">Pages with lowest inbound links are likely underlinked.</p>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>URL Ledger</h3>
        <span class="tag">Detail view</span>
      </div>
      <div class="table-scroll">
        <table class="table">
          <tr><th>Status</th><th>Indexable</th><th>Depth</th><th>Source</th><th>Reason</th><th>Title</th><th>URL</th></tr>
          ${pages.slice(0, 50).map((page) => {
    const reason = indexabilityReasons(page);
    const indexable = reason === "Indexable" ? "Yes" : "No";
    return `<tr><td>${page.status}</td><td>${indexable}</td><td>${page.depth ?? pageDepth(page.url)}</td><td>${page.source || "-"}</td><td>${reason}</td><td>${page.title || "-"}</td><td>${page.url}</td></tr>`;
  }).join("")}
        </table>
      </div>
      <p class="footer-note">Showing up to 50 pages. Reason explains indexability.</p>
    </div>
  `;
}


function safeRender(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[SafeRender] Error in ${name}:`, e);
    // Map function name to panel key
    const keyMap = {
      renderoverview: "overview",
      renderfixplan: "plan",
      renderonpage: "onpage",
      rendercontent: "content",
      renderlinks: "links",
      rendermedia: "media",
      renderschema: "schema",
      rendertech: "tech",
      renderjsseo: "jsseo",
      renderaivisibility: "ai",
      renderserp: "serp",
      renderregex: "regex"
    };
    const key = keyMap[name.toLowerCase()] || name.replace("render", "").toLowerCase();
    const panel = panelMap[key];
    if (panel) {
      panel.innerHTML = `
        <div class="card error-card">
          <h3>Data Unavailable</h3>
          <p>This section failed to render. Please refresh.</p>
          <div class="footer-note">Error: ${escapeHtml(e.message || "Unknown error")}</div>
        </div>
      `;
    }
  }
}

function renderAll() {
  if (!state.analysis) {
    renderEmptyPanels();
    return;
  }

  safeRender("renderOverview", () => renderOverview(state.analysis));
  safeRender("renderFixPlan", () => renderFixPlan(state.analysis, state.crawl));
  safeRender("renderOnPage", () => renderOnPage(state.analysis));
  safeRender("renderContent", () => renderContent(state.analysis));
  safeRender("renderLinks", () => renderLinks(state.analysis));
  safeRender("renderMedia", () => renderMedia(state.analysis));
  safeRender("renderSchema", () => renderSchema(state.analysis));
  safeRender("renderTech", () => renderTech(state.analysis));
  safeRender("renderJsSeo", () => renderJsSeo(state.analysis));
  safeRender("renderAiVisibility", () => renderAiVisibility(state.analysis));
  safeRender("renderSerp", () => renderSerp(state.serp));
  safeRender("renderRegex", () => renderRegex(state.analysis));
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch (err) {
    console.error("[Atlas] Failed to get active tab:", err);
    return null;
  }
}

function sendMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Atlas] Message failed:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (err) {
      console.error("[Atlas] sendMessage error:", err);
      resolve(null);
    }
  });
}

function renderRegex() {
  panelMap.regex.innerHTML = `
    <div class="card">
      <h3>Regex Builder (GSC + GA4, RE2-safe)</h3>
      <div class="grid-2">
        <label>Target
          <select id="regexTarget">
            <option value="gsc">Google Search Console</option>
            <option value="ga4">Google Analytics (GA4)</option>
          </select>
        </label>
        <label>Match type
          <select id="regexMatch">
            <option value="contains">Contains</option>
            <option value="starts">Starts with</option>
            <option value="ends">Ends with</option>
            <option value="exact">Exact match</option>
          </select>
        </label>
      </div>
      <label>Terms (one per line or comma)
        <textarea id="regexTerms" class="textarea" rows="4" placeholder="buy&#10;purchase&#10;order"></textarea>
      </label>
      <div class="grid-3">
        <label class="inline"><input type="checkbox" id="regexEscape" checked />Escape special chars</label>
        <label class="inline"><input type="checkbox" id="regexWhole" />Whole word</label>
        <label class="inline"><input type="checkbox" id="regexCI" />Case-insensitive</label>
      </div>
      <div id="regexHint" class="footer-note"></div>
      <pre id="regexOutput" class="code-block"></pre>
      <div class="buttons">
        <button id="regexCopy" class="btn primary">Copy Regex</button>
      </div>
      <div id="regexWarnings" class="warn-box" style="display:none;"></div>
      <div class="footer-note">Handles GA4 “full match” vs GSC “contains” and warns on RE2-unsafe patterns.</div>
    </div>
    `;
  attachRegexBuilderHandlers();
}

// ============================================
// FEATURE: SCHEMA & ENTITY ENGINE
// ============================================

function renderSchemaGenerator(analysis) {
  if (!window.SchemaBuilder) return '<div class="card"><div class="empty">Schema Builder loading...</div></div>';

  const types = [
    'Article', 'BlogPosting', 'NewsArticle', 'Product',
    'FAQPage', 'Recipe', 'LocalBusiness', 'Organization',
    'Event', 'JobPosting', 'Course', 'BreadcrumbList', 'WebPage'
  ];

  // Default to Article if not selected
  const selectedType = state.schemaOverride || 'Article';

  let schemaJson;
  try {
    const builtSchema = SchemaBuilder.build(selectedType, analysis);
    schemaJson = JSON.stringify(builtSchema, null, 2);
  } catch (err) {
    console.error(err);
    return '<div class="card"><div class="status error">Builder Error: ' + err.message + '</div></div>';
  }

  const typeOptions = types.map(t =>
    `<option value="${t}" ${t === selectedType ? 'selected' : ''}>${t}</option>`
  ).join('');

  return `
    <div class="card schema-engine-card">
      <h3 style="margin-bottom:12px;">Schema Builder</h3>
      
      <div style="margin-bottom:16px;">
        <div class="label" style="margin-bottom:4px; font-weight:600;">Build schema for:</div>
        <select id="schemaTypeSelect" style="width:100%; padding:8px; border-radius: var(--radius); border:1px solid var(--border-medium); background: var(--bg-card); color: var(--text-primary);">
             ${typeOptions}
        </select>
        <div class="help-text" style="margin-top:4px; font-size:11px; color:var(--text-secondary);">
          Select a type to generate a template populated with this page's data.
        </div>
      </div>

      <div class="schema-code-wrapper" style="position:relative; display:flex; flex-direction:column;">
        <textarea class="code-block" id="schemaOutput" spellcheck="false" style="max-height:350px; min-height:200px; overflow:auto; resize:vertical; font-family:monospace; white-space:pre; border:1px solid var(--border-medium); background:var(--bg-secondary); color:var(--text-code); padding:10px; border-radius:4px;">${escapeHtml(schemaJson)}</textarea>
        <div style="position:absolute; top:8px; right:20px; display:flex; gap:8px;">
             <button class="btn small" id="copySchema">Copy JSON</button>
             <button class="btn small secondary" id="validateSchema">Validate</button>
        </div>
      </div>
    </div>
  `;
}

// ============================================
// FEATURE: VISUAL OVERLAY
// ============================================
async function toggleOverlay() {
  try {
    const tab = await getActiveTab();
    if (!tab || !isValidTabUrl(tab.url)) {
      setStatus("Open a normal web page to use overlay.");
      return;
    }

    state.overlayActive = !state.overlayActive;

    if (state.overlayActive) {
      // Build issues list from analysis
      const issues = buildIssues(state.analysis);
      const overlayData = {
        type: "showOverlay",
        issues: issues.map(i => ({
          type: i.severity,
          message: i.text,
          selector: i.selector || null
        })),
        images: (state.analysis?.images?.samples || [])
          .filter(img => !img.alt || img.alt.length < 5)
          .map(img => ({ src: img.src, issue: "Missing or short alt text" }))
      };

      await sendMessage(tab.id, overlayData);
      toggleOverlayBtn.textContent = "Hide Overlay";
      toggleOverlayBtn.classList.add("active");
      setStatus("Overlay active. Issues highlighted on page.");
    } else {
      await sendMessage(tab.id, { type: "hideOverlay" });
      toggleOverlayBtn.textContent = "Overlay";
      toggleOverlayBtn.classList.remove("active");
      setStatus("Overlay hidden.");
    }
  } catch (err) {
    setStatus(`Overlay error: ${err.message}`);
  }
}

async function refreshAudit() {
  setStatus("Running audit...");
  try {
    const tab = await getActiveTab();
    if (!tab || !isValidTabUrl(tab.url)) {
      setStatus("Open a normal web page to analyze.");
      renderEmptyPanels();
      return;
    }

    state.previous = await loadPreviousAudit(tab.url).catch(() => null);
    const response = await sendMessage(tab.id, { type: "analyze" }).catch((e) => ({ ok: false, error: e.message }));
    if (!response || !response.ok) {
      console.error("Analysis failed:", response);
      setStatus("Unable to read page: " + (response?.error || "Unknown error"));
      renderEmptyPanels();
      return;
    }

    state.schemaOverride = null;
    state.analysis = { ...response.data, auditedAt: new Date().toISOString() };
    await storeAudit(tab.url, state.analysis).catch(() => { });
    await saveRecentAudit(tab.url).catch(() => { });
    await loadRecentAudits().catch(() => { });
    const serpResponse = await sendMessage(tab.id, { type: "serp" }).catch(() => null);
    state.serp = serpResponse && serpResponse.ok ? serpResponse.data : null;
    setStatus("Audit complete.");
    renderAll();
  } catch (err) {
    setStatus(`Audit error: ${err.message || "Unknown error"} `);
    renderEmptyPanels();
  }
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

async function runCrawl() {
  if (!crawlCountInput) {
    setStatus("Crawl is disabled in this build.");
    return;
  }
  if (!state.analysis) {
    setStatus("Run an audit before crawling.");
    return;
  }

  const limit = Math.min(Math.max(parseInt(crawlCountInput.value, 10) || 20, 5), 50);
  const maxDepth = 5;
  setStatus(`Crawling up to ${limit} pages...`);
  const origin = state.analysis.origin;
  const errors = [];
  const pages = [];
  const queue = [];
  const visited = new Set();
  const queued = new Set();
  const sourceTally = { sitemap: 0, page: 0, discovered: 0 };
  state.crawlProgress = { done: 0, total: limit };

  const enqueue = (url, source, via = "", depth = 0) => {
    if (!url || !url.startsWith(origin)) return;
    const normalized = normalizeUrl(url);
    if (depth > maxDepth) return;
    if (visited.has(normalized) || queued.has(normalized)) return;
    queued.add(normalized);
    queue.push({ url: normalized, source, via, depth });
  };

  // Seeds: current page + any internal samples we already have.
  enqueue(state.analysis.url, "page", "", 0);
  (state.analysis.links.internalSamples || []).slice(0, limit).forEach((link) => enqueue(link, "page", state.analysis.url, 1));

  // Pull sitemap URLs first to prioritize coverage.
  const sitemapSet = new Set();
  const sitemapUrl = `${origin}/sitemap.xml`;
  try {
    const sitemapText = await fetchText(sitemapUrl);
    const urls = parseSitemapUrls(sitemapText, origin);
    urls.forEach((u) => {
      sitemapSet.add(normalizeCompareUrl(u, origin));
      enqueue(u, "sitemap", "", 0);
    });
  } catch (err) {
    errors.push(`Sitemap not available at ${sitemapUrl}`);
  }

  // Check robots for extra sitemaps.
  if (!sitemapSet.size) {
    try {
      const robotsText = await fetchText(`${origin}/robots.txt`);
      const sitemapLinks = extractSitemapsFromRobots(robotsText);
      for (const link of sitemapLinks) {
        try {
          const text = await fetchText(link);
          const urls = parseSitemapUrls(text, origin);
          urls.forEach((u) => {
            sitemapSet.add(normalizeCompareUrl(u, origin));
            enqueue(u, "sitemap", "", 0);
          });
        } catch (err) {
          errors.push(`Failed sitemap: ${link}`);
        }
      }
    } catch (err) {
      errors.push("Robots.txt not available.");
    }
  }

  if (!queue.length) {
    setStatus("No URLs found to crawl.");
    return;
  }

  state.crawlProgress = { done: 0, total: Math.min(limit, queue.length) || limit };

  while (queue.length && pages.length < limit) {
    const { url, source, via, depth } = queue.shift();
    queued.delete(url);
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const result = await fetchPageMeta(url);
      const normalized = normalizeUrl(result.url);
      const page = {
        ...result,
        url: normalized,
        depth,
        pathDepth: pageDepth(normalized, origin),
        inSitemap: sitemapSet.has(normalizeCompareUrl(normalized, origin)),
        source,
        discoveredFrom: via
      };
      pages.push(page);
      sourceTally[source] = (sourceTally[source] || 0) + 1;

      const budget = limit - pages.length - queue.length;
      if (budget > 0 && result.internalLinks?.length) {
        const nextLinks = prioritizeLinks(result.internalLinks, origin, budget, visited, queued, depth, maxDepth);
        nextLinks.forEach((link) => enqueue(link, "discovered", page.url, depth + 1));
      }
    } catch (err) {
      errors.push(`${url}: ${err.message || err}`);
      pages.push({
        url,
        status: "ERR",
        title: "",
        h1Count: 0,
        wordCount: 0,
        descriptionLength: 0,
        canonical: "",
        metaRobots: "",
        noindex: false,
        schemaTypes: [],
        hreflang: [],
        internalLinks: [],
        depth,
        pathDepth: pageDepth(url, origin),
        inSitemap: sitemapSet.has(normalizeCompareUrl(url, origin)),
        source,
        discoveredFrom: via
      });
    }

    const partialSummary = summarizeCrawl(pages);
    partialSummary.sources = formatSources(sourceTally);
    const totalEstimate = Math.max(state.crawlProgress.total || limit, Math.min(limit, pages.length + queue.length + 1));
    state.crawlProgress = { done: pages.length, total: totalEstimate };
    renderCrawl({
      pages,
      errors,
      summary: partialSummary,
      indexability: buildIndexabilityBreakdown(pages),
      clusters: [],
      inbound: computeInboundLinks(pages),
      duplicates: { titles: [], descriptions: [] },
      clusterAlerts: [],
      hreflangIssues: [],
      cannibalization: [],
      clusterDiffs: []
    });
  }

  const summary = summarizeCrawl(pages);
  summary.depthLimit = maxDepth;
  summary.sources = formatSources(sourceTally);
  const clusters = clusterTemplates(pages);
  const inbound = computeInboundLinks(pages);
  const inboundMap = new Map(inbound.map((item) => [normalizeUrl(item.url), item.count]));
  const depthDistribution = buildDepthDistribution(pages, maxDepth);
  const intentMix = buildIntentMix(pages);
  const pathMap = buildPathMap(pages);
  const contentStats = buildContentStats(pages);
  const sitemapStats = buildSitemapStats(pages, inboundMap);
  const blockerStats = buildBlockerStats(pages);
  const hreflangIssues = analyzeHreflangReciprocity(pages);
  summary.hreflangMissingBack = hreflangIssues.length;
  const cannibalization = detectCannibalization(pages);
  const history = await storeCrawlSnapshot(origin, clusters);
  const clusterDiffs = diffClusterHistory(history);
  const duplicates = {
    titles: groupDuplicates(pages, "title"),
    descriptions: groupDuplicates(pages, "description")
  };
  state.crawl = {
    pages,
    errors,
    summary,
    indexability: buildIndexabilityBreakdown(pages),
    clusters,
    inbound,
    depthDistribution,
    intentMix,
    pathMap,
    contentStats,
    sitemapStats,
    blockerStats,
    duplicates,
    clusterAlerts: buildClusterAlerts(clusters),
    source: summary.sources,
    hreflangIssues,
    cannibalization,
    history,
    clusterDiffs
  };
  setStatus("Crawl complete.");
  renderCrawl(state.crawl);
  renderFixPlan(state.analysis, state.crawl);
}

async function fetchText(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function extractEntitiesFromText(text, limit = 15) {
  const matches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) || [];
  const counts = new Map();
  for (const match of matches) {
    const cleaned = match.trim();
    if (cleaned.length < 3) continue;
    counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([entity, count]) => ({ entity, count }));
}

function extractHeadingTextFromDoc(doc) {
  const map = { h1: [], h2: [], h3: [] };
  ["h1", "h2", "h3"].forEach((tag) => {
    map[tag] = Array.from(doc.querySelectorAll(tag)).map((el) => (el.textContent || "").trim()).filter(Boolean);
  });
  return map;
}

function extractHreflangFromDoc(doc, origin) {
  const hreflang = [];
  const links = Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'));
  links.forEach((link) => {
    const lang = link.getAttribute("hreflang") || "";
    const href = link.getAttribute("href") || "";
    if (!href) return;
    try {
      const url = new URL(href, origin);
      hreflang.push({ lang, href: normalizeUrl(url.toString()) });
    } catch (err) {
      hreflang.push({ lang, href });
    }
  });
  return hreflang;
}

// Normalize schema type (e.g., "http://schema.org/Product" -> "Product")
function normalizeType(type) {
  if (!type) return "";
  const value = String(type);
  if (value.includes("/")) return value.split("/").pop() || value;
  if (value.includes("#")) return value.split("#").pop() || value;
  return value;
}

function extractSchemaTypesFromDoc(doc) {
  const types = new Set();
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent || "");
      const stack = Array.isArray(json) ? json : [json];
      stack.forEach((item) => {
        if (!item) return;
        if (item["@graph"]) {
          item["@graph"].forEach((node) => {
            const nodeType = node && node["@type"];
            if (Array.isArray(nodeType)) nodeType.forEach((t) => types.add(normalizeType(t)));
            else if (nodeType) types.add(normalizeType(nodeType));
          });
        }
        const type = item["@type"];
        if (Array.isArray(type)) type.forEach((t) => types.add(normalizeType(t)));
        else if (type) types.add(normalizeType(type));
      });
    } catch (err) {
      // Ignore invalid JSON-LD blocks.
    }
  }
  const microdata = Array.from(doc.querySelectorAll("[itemscope][itemtype]"));
  microdata.forEach((el) => {
    const itemType = el.getAttribute("itemtype");
    if (itemType) types.add(normalizeType(itemType));
  });
  return Array.from(types);
}

function classifyIntent({ title = "", url = "", schemaTypes = [] }) {
  const titleLower = title.toLowerCase();
  const urlLower = url.toLowerCase();
  const schemaSet = new Set(schemaTypes.map((t) => t.toLowerCase()));

  if (schemaSet.has("product")) return "Transactional";
  if (schemaSet.has("localbusiness")) return "Local";
  if (schemaSet.has("faqpage") || schemaSet.has("howto")) return "Informational";
  if (schemaSet.has("article") || schemaSet.has("blogposting") || schemaSet.has("newsarticle")) return "Informational";

  if (titleLower.includes("near me") || urlLower.includes("near-me")) return "Local";
  if (/(buy|pricing|price|shop|deal|coupon|order)/.test(titleLower + " " + urlLower)) return "Transactional";
  if (/(review|vs|versus|comparison|best|top)/.test(titleLower)) return "Commercial";
  if (/(how to|guide|tutorial|what is|learn)/.test(titleLower)) return "Informational";

  return "Informational";
}

function classifyFormat({ title = "", url = "", schemaTypes = [] }) {
  const titleLower = title.toLowerCase();
  const urlLower = url.toLowerCase();
  const schemaSet = new Set(schemaTypes.map((t) => t.toLowerCase()));

  if (schemaSet.has("product")) return "Product";
  if (schemaSet.has("howto")) return "HowTo";
  if (schemaSet.has("faqpage")) return "FAQ";
  if (schemaSet.has("newsarticle")) return "News";
  if (schemaSet.has("article") || schemaSet.has("blogposting")) return "Guide";
  if (schemaSet.has("localbusiness")) return "Local";

  if (/(how to|tutorial|guide|learn)/.test(titleLower)) return "Guide";
  if (/(best|top|list|ideas|examples)/.test(titleLower)) return "Listicle";
  if (/(vs|versus|comparison)/.test(titleLower)) return "Comparison";
  if (/(pricing|price|buy|shop|order)/.test(titleLower + " " + urlLower)) return "Product";
  if (/(near me|locations|hours)/.test(titleLower + " " + urlLower)) return "Local";

  return "Article";
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch (err) {
    return value;
  }
}

function normalizeHost(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "");
}

function normalizePath(pathname) {
  let path = pathname || "/";
  path = path.replace(/\/(index\.html?|default\.html?)$/i, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function normalizeCompareUrl(value, origin) {
  try {
    const url = new URL(value, origin);
    url.hash = "";
    const host = normalizeHost(url.hostname);
    const path = normalizePath(url.pathname);
    return `${host}${path}${url.search}`;
  } catch (err) {
    return value;
  }
}

function extractInternalLinksFromDoc(doc, origin) {
  const links = Array.from(doc.querySelectorAll("a[href]"));
  const results = new Set();
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#") || href.startsWith("javascript:")) continue;
    try {
      const url = new URL(href, origin);
      if (url.origin === origin) results.add(normalizeUrl(url.toString()));
    } catch (err) {
      // Ignore invalid URLs.
    }
  }
  return Array.from(results);
}

function getCanonicalFromDoc(doc, origin) {
  const el = doc.querySelector('link[rel="canonical"]');
  if (!el) return "";
  const href = el.getAttribute("href") || "";
  if (!href) return "";
  try {
    const url = new URL(href, origin);
    return url.toString();
  } catch (err) {
    return href;
  }
}

function parseSitemapUrls(xmlText, origin) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const locs = Array.from(xml.querySelectorAll("loc"));
  const urls = [];
  let originHost = "";
  try {
    originHost = normalizeHost(new URL(origin).hostname);
  } catch (err) {
    originHost = "";
  }
  for (const loc of locs) {
    const href = (loc.textContent || "").trim();
    if (!href) continue;
    try {
      const url = new URL(href, origin);
      if (originHost && normalizeHost(url.hostname) !== originHost) continue;
      urls.push(url.toString());
    } catch (err) {
      // Ignore invalid URLs.
    }
  }
  return urls;
}

function extractSitemapsFromRobots(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith("sitemap:"))
    .map((line) => line.split(":"))
    .map((parts) => parts.slice(1).join(":").trim())
    .filter(Boolean);
}

async function fetchPageMeta(url) {
  const response = await fetch(url, { credentials: "omit" });
  const status = response.status;
  const finalUrl = response.url || url;
  const origin = new URL(finalUrl).origin;
  const xRobots = response.headers.get("x-robots-tag") || "";
  const contentType = response.headers.get("content-type") || "";
  const contentLengthHeader = response.headers.get("content-length");
  const text = await response.text();
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) || 0 : text.length;
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");

  const title = doc.title || "";
  const description = doc.querySelector('meta[name="description"]');
  const descriptionContent = description ? description.getAttribute("content") || "" : "";
  const descriptionLength = descriptionContent.length;
  const metaRobots = (doc.querySelector('meta[name="robots"]')?.getAttribute("content") || "").toLowerCase();
  const noindex = metaRobots.includes("noindex") || xRobots.toLowerCase().includes("noindex");
  const h1Count = doc.querySelectorAll("h1").length;
  const bodyText = doc.body ? doc.body.innerText || "" : "";
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  const headingText = extractHeadingTextFromDoc(doc);
  const entities = extractEntitiesFromText(bodyText, 12);
  const internalLinks = extractInternalLinksFromDoc(doc, origin);
  const canonical = getCanonicalFromDoc(doc, finalUrl);
  const schemaTypes = extractSchemaTypesFromDoc(doc);
  const hreflang = extractHreflangFromDoc(doc, finalUrl);

  return {
    url: finalUrl,
    status,
    title,
    description: descriptionContent,
    descriptionLength,
    h1Count,
    wordCount,
    canonical,
    metaRobots,
    xRobots,
    noindex,
    schemaTypes,
    hreflang,
    headingText,
    entities,
    internalLinks,
    contentLength,
    contentType
  };
}

function exportCrawlCsv() {
  if (!state.crawl) {
    setStatus("Run a crawl before exporting.");
    return;
  }
  const inboundMap = new Map(state.crawl.inbound.map((item) => [normalizeUrl(item.url), item.count]));
  const rows = [
    ["URL", "Status", "Indexable", "Reasons", "Depth", "Source", "Discovered From", "In Sitemap", "Title", "Description Length", "H1 Count", "Word Count", "Canonical", "Meta Robots", "Schema Types", "Internal Links (count)", "Inbound Links (count)", "Content Length (bytes)", "Content Type"],
    ...state.crawl.pages.map((page) => {
      const reason = indexabilityReasons(page);
      return [
        page.url,
        page.status,
        reason === "Indexable" ? "Yes" : "No",
        reason,
        page.depth ?? pageDepth(page.url),
        page.source || "",
        page.discoveredFrom || "",
        page.inSitemap ? "Yes" : "No",
        page.title || "",
        page.descriptionLength || 0,
        page.h1Count || 0,
        page.wordCount || 0,
        page.canonical || "",
        page.metaRobots || "",
        (page.schemaTypes || []).join("; "),
        (page.internalLinks || []).length,
        inboundMap.get(normalizeUrl(page.url)) || 0,
        page.contentLength || "",
        page.contentType || ""
      ];
    })
  ];
  downloadFile("atlas-seo-crawl.csv", toCsv(rows), "text/csv");
}

function exportAuditCsv() {
  if (!state.analysis) {
    setStatus("Run an audit before exporting.");
    return;
  }
  const a = state.analysis;
  const techCat = a.techCategories || {};

  const rows = [];
  const addSection = (title) => rows.push([title]);
  const addBlank = () => rows.push([]);

  addSection("Page");
  rows.push(["Field", "Value"]);
  rows.push(["URL", a.url]);
  rows.push(["Title", a.title]);
  rows.push(["Title Length", a.title.length]);
  rows.push(["Meta Description", a.metaDescription]);
  rows.push(["Meta Description Length", a.metaDescription.length]);
  rows.push(["Canonical", a.canonical]);
  rows.push(["Meta Robots", a.metaRobots]);
  rows.push(["Viewport", a.viewport]);
  rows.push(["Language", a.language]);
  rows.push(["Word Count", a.wordCount]);
  rows.push(["Text/HTML Ratio", a.textRatio]);
  addBlank();

  addSection("Performance");
  rows.push(["Metric", "Value"]);
  rows.push(["TTFB (start→responseStart ms)", a.performance.ttfb ?? ""]);
  rows.push(["TTFB (net ms)", a.performance.ttfbMs ?? ""]);
  rows.push(["FCP (ms)", a.performance.fcp ?? ""]);
  rows.push(["LCP (ms)", a.performance.lcp ?? ""]);
  rows.push(["CLS", a.performance.cls ?? ""]);
  rows.push(["INP (ms)", a.performance.inp ?? ""]);
  rows.push(["FID (ms)", a.performance.fid ?? ""]);
  rows.push(["DOMContentLoaded (ms)", a.performance.domContentLoaded ?? ""]);
  rows.push(["Load (ms)", a.performance.load ?? ""]);
  addBlank();

  addSection("Headings");
  rows.push(["Tag", "Count"]);
  rows.push(["H1", a.headings.h1]);
  rows.push(["H2", a.headings.h2]);
  rows.push(["H3", a.headings.h3]);
  rows.push(["H4", a.headings.h4]);
  rows.push(["H5", a.headings.h5]);
  rows.push(["H6", a.headings.h6]);
  if (a.headingText?.order?.length) {
    rows.push([]);
    rows.push(["Sequential Headings", "Text"]);
    a.headingText.order.forEach((h) => rows.push([h.tag.toUpperCase(), h.text]));
  }
  addBlank();

  addSection("Social");
  rows.push(["OG Title", a.og.title || ""]);
  rows.push(["OG Description", a.og.description || ""]);
  rows.push(["OG URL", a.og.url || ""]);
  rows.push(["OG Image", a.og.image || ""]);
  rows.push(["Twitter Card", a.twitter.card || ""]);
  rows.push(["Twitter Title", a.twitter.title || ""]);
  rows.push(["Twitter Description", a.twitter.description || ""]);
  addBlank();

  addSection("Links");
  rows.push(["Internal", a.links.internal]);
  rows.push(["External", a.links.external]);
  rows.push(["Nofollow", a.links.nofollow]);
  rows.push(["UGC", a.links.ugc]);
  rows.push(["Sponsored", a.links.sponsored]);
  if (a.links.internalLinks?.length) {
    rows.push([]);
    rows.push(["Section", "Anchor", "URL"]);
    a.links.internalLinks.forEach((lnk) => rows.push([lnk.section || "page", lnk.text || "-", lnk.href]));
  }
  addBlank();

  addSection("Images");
  rows.push(["Total", a.images.total]);
  rows.push(["Missing Alt", a.images.missingAlt]);
  rows.push(["Short Alt", a.images.shortAlt]);
  rows.push(["Missing Size Attr", a.images.missingSize]);
  rows.push(["Large Images (>=2000px)", a.images.largeImages]);
  rows.push(["Generic Filenames", a.images.genericFilename]);
  rows.push(["Total Transfer", formatKb(a.images.totalBytes)]);
  rows.push(["Largest File", `${formatKb(a.images.maxBytes)} (${a.images.maxBytesSrc || ""})`]);
  rows.push(["Max Dimensions", a.images.maxDimensions?.width ? `${a.images.maxDimensions.width}x${a.images.maxDimensions.height}` : "-"]);
  if (a.images.samples?.length) {
    rows.push([]);
    rows.push(["Dimensions", "Size", "Source"]);
    a.images.samples.forEach((img) => rows.push([`${img.width}x${img.height}`, formatKb(img.size), img.src]));
  }
  addBlank();

  if (a.hreflang?.length) {
    addSection("Hreflang");
    rows.push(["Lang", "URL"]);
    a.hreflang.forEach((hl) => rows.push([hl.lang, hl.href]));
    addBlank();
  }

  const sd = a.structuredData || {};
  if (sd.types?.length || sd.issues?.length || sd.warnings?.length) {
    addSection("Structured Data");
    if (sd.types?.length) rows.push(["Types", sd.types.join(", ")]);
    if (sd.typeCounts && Object.keys(sd.typeCounts).length) {
      rows.push(["Type Counts", Object.entries(sd.typeCounts).map(([k, v]) => `${k} (${v})`).join(", ")]);
    }
    if (sd.issues?.length) rows.push(["Issues", sd.issues.join(" | ")]);
    if (sd.warnings?.length) rows.push(["Warnings", sd.warnings.join(" | ")]);
    addBlank();
  }

  addSection("Tech");
  if (a.tech?.length) rows.push(["All", a.tech.join(", ")]);
  if (techCat.cms?.length) rows.push(["CMS", techCat.cms.join(", ")]);
  if (techCat.frameworks?.length) rows.push(["Frameworks", techCat.frameworks.join(", ")]);
  if (techCat.ecommerce?.length) rows.push(["Ecommerce", techCat.ecommerce.join(", ")]);
  if (techCat.analytics?.length) rows.push(["Analytics", techCat.analytics.join(", ")]);
  if (techCat.tagManagers?.length) rows.push(["Tag Managers", techCat.tagManagers.join(", ")]);
  if (techCat.cdn?.length) rows.push(["CDN", techCat.cdn.join(", ")]);
  if (techCat.misc?.length) rows.push(["Other", techCat.misc.join(", ")]);
  addBlank();

  if (state.serp && state.serp.results?.length) {
    addSection("SERP Top Results");
    rows.push(["Title", "URL"]);
    state.serp.results.forEach((r) => rows.push([r.title, r.url]));
    addBlank();
  }

  downloadFile("atlas-seo-audit.csv", toCsv(rows), "text/csv");
}
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab;
      Object.entries(panelMap).forEach(([key, panel]) => {
        panel.classList.toggle("active", key === target);
      });
      sendHighlight({ type: "clearHighlight" });
      if (target === "ai") {
        if (state.aiHighlightPayload?.sections?.length) {
          sendAiHighlight({ type: "aiHoverStart", ...state.aiHighlightPayload });
        } else {
          sendAiHighlight({ type: "aiHoverStart", sections: [], siteBlocked: false, noImageAi: false });
        }
      } else {
        sendAiHighlight({ type: "aiHoverStop" });
      }
    });
  });
}

function initNavSearch() {
  const input = document.getElementById("navSearch");
  if (!input) return;
  const tabs = Array.from(document.querySelectorAll(".tab"));
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    tabs.forEach((tab) => {
      const label = (tab.textContent || "").toLowerCase();
      const match = !query || label.includes(query);
      tab.style.display = match ? "" : "none";
    });
  });
}

let lastHighlightKey = null;

async function sendHighlight(payload) {
  const tab = await getActiveTab();
  if (!tab || !isValidTabUrl(tab.url)) return;
  await sendMessage(tab.id, payload);
}

async function sendAiHighlight(payload) {
  const tab = await getActiveTab();
  if (!tab || !isValidTabUrl(tab.url)) return;
  await sendMessage(tab.id, payload);
}

function initHighlighting() {
  document.addEventListener("mouseover", (event) => {
    const item = event.target.closest(".highlight-item");
    if (!item) return;
    const xpath = item.dataset.highlightXpath;
    const selector = item.dataset.highlightSelector;
    const href = item.dataset.highlightHref;
    const linkText = item.dataset.highlightText;
    const src = item.dataset.highlightSrc;
    const tag = item.dataset.highlightTag;
    const text = item.dataset.highlightText;
    const textValue = linkText || text || "";
    const key = xpath
      ? `x:${xpath}`
      : selector
        ? `s:${selector}`
        : href
          ? `h:${href}:${textValue}`
          : src
            ? `i:${src}`
            : `t:${tag}:${textValue}`;
    if (key === lastHighlightKey) return;
    lastHighlightKey = key;
    const payload = { type: "highlight" };
    if (xpath) payload.xpath = xpath;
    if (selector) payload.selector = selector;
    if (href) payload.href = href;
    if (textValue) payload.text = textValue;
    if (src) payload.src = src;
    if (tag) payload.tag = tag;
    sendHighlight(payload);
  });

  document.addEventListener("mouseout", (event) => {
    const item = event.target.closest(".highlight-item");
    if (!item) return;
    const related = event.relatedTarget ? event.relatedTarget.closest(".highlight-item") : null;
    if (related === item) return;
    lastHighlightKey = null;
    sendHighlight({ type: "clearHighlight" });
  });

  const content = document.querySelector(".content");
  if (content) {
    content.addEventListener("mouseleave", () => {
      lastHighlightKey = null;
      sendHighlight({ type: "clearHighlight" });
    });
  }
}


function initJumping() {
  document.addEventListener("click", (event) => {
    const item = event.target.closest(".jump-item");
    if (!item) return;
    event.preventDefault();
    const xpath = item.dataset.highlightXpath;
    const selector = item.dataset.highlightSelector;
    const href = item.dataset.highlightHref;
    const linkText = item.dataset.highlightText;
    const src = item.dataset.highlightSrc;
    const tag = item.dataset.highlightTag;
    const text = item.dataset.highlightText;
    const textValue = linkText || text || "";
    const payload = { type: "scrollTo" };
    if (xpath) payload.xpath = xpath;
    if (selector) payload.selector = selector;
    if (href) payload.href = href;
    if (textValue) payload.text = textValue;
    if (src) payload.src = src;
    if (tag) payload.tag = tag;
    sendHighlight(payload);
  });
}

function attachRegexBuilderHandlers() {
  const targetEl = document.getElementById("regexTarget");
  const matchEl = document.getElementById("regexMatch");
  const termsEl = document.getElementById("regexTerms");
  const escapeEl = document.getElementById("regexEscape");
  const wholeEl = document.getElementById("regexWhole");
  const ciEl = document.getElementById("regexCI");
  const outputEl = document.getElementById("regexOutput");
  const copyEl = document.getElementById("regexCopy");
  const warningsEl = document.getElementById("regexWarnings");
  const hintEl = document.getElementById("regexHint");
  if (!targetEl || !matchEl || !termsEl || !escapeEl || !wholeEl || !ciEl || !outputEl || !copyEl) return;

  const render = () => {
    const pattern = buildRe2Regex({
      target: targetEl.value,
      matchType: matchEl.value,
      terms: termsEl.value,
      escape: escapeEl.checked,
      wholeWord: wholeEl.checked,
      caseInsensitive: ciEl.checked
    });
    outputEl.textContent = pattern || "Enter at least one keyword.";
    const warns = pattern ? re2Warnings(pattern) : [];
    if (warns.length) {
      warningsEl.style.display = "block";
      warningsEl.innerHTML = `<b>Warnings</b><ul>${warns.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`;
    } else {
      warningsEl.style.display = "none";
      warningsEl.innerHTML = "";
    }
    hintEl.textContent = targetEl.value === "ga4"
      ? "GA4 regex is full-match; builder wraps contains/starts/ends for you."
      : "Search Console uses RE2; avoid lookarounds/backrefs. Contains works without anchors.";
    chrome.storage.local.set({
      "atlas:regex:target": targetEl.value,
      "atlas:regex:match": matchEl.value,
      "atlas:regex:escape": escapeEl.checked,
      "atlas:regex:whole": wholeEl.checked,
      "atlas:regex:ci": ciEl.checked,
      "atlas:regex:terms": termsEl.value
    });
  };

  const load = () => {
    chrome.storage.local.get(
      ["atlas:regex:target", "atlas:regex:match", "atlas:regex:escape", "atlas:regex:whole", "atlas:regex:ci", "atlas:regex:terms"],
      (res) => {
        if (res["atlas:regex:target"]) targetEl.value = res["atlas:regex:target"];
        if (res["atlas:regex:match"]) matchEl.value = res["atlas:regex:match"];
        if (typeof res["atlas:regex:escape"] === "boolean") escapeEl.checked = res["atlas:regex:escape"];
        if (typeof res["atlas:regex:whole"] === "boolean") wholeEl.checked = res["atlas:regex:whole"];
        if (typeof res["atlas:regex:ci"] === "boolean") ciEl.checked = res["atlas:regex:ci"];
        if (typeof res["atlas:regex:terms"] === "string") termsEl.value = res["atlas:regex:terms"];
        render();
      }
    );
  };

  ["input", "change", "keyup"].forEach((evt) => {
    targetEl.addEventListener(evt, render);
    matchEl.addEventListener(evt, render);
    termsEl.addEventListener(evt, render);
    escapeEl.addEventListener(evt, render);
    wholeEl.addEventListener(evt, render);
    ciEl.addEventListener(evt, render);
  });

  copyEl.addEventListener("click", async () => {
    const value = outputEl.textContent || "";
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value.trim());
      copyEl.textContent = "Copied!";
      setTimeout(() => {
        copyEl.textContent = "Copy Regex";
      }, 800);
    } catch (err) {
      warningsEl.style.display = "block";
      warningsEl.innerHTML = `<b>Clipboard blocked</b><div>${escapeHtml(err.message || "Unable to copy.")}</div>`;
    }
  });

  load();
}

function attachKeywordDensityHandler() {
  const input = document.getElementById("keywordDensityInput");
  const runBtn = document.getElementById("keywordDensityRun");
  const results = document.getElementById("keywordDensityResults");
  if (!input || !runBtn || !results) return;
  runBtn.addEventListener("click", async () => {
    const keywords = parseKeywordList(input.value);
    if (!keywords.length) {
      results.innerHTML = `<div class="empty">Enter at least one keyword.</div>`;
      return;
    }
    const tab = await getActiveTab();
    if (!tab || !isValidTabUrl(tab.url)) {
      results.innerHTML = `<div class="empty">Open a normal web page to analyze keyword density.</div>`;
      return;
    }
    const response = await sendMessage(tab.id, { type: "keywordDensity", keywords }).catch(() => null);
    if (!response || !response.ok) {
      results.innerHTML = `<div class="empty">Unable to calculate density on this page.</div>`;
      return;
    }
    const data = response.data || {};
    const rows = (data.keywords || []).map((row) => `
      <tr><td>${escapeHtml(row.keyword)}</td><td>${row.count}</td><td>${row.density}%</td></tr>
    `).join("");
    results.innerHTML = `
      <table class="table">
        <tr><th>Keyword</th><th>Count</th><th>Density</th></tr>
        ${rows || `<tr><td colspan="3">No matches.</td></tr>`}
      </table>
      <div class="footer-note">Topic depth: ${data.topicDepth ?? "-"} occurrences per 100 words. Total words: ${data.totalWords ?? "-"}</div>
    `;
  });
}

refreshBtn.addEventListener("click", refreshAudit);




exportAuditCsvBtn.addEventListener("click", exportAuditCsv);
if (toggleOverlayBtn) {
  toggleOverlayBtn.addEventListener("click", toggleOverlay);
}

initTheme();
initTabs();



function initTheme() {
  const toggleBtn = document.getElementById("themeToggle");
  const sunIcon = document.getElementById("sunIcon");
  const moonIcon = document.getElementById("moonIcon");
  const body = document.body;

  const savedTheme = localStorage.getItem("atlas:theme");
  if (savedTheme === "dark") {
    body.classList.add("dark");
    moonIcon.style.display = "none";
    sunIcon.style.display = "block";
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      body.classList.toggle("dark");
      const isDark = body.classList.contains("dark");
      localStorage.setItem("atlas:theme", isDark ? "dark" : "light");
      moonIcon.style.display = isDark ? "none" : "block";
      sunIcon.style.display = isDark ? "block" : "none";
    });
  }
}
initNavSearch();
initHighlighting();
initJumping();
refreshAudit();



function renderEmptyPanels() {
  const empty = `<div class="empty">Click Refresh Audit on a normal web page to load data.</div>`;
  Object.entries(panelMap).forEach(([key, panel]) => {
    if (key === "regex") return;
    panel.innerHTML = empty;
  });
  renderRegex();
}
