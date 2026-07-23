import fs from 'fs'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import os from 'os'
import https from 'https'
import NodeID3 from 'node-id3'
import { resolveSpotifyMetadata, resolveSpotifyFallback, parseSpotifyEmbed, getAnonymousSpotifyToken } from './spotify-api.js'
import { getOptimalDownloadConfig } from './smart-optimizer.js'
import { createBatchEngine, getBatchPerformanceProfile } from './batch-engine.js'


export function configureRoutes(middlewares, { appDir, binDir, ffmpegBin: _ffmpegBin }) {
  const binPath   = path.join(binDir, 'yt-dlp.exe')
  const ffmpegBin = _ffmpegBin || path.join(binDir, 'ffmpeg.exe')
  const ffmpegDir = path.dirname(ffmpegBin)
  const spotdlBin = path.join(binDir, process.platform === 'win32' ? 'spotdl.exe' : 'spotdl')
  const aiConfig  = getOptimalDownloadConfig()
  const COLLECTION_LIMIT = 5000
  const configPath    = path.resolve(appDir, 'config.json')
  const scheduledPath = path.resolve(appDir, 'scheduled.json')
  const activeJobs    = new Map()
  const metrics       = { uptimeStart: Date.now(), totalHits: 0, successfulDownloads: 0, failedDownloads: 0 }
  const MAX_CONCURRENT_JOBS = 2
  let runningJobsCount = 0
  const urlMetaCache   = new Map()
  const URL_CACHE_TTL  = 24 * 60 * 60 * 1000
  const URL_CACHE_MAX  = 500
  const activeMassYtdlDownloads = new Map()
  const spotifyActiveDownloads  = new Map()

  function isYouTubeUrl(url) { return /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be)\/.+/.test(url) }
  function parseYtDlpError(s) {
    if (!s) return null
    if (s.includes('HTTP Error 429') || s.includes('Too Many Requests')) return 'YouTube Rate Limit. Încearcă mai târziu sau folosește un VPN.'
    if (s.includes("Sign in to confirm") || s.includes('bot protection')) return 'YouTube a blocat cererea (Anti-Bot). Folosește un VPN sau actualizează cookie-urile.'
    if (s.includes('No space left')) return 'Nu mai este spațiu pe disc!'
    if (s.includes('Video unavailable') || s.includes('Private video')) return 'Videoclipul nu este disponibil sau este privat.'
    if (s.includes('members on level')) return 'Disponibil doar pentru membrii canalului.'
    return null
  }
  function sanitizeFilename(n) { return n.replace(/[/\\:*?"<>|]/g,'_').replace(/\.+$/,'').trim().substring(0,200) }
  function getConfig() { if (fs.existsSync(configPath)) { try { return JSON.parse(fs.readFileSync(configPath,'utf8')) } catch {} } return { customPath:'' } }
  function saveConfig(cfg) { fs.writeFileSync(configPath, JSON.stringify(cfg,null,2),'utf8') }
  function ensureDownloadsDir(custom) { const cfg=getConfig(); let d=custom||cfg.customPath; if(!d) d=path.join(appDir,'downloads'); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d }
  function getScheduled() { if (fs.existsSync(scheduledPath)) { try { return JSON.parse(fs.readFileSync(scheduledPath,'utf8')) } catch {} } return [] }
  function saveScheduled(j) { fs.writeFileSync(scheduledPath,JSON.stringify(j,null,2),'utf8') }
  function addScheduledJob(d) { const j=getScheduled(); j.push({...d,id:Date.now().toString()}); saveScheduled(j) }
  function sendSse(res,d) { res.write(`data: ${JSON.stringify(d)}\n\n`) }
  function scheduleDownloadCleanup(fp,ms=15*60*1000) { setTimeout(()=>fs.rm(fp,{recursive:true,force:true},()=>{}),ms) }
  async function createZipFromDirectory(dirPath,zipPath) {
    const { Archiver } = await import('archiver')
    return new Promise((resolve,reject) => {
      const out=fs.createWriteStream(zipPath); const arc=new Archiver('zip',{zlib:{level:0}})
      out.on('close',resolve); arc.on('error',reject); arc.pipe(out)
      for(const item of fs.readdirSync(dirPath)) {
        const ip=path.join(dirPath,item); const st=fs.statSync(ip)
        if(st.isDirectory()) { for(const f of fs.readdirSync(ip)) arc.file(path.join(ip,f),{name:`${item}/${f}`}) }
        else arc.file(ip,{name:item})
      }
      arc.finalize()
    })
  }
  function parseJsonBody(req) { return new Promise(r=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{r(JSON.parse(b||'{}'))}catch{r({})} }) }) }
  function cacheGet(u) { const e=urlMetaCache.get(u); if(!e) return null; if(Date.now()-e.timestamp>URL_CACHE_TTL){urlMetaCache.delete(u);return null} return e.data }
  function cacheSet(u,d) { if(urlMetaCache.size>=URL_CACHE_MAX) urlMetaCache.delete(urlMetaCache.keys().next().value); urlMetaCache.set(u,{data:d,timestamp:Date.now()}) }

  function processQueue() {
    const q=Array.from(activeJobs.entries()).filter(([,j])=>j.queueStatus==='queued'&&!j.isPaused&&!j.isCancelled)
    while(runningJobsCount<MAX_CONCURRENT_JOBS&&q.length>0) {
      const [id,job]=q.shift(); job.queueStatus='running'; runningJobsCount++; broadcast(id,{queueStatus:'running'}); spawnYtDlp(id)
    }
  }
  function enqueueJob(id) { const j=activeJobs.get(id); if(!j) return; j.queueStatus='queued'; broadcast(id,{queueStatus:'queued'}); processQueue() }
  function broadcast(id,d) { const j=activeJobs.get(id); if(!j) return; Object.assign(j.state,d); for(const c of j.clients) { try{sendSse(c,d)}catch{} } }
  function finishJob(id,d) {
    if(d.error) metrics.failedDownloads++; else metrics.successfulDownloads++
    const j=activeJobs.get(id)
    if(!d.error&&j&&d.finalFilename) d.jobInfo={title:j.state.title||d.finalFilename,thumbnail:j.state.thumbnail,format:j.type==='single'?(j.state.format||'unknown'):'playlist',filename:d.finalFilename,isArchive:d.isArchive,source:'youtube',date:new Date().toISOString(),id:Date.now().toString()}
    broadcast(id,{...d,done:true})
    if(j) { j.clients.forEach(c=>c.end()); j.clients.clear(); setTimeout(()=>activeJobs.delete(id),10*60*1000) }
  }

  function spawnYtDlp(jobId) {
    const job=activeJobs.get(jobId); if(!job) return
    job.process=spawn(binPath,job.args); let settled=false
    let curItem=job.state.currentItem||0,totItems=job.state.totalItems||(job.type==='playlist'?job.expectedCount:1),finalFn=job.state.finalFilename||''
    const onOut=text=>{
      if(job.isPaused||job.isCancelled) return
      if(job.type==='playlist') {
        const m=text.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i),mp=text.match(/\[download\]\s+([\d.]+)%/)
        if(m){curItem=Number(m[1]);totItems=Number(m[2])}
        const prog=totItems?((curItem-1)/totItems)*100+((mp?Number(mp[1]):0)/totItems):0
        broadcast(jobId,{progress:Math.min(prog,95),currentItem:curItem,totalItems:totItems,status:totItems?`Se descarcă piesa ${curItem} din ${totItems}`:'Se pregătește...'})
      } else {
        const dm=text.match(/Destination:\s*(.*)/),am=text.match(/\]\s+(.*?)\s*has already been downloaded/),mm=text.match(/Merging formats into "(.*)"/),pm=text.match(/\[download\]\s+([\d.]+)%/)
        if(dm?.[1]) finalFn=path.basename(dm[1].trim()); if(am?.[1]) finalFn=path.basename(am[1].trim()); if(mm?.[1]) finalFn=path.basename(mm[1].trim())
        let prog=job.state.progress; if(pm) prog=parseFloat(pm[1])
        broadcast(jobId,{raw:text,progress:prog,filename:finalFn})
      }
    }
    job.process.stdout.on('data',c=>c.toString().split('\n').forEach(l=>{if(l.trim())onOut(l.trim())}))
    let fullStderr=''
    job.process.stderr.on('data',c=>{const t=c.toString();fullStderr+=t;if(t.includes('[download]'))onOut(t.trim())})
    job.process.on('close',async code=>{
      runningJobsCount=Math.max(0,runningJobsCount-1); processQueue()
      if(settled) return; settled=true; job.process=null
      if(job.isCancelled||job.isPaused) return
      if(code!==0){const ke=parseYtDlpError(fullStderr);if(ke){if(job.collectionDir){try{fs.rmSync(job.collectionDir,{recursive:true,force:true})}catch{}}return finishJob(jobId,{error:ke})}}
      if(job.type==='single') {
        if(code!==0) finishJob(jobId,{error:'Eroare la descărcare. Cod: '+code})
        else { const fp=path.join(job.downloadsDir,finalFn); scheduleDownloadCleanup(fp); finishJob(jobId,{code,finalFilename:finalFn,downloadUrl:`/api/download-file?file=${encodeURIComponent(finalFn)}`}) }
      } else {
        const dlf=fs.existsSync(job.collectionDir)?fs.readdirSync(job.collectionDir):[]
        if(!dlf.length){try{fs.rmSync(job.collectionDir,{recursive:true,force:true})}catch{};finishJob(jobId,{error:'Nu s-a descărcat niciun fișier.'});return}
        broadcast(jobId,{progress:96,status:'Se configurează folderul...'})
        if(job.state.thumbnail){try{
          const cb=Buffer.from(await(await fetch(job.state.thumbnail)).arrayBuffer()); const jp=path.join(job.collectionDir,'folder.jpg'); fs.writeFileSync(jp,cb)
          if(process.platform==='win32'){
            const ip=path.join(job.collectionDir,'album.ico')
            await new Promise(r=>{spawn(ffmpegBin,['-y','-i',jp,'-vf','scale=256:256',ip]).on('close',r)})
            if(fs.existsSync(ip)){
              fs.writeFileSync(path.join(job.collectionDir,'desktop.ini'),"[.ShellClassInfo]\r\nIconResource=album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n")
              await new Promise(r=>spawn('attrib',['+s',job.collectionDir]).on('close',r))
              await new Promise(r=>spawn('attrib',['+s','+h',path.join(job.collectionDir,'desktop.ini')]).on('close',r))
              spawn('ie4uinit.exe',['-show']); spawn('powershell',['-Command','$shell=New-Object -ComObject Shell.Application;$shell.Windows()|ForEach-Object{$_.Refresh()}'])
              fs.writeFileSync(path.join(job.collectionDir,'ApplyFolderIcon.bat'),`@echo off\r\nattrib +s "%~dp0."\r\nattrib +s +h "%~dp0desktop.ini"\r\nie4uinit.exe -show\r\npause\r\n`)
            }
          }
        }catch(e){console.error('Thumbnail error:',e)}}
        finishJob(jobId,{progress:100,finalFilename:path.basename(job.collectionDir),isArchive:false,collectionTitle:job.state.title||path.basename(job.collectionDir)})
      }
    })
    job.process.on('error',err=>{runningJobsCount=Math.max(0,runningJobsCount-1);processQueue();if(settled)return;settled=true;job.process=null;if(job.isCancelled||job.isPaused)return;if(job.collectionDir){try{fs.rmSync(job.collectionDir,{recursive:true,force:true})}catch{}};finishJob(jobId,{error:err.message||'Eroare.'})})
  }

  function isGoodMatch(a,b){if(!a||!b)return false;const x=a.toLowerCase().trim(),y=b.toLowerCase().trim();if(x.includes(y)||y.includes(x))return true;const wa=x.split(/\s+/),wb=y.split(/\s+/);return wa.filter(w=>w.length>3&&wb.includes(w)).length>0}
  function httpsGet(url){return new Promise((res,rej)=>{https.get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch{res({})}})}).on('error',rej)})}
  async function fetchItunesMetadata(title,artist){try{const d=await httpsGet(`https://itunes.apple.com/search?term=${encodeURIComponent(title+' '+artist)}&entity=song&limit=5&country=US`);for(const r of(d.results||[])){if(isGoodMatch(artist,r.artistName))return{title:r.trackName,artist:r.artistName,album:r.collectionName,year:r.releaseDate?.substring(0,4)||'',coverUrl:r.artworkUrl100?.replace('100x100bb','640x640bb')||null,source:'itunes'}}}catch{};return null}
  async function fetchYouTubeMusicMetadata(title,artist){const q=`${title} ${artist} Topic`;return new Promise(resolve=>{const p=spawn(binPath,['--dump-json','--no-playlist','--no-warnings',`ytsearch1:${q}`],{env:{...process.env,PYTHONIOENCODING:'utf-8'}});let s='';p.stdout.on('data',c=>s+=c);p.on('close',()=>{try{const i=JSON.parse(s);const u=i.uploader||i.channel||'';if(!isGoodMatch(artist,u.replace(' - Topic','')))return resolve(null);resolve({title:i.title,artist,album:i.album||'',year:i.release_year?.toString()||i.upload_date?.substring(0,4)||'',coverUrl:i.thumbnail||null,source:'youtube_music'})}catch{resolve(null)}});p.on('error',()=>resolve(null));setTimeout(()=>{try{p.kill()}catch{};resolve(null)},10000)})}

  const scheduledJobTimer=setInterval(()=>{const j=getScheduled();const now=new Date();let ch=false;j.forEach(job=>{if(!job.started&&job.runAt&&new Date(job.runAt)<=now){job.started=true;ch=true;try{const id=job.id;const td=ensureDownloadsDir(null);if(job.type==='single'){const bf=path.join(td,`batch-${id}.txt`);fs.writeFileSync(bf,(job.items||[]).join('\n'),'utf8');const args=['--batch-file',bf,'--paths',td,'--embed-metadata','--embed-thumbnail'];if(job.format==='audio')args.push('-x','--audio-format',(job.formatStr||'mp3').split(':')[0]||'mp3','--audio-quality','0');else args.push('-f',job.formatStr||'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b');args.push('-o','%(title)s.%(ext)s');activeJobs.set(id,{id,type:'single',args,clients:new Set(),downloadsDir:td,state:{progress:0,status:'Se pregătește...',currentItem:0,totalItems:1}});enqueueJob(id)}}catch(err){console.error('Scheduled job failed:',err)}}});if(ch)saveScheduled(j)},60000)
  scheduledJobTimer.unref?.()

  // ── Setup wizard endpoints ───────────────────────────────────────────────
  const setupMarker = path.join(appDir, 'setup_complete')

  middlewares.use('/api/setup/status', (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname !== '/') return next()
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ complete: fs.existsSync(setupMarker) }))
  })

  middlewares.use('/api/setup/complete', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname !== '/' || req.method !== 'POST') return next()
    try {
      const body = await parseJsonBody(req)
      fs.writeFileSync(setupMarker, '')
      // Persist Spotify creds + preferences into config.json
      let cfg = {}
      try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
      if (body.clientId)     cfg.SPOTIFY_CLIENT_ID     = body.clientId
      if (body.clientSecret) cfg.SPOTIFY_CLIENT_SECRET = body.clientSecret
      if (body.audioFormat)  cfg.audioFormat            = body.audioFormat
      if (body.audioQuality) cfg.audioQuality           = body.audioQuality
      if (body.customPath)   cfg.customPath             = body.customPath
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
  })

  // ── Routes ──────────────────────────────────────────────────────────────

  middlewares.use('/api/ytdl',(req,res,next)=>{metrics.totalHits++;next()})

  middlewares.use('/api/ytdl/get-config',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(getConfig()))})

  middlewares.use('/api/ytdl/select-folder',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const ps=`Add-Type -AssemblyName System.windows.forms\n$f=New-Object System.Windows.Forms.FolderBrowserDialog\n$f.Description='Select download folder'\n$f.ShowNewFolderButton=$true\nif($f.ShowDialog()-eq'OK'){Write-Output $f.SelectedPath}`;const c=spawn('powershell',['-NoProfile','-Command',ps]);let s='';c.stdout.on('data',d=>s+=d);c.on('close',()=>{const p=s.trim();if(p){saveConfig({customPath:p});res.end(JSON.stringify({success:true,path:p}))}else res.end(JSON.stringify({success:false}))})})

  middlewares.use('/api/ytdl/open-folder',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const t=u.searchParams.get('target');if(t){const dl=ensureDownloadsDir(u.searchParams.get('customPath'));let tp=path.join(dl,t);if(!fs.existsSync(tp)){const cl=t.replace(/[^a-zA-Z0-9]/g,'').toLowerCase();const fm=fs.readdirSync(dl).find(f=>f.replace(/[^a-zA-Z0-9]/g,'').toLowerCase()===cl);if(fm)tp=path.join(dl,fm);else{res.statusCode=404;return res.end(JSON.stringify({success:false,error:'File not found'}))}};spawn('explorer.exe',['/select,',tp])}else spawn('explorer.exe',[ensureDownloadsDir(u.searchParams.get('customPath'))]);res.end(JSON.stringify({success:true}))})

  middlewares.use('/api/ytdl/scheduled',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(getScheduled().filter(j=>!j.started)))})

  middlewares.use('/api/active-jobs',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const yt=Array.from(activeJobs.values()).map(j=>({id:j.id,title:j.state?.title||j.state?.status||'YouTube download',thumbnail:j.state?.thumbnail||null,filename:j.state?.finalFilename||null,format:j.state?.format||(j.type==='playlist'?'Playlist':'Video'),percent:Number(j.state?.progress||0),status:j.state?.done?(j.state?.error?'failed':'done'):(j.queueStatus==='queued'?'queued':'active'),error:j.state?.error||null}));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({youtube:yt,spotify:[]}))})

  middlewares.use('/api/ytdl/job-status',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const j=activeJobs.get(u.searchParams.get('jobId'));res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');if(!j){sendSse(res,{error:'Job not found or expired'});return res.end()};j.clients.add(res);sendSse(res,j.state);req.on('close',()=>j.clients.delete(res))})

  middlewares.use('/api/ytdl/job-action',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const j=activeJobs.get(u.searchParams.get('jobId'));const a=u.searchParams.get('action');if(!j){res.statusCode=404;return res.end(JSON.stringify({error:'Job not found'}))};if(a==='pause'){if(!j.isPaused&&!j.state.done&&j.process){j.isPaused=true;j.process.kill();broadcast(u.searchParams.get('jobId'),{isPaused:true,status:'Pauză.'})}}else if(a==='resume'){if(j.isPaused&&!j.state.done){j.isPaused=false;broadcast(u.searchParams.get('jobId'),{isPaused:false,status:'Se reia...'});spawnYtDlp(u.searchParams.get('jobId'))}}else if(a==='cancel'){j.isCancelled=true;if(j.process)j.process.kill();if(j.collectionDir){try{fs.rmSync(j.collectionDir,{recursive:true,force:true})}catch{}};finishJob(u.searchParams.get('jobId'),{error:'Anulat.'});activeJobs.delete(u.searchParams.get('jobId'))}else{res.statusCode=400;return res.end(JSON.stringify({error:'Invalid action'}))};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true}))})

  middlewares.use('/api/ytdl/info',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const vid=u.searchParams.get('url');if(!vid){res.statusCode=400;return res.end(JSON.stringify({error:'No URL'}))};if(!fs.existsSync(binPath)){res.statusCode=500;return res.end(JSON.stringify({error:'yt-dlp not found.'}))};const poToken=getConfig().youtubePoToken||'';const extArgs=poToken?`youtube:player_client=android,web;po_token=${poToken}`:'youtube:player_client=android,web';let args=['--dump-json','--no-playlist','--playlist-items','1','--extractor-args',extArgs,vid];const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.splice(args.length-1,0,'--cookies',cp);const child=spawn(binPath,args);let ds='',es='';child.stdout.on('data',c=>ds+=c);child.stderr.on('data',c=>es+=c);const kt=setTimeout(()=>{try{child.kill()}catch{};if(!res.headersSent){res.statusCode=500;res.end(JSON.stringify({error:'Timeout.'}))}},30000);child.on('close',async code=>{clearTimeout(kt);if(res.headersSent)return;if(code!==0){res.statusCode=500;return res.end(JSON.stringify({error:parseYtDlpError(es)||'yt-dlp failed.',details:es}))};try{const info=JSON.parse(ds);const ah=new Set();(info.formats||[]).forEach(f=>{if(f.height&&f.height>=360)ah.add(f.height)});let at=info.channel_thumbnail||info.uploader_thumbnail||null;if(!at&&(info.channel_url||info.uploader_url)){try{const cr=await fetch(info.channel_url||info.uploader_url,{headers:{'User-Agent':'Mozilla/5.0'}});const ch=await cr.text();const am=ch.match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i)||ch.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);at=am?.[1]?.replace(/\\u0026/g,'&').replace(/&amp;/g,'&')||null}catch{}}; const isM=/music\.youtube\.com/i.test(vid)||/youtube:music|music/i.test(info.extractor_key||'');const hasC=Boolean(info.playlist_count||info.n_entries||info._type==='playlist'||info.playlist_id);const isP=/[?&]list=/i.test(vid);const ct=hasC||(isM&&(hasC||isP))?(isM?'album':'playlist'):(isM?'track':'video');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({title:info.title,thumbnail:info.thumbnail,duration:info.duration,uploader:info.uploader||info.channel||null,artistThumbnail:at,contentType:ct,platform:isM?'youtube_music':'youtube',album:info.album||info.playlist_title||null,albumArtist:info.album_artist||info.artist||info.uploader||info.channel||null,trackNumber:Number(info.track_number||info.playlist_index)||null,trackCount:Number(info.playlist_count||info.n_entries)||null,releaseYear:info.release_year||(info.release_date?String(info.release_date).slice(0,4):null),viewCount:info.view_count||null,uploadDate:info.upload_date||null,availableHeights:Array.from(ah).sort((a,b)=>b-a)}))}catch{res.statusCode=500;res.end(JSON.stringify({error:'Parse error'}))}})})

  middlewares.use('/api/ytdl/smart-download',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();if(req.method!=='POST'){res.statusCode=405;return res.end('Method Not Allowed')};let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{const d=JSON.parse(b);const{items,format,scope,title,scheduleTime,formatStr}=d;if(!items?.length){res.statusCode=400;return res.end(JSON.stringify({error:'No items'}))};if(scheduleTime){const[sh,sm]=scheduleTime.split(':').map(Number);let r=new Date();r.setHours(sh,sm,0,0);if(r<=new Date())r.setDate(r.getDate()+1);addScheduledJob({type:'single',items,format,scope,title,formatStr,runAt:r.toISOString()});res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({scheduled:true,runAt:r.toISOString()}))};const jid=Date.now().toString();const dl=ensureDownloadsDir(u.searchParams.get('customPath'));const cd=path.join(dl,`youtube-playlist-${jid}`);const td=scope==='playlist'?cd:dl;if(!fs.existsSync(td))fs.mkdirSync(td,{recursive:true});const bf=path.join(td,`batch-${jid}.txt`);fs.writeFileSync(bf,items.join('\n'),'utf8');let args=format==='audio'?['-x','--audio-format','mp3','--audio-quality','0','-o',path.join(td,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir]:['-f','bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best','--merge-output-format','mp4','-o',path.join(td,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir];if(format==='audio')args.push('--ppa','ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\\\,ih):min(iw\\\\,ih)');args.push('-a',bf,'--newline','--embed-metadata','--embed-thumbnail','--extractor-args', getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web','--extractor-retries','5','--fragment-retries','10','--retry-sleep','linear=1::2','--add-header','Accept-Language:en-US,en;q=0.9',);const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.push('--cookies',cp);activeJobs.set(jid,{id:jid,type:scope==='playlist'?'playlist':'single',args,downloadsDir:dl,collectionDir:scope==='playlist'?cd:undefined,batchFile:bf,clients:new Set(),isPaused:false,isCancelled:false,state:{progress:0,status:'Se pregătește...',done:false,isPaused:false,totalItems:items.length,title,thumbnail:d.thumbnail}});spawnYtDlp(jid);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jobId:jid}))}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}})})

  middlewares.use('/api/ytdl/download',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const jid=u.searchParams.get('jobId');if(!jid){res.statusCode=400;return res.end('Missing jobId')};if(activeJobs.has(jid)){res.statusCode=400;return res.end('Job exists.')};const vid=u.searchParams.get('url');const fmt=u.searchParams.get('format')||'video:bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';const sched=u.searchParams.get('scheduleTime');const title=u.searchParams.get('title')||'';const thumb=u.searchParams.get('thumbnail')||'';const preset=u.searchParams.get('preset');const hwaccel=u.searchParams.get('hwaccel')||'NONE';const lac=getOptimalDownloadConfig(preset==='AUTO'?null:preset);if(!vid){res.statusCode=400;return res.end('No URL')};if(sched){const[sh,sm]=sched.split(':').map(Number);let r=new Date();r.setHours(sh,sm,0,0);if(r<=new Date())r.setDate(r.getDate()+1);addScheduledJob({type:'single',url:vid,format:fmt,scheduleTime:sched,runAt:r.toISOString(),title,thumbnail:thumb});res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({scheduled:true}))};res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');const dl=ensureDownloadsDir(u.searchParams.get('customPath'));let args;if(fmt.startsWith('audio:')){const[,af,aq]=fmt.split(':');args=af==='wav'?['-x','--audio-format','wav','-o',path.join(dl,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir,vid]:af==='vorbis'?['-x','--audio-format','vorbis','--audio-quality',aq||'0','-o',path.join(dl,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir,vid]:['-x','--audio-format','mp3','--audio-quality',aq||'0','-o',path.join(dl,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir,vid]}else if(fmt.startsWith('video:')){args=['-f',fmt.substring(6),'--merge-output-format','mp4','-o',path.join(dl,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir,vid]}else{args=['-f','bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best','--merge-output-format','mp4','-o',path.join(dl,'%(title)s.%(ext)s'),'--ffmpeg-location',ffmpegDir,vid]};if(fmt.startsWith('audio:'))args.push('--ppa','ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\\\,ih):min(iw\\\\,ih)');args.push('--no-playlist','--newline','--embed-metadata','--embed-thumbnail','--extractor-args', getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web','--extractor-retries','5','--fragment-retries','10','--retry-sleep','linear=1::2','--add-header','Accept-Language:en-US,en;q=0.9','-N',String(lac.ytdlpConcurrentFragments));let fa=`-threads ${lac.ffmpegThreads}`;if(hwaccel==='AUTO')fa='-hwaccel auto '+fa;else if(hwaccel==='CUDA')fa='-hwaccel cuda '+fa;else if(hwaccel==='AMF')fa='-hwaccel d3d11va '+fa;else if(hwaccel==='QSV')fa='-hwaccel qsv '+fa;args.push('--postprocessor-args',`ffmpeg:${fa}`);const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.push('--cookies',cp);activeJobs.set(jid,{id:jid,type:'single',args,downloadsDir:dl,clients:new Set([res]),isPaused:false,isCancelled:false,state:{progress:0,status:'Se pregătește...',done:false,isPaused:false,title,thumbnail:thumb}});spawnYtDlp(jid);req.on('close',()=>{const j=activeJobs.get(jid);if(j)j.clients.delete(res)})})

  middlewares.use('/api/ytdl/collection-info',async(req,res,next)=>{const u=new URL(req.url,'http://'+req.headers.host);if(u.pathname!=='/')return next();const vid=u.searchParams.get('url');if(!vid||!isYouTubeUrl(vid)){res.statusCode=400;return res.end(JSON.stringify({error:'Link YouTube invalid.'}))};try{const pl=await new Promise((resolve,reject)=>{const poToken=getConfig().youtubePoToken||'';const extArgs=poToken?`youtube:player_client=android,web;po_token=${poToken}`:'youtube:player_client=android,web';let args=['--dump-single-json','--flat-playlist','-i','--playlist-end',String(COLLECTION_LIMIT+1),'--extractor-args',extArgs,vid];const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.splice(args.length-1,0,'--cookies',cp);const c=spawn(binPath,args);let so='',se='',settled=false;const t=setTimeout(()=>{if(settled)return;settled=true;c.kill();reject(new Error('Timeout.'))},30000);c.stdout.on('data',d=>so+=d);c.stderr.on('data',d=>se+=d);c.on('error',e=>{if(!settled){settled=true;clearTimeout(t);reject(e)}});c.on('close',code=>{if(settled)return;settled=true;clearTimeout(t);if(code!==0&&!so.trim()){const ke=parseYtDlpError(se.trim());return reject(new Error(ke||se.trim()||'yt-dlp error'))};try{resolve(JSON.parse(so))}catch{reject(new Error('Parse error'))}})});const en=(pl.entries||[]).filter(Boolean);if(!en.length&&pl._type!=='playlist')throw new Error('No playlist found.');const cnt=Number(pl.playlist_count||pl.n_entries||en.length);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({title:pl.title||pl.playlist_title||'YouTube Playlist',count:cnt,downloadableCount:Math.min(cnt||en.length,COLLECTION_LIMIT),isTruncated:cnt>COLLECTION_LIMIT,entries:en.slice(0,COLLECTION_LIMIT).map((e,i)=>({id:e.id,index:i+1,title:e.title||'Video fără titlu',uploader:e.uploader||e.channel||null,duration:e.duration||null}))}))}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}})

  middlewares.use('/api/ytdl/collection-download',(req,res,next)=>{const u=new URL(req.url,'http://'+req.headers.host);if(u.pathname!=='/')return next();const jid=u.searchParams.get('jobId');if(!jid){res.statusCode=400;return res.end('Missing jobId')};if(activeJobs.has(jid)){res.statusCode=400;return res.end('Job exists.')};const vid=u.searchParams.get('url');const fmt=u.searchParams.get('format')||'video:bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';const sel=u.searchParams.get('selectedItems');const sched=u.searchParams.get('scheduleTime');const title=u.searchParams.get('title')||'';const thumb=u.searchParams.get('thumbnail')||'';const hwaccel=u.searchParams.get('hwaccel')||'NONE';if(!vid||!isYouTubeUrl(vid)||!sel){res.statusCode=400;return res.end('Invalid.')};if(sched){const[sh,sm]=sched.split(':').map(Number);let r=new Date();r.setHours(sh,sm,0,0);if(r<=new Date())r.setDate(r.getDate()+1);addScheduledJob({type:'playlist',url:vid,format:fmt,selectedItems:sel,scheduleTime:sched,runAt:r.toISOString(),title,thumbnail:thumb});res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({scheduled:true}))};res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');const dl=ensureDownloadsDir(u.searchParams.get('customPath'));const cd=path.join(dl,'youtube-playlist-'+jid);fs.mkdirSync(cd,{recursive:true});const ot=path.join(cd,'%(playlist_index)03d - %(title)s.%(ext)s');let args;if(fmt.startsWith('audio:')){const[,af,aq]=fmt.split(':');const vaf=['mp3','wav','vorbis'].includes(af)?af:'mp3';const vaq=/^\d+$/.test(aq||'')?aq:'0';args=['-x','--audio-format',vaf,'-o',ot,'--ffmpeg-location',ffmpegDir];if(vaf!=='wav')args.splice(3,0,'--audio-quality',vaq)}else{const vf=fmt.startsWith('video:')?fmt.substring(6):'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';args=['-f',vf,'--merge-output-format','mp4','-o',ot,'--ffmpeg-location',ffmpegDir]};if(fmt.startsWith('audio:'))args.push('--ppa','ThumbnailsConvertor+ffmpeg_o:-vf crop=min(iw\\\\,ih):min(iw\\\\,ih)');args.push('-i','--yes-playlist','--playlist-items',sel,'--restrict-filenames','--newline','--embed-metadata','--embed-thumbnail','--extractor-args', getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web','--extractor-retries','5','--fragment-retries','10','--retry-sleep','linear=1::2','--add-header','Accept-Language:en-US,en;q=0.9','-N',String(aiConfig.ytdlpConcurrentFragments));let fa=`-threads ${aiConfig.ffmpegThreads}`;if(hwaccel==='AUTO')fa='-hwaccel auto '+fa;else if(hwaccel==='CUDA')fa='-hwaccel cuda '+fa;else if(hwaccel==='AMF')fa='-hwaccel d3d11va '+fa;else if(hwaccel==='QSV')fa='-hwaccel qsv '+fa;args.push('--postprocessor-args',`ffmpeg:${fa}`,vid);const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.splice(args.length-1,0,'--cookies',cp);activeJobs.set(jid,{id:jid,type:'playlist',args,downloadsDir:dl,collectionDir:cd,expectedCount:sel.split(',').length,clients:new Set([res]),isPaused:false,isCancelled:false,state:{progress:0,status:'Se pregătește playlistul...',done:false,isPaused:false,title,thumbnail:thumb}});spawnYtDlp(jid);req.on('close',()=>{const j=activeJobs.get(jid);if(j)j.clients.delete(res)})})

  middlewares.use('/api/ytdl/local-thumbnail',(req,res,next)=>{const u=new URL(req.url,'http://'+req.headers.host);if(u.pathname!=='/')return next();const file=u.searchParams.get('file');if(!file||file.includes('..')||file.includes('/')||file.includes('\\')){res.statusCode=400;return res.end('Invalid')};const fp=path.join(ensureDownloadsDir(u.searchParams.get('customPath')),file);const blank=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');if(!fs.existsSync(fp)){res.setHeader('Content-Type','image/gif');res.setHeader('Cache-Control','public, max-age=86400');return res.end(blank)};if(fs.statSync(fp).isDirectory()){const jp=path.join(fp,'folder.jpg');if(fs.existsSync(jp)){res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control','public, max-age=86400');return fs.createReadStream(jp).pipe(res)};res.setHeader('Content-Type','image/gif');res.setHeader('Cache-Control','public, max-age=86400');return res.end(blank)};const p=spawn(ffmpegBin,['-i',fp,'-map','0:v','-c:v','copy','-f','image2pipe','-']);let ho=false;p.stdout.on('data',c=>{if(!ho){res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','public, max-age=86400');ho=true};res.write(c)});p.on('close',()=>{if(!ho){res.setHeader('Content-Type','image/gif');res.setHeader('Cache-Control','public, max-age=86400');res.end(blank)}else res.end()});p.on('error',()=>{if(!ho){res.statusCode=500;res.end('Error')}})})

  middlewares.use('/api/download-file',(req,res,next)=>{const u=new URL(req.url,'http://'+req.headers.host);if(u.pathname!=='/')return next();const file=u.searchParams.get('file');if(!file||file.includes('..')||file.includes('/')||file.includes('\\')){res.statusCode=400;return res.end('Invalid')};const dl=ensureDownloadsDir(u.searchParams.get('customPath'));let tp=path.join(dl,file);if(!fs.existsSync(tp)){const cl=file.replace(/[^a-zA-Z0-9]/g,'').toLowerCase();const fm=fs.readdirSync(dl).find(f=>f.replace(/[^a-zA-Z0-9]/g,'').toLowerCase()===cl);if(fm)tp=path.join(dl,fm);else{res.statusCode=404;return res.end('File not found')}};const on=u.searchParams.get('outName');let dfn=path.basename(tp);if(on?.trim()){const cn=on.trim().replace(/[^a-zA-Z0-9_ .-]/g,'');const ext=path.extname(file)||'.mp3';dfn=cn.endsWith(ext)?cn:`${cn}${ext}`};const st=fs.statSync(tp);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':st.size,'Content-Disposition':`attachment; filename="${dfn}"`});const rs=fs.createReadStream(tp);rs.pipe(res);rs.on('end',()=>scheduleDownloadCleanup(tp,60*60*1000));rs.on('error',()=>{if(!res.headersSent){res.statusCode=500;res.end('Error')}})})

  middlewares.use('/api/ytdl/system-status',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();try{const dl=ensureDownloadsDir(u.searchParams.get('customPath'));const st=fs.statfsSync(dl);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({freeSpace:st.bfree*st.bsize,totalMem:os.totalmem(),freeMem:os.freemem(),activeJobs:activeJobs.size,uptime:Date.now()-metrics.uptimeStart,totalHits:metrics.totalHits,successfulDownloads:metrics.successfulDownloads,failedDownloads:metrics.failedDownloads}))}catch{res.statusCode=500;res.end(JSON.stringify({error:'Status error'}))}})

  middlewares.use('/api/audio-cutter/select-source',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const ps=`Add-Type -AssemblyName System.Windows.Forms\n$d=New-Object System.Windows.Forms.OpenFileDialog\n$d.Title='Select audio file'\n$d.Filter='Audio files|*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus;*.webm|All files|*.*'\nif($d.ShowDialog()-eq'OK'){Write-Output $d.FileName}`;const c=spawn('powershell',['-NoProfile','-Command',ps],{windowsHide:true});let s='';c.stdout.on('data',d=>s+=d);c.on('close',()=>{const sp=s.trim();if(!sp)return res.end(JSON.stringify({success:false}));if(!fs.existsSync(sp)){res.statusCode=404;return res.end(JSON.stringify({error:'File not found.'}))};const pb=spawn(ffmpegBin,['-i',sp],{windowsHide:true});let se='';pb.stderr.on('data',d=>se+=d);pb.on('close',()=>{const dm=se.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);const dur=dm?Number(dm[1])*3600+Number(dm[2])*60+Number(dm[3]):0;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,path:sp,name:path.basename(sp),extension:path.extname(sp).slice(1),duration:dur}))})})})

  middlewares.use('/api/audio-cutter/cut',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();if(req.method!=='POST'){res.statusCode=405;return res.end(JSON.stringify({error:'POST only'}))};const b=await parseJsonBody(req);const sp=typeof b.sourcePath==='string'?b.sourcePath:'';const st=Number(b.start);const en=Number(b.end);const fmt=['mp3','m4a','wav','flac'].includes(b.format)?b.format:'mp3';const on=sanitizeFilename(String(b.outputName||'audio-clip')).replace(/\.[^.]+$/,'')||'audio-clip';const ae=new Set(['.mp3','.m4a','.aac','.wav','.flac','.ogg','.opus','.webm']);if(!sp||!ae.has(path.extname(sp).toLowerCase())||!fs.existsSync(sp)){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid source file.'}))};if(!Number.isFinite(st)||!Number.isFinite(en)||st<0||en<=st){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid time range.'}))};const fn=`${on}-${Date.now()}.${fmt}`;const op=path.join(ensureDownloadsDir(u.searchParams.get('customPath')),fn);const ca=fmt==='mp3'?['-codec:a','libmp3lame','-q:a','0']:fmt==='m4a'?['-codec:a','aac','-b:a','256k']:fmt==='flac'?['-codec:a','flac']:['-codec:a','pcm_s16le'];const args=['-y','-ss',String(st),'-to',String(en),'-i',sp,'-map_metadata','0','-vn',...ca,op];const p=spawn(ffmpegBin,args,{windowsHide:true});let se='';p.stderr.on('data',c=>se+=c);p.on('error',e=>{res.statusCode=500;res.end(JSON.stringify({error:`FFmpeg start failed: ${e.message}`}))});p.on('close',code=>{if(code!==0||!fs.existsSync(op)){res.statusCode=500;return res.end(JSON.stringify({error:`FFmpeg failed: ${se.slice(-400)}`}))};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,filename:fn,title:on}))})})

  middlewares.use('/api/audio-cutter/stream',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const fp=u.searchParams.get('path');if(!fp){res.statusCode=400;return res.end('Missing path')};const ae=new Set(['.mp3','.m4a','.aac','.wav','.flac','.ogg','.opus','.webm','.wma']);const ext=path.extname(fp).toLowerCase();if(!ae.has(ext)||!fs.existsSync(fp)){res.statusCode=403;return res.end('Forbidden')};const mm={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.wav':'audio/wav','.flac':'audio/flac','.ogg':'audio/ogg','.opus':'audio/opus','.webm':'audio/webm','.wma':'audio/x-ms-wma'};const st=fs.statSync(fp);res.setHeader('Content-Type',mm[ext]||'audio/mpeg');res.setHeader('Content-Length',st.size);res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','no-cache');fs.createReadStream(fp).pipe(res)})

  middlewares.use('/api/audio-cutter/export',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();if(req.method!=='POST'){res.statusCode=405;return res.end(JSON.stringify({error:'POST only'}))};const b=await parseJsonBody(req);const sp=typeof b.sourcePath==='string'?b.sourcePath:'';const st=Number(b.start)||0;const en=Number(b.end);const fmt=['mp3','m4a','wav','flac'].includes(b.format)?b.format:'mp3';const on=sanitizeFilename(String(b.outputName||'audio-clip')).replace(/\.[^.]+$/,'')||'audio-clip';const fi=Math.max(0,Number(b.fadeIn)||0);const fo=Math.max(0,Number(b.fadeOut)||0);const vol=Number(b.volume)||0;const spd=Math.min(2,Math.max(0.5,Number(b.speed)||1));const norm=Boolean(b.normalize);const meta=b.metadata||{};const ae=new Set(['.mp3','.m4a','.aac','.wav','.flac','.ogg','.opus','.webm']);if(!sp||!ae.has(path.extname(sp).toLowerCase())||!fs.existsSync(sp)){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid source.'}))};if(!Number.isFinite(en)||en<=st){res.statusCode=400;return res.end(JSON.stringify({error:'Invalid range.'}))};const dur=en-st;const filters=[];if(fi>0)filters.push(`afade=t=in:st=0:d=${fi.toFixed(3)}`);if(fo>0)filters.push(`afade=t=out:st=${Math.max(0,dur-fo).toFixed(3)}:d=${fo.toFixed(3)}`);if(vol!==0)filters.push(`volume=${vol}dB`);if(spd!==1)filters.push(`atempo=${spd.toFixed(4)}`);if(norm)filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');const ca=fmt==='mp3'?['-codec:a','libmp3lame','-q:a','0']:fmt==='m4a'?['-codec:a','aac','-b:a','256k']:fmt==='flac'?['-codec:a','flac']:['-codec:a','pcm_s16le'];const fn=`${on}-${Date.now()}.${fmt}`;const op=path.join(ensureDownloadsDir(u.searchParams.get('customPath')),fn);const args=['-y','-ss',String(st),'-i',sp,'-t',String(dur),'-map_metadata','0','-vn'];if(filters.length)args.push('-af',filters.join(','));args.push(...ca);if(meta.title)args.push('-metadata',`title=${meta.title}`);if(meta.artist)args.push('-metadata',`artist=${meta.artist}`);if(meta.album)args.push('-metadata',`album=${meta.album}`);if(meta.track)args.push('-metadata',`track=${meta.track}`);args.push('-id3v2_version','3',op);const p=spawn(ffmpegBin,args,{windowsHide:true});let se='';p.stderr.on('data',c=>se+=c);p.on('error',e=>{if(!res.headersSent){res.statusCode=500;res.end(JSON.stringify({error:`FFmpeg: ${e.message}`}))}});p.on('close',code=>{if(code!==0||!fs.existsSync(op)){res.statusCode=500;return res.end(JSON.stringify({error:`FFmpeg error (${code}): ${se.slice(-500)}`}))};scheduleDownloadCleanup(op,60*60*1000);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,filename:fn,title:on}))})})

  let pendingSpotifyToken = null;

  middlewares.use('/api/spotify-callback', async (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    
    const code = u.searchParams.get('code');
    if (!code) {
      res.statusCode = 400;
      return res.end('Missing code parameter');
    }

    const cid = process.env.VITE_SPOTIFY_CLIENT_ID || '71eaf6d9db064a05a8600b17c310d31a';
    const cs = process.env.VITE_SPOTIFY_CLIENT_SECRET || '3d8380457ea54ec3b98e4d8ffa08e5e7';
    const redirectUri = `http://127.0.0.1:5174/api/spotify-callback`;

    if (!cid || !cs) {
      res.statusCode = 500;
      return res.end('Missing Spotify credentials');
    }

    try {
      const tr = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${cid}:${cs}`).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      });
      const d = await tr.json();
      if (!tr.ok) throw new Error(d.error_description || d.error || 'Token fetch failed');
      
      pendingSpotifyToken = d;
      res.setHeader('Content-Type', 'text/html');
      res.end(`<html>
        <body style="background:#080a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;">
            <svg viewBox="0 0 24 24" fill="#1DB954" width="64" height="64" style="margin-bottom:1rem;"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            <h1 style="color:#1DB954;margin:0;">Spotify Connected!</h1>
            <p style="color:#94a3b8;margin-top:0.5rem;">Authentication successful. You can safely close this tab and return to MediaDL.</p>
            <script>setTimeout(() => window.close(), 3000)</script>
          </div>
        </body>
      </html>`);
    } catch (e) {
      res.statusCode = 500;
      res.end(`<html><body style="background:#080a0f;color:#fff;font-family:sans-serif;padding:2rem;"><h1>Error</h1><p>${e.message}</p></body></html>`);
    }
  });

  middlewares.use('/api/spotify-status', (req, res, next) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname !== '/') return next();
    res.setHeader('Content-Type', 'application/json');
    if (pendingSpotifyToken) {
      const d = { ...pendingSpotifyToken };
      pendingSpotifyToken = null;
      res.end(JSON.stringify({ success: true, data: d }));
    } else {
      res.end(JSON.stringify({ success: false }));
    }
  });

  middlewares.use('/api/spotify-refresh',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();if(req.method!=='POST'){res.statusCode=405;return res.end(JSON.stringify({error:'POST only'}))};const cid=req.headers['x-spotify-client-id'];const cs=req.headers['x-spotify-client-secret'];const b=await parseJsonBody(req);const{refresh_token}=b;if(!refresh_token||!cid||!cs){res.statusCode=400;return res.end(JSON.stringify({error:'Missing params'}))};try{const tr=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${Buffer.from(`${cid}:${cs}`).toString('base64')}`},body:new URLSearchParams({grant_type:'refresh_token',refresh_token})});const d=await tr.json();if(!tr.ok)throw new Error(d.error_description||d.error||'Refresh failed');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(d))}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}})

  middlewares.use('/api/spotify-mass-fetch',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const su=u.searchParams.get('url');if(!su){res.statusCode=400;return res.end(JSON.stringify({error:'Missing url'}))};const cid=req.headers['x-spotify-client-id'];const cs=req.headers['x-spotify-client-secret'];const at=req.headers['x-spotify-access-token'];try{res.setHeader('Content-Type','application/json');let md=await resolveSpotifyMetadata(su,cid,cs,at);const conc=20;for(let i=0;i<md.tracks.length;i+=conc){const chunk=md.tracks.slice(i,i+conc);await Promise.all(chunk.map(async(t,idx)=>{const ai=i+idx;let src='spotify';const inc=!t.coverUrl||!t.album||!t.year||!t.durationMs;if(inc){const id=await fetchItunesMetadata(t.title,t.artist);if(id){t.album=t.album||id.album;t.year=t.year||id.year;t.coverUrl=t.coverUrl||id.coverUrl;src='itunes'}else{const yd=await fetchYouTubeMusicMetadata(t.title,t.artist);if(yd){t.album=t.album||yd.album;t.year=t.year||yd.year;t.coverUrl=t.coverUrl||yd.coverUrl;src='youtube_music'}}};t.metadataSource=src;t.index=ai+1;t.searchRoute=ai<100?'spotify':'youtube_music'}))}; res.end(JSON.stringify({playlistId:md.spotifyId,playlistName:md.title,playlistCover:md.coverUrl,owner:md.owner||'Unknown',totalTracks:md.tracks.length,tracks:md.tracks}))}catch(err){console.error('Mass fetch error:',err);res.statusCode=500;res.end(JSON.stringify({error:err?.message||String(err)}))}})

  middlewares.use('/api/mass/ytdl-playlist-info',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const pu=u.searchParams.get('url');if(!pu){res.statusCode=400;return res.end(JSON.stringify({error:'Missing url'}))};const cached=cacheGet(pu);if(cached){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...cached,_cached:true}))};try{const poToken=getConfig().youtubePoToken||'';const extArgs=poToken?`youtube:player_client=android,web;po_token=${poToken}`:'youtube:player_client=android,web';let args=['--flat-playlist','--dump-json','--no-warnings','--playlist-end','2000','--extractor-args',extArgs,pu];const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.splice(args.length-1,0,'--cookies',cp);const p=spawn(binPath,args,{env:{...process.env,PYTHONIOENCODING:'utf-8',PATH:`${binDir}${path.delimiter}${process.env.PATH}`},windowsHide:true});let so='',se='';p.stdout.on('data',c=>so+=c);p.stderr.on('data',c=>se+=c);p.on('close',code=>{if(code!==0&&!so.trim()){res.statusCode=500;return res.end(JSON.stringify({error:`yt-dlp failed (${code}): ${se.slice(0,300)}`}))};const items=[];let pt='';for(const l of so.split('\n')){if(!l.trim())continue;try{const j=JSON.parse(l);if(!pt&&j.playlist_title)pt=j.playlist_title;items.push({id:j.id,url:j.url||`https://www.youtube.com/watch?v=${j.id}`,title:j.title||j.id,channel:j.channel||j.uploader||'',duration:j.duration||0,thumbnail:j.thumbnails?.[0]?.url||j.thumbnail||null,durationMs:(j.duration||0)*1000})}catch{}};const r={title:pt||'YouTube Playlist',totalItems:items.length,items};cacheSet(pu,r);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(r))});p.on('error',e=>{res.statusCode=500;res.end(JSON.stringify({error:e.message}))})}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}})

  middlewares.use('/api/mass/start-ytdl',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const did=u.searchParams.get('downloadId');if(!did){res.statusCode=400;return res.end(JSON.stringify({error:'Missing downloadId'}))};const fmtStr=u.searchParams.get('format')||'mp3';const rc=Math.min(24,Math.max(1,parseInt(u.searchParams.get('concurrency')||'3',10)));const sm=u.searchParams.get('speedMode')==='MAXIMUM'?'MAXIMUM':'BALANCED';const profile=getBatchPerformanceProfile(rc,sm);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');const send=d=>{try{res.write(`data: ${JSON.stringify(d)}\n\n`)}catch{}};const runDownload=async bodyData=>{const items=(bodyData?.items||[]).map((item,i)=>({...item,index:item.index||i+1}));if(!items.length){send({done:true,error:'No items'});return res.end()};const pn=sanitizeFilename(bodyData?.playlistName||'mass-download')||'mass-download';const dl=ensureDownloadsDir(u.searchParams.get('customPath'));const td=path.join(dl,`mass-ytdl-${pn}-${did}`);fs.mkdirSync(td,{recursive:true});send({current:0,total:items.length,status:`Starting ${items.length} tracks with ${profile.concurrency} workers…`,performanceProfile:profile});let cc=0,fc=0;const downloadItem=async(entry,ctx)=>{const{item,index}=entry;const isSp=item.type==='spotify'||!!item.spotifyUrl;const qStr=isSp?`ytsearch5:${item.channel||item.artist||''} ${item.title}`:(item.url||`https://www.youtube.com/watch?v=${item.id}`);const sTitle=sanitizeFilename(item.title||`track-${index}`);const sArtist=sanitizeFilename(item.channel||item.artist||'');const outName=sArtist?`${sArtist} - ${sTitle}`:sTitle;const op=path.join(td,`${outName}.%(ext)s`);let args=[];if(fmtStr==='mp3'){args=['-x','--audio-format','mp3','--audio-quality','0','-o',op,'--ffmpeg-location',ffmpegDir,'--no-playlist','--playlist-items','1','-N',String(profile.fragments||4),'--extractor-args', getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web','--extractor-retries','5','--fragment-retries','10','--retry-sleep','linear=1::2','--add-header','Accept-Language:en-US,en;q=0.9',qStr]}else if(fmtStr==='m4a'){args=['-x','--audio-format','m4a','--audio-quality','0','-o',op,'--ffmpeg-location',ffmpegDir,'--no-playlist','--playlist-items','1','-N',String(profile.fragments||4),'--extractor-args', getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web','--extractor-retries','5','--fragment-retries','10','--retry-sleep','linear=1::2','--add-header','Accept-Language:en-US,en;q=0.9',qStr]}else{args=['-x','--audio-format','mp3','--audio-quality','0','-o',op,'--ffmpeg-location',ffmpegDir,'--no-playlist','--playlist-items','1','-N',String(profile.fragments||4),'--extractor-args', getConfig().youtubePoToken ? `youtube:player_client=android,web;po_token=${getConfig().youtubePoToken}` : 'youtube:player_client=android,web','--extractor-retries','5','--fragment-retries','10','--retry-sleep','linear=1::2','--add-header','Accept-Language:en-US,en;q=0.9',qStr]};const cp=path.resolve(appDir,'cookies.txt');if(fs.existsSync(cp))args.splice(args.length-1,0,'--cookies',cp);return new Promise(resolve=>{const p=spawn(binPath,args,{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',PATH:`${binDir}${path.delimiter}${process.env.PATH}`}});ctx.registerProcess(p);ctx.unregisterProcess&&(p.on('close',()=>ctx.unregisterProcess(p)));let se='';p.stdout.on('data',c=>{const t=c.toString();const m=t.match(/\[download\]\s+([\d.]+)%/);if(m)send({current:cc,total:items.length,currentTrack:index,trackTitle:item.title,trackProgress:parseFloat(m[1])})});p.stderr.on('data',c=>se+=c);p.on('close',code=>{if(state?.cancelled)return resolve({ok:false,error:'cancelled'});if(code!==0)return resolve({ok:false,error:`yt-dlp failed (${code}): ${se.slice(-200)}`,title:item.title});const pattern=new RegExp(`^${outName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.[a-zA-Z0-9]+$`);const files=fs.existsSync(td)?fs.readdirSync(td).filter(f=>pattern.test(f)):[];const fn=files[0]||null;if(!fn)return resolve({ok:false,error:`No output for ${item.title||index}`});resolve({ok:true,output:fn})});p.on('error',e=>resolve({ok:false,error:e.message}))})};const jobsDir=path.join(os.tmpdir(),'mediadl-jobs');fs.mkdirSync(jobsDir,{recursive:true});const batch=createBatchEngine({jobsDirectory:jobsDir,jobId:did,items,profile,onEvent:evt=>{if(evt.trackDone){cc++;send({current:cc,total:items.length,status:`Completed ${cc}/${items.length}`,currentTrack:evt.current,trackDone:true,percent:Math.round(cc/items.length*100)})}else if(evt.trackError){fc++;send({current:cc,total:items.length,trackError:evt.trackError,currentTrack:evt.current,percent:Math.round(cc/items.length*100)})}else if(evt.current!==undefined){send({current:evt.current,total:items.length,percent:Math.round((evt.completedCount||0)/items.length*100)})}}});activeMassYtdlDownloads.set(did,batch.controls);try{await batch.run(downloadItem)}finally{activeMassYtdlDownloads.delete(did)};send({done:true,progress:100,completedTracks:cc,failedTracks:fc,outputDir:td});res.end()};const consume=async()=>{let body='';req.on('data',c=>body+=c);req.on('end',async()=>{try{const bd=JSON.parse(body||'{}');await runDownload(bd)}catch(e){send({done:true,error:e.message});res.end()}});req.on('close',()=>{const b=activeMassYtdlDownloads.get(did);if(b&&b.cancel)b.cancel()})};consume()})

  middlewares.use('/api/mass/cancel',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const did=u.searchParams.get('downloadId');if(did&&activeMassYtdlDownloads.has(did))activeMassYtdlDownloads.get(did).cancel();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true}))})

  middlewares.use('/api/spotify-info',async(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const su=u.searchParams.get('url');const cid=req.headers['x-spotify-client-id'];const cs=req.headers['x-spotify-client-secret'];const at=req.headers['x-spotify-access-token'];if(!su){res.statusCode=400;return res.end(JSON.stringify({error:'Missing url'}))};try{res.setHeader('Content-Type','application/json');let md;try{md=await resolveSpotifyMetadata(su,cid,cs,at)}catch(e){if(/^(SPOTIFY_(401|403|404)|Spotify auth failed|Missing SPOTIFY)/.test(e.message||''))throw e;console.log(`resolveSpotifyMetadata failed (${e.message}), fallback…`);try{md=await resolveSpotifyFallback(su)}catch(fe){throw new Error(e.message)}};return res.end(JSON.stringify(md))}catch(e){console.error('Spotify info error:',e);res.statusCode=500;res.end(JSON.stringify({error:e.message}))}})

  middlewares.use('/api/spotdl-extract',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const su=u.searchParams.get('url');if(!su){res.statusCode=400;return res.end(JSON.stringify({error:'Missing url'}))};res.setHeader('Content-Type','application/json');const tf=path.join(os.tmpdir(),`spotdl_extract_${Date.now()}.spotdl`);const spotdlCmd=process.platform==='win32'?'cmd.exe':spotdlBin;const spotdlArgs=process.platform==='win32'?['/c','chcp','65001','>','nul','&','call',spotdlBin,'save',su,'--save-file',tf,'--ffmpeg',ffmpegBin]:['save',su,'--save-file',tf,'--ffmpeg',ffmpegBin];const p=spawn(spotdlCmd,spotdlArgs,{env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PATH:`${binDir}${path.delimiter}${process.env.PATH}`}});p.stdout.on('data',()=>{});p.stderr.on('data',()=>{});p.on('close',code=>{if(fs.existsSync(tf)){try{const tracks=JSON.parse(fs.readFileSync(tf,'utf8'));fs.unlinkSync(tf);res.end(JSON.stringify({type:'playlist',title:tracks[0]?.list_name||'Spotify Playlist',trackCount:tracks.length,totalTracks:tracks.length,totalDurationMs:0,tracks:tracks.map((t,i)=>({trackNumber:i+1,title:t.name,artist:t.artist,allArtists:t.artists.join(', '),durationMs:t.duration*1000,spotifyUrl:t.url,coverUrl:t.cover_url}))}))}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}}else{res.statusCode=500;res.end(JSON.stringify({error:'spotdl failed'}))}})})

  
