const fs = require('fs');
let code = fs.readFileSync('src/App.jsx', 'utf8');

// 1. Imports
code = code.replace(
  "import AuroraBackground from './AuroraBackground';",
  "import AuroraBackground from './AuroraBackground';\nimport BackgroundBubbles from './components/BackgroundBubbles';"
);

// 2. States
code = code.replace(
  "const [liveBackground, setLiveBackground] = useState(() => storage.getItem('live_background') !== 'false');",
  `const [liveBackground, setLiveBackground] = useState(() => storage.getItem('live_background') !== 'false');
  const [ambientBubbles, setAmbientBubbles] = useState(() => storage.getItem('ambient_bubbles') !== 'false');
  const [glassUI, setGlassUI] = useState(() => storage.getItem('glass_ui') === 'true');
  const [ytAuroraSpeed, setYtAuroraSpeed] = useState(() => storage.getItem('yt_aurora_speed') || 'normal');

  useEffect(() => {
    if (glassUI) document.body.classList.add('glass-ui-active');
    else document.body.classList.remove('glass-ui-active');
  }, [glassUI]);`
);

// 3. customWallpaper background variables logic in useEffect
code = code.replace(
  "const hexToRgb = (hex) => {",
  `const isWallpaper = !!customTheme.customWallpaper;
    const wpOpacity = customTheme.wallpaperOpacity !== undefined ? customTheme.wallpaperOpacity : 85;
    const applyBg = (hexColor) => {
      if (!isWallpaper) return hexColor;
      return \`rgba(\${hexToRgb(hexColor)}, \${wpOpacity / 100})\`;
    };
    const hexToRgb = (hex) => {`
);

code = code.replace(
  "root.style.setProperty('--bg-base',       customTheme.bgBase || '#080a0f');",
  "root.style.setProperty('--bg-base',       applyBg(customTheme.bgBase || '#080a0f'));"
);
code = code.replace(
  "root.style.setProperty('--nav-color',     customTheme.navColor || '#06080e');",
  "root.style.setProperty('--nav-color',     isWallpaper && wpOpacity === 0 ? 'rgba(6, 8, 14, 0.4)' : applyBg(customTheme.navColor || '#06080e'));"
);
// replace applying to ytBg, spBg, mdBg, acBg
code = code.replace("root.style.setProperty('--theme-bg',      customTheme.ytBg || '#080a0f');", "root.style.setProperty('--theme-bg',      applyBg(customTheme.ytBg || '#080a0f'));");
code = code.replace("root.style.setProperty('--sp-bg',         customTheme.spBg || '#060a06');", "root.style.setProperty('--sp-bg',         applyBg(customTheme.spBg || '#060a06'));");
code = code.replace("root.style.setProperty('--md-bg',         customTheme.mdBg || '#07060f');", "root.style.setProperty('--md-bg',         applyBg(customTheme.mdBg || '#07060f'));");
code = code.replace("root.style.setProperty('--ac-bg',         customTheme.acBg || '#060910');", "root.style.setProperty('--ac-bg',         applyBg(customTheme.acBg || '#060910'));");

// 4. Pass props to YoutubeDownloader
code = code.replace(
  "{activeIdx === 0 && <YoutubeDownloader activeJobId={activeYoutubeJob} setShowLibrary={setShowLibrary} />}",
  "{activeIdx === 0 && <YoutubeDownloader activeJobId={activeYoutubeJob} setShowLibrary={setShowLibrary} auroraSpeed={ytAuroraSpeed} />}"
);

// 5. Add inline style to app-root
code = code.replace(
  "className={`app-root${dragOver ? ' app-root--drag' : ''}`}",
  "className={`app-root${dragOver ? ' app-root--drag' : ''}`}\n      style={customTheme.customWallpaper ? { backgroundImage: `url(${customTheme.customWallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundAttachment: 'fixed' } : {}}"
);

// 6. Background layers
code = code.replace(
  "{liveBackground && (",
  `{ambientBubbles && <BackgroundBubbles colors={[customTheme.primary || '#ef4444', customTheme.secondary || '#3b82f6', customTheme.ytAccent || '#a855f7']} />}\n      {liveBackground && !customTheme.customWallpaper && (`
);

