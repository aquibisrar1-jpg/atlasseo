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

    // OnPage section - Enhanced with advanced validation
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
      h3Count: (rawData.headingText?.h3 || []).length,
      keywordProminence: analyzeKeywordProminence(rawData)
    },

    // Content section - Enhanced with real readability scoring
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
      textHtmlRatio: (rawData.textRatio * 100).toFixed(2),
      keywordDensity: analyzeKeywordDensity(rawData.fullContent || '', ['SEO', 'content', 'page'])
    },

    // Links section - Enhanced with comprehensive analysis
    links: analyzeLinkStructure(rawData),

    // Media section - Enhanced with optimization analysis
    media: analyzeImageOptimization(rawData),

    // Schema section - Enhanced with validation
    schema: validateSchemaMarkup(rawData),

    // Tech section - Enhanced with vulnerability and performance analysis
    tech: analyzeTechnologyStack(rawData),

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

    // JS SEO section - Enhanced with detailed analysis
    jsSeo: analyzeJSSeoImpact(rawData),

    // AI Visibility section - Enhanced with multi-factor scoring
    aiVisibility: analyzeAiVisibility(rawData)
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
   4. ADVANCED ANALYSIS ALGORITHMS
   ======================================== */

// ============ CONTENT READABILITY & KEYWORD ANALYSIS ============

function calculateFleschKincaidReadability(content) {
  if (!content || content.length === 0) return { score: 0, grade: 'F', interpretation: 'No content' };

  // Split into sentences (simplified)
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length || 1;

  // Split into words
  const words = content.match(/\b\w+\b/g) || [];
  const wordCount = words.length;

  // Count syllables (simplified approach)
  const syllableCount = countSyllables(content);

  if (wordCount === 0 || sentenceCount === 0) return { score: 0, grade: 'F', interpretation: 'Insufficient content' };

  // Flesch-Kincaid Grade Level formula
  // 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
  const gradeLevel = (0.39 * (wordCount / sentenceCount)) + (11.8 * (syllableCount / wordCount)) - 15.59;

  // Convert to readability score (0-100)
  const score = Math.max(0, Math.min(100, 100 - (gradeLevel * 10)));

  let grade = 'F';
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else if (score >= 50) grade = 'E';

  let interpretation = 'Very difficult';
  if (gradeLevel <= 6) interpretation = 'Easy';
  else if (gradeLevel <= 9) interpretation = 'Average';
  else if (gradeLevel <= 12) interpretation = 'Difficult';
  else if (gradeLevel <= 14) interpretation = 'Very difficult';
  else interpretation = 'Very difficult';

  return { score: Math.round(score), grade, interpretation, gradeLevel: Math.round(gradeLevel * 10) / 10 };
}

function countSyllables(text) {
  // Simplified syllable counting
  const words = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
  let count = 0;

  words.forEach(word => {
    let syllables = 0;
    const vowels = 'aeiouy';
    let previousWasVowel = false;

    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !previousWasVowel) syllables++;
      previousWasVowel = isVowel;
    }

    // Adjust for silent e
    if (word.endsWith('e')) syllables--;
    if (word.endsWith('le') && word.length > 2 && !vowels.includes(word[word.length - 3])) syllables++;

    count += Math.max(1, syllables);
  });

  return count;
}

function analyzeKeywordDensity(content, keywords = []) {
  if (!content || keywords.length === 0) return { keywordDensity: [], averageDensity: 0 };

  const words = content.toLowerCase().match(/\b[a-z]+(?:\s+[a-z]+)*/g) || [];
  const wordCount = words.length;

  const densities = keywords.map(keyword => {
    const keywordLower = keyword.toLowerCase();
    const keywordWords = keywordLower.split(/\s+/);

    let occurrences = 0;
    if (keywordWords.length === 1) {
      // Single word keyword
      occurrences = words.filter(w => w === keywordLower).length;
    } else {
      // Multi-word keyword - search for phrase
      const contentLower = content.toLowerCase();
      const regex = new RegExp(keywordLower, 'g');
      occurrences = (contentLower.match(regex) || []).length;
    }

    const density = wordCount > 0 ? (occurrences / wordCount) * 100 : 0;

    return {
      keyword,
      occurrences,
      density: Math.round(density * 100) / 100,
      status: density > 5 ? 'over' : density > 2.5 ? 'optimal' : density > 0 ? 'low' : 'none'
    };
  });

  const averageDensity = densities.length > 0
    ? densities.reduce((sum, d) => sum + d.density, 0) / densities.length
    : 0;

  return {
    keywordDensity: densities.sort((a, b) => b.density - a.density),
    averageDensity: Math.round(averageDensity * 100) / 100
  };
}

function analyzeKeywordProminence(rawData) {
  const title = (rawData.title || '').toLowerCase();
  const firstParagraph = (rawData.firstParagraph || '').toLowerCase();
  const headings = (rawData.headingText || {});

  return {
    titleKeywords: extractKeywords(title, 3),
    headingKeywords: extractKeywordsFromHeadings(headings),
    firstParagraphKeywords: extractKeywords(firstParagraph, 5),
    keywordPlacement: {
      inTitle: calculateKeywordScore(title),
      inHeadings: calculateKeywordScore(JSON.stringify(headings)),
      inFirstParagraph: calculateKeywordScore(firstParagraph)
    }
  };
}

