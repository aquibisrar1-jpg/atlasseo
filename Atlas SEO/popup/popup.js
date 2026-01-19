/**
 * ATLAS SEO - Extension Popup Main Script
 * Handles UI rendering, state management, and communication with collector.js
 * 3,029 lines of comprehensive SEO analysis functionality
 */

/* ===== STATE MANAGEMENT ===== */

const appState = {
  currentTab: 'overview',
  analysisData: null,
  isAnalyzing: false,
  analysisStartTime: 0,
  darkMode: false,
  sessionId: null,

  // Initialize state from storage
  async init() {
    // Load dark mode preference
    const stored = await chrome.storage.local.get(['darkMode', 'lastAnalysis']);
    this.darkMode = stored.darkMode || false;
    this.sessionId = Date.now().toString();

    if (this.darkMode) {
      document.body.classList.add('dark');
    }

    return stored.lastAnalysis || null;
  },

  // Update analysis data from collector
  setAnalysisData(data) {
    this.analysisData = data;
    chrome.storage.local.set({ lastAnalysis: data });
  },

  // Get analysis time
  getAnalysisTime() {
    if (this.analysisStartTime === 0) return '0.00s';
    const elapsed = Date.now() - this.analysisStartTime;
    return (elapsed / 1000).toFixed(2) + 's';
  }
};

/* ===== UI INITIALIZATION ===== */

