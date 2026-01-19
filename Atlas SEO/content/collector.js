(() => {
  "use strict";

  const perfMetrics = {
    lcp: null,
    cls: 0,
    fcp: null,
    inp: null,
    fid: null
  };

  const dynamicMap = new Map();
  const jsSnapshots = {
    initial: null,
    final: null,
    initialAt: null,
    finalAt: null
  };
  const robotsCache = {
    fetchedAt: 0,
    status: "unknown",
    error: "",
    groups: []
  };
  const dynamicNodes = new WeakSet();
  const htmlNodes = new WeakSet();
  let htmlNodesReady = false;
  let dynamicTrackingActive = false;
  const startMark = performance.now ? performance.now() : 0;
  const MAX_DYNAMIC_RECORDS = 600;

  function normalizeText(value, limit = 0) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (limit && text.length > limit) return text.slice(0, limit);
    return text;
  }

  function textFromElement(el) {
    if (!el) return "";
    const text = normalizeText(el.textContent || "");
    if (text) return text;
    const aria = normalizeText(el.getAttribute && el.getAttribute("aria-label"));
    if (aria) return aria;
    const title = normalizeText(el.getAttribute && el.getAttribute("title"));
    if (title) return title;
    return "";
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest("template, [hidden], [aria-hidden='true'], [inert]")) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function normalizeUrlForCompare(value) {
    try {
      const url = new URL(value, location.href);
      url.hash = "";
      let normalized = url.toString();
      if (normalized.endsWith("/") && url.pathname !== "/") {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch (err) {
      return value;
    }
  }

  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    const queue = [root];
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      try {
        results.push(...current.querySelectorAll(selector));
      } catch (err) {
        // ignore invalid selector in this root
      }
      const walker = document.createTreeWalker(current, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node && node.shadowRoot) {
          queue.push(node.shadowRoot);
        }
      }
    }
    return results;
  }

  function buildXPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const id = el.getAttribute && el.getAttribute("id");
    if (id) {
      if (!id.includes("\"")) return `//*[@id="${id}"]`;
      if (!id.includes("'")) return `//*[@id='${id}']`;
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === node.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}[${index}]`);
      node = node.parentElement;
    }
    parts.unshift("html[1]");
    return `/${parts.join("/")}`;
  }

  function initPerfObservers() {
    try {
      if ("PerformanceObserver" in window) {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            const last = entries[entries.length - 1];
            perfMetrics.lcp = Math.round(last.startTime);
          }
        });
        lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });

        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              perfMetrics.cls += entry.value;
            }
          }
          perfMetrics.cls = Math.round(perfMetrics.cls * 1000) / 1000;
        });
        clsObserver.observe({ type: "layout-shift", buffered: true });

        const fidObserver = new PerformanceObserver((list) => {
          const entry = list.getEntries()[0];
          if (entry) {
            perfMetrics.fid = Math.round(entry.processingStart - entry.startTime);
          }
        });
        fidObserver.observe({ type: "first-input", buffered: true });

        const inpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (!entries.length) return;
          const max = entries.reduce((acc, entry) => Math.max(acc, entry.duration), 0);
          perfMetrics.inp = Math.round(max);
        });
        inpObserver.observe({ type: "event", buffered: true, durationThreshold: 40 });

        const finalize = () => {
          if (lcpObserver) lcpObserver.disconnect();
          if (clsObserver) clsObserver.disconnect();
          if (fidObserver) fidObserver.disconnect();
          if (inpObserver) inpObserver.disconnect();
        };

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") finalize();
        });
        window.addEventListener("pagehide", finalize);
      }
    } catch (err) {
      // Ignore observer errors for older pages.
    }

    try {
      const paints = performance.getEntriesByType("paint");
      const fcpEntry = paints.find((entry) => entry.name === "first-contentful-paint");
      if (fcpEntry) {
        perfMetrics.fcp = Math.round(fcpEntry.startTime);
      }
    } catch (err) {
      // Ignore paint timing issues.
    }
  }

  function shouldCaptureNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const tag = node.tagName.toLowerCase();
    if (!["section", "article", "div", "header", "main", "aside", "footer", "h1", "h2", "h3", "h4", "p", "li"].includes(tag)) return false;
    return isElementVisible(node);
  }

  function classifySection(el) {
    if (!el || el.nodeType !== 1) return "body";
    const className = (el.className || "").toString().toLowerCase();
    if (el.closest("footer, [role='contentinfo']") || /footer/.test(className)) return "footer";
    if (el.closest("header, nav, [role='banner']") || /header|nav|topbar|masthead/.test(className)) return "header";
    if (el.closest("main, article, [role='main'], section")) return "body";
    return "body";
  }

  function buildSelectorPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) {
      try {
        return `#${CSS.escape(el.id)}`;
      } catch (err) {
        return `#${el.id}`;
      }
    }
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const index = siblings.indexOf(node) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      if (parent.id) {
        try {
          parts.unshift(`#${CSS.escape(parent.id)}`);
        } catch (err) {
          parts.unshift(`#${parent.id}`);
        }
        break;
      }
      node = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function markHtmlNodes() {
    if (htmlNodesReady) return;
    try {
      const base = document.documentElement || document;
      const nodes = querySelectorAllDeep("*", base);
      nodes.forEach((node) => {
        if (node && node.nodeType === 1) htmlNodes.add(node);
      });
      if (base && base.nodeType === 1) htmlNodes.add(base);
    } catch (err) {
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        htmlNodes.add(walker.currentNode);
      }
    }
    htmlNodesReady = true;
  }

  function isHtmlNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (!htmlNodesReady) return false;
    if (htmlNodes.has(node)) return true;
    let parent = node.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      if (htmlNodes.has(parent)) return true;
      parent = parent.parentElement;
      depth += 1;
    }
    return false;
  }

  function recordDynamicNode(node) {
    if (!dynamicTrackingActive) return;
    if (!shouldCaptureNode(node)) return;
    if (dynamicMap.size >= MAX_DYNAMIC_RECORDS) return;
    dynamicNodes.add(node);
    const text = normalizeText(node.textContent || "", 140);
    const selector = buildSelectorPath(node);
    const xpath = buildXPath(node);
    const key = `${selector}|${text}`;
    if (!key.trim() || !text) return;
    if (dynamicMap.has(key)) return;
    dynamicMap.set(key, {
      selector,
      xpath,
      tag: node.tagName.toLowerCase(),
      text,
      addedAt: performance.now ? Math.round(performance.now() - startMark) : null
    });
  }

  function initDynamicObserver() {
    try {
      const markDynamicNode = (node) => {
        if (!node || node.nodeType !== 1) return;
        if (!dynamicTrackingActive) return;
        dynamicNodes.add(node);
        let parent = node.parentElement;
        let depth = 0;
        while (parent && depth < 4) {
          dynamicNodes.add(parent);
          parent = parent.parentElement;
          depth += 1;
        }
      };
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === "characterData") {
            const parent = mutation.target && mutation.target.parentElement;
            if (parent) markDynamicNode(parent);
            return;
          }
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              markDynamicNode(node);
              recordDynamicNode(node);
              node.querySelectorAll && node.querySelectorAll("section,article,div,header,main,aside,footer,h1,h2,h3,h4,p,li").forEach((child) => recordDynamicNode(child));
            }
          });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch (err) {
      // ignore observer failures
    }

    const activateTracking = () => {
      markHtmlNodes();
      dynamicTrackingActive = true;
    };

    if (document.readyState === "interactive" || document.readyState === "complete") {
      activateTracking();
    } else {
      document.addEventListener("DOMContentLoaded", activateTracking, { once: true });
    }
  }

  function extractSchemaTypesFromRoot(root) {
    const types = new Set();
    const scripts = Array.from(root.querySelectorAll('script[type="application/ld+json"]'));
    scripts.forEach((script) => {
      try {
        const json = JSON.parse(script.textContent || "");
        const stack = Array.isArray(json) ? json : [json];
        stack.forEach((item) => {
          if (!item || typeof item !== "object") return;
          const nodes = [];
          walkSchema(item, nodes);
          nodes.forEach((node) => {
            const t = node["@type"];
            if (Array.isArray(t)) t.forEach((type) => types.add(normalizeType(type)));
            else if (t) types.add(normalizeType(t));
          });
        });
      } catch (err) {
        // Ignore invalid JSON-LD blocks.
      }
    });
    const microdata = Array.from(root.querySelectorAll("[itemscope][itemtype]"));
    microdata.forEach((el) => {
      const itemType = el.getAttribute("itemtype");
      if (itemType) types.add(normalizeType(itemType));
    });
    return Array.from(types);
  }

  function extractInternalLinksSnapshot(root, origin) {
    const links = [];
    const seen = new Set();
    const anchors = Array.from(root.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      if (!isElementVisible(anchor)) continue;
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      let url;
      try {
        url = new URL(href, location.href);
      } catch (err) {
        continue;
      }
      if (url.origin !== origin) continue;
      const text = textFromElement(anchor);
      const key = `${normalizeUrlForCompare(url.href)}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ href: url.href, text, selector: buildSelectorPath(anchor), xpath: buildXPath(anchor) });
      if (links.length >= 200) break;
    }
    return links;
  }

  function extractHeadingsSnapshot(root) {
    return Array.from(root.querySelectorAll("h1, h2, h3"))
      .filter((el) => isElementVisible(el))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: textFromElement(el),
        selector: buildSelectorPath(el),
        xpath: buildXPath(el)
      }))
      .filter((item) => item.text)
      .slice(0, 200);
  }

  function captureSectionSummary(root) {
    const summary = {
      header: { textLength: 0, headings: 0, links: 0 },
      body: { textLength: 0, headings: 0, links: 0 },
      footer: { textLength: 0, headings: 0, links: 0 }
    };

    const addText = (selector, key) => {
      const nodes = Array.from(root.querySelectorAll(selector));
      nodes.forEach((node) => {
        const text = normalizeText(node.innerText || "");
        if (text) summary[key].textLength += text.length;
      });
    };

    addText("header, nav, [role='banner']", "header");
    addText("footer, [role='contentinfo']", "footer");

    const mainNodes = Array.from(root.querySelectorAll("main, article, [role='main']"));
    if (mainNodes.length) {
      mainNodes.forEach((node) => {
        const text = normalizeText(node.innerText || "");
        if (text) summary.body.textLength += text.length;
      });
    } else if (root.body) {
      summary.body.textLength = normalizeText(root.body.innerText || "").length;
    }

    const headings = Array.from(root.querySelectorAll("h1, h2, h3")).filter((el) => isElementVisible(el));
    headings.forEach((el) => {
      const section = classifySection(el);
      if (summary[section]) summary[section].headings += 1;
    });

    const links = Array.from(root.querySelectorAll("a[href]")).filter((el) => isElementVisible(el));
    links.forEach((el) => {
      const href = el.getAttribute("href") || "";
      if (href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const section = classifySection(el);
      if (summary[section]) summary[section].links += 1;
    });

    return summary;
  }

  function textLengthFromRoot(root) {
    const bodyText = root.body ? root.body.innerText || "" : "";
    return bodyText.trim().length;
  }

  function mainTextLengthFromRoot(root) {
    const main = root.querySelector("main, article, [role='main']");
    if (!main) return 0;
    return (main.innerText || "").trim().length;
  }

  function captureJsSnapshot() {
    const headings = extractHeadingsSnapshot(document);
    const internalLinks = extractInternalLinksSnapshot(document, location.origin);
    const schemaTypes = extractSchemaTypesFromRoot(document);
    const sectionSummary = captureSectionSummary(document);
    const textLength = textLengthFromRoot(document);
    const mainTextLength = mainTextLengthFromRoot(document);
    const title = document.title || "";
    const metaDescription = getMetaContent("description");
    const metaRobots = getMetaContent("robots");
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? canonicalEl.getAttribute("href") || "" : "";
    return {
      headings,
      internalLinks,
      schemaTypes,
      sectionSummary,
      headingCount: headings.length,
      linkCount: internalLinks.length,
      schemaCount: schemaTypes.length,
      textLength,
      mainTextLength,
      title,
      metaDescription,
      metaRobots,
      canonical
    };
  }

  function initJsSnapshots() {
    const setInitial = () => {
      if (!jsSnapshots.initial) {
        jsSnapshots.initial = captureJsSnapshot();
        jsSnapshots.initialAt = Date.now();
      }
    };

    const setFinal = () => {
      if (jsSnapshots.final) return;
      jsSnapshots.final = captureJsSnapshot();
      jsSnapshots.finalAt = Date.now();
    };

    let observer = null;
    let quietTimer = null;
    let hardTimer = null;
    let lastMutationAt = null;
    const quietWindowMs = 900;
    const maxWaitMs = 8000;

    const stopWatching = () => {
      if (observer) observer.disconnect();
      observer = null;
      if (quietTimer) clearTimeout(quietTimer);
      if (hardTimer) clearTimeout(hardTimer);
    };

    const scheduleFinal = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (jsSnapshots.final) return;
        const now = Date.now();
        if (lastMutationAt && now - lastMutationAt < quietWindowMs) {
          scheduleFinal();
          return;
        }
        setFinal();
        stopWatching();
      }, quietWindowMs);
    };

    const startWatching = () => {
      if (observer) return;
      try {
        observer = new MutationObserver(() => {
          lastMutationAt = Date.now();
          scheduleFinal();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        hardTimer = setTimeout(() => {
          if (!jsSnapshots.final) setFinal();
          stopWatching();
        }, maxWaitMs);
      } catch (err) {
        // ignore observer failures
      }
    };

    if (document.readyState === "interactive" || document.readyState === "complete") {
      setInitial();
    } else {
      document.addEventListener("DOMContentLoaded", setInitial, { once: true });
    }

    const handleLoad = () => {
      startWatching();
      lastMutationAt = Date.now();
      scheduleFinal();
    };

    if (document.readyState === "complete") {
      handleLoad();
    } else {
      window.addEventListener("load", handleLoad, { once: true });
    }
  }

  function buildJsRenderDiff() {
    if (!jsSnapshots.initial) return null;
    const baseline = jsSnapshots.initial;
    const rendered = jsSnapshots.final || captureJsSnapshot();

    const headingKey = (item) => `${item.tag}:${normalizeText(item.text).toLowerCase()}`;
    const baselineHeadings = new Set(baseline.headings.map(headingKey));
    const addedHeadings = rendered.headings.filter((item) => !baselineHeadings.has(headingKey(item)));
    const removedHeadings = baseline.headings.filter((item) => !rendered.headings.some((other) => headingKey(other) === headingKey(item)));

    const linkKey = (item) => `${normalizeUrlForCompare(item.href)}|${normalizeText(item.text).toLowerCase()}`;
    const baselineLinks = new Set(baseline.internalLinks.map(linkKey));
    const addedLinks = rendered.internalLinks.filter((item) => !baselineLinks.has(linkKey(item)));
    const removedLinks = baseline.internalLinks.filter((item) => !rendered.internalLinks.some((other) => linkKey(other) === linkKey(item)));

    const baselineSchema = new Set(baseline.schemaTypes.map((t) => t.toLowerCase()));
    const addedSchemaTypes = rendered.schemaTypes.filter((t) => !baselineSchema.has(t.toLowerCase()));
    const removedSchemaTypes = baseline.schemaTypes.filter((t) => !rendered.schemaTypes.some((other) => other.toLowerCase() === t.toLowerCase()));

    const textAdded = Math.max(0, rendered.textLength - baseline.textLength);
    const mainTextAdded = Math.max(0, rendered.mainTextLength - baseline.mainTextLength);
    const jsTextShare = rendered.textLength ? Math.round((textAdded / rendered.textLength) * 100) : 0;
    const tagChanges = [];
    if (baseline.title !== rendered.title) tagChanges.push({ label: "Title", before: baseline.title, after: rendered.title });
    if (baseline.metaDescription !== rendered.metaDescription) tagChanges.push({ label: "Meta Description", before: baseline.metaDescription, after: rendered.metaDescription });
    if (baseline.canonical !== rendered.canonical) tagChanges.push({ label: "Canonical", before: baseline.canonical, after: rendered.canonical });
    if (baseline.metaRobots !== rendered.metaRobots) tagChanges.push({ label: "Meta Robots", before: baseline.metaRobots, after: rendered.metaRobots });

    const sectionSummary = {
      baseline: baseline.sectionSummary || {},
      rendered: rendered.sectionSummary || {}
    };

    return {
      baseline,
      rendered,
      added: {
        headings: addedHeadings.slice(0, 30),
        links: addedLinks.slice(0, 50),
        schemaTypes: addedSchemaTypes.slice(0, 20)
      },
      removed: {
        headings: removedHeadings.slice(0, 30),
        links: removedLinks.slice(0, 50),
        schemaTypes: removedSchemaTypes.slice(0, 20)
      },
      textAdded,
      mainTextAdded,
      jsTextShare,
      tagChanges,
      sectionSummary,
      baselineAt: jsSnapshots.initialAt,
      renderedAt: jsSnapshots.finalAt
    };
  }

  function getMetaContent(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute("content") || "" : "";
  }

  function getMetaProperty(property) {
    const el = document.querySelector(`meta[property="${property}"]`);
    return el ? el.getAttribute("content") || "" : "";
  }

  function normalizeType(type) {
    if (!type) return "";
    const value = String(type);
    if (value.includes("/")) return value.split("/").pop();
    if (value.includes("#")) return value.split("#").pop();
    return value;
  }

  function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function isValidUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (err) {
      return false;
    }
  }

  function extractSchemaNodes() {
    const nodes = [];
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent || "");
        walkSchema(json, nodes);
      } catch (err) {
        // Ignore invalid JSON-LD blocks.
      }
    }
    return nodes;
  }

  const MAX_SCHEMA_DEPTH = 20;

  function walkSchema(node, nodes, depth = 0) {
    if (!node) return;
    if (depth > MAX_SCHEMA_DEPTH) return; // Prevent stack overflow on malformed JSON
    if (Array.isArray(node)) {
      node.forEach((item) => walkSchema(item, nodes, depth + 1));
      return;
    }
    if (typeof node !== "object") return;

    if (node["@graph"]) {
      walkSchema(node["@graph"], nodes, depth + 1);
    }

    if (node["@type"]) {
      nodes.push(node);
    }

    Object.values(node).forEach((value) => {
      if (typeof value === "object") walkSchema(value, nodes, depth + 1);
    });
  }

  function hasPath(node, path) {
    const parts = path.split(".");
    const MAX_TRAVERSE_DEPTH = 15;
    const traverse = (value, idx, depth = 0) => {
      if (depth > MAX_TRAVERSE_DEPTH) return false; // Prevent infinite recursion
      if (idx >= parts.length) return true;
      if (!value) return false;
      const key = parts[idx];
      if (Array.isArray(value)) return value.some((entry) => traverse(entry, idx, depth + 1));
      if (typeof value !== "object") return false;
      return traverse(value[key], idx + 1, depth + 1);
    };
    return traverse(node, 0, 0);
  }

  function extractStructuredData() {
    const schemaNodes = extractSchemaNodes();
    const types = new Set();
    const issues = [];
    const warnings = [];
    const typeCounts = {};
    const ids = new Map();
    const required = {
      Article: ["headline", "datePublished", "author", "image"],
      BlogPosting: ["headline", "datePublished", "author", "image"],
      NewsArticle: ["headline", "datePublished", "author", "image"],
      Product: ["name", "image", "offers.price", "offers.priceCurrency"],
      Offer: ["price", "priceCurrency", "availability"],
      AggregateRating: ["ratingValue", "reviewCount"],
      FAQPage: ["mainEntity"],
      HowTo: ["name", "step"],
      Organization: ["name", "url", "logo"],
      LocalBusiness: ["name", "address", "telephone"],
      Person: ["name"],
      BreadcrumbList: ["itemListElement"],
      WebSite: ["name", "url", "potentialAction"]
    };

    let hasContext = false;
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    scripts.forEach((script) => {
      try {
        const json = JSON.parse(script.textContent || "");
        const stack = Array.isArray(json) ? json : [json];
        stack.forEach((item) => {
          if (!item || typeof item !== "object") return;
          if (item["@context"]) hasContext = true;
          if (item["@graph"]) {
            item["@graph"].forEach((node) => {
              if (node && node["@context"]) hasContext = true;
            });
          }
        });
      } catch (err) {
        // Ignore invalid JSON-LD blocks.
      }
    });

    for (const node of schemaNodes) {
      const nodeTypes = toArray(node["@type"]).map(normalizeType).filter(Boolean);
      nodeTypes.forEach((type) => types.add(type));
      nodeTypes.forEach((type) => {
        typeCounts[type] = (typeCounts[type] || 0) + 1;
      });

      if (node["@id"]) {
        const id = String(node["@id"]);
        ids.set(id, (ids.get(id) || 0) + 1);
        if (!isValidUrl(id)) {
          warnings.push(`Invalid @id URL: ${id}`);
        }
      }
      if (node.url && !isValidUrl(node.url)) {
        warnings.push(`Invalid url field: ${node.url}`);
      }

      nodeTypes.forEach((type) => {
        const requiredFields = required[type];
        if (!requiredFields) return;
        const missing = requiredFields.filter((field) => !hasPath(node, field));
        if (missing.length) {
          issues.push(`${type} missing: ${missing.join(", ")}`);
        }
      });

      if (nodeTypes.includes("BreadcrumbList") && node.itemListElement) {
        const elements = Array.isArray(node.itemListElement) ? node.itemListElement : [node.itemListElement];
        const missingPositions = elements.filter((item) => !item || typeof item !== "object" || item.position === undefined);
        if (missingPositions.length) {
          issues.push("BreadcrumbList missing itemListElement.position");
        }
      }

      if (nodeTypes.includes("WebSite") && node.potentialAction) {
        if (!hasPath(node, "potentialAction.target") || !hasPath(node, "potentialAction.query-input")) {
          warnings.push("WebSite potentialAction missing target or query-input");
        }
      }
    }

    const microdataNodes = Array.from(document.querySelectorAll("[itemscope][itemtype]"));
    microdataNodes.forEach((el) => {
      const itemType = el.getAttribute("itemtype") || "";
      const normalized = normalizeType(itemType);
      if (normalized) types.add(normalized);
    });

    if (!hasContext && schemaNodes.length) {
      issues.push("Schema missing @context");
    }
    for (const [id, count] of ids.entries()) {
      if (count > 1) warnings.push(`Duplicate @id: ${id}`);
    }

    return {
      items: schemaNodes,
      types: Array.from(types),
      issues,
      warnings,
      typeCounts,
      itemsCount: schemaNodes.length
    };
  }

  function detectTech() {
    const add = (set, value) => {
      if (value) set.add(value);
    };
    const cms = new Set();
    const frameworks = new Set();
    const analytics = new Set();
    const ecommerce = new Set();
    const tagManagers = new Set();
    const cdn = new Set();
    const misc = new Set();

    const scripts = Array.from(document.querySelectorAll("script[src]"));
    const scriptSrcs = scripts.map((script) => (script.getAttribute("src") || "").toLowerCase());
    const linkHrefs = Array.from(document.querySelectorAll("link[href]")).map((link) => (link.getAttribute("href") || "").toLowerCase());
    const metaContents = Array.from(document.querySelectorAll("meta[name], meta[property]")).map((meta) => (meta.getAttribute("content") || "").toLowerCase());
    const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"))
      .slice(0, 40)
      .map((script) => (script.textContent || "").slice(0, 1200).toLowerCase());
    const sourceList = scriptSrcs.concat(linkHrefs, metaContents);

    const includesAny = (list, needles) => needles.some((needle) => list.some((item) => item.includes(needle)));
    const sourceHas = (needles) => includesAny(sourceList, needles);
    const scriptHas = (needles) => includesAny(scriptSrcs, needles);
    const linkHas = (needles) => includesAny(linkHrefs, needles);
    const metaHas = (needles) => includesAny(metaContents, needles);
    const inlineHas = (needles) => includesAny(inlineScripts, needles);
    const domHas = (selector) => {
      try {
        return !!document.querySelector(selector);
      } catch (err) {
        return false;
      }
    };

    const generator = getMetaContent("generator");
    if (generator) {
      const lower = generator.toLowerCase();
      if (lower.includes("wordpress")) add(cms, "WordPress");
      if (lower.includes("shopify")) add(cms, "Shopify");
      if (lower.includes("wix")) add(cms, "Wix");
      if (lower.includes("squarespace")) add(cms, "Squarespace");
      if (lower.includes("webflow")) add(cms, "Webflow");
      if (lower.includes("drupal")) add(cms, "Drupal");
      if (lower.includes("joomla")) add(cms, "Joomla");
      if (lower.includes("ghost")) add(cms, "Ghost");
      if (lower.includes("magento")) add(ecommerce, "Magento");
      if (lower.includes("prestashop")) add(ecommerce, "PrestaShop");
      if (lower.includes("woocommerce")) add(ecommerce, "WooCommerce");
      add(misc, generator);
    }

    if (sourceHas(["wp-content", "wp-includes", "wp-json"])) add(cms, "WordPress");
    if (domHas('link[rel="https://api.w.org/"]')) add(cms, "WordPress");
    if (sourceHas(["cdn.shopify", "shopifycloud", "myshopify"])) {
      add(cms, "Shopify");
      add(ecommerce, "Shopify");
    }
    if (sourceHas(["wixstatic", "wix-code", "wixsite"])) add(cms, "Wix");
    if (sourceHas(["squarespace"])) add(cms, "Squarespace");
    if (domHas("[data-wf-page], [data-wf-site]") || sourceHas(["webflow.js", "webflow"])) add(cms, "Webflow");
    if (sourceHas(["drupal"])) add(cms, "Drupal");
    if (sourceHas(["joomla"])) add(cms, "Joomla");
    if (sourceHas(["ghost.org", "/ghost/"])) add(cms, "Ghost");

    if (sourceHas(["woocommerce"])) add(ecommerce, "WooCommerce");
    if (sourceHas(["magento"])) add(ecommerce, "Magento");
    if (sourceHas(["prestashop"])) add(ecommerce, "PrestaShop");
    if (sourceHas(["bigcommerce"])) add(ecommerce, "BigCommerce");
    if (sourceHas(["ecwid"])) add(ecommerce, "Ecwid");
    if (sourceHas(["opencart"])) add(ecommerce, "OpenCart");

    if (sourceHas(["gtag/js", "google-analytics.com", "analytics.js"]) || inlineHas(["gtag('config'", "ga('create'"])) {
      add(analytics, "Google Analytics");
    }
    if (sourceHas(["googletagmanager.com/gtm.js"]) || domHas('noscript iframe[src*="googletagmanager.com"]') || inlineHas(["dataLayer.push", "gtm.start"])) {
      add(tagManagers, "Google Tag Manager");
    }
    if (sourceHas(["tags.tiqcdn.com/utag", "tealium"])) add(tagManagers, "Tealium");
    if (sourceHas(["assets.adobedtm.com", "satelliteLib"])) add(tagManagers, "Adobe Launch");
    if (sourceHas(["ensighten.com"])) add(tagManagers, "Ensighten");
    if (sourceHas(["clarity.ms"])) add(analytics, "Microsoft Clarity");
    if (sourceHas(["hotjar"])) add(analytics, "Hotjar");
    if (sourceHas(["segment.com", "segment.io"])) add(analytics, "Segment");
    if (sourceHas(["mixpanel"])) add(analytics, "Mixpanel");
    if (sourceHas(["plausible.io"])) add(analytics, "Plausible");
    if (sourceHas(["matomo", "piwik"])) add(analytics, "Matomo");
    if (sourceHas(["fullstory"])) add(analytics, "FullStory");
    if (sourceHas(["amplitude"])) add(analytics, "Amplitude");
    if (sourceHas(["heap"])) add(analytics, "Heap");
    if (sourceHas(["fbevents.js", "fbq"])) add(analytics, "Facebook Pixel");
    if (sourceHas(["linkedin.com/insight", "licdn.com/analytics"])) add(analytics, "LinkedIn Insight");
    if (sourceHas(["tiktok.com/pixel", "tiktok.com/analytics"])) add(analytics, "TikTok Pixel");
    if (sourceHas(["snap.licdn.com"])) add(analytics, "LinkedIn Insight");
    if (sourceHas(["analytics.twitter.com", "static.ads-twitter.com"])) add(analytics, "Twitter Pixel");
    if (sourceHas(["ct.pinterest.com"])) add(analytics, "Pinterest Tag");

    if (sourceHas(["intercom"])) add(misc, "Intercom");
    if (sourceHas(["hubspot", "hs-scripts", "hs-analytics"])) add(misc, "HubSpot");
    if (sourceHas(["zendesk"])) add(misc, "Zendesk");
    if (sourceHas(["firebase"])) add(misc, "Firebase");

    if (domHas("#__next") || domHas('script[id="__NEXT_DATA__"]') || sourceHas(["/_next/"])) add(frameworks, "Next.js");
    if (domHas("#__nuxt") || inlineHas(["__nuxt__"]) || sourceHas(["/_nuxt/"])) add(frameworks, "Nuxt.js");
    if (domHas("[ng-version]") || sourceHas(["angular.js", "angular.min.js", "@angular"])) add(frameworks, "Angular");
    if (domHas("[data-reactroot], [data-reactid]") || inlineHas(["reactdom.render", "react.createelement"]) || sourceHas(["react-dom", "react.production", "react.development"])) {
      add(frameworks, "React");
    }
    if (domHas("[data-v-app], [data-vue-meta]") || inlineHas(["new vue", "__vue__"]) || sourceHas(["vue.runtime", "vue.global", "vue.min.js"])) {
      add(frameworks, "Vue");
    }
    if (domHas("[data-svelte-h], [data-svelte]")) add(frameworks, "Svelte");
    if (domHas("astro-island")) add(frameworks, "Astro");
    if (domHas("[data-gatsby-image-wrapper]") || sourceHas(["/gatsby/", "gatsby-browser"])) add(frameworks, "Gatsby");

    if (sourceHas(["cloudflare", "cloudflareinsights"])) add(cdn, "Cloudflare");
    if (sourceHas(["cloudfront.net"])) add(cdn, "CloudFront");
    if (sourceHas(["fastly", "fastly.net"])) add(cdn, "Fastly");
    if (sourceHas(["akamai", "akamaized.net"])) add(cdn, "Akamai");
    if (sourceHas(["cdn.jsdelivr"])) add(cdn, "jsDelivr");
    if (sourceHas(["cdnjs.cloudflare"])) add(cdn, "cdnjs");
    if (sourceHas(["unpkg.com"])) add(cdn, "unpkg");

    const all = new Set([...cms, ...frameworks, ...analytics, ...ecommerce, ...tagManagers, ...cdn, ...misc]);
    return {
      all: Array.from(all),
      cms: Array.from(cms),
      frameworks: Array.from(frameworks),
      analytics: Array.from(analytics),
      ecommerce: Array.from(ecommerce),
      tagManagers: Array.from(tagManagers),
      cdn: Array.from(cdn),
      misc: Array.from(misc)
    };
  }

  function parseRobotsTxt(text) {
    const groups = [];
    let current = { agents: [], rules: [] };
    const lines = String(text || "").split(/\r?\n/);
    const flush = () => {
      if (current.agents.length || current.rules.length) {
        groups.push(current);
        current = { agents: [], rules: [] };
      }
    };

    lines.forEach((line) => {
      const cleaned = line.split("#")[0].trim();
      if (!cleaned) {
        if (current.rules.length) flush();
        return;
      }
      const [rawKey, ...rest] = cleaned.split(":");
      if (!rawKey || !rest.length) return;
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        if (current.rules.length) flush();
        if (value) current.agents.push(value.toLowerCase());
        return;
      }
      if (key === "allow" || key === "disallow") {
        current.rules.push({ type: key, value });
      }
    });

    flush();
    return groups;
  }

  function pickRobotsGroup(groups, userAgent) {
    const ua = (userAgent || "").toLowerCase();
    let bestGroup = null;
    let bestLen = -1;
    groups.forEach((group) => {
      group.agents.forEach((agent) => {
        if (!agent) return;
        if (agent === "*") {
          if (bestLen < 1) {
            bestLen = 1;
            bestGroup = group;
          }
          return;
        }
        if (ua.includes(agent) && agent.length > bestLen) {
          bestLen = agent.length;
          bestGroup = group;
        }
      });
    });
    return bestGroup;
  }

  function matchRobotsRule(rules, path) {
    let winner = null;
    rules.forEach((rule) => {
      const value = rule.value || "";
      if (!value) return;
      try {
        let pattern = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        pattern = pattern.replace(/\*/g, ".*");
        if (pattern.endsWith("\\$")) {
          pattern = `${pattern.slice(0, -2)}$`;
        }
        // Limit pattern length to prevent ReDoS
        if (pattern.length > 500) return;
        const regex = new RegExp(`^${pattern}`);
        if (!regex.test(path)) return;
        if (!winner || value.length > winner.value.length || (value.length === winner.value.length && rule.type === "allow")) {
          winner = rule;
        }
      } catch (err) {
        // Skip malformed regex patterns
        console.warn("[Atlas] Skipping malformed robots.txt pattern:", value);
      }
    });
    return winner;
  }

  function evaluateRobots(groups, userAgent, path) {
    if (!groups || !groups.length) return { allowed: true, rule: null, group: null };
    const group = pickRobotsGroup(groups, userAgent) || pickRobotsGroup(groups, "*");
    if (!group || !group.rules.length) return { allowed: true, rule: null, group };
    const rule = matchRobotsRule(group.rules, path);
    if (!rule) return { allowed: true, rule: null, group };
    return { allowed: rule.type !== "disallow", rule, group };
  }

  async function getRobotsInfo() {
    const now = Date.now();
    if (robotsCache.fetchedAt && now - robotsCache.fetchedAt < 10 * 60 * 1000) {
      return robotsCache;
    }
    robotsCache.fetchedAt = now;
    robotsCache.status = "unknown";
    robotsCache.error = "";
    try {
      // Add timeout to fetch request (3 seconds max)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${location.origin}/robots.txt`, {
        credentials: "omit",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).slice(0, 200000);
      robotsCache.groups = parseRobotsTxt(text);
      robotsCache.status = "ok";
    } catch (err) {
      robotsCache.groups = [];
      robotsCache.status = "error";
      robotsCache.error = err?.message || String(err);
    }
    return robotsCache;
  }

  function parseRobotsMeta(content) {
    const directives = (content || "")
      .split(/,|;/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const flags = {
      noindex: directives.includes("noindex"),
      nofollow: directives.includes("nofollow"),
      noai: directives.includes("noai"),
      noimageai: directives.includes("noimageai"),
      nosnippet: directives.includes("nosnippet"),
      maxSnippet0: directives.some((item) => item.startsWith("max-snippet") && item.includes(":0"))
    };
    return { directives, flags };
  }

  function buildAiVisibility(jsRender, robotsInfo) {
    const robotsMeta = getMetaContent("robots");
    const googlebotMeta = getMetaContent("googlebot");
    const bingbotMeta = getMetaContent("bingbot");
    const metaInfo = parseRobotsMeta(robotsMeta);
    const googlebotInfo = parseRobotsMeta(googlebotMeta);
    const bingbotInfo = parseRobotsMeta(bingbotMeta);
    const mergedFlags = {
      noindex: metaInfo.flags.noindex || googlebotInfo.flags.noindex || bingbotInfo.flags.noindex,
      nofollow: metaInfo.flags.nofollow || googlebotInfo.flags.nofollow || bingbotInfo.flags.nofollow,
      noai: metaInfo.flags.noai || googlebotInfo.flags.noai || bingbotInfo.flags.noai,
      noimageai: metaInfo.flags.noimageai || googlebotInfo.flags.noimageai || bingbotInfo.flags.noimageai,
      nosnippet: metaInfo.flags.nosnippet || googlebotInfo.flags.nosnippet || bingbotInfo.flags.nosnippet,
      maxSnippet0: metaInfo.flags.maxSnippet0 || googlebotInfo.flags.maxSnippet0 || bingbotInfo.flags.maxSnippet0
    };
    const path = `${location.pathname}${location.search || ""}`;
    const groups = robotsInfo && robotsInfo.groups ? robotsInfo.groups : [];
    const agents = [
      { name: "ChatGPT (GPTBot)", userAgent: "GPTBot" },
      { name: "ChatGPT (ChatGPT-User)", userAgent: "ChatGPT-User" },
      { name: "Perplexity (PerplexityBot)", userAgent: "PerplexityBot" },
      { name: "Perplexity (Perplexity-User)", userAgent: "Perplexity-User" },
      { name: "Gemini (Google-Extended)", userAgent: "Google-Extended" }
    ];
    const agentVisibility = agents.map((agent) => {
      const result = evaluateRobots(groups, agent.userAgent, path);
      const blockedByMeta = mergedFlags.noai;
      const blockedByRobots = !result.allowed;
      const allowed = !blockedByMeta && !blockedByRobots;
      const reasons = [];
      if (blockedByRobots) reasons.push("Robots.txt");
      if (blockedByMeta) reasons.push("Meta noai");
      return {
        name: agent.name,
        userAgent: agent.userAgent,
        allowed,
        rule: result.rule ? `${result.rule.type.toUpperCase()}: ${result.rule.value || "/"}` : "No rule match",
        blockedByMeta,
        blockedByRobots,
        reasons
      };
    });

    const computeSectionVisibility = (sectionData) => {
      const htmlSignal = sectionData.htmlText > 0
        || sectionData.htmlHeadings > 0
        || sectionData.htmlLinks > 0;
      const jsSignal = sectionData.jsTextAdded > 0
        || sectionData.jsHeadingsAdded > 0
        || sectionData.jsLinksAdded > 0;
      let visibility = "Low content";
      if (htmlSignal) visibility = "Visible (HTML)";
      else if (jsSignal) visibility = "JS-only";
      return {
        ...sectionData,
        htmlSignal,
        jsSignal,
        visibility
      };
    };

    const sections = ["header", "body", "footer"].map((section) => {
      const baseline = jsRender?.sectionSummary?.baseline?.[section] || { textLength: 0, headings: 0, links: 0 };
      const rendered = jsRender?.sectionSummary?.rendered?.[section] || baseline;
      return computeSectionVisibility({
        section,
        htmlText: baseline.textLength,
        jsTextAdded: Math.max(0, rendered.textLength - baseline.textLength),
        htmlHeadings: baseline.headings,
        jsHeadingsAdded: Math.max(0, rendered.headings - baseline.headings),
        htmlLinks: baseline.links,
        jsLinksAdded: Math.max(0, rendered.links - baseline.links)
      });
    });

    return {
      robots: {
        status: robotsInfo?.status || "unknown",
        error: robotsInfo?.error || ""
      },
      meta: {
        robots: robotsMeta,
        googlebot: googlebotMeta,
        bingbot: bingbotMeta,
        flags: mergedFlags
      },
      agents: agentVisibility,
      sections,
      jsTextShare: jsRender ? jsRender.jsTextShare : null
    };
  }

  function analyzeLinks() {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const origin = location.origin;
    let internal = 0;
    let external = 0;
    let nofollow = 0;
    let ugc = 0;
    let sponsored = 0;
    const internalSamples = [];
    const internalLinks = [];
    const sampleSet = new Set();
    const linkSet = new Set();

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      let url;
      try {
        url = new URL(href, location.href);
      } catch (err) {
        continue;
      }

      if (url.origin === origin) {
        internal += 1;
        const sampleKey = normalizeUrlForCompare(url.href);
        if (!sampleSet.has(sampleKey) && internalSamples.length < 40) {
          sampleSet.add(sampleKey);
          internalSamples.push(url.href);
        }
        if (internalLinks.length < 200) {
          const text = textFromElement(link);
          const section = classifySection(link);
          const selector = buildSelectorPath(link);
          const xpath = buildXPath(link);
          const key = `${normalizeUrlForCompare(url.href)}|${text.toLowerCase()}`;
          if (!linkSet.has(key)) {
            linkSet.add(key);
            internalLinks.push({
              href: url.href,
              text,
              section,
              selector,
              xpath,
              visible: isElementVisible(link)
            });
          }
        }
      } else {
        external += 1;
      }

      const rel = (link.getAttribute("rel") || "").toLowerCase();
      if (rel.includes("nofollow")) nofollow += 1;
      if (rel.includes("ugc")) ugc += 1;
      if (rel.includes("sponsored")) sponsored += 1;
    }

    return {
      total: links.length,
      internal,
      external,
      nofollow,
      ugc,
      sponsored,
      internalSamples,
      internalLinks
    };
  }

  function analyzeHeadings() {
    const counts = {};
    for (let i = 1; i <= 6; i += 1) {
      counts[`h${i}`] = document.querySelectorAll(`h${i}`).length;
    }
    return counts;
  }

  function analyzeImages() {
    const imgs = Array.from(document.querySelectorAll("img"));
    let missingAlt = 0;
    let shortAlt = 0;
    let missingSize = 0;
    let largeImages = 0;
    let genericFilename = 0;
    const formatCounts = {};
    const genericNames = /^(img|image|photo|pic|dsc|untitled|placeholder)[-_]?\d*/i;
    const samples = [];
    const resources = performance.getEntriesByType("resource");
    const resourceMap = new Map();
    for (const res of resources) {
      if (res.initiatorType === "img" && res.name) {
        resourceMap.set(res.name, res);
      }
    }

    let totalBytes = 0;
    let maxBytes = 0;
    let maxBytesSrc = "";
    let maxWidth = 0;
    let maxHeight = 0;
    let maxDimSrc = "";

    const normalizeFormat = (format) => {
      if (!format) return "unknown";
      const value = format.toLowerCase();
      if (value === "jpg") return "jpeg";
      if (value.includes("svg")) return "svg";
      if (value.includes("jpeg")) return "jpeg";
      if (value.includes("webp")) return "webp";
      if (value.includes("avif")) return "avif";
      if (value.includes("png")) return "png";
      if (value.includes("gif")) return "gif";
      if (value.includes("bmp")) return "bmp";
      if (value.includes("ico")) return "ico";
      if (value.includes("tiff")) return "tiff";
      return value;
    };

    const detectFormat = (value) => {
      if (!value) return "unknown";
      if (value.startsWith("data:")) {
        const end = value.indexOf(";") > -1 ? value.indexOf(";") : value.indexOf(",");
        const mime = value.slice(5, end > -1 ? end : undefined);
        const type = mime.split("/")[1] || "";
        return normalizeFormat(type);
      }
      let path = value;
      try {
        const url = new URL(value, location.href);
        path = url.pathname;
      } catch (err) {
        path = value;
      }
      const clean = path.split("?")[0].split("#")[0];
      const parts = clean.split(".");
      if (parts.length < 2) return "unknown";
      return normalizeFormat(parts.pop());
    };


    for (const img of imgs) {
      const alt = img.getAttribute("alt");
      if (!alt || !alt.trim()) {
        missingAlt += 1;
      } else if (alt.trim().length < 5) {
        shortAlt += 1;
      }

      const hasWidth = img.getAttribute("width");
      const hasHeight = img.getAttribute("height");
      if (!hasWidth || !hasHeight) missingSize += 1;

      const src = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
      const currentSrc = img.currentSrc || src;
      const format = detectFormat(currentSrc || src);
      formatCounts[format] = (formatCounts[format] || 0) + 1;
      let resolved = "";
      try {
        const url = new URL(currentSrc || src, location.href);
        resolved = url.toString();
        const filename = url.pathname.split("/").pop() || "";
        const base = filename.split(".")[0] || "";
        if (genericNames.test(base)) genericFilename += 1;
      } catch (err) {
        resolved = currentSrc || src;
      }

      const width = img.naturalWidth || parseInt(img.getAttribute("width"), 10) || 0;
      const height = img.naturalHeight || parseInt(img.getAttribute("height"), 10) || 0;
      if (width >= 2000 || height >= 2000) {
        largeImages += 1;
      }
      let size = 0;
      const resKey = resourceMap.has(resolved) ? resolved : (currentSrc && resourceMap.has(currentSrc) ? currentSrc : "");
      if (resKey && resourceMap.has(resKey)) {
        const res = resourceMap.get(resKey);
        size = res.transferSize || res.encodedBodySize || res.decodedBodySize || 0;
      }
      totalBytes += size;
      if (size > maxBytes) {
        maxBytes = size;
        maxBytesSrc = resolved;
      }
      if (width * height > maxWidth * maxHeight) {
        maxWidth = width;
        maxHeight = height;
        maxDimSrc = resolved;
      }

      if (samples.length < 80) {
        samples.push({
          src: resolved,
          format,
          width,
          height,
          size,
          section: classifySection(img),
          selector: buildSelectorPath(img),
          xpath: buildXPath(img),
          alt: alt || ""
        });
      }
    }
    return {
      total: imgs.length,
      missingAlt,
      shortAlt,
      missingSize,
      largeImages,
      genericFilename,
      samples,
      totalBytes,
      maxBytes,
      maxBytesSrc,
      maxDimensions: { width: maxWidth, height: maxHeight, src: maxDimSrc },
      formatCounts
    };
  }

  function extractEntities(text, limit = 20) {
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

  function tokenizeWords(text) {
    return (text || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  }

  function countSyllables(word) {
    let w = (word || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    w = w.replace(/e$/i, "");
    const groups = w.match(/[aeiouy]+/g);
    return groups ? groups.length : 1;
  }

  function calculateReadability(text) {
    const sentences = (text || "").split(/[.!?]+/).filter((s) => s.trim().length);
    const words = tokenizeWords(text);
    const wordCount = words.length;
    const sentenceCount = sentences.length || 1;
    let syllables = 0;
    let polysyllables = 0;
    words.forEach((word) => {
      const count = countSyllables(word);
      syllables += count;
      if (count >= 3) polysyllables += 1;
    });
    const wordsPerSentence = wordCount / sentenceCount;
    const syllablesPerWord = wordCount ? syllables / wordCount : 0;
    const fleschReadingEase = 206.835 - (1.015 * wordsPerSentence) - (84.6 * syllablesPerWord);
    const fleschKincaidGrade = (0.39 * wordsPerSentence) + (11.8 * syllablesPerWord) - 15.59;
    const smogIndex = sentenceCount > 0
      ? 1.043 * Math.sqrt((polysyllables * 30) / sentenceCount) + 3.1291
      : 0;
    return {
      fleschReadingEase: Math.round(fleschReadingEase * 10) / 10,
      fleschKincaidGrade: Math.round(fleschKincaidGrade * 10) / 10,
      smogIndex: Math.round(smogIndex * 10) / 10,
      wordCount,
      sentenceCount,
      syllables,
      polysyllables,
      avgSentenceLength: Math.round(wordsPerSentence * 10) / 10,
      avgSyllablesPerWord: Math.round(syllablesPerWord * 100) / 100
    };
  }

  function escapeRegexLiteral(value) {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }

  function computeKeywordDensity(text, keywords) {
    const words = tokenizeWords(text);
    const totalWords = words.length;
    const results = [];
    let totalOccurrences = 0;
    (keywords || []).forEach((keyword) => {
      const clean = (keyword || "").trim();
      if (!clean) return;
      const escaped = escapeRegexLiteral(clean).replace(/\\s+/g, "\\s+");
      const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
      const matches = text.match(pattern);
      const count = matches ? matches.length : 0;
      totalOccurrences += count;
      results.push({
        keyword: clean,
        count,
        density: totalWords ? Math.round((count / totalWords) * 10000) / 100 : 0
      });
    });
    const topicDepth = totalWords ? Math.round((totalOccurrences / totalWords) * 1000) / 10 : 0;
    return { totalWords, topicDepth, keywords: results };
  }

  function extractHeadingText() {
    const map = { h1: [], h2: [], h3: [], order: [] };
    ["h1", "h2", "h3"].forEach((tag) => {
      map[tag] = Array.from(document.querySelectorAll(tag))
        .map((el) => textFromElement(el))
        .filter(Boolean);
    });
    const ordered = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: textFromElement(el),
        selector: buildSelectorPath(el),
        xpath: buildXPath(el)
      }))
      .filter((item) => item.text);
    map.order = ordered;
    return map;
  }


  function analyzePage(robotsInfo = null) {
    const title = document.title || "";
    const metaDescription = getMetaContent("description");
    const metaRobots = getMetaContent("robots");
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? canonicalEl.getAttribute("href") || "" : "";
    const viewport = getMetaContent("viewport");
    const language = document.documentElement.getAttribute("lang") || "";
    const og = {
      title: getMetaProperty("og:title"),
      description: getMetaProperty("og:description"),
      url: getMetaProperty("og:url"),
      type: getMetaProperty("og:type"),
      image: getMetaProperty("og:image")
    };
    const twitter = {
      card: getMetaContent("twitter:card"),
      title: getMetaContent("twitter:title"),
      description: getMetaContent("twitter:description"),
      image: getMetaContent("twitter:image")
    };

    const headings = analyzeHeadings();
    const links = analyzeLinks();
    const images = analyzeImages();

    const bodyText = document.body ? document.body.innerText || "" : "";
    const wordCount = tokenizeWords(bodyText).length;
    const htmlSize = document.documentElement.outerHTML.length;
    const textRatio = htmlSize ? Math.round((bodyText.length / htmlSize) * 1000) / 1000 : 0;

    const hreflang = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map((el) => ({
      lang: el.getAttribute("hreflang") || "",
      href: el.getAttribute("href") || ""
    }));

    const structuredData = extractStructuredData();

    const navEntry = performance.getEntriesByType("navigation")[0];
    const perf = {
      ttfb: navEntry ? Math.round(navEntry.responseStart) : null,
      ttfbMs: navEntry ? Math.round(navEntry.responseStart - navEntry.requestStart) : null,
      domContentLoaded: navEntry ? Math.round(navEntry.domContentLoadedEventEnd) : null,
      load: navEntry ? Math.round(navEntry.loadEventEnd) : null,
      fcp: perfMetrics.fcp,
      lcp: perfMetrics.lcp,
      cls: perfMetrics.cls,
      fid: perfMetrics.fid,
      inp: perfMetrics.inp
    };

    const headingText = extractHeadingText();
    const entities = extractEntities(bodyText, 20);
    const readability = calculateReadability(bodyText);

    const techDetected = detectTech();
    const dynamicItems = Array.from(dynamicMap.values()).slice(0, 40);
    const jsRender = buildJsRenderDiff();
    const aiVisibility = buildAiVisibility(jsRender, robotsInfo);
    return {

      url: location.href,
      origin: location.origin,
      title,
      metaDescription,
      metaRobots,
      canonical,
      viewport,
      language,
      og,
      twitter,
      headings,
      headingText,
      links,
      images,
      wordCount,
      textRatio,
      hreflang,
      structuredData,
      entities,
      tech: techDetected.all,
      techCategories: techDetected,
      performance: perf,
      dynamic: {
        count: dynamicMap.size,
        items: dynamicItems
      },
      jsRender,
      aiVisibility,
      contentQuality: {
        readability
      },
      fullContent: bodyText
    };
  }

  function isGoogleSerp() {
    const host = location.hostname;
    const isGoogle = host.includes("google.");
    const params = new URLSearchParams(location.search);
    return isGoogle && location.pathname.includes("/search") && params.has("q");
  }

  function parseSerp() {
    if (!isGoogleSerp()) {
      return { isSerp: false, results: [] };
    }
    const results = [];
    const seen = new Set();

    const items = Array.from(document.querySelectorAll("a h3"));
    for (const h3 of items) {
      const anchor = h3.closest("a");
      if (!anchor) continue;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("http")) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({
        title: h3.textContent || "",
        url: href
      });
      if (results.length >= 10) break;
    }

    return {
      isSerp: true,
      results
    };
  }

  initPerfObservers();
  initDynamicObserver();
  initJsSnapshots();

  function selectElementsForMessage(message) {
    if (message.xpath) {
      const found = findByXPath(message.xpath);
      const visible = found.filter((el) => isElementVisible(el));
      if (visible.length || found.length) return visible.length ? visible : found;
    }
    if (message.selector) {
      const found = querySelectorAllDeep(message.selector);
      const visible = found.filter((el) => isElementVisible(el));
      return visible.length ? visible : found;
    }
    if (message.href) {
      const target = findLinkByHrefOrText(message.href, message.text || "");
      return target ? [target] : [];
    }
    if (message.src) {
      const img = findImageBySrc(message.src);
      return img ? [img] : [];
    }
    if (message.tag && message.text) {
      const normalizedTarget = normalizeText(message.text).toLowerCase();
      if (!normalizedTarget) return [];
      const candidates = querySelectorAllDeep(message.tag);
      const ranked = candidates.map((el) => {
        const content = normalizeText(textFromElement(el)).toLowerCase();
        if (!content) return null;
        let score = 0;
        if (content === normalizedTarget) score = 3;
        else if (content.startsWith(normalizedTarget) || normalizedTarget.startsWith(content)) score = 2;
        else if (content.includes(normalizedTarget) || normalizedTarget.includes(content)) score = 1;
        if (!score) return null;
        return { el, score, delta: Math.abs(content.length - normalizedTarget.length), visible: isElementVisible(el) };
      }).filter(Boolean);
      ranked.sort((a, b) => b.score - a.score || Number(b.visible) - Number(a.visible) || a.delta - b.delta);
      return ranked.slice(0, 8).map((item) => item.el);
    }
    if (message.text) {
      const normalizedTarget = normalizeText(message.text).toLowerCase();
      if (!normalizedTarget) return [];
      const candidates = querySelectorAllDeep("h1,h2,h3,h4,h5,h6,p,li,div");
      const ranked = candidates.map((el) => {
        const content = normalizeText(textFromElement(el)).toLowerCase();
        if (!content) return null;
        let score = 0;
        if (content === normalizedTarget) score = 3;
        else if (content.startsWith(normalizedTarget) || normalizedTarget.startsWith(content)) score = 2;
        else if (content.includes(normalizedTarget) || normalizedTarget.includes(content)) score = 1;
        if (!score) return null;
        return { el, score, delta: Math.abs(content.length - normalizedTarget.length), visible: isElementVisible(el) };
      }).filter(Boolean);
      ranked.sort((a, b) => b.score - a.score || Number(b.visible) - Number(a.visible) || a.delta - b.delta);
      return ranked.slice(0, 12).map((item) => item.el);
    }
    return [];
  }

  async function waitForElements(message, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    let resolved = false;
    let timeoutId = null;
    let observer = null;

    return new Promise((resolve) => {
      const cleanup = () => {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (observer) observer.disconnect();
      };

      const tryNow = () => {
        const els = selectElementsForMessage(message);
        if (els.length) {
          cleanup();
          resolve(els);
          return true;
        }
        return false;
      };

      if (tryNow()) return;

      observer = new MutationObserver(() => {
        if (resolved) return;
        if (Date.now() > deadline) {
          cleanup();
          resolve([]);
          return;
        }
        tryNow();
      });

      observer.observe(document.documentElement, { childList: true, subtree: true });
      timeoutId = setTimeout(() => {
        if (resolved) return;
        cleanup();
        resolve(selectElementsForMessage(message));
      }, timeoutMs);
    });
  }

  function controllerButtonsFor(target) {
    if (!target || !target.id) return [];
    const id = target.id;
    const selectors = [
      `[aria-controls="${id}"]`,
      `[data-target="#${id}"]`,
      `[data-target="${id}"]`,
      `[data-bs-target="#${id}"]`,
      `[data-bs-target="${id}"]`,
      `a[href="#${id}"]`
    ];
    const set = new Set();
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => set.add(el));
    });
    return Array.from(set);
  }

  function ensureVisible(target) {
    if (!target) return;
    controllerButtonsFor(target).forEach((btn) => {
      const expanded = btn.getAttribute("aria-expanded");
      if (expanded === "false") {
        btn.click();
      } else if (btn.tagName === "A" || btn.tagName === "BUTTON" || btn.tagName === "SUMMARY") {
        btn.click();
      }
    });
    let node = target.parentElement;
    while (node) {
      if (node.tagName === "DETAILS" && !node.open) {
        node.open = true;
        const summary = node.querySelector("summary");
        if (summary) summary.click();
      }
      const className = (node.className || "").toString().toLowerCase();
      if (/accordion|collapse|expand/.test(className)) {
        const summary = node.querySelector("summary");
        if (summary) summary.click();
        const toggle = node.querySelector('[aria-expanded="false"]');
        if (toggle) toggle.click();
      }
      node = node.parentElement;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
      case "analyze": {
        (async () => {
          try {
            console.log('[Atlas] Analysis starting...');
            const robotsInfo = await getRobotsInfo();
            console.log('[Atlas] Got robots info:', robotsInfo?.status);

            const attempt = (triesLeft) => {
              try {
                console.log('[Atlas] Calling analyzePage...');
                const data = analyzePage(robotsInfo);
                console.log('[Atlas] analyzePage completed, got data');

                if (!data) {
                  console.error('[Atlas] analyzePage returned null/undefined');
                  sendResponse({ ok: false, error: 'analyzePage returned no data' });
                  return;
                }

                const hasSchema = data.structuredData && data.structuredData.itemsCount > 0;
                console.log('[Atlas] Schema check - has schema:', hasSchema);

                if (!hasSchema && triesLeft > 0) {
                  console.log('[Atlas] Retrying schema detection...');
                  setTimeout(() => attempt(triesLeft - 1), 500);
                  return;
                }

                console.log('[Atlas] Sending successful response');
                sendResponse({ ok: true, data });
              } catch (stepErr) {
                console.error('[Atlas] Error in attempt:', stepErr);
                sendResponse({ ok: false, error: `Analysis step failed: ${stepErr?.message || String(stepErr)}` });
              }
            };

            attempt(1);
          } catch (err) {
            console.error('[Atlas] Analysis error:', err);
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
        })();
        return true; // Keep channel open for async response
      }

      case "serp": {
        sendResponse({ ok: true, data: parseSerp() });
        return false;
      }

      case "keywordDensity": {
        const keywords = message.keywords || [];
        const bodyText = document.body ? document.body.innerText || "" : "";
        const data = computeKeywordDensity(bodyText, keywords);
        sendResponse({ ok: true, data });
        return false;
      }

      case "highlight": {
        ensureHighlightStyles();
        clearHighlights();
        waitForElements(message)
          .then((elements) => {
            elements.forEach((el) => {
              ensureVisible(el);
              el.classList.add("atlas-highlight");
            });
            sendResponse({ ok: true, found: elements.length });
          })
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true; // Keep channel open for async response
      }

      case "scrollTo": {
        ensureHighlightStyles();
        clearHighlights();
        waitForElements(message)
          .then((elements) => {
            const target = elements[0];
            if (target) {
              ensureVisible(target);
              target.classList.add("atlas-highlight");
              target.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            sendResponse({ ok: true, found: target ? 1 : 0 });
          })
          .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true; // Keep channel open for async response
      }

      case "clearHighlight": {
        clearHighlights();
        sendResponse({ ok: true });
        return false;
      }

      case "aiHighlight": {
        highlightAiSections(message.sections || []);
        sendResponse({ ok: true });
        return false;
      }

      case "aiClearHighlight": {
        clearAiHighlights();
        sendResponse({ ok: true });
        return false;
      }

      case "aiHoverStart": {
        setAiHoverState(true, message.sections || [], message.siteBlocked, message.noImageAi);
        sendResponse({ ok: true });
        return false;
      }

      case "aiHoverStop": {
        setAiHoverState(false, []);
        sendResponse({ ok: true });
        return false;
      }

      case "showOverlay": {
        ensureOverlayStyles();
        clearOverlay();
        showSeoOverlay(message.issues || [], message.images || []);
        sendResponse({ ok: true });
        return false;
      }

      case "hideOverlay": {
        clearOverlay();
        sendResponse({ ok: true });
        return false;
      }

      default:
        return false;
    }
  });

  function ensureHighlightStyles() {
    if (document.getElementById("atlas-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "atlas-highlight-style";
    style.textContent = `
      .atlas-highlight {
        outline: 3px solid #19d3a5 !important;
        outline-offset: 2px !important;
        background: rgba(25, 211, 165, 0.15) !important;
        transition: outline 0.15s ease, background 0.15s ease;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureAiHighlightStyles() {
    if (document.getElementById("atlas-ai-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "atlas-ai-highlight-style";
    style.textContent = `
      .atlas-ai-visible {
        outline: 3px solid rgba(34, 197, 94, 0.95) !important;
        outline-offset: 2px !important;
        background: rgba(34, 197, 94, 0.18) !important;
        transition: outline 0.15s ease, background 0.15s ease;
      }
      .atlas-ai-invisible {
        outline: 3px solid rgba(239, 68, 68, 0.95) !important;
        outline-offset: 2px !important;
        background: rgba(239, 68, 68, 0.18) !important;
        transition: outline 0.15s ease, background 0.15s ease;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function clearHighlights() {
    document.querySelectorAll(".atlas-highlight").forEach((el) => el.classList.remove("atlas-highlight"));
  }

  function clearAiHighlights() {
    document.querySelectorAll(".atlas-ai-visible").forEach((el) => el.classList.remove("atlas-ai-visible"));
    document.querySelectorAll(".atlas-ai-invisible").forEach((el) => el.classList.remove("atlas-ai-invisible"));
  }

  function resolveAiSectionElements(section) {
    if (section === "header") {
      return querySelectorAllDeep("header, nav, [role='banner']");
    }
    if (section === "footer") {
      return querySelectorAllDeep("footer, [role='contentinfo']");
    }
    if (section === "body") {
      const mainEls = querySelectorAllDeep("main, article, [role='main']");
      if (mainEls.length) return mainEls;
      return document.body ? [document.body] : [];
    }
    return [];
  }

  function highlightAiSections(sections) {
    ensureAiHighlightStyles();
    clearAiHighlights();
    (sections || []).forEach((item) => {
      const elements = resolveAiSectionElements(item.section);
      elements.forEach((el) => {
        if (!el || el.nodeType !== 1) return;
        el.classList.add(item.visible ? "atlas-ai-visible" : "atlas-ai-invisible");
      });
    });
  }

  let aiHoverActive = false;
  let aiVisibilityMap = {};
  let aiHoverHandler = null;
  let lastAiSection = null;
  let lastAiTarget = null;
  let aiSiteBlocked = false;
  let aiNoImage = false;

  function setAiHoverState(active, sections, siteBlocked = false, noImageAi = false) {
    aiHoverActive = active;
    aiSiteBlocked = !!siteBlocked;
    aiNoImage = !!noImageAi;
    aiVisibilityMap = {};
    (sections || []).forEach((item) => {
      aiVisibilityMap[item.section] = !!item.visible;
    });
    if (!active) {
      if (aiHoverHandler) {
        document.removeEventListener("mousemove", aiHoverHandler, true);
        aiHoverHandler = null;
      }
      lastAiSection = null;
      lastAiTarget = null;
      clearAiHighlights();
      return;
    }
    if (!htmlNodesReady) {
      markHtmlNodes();
    }
    if (!aiHoverHandler) {
      aiHoverHandler = (event) => {
        if (!aiHoverActive) return;
        const path = event.composedPath ? event.composedPath() : [];
        const target = path.find((node) => node && node.nodeType === 1) || event.target;
        if (!target || target.nodeType !== 1) return;
        const highlightTarget = findAiHoverTarget(target);
        if (!highlightTarget || highlightTarget === lastAiTarget) return;
        lastAiTarget = highlightTarget;
        const section = classifySection(highlightTarget);
        lastAiSection = section || null;
        const sectionAllowed = section ? aiVisibilityMap[section] !== false : true;
        const htmlVisible = isHtmlNode(highlightTarget);
        const isImage = highlightTarget.tagName && highlightTarget.tagName.toLowerCase() === "img";
        const blockedByImage = aiNoImage && isImage;
        const visible = !aiSiteBlocked
          && !blockedByImage
          && isElementVisible(highlightTarget)
          && (htmlVisible || (!isDynamicNode(highlightTarget) && sectionAllowed));
        ensureAiHighlightStyles();
        clearAiHighlights();
        highlightTarget.classList.add(visible ? "atlas-ai-visible" : "atlas-ai-invisible");
      };
      document.addEventListener("mousemove", aiHoverHandler, true);
    }
  }

  function isDynamicNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (dynamicNodes.has(node)) return true;
    let parent = node.parentElement;
    let depth = 0;
    while (parent && depth < 6) {
      if (dynamicNodes.has(parent)) return true;
      parent = parent.parentElement;
      depth += 1;
    }
    return false;
  }

  function findByXPath(xpath) {
    if (!xpath) return [];
    try {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = [];
      for (let i = 0; i < result.snapshotLength; i += 1) {
        const node = result.snapshotItem(i);
        if (node && node.nodeType === 1) out.push(node);
      }
      return out;
    } catch (err) {
      return [];
    }
  }

  function findAiHoverTarget(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    const directTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "p", "li", "button"]);
    if (directTags.has(tag)) return el;
    const text = normalizeText(textFromElement(el), 200);
    if (text.length >= 20) return el;
    const candidate = el.closest("h1,h2,h3,h4,h5,h6,p,li,a,img,section,article,main,aside,header,footer,nav,button");
    return candidate || el;
  }

  function findLinkByHrefOrText(href, text) {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const normalizedHref = normalizeUrlForCompare(href);
    const textTrim = normalizeText(text).toLowerCase();
    let pathname = "";
    try {
      pathname = new URL(normalizedHref).pathname;
    } catch (err) {
      pathname = "";
    }
    const isMatch = (a) => {
      const anchorHref = normalizeUrlForCompare(a.href || "");
      const hrefMatch = anchorHref === normalizedHref || (pathname && anchorHref.endsWith(pathname));
      if (hrefMatch) return true;
      if (!textTrim) return false;
      const anchorText = normalizeText(textFromElement(a)).toLowerCase();
      return anchorText === textTrim || anchorText.includes(textTrim) || textTrim.includes(anchorText);
    };
    const visibleMatch = anchors.find((a) => isElementVisible(a) && isMatch(a));
    if (visibleMatch) return visibleMatch;
    return anchors.find((a) => isMatch(a)) || null;
  }

  function findImageBySrc(src) {
    const imgs = Array.from(document.querySelectorAll("img[src]"));
    const normalized = normalizeUrlForCompare(src);
    let pathname = "";
    try {
      pathname = new URL(normalized).pathname;
    } catch (err) {
      pathname = "";
    }
    const isMatch = (img) => {
      const raw = img.currentSrc || img.getAttribute("src") || "";
      let resolved = raw;
      try {
        resolved = normalizeUrlForCompare(raw);
      } catch (err) {
        resolved = raw;
      }
      const matchExact = normalizeUrlForCompare(resolved) === normalized;
      const matchPath = pathname && resolved.endsWith(pathname);
      return matchExact || matchPath;
    };
    const visibleMatch = imgs.find((img) => isElementVisible(img) && isMatch(img));
    if (visibleMatch) return visibleMatch;
    return imgs.find((img) => isMatch(img)) || null;
  }

  // ============================================
  // VISUAL OVERLAY FUNCTIONS
  // ============================================
  let overlayStylesInjected = false;

  function ensureOverlayStyles() {
    if (overlayStylesInjected) return;
    overlayStylesInjected = true;
    const style = document.createElement("style");
    style.setAttribute("data-atlas-overlay", "true");
    style.textContent = `
      .atlas-overlay-error { outline: 3px solid #ef4444 !important; outline-offset: 2px !important; position: relative !important; }
      .atlas-overlay-warn { outline: 3px solid #f59e0b !important; outline-offset: 2px !important; position: relative !important; }
      .atlas-overlay-h1 { outline: 2px dashed #3b82f6 !important; position: relative !important; }
      .atlas-overlay-h2 { outline: 2px dashed #6366f1 !important; position: relative !important; }
      .atlas-overlay-h3 { outline: 2px dashed #8b5cf6 !important; position: relative !important; }
      .atlas-overlay-link-nofollow { outline: 2px solid #eab308 !important; }
      .atlas-overlay-link-external { outline: 2px solid #f43f5e !important; }
      .atlas-overlay-link-internal { outline: 2px solid #10b981 !important; }
      
      .atlas-overlay-label {
        position: absolute !important;
        background: #1f2937 !important;
        color: #fff !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-size: 10px !important;
        font-family: monospace !important;
        z-index: 999990 !important;
        pointer-events: none !important;
        top: -20px !important;
        left: 0 !important;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
      }
      .atlas-overlay-h1 > .atlas-overlay-label { background: #3b82f6 !important; }
      .atlas-overlay-h2 > .atlas-overlay-label { background: #6366f1 !important; }
      .atlas-overlay-h3 > .atlas-overlay-label { background: #8b5cf6 !important; }

      .atlas-overlay-tooltip {
        position: absolute !important;
        background: #ef4444 !important;
        color: #fff !important;
        padding: 6px 10px !important;
        border-radius: 6px !important;
        font-size: 12px !important;
        z-index: 999999 !important;
        pointer-events: none !important;
        white-space: nowrap !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        top: -32px !important;
        left: 0 !important;
      }
      .atlas-overlay-banner {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        background: linear-gradient(135deg, #1f2937, #111827) !important;
        color: #fff !important;
        padding: 12px 20px !important;
        font-size: 14px !important;
        font-family: system-ui, sans-serif !important;
        z-index: 2147483647 !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4) !important;
        border-bottom: 2px solid #3b82f6 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function clearOverlay() {
    document.querySelectorAll(".atlas-overlay-error, .atlas-overlay-warn, .atlas-overlay-h1, .atlas-overlay-h2, .atlas-overlay-h3, .atlas-overlay-link-nofollow, .atlas-overlay-link-external, .atlas-overlay-link-internal").forEach(el => {
      el.classList.remove("atlas-overlay-error", "atlas-overlay-warn", "atlas-overlay-h1", "atlas-overlay-h2", "atlas-overlay-h3", "atlas-overlay-link-nofollow", "atlas-overlay-link-external", "atlas-overlay-link-internal");
    });
    document.querySelectorAll(".atlas-overlay-tooltip, .atlas-overlay-banner, .atlas-overlay-label").forEach(el => {
      el.remove();
    });
  }

  function addLabel(el, text, className = "atlas-overlay-label") {
    const label = document.createElement("div");
    label.className = className;
    label.textContent = text;
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
    el.appendChild(label);
  }

  function showSeoOverlay(issues, images) {
    const criticalIssues = issues.filter(i => i.type === "error" || i.type === "critical");

    // 1. Top Banner
    const banner = document.createElement("div");
    banner.className = "atlas-overlay-banner";
    banner.innerHTML = `
      <div>
        <strong>Atlas SEO Overlay</strong>: 
        Running on ${location.hostname} • 
        ${criticalIssues.length ? `<span style="color:#ef4444">${criticalIssues.length} Critical Issues</span>` : "No critical errors"}
      </div>
      <div style="font-size:12px; opacity:0.8;">
        <span style="color:#3b82f6">H1</span> 
        <span style="color:#6366f1">H2</span> 
        <span style="color:#8b5cf6">H3</span> • 
        <span style="color:#eab308">Nofollow</span> 
        <span style="color:#f43f5e">Ext</span> 
        <span style="color:#10b981">Int</span>
      </div>
    `;
    if (document.body) {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    // 2. Highlight Images (Missing Alt)
    images.forEach(img => {
      if (!img.src) return;
      const imgEl = findImageBySrc(img.src);
      if (imgEl && isElementVisible(imgEl)) {
        imgEl.classList.add("atlas-overlay-error");
        addLabel(imgEl, img.issue || "MISSING ALT", "atlas-overlay-tooltip");
      }
    });

    // 3. Highlight Headings
    document.querySelectorAll("h1").forEach(el => { if (isElementVisible(el)) { el.classList.add("atlas-overlay-h1"); addLabel(el, "H1"); } });
    document.querySelectorAll("h2").forEach(el => { if (isElementVisible(el)) { el.classList.add("atlas-overlay-h2"); addLabel(el, "H2"); } });
    document.querySelectorAll("h3").forEach(el => { if (isElementVisible(el)) { el.classList.add("atlas-overlay-h3"); addLabel(el, "H3"); } });

    // 4. Highlight Links
    document.querySelectorAll("a[href]").forEach(el => {
      if (!isElementVisible(el)) return;
      const href = el.getAttribute("href") || "";
      const rel = (el.getAttribute("rel") || "").toLowerCase();

      let url;
      try {
        url = new URL(href, location.href);
      } catch (err) {
        return; // Skip invalid URLs
      }

      if (!["http:", "https:"].includes(url.protocol)) return; // Skip mailto, tel, javascript

      // Logic: Nofollow > External > Internal
      if (rel.includes("nofollow")) {
        el.classList.add("atlas-overlay-link-nofollow");
      } else if (url.hostname.replace(/^www\./, '') !== location.hostname.replace(/^www\./, '')) {
        el.classList.add("atlas-overlay-link-external");
      } else {
        el.classList.add("atlas-overlay-link-internal");
      }
    });


  }
})();
