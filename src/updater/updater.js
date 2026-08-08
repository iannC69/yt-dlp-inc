const IGNORE_PATTERNS = [
  /^(da|dada|test|wip|temp|asdf|aaa+|bbb+|ok|done|x|\.)$/i,
  /^chore: release v\d+\.\d+\.\d+$/i,
  /^fix typo/i,
  /^update$/i,
  /^\d+$/,
];

function isUselessCommit(message) {
  const trimmed = message.trim();
  if (trimmed.length < 4) return true;
  return IGNORE_PATTERNS.some(pattern => pattern.test(trimmed));
}

async function generateReleaseDescription(version, rawCommits, geminiApiKey) {
  const cacheKey = `gemini-release-${version}`;
  
  // Check localStorage cache first
  const cached = localStorage.getItem(cacheKey);
  const cachedTs = localStorage.getItem(`${cacheKey}-ts`);
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  
  if (cached && cachedTs && (Date.now() - parseInt(cachedTs) < SEVEN_DAYS)) {
    return JSON.parse(cached);
  }

  const prompt = `
You are writing professional release notes for a desktop app called MediaDL.
Given these raw commit messages for version ${version}, generate:
1. One short release description (max 10 words, professional tone)
2. A cleaned list of meaningful changes (ignore "da", "test", "chore: release" etc.)
   Each change should start with "feat:", "fix:", "style:", "refactor:", or "chore:"
   and be written in clear English.

Raw commits:
${rawCommits.map(c => `- ${c.message}`).join('\n')}

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "description": "short release description here",
  "changes": [
    { "message": "feat: description of change" },
    { "message": "fix: description of fix" }
  ]
}
If there are truly no meaningful changes, return:
{ "description": "Internal maintenance and improvements", "changes": [] }
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 512 }
        })
      }
    );

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    // Cache for 7 days
    localStorage.setItem(cacheKey, JSON.stringify(result));
    localStorage.setItem(`${cacheKey}-ts`, Date.now().toString());
    return result;
  } catch (e) {
    console.error("Gemini fetch failed:", e);
    return { description: 'Internal maintenance', changes: [] };
  }
}

async function resolveAvatar(owner, repo, sha) {
  if (!sha || sha.length < 7) return null;
  const cacheKey = `avatar-${sha}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`);
    const data = await res.json();
    const url = data.author?.avatar_url || null;
    if (url) localStorage.setItem(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

async function processRelease(release, commits, geminiApiKey) {
  const filtered = commits.filter(c => !isUselessCommit(c.message));
  
  if (filtered.length > 0) {
    for (const c of filtered) {
      if (!c.avatarUrl && c.shortSha) {
        c.avatarUrl = await resolveAvatar('iannC69', 'yt-dlp-inc', c.shortSha);
      }
    }
    return {
      description: release.description || '',
      changes: filtered
    };
  }
  
  if (!geminiApiKey || geminiApiKey === 'your_key_here') {
    return { description: release.description || '', changes: [] };
  }

  const generated = await generateReleaseDescription(release.version, commits, geminiApiKey);
  return {
    description: generated.description,
    changes: generated.changes.map(c => ({
      message: c.message,
      shortSha: 'gemini',
      avatarUrl: null
    }))
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const currentVersionEl = document.getElementById('current-version');
  const latestVersionEl = document.getElementById('latest-version');
  const changelogContainer = document.getElementById('changelog-container');
  const updateDescription = document.getElementById('update-description');
  
  const btnDownload = document.getElementById('btn-download');
  const btnLater = document.getElementById('btn-later');
  const btnInstall = document.getElementById('btn-install');
  
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  // Fetch data via IPC
  const data = await window.updaterAPI.getReleaseData();
  const geminiApiKey = await window.updaterAPI.getGeminiKey();

  if (data) {
    currentVersionEl.textContent = `v${data.currentVersion}`;
    latestVersionEl.textContent = `v${data.latestVersion}`;
    
    // Process releases sequentially to allow API calls
    const processedReleases = [];
    for (const release of data.releases) {
      const processed = await processRelease(release, release.commits, geminiApiKey);
      processedReleases.push({
        ...release,
        description: processed.description || release.description,
        commits: processed.changes
      });
    }

    if (processedReleases.length > 0 && processedReleases[0].description) {
      updateDescription.textContent = `v${data.latestVersion} - ${processedReleases[0].description}`;
    } else {
      updateDescription.textContent = `v${data.latestVersion}`;
    }
    
    renderChangelog(processedReleases);
  }

  // Button Listeners
  btnLater.addEventListener('click', () => {
    window.updaterAPI.dismissUpdate();
  });

  btnDownload.addEventListener('click', () => {
    window.updaterAPI.downloadUpdate();
    btnDownload.style.display = 'none';
    btnLater.style.display = 'none';
    progressContainer.style.display = 'flex';
  });

  btnInstall.addEventListener('click', () => {
    window.updaterAPI.installUpdate();
  });

  // Progress Listeners
  window.updaterAPI.onProgress((progress) => {
    const percent = Math.round(progress.percent || 0);
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `Downloading... ${percent}%`;
  });

  window.updaterAPI.onDownloaded(() => {
    progressContainer.style.display = 'none';
    btnInstall.style.display = 'flex';
  });

  window.updaterAPI.onError((err) => {
    progressText.textContent = 'Download failed.';
    progressText.style.color = '#ff4a4a';
    progressFill.style.backgroundColor = '#ff4a4a';
  });

  // Escape to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.updaterAPI.dismissUpdate();
    }
  });

  function renderChangelog(releases) {
    changelogContainer.innerHTML = '';
    
    releases.forEach((release, index) => {
      const block = document.createElement('div');
      block.className = 'version-block';

      // Header
      const header = document.createElement('div');
      header.className = 'version-header';
      
      const dot = document.createElement('div');
      dot.className = `dot ${release.isLatest ? 'active' : 'inactive'}`;
      
      const badge = document.createElement('span');
      badge.className = `version-badge ${release.isLatest ? 'latest' : ''}`;
      badge.textContent = `v${release.version}`;
      
      header.appendChild(dot);
      header.appendChild(badge);
      block.appendChild(header);

      if (release.description) {
        const desc = document.createElement('div');
        desc.className = 'version-description';
        desc.textContent = release.description;
        block.appendChild(desc);
      }

      // Commits
      if (release.commits && release.commits.length > 0) {
        const title = document.createElement('div');
        title.className = 'changes-label';
        title.textContent = 'Changes';
        block.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'commit-list';

        release.commits.forEach(commit => {
          const item = document.createElement('li');
          item.className = 'commit-item';
          
          item.innerHTML = `
            ${commit.message} 
            <span class="commit-sha">(${commit.shortSha})</span>
            <span class="commit-dash">—</span>
          `;
          
          if (commit.avatarUrl) {
            const img = document.createElement('img');
            img.className = 'commit-avatar';
            img.src = commit.avatarUrl;
            img.alt = commit.authorName || 'User';
            img.title = commit.authorName || 'User';
            img.loading = 'lazy';
            img.onerror = function() { this.style.display = 'none'; this.nextElementSibling.style.display = 'flex'; };
            
            const fallback = document.createElement('div');
            fallback.className = 'commit-avatar-fallback';
            fallback.style.display = 'none';
            fallback.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path></svg>`;
            
            item.appendChild(img);
            item.appendChild(fallback);
          } else {
            const fallback = document.createElement('div');
            fallback.className = 'commit-avatar-fallback';
            fallback.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path></svg>`;
            item.appendChild(fallback);
          }
          
          list.appendChild(item);
        });
        
        block.appendChild(list);
      }

      changelogContainer.appendChild(block);
    });
  }
});