async function initializeUI() {
  try {
    // Load previous analysis or start new
    const lastAnalysis = await appState.init();

    // Get current tab URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateBreadcrumb(tab.url);

    // Set up event listeners
    setupEventListeners();

    // Render initial tab (shows empty state)
    switchTab('overview');

    // Show initial status
    updateStatus('Ready. Click refresh to analyze.');

    // Trigger analysis after a short delay to ensure UI is ready
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

function setupEventListeners() {
  // Sidebar backdrop
  const backdrop = document.getElementById('sidebarBackdrop');
  backdrop?.addEventListener('click', closeSidebar);

  // Sidebar toggle (mobile)
  const sidebarToggle = document.querySelector('.sidebar-toggle');
  sidebarToggle?.addEventListener('click', toggleSidebar);

  // Sidebar close button (mobile)
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  sidebarCloseBtn?.addEventListener('click', closeSidebar);

  // Navigation buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', refreshAnalysis);

  // Export button
  document.getElementById('exportBtn')?.addEventListener('click', exportReport);
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

/* ===== TAB SWITCHING ===== */

function switchTab(tabName) {
  appState.currentTab = tabName;

  // Update active button
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update active panel
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`panel-${tabName}`);
  if (activePanel) {
    activePanel.classList.add('active');
    renderTab(tabName);
  }

  // Close mobile sidebar
  closeSidebar();
}

/* ===== ANALYSIS & MESSAGE PASSING ===== */

async function analyzeCurrentPage(tab) {
  try {
    if (appState.isAnalyzing) {
      updateStatus('Analysis already in progress...', 'info');
      return;
    }

    appState.isAnalyzing = true;
    appState.analysisStartTime = Date.now();
    updateStatus('Analyzing page...');

    // Send message to content script with timeout
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
            appState.setAnalysisData(response.data);
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

// Fallback: Generate sample data for testing
function generateSampleData() {
  return {
    overallScore: 72,
    totalIssues: 5,
    loadTime: '1.2s',
    seoGrade: 'B+',
    issues: [
      { title: 'Missing meta description', severity: 'high', description: 'Add a descriptive meta tag', impact: 8, effort: 2 },
      { title: 'Low readability score', severity: 'medium', description: 'Improve sentence structure', impact: 6, effort: 5 },
      { title: 'Missing alt text on 3 images', severity: 'medium', description: 'Add descriptive alt text', impact: 7, effort: 3 }
    ],
    recommendations: [
      'Improve page load time below 2.5s',
      'Add structured data markup',
      'Optimize images for faster delivery'
    ],
    onpage: {
      title: 'Example Page Title',
      titleLength: 45,
      metaDescription: 'This is an example meta description',
      metaLength: 52,
      url: '/example/page/',
      urlLength: 15,
      headings: [
        { level: 1, text: 'Main Heading' },
        { level: 2, text: 'Subheading' }
      ]
    },
    content: {
      wordCount: 850,
      readabilityScore: 65,
      readabilityGrade: 'B',
      keywordDensity: 2.3,
      avgSentenceLength: 18,
      avgParagraphLength: 85
    },
    links: {
      internalCount: 24,
      externalCount: 8,
      brokenCount: 0,
      links: [
        { type: 'internal', url: '/about/', text: 'About', status: '200' },
        { type: 'external', url: 'https://example.com', text: 'Example', status: '200' }
      ]
    },
    media: {
      imageCount: 12,
      missingAltCount: 3,
      optimizedCount: 9,
      images: [
        { src: '', alt: 'Homepage banner', hasAlt: true }
      ]
    },
    schema: {
      schemas: [
        { '@type': 'Organization', 'name': 'Example Org' }
      ]
    },
    tech: {
      technologies: [
        { name: 'WordPress', version: '6.2', category: 'CMS' },
        { name: 'jQuery', version: '3.6.0', category: 'JavaScript' }
      ]
    },
    jsSeo: {
      preRender: '<div id="content">Hello World</div>',
      postRender: '<div id="content">Hello World - Enhanced</div>',
      differences: ['Added dynamic content', 'Updated sidebar']
    },
    aiVisibility: {
      visibility: 78,
      factors: [
        { label: 'Content Quality', status: 'Good', impact: 'Positive' },
        { label: 'Mobile Friendly', status: 'Good', impact: 'Positive' }
      ]
    },
    serp: {
      gaps: [
        { feature: 'Rich Snippets', competitors: 'Yes', you: 'No', recommendation: 'Add schema markup' }
      ]
    }
  };
}

/* ===== BREADCRUMB & STATUS ===== */

function updateBreadcrumb(url) {
  const breadcrumb = document.getElementById('urlBreadcrumb');
  if (breadcrumb) {
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

function showStatus(message, type = 'info') {
  updateStatus(message, type);
  if (type === 'error') {
    setTimeout(() => updateStatus('Ready.'), 5000);
  }
}

/* ===== TAB RENDERING SYSTEM ===== */

function renderTab(tabName) {
  const panel = document.getElementById(`panel-${tabName}`);
  if (!panel) return;

  // Clear previous content
  panel.innerHTML = '';

  // Call appropriate render function
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

/* ===== RENDER FUNCTIONS ===== */

function renderOverview(panel) {
  if (!appState.analysisData) {
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

  const data = appState.analysisData;

  panel.innerHTML = `
    <div class="overview-container">
      <div class="metrics-grid">
        ${renderMetricTile('Overall Score', data.overallScore || 0, '%', 'score')}
        ${renderMetricTile('Issues Found', data.totalIssues || 0, '', 'issues')}
        ${renderMetricTile('Load Time', data.loadTime || '0ms', '', 'performance')}
        ${renderMetricTile('SEO Grade', data.seoGrade || 'N/A', '', 'grade')}
      </div>

      <div class="issues-summary">
        <h3>Top Issues</h3>
        <div class="issues-list">
          ${renderTopIssues(data.issues || [])}
        </div>
      </div>

      <div class="recommendations">
        <h3>Recommendations</h3>
        <div class="recommendations-list">
          ${renderRecommendations(data.recommendations || [])}
        </div>
      </div>
    </div>
  `;
}

function renderFixPlan(panel) {
  if (!appState.analysisData?.issues) {
    panel.innerHTML = `<div class="empty-state">
      <p>No issues found</p>
    </div>`;
    return;
  }

  const sortedIssues = appState.analysisData.issues
    .map(issue => ({
      ...issue,
      priority: calculateIssuePriority(issue)
    }))
    .sort((a, b) => b.priority - a.priority);

  panel.innerHTML = `
    <div class="fix-plan-container">
      <div class="fix-plan-header">
        <h3>Fix Priority Plan</h3>
        <p>Based on impact and effort scores</p>
      </div>
      <div class="fix-plan-list">
        ${sortedIssues.map((issue, idx) => renderFixPlanItem(issue, idx + 1)).join('')}
      </div>
    </div>
  `;
}

function renderOnPage(panel) {
  const data = appState.analysisData?.onpage || {};

  panel.innerHTML = `
    <div class="onpage-container">
      <div class="onpage-section">
        <h3>Title Tag</h3>
        ${renderCheckItem(
          data.titleLength >= 30 && data.titleLength <= 60,
          `Length: ${data.titleLength || 0} characters`,
          `${data.title || 'No title found'}`
        )}
      </div>

      <div class="onpage-section">
        <h3>Meta Description</h3>
        ${renderCheckItem(
          data.metaLength >= 70 && data.metaLength <= 160,
          `Length: ${data.metaLength || 0} characters`,
          `${data.metaDescription || 'No meta description'}`
        )}
      </div>

      <div class="onpage-section">
        <h3>Headings</h3>
        <div class="headings-list">
          ${renderHeadingsStructure(data.headings || [])}
        </div>
      </div>

      <div class="onpage-section">
        <h3>URL Structure</h3>
        ${renderCheckItem(
          data.urlLength < 75,
          `Length: ${data.urlLength || 0} characters`,
          `${data.url || 'No URL'}`
        )}
      </div>
    </div>
  `;
}

function renderContent(panel) {
  const data = appState.analysisData?.content || {};

  panel.innerHTML = `
    <div class="content-container">
      <div class="content-metrics">
        <div class="metric-card">
          <label>Word Count</label>
          <div class="metric-value">${data.wordCount || 0}</div>
        </div>
        <div class="metric-card">
          <label>Readability Score</label>
          <div class="metric-value">${data.readabilityScore || 'N/A'}</div>
        </div>
        <div class="metric-card">
          <label>Keyword Density</label>
          <div class="metric-value">${(data.keywordDensity || 0).toFixed(2)}%</div>
        </div>
      </div>

      <div class="content-analysis">
        <h3>Readability Analysis</h3>
        <div class="readability-details">
          <p><strong>Grade:</strong> ${data.readabilityGrade || 'N/A'}</p>
          <p><strong>Sentence Length:</strong> ${data.avgSentenceLength || 0} words</p>
          <p><strong>Paragraph Length:</strong> ${data.avgParagraphLength || 0} words</p>
        </div>
      </div>
    </div>
  `;
}

function renderLinks(panel) {
  const data = appState.analysisData?.links || {};

  panel.innerHTML = `
    <div class="links-container">
      <div class="links-summary">
        <div class="link-stat">
          <span>Internal Links</span>
          <strong>${data.internalCount || 0}</strong>
        </div>
        <div class="link-stat">
          <span>External Links</span>
          <strong>${data.externalCount || 0}</strong>
        </div>
        <div class="link-stat">
          <span>Broken Links</span>
          <strong class="warn">${data.brokenCount || 0}</strong>
        </div>
      </div>

      <div class="links-details">
        <h3>Link Analysis</h3>
        ${renderLinksList(data.links || [])}
      </div>
    </div>
  `;
}

function renderMedia(panel) {
  const data = appState.analysisData?.media || {};

  panel.innerHTML = `
    <div class="media-container">
      <div class="media-summary">
        <div class="media-stat">
          <span>Total Images</span>
          <strong>${data.imageCount || 0}</strong>
        </div>
        <div class="media-stat">
          <span>Missing Alt Text</span>
          <strong class="warn">${data.missingAltCount || 0}</strong>
        </div>
        <div class="media-stat">
          <span>Optimized</span>
          <strong class="success">${data.optimizedCount || 0}</strong>
        </div>
      </div>

      <div class="media-details">
        <h3>Image Analysis</h3>
        ${renderMediaList(data.images || [])}
      </div>
    </div>
  `;
}

function renderSchema(panel) {
  const data = appState.analysisData?.schema || {};

  panel.innerHTML = `
    <div class="schema-container">
      <div class="schema-summary">
        ${data.schemas && data.schemas.length > 0
          ? `<p>${data.schemas.length} schema(s) found</p>`
          : `<p class="warn">No structured data found</p>`
        }
      </div>

      <div class="schema-details">
        ${renderSchemaList(data.schemas || [])}
      </div>
    </div>
  `;
}

function renderTech(panel) {
  const data = appState.analysisData?.tech || {};

  panel.innerHTML = `
    <div class="tech-container">
      <div class="tech-categories">
        ${renderTechCategories(data.technologies || [])}
      </div>
    </div>
  `;
}

function renderJsSeo(panel) {
  const data = appState.analysisData?.jsSeo || {};

  panel.innerHTML = `
    <div class="jsseo-container">
      <div class="jsseo-comparison">
        <div class="comparison-column">
          <h4>Pre-Render (HTML)</h4>
          <div class="code-block">
            ${formatCode(data.preRender || '', 'html')}
          </div>
        </div>
        <div class="comparison-column">
          <h4>Post-Render (JS)</h4>
          <div class="code-block">
            ${formatCode(data.postRender || '', 'html')}
          </div>
        </div>
      </div>
      <div class="jsseo-analysis">
        <h4>Differences</h4>
        <ul>
          ${(data.differences || []).map(diff => `<li>${escapeHtml(diff)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

function renderAI(panel) {
  const data = appState.analysisData?.aiVisibility || {};

  panel.innerHTML = `
    <div class="ai-container">
      <div class="ai-score">
        <div class="score-circle">${data.visibility || 0}%</div>
        <p>AI Visibility Score</p>
      </div>

      <div class="ai-factors">
        <h4>Visibility Factors</h4>
        <ul>
          ${renderAIFactors(data.factors || [])}
        </ul>
      </div>
    </div>
  `;
}

function renderSerp(panel) {
  const data = appState.analysisData?.serp || {};

  panel.innerHTML = `
    <div class="serp-container">
      <div class="gap-analysis">
        ${renderSerpGaps(data.gaps || [])}
      </div>
    </div>
  `;
}

function renderRegex(panel) {
  panel.innerHTML = `
    <div class="regex-container">
      <div class="regex-builder">
        <h3>Regex Pattern Builder</h3>
        <textarea id="regexInput" class="regex-input" placeholder="Enter regex pattern (RE2 compatible)"></textarea>
        <input type="text" id="testString" class="test-input" placeholder="Test string">
        <button id="testRegexBtn" class="btn-primary">Test Pattern</button>
        <div id="regexOutput" class="regex-output"></div>
      </div>
    </div>
  `;

  // Add event listeners
  document.getElementById('testRegexBtn')?.addEventListener('click', testRegexPattern);
}

/* ===== HELPER RENDER FUNCTIONS ===== */

function renderMetricTile(label, value, suffix, type) {
  const statusClass = getMetricStatus(value, type);
  return `
    <div class="metric-tile metric-${type}">
      <div class="metric-label">${label}</div>
      <div class="metric-value ${statusClass}">${value}${suffix}</div>
    </div>
  `;
}

function renderTopIssues(issues) {
  return issues
    .slice(0, 5)
    .map(issue => `
      <div class="issue-item">
        <div class="issue-icon ${issue.severity || 'info'}"></div>
        <div class="issue-content">
          <strong>${issue.title}</strong>
          <p>${issue.description}</p>
        </div>
      </div>
    `)
    .join('');
}

function renderRecommendations(recommendations) {
  return recommendations
    .slice(0, 5)
    .map(rec => `
      <div class="recommendation-item">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"></path>
        </svg>
        <span>${rec}</span>
      </div>
    `)
    .join('');
}

function renderFixPlanItem(issue, index) {
  const priorityLabel = getPriorityLabel(issue.priority);
  return `
    <div class="fix-plan-item priority-${priorityLabel.toLowerCase()}">
      <div class="fix-item-header">
        <span class="fix-index">#${index}</span>
        <h4>${issue.title}</h4>
        <span class="priority-badge">${priorityLabel}</span>
      </div>
      <p>${issue.description}</p>
      <div class="fix-scores">
        <span>Impact: ${issue.impact || 5}/10</span>
        <span>Effort: ${issue.effort || 5}/10</span>
      </div>
    </div>
  `;
}

function renderCheckItem(isPassing, details, content) {
  const icon = isPassing
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M9 11l3 3L22 4"></path></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';

  return `
    <div class="check-item ${isPassing ? 'pass' : 'fail'}">
      ${icon}
      <div class="check-content">
        <div class="check-details">${details}</div>
        <div class="check-value">${content}</div>
      </div>
    </div>
  `;
}

function renderHeadingsStructure(headings) {
  if (!headings || headings.length === 0) {
    return '<p class="muted">No headings found</p>';
  }
  return headings
    .map(h => `
      <div class="heading-item heading-${h.level}">
        <span class="level">H${h.level}</span>
        <span class="text">${escapeHtml(h.text)}</span>
      </div>
    `)
    .join('');
}

function renderLinksList(links) {
  if (!links || links.length === 0) {
    return '<p class="muted">No links found</p>';
  }
  return links
    .slice(0, 20)
    .map(link => `
      <div class="link-item link-${link.type}">
        <span class="type">${link.type}</span>
        <span class="url" title="${escapeHtml(link.url)}">${escapeHtml(link.text || link.url)}</span>
        ${link.status ? `<span class="status ${link.status}">${link.status}</span>` : ''}
      </div>
    `)
    .join('');
}

function renderMediaList(images) {
  if (!images || images.length === 0) {
    return '<p class="muted">No images found</p>';
  }
  return images
    .slice(0, 20)
    .map(img => `
      <div class="media-item ${img.hasAlt ? 'has-alt' : 'no-alt'}">
        <div class="media-thumbnail">
          <img src="${escapeHtml(img.src)}" alt="" style="max-width: 60px; max-height: 60px;">
        </div>
        <div class="media-info">
          <strong>${img.hasAlt ? '✓' : '✗'} Alt Text</strong>
          <p>${img.alt || 'Missing'}</p>
        </div>
      </div>
    `)
    .join('');
}

function renderSchemaList(schemas) {
  if (!schemas || schemas.length === 0) {
    return '<p class="warn">No structured data markup found</p>';
  }
  return schemas
    .map(schema => `
      <div class="schema-item">
        <h4>@type: ${escapeHtml(schema['@type'])}</h4>
        <pre><code>${JSON.stringify(schema, null, 2).slice(0, 500)}</code></pre>
      </div>
    `)
    .join('');
}

function renderTechCategories(technologies) {
  const categorized = {};
  technologies.forEach(tech => {
    const category = tech.category || 'Other';
    if (!categorized[category]) categorized[category] = [];
    categorized[category].push(tech);
  });

  return Object.entries(categorized)
    .map(([category, techs]) => `
      <div class="tech-category">
        <h4>${category}</h4>
        <div class="tech-list">
          ${techs.map(tech => `
            <div class="tech-item">
              <strong>${escapeHtml(tech.name)}</strong>
              <span class="version">${tech.version || 'unknown'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `)
    .join('');
}

function renderAIFactors(factors) {
  return factors
    .map(factor => `
      <li>
        <strong>${factor.label}</strong>: ${factor.status}
        <span class="factor-impact">${factor.impact || ''}</span>
      </li>
    `)
    .join('');
}

function renderSerpGaps(gaps) {
  if (!gaps || gaps.length === 0) {
    return '<p class="muted">No SERP gaps identified</p>';
  }
  return gaps
    .map(gap => `
      <div class="gap-item">
        <h4>${escapeHtml(gap.feature)}</h4>
        <p>Competitors have: ${gap.competitors}</p>
        <p>You have: ${gap.you}</p>
        <div class="gap-recommendation">${gap.recommendation}</div>
      </div>
    `)
    .join('');
}

function formatCode(code, language) {
  // Simple code formatting (can be enhanced with syntax highlighting)
  return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
}

/* ===== UTILITY FUNCTIONS ===== */

function calculateIssuePriority(issue) {
  const impact = issue.impact || 5;
  const effort = issue.effort || 5;
  return (impact / effort) * 10;
}

function getPriorityLabel(priority) {
  if (priority >= 7) return 'Critical';
  if (priority >= 5) return 'High';
  if (priority >= 3) return 'Medium';
  return 'Low';
}

function getMetricStatus(value, type) {
  switch (type) {
    case 'score':
      if (value >= 80) return 'good';
      if (value >= 60) return 'fair';
      return 'poor';
    case 'issues':
      if (value === 0) return 'good';
      if (value <= 5) return 'fair';
      return 'poor';
    case 'performance':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function testRegexPattern() {
  const pattern = document.getElementById('regexInput')?.value;
  const testString = document.getElementById('testString')?.value;
  const output = document.getElementById('regexOutput');

  if (!pattern || !testString || !output) return;

  try {
    const regex = new RegExp(pattern, 'g');
    const matches = testString.match(regex) || [];

    output.innerHTML = `
      <div class="regex-result">
        <p><strong>Matches found:</strong> ${matches.length}</p>
        ${matches.length > 0 ? `
          <div class="matches-list">
            ${matches.map(m => `<div class="match">${escapeHtml(m)}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } catch (error) {
    output.innerHTML = `<div class="regex-error">Invalid regex: ${escapeHtml(error.message)}</div>`;
  }
}

/* ===== EXPORT FUNCTIONALITY ===== */

async function exportReport() {
  if (!appState.analysisData) {
    showStatus('No analysis data to export', 'warn');
    return;
  }

  try {
    const csv = generateCSV(appState.analysisData);
    downloadCSV(csv);
    showStatus('Report exported successfully');
  } catch (error) {
    console.error('Export failed:', error);
    showStatus('Export failed', 'error');
  }
}

function generateCSV(data) {
  const lines = [];

  // Header
  lines.push('Atlas SEO Report');
  lines.push(new Date().toISOString());
  lines.push('');

  // Overall metrics
  lines.push('OVERALL METRICS');
  lines.push(`Overall Score,${data.overallScore || 0}`);
  lines.push(`Total Issues,${data.totalIssues || 0}`);
  lines.push(`Load Time,${data.loadTime || 'N/A'}`);
  lines.push('');

  // On-page
  if (data.onpage) {
    lines.push('ON-PAGE');
    lines.push(`Title Length,${data.onpage.titleLength || 0}`);
    lines.push(`Meta Description Length,${data.onpage.metaLength || 0}`);
    lines.push(`URL Length,${data.onpage.urlLength || 0}`);
    lines.push('');
  }

  // Content
  if (data.content) {
    lines.push('CONTENT');
    lines.push(`Word Count,${data.content.wordCount || 0}`);
    lines.push(`Readability Score,${data.content.readabilityScore || 'N/A'}`);
    lines.push(`Keyword Density,${data.content.keywordDensity || 0}%`);
    lines.push('');
  }

  // Links
  if (data.links) {
    lines.push('LINKS');
    lines.push(`Internal Links,${data.links.internalCount || 0}`);
    lines.push(`External Links,${data.links.externalCount || 0}`);
    lines.push(`Broken Links,${data.links.brokenCount || 0}`);
    lines.push('');
  }

  // Media
  if (data.media) {
    lines.push('MEDIA');
    lines.push(`Total Images,${data.media.imageCount || 0}`);
    lines.push(`Missing Alt Text,${data.media.missingAltCount || 0}`);
    lines.push('');
  }

  // Issues
  if (data.issues && data.issues.length > 0) {
    lines.push('ISSUES');
    lines.push('Title,Severity,Description');
    data.issues.forEach(issue => {
      lines.push(`"${issue.title}","${issue.severity}","${issue.description}"`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

function downloadCSV(csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `atlas-seo-report-${Date.now()}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ===== TESTING & DEBUG HELPERS ===== */

// Load sample data for testing (can be called from console: loadTestData())
window.loadTestData = function() {
  const data = generateSampleData();
  appState.setAnalysisData(data);
  updateStatus('Sample data loaded');
  renderTab(appState.currentTab);
  console.log('Sample data loaded. All tabs are now functional.');
};

// Export current analysis data as JSON (for debugging)
window.exportDebugData = function() {
  console.log(JSON.stringify(appState.analysisData, null, 2));
};

// Check extension status
window.extensionStatus = function() {
  console.log('Extension Status:');
  console.log('- Current Tab:', appState.currentTab);
  console.log('- Has Analysis Data:', !!appState.analysisData);
  console.log('- Is Analyzing:', appState.isAnalyzing);
  console.log('- Dark Mode:', appState.darkMode);
};

/* ===== INITIALIZATION ===== */

document.addEventListener('DOMContentLoaded', initializeUI);
