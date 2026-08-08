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

  if (data) {
    currentVersionEl.textContent = `v${data.currentVersion}`;
    latestVersionEl.textContent = `v${data.latestVersion}`;
    
    if (data.releases && data.releases.length > 0) {
      updateDescription.textContent = `v${data.latestVersion} - ${data.releases[0].description}`;
    }
    
    renderChangelog(data.releases);
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

      const desc = document.createElement('div');
      desc.className = 'version-description';
      desc.textContent = release.description;
      block.appendChild(desc);

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
            img.alt = commit.authorName;
            img.title = commit.authorName;
            img.loading = 'lazy';
            img.onerror = function() { this.style.display = 'none'; };
            item.appendChild(img);
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
