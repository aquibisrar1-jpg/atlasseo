/**
 * ATLAS SEO - Chrome Extension Popup (Rebuilt v2.0)
 * Clean, methodical rebuild from PRD specifications
 * Implements all 12 SEO analysis features with proper data transformation
 */

/* ========================================
   1. STATE MANAGEMENT
   ======================================== */

const appState = {
  currentTab: 'overview',
  rawData: null,              // Raw data from collector.js
  transformedData: null,      // Transformed data for UI rendering
  isAnalyzing: false,
  analysisStartTime: 0,
  darkMode: false,
  sessionId: null,

  async init() {
    const stored = await chrome.storage.local.get(['darkMode', 'lastRawData', 'lastTransformedData']);
    this.darkMode = stored.darkMode || false;
    this.sessionId = Date.now().toString();

    if (this.darkMode) {
      document.body.classList.add('dark');
    }

    // Load previous data
    this.rawData = stored.lastRawData || null;
    this.transformedData = stored.lastTransformedData || null;
  },

  setData(rawData) {
    this.rawData = rawData;
    // Transform the raw data into UI-ready format
    this.transformedData = transformAnalysisData(rawData);

    // Save both to storage
    chrome.storage.local.set({
      lastRawData: rawData,
      lastTransformedData: this.transformedData
    });
  },

  getAnalysisTime() {
    if (this.analysisStartTime === 0) return '0.00s';
    const elapsed = Date.now() - this.analysisStartTime;
    return (elapsed / 1000).toFixed(2) + 's';
  }
};

/* ========================================
   2. DATA TRANSFORMATION LAYER
   Maps collector.js output to UI-ready format
   ======================================== */