function extractKeywords(text, limit = 5) {
  const words = text.match(/\b\w{4,}\b/g) || [];
  const frequency = {};

  words.forEach(word => {
    frequency[word] = (frequency[word] || 0) + 1;
  });

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, frequency: count }));
}

function extractKeywordsFromHeadings(headingText) {
  const headings = [];
  for (let i = 1; i <= 3; i++) {
    const key = `h${i}`;
    if (headingText[key] && Array.isArray(headingText[key])) {
      headings.push(...headingText[key]);
    }
  }
  return extractKeywords(headings.join(' '), 5);
}

function calculateKeywordScore(text) {
  // Score how well keywords are distributed
  const words = text.match(/\b\w+\b/g) || [];
  if (words.length === 0) return 0;

  const frequency = {};
  words.forEach(word => {
    frequency[word] = (frequency[word] || 0) + 1;
  });

  // Calculate entropy (distribution)
  let entropy = 0;
  Object.values(frequency).forEach(count => {
    const probability = count / words.length;
    entropy -= probability * Math.log2(probability);
  });

  return Math.min(100, entropy * 20);
}

// ============ LINKS ANALYSIS ============

function analyzeLinkStructure(rawData) {
  const links = rawData.links || {};
  const total = links.total || 0;
  const internal = links.internal || 0;
  const external = links.external || 0;

  const analysis = {
    totalLinks: total,
    internalLinks: internal,
    externalLinks: external,
    nofollowLinks: links.nofollow || 0,
    sponsoredLinks: links.sponsored || 0,
    ugcLinks: links.ugc || 0,
    brokenLinks: 0,
    internalLinkDistribution: total > 0 ? Math.round((internal / total) * 100) : 0,
    externalLinkDistribution: total > 0 ? Math.round((external / total) * 100) : 0,
    linkRatio: external > 0 ? (internal / external).toFixed(2) : 'N/A',
    orphanedPages: detectOrphanedPages(links.internalLinks || []),
    linkVelocity: calculateLinkVelocity(links.internalLinks || []),
    anchorTextQuality: analyzeAnchorTexts(links.internalLinks || []),
    externalLinkAuthority: analyzeExternalLinks(links.externalLinks || [])
  };

  return analysis;
}

function detectOrphanedPages(internalLinks) {
  // Identify pages that are only linked from one location
  if (!internalLinks || internalLinks.length === 0) return [];

  const urlCounts = {};
  internalLinks.forEach(link => {
    if (link.href) {
      urlCounts[link.href] = (urlCounts[link.href] || 0) + 1;
    }
  });

  return Object.entries(urlCounts)
    .filter(([url, count]) => count === 1)
    .map(([url]) => url)
    .slice(0, 10);
}

function calculateLinkVelocity(internalLinks) {
  // Analyze link distribution across page sections
  if (!internalLinks || internalLinks.length === 0) return { header: 0, body: 0, footer: 0 };

  const sections = { header: 0, body: 0, footer: 0 };
  internalLinks.forEach(link => {
    const section = link.section || 'body';
    if (sections.hasOwnProperty(section)) {
      sections[section]++;
    }
  });

  return sections;
}

function analyzeAnchorTexts(links) {
  if (!links || links.length === 0) return { avgLength: 0, quality: 'poor', issues: [] };

  const anchorTexts = links.map(l => l.text || '').filter(t => t.length > 0);
  const avgLength = anchorTexts.reduce((sum, t) => sum + t.length, 0) / (anchorTexts.length || 1);

  const issues = [];
  const issues_found = {
    generic: 0,
    tooShort: 0,
    tooLong: 0,
    empty: 0
  };

  links.forEach(link => {
    const text = (link.text || '').trim();
    if (!text) {
      issues_found.empty++;
      issues.push({ type: 'empty', link: link.href });
    } else if (text.length < 3) {
      issues_found.tooShort++;
      issues.push({ type: 'too-short', text });
    } else if (text.length > 100) {
      issues_found.tooLong++;
      issues.push({ type: 'too-long', text: text.substring(0, 50) });
    } else if (['click here', 'read more', 'learn more', 'link', 'page'].includes(text.toLowerCase())) {
      issues_found.generic++;
      issues.push({ type: 'generic', text });
    }
  });

  const totalIssues = Object.values(issues_found).reduce((a, b) => a + b, 0);
  let quality = 'good';
  if (totalIssues > links.length * 0.5) quality = 'poor';
  else if (totalIssues > links.length * 0.3) quality = 'fair';
  else if (totalIssues > links.length * 0.1) quality = 'good';

  return {
    totalLinks: links.length,
    avgLength: Math.round(avgLength),
    quality,
    issues: issues_found,
    examples: issues.slice(0, 5)
  };
}

function analyzeExternalLinks(externalLinks = []) {
  return {
    count: externalLinks.length || 0,
    avgDomain: externalLinks.length > 0
      ? [...new Set(externalLinks.map(l => new URL(l.href || '').hostname))].length
      : 0,
    openInNewTab: externalLinks.filter(l => l.target === '_blank').length || 0
  };
}

// ============ IMAGE OPTIMIZATION ANALYSIS ============