// ── Spotify Download (SSE, Multi-Track) ──
      middlewares.use('/api/spotify-download', (req, res, next) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`)
        if (urlObj.pathname !== '/') return next()
        const spotUrl = urlObj.searchParams.get('url')
        const format = urlObj.searchParams.get('format') || 'audio:mp3:0'
        const downloadId = urlObj.searchParams.get('downloadId') || Date.now().toString()
        const presetStr = urlObj.searchParams.get('preset')
        const preset = presetStr === 'AUTO' ? null : presetStr
        const hwaccel = urlObj.searchParams.get('hwaccel') || 'NONE'
        const clientId = req.headers['x-spotify-client-id']
        const clientSecret = req.headers['x-spotify-client-secret']
        const accessToken = req.headers['x-spotify-access-token']

        if (!spotUrl) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Missing url param' }))
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { } }

        const dlState = { cancelled: false, proc: null }
        spotifyActiveDownloads.set(downloadId, dlState)

        const runDownload = async () => {
          const aiConfig = getOptimalDownloadConfig(preset);
          const downloadsDir = ensureDownloadsDir(typeof urlObj !== 'undefined' ? (urlObj.searchParams ? urlObj.searchParams.get('customPath') : null) : null)

          send({ status: 'Fetching track info from Spotify API...', progress: 2 })

          let metadata
          try {
            if (spotUrl.startsWith('{')) {
              metadata = JSON.parse(spotUrl);
            } else {
              metadata = await resolveSpotifyMetadata(spotUrl, clientId, clientSecret, accessToken)
            }
          } catch (e) {
            if (/^SPOTIFY_403/.test(e.message || '') && /spotify\.com\/playlist\//.test(spotUrl)) {
              console.log('Spotify API denied playlist download metadata; reading the public playlist instead.')
              metadata = await resolvePublicPlaylist(spotUrl)
            } else {
              try {
                console.log(`resolveSpotifyMetadata failed during download (${e.message}), trying fallback...`);
                metadata = await resolveSpotifyFallback(spotUrl);
              } catch (fallbackErr) {
                throw new Error(`Spotify metadata fetch failed: ${e.message} (Fallback failed: ${fallbackErr.message})`);
              }
            }
          }

          const isCollection = metadata.type === 'album' || metadata.type === 'playlist'
          let tracks = isCollection ? metadata.tracks : [metadata]

          const selectedStr = urlObj.searchParams.get('selectedTracks');

          if (selectedStr) {
            const selectedIndices = new Set(selectedStr.split(',').map(Number));
            tracks = tracks.filter(t => selectedIndices.has(t.trackNumber));
          }

          const totalTracks = tracks.length

          if (totalTracks === 0) {
            throw new Error('No tracks found to download (or all selected tracks were invalid).')
          }

          send({ status: `Found ${totalTracks} track${totalTracks > 1 ? 's' : ''} — starting download...`, progress: 5, totalTracks })

          let outputDir = downloadsDir
          let collectionDir = null

          let tempDirForZip = null
          if (isCollection) {
            const safeFolderName = sanitizeFilename(metadata.title)
            collectionDir = path.join(downloadsDir, safeFolderName)
            if (!fs.existsSync(collectionDir)) {
              fs.mkdirSync(collectionDir, { recursive: true })
            }
            outputDir = collectionDir
          }

          const completedTracks = []
          const failedTracks = []

          const limit = aiConfig.concurrentTracks || 1;
          const activePromises = new Set();
          let tracksProcessed = 0;
          const isNativePlaylist = urlObj.searchParams.get('nativePlaylist') === 'true';

          if (false /* disabled due to spotdl playlist parsing bug */) {
            // Hoist spotdl args so retry pass can reuse them
            const spotdlPath = spotdlBin;
            const isWin = process.platform === 'win32';
            const spotdlCmd = isWin ? 'cmd.exe' : spotdlPath;
            const spotdlArgs = [
              spotUrl,
              '--output', path.join(outputDir, '{artists} - {title}.{output-ext}'),
              '--format', 'mp3',
              '--threads', String(aiConfig.concurrentTracks || 4),
              '--audio', 'youtube',
              '--yt-dlp-args', ` --js-runtimes="node:${process.execPath}" -N ${aiConfig.fragments || 4} --extractor-args youtube:player_client=android,web`,
              '--add-unavailable'
            ];
            let spFfmpegArgs = `-threads ${aiConfig.ffmpegThreads}`
            if (hwaccel !== 'NONE') {
              if (hwaccel === 'AUTO') spFfmpegArgs = `-hwaccel auto ` + spFfmpegArgs
              else if (hwaccel === 'CUDA') spFfmpegArgs = `-hwaccel cuda ` + spFfmpegArgs
              else if (hwaccel === 'AMF') spFfmpegArgs = `-hwaccel d3d11va ` + spFfmpegArgs
              else if (hwaccel === 'QSV') spFfmpegArgs = `-hwaccel qsv ` + spFfmpegArgs
              spotdlArgs.push('--ffmpeg-args', spFfmpegArgs)
            }
            spotdlArgs.push('--ffmpeg', ffmpegBin);

            const result = await new Promise((resolve) => {
              if (dlState.cancelled) return resolve({ skipped: true })

              send({
                currentTrack: 0,
                totalTracks: totalTracks,
                status: 'Se scanează și se asociază melodiile pe YouTube...',
                progress: 5
              });

              const spotdlExecArgs = isWin ? ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlPath, ...spotdlArgs] : spotdlArgs;
              const proc = spawn(spotdlCmd, spotdlExecArgs, {
                windowsHide: true,
                env: {
                  ...process.env,
                  PYTHONIOENCODING: 'utf-8',
                  PYTHONUTF8: '1',
                  PATH: `${binDir}${path.delimiter}${process.env.PATH}`
                }
              })
              dlState.proc = proc;
              let stderr = '';
              let currentTrack = 0;
              let nativeTotalTracks = totalTracks;

              let stdoutBuf = '';
              proc.stdout.on('data', c => {
                stdoutBuf += c.toString();
                const lines = stdoutBuf.split(/\r?\n|\r/);
                stdoutBuf = lines.pop();

                for (const text of lines) {
                  let mFound = text.match(/Found (\d+) songs in/);
                  if (mFound) {
                    nativeTotalTracks = parseInt(mFound[1]);
                    send({ totalTracks: nativeTotalTracks });
                  }

                  let m1 = text.match(/\[(\d+)\/(\d+)\] Downloading (.+)/);
                  if (m1) {
                    currentTrack = parseInt(m1[1]);
                    nativeTotalTracks = parseInt(m1[2]);
                    send({
                      currentTrack,
                      totalTracks: nativeTotalTracks,
                      status: `Downloading: ${m1[3]}`,
                      trackProgress: 0,
                      progress: Math.round(5 + (currentTrack / nativeTotalTracks) * 85)
                    });
                  } else {
                    let mDl = text.match(/Downloaded "([^"]+)"/);
                    if (mDl) {
                      const dName = (mDl[1] || '').toLowerCase().replace(/[^\w\s]/g, '');
                      const matchedIdx = tracks.findIndex(t => {
                        const tName = (t.title || '').toLowerCase().replace(/[^\w\s]/g, '');
                        return tName && (dName.includes(tName) || tName.includes(dName));
                      });
                      
                      const resolvedTrack = matchedIdx !== -1 ? matchedIdx + 1 : ++currentTrack;
                      
                      send({
                        currentTrack: resolvedTrack,
                        trackDone: true,
                        totalTracks: nativeTotalTracks,
                        status: `Downloaded: ${mDl[1]}`,
                        trackProgress: 100,
                        progress: Math.round(5 + (resolvedTrack / nativeTotalTracks) * 85)
                      });
                    } else {
                      let m2 = text.match(/(\d+)%/);
                      if (m2 && currentTrack > 0) {
                        send({
                          currentTrack,
                          trackProgress: parseFloat(m2[1])
                        });
                      }
                    }
                  }
                }
              });
              proc.stderr.on('data', c => { stderr += c.toString() });

              proc.on('close', async code => {
                if (dlState.cancelled) return resolve({ skipped: true })
                if (code !== 0) {
                  return resolve({ error: `spotdl failed with code ${code}: ${stderr}` })
                }
                resolve({ success: true, nativeTotalTracks })
              });
              proc.on('error', (err) => resolve({ error: `spotdl spawn failed: ${err.message}` }))
            });

            if (result.skipped) return;
            if (result.error) {
              failedTracks.push({ title: 'Playlist', error: result.error });
              send({ error: result.error, done: true });
              res.end();
              return;
            } else {
              try {
                let files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'));
                const expectedCount = result.nativeTotalTracks || totalTracks;

                // ── Smart rescue: identify EXACTLY which tracks are missing ──
                const norm = s => (s || '').toLowerCase()
                  .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

                const downloadedNorms = new Set(files.map(f => norm(f.replace(/\.mp3$/, ''))));

                const isDownloaded = (track) => {
                  const titleN = norm(track.title || '');
                  const artistFirstWord = norm((track.artist || '').split(' ')[0]);
                  for (const dn of downloadedNorms) {
                    if (dn.includes(titleN) && (artistFirstWord === '' || dn.includes(artistFirstWord))) return true;
                  }
                  return false;
                };

                const missingTracks = tracks.filter(t => !isDownloaded(t));

                if (missingTracks.length > 0) {
                  console.log(`[spotdl-rescue] ${files.length}/${expectedCount} downloaded. Rescuing ${missingTracks.length} missing tracks via yt-dlp...`);
                  send({ status: `Rescuing ${missingTracks.length} missing tracks via smart search...`, progress: 88 });

                  const ytDlpPath = binPath;
                  const ffmpegPath = ffmpegBin;

                  for (let mi = 0; mi < missingTracks.length; mi++) {
                    if (dlState.cancelled) break;
                    const track = missingTracks[mi];
                    const safeArtist = (track.artist || '').replace(/[<>:"/\\|?*]+/g, '_');
                    const safeTitle = (track.title || '').replace(/[<>:"/\\|?*]+/g, '_');
                    const finalOutputPath = path.join(outputDir, `${safeArtist} - ${safeTitle}.mp3`);

                    if (fs.existsSync(finalOutputPath)) continue;

                    const durationSec = track.durationMs ? Math.round(track.durationMs / 1000) : 0;

                    // Search strategies — NO "official audio" suffix (that returns clean/radio versions)
                    // We rely on duration matching to pick the explicit studio version
                    const searchStrategies = [
                      `ytsearch10:${track.artist} ${track.title}`,
                      `ytsearch10:"${track.title}" "${track.artist}"`,
                      `ytsearch10:${track.title} ${track.artist} audio`,
                      `ytsearch15:${track.title} ${track.artist}`,
                    ];

                    let rescued = false;
                    for (const query of searchStrategies) {
                      if (dlState.cancelled || rescued) break;

                      send({
                        status: `Rescuing: ${track.title} — ${track.artist} (${mi + 1}/${missingTracks.length})`,
                        progress: 88 + Math.round((mi / missingTracks.length) * 7)
                      });

                      // Tight ±20s duration window to avoid radio edits or live versions
                      const matchFilter = durationSec > 0
                        ? `!is_live & duration>${Math.max(30, durationSec - 20)} & duration<${durationSec + 20}`
                        : '!is_live & duration>30';

                      const poToken = getConfig().youtubePoToken || '';
                      const rescueArgs = [
                        query,
                        '--match-filter', matchFilter,
                        '--format', 'bestaudio/best',
                        '--extractor-args', poToken ? `youtube:player_client=android,web;po_token=${poToken}` : 'youtube:player_client=android,web',
                        '--js-runtimes', `node:${process.execPath}`,
                        '-x', '--audio-format', 'mp3',
                        '--audio-quality', '0',
                        '--ffmpeg-location', ffmpegPath,
                        '-o', finalOutputPath,
                        '--no-playlist',
                        '--playlist-items', '1',
                      ];
                      const cp = path.resolve(appDir, 'cookies.txt');
                      if (fs.existsSync(cp)) {
                        rescueArgs.push('--cookies', cp);
                      }

                      const ok = await new Promise((resolveRescue) => {
                        const rProc = spawn(ytDlpPath, rescueArgs, {
                          windowsHide: true,
                          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
                        });
                        rProc.stdout.on('data', () => {});
                        rProc.stderr.on('data', () => {});
                        rProc.on('close', (code) => resolveRescue(code === 0 && fs.existsSync(finalOutputPath)));
                        rProc.on('error', () => resolveRescue(false));
                      });

                      if (ok) {
                        rescued = true;
                        downloadedNorms.add(norm(`${safeArtist} - ${safeTitle}`));
                        console.log(`[spotdl-rescue] ✓ Rescued: ${track.title}`);
                        
                        const trackRealIdx = tracks.findIndex(t => t.title === track.title && t.artist === track.artist);
                        if (trackRealIdx !== -1) {
                           send({
                             currentTrack: trackRealIdx + 1,
                             trackDone: true,
                             status: `Rescued: ${track.title}`,
                             trackProgress: 100
                           });
                        }
                        
                        // Write ID3 tags
                        try {
                          const tags = {
                            title: track.title,
                            artist: track.allArtists || track.artist,
                            album: track.album,
                            year: track.year,
                            trackNumber: `${track.trackNumber}/${track.totalTracks}`
                          };
                          if (track.coverUrl) {
                            try {
                              const coverBuf = await new Promise((r2, j2) => {
                                https.get(track.coverUrl, rImg => {
                                  if (rImg.statusCode === 200) {
                                    const ch = []; rImg.on('data', c => ch.push(c)); rImg.on('end', () => r2(Buffer.concat(ch)));
                                  } else j2(new Error(`${rImg.statusCode}`));
                                }).on('error', j2);
                              });
                              tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'Front Cover' }, description: 'Cover', imageBuffer: coverBuf };
                            } catch {}
                          }
                          NodeID3.update(tags, finalOutputPath);
                        } catch {}
                      } else {
                        console.log(`[spotdl-rescue] ✗ Strategy failed: "${track.title}" | query: ${query.substring(0, 60)}`);
                        if (!ok) await new Promise(r => setTimeout(r, 800));
                      }
                    }

                    if (!rescued) {
                      console.log(`[spotdl-rescue] Could not rescue: ${track.title} — ${track.artist}`);
                      failedTracks.push({ title: track.title, artist: track.artist, error: 'No matching video found on YouTube' });
                    }
                    if (mi < missingTracks.length - 1) await new Promise(r => setTimeout(r, 600));
                  }

                  files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'));
                }

                console.log(`[spotdl] Final: ${files.length}/${expectedCount} tracks downloaded.`);
                for (const f of files) completedTracks.push(f);
                if (completedTracks.length === 0) {
                  send({ error: 'No files were downloaded.', done: true });
                  res.end();
                  return;
                }
                send({ trackDone: true, currentTrack: files.length, totalTracks: expectedCount, progress: 90 });
              } catch (e) { console.error('[spotdl] post-run error:', e.message); }
            }

          } else {
            // ── Hybrid download engine ──────────────────────────────────────────────
            // Tracks 1-100   → spotdl per-track (audio-only, Spotify/YTM source)
            // Tracks 101+    → yt-dlp with --format bestaudio (pure audio, never video)
            // Cover art      → always from track.coverUrl (Spotify album art), written via NodeID3

            const SPOTDL_LIMIT = 100;
            const isWin = process.platform === 'win32';
            const safeLimit = limit || 8;

            // ── Helper: fetch cover buffer from Spotify album art ──────────────────
            const fetchCoverBuffer = async (coverUrl) => {
              if (!coverUrl) return null;
              try {
                return await new Promise((resolveImg, rejectImg) => {
                  const fetchImage = (url) => {
                    https.get(url, (resImg) => {
                      if (resImg.statusCode >= 300 && resImg.statusCode < 400 && resImg.headers.location) {
                        fetchImage(resImg.headers.location);
                      } else if (resImg.statusCode === 200) {
                        const chunks = [];
                        resImg.on('data', chunk => chunks.push(chunk));
                        resImg.on('end', () => resolveImg(Buffer.concat(chunks)));
                      } else {
                        rejectImg(new Error(`Status ${resImg.statusCode}`));
                      }
                    }).on('error', rejectImg);
                  };
                  fetchImage(coverUrl);
                });
              } catch { return null; }
            };

            // ── Helper: write ID3 tags (FULL REWRITE — guarantees Spotify album art replaces anything spotdl embedded) ──
            const writeTrackTags = (filePath, track, coverBuffer) => {
              try {
                // Read existing tags first so we don’t lose anything we didn’t set
                const existing = NodeID3.read(filePath) || {};
                const tags = {
                  ...existing,
                  title: track.title,
                  artist: track.allArtists || track.artist,
                  album: track.album,
                  year: track.year ? String(track.year) : existing.year,
                  trackNumber: `${track.trackNumber}/${track.totalTracks}`
                };
                delete tags.comment;
                delete tags.userDefinedUrl;
                delete tags.description;
                
                if (coverBuffer) {
                  // Overwrite with the track’s own album art from Spotify
                  tags.image = {
                    mime: 'image/jpeg',
                    type: { id: 3, name: 'Front Cover' },
                    description: 'Cover',
                    imageBuffer: coverBuffer
                  };
                }
                // NodeID3.write = full tag block rewrite, NOT just update specific frames
                NodeID3.write(tags, filePath);
              } catch (err) {
                console.error(`[tags] Error writing tags for ${track.title}:`, err.message);
              }
            };

            // ── Helper: download one track via spotdl (per-track, not playlist) ──
            const downloadViaSpotdl = (track, trackIndex, retryCount = 0, provider = 'youtube-music') => new Promise((resolve) => {
              if (dlState.cancelled) return resolve({ skipped: true });
              const safeArtist = track.artist.replace(/[<>:"/\\|?*]+/g, '_');
              const safeTitle = track.title.replace(/[<>:"/\\|?*]+/g, '_');
              const spotdlCmd = isWin ? 'cmd.exe' : spotdlBin;

              const cookiesPath = path.resolve(appDir, 'cookies.txt');
              const hasCookies = fs.existsSync(cookiesPath);

              const baseArgs = [
                track.spotifyUrl,
                '--output', path.join(outputDir, '{artists} - {title}.{output-ext}'),
                '--audio', provider,
                '--lyrics', 'genius',
                '--format', 'mp3',
                '--bitrate', '320k',
                '--threads', '4',
                '--overwrite', 'skip',
                '--ffmpeg', ffmpegBin,
                '--add-unavailable'
              ];
              if (hasCookies) {
                baseArgs.push('--cookie-file', cookiesPath);
                baseArgs.push('--yt-dlp-args', `--cookies "${cookiesPath}" --geo-bypass --no-check-certificates`);
              }

              const spotdlArgs = isWin
                ? ['/c', 'chcp', '65001', '>', 'nul', '&', 'call', spotdlBin, ...baseArgs]
                : baseArgs;
              const proc = spawn(spotdlCmd, spotdlArgs, {
                windowsHide: true,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
              });
              dlState.proc = proc;
              let stdoutBuf = '';
              let stderrBuf = '';
              proc.stdout.on('data', c => {
                const text = c.toString();
                stdoutBuf += text;
                const pct = text.match(/(\d+)%/);
                if (pct) send({ trackProgress: Math.min(parseInt(pct[1]), 95), currentTrack: trackIndex + 1 });
              });
              proc.stderr.on('data', c => { stderrBuf += c.toString(); });
              proc.on('close', async (code) => {
                if (dlState.cancelled) return resolve({ skipped: true });

                const errLog = `spotdl could not download: ${track.title} (provider: ${provider})`;
                const isNotFound = stdoutBuf.toLowerCase().includes('not found') || stderrBuf.toLowerCase().includes('not found') || stdoutBuf.toLowerCase().includes('denied');

                const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3')) : [];
                
                const mDl = stdoutBuf.match(/Downloaded "([^"]+)"/);
                if (mDl && mDl[1]) {
                  const parsedName = path.basename(mDl[1]);
                  const checkName = parsedName.endsWith('.mp3') ? parsedName : `${parsedName}.mp3`;
                  if (files.includes(checkName)) {
                    return resolve({ filename: checkName, provider: 'spotdl' });
                  }
                }
                
                // fallback to searching for a file that includes the title or sanitized words
                const cleanTitle = track.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
                const titleWords = cleanTitle.split(' ').filter(w => w.length > 2);
                
                const matchedFile = files.find(f => {
                  const fClean = f.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
                  if (cleanTitle && fClean.includes(cleanTitle)) return true;
                  // If clean title fails, check if at least 2 words of the title are in the filename
                  if (titleWords.length >= 2) {
                    const matchedWords = titleWords.filter(w => fClean.includes(w));
                    return matchedWords.length >= titleWords.length - 1; // Allows 1 missing word due to sanitization
                  }
                  return false;
                });
                
                if (matchedFile) {
                  return resolve({ filename: matchedFile, provider: 'spotdl' });
                }
                
                if (code !== 0) {
                  console.error(`[spotdl] Failed with code ${code}. stdout: ${stdoutBuf.slice(-300)} stderr: ${stderrBuf.slice(-300)}`);
                }

                const isRateLimited = stdoutBuf.includes('429') || stderrBuf.includes('429') || stdoutBuf.includes('403') || stderrBuf.includes('403');

                if (isRateLimited) {
                  const delay = retryCount === 0 ? 2 : (retryCount === 1 ? 5 : 10);
                  send({ status: `Rate limited — waiting ${delay} seconds before retry`, currentTrack: trackIndex + 1 });
                  await new Promise(r => setTimeout(r, delay * 1000));
                  return resolve(await downloadViaSpotdl(track, trackIndex, retryCount + 1, provider));
                }

                if (isNotFound && retryCount < 2) {
                  const delay = retryCount === 0 ? 2 : 5;
                  await new Promise(r => setTimeout(r, delay * 1000));
                  return resolve(await downloadViaSpotdl(track, trackIndex, retryCount + 1, provider));
                } else if (isNotFound && provider === 'youtube-music') {
                  send({ status: `Falling back to YouTube provider for ${track.title}`, currentTrack: trackIndex + 1 });
                  return resolve(await downloadViaSpotdl(track, trackIndex, 0, 'youtube'));
                }

                return resolve({ error: errLog, trackTitle: track.title });
              });
              proc.on('error', err => resolve({ error: `spotdl spawn error: ${err.message}`, trackTitle: track.title }));
            });

            // ── Helper: download one track via yt-dlp with bestaudio ───────────────
            const downloadViaYtdlp = (track, trackIndex) => new Promise((resolve) => {
              if (dlState.cancelled) return resolve({ skipped: true });
              const safeArtist = track.artist.replace(/[<>:"/\\|?*]+/g, '_');
              const safeTitle = track.title.replace(/[<>:"/\\|?*]+/g, '_');
              const finalOutputName = `${safeArtist} - ${safeTitle}.mp3`;
              
              // Direct ytsearch1 query per user request
              const searchQuery = `ytsearch1:${track.title} ${track.artist} audio`;
              const poToken = getConfig().youtubePoToken || '';
              const extractorArgs = poToken 
                ? `youtube:player_client=android,web;po_token=${poToken}` 
                : 'youtube:player_client=android,web';

              const cookiesPath = path.resolve(appDir, 'cookies.txt');
              const hasCookies = fs.existsSync(cookiesPath);

              const ytDlpArgs = [
                searchQuery,
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '--geo-bypass',
                '--no-playlist',
                '--extractor-retries', '5',
                '--fragment-retries', '10',
                '--retry-sleep', 'linear=1::2',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                '--add-header', 'Accept-Language:en-US,en;q=0.9',
                '--extractor-args', extractorArgs,
                '--js-runtimes', `node:${process.execPath}`,
                '--ffmpeg-location', ffmpegDir,
                '-o', path.join(outputDir, finalOutputName)
              ];

              if (hasCookies) {
                ytDlpArgs.push('--cookies', cookiesPath);
              }

              const isWin = process.platform === 'win32';
              try {
                const ariaCheck = spawnSync(isWin ? 'where' : 'which', ['aria2c']);
                if (ariaCheck.status === 0) {
                   ytDlpArgs.push('--downloader', 'aria2c', '--downloader-args', 'aria2c:-x 16 -s 16 -k 1M');
                }
              } catch (e) {}
              const proc = spawn(binPath, ytDlpArgs, {
                windowsHide: true,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
              });
              dlState.proc = proc;
              let stderr = '';
              proc.stdout.on('data', c => {
                const text = c.toString();
                const pctMatch = text.match(/\[download\]\s+(\d+\.?\d*)%/);
                if (pctMatch) send({ trackProgress: Math.min(parseFloat(pctMatch[1]), 95), currentTrack: trackIndex + 1, status: `Downloading: ${track.title}` });
              });
              proc.stderr.on('data', c => { stderr += c.toString(); });
              proc.on('close', code => {
                if (dlState.cancelled) return resolve({ skipped: true });
                if (code !== 0) return resolve({ error: `yt-dlp failed (${code}): ${stderr.slice(-300)}`, trackTitle: track.title });
                let resolvedFilename = '';
                const outputPath = path.join(outputDir, finalOutputName);
                if (fs.existsSync(outputPath)) {
                  resolvedFilename = finalOutputName;
                } else {
                  try {
                    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'));
                    const recentFile = files
                      .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtimeMs }))
                      .sort((a, b) => b.time - a.time)[0];
                    if (recentFile && (Date.now() - recentFile.time < 30000)) {
                      resolvedFilename = recentFile.name;
                    }
                  } catch { }
                }
                if (!resolvedFilename) return resolve({ error: `Could not find downloaded file for ${track.title}`, trackTitle: track.title });
                
                // Embed correct metadata manually using node-id3
                try {
                  const finalOutputPath = path.join(outputDir, resolvedFilename);
                  const tags = {
                    title: track.title,
                    artist: track.artist,
                    album: track.album || '',
                    trackNumber: `${trackIndex + 1}`
                  };
                  if (track.coverUrl) {
                    const imgResp = spawnSync('node', [
                      '-e', 
                      `require("https").get("${track.coverUrl}", r => { let d = []; r.on("data", c => d.push(c)); r.on("end", () => process.stdout.write(Buffer.concat(d))); })`
                    ], { maxBuffer: 10 * 1024 * 1024 });
                    if (imgResp.stdout && imgResp.stdout.length > 0) {
                      tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, imageBuffer: imgResp.stdout };
                    }
                  }
                  NodeID3.write(tags, finalOutputPath);
                } catch (e) {
                  console.error('Error embedding metadata in yt-dlp fallback:', e.message);
                }

                resolve({ filename: resolvedFilename });
              });
              proc.on('error', err => resolve({ error: `yt-dlp spawn error: ${err.message}`, trackTitle: track.title }));
            });

            // ── Main download loop ────────────────────────────────────────────────
            for (let i = 0; i < tracks.length; i++) {
              if (dlState.cancelled) {
                if (collectionDir) try { fs.rmSync(collectionDir, { recursive: true, force: true }) } catch { }
                send({ done: true, error: 'Download cancelled by user.' });
                res.end();
                return;
              }

              while (activePromises.size >= safeLimit) {
                await Promise.race(activePromises);
              }

              // Stagger slightly to avoid instantaneous API spikes
              if (i > 0) await new Promise(r => setTimeout(r, 200));
              if (dlState.cancelled) break;

              const track = tracks[i];
              const trackIndex = i;
              const useSpotdl = (trackIndex < SPOTDL_LIMIT) && !!track.spotifyUrl;

              const downloadTask = (async () => {
                send({
                  status: `Downloading: ${track.title} — ${track.artist} ${useSpotdl ? '(Spotify)' : '(YouTube Audio)'}`,
                  progress: Math.round(5 + (tracksProcessed / totalTracks) * 85),
                  currentTrack: trackIndex + 1,
                  totalTracks,
                  trackTitle: track.title,
                  trackArtist: track.artist,
                  trackProgress: 0,
                });

                try {
                  let result;
                  if (useSpotdl) {
                    result = await downloadViaSpotdl(track, trackIndex);
                    // If spotdl fails, fall back to yt-dlp
                    if (result.error) {
                      console.warn(`[spotdl] Falling back to yt-dlp for: ${track.title} — ${result.error}`);
                      result = await downloadViaYtdlp(track, trackIndex);
                    }
                  } else {
                    result = await downloadViaYtdlp(track, trackIndex);
                  }

                  tracksProcessed++;
                  const overallProgress = Math.round(5 + (tracksProcessed / totalTracks) * 85);

                  if (result.skipped) return;
                  if (result.error) {
                    failedTracks.push({ ...track, error: result.error });
                    send({ trackError: result.error, currentTrack: trackIndex + 1, trackTitle: track.title, progress: overallProgress });
                  } else {
                    const finalFilename = result.filename.endsWith('.mp3') ? result.filename : `${result.filename}.mp3`;
                    const filePath = path.resolve(outputDir, finalFilename);
                    
                    if (result.provider === 'spotdl') {
                      try {
                        const tags = NodeID3.read(filePath);
                        if (tags) {
                          delete tags.comment;
                          delete tags.userDefinedUrl;
                          delete tags.description;
                          NodeID3.write(tags, filePath);
                        }
                      } catch (e) {
                        console.error(`[tags] Failed to clean spotdl tags for ${track.title}:`, e.message);
                      }
                    } else {
                      const coverBuffer = await fetchCoverBuffer(track.coverUrl);
                      writeTrackTags(filePath, track, coverBuffer);
                    }

                    completedTracks.push(finalFilename);
                    send({
                      trackDone: true,
                      currentTrack: trackIndex + 1,
                      totalTracks,
                      trackTitle: track.title,
                      progress: overallProgress,
                    });
                  }
                } catch (e) {
                  tracksProcessed++;
                  failedTracks.push({ ...track, error: e.message });
                  send({ trackError: e.message, currentTrack: trackIndex + 1, trackTitle: track.title, progress: Math.round(5 + (tracksProcessed / totalTracks) * 85) });
                }
              })();

              activePromises.add(downloadTask);
              downloadTask.finally(() => activePromises.delete(downloadTask));
            }
            await Promise.all(activePromises);
          }

          if (dlState.cancelled) return

          spotifyActiveDownloads.delete(downloadId)

          if (isCollection) {
            // ZIP the collection folder
            send({ status: 'Creating ZIP archive...', progress: 92 })
            const safeZipName = sanitizeFilename(metadata.title)
            const zipFilename = `spotify-${metadata.type}-${safeZipName}.zip`
            const zipPath = path.join(downloadsDir, zipFilename)

            if (metadata.type === 'album' && metadata.coverUrl) {
              try {
                const coverRes = await fetch(metadata.coverUrl)
                const coverBuffer = Buffer.from(await coverRes.arrayBuffer())

                const metaDir = path.join(collectionDir, '.metadata')
                if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir)

                const jpgPath = path.join(metaDir, 'folder.jpg')
                fs.writeFileSync(jpgPath, coverBuffer)

                if (process.platform === 'win32') {
                  const icoPath = path.join(metaDir, 'album.ico')
                  await new Promise((resolve) => {
                    const child = spawn(ffmpegBin, ['-y', '-i', jpgPath, '-vf', 'scale=256:256', icoPath], { windowsHide: true })
                    child.on('close', () => resolve())
                  })

                  if (fs.existsSync(icoPath)) {
                    const iniContent = "[.ShellClassInfo]\r\nIconResource=.metadata\\album.ico,0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Music\r\n"
                    const iniPath = path.join(collectionDir, 'desktop.ini')
                    fs.writeFileSync(iniPath, iniContent)

                    // Run natively to try and make it automatic! Use shell: true for Windows built-ins
                    await new Promise((resolve) => {
                      const child = spawn('attrib', ['+s', `"${collectionDir}"`], { shell: true })
                      child.on('close', () => resolve())
                    })
                    await new Promise((resolve) => {
                      const child = spawn('attrib', ['+s', '+h', `"${iniPath}"`], { shell: true })
                      child.on('close', () => resolve())
                    })
                    await new Promise((resolve) => {
                      const child = spawn('attrib', ['+s', '+h', `"${metaDir}"`], { shell: true })
                      child.on('close', () => resolve())
                    })

                    spawn('ie4uinit.exe', ['-show'], { shell: true })
                    spawn('powershell', ['-Command', '$shell = New-Object -ComObject Shell.Application; $shell.Windows() | ForEach-Object { $_.Refresh() }'], { shell: true })
                  }
                }
              } catch (e) {
                console.error('Failed to set album folder thumbnail:', e)
              }
            } // Close if (metadata.type === 'album' && metadata.coverUrl)

            send({
              done: true,
              progress: 100,
              finalFilename: path.basename(collectionDir),
              downloadUrl: '',
              completedTracks: completedTracks.length,
              failedTracks: failedTracks.length,
              failedTracksData: failedTracks,
              isArchive: false,
              collectionTitle: metadata.title,
              source: 'spotify',
              spotifyType: metadata.type
            })
            res.end()

          } else {
            // Single track
            const filename = completedTracks[0]
            if (!filename) {
              const errMsg = failedTracks[0]?.error || 'Failed to download track'
              send({ done: true, error: errMsg })
              res.end()
              return
            }
            const filePath = path.join(downloadsDir, filename)
            scheduleDownloadCleanup(filePath)

            send({
              done: true,
              progress: 100,
              finalFilename: filename,
              downloadUrl: `/api/download-file?file=${encodeURIComponent(filename)}`,
              completedTracks: 1,
              failedTracks: 0,
              collectionTitle: metadata.title,
              source: 'spotify',
              spotifyType: 'track'
            })
            res.end()
          }
        }

        req.on('close', () => {
          dlState.cancelled = true
          if (dlState.proc) { try { dlState.proc.kill() } catch { } }
          spotifyActiveDownloads.delete(downloadId)
        })

        runDownload().catch(err => {
          spotifyActiveDownloads.delete(downloadId)
          let errorMsg = err.message
          if (errorMsg.includes('Missing SPOTIFY_CLIENT_ID')) {
            errorMsg = "Add your Spotify credentials in Settings to use Spotify features."
          }
          send({ done: true, error: errorMsg })
          res.end()
        })
      })
middlewares.use('/api/spotify-cancel',(req,res,next)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(u.pathname!=='/')return next();const did=u.searchParams.get('downloadId');if(!did){res.statusCode=400;return res.end(JSON.stringify({error:'Missing downloadId'}))};const dl=spotifyActiveDownloads.get(did);if(dl){dl.cancelled=true;if(dl.proc){try{dl.proc.kill()}catch{}};spotifyActiveDownloads.delete(did)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true}))})

}