function transformAnalysisData(rawData) {
  if (!rawData) return null;

  // Extract and compute metrics
  const overallScore = calculateOverallScore(rawData);
  const issues = identifyIssues(rawData);
  const recommendations = generateRecommendations(rawData, issues);

  return {
    // Meta
    url: rawData.url || '',
    origin: rawData.origin || '',
    analysisTime: new Date().toISOString(),

    // Overall metrics
    overallScore,
    totalIssues: issues.length,
    seoGrade: scoreToGrade(overallScore),
    loadTime: formatLoadTime(rawData.performance?.load),

    // Issues and recommendations
    issues,
    recommendations,

    // OnPage section
    onpage: {
      title: rawData.title || '',
      titleLength: (rawData.title || '').length,
      titleStatus: getTitleStatus(rawData.title),
      metaDescription: rawData.metaDescription || '',
      metaLength: (rawData.metaDescription || '').length,
      metaStatus: getMetaStatus(rawData.metaDescription),
      url: rawData.url || '',
      urlLength: new URL(rawData.url || 'http://example.com').pathname.length,
      canonical: rawData.canonical || '',
      viewport: rawData.viewport || '',
      robots: rawData.metaRobots || 'Allow',
      language: rawData.language || 'Not specified',
      headings: parseHeadingsFromCollector(rawData.headingText || {}),
      hasH1: (rawData.headingText?.h1 || []).length > 0,
      h1Count: (rawData.headingText?.h1 || []).length,
      h2Count: (rawData.headingText?.h2 || []).length,
      h3Count: (rawData.headingText?.h3 || []).length
    },

    // Content section
    content: {
      wordCount: rawData.wordCount || 0,
      characterCount: calculateCharacterCount(rawData),
      paragraphCount: calculateParagraphCount(rawData),
      sentenceCount: calculateSentenceCount(rawData),
      readabilityScore: rawData.contentQuality?.readability?.score || 0,
      readabilityGrade: rawData.contentQuality?.readability?.grade || 'N/A',
      readabilityStatus: getReadabilityStatus(rawData.contentQuality?.readability?.score),
      avgSentenceLength: calculateAvgSentenceLength(rawData),
      avgParagraphLength: calculateAvgParagraphLength(rawData),
      textHtmlRatio: (rawData.textRatio * 100).toFixed(2)
    },

    // Links section - collector.js returns {total, internal, external, nofollow, ugc, sponsored, internalLinks}
    links: {
      totalLinks: rawData.links?.total || 0,
      internalCount: rawData.links?.internal || 0,
      externalCount: rawData.links?.external || 0,
      noFollowCount: rawData.links?.nofollow || 0,
      sponsoredCount: rawData.links?.sponsored || 0,
      ugcCount: rawData.links?.ugc || 0,
      links: (rawData.links?.internalLinks || []).map(link => ({
        type: 'internal',
        url: link.href || '',
        text: link.text || '',
        nofollow: false,
        section: link.section || 'body',
        visible: link.visible !== false
      })).slice(0, 50) // Show max 50
    },

    // Media section - collector.js returns {total, missingAlt, shortAlt, missingSize, largeImages, genericFilename, samples}
    media: {
      totalImages: rawData.images?.total || 0,
      missingAltCount: rawData.images?.missingAlt || 0,
      imagesWithAlt: (rawData.images?.total || 0) - (rawData.images?.missingAlt || 0),
      unoptimizedCount: (rawData.images?.largeImages || 0) + (rawData.images?.missingSize || 0),
      images: (rawData.images?.samples || []).map(img => ({
        src: img.src || '',
        alt: img.alt || '',
        width: img.width || 0,
        height: img.height || 0,
        size: img.size || 0,
        format: img.format || 'unknown',
        section: img.section || 'body'
      })).slice(0, 50) // Show max 50
    },

    // Schema section
    schema: {
      schemaCount: (rawData.structuredData?.itemsCount || 0),
      schemas: (rawData.structuredData?.items || []).slice(0, 20),
      hasArticle: (rawData.structuredData?.items || []).some(s => s['@type']?.includes('Article')),
      hasProduct: (rawData.structuredData?.items || []).some(s => s['@type']?.includes('Product')),
      hasBreadcrumb: (rawData.structuredData?.items || []).some(s => s['@type']?.includes('Breadcrumb')),
      hasOrganization: (rawData.structuredData?.items || []).some(s => s['@type']?.includes('Organization'))
    },

    // Tech section
    tech: {
      allTech: rawData.tech || [],
      categories: categorizeTech(rawData.tech || []),
      totalDetected: (rawData.tech || []).length
    },

    // Fix plan (issues sorted by priority)
    fixPlan: issues
      .map(issue => ({
        ...issue,
        priority: calculateIssuePriority(issue)
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 20),

    // Performance metrics
    performance: {
      ttfb: rawData.performance?.ttfb,
      fcp: rawData.performance?.fcp,
      lcp: rawData.performance?.lcp,
      cls: rawData.performance?.cls,
      inp: rawData.performance?.inp,
      webVitalsScore: calculateWebVitalsScore(rawData.performance)
    },

    // JS SEO section
    jsSeo: {
      isDynamic: (rawData.dynamic?.count || 0) > 0,
      dynamicElementsCount: rawData.dynamic?.count || 0,
      jsRenderDiff: rawData.jsRender || { differences: [] },
      hasSignificantDiff: (rawData.jsRender?.differences || []).length > 0
    },

    // AI Visibility section
    aiVisibility: rawData.aiVisibility || {
      visibility: 0,
      factors: []
    }
  };
}

/* ========================================
   3. SCORING & CALCULATION FUNCTIONS
   ======================================== */

function calculateOverallScore(rawData) {
  if (!rawData) return 0;

  let score = 100;

  // Title tag deduction
  const titleLen = (rawData.title || '').length;
  if (titleLen === 0) score -= 15;
  else if (titleLen < 30 || titleLen > 60) score -= 8;

  // Meta description deduction
  const metaLen = (rawData.metaDescription || '').length;
  if (metaLen === 0) score -= 10;
  else if (metaLen < 120 || metaLen > 160) score -= 5;

  // H1 check
  const hasH1 = (rawData.headings || []).some(h => h.level === 1);
  if (!hasH1) score -= 10;

  // Readability score
  const readabilityScore = rawData.contentQuality?.readability?.score || 0;
  if (readabilityScore < 30) score -= 10;
  else if (readabilityScore < 50) score -= 5;

  // Schema markup
  if ((rawData.structuredData?.itemsCount || 0) === 0) score -= 5;

  // Word count check
  if ((rawData.wordCount || 0) < 300) score -= 8;

  // Mobile friendliness check
  if (!rawData.viewport) score -= 10;

  // Indexability check
  if (rawData.metaRobots?.includes('noindex')) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  if (score >= 50) return 'E';
  return 'F';
}

function identifyIssues(rawData) {
  const issues = [];

  // Title tag issues
  const titleLen = (rawData.title || '').length;
  if (titleLen === 0) {
    issues.push({
      title: 'Missing title tag',
      severity: 'critical',
      description: 'Every page needs a unique, descriptive title tag.',
      impact: 15,
      effort: 1,
      category: 'onpage'
    });
  } else if (titleLen < 30) {
    issues.push({
      title: 'Title tag too short',
      severity: 'high',
      description: `Title is ${titleLen} characters. Optimal is 30-60 characters.`,
      impact: 8,
      effort: 1,
      category: 'onpage'
    });
  } else if (titleLen > 60) {
    issues.push({
      title: 'Title tag too long',
      severity: 'medium',
      description: `Title is ${titleLen} characters. Google may truncate it.`,
      impact: 5,
      effort: 1,
      category: 'onpage'
    });
  }

  // Meta description issues
  const metaLen = (rawData.metaDescription || '').length;
  if (metaLen === 0) {
    issues.push({
      title: 'Missing meta description',
      severity: 'high',
      description: 'Add a compelling meta description (120-160 characters).',
      impact: 8,
      effort: 1,
      category: 'onpage'
    });
  } else if (metaLen < 120) {
    issues.push({
      title: 'Meta description too short',
      severity: 'medium',
      description: `Description is ${metaLen} characters. Expand to 120-160 characters.`,
      impact: 5,
      effort: 2,
      category: 'onpage'
    });
  } else if (metaLen > 160) {
    issues.push({
      title: 'Meta description too long',
      severity: 'low',
      description: `Description is ${metaLen} characters. Google may truncate it.`,
      impact: 2,
      effort: 1,
      category: 'onpage'
    });
  }

  // H1 tag issues - collector.js returns headingText.h1 array
  const h1Count = (rawData.headingText?.h1 || []).length;
  if (h1Count === 0) {
    issues.push({
      title: 'Missing H1 heading',
      severity: 'high',
      description: 'Add a single H1 heading that summarizes the page content.',
      impact: 10,
      effort: 1,
      category: 'onpage'
    });
  } else if (h1Count > 1) {
    issues.push({
      title: 'Multiple H1 headings',
      severity: 'medium',
      description: `Page has ${h1Count} H1 tags. Use only one H1 per page.`,
      impact: 5,
      effort: 2,
      category: 'onpage'
    });
  }

  // Viewport meta tag
  if (!rawData.viewport) {
    issues.push({
      title: 'Missing viewport meta tag',
      severity: 'high',
      description: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">',
      impact: 12,
      effort: 1,
      category: 'onpage'
    });
  }

  // Readability issues
  const readScore = rawData.contentQuality?.readability?.score || 0;
  if (readScore < 30) {
    issues.push({
      title: 'Low readability score',
      severity: 'high',
      description: `Readability score is ${readScore}. Improve sentence structure and vocabulary.`,
      impact: 7,
      effort: 5,
      category: 'content'
    });
  } else if (readScore < 60) {
    issues.push({
      title: 'Moderate readability concerns',
      severity: 'medium',
      description: `Readability score is ${readScore}. Consider simplifying content.`,
      impact: 4,
      effort: 3,
      category: 'content'
    });
  }

  // Word count issues
  if ((rawData.wordCount || 0) < 300) {
    issues.push({
      title: 'Low word count',
      severity: 'medium',
      description: `Page has ${rawData.wordCount} words. Aim for at least 300-500 words for better SEO.`,
      impact: 6,
      effort: 4,
      category: 'content'
    });
  }

  // Missing alt text on images
  const imagesWithoutAlt = (rawData.images || []).filter(img => !img.alt).length;
  if (imagesWithoutAlt > 0) {
    issues.push({
      title: `${imagesWithoutAlt} images missing alt text`,
      severity: 'medium',
      description: 'Alt text helps search engines understand images and improves accessibility.',
      impact: 7,
      effort: 3,
      category: 'media'
    });
  }

  // Schema markup issues
  if ((rawData.structuredData?.itemsCount || 0) === 0) {
    issues.push({
      title: 'No structured data (schema) found',
      severity: 'medium',
      description: 'Add JSON-LD schema markup to enable rich snippets in search results.',
      impact: 6,
      effort: 3,
      category: 'schema'
    });
  }

  // Noindex detection
  if (rawData.metaRobots?.includes('noindex')) {
    issues.push({
      title: 'Page is set to noindex',
      severity: 'critical',
      description: 'This page cannot be indexed. Remove noindex unless intentional.',
      impact: 20,
      effort: 1,
      category: 'onpage'
    });
  }

  return issues;
}

function generateRecommendations(rawData, issues) {
  const recommendations = [];

  if ((rawData.wordCount || 0) < 500) {
    recommendations.push('Expand content to 500+ words for better SEO performance');
  }

  if ((rawData.images || []).length > 0 && (rawData.images || []).filter(img => !img.alt).length > 0) {
    recommendations.push('Add descriptive alt text to all images for accessibility and SEO');
  }

  if ((rawData.structuredData?.itemsCount || 0) === 0) {
    recommendations.push('Implement schema markup to improve rich snippet eligibility');
  }

  if (rawData.contentQuality?.readability?.score < 60) {
    recommendations.push('Simplify language and sentence structure to improve readability');
  }

  if ((rawData.links?.internal || []).length < 5) {
    recommendations.push('Add more internal links to improve crawlability and site structure');
  }

  if (!rawData.canonical) {
    recommendations.push('Add a canonical tag if using URL parameters');
  }

  if (!rawData.viewport) {
    recommendations.push('Ensure mobile-friendly viewport meta tag is present');
  }

  // Performance recommendations
  if (rawData.performance?.lcp > 2500) {
    recommendations.push('Improve Largest Contentful Paint (LCP) - target < 2.5 seconds');
  }

  if (rawData.performance?.cls > 0.1) {
    recommendations.push('Reduce Cumulative Layout Shift (CLS) - target < 0.1');
  }

  return recommendations.slice(0, 6);
}

function calculateIssuePriority(issue) {
  const severityWeights = { critical: 4, high: 3, medium: 2, low: 1 };
  const severityScore = severityWeights[issue.severity] * 20;
  const impactEffortScore = (issue.impact || 0) * 2 - (issue.effort || 0);
  return severityScore + impactEffortScore;
}

function getTitleStatus(title) {
  const len = (title || '').length;
  if (len === 0) return 'missing';
  if (len < 30) return 'too-short';
  if (len > 60) return 'too-long';
  return 'good';
}

function getMetaStatus(meta) {
  const len = (meta || '').length;
  if (len === 0) return 'missing';
  if (len < 120) return 'too-short';
  if (len > 160) return 'too-long';
  return 'good';
}

function getReadabilityStatus(score) {
  if (score < 30) return 'poor';
  if (score < 60) return 'fair';
  if (score < 80) return 'good';
  return 'excellent';
}

function calculateCharacterCount(rawData) {
  return (rawData.title || '').length + (rawData.metaDescription || '').length + (rawData.wordCount || 0) * 5;
}

function calculateParagraphCount(rawData) {
  // Estimate from word count (avg 80 words per paragraph)
  return Math.ceil((rawData.wordCount || 0) / 80);
}

function calculateSentenceCount(rawData) {
  // Estimate from word count (avg 15 words per sentence)
  return Math.ceil((rawData.wordCount || 0) / 15);
}

function calculateAvgSentenceLength(rawData) {
  const sentenceCount = Math.ceil((rawData.wordCount || 0) / 15);
  return sentenceCount > 0 ? Math.round((rawData.wordCount || 0) / sentenceCount) : 0;
}

function calculateAvgParagraphLength(rawData) {
  const paragraphCount = Math.ceil((rawData.wordCount || 0) / 80);
  return paragraphCount > 0 ? Math.round((rawData.wordCount || 0) / paragraphCount) : 0;
}

function isOptimalImageFormat(img) {
  const format = (img.src || '').split('.').pop().toLowerCase();
  return ['webp', 'jpg', 'png', 'svg'].includes(format);
}

function parseHeadings(headings) {
  return headings.map(h => ({
    level: h.level || 1,
    text: h.text || '',
    length: (h.text || '').length
  }));
}

function parseHeadingsFromCollector(headingText) {
  // collector.js returns {h1: [], h2: [], h3: [], order: []}
  const headings = [];

  if (headingText.order && Array.isArray(headingText.order)) {
    // Use the ordered headings if available
    return headingText.order.map(h => ({
      level: parseInt(h.tag.substring(1)) || 1,
      text: h.text || '',
      length: (h.text || '').length
    }));
  }

  // Fallback: manually construct from h1, h2, h3 arrays
  for (let i = 1; i <= 3; i++) {
    const key = `h${i}`;
    if (headingText[key] && Array.isArray(headingText[key])) {
      headingText[key].forEach(text => {
        headings.push({
          level: i,
          text: text,
          length: (text || '').length
        });
      });
    }
  }

  return headings;
}

function categorizeTech(techList) {
  const categories = {};
  techList.forEach(tech => {
    const category = tech.category || 'Other';
    if (!categories[category]) categories[category] = [];
    categories[category].push(tech);
  });
  return categories;
}

function formatLoadTime(ms) {
  if (!ms) return 'N/A';
  if (ms > 1000) return (ms / 1000).toFixed(1) + 's';
  return ms + 'ms';
}

function calculateWebVitalsScore(perf) {
  if (!perf) return 0;
  let score = 100;

  if (perf.lcp > 2500) score -= 30;
  else if (perf.lcp > 1500) score -= 10;

  if (perf.cls > 0.1) score -= 20;
  else if (perf.cls > 0.05) score -= 10;

  if (perf.inp > 200) score -= 15;

  return Math.max(0, score);
}

/* ========================================
   4. MESSAGE PASSING & ANALYSIS
   ======================================== */

async function analyzeCurrentPage(tab) {
  try {
    if (appState.isAnalyzing) {
      updateStatus('Analysis already in progress...', 'info');
      return;
    }

    appState.isAnalyzing = true;
    appState.analysisStartTime = Date.now();
    updateStatus('Analyzing page...');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        appState.isAnalyzing = false;
        updateStatus('Analysis timed out. Try again.', 'warn');
        reject(new Error('Message timeout'));
      }, 5000);

      try {
        chrome.tabs.sendMessage(tab.id, {
          type: 'analyze',
          sessionId: appState.sessionId
        }, { frameId: 0 }, (response) => {
          clearTimeout(timeoutId);

          if (chrome.runtime.lastError) {
            console.warn('Message error:', chrome.runtime.lastError);
            appState.isAnalyzing = false;
            updateStatus('Content script not available. Click refresh to try again.', 'warn');
            resolve();
            return;
          }

          if (response && (response.ok || response.success) && response.data) {
            appState.setData(response.data);
            updateStatus('Analysis complete');
            updateAnalysisTime();
            renderTab(appState.currentTab);
            appState.isAnalyzing = false;
            resolve(response);
          } else if (response && (response.ok === false || !response.ok)) {
            appState.isAnalyzing = false;
            updateStatus(`Analysis error: ${response.error || 'Unknown error'}`, 'error');
            resolve();
          } else {
            appState.isAnalyzing = false;
            updateStatus('No analysis data received. Try refreshing the page.', 'warn');
            resolve();
          }
        });
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('Failed to send message:', error);
        appState.isAnalyzing = false;
        updateStatus('Failed to connect. Try refreshing.', 'error');
        reject(error);
      }
    });
  } catch (error) {
    console.error('Analysis error:', error);
    appState.isAnalyzing = false;
    updateStatus('Analysis failed. Try again.', 'error');
  }
}