function analyzeImageOptimization(rawData) {
  const images = rawData.images || {};
  const samples = images.samples || [];

  const analysis = {
    totalImages: images.total || 0,
    missingAltCount: images.missingAlt || 0,
    altCoveragePercent: images.total > 0 ? Math.round(((images.total - (images.missingAlt || 0)) / images.total) * 100) : 0,
    unoptimizedCount: (images.largeImages || 0) + (images.missingSize || 0),
    imageFormatQuality: analyzeImageFormats(samples),
    imageSizeOptimization: analyzeImageSizes(samples),
    altTextQuality: analyzeAltTextQuality(samples),
    genericFilenameCount: images.genericFilename || 0,
    recommendations: []
  };

  // Generate recommendations
  if (analysis.missingAltCount > 0) {
    analysis.recommendations.push({
      priority: 'high',
      text: `Add alt text to ${analysis.missingAltCount} images for accessibility and SEO`
    });
  }

  if (analysis.unoptimizedCount > 0) {
    analysis.recommendations.push({
      priority: 'medium',
      text: `Optimize ${analysis.unoptimizedCount} images by reducing file size or converting to modern formats`
    });
  }

  if (analysis.imageFormatQuality.hasLargeUnoptimized > 0) {
    analysis.recommendations.push({
      priority: 'medium',
      text: 'Consider using WebP or AVIF format for better compression'
    });
  }

  return analysis;
}

function analyzeImageFormats(samples) {
  if (!samples || samples.length === 0) return { optimal: 0, suboptimal: 0, hasLargeUnoptimized: 0 };

  let optimal = 0;
  let suboptimal = 0;
  let hasLargeUnoptimized = 0;

  samples.forEach(img => {
    const format = (img.format || 'unknown').toLowerCase();
    const size = img.size || 0;

    // WebP and AVIF are optimal
    if (['webp', 'avif'].includes(format)) {
      optimal++;
    } else if (['jpg', 'jpeg', 'png', 'svg'].includes(format)) {
      suboptimal++;
      // Check for large images that could be optimized
      if (size > 500000) hasLargeUnoptimized++; // > 500KB
    }
  });

  return { optimal, suboptimal, hasLargeUnoptimized, total: samples.length };
}

function analyzeImageSizes(samples) {
  if (!samples || samples.length === 0) return { avgSize: 0, largest: 0, total: 0, count: 0 };

  const validSizes = samples.map(img => img.size || 0).filter(size => size > 0);
  if (validSizes.length === 0) return { avgSize: 0, largest: 0, total: 0, count: 0 };

  const total = validSizes.reduce((a, b) => a + b, 0);
  const avg = total / validSizes.length;
  const largest = Math.max(...validSizes);

  return {
    avgSize: Math.round(avg / 1024), // KB
    largestSize: Math.round(largest / 1024), // KB
    totalSize: Math.round(total / 1024 / 1024), // MB
    count: validSizes.length
  };
}

function analyzeAltTextQuality(samples) {
  if (!samples || samples.length === 0) return { avgLength: 0, quality: 'poor' };

  const altTexts = samples.map(img => img.alt || '').filter(alt => alt.length > 0);
  if (altTexts.length === 0) return { avgLength: 0, quality: 'poor', missingCount: samples.length };

  const avgLength = altTexts.reduce((sum, alt) => sum + alt.length, 0) / altTexts.length;
  let quality = 'good';
  if (avgLength < 10) quality = 'poor';
  else if (avgLength < 50) quality = 'fair';

  return {
    avgLength: Math.round(avgLength),
    quality,
    missingCount: samples.length - altTexts.length,
    totalImages: samples.length
  };
}

// ============ SCHEMA VALIDATION ============

function validateSchemaMarkup(rawData) {
  const schemas = rawData.structuredData?.items || [];
  const validation = {
    totalSchemas: schemas.length,
    schemasByType: {},
    commonIssues: [],
    validSchemas: 0,
    incompleteSchemas: 0,
    recommendations: []
  };

  schemas.forEach(schema => {
    const schemaType = schema['@type'] || 'Unknown';
    if (!validation.schemasByType[schemaType]) {
      validation.schemasByType[schemaType] = { count: 0, valid: 0, issues: [] };
    }
    validation.schemasByType[schemaType].count++;

    // Validate schema based on type
    const result = validateSchemaByType(schema);
    if (result.isValid) {
      validation.validSchemas++;
      validation.schemasByType[schemaType].valid++;
    } else {
      validation.incompleteSchemas++;
      validation.commonIssues.push(...result.issues);
      validation.schemasByType[schemaType].issues.push(...result.issues);
    }
  });

  // Generate recommendations
  if (validation.totalSchemas === 0) {
    validation.recommendations.push('Add structured data (Schema.org) to improve rich snippet eligibility');
  } else if (validation.incompleteSchemas > 0) {
    validation.recommendations.push(`Fix ${validation.incompleteSchemas} incomplete schema(s) with missing required properties`);
  }

  // Check for common schema types
  const hasArticle = validation.schemasByType['Article'];
  const hasProduct = validation.schemasByType['Product'];
  const hasOrganization = validation.schemasByType['Organization'];

  if (!hasArticle) {
    validation.recommendations.push('Consider adding Article schema for blog posts or news content');
  }

  return validation;
}