// 7. Settings UI
const settingsReplacement = `
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px', background: 'rgba(255,255,255,0.02)', borderRadius: '7px', marginTop: '4px' }}>
                            <span className="cp-color-label" style={{ flex: 1, minWidth: 'auto', whiteSpace: 'normal', color: '#e4e4e7' }}>Custom PC Wallpaper</span>
                            {customTheme.customWallpaper ? (
                              <button
                                className="settings-hw-btn active"
                                onClick={() => setCustomTheme(prev => ({ ...prev, customWallpaper: null }))}
                                style={{ width: 'auto', padding: '4px 12px', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                className="settings-hw-btn"
                                onClick={() => {
                                  const input = document.createElement('input');
                                  input.type = 'file';
                                  input.accept = 'image/*';
                                  input.onchange = (e) => {
                                    const file = e.target.files[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = (ev) => {
                                      setCustomTheme(prev => ({ ...prev, customWallpaper: ev.target.result }));
                                    };
                                    reader.readAsDataURL(file);
                                  };
                                  input.click();
                                }}
                                style={{ width: 'auto', padding: '4px 12px' }}
                              >
                                Browse PC
                              </button>
                            )}
                          </div>
                          {customTheme.customWallpaper && (
                            <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '7px', marginTop: '4px', gap: '10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="cp-color-label" style={{ whiteSpace: 'normal', color: '#e4e4e7' }}>Theme Overlay Intensity</span>
                                <span style={{ fontSize: '0.8rem', color: '#a1a1aa', fontWeight: 600 }}>{customTheme.wallpaperOpacity !== undefined ? customTheme.wallpaperOpacity : 85}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                value={customTheme.wallpaperOpacity !== undefined ? customTheme.wallpaperOpacity : 85}
                                onChange={(e) => setCustomTheme(prev => ({ ...prev, wallpaperOpacity: parseInt(e.target.value) }))}
                                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--primary, #ef4444)' }}
                              />
                            </div>
                          )}

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px', background: 'rgba(255,255,255,0.02)', borderRadius: '7px', marginTop: '4px' }}>
                            <span className="cp-color-label" style={{ flex: 1, minWidth: 'auto', whiteSpace: 'normal', color: '#e4e4e7' }}>Ambient Color Bubbles</span>
                            <button className={\`settings-hw-btn \${ambientBubbles ? 'active' : ''}\`} onClick={() => { const newVal = !ambientBubbles; setAmbientBubbles(newVal); storage.setItem('ambient_bubbles', newVal.toString()); }} style={{ width: 'auto', padding: '4px 12px' }}>
                              {ambientBubbles ? 'Enabled' : 'Disabled'}
                            </button>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px', background: 'rgba(255,255,255,0.02)', borderRadius: '7px', marginTop: '4px' }}>
                            <span className="cp-color-label" style={{ flex: 1, minWidth: 'auto', whiteSpace: 'normal', color: '#e4e4e7' }}>Premium Glassmorphism</span>
                            <button className={\`settings-hw-btn \${glassUI ? 'active' : ''}\`} onClick={() => { const newVal = !glassUI; setGlassUI(newVal); storage.setItem('glass_ui', newVal.toString()); }} style={{ width: 'auto', padding: '4px 12px' }}>
                              {glassUI ? 'Enabled' : 'Disabled'}
                            </button>
                          </div>
                          <div className="cp-color-row" style={{ marginTop: '12px' }}>
                            <span className="cp-color-label" style={{ flex: 1, minWidth: 'auto' }}>YouTube Aurora Speed</span>
                            <div className="settings-hw-toggle">
                              {[
                                { value: 'off', label: 'Off' },
                                { value: 'slow', label: 'Slow' },
                                { value: 'normal', label: 'Normal' },
                                { value: 'fast', label: 'Fast' },
                              ].map(s => (
                                <button key={s.value} className={\`settings-hw-btn \${ytAuroraSpeed === s.value ? 'active' : ''}\`} onClick={() => { setYtAuroraSpeed(s.value); storage.setItem('yt_aurora_speed', s.value); }} style={{ padding: '4px 10px' }}>
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </div>
`;

code = code.replace(
  "{liveBackground ? 'Enabled' : 'Disabled'}\n                            </button>\n                          </div>",
  "{liveBackground ? 'Enabled' : 'Disabled'}\n                            </button>\n                          </div>" + settingsReplacement
);

fs.writeFileSync('src/App.jsx', code);
