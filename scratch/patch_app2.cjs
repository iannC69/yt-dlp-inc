const fs = require('fs');
let c = fs.readFileSync('src/App.jsx', 'utf8');

const newModalCode = `            <motion.div 
              className="settings-modal-content control-panel-mode"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="control-panel-sidebar">
                <h2>Setări</h2>
                <button className={\`cp-tab \${activeSettingsTab === 'general' ? 'active' : ''}\`} onClick={() => setActiveSettingsTab('general')}>General</button>
                <button className={\`cp-tab \${activeSettingsTab === 'theme' ? 'active' : ''}\`} onClick={() => setActiveSettingsTab('theme')}>Temă & Aspect</button>
                <button className={\`cp-tab \${activeSettingsTab === 'spotify' ? 'active' : ''}\`} onClick={() => setActiveSettingsTab('spotify')}>Spotify API</button>
                <button className={\`cp-tab \${activeSettingsTab === 'system' ? 'active' : ''}\`} onClick={() => setActiveSettingsTab('system')}>Sistem & Motor</button>
              </div>

              <div className="control-panel-body">
                <div className="control-panel-header">
                  <h3 className="cp-title">
                    {activeSettingsTab === 'general' && 'General'}
                    {activeSettingsTab === 'theme' && 'Personalizare Temă'}
                    {activeSettingsTab === 'spotify' && 'Conexiune Spotify'}
                    {activeSettingsTab === 'system' && 'Sistem & Motor'}
                  </h3>
                  <button className="settings-modal-close" onClick={() => setShowSettingsModal(false)}>
                    <X size={18} />
                  </button>
                </div>
                
                <div className="settings-scroll-content">
                  {activeSettingsTab === 'general' && (
                    <div className="settings-section">
                      <h3>Director descărcări (Local)</h3>
                      <div className="settings-path-picker">
                        <input
                          type="text"
                          readOnly
                          value={customPath || 'Mod Implicit (Folderul Aplicației/downloads)'}
                          className="settings-input"
                          title={customPath}
                        />
                        <button className="settings-save-btn" onClick={handleSelectFolder} style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                          <FolderOpen size={16} style={{ display: 'inline', marginRight: '4px' }} /> Folder
                        </button>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'theme' && (
                    <div className="settings-section">
                      <h3>Culori (Hex)</h3>
                      <div className="settings-theme-pickers">
                        <div className="settings-color-picker-item">
                          <label>Accent Principal</label>
                          <div className="settings-color-input-wrapper">
                            <input
                              type="color"
                              value={customTheme.primary}
                              onChange={(e) => setCustomTheme(prev => ({ ...prev, primary: e.target.value }))}
                            />
                            <span>{customTheme.primary.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="settings-color-picker-item">
                          <label>Culoare Fundal</label>
                          <div className="settings-color-input-wrapper">
                            <input
                              type="color"
                              value={customTheme.bgBase}
                              onChange={(e) => setCustomTheme(prev => ({ ...prev, bgBase: e.target.value }))}
                            />
                            <span>{customTheme.bgBase.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="settings-color-picker-item">
                          <button
                            className="settings-save-btn"
                            style={{ width: 'auto', padding: '0.5rem 1rem', background: '#475569' }}
                            onClick={() => setCustomTheme({ primary: '#ef4444', secondary: '#3b82f6', bgBase: '#080a0f' })}
                          >
                            <RefreshCw size={14} style={{ display: 'inline', marginRight: '4px' }}/> Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'spotify' && (
                    <div className="settings-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                         <h3 style={{ margin: 0 }}>Credentials</h3>
                         <button className="settings-help-btn" onClick={() => setShowHelp(!showHelp)} title="How to get these?">
                           <HelpCircle size={16} />
                         </button>
                      </div>

                      <AnimatePresence>
                        {showHelp && (
                          <motion.div 
                            className="settings-help-box"
                            initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                            animate={{ height: 'auto', opacity: 1, marginBottom: 16 }}
                            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                            style={{ overflow: 'hidden' }}
                          >
                            <h4>How to get your credentials:</h4>
                            <ol>
                              <li>Go to the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard <ExternalLink size={10} /></a> and log in.</li>
                              <li>Click <strong>Create app</strong>.</li>
                              <li>Name your app, and set the Redirect URI strictly to: <code>http://127.0.0.1:5174/</code></li>
                              <li>Check the <strong>Web API</strong> box and accept the terms to save.</li>
                              <li>Click <strong>Settings</strong> to reveal your Client ID and Client Secret.</li>
                            </ol>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="settings-field">
                        <label>Spotify Client ID</label>
                        <input 
                          type="text" 
                          value={spotifyClientId} 
                          onChange={e => setSpotifyClientId(e.target.value)} 
                          placeholder="Paste Client ID..."
                        />
                      </div>
                      <div className="settings-field">
                        <label>Spotify Client Secret</label>
                        <input 
                          type="text" 
                          value={spotifyClientSecret} 
                          onChange={e => setSpotifyClientSecret(e.target.value)} 
                          placeholder="Paste Client Secret..."
                        />
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === 'system' && (
                    <div className="settings-section">
                      <div className="settings-field">
                        <label>Download Speed Preset</label>
                        <select 
                          value={downloadPreset} 
                          onChange={e => setDownloadPreset(e.target.value)}
                          className="settings-select"
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.05)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.1)', outline: 'none' }}
                        >
                          <option value="AUTO" style={{ color: 'black' }}>AUTO (AI Smart Optimizer)</option>
                          <option value="ULTRA_PERFORMANCE" style={{ color: 'black' }}>Ultra Performance (Fastest, High CPU)</option>
                          <option value="HIGH_PERFORMANCE" style={{ color: 'black' }}>High Performance</option>
                          <option value="BALANCED" style={{ color: 'black' }}>Balanced</option>
                          <option value="ECO" style={{ color: 'black' }}>Eco (Slow, Low CPU)</option>
                        </select>
                      </div>
                      <div className="settings-field">
                        <label>Hardware Acceleration (FFmpeg)</label>
                        <select 
                          value={hardwareAcceleration} 
                          onChange={e => setHardwareAcceleration(e.target.value)}
                          className="settings-select"
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.05)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.1)', outline: 'none' }}
                        >
                          <option value="NONE" style={{ color: 'black' }}>CPU Only (Recommended for Audio)</option>
                          <option value="AUTO" style={{ color: 'black' }}>Auto (Let FFmpeg decide)</option>
                          <option value="CUDA" style={{ color: 'black' }}>NVIDIA GPU (CUDA / NVENC)</option>
                          <option value="AMF" style={{ color: 'black' }}>AMD GPU (AMF)</option>
                          <option value="QSV" style={{ color: 'black' }}>Intel GPU (QSV)</option>
                        </select>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>GPU encoding mostly speeds up Video conversion. MP3 is always CPU.</p>
                      </div>
                      <div className="settings-field">
                        <label>Actualizare Engine (yt-dlp)</label>
                        <button 
                          className="settings-save-btn" 
                          style={{ width: '100%', background: '#3b82f6', marginTop: '4px' }}
                          onClick={handleUpdateEngine}
                        >
                          <RefreshCw size={16} style={{ display: 'inline', marginRight: '6px' }} /> Verifică pentru Actualizări
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="control-panel-footer">
                  <button className="settings-save-btn" onClick={saveSettings}>
                    Salvează Setările
                  </button>
                </div>
              </div>
            </motion.div>`;

// Let's use string split and replace
const parts = c.split('<motion.div \n              className="settings-modal-content"');
if (parts.length > 1) {
  const before = parts[0];
  const afterStart = parts[1];
  const endMarker = '</motion.div>\n          </motion.div>\n        )}\n      </AnimatePresence>';
  const endParts = afterStart.split(endMarker);
  
  if (endParts.length > 1) {
     c = before + newModalCode + '\n          </motion.div>\n        )}\n      </AnimatePresence>' + endParts[1];
     fs.writeFileSync('src/App.jsx', c, 'utf8');
     console.log('Successfully patched App.jsx');
  } else {
     console.log('End marker not found');
  }
} else {
  console.log('Start marker not found');
}