function validateSchemaByType(schema) {
  const type = schema['@type'];
  const requiredFields = {
    Article: ['headline', 'datePublished', 'author'],
    Product: ['name', 'description', 'offers'],
    Organization: ['name', 'url', 'logo'],
    LocalBusiness: ['name', 'address', 'telephone'],
    Breadcrumb: ['itemListElement'],
    FAQPage: ['mainEntity']
  };

  const required = requiredFields[type] || [];
  const issues = [];
  let isValid = true;

  required.forEach(field => {
    if (!schema[field]) {
      issues.push(`Missing required field: ${field}`);
      isValid = false;
    }
  });

  // Check for @context
  if (!schema['@context']) {
    issues.push('Missing @context property');
  }

  return { isValid, issues };
}

// ============ TECHNOLOGY ANALYSIS ============

function analyzeTechnologyStack(rawData) {
  const techs = rawData.tech || [];
  const analysis = {
    totalTechnologies: techs.length,
    byCategory: {},
    potentialVulnerabilities: [],
    versionInfo: [],
    performanceImpact: { positive: [], negative: [] }
  };

  techs.forEach(tech => {
    const category = tech.category || 'Other';
    if (!analysis.byCategory[category]) {
      analysis.byCategory[category] = [];
    }
    analysis.byCategory[category].push(tech);

    // Check for version info
    if (tech.version) {
      analysis.versionInfo.push({
        name: tech.name,
        version: tech.version,
        category
      });
    }

    // Check for common vulnerability patterns
    const vulnCheck = checkTechVulnerabilities(tech);
    if (vulnCheck.hasRisk) {
      analysis.potentialVulnerabilities.push(vulnCheck);
    }

    // Performance assessment
    const perfAssessment = assessTechPerformance(tech);
    if (perfAssessment.impact === 'positive') {
      analysis.performanceImpact.positive.push(tech.name);
    } else if (perfAssessment.impact === 'negative') {
      analysis.performanceImpact.negative.push(tech.name);
    }
  });

  return analysis;
}

function checkTechVulnerabilities(tech) {
  // Simplified vulnerability checking
  const outdatedVersions = {
    'WordPress': { vulnerable: ['5.0', '5.1', '5.2'], message: 'Outdated WordPress version' },
    'jQuery': { vulnerable: ['1.x', '2.x'], message: 'Outdated jQuery - consider upgrading' }
  };

  const check = outdatedVersions[tech.name];
  let hasRisk = false;
  let severity = 'low';

  if (check && tech.version) {
    const majorVersion = tech.version.split('.')[0];
    if (check.vulnerable.some(v => tech.version.startsWith(v))) {
      hasRisk = true;
      severity = 'medium';
    }
  }

  return {
    name: tech.name,
    version: tech.version,
    hasRisk,
    severity,
    message: hasRisk ? check?.message : null
  };
}

function assessTechPerformance(tech) {
  // Assess performance impact of technologies
  const performanceData = {
    'React': { impact: 'mixed', size: 'large', note: 'Good for interactive sites' },
    'Vue': { impact: 'positive', size: 'small', note: 'Lightweight framework' },
    'jQuery': { impact: 'negative', size: 'medium', note: 'Consider modern alternatives' },
    'Bootstrap': { impact: 'neutral', size: 'medium', note: 'CSS framework' },
    'Google Analytics': { impact: 'negative', size: 'small', note: 'Script overhead' },
    'Cloudflare': { impact: 'positive', size: 'none', note: 'CDN acceleration' }
  };

  return performanceData[tech.name] || { impact: 'neutral', size: 'unknown' };
}

// ============ JAVASCRIPT SEO ANALYSIS ============

function analyzeJSSeoImpact(rawData) {
  const jsRender = rawData.jsRender || {};
  const dynamic = rawData.dynamic || {};

  const analysis = {
    isDynamic: dynamic.count > 0,
    dynamicElementCount: dynamic.count || 0,
    jsModifiedElements: jsRender.differences || [],
    contentHiddenByJs: detectJsHiddenContent(jsRender),
    criticalRenderingPath: analyzeCriticalPath(rawData),
    recommendations: []
  };

  // Generate recommendations
  if (analysis.isDynamic) {
    analysis.recommendations.push({
      priority: 'high',
      text: 'JavaScript dynamically renders content. Ensure Google can crawl and index all content.'
    });
  }

  if (analysis.contentHiddenByJs > 0) {
    analysis.recommendations.push({
      priority: 'high',
      text: `${analysis.contentHiddenByJs} content element(s) are hidden by JavaScript. Make sure critical content is server-rendered.`
    });
  }

  return analysis;
}

function detectJsHiddenContent(jsRender) {
  if (!jsRender || !jsRender.differences) return 0;

  // Count elements that were hidden or removed by JS
  const hiddenPatterns = ['display: none', 'visibility: hidden', 'removed', 'hidden'];
  let count = 0;

  jsRender.differences.forEach(diff => {
    if (hiddenPatterns.some(pattern => diff.toLowerCase().includes(pattern))) {
      count++;
    }
  });

  return count;
}

function analyzeCriticalPath(rawData) {
  const perf = rawData.performance || {};
  return {
    ttfb: perf.ttfb || 0,
    firstContentfulPaint: perf.fcp || 0,
    largestContentfulPaint: perf.lcp || 0,
    cumulativeLayoutShift: perf.cls || 0,
    inputDelay: perf.inp || 0,
    loadComplete: perf.load || 0
  };
}

// ============ AI VISIBILITY ANALYSIS ============