async function refreshAnalysis() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await analyzeCurrentPage(tab);
}

/* ========================================
   5. UI UTILITIES
   ======================================== */

function updateBreadcrumb(url) {
  const breadcrumb = document.getElementById('urlBreadcrumb');
  if (breadcrumb && url) {
    try {
      const urlObj = new URL(url);
      breadcrumb.textContent = urlObj.hostname + urlObj.pathname.slice(0, 40);
      breadcrumb.title = url;
    } catch {
      breadcrumb.textContent = url.slice(0, 50);
    }
  }
}

function updateAnalysisTime() {
  const timeDisplay = document.getElementById('analysisTime');
  if (timeDisplay) {
    timeDisplay.textContent = appState.getAnalysisTime();
  }
}

function updateStatus(message, type = 'info') {
  const statusBar = document.getElementById('status');
  if (statusBar) {
    statusBar.textContent = message;
    statusBar.className = `status-bar status-${type}`;
  }
}

function switchTab(tabName) {
  appState.currentTab = tabName;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`panel-${tabName}`);
  if (activePanel) {
    activePanel.classList.add('active');
    renderTab(tabName);
  }

  closeSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar?.classList.toggle('open');
  backdrop?.classList.toggle('show');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar?.classList.remove('open');
  backdrop?.classList.remove('show');
}