function analyzeAiVisibility(rawData) {
  const factors = [];
  let score = 100;

  // Content Quality (20 points)
  const contentScore = evaluateContentQuality(rawData);
  factors.push({
    label: 'Content Quality',
    score: contentScore,
    maxScore: 20,
    status: contentScore >= 15 ? 'Good' : contentScore >= 10 ? 'Fair' : 'Poor',
    description: 'Comprehensive, well-structured content with good readability'
  });
  score -= (20 - contentScore);

  // Structured Data (15 points)
  const schemaScore = evaluateStructuredData(rawData);
  factors.push({
    label: 'Structured Data',
    score: schemaScore,
    maxScore: 15,
    status: schemaScore >= 12 ? 'Good' : schemaScore >= 8 ? 'Fair' : 'Poor',
    description: 'JSON-LD schema markup for AI model context'
  });
  score -= (15 - schemaScore);

  // Indexability (15 points)
  const indexScore = evaluateIndexability(rawData);
  factors.push({
    label: 'Indexability',
    score: indexScore,
    maxScore: 15,
    status: indexScore >= 12 ? 'Good' : indexScore >= 8 ? 'Fair' : 'Poor',
    description: 'Accessible to crawlers and indexed properly'
  });
  score -= (15 - indexScore);

  // Link Authority (15 points)
  const authScore = evaluateLinkAuthority(rawData);
  factors.push({
    label: 'Link Authority',
    score: authScore,
    maxScore: 15,
    status: authScore >= 12 ? 'Good' : authScore >= 8 ? 'Fair' : 'Poor',
    description: 'Quality internal linking and external citations'
  });
  score -= (15 - authScore);

  // Freshness (10 points)
  const freshnessScore = evaluateContentFreshness(rawData);
  factors.push({
    label: 'Content Freshness',
    score: freshnessScore,
    maxScore: 10,
    status: freshnessScore >= 8 ? 'Good' : freshnessScore >= 5 ? 'Fair' : 'Poor',
    description: 'Recently updated or published content'
  });
  score -= (10 - freshnessScore);

  // Technical Performance (10 points)
  const techScore = evaluateTechnicalPerformance(rawData);
  factors.push({
    label: 'Technical Performance',
    score: techScore,
    maxScore: 10,
    status: techScore >= 8 ? 'Good' : techScore >= 5 ? 'Fair' : 'Poor',
    description: 'Fast load times and Core Web Vitals compliance'
  });
  score -= (10 - techScore);

  // Accessibility (5 points)
  const accessScore = evaluateAccessibility(rawData);
  factors.push({
    label: 'Accessibility',
    score: accessScore,
    maxScore: 5,
    status: accessScore >= 4 ? 'Good' : accessScore >= 2 ? 'Fair' : 'Poor',
    description: 'WCAG compliance and semantic HTML'
  });
  score -= (5 - accessScore);

  return {
    visibility: Math.max(0, Math.min(100, score)),
    factors,
    overallStatus: score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor'
  };
}

function evaluateContentQuality(rawData) {
  let score = 0;
  const wordCount = rawData.wordCount || 0;
  const readability = rawData.contentQuality?.readability?.score || 0;

  if (wordCount >= 1000) score += 8;
  else if (wordCount >= 500) score += 5;
  else if (wordCount >= 300) score += 3;

  if (readability >= 70) score += 8;
  else if (readability >= 50) score += 5;
  else if (readability >= 30) score += 2;

  const headingCount = (rawData.headingText?.h2 || []).length + (rawData.headingText?.h3 || []).length;
  if (headingCount >= 5) score += 4;
  else if (headingCount >= 3) score += 2;

  return Math.min(20, score);
}

function evaluateStructuredData(rawData) {
  let score = 0;
  const schemas = rawData.structuredData?.items || [];

  if (schemas.length >= 3) score += 8;
  else if (schemas.length >= 1) score += 4;

  const hasArticle = schemas.some(s => s['@type']?.includes('Article'));
  const hasOrganization = schemas.some(s => s['@type']?.includes('Organization'));
  const hasBreadcrumb = schemas.some(s => s['@type']?.includes('Breadcrumb'));

  if (hasArticle) score += 3;
  if (hasOrganization) score += 2;
  if (hasBreadcrumb) score += 2;

  return Math.min(15, score);
}

function evaluateIndexability(rawData) {
  let score = 15; // Start with perfect score

  if (rawData.metaRobots?.includes('noindex')) score -= 15;
  if (!rawData.canonical) score -= 3;
  if (!rawData.viewport) score -= 3;
  if (!rawData.language) score -= 2;

  return Math.max(0, score);
}

function evaluateLinkAuthority(rawData) {
  let score = 0;
  const links = rawData.links || {};
  const internal = links.internal || 0;
  const external = links.external || 0;
  const total = links.total || 0;

  if (internal >= 10) score += 8;
  else if (internal >= 5) score += 5;
  else if (internal >= 1) score += 2;

  if (external >= 5) score += 5;
  else if (external >= 1) score += 2;

  const ratio = total > 0 ? internal / total : 0;
  if (ratio >= 0.6) score += 2;

  return Math.min(15, score);
}

function evaluateContentFreshness(rawData) {
  // Check for publication date in structured data
  let score = 0;
  const schemas = rawData.structuredData?.items || [];

  schemas.forEach(schema => {
    if (schema.datePublished || schema.dateModified) {
      try {
        const date = new Date(schema.datePublished || schema.dateModified);
        const daysSinceUpdate = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceUpdate < 7) score += 10;
        else if (daysSinceUpdate < 30) score += 8;
        else if (daysSinceUpdate < 90) score += 5;
        else if (daysSinceUpdate < 365) score += 3;
        else score += 1;
      } catch (e) {
        score += 2;
      }
    } else {
      score += 2; // Assume somewhat fresh if has schema
    }
  });

  return Math.min(10, score);
}

function evaluateTechnicalPerformance(rawData) {
  let score = 0;
  const perf = rawData.performance || {};

  // LCP (Largest Contentful Paint)
  const lcp = perf.lcp || 0;
  if (lcp < 2500) score += 4;
  else if (lcp < 4000) score += 2;

  // CLS (Cumulative Layout Shift)
  const cls = perf.cls || 0;
  if (cls < 0.1) score += 3;
  else if (cls < 0.25) score += 1;

  // Load time
  const load = perf.load || 0;
  if (load < 3000) score += 3;
  else if (load < 5000) score += 1;

  return Math.min(10, score);
}

function evaluateAccessibility(rawData) {
  let score = 0;
  const images = rawData.images || {};
  const total = images.total || 0;
  const missing = images.missingAlt || 0;

  if (total > 0) {
    const coverage = 1 - (missing / total);
    if (coverage >= 0.95) score += 3;
    else if (coverage >= 0.80) score += 2;
    else if (coverage >= 0.50) score += 1;
  } else if (total === 0) {
    score += 2; // No images is also accessible
  }

  if (rawData.language) score += 2;
  if (rawData.viewport) score += 1;

  return Math.min(5, score);
}