/* ========================================
   6. TAB RENDERING SYSTEM
   ======================================== */

function renderTab(tabName) {
  const panel = document.getElementById(`panel-${tabName}`);
  if (!panel) return;

  panel.innerHTML = '';

  if (!appState.transformedData) {
    panel.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
        <h3>No analysis data</h3>
        <p>Click refresh to analyze this page</p>
      </div>
    `;
    return;
  }

  const renderFunc = {
    'overview': renderOverview,
    'fixplan': renderFixPlan,
    'onpage': renderOnPage,
    'content': renderContent,
    'links': renderLinks,
    'media': renderMedia,
    'schema': renderSchema,
    'tech': renderTech,
    'jsseo': renderJsSeo,
    'ai': renderAI,
    'serp': renderSerp,
    'regex': renderRegex
  }[tabName];

  if (renderFunc && typeof renderFunc === 'function') {
    renderFunc(panel);
  } else {
    panel.innerHTML = `<div class="panel-placeholder">Tab not implemented</div>`;
  }
}

/* ========================================
   7. RENDER FUNCTIONS - MAIN FEATURES
   ======================================== */

function renderOverview(panel) {
  const data = appState.transformedData;
  if (!data) return;

  panel.innerHTML = `
    <div class="overview-container">
      <div class="metrics-grid">
        <div class="metric-tile score">
          <div class="metric-value">${data.overallScore}</div>
          <div class="metric-label">Overall Score</div>
          <div class="metric-grade">${data.seoGrade}</div>
        </div>
        <div class="metric-tile issues">
          <div class="metric-value">${data.totalIssues}</div>
          <div class="metric-label">Issues Found</div>
        </div>
        <div class="metric-tile performance">
          <div class="metric-value">${data.loadTime}</div>
          <div class="metric-label">Load Time</div>
        </div>
        <div class="metric-tile vitals">
          <div class="metric-value">${data.performance.webVitalsScore}</div>
          <div class="metric-label">Web Vitals</div>
        </div>
      </div>

      <div class="section-container">
        <h3>Top Issues</h3>
        <div class="issues-list">
          ${data.issues.slice(0, 5).map(issue => `
            <div class="issue-item severity-${issue.severity}">
              <div class="issue-header">
                <span class="issue-title">${escapeHtml(issue.title)}</span>
                <span class="severity-badge">${issue.severity.toUpperCase()}</span>
              </div>
              <div class="issue-description">${escapeHtml(issue.description)}</div>
              <div class="issue-meta">Impact: ${issue.impact} | Effort: ${issue.effort}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section-container">
        <h3>Recommendations</h3>
        <div class="recommendations-list">
          ${data.recommendations.map(rec => `
            <div class="recommendation-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 13l4 4L19 7"></path>
              </svg>
              <span>${escapeHtml(rec)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderFixPlan(panel) {
  const data = appState.transformedData;
  if (!data || !data.fixPlan) return;

  panel.innerHTML = `
    <div class="fix-plan-container">
      <div class="fix-plan-header">
        <h3>Fix Priority Plan</h3>
        <p>Issues sorted by impact and effort</p>
      </div>
      <div class="fix-plan-list">
        ${data.fixPlan.map((issue, idx) => `
          <div class="fix-plan-item">
            <div class="priority-badge">#${idx + 1}</div>
            <div class="fix-item-content">
              <div class="fix-item-title">${escapeHtml(issue.title)}</div>
              <div class="fix-item-desc">${escapeHtml(issue.description)}</div>
              <div class="fix-item-metrics">
                <span>Impact: ${issue.impact}</span>
                <span>Effort: ${issue.effort}</span>
                <span class="priority">Priority: ${Math.round((issue.priority / 100) * 100)}%</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderOnPage(panel) {
  const data = appState.transformedData;
  if (!data || !data.onpage) return;

  const onpage = data.onpage;
  panel.innerHTML = `
    <div class="onpage-container">
      <div class="onpage-section">
        <h3>Title Tag</h3>
        <div class="check-item status-${onpage.titleStatus}">
          <div class="check-header">
            <strong>${escapeHtml(onpage.title || 'No title found')}</strong>
            <span class="check-status">${onpage.titleLength} chars</span>
          </div>
          <div class="check-detail">Optimal: 30-60 characters</div>
        </div>
      </div>

      <div class="onpage-section">
        <h3>Meta Description</h3>
        <div class="check-item status-${onpage.metaStatus}">
          <div class="check-header">
            <strong>${escapeHtml(onpage.metaDescription || 'No description found')}</strong>
            <span class="check-status">${onpage.metaLength} chars</span>
          </div>
          <div class="check-detail">Optimal: 120-160 characters</div>
        </div>
      </div>

      <div class="onpage-section">
        <h3>Headings Structure</h3>
        ${onpage.headings.length > 0 ? `
          <div class="headings-list">
            ${onpage.headings.map(h => `
              <div class="heading-item h${h.level}">
                <span class="heading-level">H${h.level}</span>
                <span class="heading-text">${escapeHtml(h.text)}</span>
              </div>
            `).join('')}
          </div>
        ` : `<div class="check-item"><p>No headings found</p></div>`}
      </div>

      <div class="onpage-section">
        <h3>Technical Meta</h3>
        <div class="tech-meta">
          <div class="meta-item">
            <span class="label">Viewport:</span>
            <span class="value">${onpage.viewport || 'Not set'}</span>
          </div>
          <div class="meta-item">
            <span class="label">Robots:</span>
            <span class="value">${onpage.robots}</span>
          </div>
          <div class="meta-item">
            <span class="label">Language:</span>
            <span class="value">${onpage.language}</span>
          </div>
          <div class="meta-item">
            <span class="label">Canonical:</span>
            <span class="value">${onpage.canonical ? 'Set' : 'Not set'}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderContent(panel) {
  const data = appState.transformedData;
  if (!data || !data.content) return;

  const content = data.content;
  panel.innerHTML = `
    <div class="content-container">
      <div class="content-metrics">
        <div class="metric-card">
          <div class="metric-title">Word Count</div>
          <div class="metric-value">${content.wordCount}</div>
          <div class="metric-note">Recommended: 300+ words</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Readability Score</div>
          <div class="metric-value">${content.readabilityScore}</div>
          <div class="metric-note">Grade: ${content.readabilityGrade}</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Avg Sentence Length</div>
          <div class="metric-value">${content.avgSentenceLength} words</div>
          <div class="metric-note">Optimal: 15-20 words</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Text/HTML Ratio</div>
          <div class="metric-value">${content.textHtmlRatio}%</div>
          <div class="metric-note">Good: >10%</div>
        </div>
      </div>

      <div class="content-details">
        <div class="detail-item">
          <span class="label">Paragraphs:</span>
          <span class="value">${content.paragraphCount}</span>
        </div>
        <div class="detail-item">
          <span class="label">Sentences:</span>
          <span class="value">${content.sentenceCount}</span>
        </div>
        <div class="detail-item">
          <span class="label">Characters:</span>
          <span class="value">${content.characterCount}</span>
        </div>
        <div class="detail-item">
          <span class="label">Readability Grade:</span>
          <span class="value">${content.readabilityGrade}</span>
        </div>
      </div>
    </div>
  `;
}

function renderLinks(panel) {
  const data = appState.transformedData;
  if (!data || !data.links) return;

  const links = data.links;
  panel.innerHTML = `
    <div class="links-container">
      <div class="links-summary">
        <div class="summary-card">
          <div class="summary-number">${links.totalLinks}</div>
          <div class="summary-label">Total Links</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${links.internalCount}</div>
          <div class="summary-label">Internal</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${links.externalCount}</div>
          <div class="summary-label">External</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${links.noFollowCount}</div>
          <div class="summary-label">NoFollow</div>
        </div>
      </div>

      <div class="links-list">
        <h3>Link Details</h3>
        ${links.links.slice(0, 50).map(link => `
          <div class="link-item link-${link.type}">
            <div class="link-header">
              <span class="link-text">${escapeHtml(link.text || link.url)}</span>
              <span class="link-type">${link.type.toUpperCase()}</span>
              ${link.nofollow ? '<span class="link-badge">NOFOLLOW</span>' : ''}
            </div>
            <div class="link-url">${escapeHtml(link.url)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMedia(panel) {
  const data = appState.transformedData;
  if (!data || !data.media) return;

  const media = data.media;
  panel.innerHTML = `
    <div class="media-container">
      <div class="media-summary">
        <div class="summary-card">
          <div class="summary-number">${media.totalImages}</div>
          <div class="summary-label">Total Images</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${media.imagesWithAlt}</div>
          <div class="summary-label">With Alt Text</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${media.missingAltCount}</div>
          <div class="summary-label">Missing Alt</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${media.unoptimizedCount}</div>
          <div class="summary-label">Unoptimized</div>
        </div>
      </div>

      <div class="images-list">
        <h3>Image Details</h3>
        ${media.images.slice(0, 30).map(img => `
          <div class="image-item">
            <div class="image-preview">
              <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || 'No alt text')}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E'">
            </div>
            <div class="image-info">
              <div class="image-title">${img.alt ? escapeHtml(img.alt) : '<em>No alt text</em>'}</div>
              <div class="image-src">${escapeHtml(img.src.substring(0, 60))}</div>
              <div class="image-meta">${img.width}x${img.height} | ${formatBytes(img.size)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSchema(panel) {
  const data = appState.transformedData;
  if (!data || !data.schema) return;

  const schema = data.schema;
  panel.innerHTML = `
    <div class="schema-container">
      <div class="schema-summary">
        <div class="summary-card">
          <div class="summary-number">${schema.schemaCount}</div>
          <div class="summary-label">Schema Found</div>
        </div>
        <div class="summary-card">
          <div class="check-status">${schema.hasArticle ? '✓' : '✗'}</div>
          <div class="summary-label">Article</div>
        </div>
        <div class="summary-card">
          <div class="check-status">${schema.hasProduct ? '✓' : '✗'}</div>
          <div class="summary-label">Product</div>
        </div>
        <div class="summary-card">
          <div class="check-status">${schema.hasOrganization ? '✓' : '✗'}</div>
          <div class="summary-label">Organization</div>
        </div>
      </div>

      <div class="schemas-list">
        <h3>Structured Data</h3>
        ${schema.schemas.length > 0 ? schema.schemas.map((s, idx) => `
          <div class="schema-item">
            <div class="schema-type">${escapeHtml(s['@type'] || 'Unknown')}</div>
            <div class="schema-json">
              <pre>${escapeHtml(JSON.stringify(s, null, 2))}</pre>
            </div>
          </div>
        `).join('') : `<div class="empty-state"><p>No structured data found</p></div>`}
      </div>
    </div>
  `;
}

function renderTech(panel) {
  const data = appState.transformedData;
  if (!data || !data.tech) return;

  const tech = data.tech;
  panel.innerHTML = `
    <div class="tech-container">
      <div class="tech-header">
        <h3>Technologies Detected (${tech.totalDetected})</h3>
      </div>

      ${Object.entries(tech.categories).map(([category, techs]) => `
        <div class="tech-category">
          <h4>${category}</h4>
          <div class="tech-list">
            ${techs.map(t => `
              <div class="tech-item">
                <div class="tech-name">${escapeHtml(t.name)}</div>
                ${t.version ? `<div class="tech-version">${escapeHtml(t.version)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderJsSeo(panel) {
  const data = appState.transformedData;
  if (!data || !data.jsSeo) return;

  const jsSeo = data.jsSeo;
  panel.innerHTML = `
    <div class="jsseo-container">
      <div class="jsseo-header">
        <h3>JavaScript Render Analysis</h3>
        <p>Comparing initial HTML vs. JavaScript-rendered HTML</p>
      </div>

      ${jsSeo.isDynamic ? `
        <div class="dynamic-detected">
          <div class="dynamic-badge">DYNAMIC CONTENT DETECTED</div>
          <div class="dynamic-info">
            <p>This page renders ${jsSeo.dynamicElementsCount} elements with JavaScript</p>
            <p>SEO Impact: Ensure Googlebot can render your JavaScript-generated content</p>
          </div>
        </div>

        ${jsSeo.hasSignificantDiff ? `
          <div class="js-diffs">
            <h4>Changes Made by JavaScript:</h4>
            <ul>
              ${jsSeo.jsRenderDiff.differences.map(diff => `
                <li>${escapeHtml(diff)}</li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      ` : `
        <div class="static-content">
          <p>No significant JavaScript-based rendering detected</p>
          <p>This page is fully rendered server-side (static)</p>
        </div>
      `}
    </div>
  `;
}

function renderAI(panel) {
  const data = appState.transformedData;
  if (!data || !data.aiVisibility) return;

  const aiVis = data.aiVisibility;
  panel.innerHTML = `
    <div class="ai-container">
      <div class="ai-header">
        <h3>AI Visibility Score</h3>
        <div class="ai-score">${aiVis.visibility}%</div>
      </div>

      ${aiVis.factors && aiVis.factors.length > 0 ? `
        <div class="ai-factors">
          <h4>Visibility Factors</h4>
          ${aiVis.factors.map(factor => `
            <div class="factor-item">
              <div class="factor-label">${escapeHtml(factor.label)}</div>
              <div class="factor-status">${escapeHtml(factor.status)}</div>
              <div class="factor-impact">${escapeHtml(factor.impact)}</div>
            </div>
          `).join('')}
        </div>
      ` : `<p>No AI visibility factors computed</p>`}
    </div>
  `;
}

function renderSerp(panel) {
  const data = appState.transformedData;

  // Get SERP info if available
  const onPageFeatures = getSerpFeatures(data);

  panel.innerHTML = `
    <div class="serp-container">
      <div class="serp-header">
        <h3>SERP Features & Rich Snippets</h3>
        <p>Your page's eligibility for rich search results</p>
      </div>

      <div class="serp-features-grid">
        <div class="feature-card feature-${data.schema.hasArticle ? 'enabled' : 'disabled'}">
          <div class="feature-icon">📰</div>
          <div class="feature-name">Article Rich Result</div>
          <div class="feature-status">${data.schema.hasArticle ? '✓ Enabled' : '✗ Needs Schema'}</div>
          ${data.schema.hasArticle ? '<div class="feature-help">Your page is eligible for article rich snippets</div>' : '<div class="feature-help">Add Article schema markup to enable</div>'}
        </div>

        <div class="feature-card feature-${data.schema.hasProduct ? 'enabled' : 'disabled'}">
          <div class="feature-icon">🛒</div>
          <div class="feature-name">Product Rich Result</div>
          <div class="feature-status">${data.schema.hasProduct ? '✓ Enabled' : '✗ Needs Schema'}</div>
          ${data.schema.hasProduct ? '<div class="feature-help">Your page is eligible for product rich snippets</div>' : '<div class="feature-help">Add Product schema markup to enable</div>'}
        </div>

        <div class="feature-card feature-${data.schema.hasBreadcrumb ? 'enabled' : 'disabled'}">
          <div class="feature-icon">🍞</div>
          <div class="feature-name">Breadcrumb</div>
          <div class="feature-status">${data.schema.hasBreadcrumb ? '✓ Enabled' : '✗ Needs Schema'}</div>
          ${data.schema.hasBreadcrumb ? '<div class="feature-help">Breadcrumb navigation is visible in search results</div>' : '<div class="feature-help">Add BreadcrumbList schema to show in SERP</div>'}
        </div>

        <div class="feature-card feature-${data.schema.hasOrganization ? 'enabled' : 'disabled'}">
          <div class="feature-icon">🏢</div>
          <div class="feature-name">Organization Info</div>
          <div class="feature-status">${data.schema.hasOrganization ? '✓ Enabled' : '✗ Needs Schema'}</div>
          ${data.schema.hasOrganization ? '<div class="feature-help">Organization details will display in search</div>' : '<div class="feature-help">Add Organization schema to show business info</div>'}
        </div>

        <div class="feature-card feature-${data.onpage.titleStatus === 'good' && data.onpage.metaStatus === 'good' ? 'enabled' : 'disabled'}">
          <div class="feature-icon">📋</div>
          <div class="feature-name">Meta Tags Optimized</div>
          <div class="feature-status">${data.onpage.titleStatus === 'good' && data.onpage.metaStatus === 'good' ? '✓ Optimized' : '✗ Needs Work'}</div>
          ${data.onpage.titleStatus === 'good' && data.onpage.metaStatus === 'good' ? '<div class="feature-help">Title and description are properly optimized</div>' : '<div class="feature-help">Improve title and meta description length</div>'}
        </div>

        <div class="feature-card feature-${data.performance.webVitalsScore > 70 ? 'enabled' : 'disabled'}">
          <div class="feature-icon">⚡</div>
          <div class="feature-name">Core Web Vitals</div>
          <div class="feature-status">${data.performance.webVitalsScore > 70 ? '✓ Passing' : '✗ Needs Work'}</div>
          ${data.performance.webVitalsScore > 70 ? '<div class="feature-help">Your page meets Core Web Vitals thresholds</div>' : '<div class="feature-help">Improve performance metrics for better rankings</div>'}
        </div>

        <div class="feature-card feature-${data.onpage.hasH1 ? 'enabled' : 'disabled'}">
          <div class="feature-icon">🔤</div>
          <div class="feature-name">H1 Heading</div>
          <div class="feature-status">${data.onpage.hasH1 ? '✓ Present' : '✗ Missing'}</div>
          ${data.onpage.hasH1 ? '<div class="feature-help">Single H1 improves content structure</div>' : '<div class="feature-help">Add a unique H1 heading to your page</div>'}
        </div>

        <div class="feature-card feature-${data.media.missingAltCount === 0 ? 'enabled' : 'disabled'}">
          <div class="feature-icon">🖼️</div>
          <div class="feature-name">Image Alt Text</div>
          <div class="feature-status">${data.media.missingAltCount === 0 ? '✓ Complete' : '✗ ' + data.media.missingAltCount + ' Missing'}</div>
          ${data.media.missingAltCount === 0 ? '<div class="feature-help">All images have descriptive alt text</div>' : '<div class="feature-help">Add alt text to ' + data.media.missingAltCount + ' images for SEO</div>'}
        </div>
      </div>

      <div class="serp-recommendations">
        <h4>To Improve SERP Appearance:</h4>
        <ul>
          <li>Add structured data (schema.org) markup</li>
          <li>Optimize title (30-60 chars) and meta description (120-160 chars)</li>
          <li>Ensure fast Core Web Vitals performance</li>
          <li>Include proper heading hierarchy (H1, H2, H3)</li>
          <li>Add alt text to all images</li>
          <li>Implement breadcrumb navigation schema</li>
        </ul>
      </div>
    </div>
  `;
}

function renderRegex(panel) {
  panel.innerHTML = `
    <div class="regex-container">
      <div class="regex-header">
        <h3>Regex Pattern Builder & Tester</h3>
        <p>Test regular expressions against page content</p>
      </div>

      <div class="regex-input-area">
        <div class="input-group">
          <label>Regular Expression:</label>
          <input type="text" id="regexPattern" placeholder="Enter regex pattern..." value="">
          <div class="regex-help">E.g., /\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b/</div>
        </div>

        <div class="input-group">
          <label>Flags:</label>
          <div class="flag-checkboxes">
            <label><input type="checkbox" id="flagG"> Global (g)</label>
            <label><input type="checkbox" id="flagI"> Case-insensitive (i)</label>
            <label><input type="checkbox" id="flagM"> Multiline (m)</label>
          </div>
        </div>

        <button id="regexTest" class="regex-btn">Test Pattern</button>
        <button id="regexReset" class="regex-btn secondary">Clear</button>
      </div>

      <div class="regex-results" id="regexResults" style="display: none;">
        <h4>Matches Found:</h4>
        <div class="results-list" id="matchesList"></div>
      </div>

      <div class="regex-templates">
        <h4>Common Patterns:</h4>
        <div class="template-buttons">
          <button class="template-btn" onclick="loadRegexTemplate('email')">📧 Email</button>
          <button class="template-btn" onclick="loadRegexTemplate('url')">🔗 URL</button>
          <button class="template-btn" onclick="loadRegexTemplate('phone')">📱 Phone</button>
          <button class="template-btn" onclick="loadRegexTemplate('date')">📅 Date</button>
          <button class="template-btn" onclick="loadRegexTemplate('ipv4')">🌐 IPv4</button>
          <button class="template-btn" onclick="loadRegexTemplate('slug')">📝 URL Slug</button>
        </div>
      </div>

      <div class="regex-reference">
        <h4>Quick Reference:</h4>
        <ul>
          <li><code>\\d</code> - Digit | <code>\\w</code> - Word char | <code>\\s</code> - Whitespace</li>
          <li><code>.</code> - Any char | <code>*</code> - 0 or more | <code>+</code> - 1 or more | <code>?</code> - 0 or 1</li>
          <li><code>[a-z]</code> - Character class | <code>^</code> - Start | <code>$</code> - End</li>
          <li><code>()</code> - Group | <code>|</code> - Or | <code>\\b</code> - Word boundary</li>
        </ul>
      </div>
    </div>
  `;

  // Attach event listeners for regex tester
  setTimeout(() => {
    const testBtn = document.getElementById('regexTest');
    const resetBtn = document.getElementById('regexReset');
    if (testBtn) testBtn.addEventListener('click', testRegexPattern);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      document.getElementById('regexPattern').value = '';
      document.getElementById('flagG').checked = false;
      document.getElementById('flagI').checked = false;
      document.getElementById('flagM').checked = false;
      document.getElementById('regexResults').style.display = 'none';
    });
  }, 100);
}

function getSerpFeatures(data) {
  return {
    article: data.schema.hasArticle,
    product: data.schema.hasProduct,
    breadcrumb: data.schema.hasBreadcrumb,
    organization: data.schema.hasOrganization
  };
}

function loadRegexTemplate(type) {
  const templates = {
    email: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}',
    url: 'https?://[\\w.-]+(?:\\.[\\w\\.-]+)+[\\w\\-\\._~:/?#[\\]@!\\$&\'\\(\\)\\*\\+,;=.]+',
    phone: '(?:\\+?1[-.]?)?\\(?([0-9]{3})\\)?[-.]?([0-9]{3})[-.]?([0-9]{4})',
    date: '(?:0[1-9]|1[0-2])/(?:0[1-9]|[12][0-9]|3[01])/(?:19|20)\\d{2}',
    ipv4: '(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)',
    slug: '[a-z0-9]+(?:-[a-z0-9]+)*'
  };

  document.getElementById('regexPattern').value = templates[type] || '';
}

function testRegexPattern() {
  const patternInput = document.getElementById('regexPattern').value;
  const flagG = document.getElementById('flagG').checked;
  const flagI = document.getElementById('flagI').checked;
  const flagM = document.getElementById('flagM').checked;

  if (!patternInput) {
    alert('Please enter a regex pattern');
    return;
  }

  try {
    let flags = '';
    if (flagG) flags += 'g';
    if (flagI) flags += 'i';
    if (flagM) flags += 'm';

    const regex = new RegExp(patternInput, flags);
    const bodyText = document.body.innerText || '';

    const matches = flagG ? bodyText.match(regex) || [] : [bodyText.match(regex)].filter(m => m);

    const resultsDiv = document.getElementById('regexResults');
    const matchesList = document.getElementById('matchesList');

    if (matches.length === 0) {
      matchesList.innerHTML = '<div class="no-matches">No matches found</div>';
    } else {
      matchesList.innerHTML = `
        <div class="matches-count">Found ${matches.length} match${matches.length !== 1 ? 'es' : ''}</div>
        ${matches.slice(0, 20).map(match => `
          <div class="match-item">
            <code>${escapeHtml(match)}</code>
          </div>
        `).join('')}
        ${matches.length > 20 ? `<div class="matches-truncated">... and ${matches.length - 20} more</div>` : ''}
      `;
    }

    resultsDiv.style.display = 'block';
  } catch (error) {
    alert('Invalid regex pattern: ' + error.message);
  }
}

/* ========================================
   8. UTILITY FUNCTIONS
   ======================================== */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function copyToClipboard(text, element) {
  try {
    navigator.clipboard.writeText(text).then(() => {
      const originalText = element?.innerText || 'Copy';
      element.innerText = '✓ Copied!';
      setTimeout(() => {
        element.innerText = originalText;
      }, 2000);
    });
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

function highlightElement(selector) {
  try {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('atlas-highlight');
      setTimeout(() => {
        element.classList.remove('atlas-highlight');
      }, 3000);
    }
  } catch (err) {
    console.error('Failed to highlight element:', err);
  }
}

function sendMessageToContentScript(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, message).catch(err => {
        console.warn('Content script not available:', err);
      });
    }
  });
}

/* ========================================
   9. EVENT LISTENERS & INITIALIZATION
   ======================================== */

function setupEventListeners() {
  const backdrop = document.getElementById('sidebarBackdrop');
  backdrop?.addEventListener('click', closeSidebar);

  const sidebarToggle = document.querySelector('.sidebar-toggle');
  sidebarToggle?.addEventListener('click', toggleSidebar);

  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  sidebarCloseBtn?.addEventListener('click', closeSidebar);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  document.getElementById('refreshBtn')?.addEventListener('click', refreshAnalysis);
  document.getElementById('exportBtn')?.addEventListener('click', exportReport);

  // Dark mode toggle (if we add a button for it later)
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+D to toggle dark mode
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      toggleDarkMode();
    }
  });
}

function toggleDarkMode() {
  appState.darkMode = !appState.darkMode;

  if (appState.darkMode) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }

  chrome.storage.local.set({ darkMode: appState.darkMode });
  updateStatus(appState.darkMode ? 'Dark mode enabled' : 'Dark mode disabled', 'info');
}

async function initializeUI() {
  try {
    await appState.init();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateBreadcrumb(tab.url);

    setupEventListeners();
    switchTab('overview');
    updateStatus('Ready. Click refresh to analyze.');

    setTimeout(() => {
      analyzeCurrentPage(tab).catch(err => {
        console.error('Initial analysis error:', err);
        updateStatus('Click refresh button to analyze the page', 'warn');
      });
    }, 100);

  } catch (error) {
    console.error('Initialization failed:', error);
    updateStatus('Extension loaded. Click refresh to analyze.', 'info');
  }
}

function exportReport() {
  if (!appState.transformedData) {
    updateStatus('No analysis data to export', 'warn');
    return;
  }

  const csv = generateCSV(appState.transformedData);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `atlas-seo-report-${Date.now()}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  updateStatus('Report exported successfully', 'info');
}

function generateCSV(data) {
  const rows = [
    ['ATLAS SEO - Analysis Report', new Date().toISOString()],
    [''],
    ['OVERVIEW', ''],
    ['URL', data.url],
    ['Overall Score', data.overallScore],
    ['SEO Grade', data.seoGrade],
    ['Total Issues', data.totalIssues],
    [''],
    ['ON-PAGE', ''],
    ['Title', data.onpage.title],
    ['Title Length', data.onpage.titleLength],
    ['Meta Description', data.onpage.metaDescription],
    ['Meta Length', data.onpage.metaLength],
    [''],
    ['CONTENT', ''],
    ['Word Count', data.content.wordCount],
    ['Readability Score', data.content.readabilityScore],
    ['Readability Grade', data.content.readabilityGrade],
    [''],
    ['LINKS', ''],
    ['Total Links', data.links.totalLinks],
    ['Internal Links', data.links.internalCount],
    ['External Links', data.links.externalCount],
    [''],
    ['MEDIA', ''],
    ['Total Images', data.media.totalImages],
    ['Missing Alt Text', data.media.missingAltCount],
    [''],
    ['SCHEMA', ''],
    ['Schema Count', data.schema.schemaCount],
    [''],
    ['ISSUES', '']
  ];

  data.issues.forEach(issue => {
    rows.push([issue.title, issue.severity, issue.description, `Impact: ${issue.impact}`, `Effort: ${issue.effort}`]);
  });

  return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/* ========================================
   10. DEBUG HELPERS & ANALYTICS
   ======================================== */

window.ATLAS_DEBUG = {
  // View current app state
  state: () => {
    console.log('=== ATLAS SEO APP STATE ===');
    console.log('Current Tab:', appState.currentTab);
    console.log('Analysis Data:', appState.analysisData);
    console.log('Transformed Data:', appState.transformedData);
    console.log('Is Analyzing:', appState.isAnalyzing);
    console.log('Dark Mode:', appState.darkMode);
    return appState;
  },

  // Manually trigger analysis
  analyze: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return await analyzeCurrentPage(tab);
  },

  // Load sample data for testing
  loadSampleData: () => {
    const sampleData = {
      url: 'https://example.com/blog/sample-article',
      origin: 'https://example.com',
      title: 'Complete Guide to SEO Best Practices - 2024',
      metaDescription: 'Learn everything about SEO in this comprehensive guide. Tips, best practices, and strategies for improving your search rankings.',
      metaRobots: 'index, follow',
      canonical: 'https://example.com/blog/sample-article',
      viewport: 'width=device-width, initial-scale=1',
      language: 'en',
      headingText: {
        h1: ['Complete Guide to SEO Best Practices'],
        h2: ['Understanding Core Web Vitals', 'Technical SEO Fundamentals', 'Content Optimization'],
        h3: ['Page Speed Optimization', 'Mobile-First Design', 'Keyword Research'],
        order: [
          { tag: 'h1', text: 'Complete Guide to SEO Best Practices' },
          { tag: 'h2', text: 'Understanding Core Web Vitals' },
          { tag: 'h3', text: 'Page Speed Optimization' }
        ]
      },
      wordCount: 2500,
      textRatio: 0.15,
      links: {
        total: 45,
        internal: 28,
        external: 17,
        nofollow: 3,
        sponsored: 0,
        ugc: 0,
        internalLinks: [
          { href: 'https://example.com/about', text: 'About Us', section: 'body', visible: true },
          { href: 'https://example.com/contact', text: 'Contact', section: 'footer', visible: true }
        ]
      },
      images: {
        total: 12,
        missingAlt: 2,
        shortAlt: 1,
        missingSize: 3,
        largeImages: 2,
        genericFilename: 1,
        samples: [
          { src: 'https://example.com/images/hero.jpg', alt: 'SEO strategy diagram', width: 1200, height: 600, size: 85000, format: 'jpeg', section: 'header' },
          { src: 'https://example.com/images/chart.png', alt: 'Ranking factors chart', width: 800, height: 500, size: 125000, format: 'png', section: 'body' }
        ]
      },
      structuredData: {
        itemsCount: 2,
        items: [
          { '@type': 'Article', headline: 'Complete Guide to SEO', author: 'John Doe', datePublished: '2024-01-15' },
          { '@type': 'Organization', name: 'Example Corp', url: 'https://example.com' }
        ]
      },
      tech: [
        { name: 'WordPress', version: '6.4', category: 'CMS' },
        { name: 'React', version: '18.2.0', category: 'Frontend Framework' },
        { name: 'Google Analytics', version: '4', category: 'Analytics' }
      ],
      performance: {
        ttfb: 120,
        fcp: 1200,
        lcp: 1800,
        cls: 0.05,
        inp: 100,
        load: 2500
      },
      dynamic: { count: 5, items: [] },
      jsRender: { differences: ['Added sidebar', 'Loaded comments'] },
      aiVisibility: { visibility: 85, factors: [{ label: 'Content Quality', status: 'Good', impact: 'Positive' }] },
      contentQuality: {
        readability: { score: 75, grade: 'B' }
      }
    };

    appState.setData(sampleData);
    updateStatus('Sample data loaded for testing', 'info');
    renderTab(appState.currentTab);
    console.log('Sample data loaded successfully');
    return sampleData;
  },

  // Export raw analysis data as JSON
  exportJSON: () => {
    if (!appState.transformedData) {
      console.warn('No analysis data available');
      return null;
    }
    const json = JSON.stringify(appState.transformedData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `atlas-seo-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('Analysis data exported as JSON');
  },

  // Get extension version and info
  info: () => {
    const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};
    return {
      name: 'Atlas SEO',
      version: manifest.version || '1.0.0',
      description: 'All-in-one SEO audit and analysis extension',
      buildTime: new Date().toISOString(),
      userAgent: navigator.userAgent
    };
  },

  // Clear all stored data
  clearStorage: async () => {
    await chrome.storage.local.clear();
    appState.analysisData = null;
    appState.transformedData = null;
    updateStatus('All data cleared', 'warn');
    console.log('Storage cleared');
  },

  // Performance metrics
  metrics: () => {
    if (!appState.transformedData) return { message: 'No analysis data yet' };
    return {
      overallScore: appState.transformedData.overallScore,
      totalIssues: appState.transformedData.totalIssues,
      loadTime: appState.transformedData.loadTime,
      analysisTime: appState.getAnalysisTime(),
      timestamp: appState.transformedData.analysisTime
    };
  }
};

// Expose debug helpers in console
console.log('%cAtlas SEO Debug Tools', 'font-size: 14px; font-weight: bold; color: #7c5cfa;');
console.log('Use: ATLAS_DEBUG.state(), ATLAS_DEBUG.analyze(), ATLAS_DEBUG.loadSampleData(), etc.');

document.addEventListener('DOMContentLoaded', initializeUI);