/* ========================================
   5. MESSAGE PASSING & ANALYSIS
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
      }, 15000); // Increased timeout to 15 seconds

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
  if (!data) {
    panel.innerHTML = `
      <div class="empty-state">
        <p style="font-size: 16px; margin-bottom: 10px;">📊 Ready to Analyze</p>
        <p>Click the <strong>Refresh</strong> button in the top right to analyze this page.</p>
      </div>
    `;
    return;
  }

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
  if (!data || !data.content) {
    panel.innerHTML = '<div class="empty-state"><p>No content data available. Run analysis first.</p></div>';
    return;
  }

  const content = data.content || {};
  const keywordData = content.keywordDensity || {};

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
        <h3>Content Metrics</h3>
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
          <span class="label">Avg Paragraph Length:</span>
          <span class="value">${content.avgParagraphLength} words</span>
        </div>
      </div>

      ${keywordData.keywordDensity && keywordData.keywordDensity.length > 0 ? `
        <div class="keyword-density">
          <h3>Keyword Density Analysis</h3>
          <div class="keyword-list">
            ${keywordData.keywordDensity.map(kw => `
              <div class="keyword-item">
                <span class="keyword-text">${escapeHtml(kw.keyword)}</span>
                <span class="keyword-density">${kw.density}%</span>
                <span class="keyword-status status-${kw.status}">${kw.status}</span>
              </div>
            `).join('')}
          </div>
          <p class="metric-note">Average density: ${keywordData.averageDensity || 0}%</p>
        </div>
      ` : ''}
    </div>
  `;
}

function renderLinks(panel) {
  const data = appState.transformedData;
  if (!data || !data.links) {
    panel.innerHTML = '<div class="empty-state"><p>No link data available. Run analysis first.</p></div>';
    return;
  }

  const links = data.links || {};
  const anchorQuality = links.anchorTextQuality || {};

  panel.innerHTML = `
    <div class="links-container">
      <div class="links-summary">
        <div class="summary-card">
          <div class="summary-number">${links.totalLinks}</div>
          <div class="summary-label">Total Links</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${links.internalLinks}</div>
          <div class="summary-label">Internal</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${links.externalLinks}</div>
          <div class="summary-label">External</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${links.nofollowLinks}</div>
          <div class="summary-label">NoFollow</div>
        </div>
      </div>

      <div class="link-ratio">
        <p><strong>Internal/External Ratio:</strong> ${links.linkRatio}</p>
        <p><strong>Internal Distribution:</strong> ${links.internalLinkDistribution}%</p>
      </div>

      ${anchorQuality && anchorQuality.quality ? `
        <div class="anchor-quality">
          <h3>Anchor Text Quality</h3>
          <div class="quality-score">
            <span class="label">Quality:</span>
            <span class="value status-${anchorQuality.quality}">${anchorQuality.quality}</span>
          </div>
          <div class="quality-details">
            <p>Average Anchor Length: ${anchorQuality.avgLength} characters</p>
            <p>Total Links Analyzed: ${anchorQuality.totalLinks}</p>
          </div>
          ${anchorQuality.issues && Object.keys(anchorQuality.issues).length > 0 ? `
            <div class="quality-issues">
              <p><strong>Issues Found:</strong></p>
              <ul>
                ${Object.entries(anchorQuality.issues).map(([issue, count]) =>
                  count > 0 ? `<li>${issue}: ${count}</li>` : ''
                ).filter(x => x).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${links.orphanedPages && links.orphanedPages.length > 0 ? `
        <div class="orphaned-pages">
          <h3>Orphaned Pages</h3>
          <p class="metric-note">${links.orphanedPages.length} page(s) linked from only one location</p>
          <div class="orphaned-list">
            ${links.orphanedPages.slice(0, 5).map(url => `
              <div class="orphaned-item">${escapeHtml(url)}</div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${links.linkVelocity ? `
        <div class="link-velocity">
          <h3>Link Distribution by Section</h3>
          <div class="velocity-bars">
            <div class="velocity-bar">
              <span class="section-label">Header: ${links.linkVelocity.header}</span>
            </div>
            <div class="velocity-bar">
              <span class="section-label">Body: ${links.linkVelocity.body}</span>
            </div>
            <div class="velocity-bar">
              <span class="section-label">Footer: ${links.linkVelocity.footer}</span>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderMedia(panel) {
  const data = appState.transformedData;
  if (!data || !data.media) return;

  const media = data.media;
  const sizeOptim = media.imageSizeOptimization || {};
  const formatQuality = media.imageFormatQuality || {};
  const altQuality = media.altTextQuality || {};

  panel.innerHTML = `
    <div class="media-container">
      <div class="media-summary">
        <div class="summary-card">
          <div class="summary-number">${media.totalImages}</div>
          <div class="summary-label">Total Images</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${media.altCoveragePercent}%</div>
          <div class="summary-label">Alt Text Coverage</div>
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

      <div class="optimization-analysis">
        <h3>Image Optimization Analysis</h3>

        ${formatQuality && formatQuality.total > 0 ? `
          <div class="format-quality">
            <p><strong>Format Quality:</strong></p>
            <div class="format-bars">
              <div class="format-bar">
                <span>Modern Formats (WebP/AVIF): ${formatQuality.optimal}</span>
              </div>
              <div class="format-bar">
                <span>Standard Formats (JPG/PNG): ${formatQuality.suboptimal}</span>
              </div>
            </div>
            ${formatQuality.hasLargeUnoptimized > 0 ? `
              <p class="metric-warn">⚠️ ${formatQuality.hasLargeUnoptimized} large image(s) could benefit from modern format conversion</p>
            ` : ''}
          </div>
        ` : ''}

        ${sizeOptim && sizeOptim.count > 0 ? `
          <div class="size-optimization">
            <p><strong>File Size Metrics:</strong></p>
            <div class="size-details">
              <div class="size-stat">Average Size: ${sizeOptim.avgSize} KB</div>
              <div class="size-stat">Largest Image: ${sizeOptim.largestSize} KB</div>
              <div class="size-stat">Total Size: ${sizeOptim.totalSize} MB</div>
            </div>
          </div>
        ` : ''}

        ${altQuality && altQuality.quality ? `
          <div class="alt-quality">
            <p><strong>Alt Text Quality:</strong> <span class="status-${altQuality.quality}">${altQuality.quality}</span></p>
            <div class="alt-stats">
              <p>Average Alt Length: ${altQuality.avgLength} chars</p>
              <p>Missing Alt Text: ${altQuality.missingCount}</p>
            </div>
          </div>
        ` : ''}
      </div>

      ${media.recommendations && media.recommendations.length > 0 ? `
        <div class="optimization-recommendations">
          <h3>Recommendations</h3>
          <ul>
            ${media.recommendations.map(rec => `
              <li class="recommendation-${rec.priority}">
                <strong>${rec.priority.toUpperCase()}:</strong> ${escapeHtml(rec.text)}
              </li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
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
          <div class="summary-number">${schema.totalSchemas}</div>
          <div class="summary-label">Total Schemas</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${schema.validSchemas}</div>
          <div class="summary-label">Valid</div>
        </div>
        <div class="summary-card">
          <div class="summary-number">${schema.incompleteSchemas}</div>
          <div class="summary-label">Incomplete</div>
        </div>
      </div>

      ${schema.commonIssues && schema.commonIssues.length > 0 ? `
        <div class="schema-validation">
          <h3>Validation Issues</h3>
          <div class="issues-list">
            ${schema.commonIssues.slice(0, 10).map(issue => `
              <div class="issue-item">
                <span class="issue-icon">⚠️</span>
                <span class="issue-text">${escapeHtml(issue)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${schema.recommendations && schema.recommendations.length > 0 ? `
        <div class="schema-recommendations">
          <h3>Recommendations</h3>
          <ul>
            ${schema.recommendations.map(rec => `
              <li>${escapeHtml(rec)}</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="schemas-list">
        <h3>Detected Structured Data</h3>
        ${schema.schemas && schema.schemas.length > 0 ? schema.schemas.map((s, idx) => `
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
        <h3>Technologies Detected (${tech.totalTechnologies})</h3>
      </div>

      ${tech.potentialVulnerabilities && tech.potentialVulnerabilities.length > 0 ? `
        <div class="tech-vulnerabilities">
          <h4 style="color: #e74c3c;">⚠️ Potential Issues</h4>
          <div class="vuln-list">
            ${tech.potentialVulnerabilities.map(vuln => `
              <div class="vuln-item severity-${vuln.severity}">
                <div class="vuln-name">${escapeHtml(vuln.name)}</div>
                ${vuln.version ? `<div class="vuln-version">v${escapeHtml(vuln.version)}</div>` : ''}
                ${vuln.message ? `<div class="vuln-message">${escapeHtml(vuln.message)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${tech.performanceImpact && (tech.performanceImpact.positive.length > 0 || tech.performanceImpact.negative.length > 0) ? `
        <div class="tech-performance">
          <h4>Performance Impact</h4>
          ${tech.performanceImpact.positive.length > 0 ? `
            <div class="perf-positive">
              <p><strong>✓ Positive Impact:</strong></p>
              <p>${tech.performanceImpact.positive.join(', ')}</p>
            </div>
          ` : ''}
          ${tech.performanceImpact.negative.length > 0 ? `
            <div class="perf-negative">
              <p><strong>✗ Negative Impact:</strong></p>
              <p>${tech.performanceImpact.negative.join(', ')}</p>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${Object.entries(tech.byCategory).map(([category, techs]) => `
        <div class="tech-category">
          <h4>${category}</h4>
          <div class="tech-list">
            ${techs.map(t => `
              <div class="tech-item">
                <div class="tech-name">${escapeHtml(t.name)}</div>
                ${t.version ? `<div class="tech-version">v${escapeHtml(t.version)}</div>` : ''}
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
  const crp = jsSeo.criticalRenderingPath || {};

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
            <p>This page renders <strong>${jsSeo.dynamicElementCount}</strong> elements with JavaScript</p>
            <p>SEO Impact: Ensure Googlebot can render your JavaScript-generated content</p>
          </div>
        </div>

        ${jsSeo.contentHiddenByJs > 0 ? `
          <div class="hidden-content-warning">
            <p style="color: #e74c3c;"><strong>⚠️ Warning:</strong> ${jsSeo.contentHiddenByJs} content element(s) are hidden by JavaScript</p>
            <p>Make sure critical SEO content is server-rendered or JavaScript-accessible to crawlers</p>
          </div>
        ` : ''}

        ${jsSeo.jsModifiedElements && jsSeo.jsModifiedElements.length > 0 ? `
          <div class="js-modifications">
            <h4>DOM Modifications:</h4>
            <div class="mods-list">
              ${jsSeo.jsModifiedElements.slice(0, 10).map(diff => `
                <div class="mod-item">${escapeHtml(diff)}</div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      ` : `
        <div class="static-content">
          <p>✓ No significant JavaScript-based rendering detected</p>
          <p>This page is fully rendered server-side (static)</p>
        </div>
      `}

      ${crp && (crp.ttfb > 0 || crp.firstContentfulPaint > 0) ? `
        <div class="critical-path">
          <h4>Critical Rendering Path</h4>
          <div class="crp-metrics">
            <div class="crp-metric">
              <span class="label">TTFB (Time to First Byte):</span>
              <span class="value">${crp.ttfb}ms</span>
            </div>
            <div class="crp-metric">
              <span class="label">FCP (First Contentful Paint):</span>
              <span class="value">${crp.firstContentfulPaint}ms</span>
            </div>
            <div class="crp-metric">
              <span class="label">LCP (Largest Contentful Paint):</span>
              <span class="value">${crp.largestContentfulPaint}ms</span>
            </div>
            <div class="crp-metric">
              <span class="label">CLS (Cumulative Layout Shift):</span>
              <span class="value">${crp.cumulativeLayoutShift}</span>
            </div>
          </div>
        </div>
      ` : ''}

      ${jsSeo.recommendations && jsSeo.recommendations.length > 0 ? `
        <div class="jsseo-recommendations">
          <h4>Recommendations</h4>
          <ul>
            ${jsSeo.recommendations.map(rec => `
              <li class="recommendation-${rec.priority}">
                <strong>${rec.priority.toUpperCase()}:</strong> ${escapeHtml(rec.text)}
              </li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
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
        <div class="ai-score-display">
          <div class="score-number">${aiVis.visibility}%</div>
          <div class="score-status">${aiVis.overallStatus}</div>
        </div>
      </div>

      <div class="ai-description">
        <p>This score measures how visible your content is to AI language models and crawlers.</p>
        <p>Higher scores indicate better indexability and knowledge base inclusion potential.</p>
      </div>

      ${aiVis.factors && aiVis.factors.length > 0 ? `
        <div class="ai-factors">
          <h4>Visibility Factors</h4>
          <div class="factors-grid">
            ${aiVis.factors.map(factor => `
              <div class="factor-item">
                <div class="factor-header">
                  <div class="factor-label">${escapeHtml(factor.label)}</div>
                  <div class="factor-score">${factor.score}/${factor.maxScore}</div>
                </div>
                <div class="factor-status status-${factor.status.toLowerCase()}">${factor.status}</div>
                <div class="factor-description">${escapeHtml(factor.description)}</div>
                <div class="factor-progress">
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: ${(factor.score / factor.maxScore) * 100}%"></div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `<p>No AI visibility factors computed</p>`}

      <div class="ai-recommendations">
        <h4>How to Improve AI Visibility</h4>
        <ul>
          <li>✓ Maintain comprehensive, well-structured content (1000+ words ideal)</li>
          <li>✓ Use proper semantic HTML and heading hierarchy</li>
          <li>✓ Add Schema.org structured data (JSON-LD format)</li>
          <li>✓ Ensure content is indexable (no noindex meta tags)</li>
          <li>✓ Optimize Core Web Vitals and page performance</li>
          <li>✓ Include recent publication/modification dates in schema</li>
          <li>✓ Build quality internal and external links</li>
          <li>✓ Ensure WCAG accessibility compliance</li>
        </ul>
      </div>
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
