import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Film,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Zap,
  Clock,
  MonitorPlay,
  Headphones,
  Link2,
  RefreshCw,
  Save,
  ListVideo,
  Music,
  Pause,
  Play,
  X,
  XCircle,
  HardDrive,
  Activity,
  Cpu,
  ArrowLeft,
  CalendarClock,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  User,
  Check,
  LayoutGrid,
} from "lucide-react";
import { getAverageColor } from "./utils/colorUtils";
import WaveformBg from "./WaveformBg";
import "./YoutubeDownloader.css";

const RESOLUTIONS = [
  {
    id: "4k",
    label: "4K",
    sub: "2160p",
    minH: 2160,
    format:
      "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]",
  },
  {
    id: "1440p",
    label: "2K",
    sub: "1440p",
    minH: 1440,
    format:
      "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]",
  },
  {
    id: "1080p",
    label: "1080p",
    sub: "Full HD",
    minH: 1080,
    format:
      "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
  },
  {
    id: "720p",
    label: "720p",
    sub: "HD",
    minH: 720,
    format:
      "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
  },
  {
    id: "480p",
    label: "480p",
    sub: "SD",
    minH: 480,
    format:
      "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
  },
  {
    id: "360p",
    label: "360p",
    sub: "Low",
    minH: 360,
    format:
      "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
  },
];

const AUDIO_FORMATS = [
  {
    id: "mp3_320",
    label: "320kbps MP3",
    sub: "Cea mai buna",
    quality: "0",
    audioFmt: "mp3",
  },
  {
    id: "mp3_192",
    label: "192kbps MP3",
    sub: "Standard",
    quality: "5",
    audioFmt: "mp3",
  },
  {
    id: "mp3_128",
    label: "128kbps MP3",
    sub: "Compresat",
    quality: "9",
    audioFmt: "mp3",
  },
  {
    id: "ogg",
    label: "OGG Vorbis",
    sub: "Format deschis",
    quality: "0",
    audioFmt: "vorbis",
  },
  {
    id: "wav",
    label: "WAV",
    sub: "Fara pierderi",
    quality: "0",
    audioFmt: "wav",
  },
];

// ── Clickable Suggestion Chips ──────────────────────────────────────────────
const SUGGESTIONS = [
  // Popular music
  {
    label: "Bohemian Rhapsody",
    url: "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
    tag: "Music",
    color: "#a855f7",
  },
  {
    label: "Blinding Lights",
    url: "https://www.youtube.com/watch?v=4NRXx6U8ABQ",
    tag: "Music",
    color: "#a855f7",
  },
  {
    label: "Shape of You",
    url: "https://www.youtube.com/watch?v=JGwWNGJdvx8",
    tag: "Music",
    color: "#a855f7",
  },
  {
    label: "Stairway to Heaven",
    url: "https://www.youtube.com/watch?v=QkF3oxziUI4",
    tag: "Music",
    color: "#a855f7",
  },
  {
    label: "Hotel California",
    url: "https://www.youtube.com/watch?v=BciS5krYL80",
    tag: "Music",
    color: "#a855f7",
  },
  {
    label: "Smells Like Teen Spirit",
    url: "https://www.youtube.com/watch?v=hTWKbfoikeg",
    tag: "Music",
    color: "#a855f7",
  },
  {
    label: "Lose Yourself",
    url: "https://www.youtube.com/watch?v=_Yhyp-_hX2s",
    tag: "Rap",
    color: "#f59e0b",
  },
  {
    label: "HUMBLE. - Kendrick Lamar",
    url: "https://www.youtube.com/watch?v=tvTRZJ-4EyI",
    tag: "Rap",
    color: "#f59e0b",
  },
  // Popular videos
  {
    label: "Gangnam Style",
    url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    tag: "Viral",
    color: "#ef4444",
  },
  {
    label: "Baby Shark",
    url: "https://www.youtube.com/watch?v=XqZsoesa55w",
    tag: "Viral",
    color: "#ef4444",
  },
  {
    label: "Despacito",
    url: "https://www.youtube.com/watch?v=kTJczUoc26U",
    tag: "Music",
    color: "#a855f7",
  },
  // Playlists
  {
    label: "Lo-Fi Hip Hop Playlist",
    url: "https://www.youtube.com/playlist?list=PLofht4PTcKYnaH8w5olJCI-pPmIBOOFAy",
    tag: "Playlist",
    color: "#10b981",
  },
  {
    label: "Top 50 Global",
    url: "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    tag: "Playlist",
    color: "#10b981",
  },
  // Podcasts / long form
  {
    label: "Joe Rogan #2228",
    url: "https://www.youtube.com/watch?v=3dg9CgjBXSc",
    tag: "Podcast",
    color: "#3b82f6",
  },
  {
    label: "Lex Fridman - Elon Musk",
    url: "https://www.youtube.com/watch?v=DxREm3s1scA",
    tag: "Podcast",
    color: "#3b82f6",
  },
  // Tutorials
  {
    label: "Learn React in 1 Hour",
    url: "https://www.youtube.com/watch?v=SqcY0GlETPk",
    tag: "Tutorial",
    color: "#06b6d4",
  },
  {
    label: "Python Full Course",
    url: "https://www.youtube.com/watch?v=eWRfhZUzrAc",
    tag: "Tutorial",
    color: "#06b6d4",
  },
  {
    label: "Git & GitHub Crash Course",
    url: "https://www.youtube.com/watch?v=RGOj5yH7evk",
    tag: "Tutorial",
    color: "#06b6d4",
  },
  // YouTube Music
  {
    label: "Eminem – Without Me",
    url: "https://music.youtube.com/watch?v=YVkUvmDQ3HY",
    tag: "YT Music",
    color: "#ec4899",
  },
  {
    label: "Arctic Monkeys – R U Mine?",
    url: "https://music.youtube.com/watch?v=f1gkGmOQJPE",
    tag: "YT Music",
    color: "#ec4899",
  },
  {
    label: "Daft Punk – Get Lucky",
    url: "https://music.youtube.com/watch?v=5NV6Rdv1a3I",
    tag: "YT Music",
    color: "#ec4899",
  },
];

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDuration(secs) {
  if (!secs) return "--:--";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be|soundcloud\.com)\/.+/.test(
    url,
  );
}

function isPlaylistUrl(value) {
  try {
    const parsed = new URL(value);
    const list = parsed.searchParams.get("list");
    // Ignore YouTube auto-generated radio mixes (RD...) as playlists
    if (list && list.startsWith("RD")) return false;
    return !!list || parsed.pathname.split("/").includes("playlist");
  } catch {
    return false;
  }
}

function isMusicUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "music.youtube.com";
  } catch {
    return false;
  }
}

function generateJobId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

const YoutubeDownloader = ({ activeJobId }) => {
  const [url, setUrl] = useState("");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ytdl_history");
      if (saved) setHistory(JSON.parse(saved));
    } catch { }
  }, []);

  const saveToHistory = (
    newUrl,
    title,
    thumbnail,
    uploader = "",
    artistThumbnail = "",
    isCollection = false,
  ) => {
    if (!newUrl) return;
    setHistory((prev) => {
      const filtered = prev.filter((item) => item.url !== newUrl);
      const updated = [
        {
          url: newUrl,
          title: title || newUrl,
          thumbnail,
          uploader,
          artistThumbnail,
          isCollection,
          date: Date.now(),
        },
        ...filtered,
      ].slice(0, 10);
      localStorage.setItem("ytdl_history", JSON.stringify(updated));
      return updated;
    });
  };
  const removeHistoryItem = (targetUrl) => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.url !== targetUrl);
      localStorage.setItem("ytdl_history", JSON.stringify(updated));
      return updated;
    });
  };

  const removeChannelHistory = (uploader) => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.uploader !== uploader);
      localStorage.setItem("ytdl_history", JSON.stringify(updated));
      return updated;
    });
  };

  const recentChannels = useMemo(() => {
    const seen = new Set();
    return history
      .filter(
        (item) =>
          item.uploader &&
          !item.isCollection &&
          !isPlaylistUrl(item.url) &&
          !seen.has(item.uploader) &&
          seen.add(item.uploader),
      )
      .slice(0, 6);
  }, [history]);

  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [error, setError] = useState(null);

  const [mediaType, setMediaType] = useState("video");
  const [selectedRes, setSelectedRes] = useState("1080p");
  const [selectedAudio, setSelectedAudio] = useState("mp3_320");

  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [isPlaylistExpanded, setIsPlaylistExpanded] = useState(false);
  const [playlistViewMode, setPlaylistViewMode] = useState("list");

  const [downloading, setDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [finalFilename, setFinalFilename] = useState("");
  const [outputName, setOutputName] = useState("");
  const [downloadFormat, setDownloadFormat] = useState("video");
  const [downloadSourceMode, setDownloadSourceMode] = useState("standard");

  useEffect(() => {
    if (activeJobId && !downloading) {
      setCurrentJobId(activeJobId);
      reconnectToJob(activeJobId);
    }
  }, [activeJobId]);

  const [downloadScope, setDownloadScope] = useState("single");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [prependNumbers, setPrependNumbers] = useState(() => {
    const saved = localStorage.getItem("ytdl_prepend_numbers");
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [pendingScope, setPendingScope] = useState("single");
  const [currentVinylImage, setCurrentVinylImage] = useState(null);
  const [localCustomPath, setLocalCustomPath] = useState("");

  useEffect(() => {
    if (showOptionsModal) {
      setLocalCustomPath(localStorage.getItem("customPath") || "");
    }
  }, [showOptionsModal]);



  const handleSelectLocalFolder = async () => {
    try {
      const res = await fetch("/api/ytdl/select-folder?temp=true");
      const data = await res.json();
      if (data.success && data.path) {
        setLocalCustomPath(data.path);
      }
    } catch (e) {
      console.error(e);
    }
  };


  const [currentJobId, setCurrentJobId] = useState(null);
  const [clipboardToast, setClipboardToast] = useState(false);

  const eventSourceRef = useRef(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [isStatusExpanded, setIsStatusExpanded] = useState(false);
  const [customPath, setCustomPath] = useState("");

  const [appMode, setAppMode] = useState(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [ambientColor, setAmbientColor] = useState("rgba(239, 68, 68, 0.12)");
  const [missingTracks, setMissingTracks] = useState(null);
  // YouTube Music per-track fallback state
  const [ytMusicFallbackStatus, setYtMusicFallbackStatus] = useState(null); // { trackTitle, stage: 'searching'|'found'|'failed', fallbackTitle }
  const [ytMusicFailedTracks, setYtMusicFailedTracks] = useState([]); // [{ title, artist, error, fallbackNote }]
  const [ytMusicStats, setYtMusicStats] = useState(null); // { completed, failed, total }
  const [ytMusicCurrentThumbnail, setYtMusicCurrentThumbnail] = useState(null); // cover art of the track currently being processed
  const ytMusicAbortRef = useRef(null); // AbortController for the fetch stream


  useEffect(() => {
    let interval = null;
    if (downloading && info?.playlist?.entries && currentJobId && !isPaused) {
      const validThumbs = info.playlist.entries.map(e => e.thumbnail || e.artistThumbnail).filter(Boolean);
      if (validThumbs.length > 1) {
        let idx = 0;
        setCurrentVinylImage(validThumbs[idx]);
        interval = setInterval(() => {
          idx = (idx + 1) % validThumbs.length;
          setCurrentVinylImage(validThumbs[idx]);
        }, 4000); // Shuffle every 4 seconds
      } else {
        setCurrentVinylImage(validThumbs[0] || info?.thumbnail || null);
      }
    } else {
      setCurrentVinylImage(info?.playlist?.thumbnail || info?.thumbnail || null);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [downloading, info, currentJobId, isPaused]);

  useEffect(() => {
    fetch("/api/ytdl/get-config")
      .then((r) => r.json())
      .then((data) => {
        if (data.customPath) setCustomPath(data.customPath);
      })
      .catch(() => { });
  }, []);

  // Smart Clipboard Auto-Detect
  useEffect(() => {
    const handleFocus = async () => {
      if (downloading || downloadComplete || info || !appMode) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text && isYouTubeUrl(text) && text !== url) {
          setUrl(text);
          setClipboardToast(true);
          setTimeout(() => setClipboardToast(false), 3000);
        }
      } catch (err) {
        // Ignore if clipboard access is denied or unavailable
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [url, downloading, downloadComplete, info, appMode]);

  // Emit download_update for Dynamic Island with title + thumbnail
  useEffect(() => {
    if (!downloading) return;
    window.dispatchEvent(
      new CustomEvent("download_update", {
        detail: {
          source: "youtube",
          progress,
          status: downloadStatus || "Connecting...",
          thumbnail: info?.thumbnail || null,
          title: info?.title || url || "YouTube",
          done: false,
        },
      }),
    );
  }, [downloading, progress, downloadStatus]);

  // Handle global shortcuts and paste
  useEffect(() => {
    if (appMode !== "single") return;
    const handlePaste = (e) => {
      setUrl(e.detail);
      setInfo(null);
      setError(null);
    };
    const handleDownload = () => {
      if (info && !downloading) handleDownloadClick();
    };
    window.addEventListener("app:paste-url", handlePaste);
    window.addEventListener("app:global-download", handleDownload);
    return () => {
      window.removeEventListener("app:paste-url", handlePaste);
      window.removeEventListener("app:global-download", handleDownload);
    };
  }, [info, downloading, appMode]);

  const handleOpenFolder = async (target = "") => {
    try {
      const cp = localStorage.getItem("customPath") || "";
      const res = await fetch(
        `/api/ytdl/open-folder?target=${encodeURIComponent(target)}&customPath=${encodeURIComponent(cp)}`,
      );
      if (!res.ok) {
        alert("Eroare: Fisierul nu a fost gasit. A fost mutat sau sters?");
      }
    } catch (e) {
      alert("Eroare la deschiderea folderului.");
    }
  };

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/ytdl/system-status");
        if (res.ok) setSystemStatus(await res.json());
      } catch (e) { }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const savedJobId = localStorage.getItem("ytdl_job_id");
    const savedScope = localStorage.getItem("ytdl_job_scope");

    if (savedJobId) {
      const savedUrl = localStorage.getItem("ytdl_url");
      const savedInfo = localStorage.getItem("ytdl_info");
      if (savedUrl) setUrl(savedUrl);
      if (savedInfo) {
        try {
          const parsedInfo = JSON.parse(savedInfo);
          setInfo(parsedInfo);
          let safeName = (parsedInfo.title || "video")
            .replace(/[^a-zA-Z0-9 _-]/g, "")
            .trim()
            .slice(0, 60);
          if (parsedInfo.playlist) {
            const allIndices = new Set(
              parsedInfo.playlist.entries.map((e) => e.index),
            );
            setSelectedTracks(allIndices);
            if (parsedInfo.playlist.title) {
              safeName = parsedInfo.playlist.title
                .replace(/[^a-zA-Z0-9 _-]/g, "")
                .trim()
                .slice(0, 60);
            }
          }
          setOutputName(safeName);
        } catch (e) { }
      }

      setDownloadScope(savedScope || "single");
      setCurrentJobId(savedJobId);
      reconnectToJob(savedJobId);
    }
  }, []);

  useEffect(() => {
    if (info && info.playlist && info.playlist.entries) {
      const entriesToEnrich = info.playlist.entries.slice(0, 10).filter(e => !e.enriched);
      if (entriesToEnrich.length > 0) {
        // Mark as enriched immediately to prevent duplicate fetches
        setInfo(prev => {
          if (!prev || !prev.playlist) return prev;
          const newEntries = [...prev.playlist.entries];
          entriesToEnrich.forEach(e => {
            const idx = newEntries.findIndex(x => x.id === e.id);
            if (idx !== -1) newEntries[idx] = { ...newEntries[idx], enriched: true };
          });
          return { ...prev, playlist: { ...prev.playlist, entries: newEntries } };
        });

        const items = entriesToEnrich.map(e => ({
          id: e.id,
          title: e.title,
          uploader: e.uploader
        }));

        fetch("/api/ytdl/enrich-tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items })
        })
          .then(r => r.json())
          .then(data => {
            if (data.success && data.results) {
              setInfo(prev => {
                if (!prev || !prev.playlist) return prev;
                const newEntries = [...prev.playlist.entries];
                for (const res of data.results) {
                  const idx = newEntries.findIndex(e => e.id === res.id);
                  if (idx !== -1) {
                    newEntries[idx] = {
                      ...newEntries[idx],
                      thumbnail: res.thumbnail || newEntries[idx].thumbnail,
                      album: res.album || newEntries[idx].album,
                      uploader: res.uploader || newEntries[idx].uploader,
                      artistThumbnail: res.artistThumbnail || newEntries[idx].artistThumbnail,
                    };
                  }
                }
                return { ...prev, playlist: { ...prev.playlist, entries: newEntries } };
              });
            }
          })
          .catch(err => console.error("Failed to enrich tracks", err));
      }
    }
  }, [info]);

  const reconnectToJob = (jobId) => {
    setDownloading(true);
    setStep(1);
    setDownloadStatus("Se reia conexiunea cu serverul...");

    if (eventSourceRef.current) eventSourceRef.current.close();

    const eventSource = new EventSource(`/api/ytdl/job-status?jobId=${jobId}`);
    eventSourceRef.current = eventSource;

    setupEventSourceHandlers(eventSource, jobId);
  };

  const setupEventSourceHandlers = (eventSource, jobId) => {
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.progress !== undefined) {
          setProgress(data.progress);
          if (data.progress > 0 && data.progress < 95) setStep(2);
          window.dispatchEvent(
            new CustomEvent("download_update", {
              detail: {
                source: "youtube",
                progress: data.progress,
                status: data.status || "Downloading...",
                thumbnail: null,
                title: null,
                done: false,
              },
            }),
          );
        }
        if (data.status) {
          setDownloadStatus(data.status);
          if (data.status.includes("arhiv")) setStep(3);
        }
        if (data.isPaused !== undefined) {
          setIsPaused(data.isPaused);
        }
        if (data.currentItem && data.totalItems) {
          setDownloadStatus(
            `Se descarca videoclipul ${data.currentItem} din ${data.totalItems}`,
          );
        }
        if (data.raw && data.raw.includes("Merging formats")) {
          setStep(3);
          setDownloadStatus("Se asambleaza fisierul final...");
        }
        if (data.error) {
          eventSource.close();
          setDownloading(false);
          setError(data.error);
          setStep(0);
          setCurrentJobId(null);
          localStorage.removeItem("ytdl_job_id");
          localStorage.removeItem("ytdl_job_scope");
          window.dispatchEvent(
            new CustomEvent("download_update", {
              detail: { source: "youtube", error: true },
            }),
          );
          return;
        }
        if (data.done) {
          eventSource.close();
          setDownloading(false);
          setDownloadComplete(true);
          setStep(4);
          setCurrentJobId(null);
          localStorage.removeItem("ytdl_job_id");
          localStorage.removeItem("ytdl_job_scope");
          window.dispatchEvent(
            new CustomEvent("download_update", {
              detail: { source: "youtube", done: true },
            }),
          );

          if (pendingScope === "playlist" && data.downloadedCount !== undefined) {
            const expectedCount = selectedTracks.size;
            const actualCount = data.downloadedCount;
            if (actualCount < expectedCount) {
              let missingEntries = [];
              if (data.failedIds && data.failedIds.length > 0) {
                missingEntries = Array.from(selectedTracks)
                  .map(idx => info.playlist.entries.find(e => e.index === idx))
                  .filter(e => e && data.failedIds.includes(e.id));
              }
              setMissingTracks({ actual: actualCount, expected: expectedCount, missing: missingEntries });
            } else {
              setMissingTracks(null);
            }
          }

          if (data.finalFilename) {
            setFinalFilename(data.finalFilename);

            try {
              let h = JSON.parse(
                localStorage.getItem("global_history") || "[]",
              );
              h.unshift({
                id: "youtube_" + Date.now(),
                title: info ? info.title : url,
                thumbnail: info ? info.thumbnail : null,
                date: Date.now(),
                source: "youtube",
                format: downloadFormat === "audio" ? "Audio" : "Video",
                filename: data.finalFilename,
              });
              if (h.length > 500) h.length = 500;
              localStorage.setItem("global_history", JSON.stringify(h));
              window.dispatchEvent(new Event("history_updated"));
            } catch (e) {
              console.error("Failed to update global history", e);
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse event data:", e);
      }
    };

    eventSource.onerror = () => {
      console.warn("EventSource connection lost.");
      eventSource.close();
      setDownloading(false);
      setError("Conexiunea cu serverul a fost pierduta.");
      setStep(0);
    };
  };

  const fetchInfo = async (inputUrl = url) => {
    const targetUrl =
      typeof inputUrl === "string" ? inputUrl.trim() : url.trim();
    if (!targetUrl) return;
    setUrl(targetUrl);
    setLoadingInfo(true);
    setError(null);
    setInfo(null);
    setDownloadComplete(false);
    setProgress(0);
    setStep(0);

    if (isMusicUrl(targetUrl)) {
      setMediaType("audio");
      setDownloadFormat("audio");
      setDownloadSourceMode("standard");
      if (appMode === null) setAppMode("music");
    } else {
      setMediaType("video");
      setDownloadSourceMode("standard");
      if (appMode === null) setAppMode("youtube");
    }

    try {
      const res = await fetch(
        `/api/ytdl/info?url=${encodeURIComponent(targetUrl)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch info");

      let playlist = null;
      if (
        data.contentType === "album" ||
        data.contentType === "playlist" ||
        isPlaylistUrl(targetUrl)
      ) {
        const playlistRes = await fetch(
          "/api/ytdl/collection-info?url=" + encodeURIComponent(targetUrl),
        );
        if (playlistRes.ok) {
          playlist = await playlistRes.json();
          const allIndices = new Set(playlist.entries.map((e) => e.index));
          setSelectedTracks(allIndices);
        }
      }
      if (data.platform === "youtube_music") {
        setAppMode("music");
        setMediaType("audio");
      } else {
        setAppMode("youtube");
      }
      setInfo({ ...data, playlist });

      if (playlist && playlist.entries) {
        const first10 = playlist.entries.slice(0, 10).map(e => e.url).filter(Boolean);
        if (first10.length > 0) {
          fetch('/api/ytdl/batch-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: first10 })
          })
            .then(res => res.json())
            .then(metaData => {
              if (metaData.success && metaData.results) {
                setInfo(prev => {
                  if (!prev || !prev.playlist) return prev;
                  const newEntries = prev.playlist.entries.map(entry => {
                    const meta = metaData.results[entry.id];
                    if (meta) {
                      return {
                        ...entry,
                        album: meta.album || entry.album,
                        artistThumbnail: meta.artistThumbnail || entry.artistThumbnail,
                        thumbnail: meta.thumbnail || entry.thumbnail
                      };
                    }
                    return entry;
                  });
                  return { ...prev, playlist: { ...prev.playlist, entries: newEntries } };
                });
              }
            })
            .catch(err => console.error("Batch meta fetch error:", err));
        }
      }

      // Dynamic ambient color from thumbnail
      if (data.thumbnail || (playlist && playlist.thumbnail)) {
        getAverageColor(data.thumbnail || playlist.thumbnail).then((color) => {
          setAmbientColor(color.replace("rgb", "rgba").replace(")", ", 0.15)"));
        });
      } else {
        setAmbientColor("rgba(239, 68, 68, 0.12)");
      }

      saveToHistory(
        targetUrl,
        playlist ? playlist.title : data.title,
        playlist && playlist.thumbnail ? playlist.thumbnail : data.thumbnail,
        playlist && playlist.uploader ? playlist.uploader : data.uploader || "",
        data.artistThumbnail || "",
        Boolean(playlist),
      );
      localStorage.setItem("ytdl_url", targetUrl);
      localStorage.setItem("ytdl_info", JSON.stringify({ ...data, playlist }));
      const safeName = (data.title || "video")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim()
        .slice(0, 60);
      setOutputName(safeName);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  const openDownloadModal = (scope = "single") => {
    setPendingScope(scope);
    setShowOptionsModal(true);
  };

  const toggleTrack = (index) => {
    const newSet = new Set(selectedTracks);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedTracks(newSet);
  };

  const selectAllTracks = () => {
    if (!info?.playlist) return;
    setSelectedTracks(new Set(info.playlist.entries.map((e) => e.index)));
  };

  const deselectAllTracks = () => {
    setSelectedTracks(new Set());
  };

  const handleDownload = async (
    scope,
    computedFormat,
    overrideTracks = null,
  ) => {
    setDownloading(true);
    setDownloadComplete(false);
    setDownloadStatus("Se conecteaza la server...");
    setStep(1);
    setError(null);
    setDownloadScope(scope);

    const formatToUse = computedFormat || downloadFormat;

    try {
      let jobId;
      if (downloadSourceMode === "smart") {
        let items = [];
        if (scope === "single" && !overrideTracks) {
          items.push(
            `ytsearch1:${info.uploader || ""} ${info.title} official audio`,
          );
        } else {
          const selectedEntries = info.playlist.entries.filter((e) =>
            (overrideTracks || selectedTracks).has(e.index),
          );
          items = selectedEntries.map(
            (e) => `ytsearch1:${e.uploader || ""} ${e.title} official audio`,
          );
        }

        const res = await fetch("/api/ytdl/smart-download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: info.url || url,
            items,
            format: mediaType,
            scope,
            title: (info.playlist && info.playlist.title) ? info.playlist.title : info.title,
            thumbnail: (info.playlist && info.playlist.thumbnail) ? info.playlist.thumbnail : info.thumbnail,
            formatStr: computedFormat,
            jobId: Date.now().toString(),
            customPath: localStorage.getItem("customPath") || "",
            preset: localStorage.getItem("download_preset") || "AUTO",
            hwaccel: localStorage.getItem("hardware_acceleration") || "NONE",
            prependNumbers,
            collectionType: info.contentType || "playlist",
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Server error");

        if (data.scheduled) {
          setDownloading(false);
          setDownloadComplete(true);
          setFinalFilename(`[Programat la ${scheduleTime}]`);
          return;
        }
        jobId = data.jobId;
      } else if (scope === "playlist" && info?.platform === "youtube_music") {
        // ── YouTube Music per-track fallback download ─────────────────────
        // Uses the new /api/ytdl/ytmusic-playlist-download endpoint which
        // downloads each track individually with retry + YouTube search fallback.
        const plTitle = (info.playlist && info.playlist.title) ? info.playlist.title : (info.title || "");
        const plThumb = (info.playlist && info.playlist.thumbnail) ? info.playlist.thumbnail : (info.thumbnail || "");
        const selectedItems = Array.from(overrideTracks || selectedTracks).sort((a, b) => a - b).join(",");
        const [, audioFmtName = "mp3"] = formatToUse.startsWith("audio:") ? formatToUse.split(":") : ["audio", "mp3"];

        const qp = new URLSearchParams({
          url: info.url || url,
          format: formatToUse,
          title: plTitle,
          thumbnail: plThumb,
          selectedItems,
          customPath: localCustomPath || localStorage.getItem("customPath") || "",
          prependNumbers: prependNumbers.toString(),
          concurrency: "3",
        });

        // Reset YTMusic-specific state
        setYtMusicFallbackStatus(null);
        setYtMusicFailedTracks([]);
        setYtMusicStats(null);

        const controller = new AbortController();
        ytMusicAbortRef.current = controller;

        // Stream the SSE response ourselves (fetch + ReadableStream)
        const streamRes = await fetch(`/api/ytdl/ytmusic-playlist-download?${qp.toString()}`, {
          signal: controller.signal,
        });

        if (!streamRes.ok) {
          const errData = await streamRes.json().catch(() => ({}));
          throw new Error(errData.error || "Server error starting YTMusic download");
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processLine = (line) => {
          if (!line.startsWith("data: ")) return;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.progress !== undefined) setProgress(data.progress);
            if (data.totalTracks !== undefined) setYtMusicStats(prev => ({ ...prev, total: data.totalTracks }));
            if (data.status) setDownloadStatus(data.status);

            // Per-track progress
            if (data.currentTrack && data.totalTracks) {
              setDownloadStatus(
                data.fallbackSearch
                  ? `Searching YouTube for: ${data.trackTitle}`
                  : data.fallbackFound
                    ? `Found: ${data.fallbackTitle} — Downloading...`
                    : `Track ${data.currentTrack} / ${data.totalTracks}${data.trackTitle ? " — " + data.trackTitle : ""}`
              );
              if (data.progress > 0 && data.progress < 95) setStep(2);
            }

            // Fallback status display — include thumbnail from the playlist entry
            if (data.trackThumbnail) setYtMusicCurrentThumbnail(data.trackThumbnail);
            if (data.fallbackSearch) setYtMusicFallbackStatus({ trackTitle: data.trackTitle, stage: "searching", thumbnail: data.trackThumbnail || null });
            if (data.fallbackFound) setYtMusicFallbackStatus({ trackTitle: data.trackTitle, stage: "found", fallbackTitle: data.fallbackTitle, thumbnail: data.trackThumbnail || null });
            if (data.fallbackFailed) setYtMusicFallbackStatus({ trackTitle: data.trackTitle, stage: "failed", thumbnail: data.trackThumbnail || null });

            if (data.trackDone) {
              setYtMusicFallbackStatus(null);
              setYtMusicStats(prev => ({ ...prev, completed: (prev?.completed || 0) + 1 }));
            }
            if (data.trackError) {
              setYtMusicFallbackStatus(null);
              setYtMusicStats(prev => ({ ...prev, failed: (prev?.failed || 0) + 1 }));
            }

            // Dispatch DynamicIsland update
            window.dispatchEvent(new CustomEvent("download_update", {
              detail: { source: "youtube", progress: data.progress || 0, status: data.status || "Downloading...", done: !!data.done },
            }));

            if (data.error && !data.done) {
              setError(data.error);
              setDownloading(false);
              setStep(0);
              ytMusicAbortRef.current = null;
              return;
            }

            if (data.done) {
              setDownloading(false);
              setDownloadComplete(true);
              setStep(4);
              setFinalFilename(data.finalFilename || plTitle);
              setYtMusicStats({ completed: data.completedTracks, failed: data.failedTracks, total: data.totalTracks });
              if (data.failedTracksData?.length) setYtMusicFailedTracks(data.failedTracksData);
              setYtMusicFallbackStatus(null);
              ytMusicAbortRef.current = null;
              window.dispatchEvent(new CustomEvent("download_update", { detail: { source: "youtube", done: true } }));

              // Add to global history
              try {
                let h = JSON.parse(localStorage.getItem("global_history") || "[]");
                h.unshift({ id: "youtube_" + Date.now(), title: plTitle, thumbnail: plThumb, date: Date.now(), source: "youtube", format: "Audio", filename: data.finalFilename || plTitle });
                if (h.length > 500) h.length = 500;
                localStorage.setItem("global_history", JSON.stringify(h));
                window.dispatchEvent(new Event("history_updated"));
              } catch { }
            }
          } catch { }
        };

        // Read the stream
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
              if (line.trim()) processLine(line.trim());
            }
          }
        } catch (streamErr) {
          if (streamErr.name !== "AbortError") throw streamErr;
        }
        return; // Done — no jobId needed
      } else {
        const endpoint =
          scope === "playlist"
            ? "/api/ytdl/collection-download"
            : "/api/ytdl/download";
        const queryParams = new URLSearchParams({
          url: info.url || url,
          format: formatToUse,
          title: (info.playlist && info.playlist.title) ? info.playlist.title : (info.title || ""),
          thumbnail: (info.playlist && info.playlist.thumbnail) ? info.playlist.thumbnail : (info.thumbnail || ""),
          jobId: Date.now().toString(),
          preset: localStorage.getItem("download_preset") || "AUTO",
          hwaccel: localStorage.getItem("hardware_acceleration") || "NONE",
          customPath: localCustomPath || localStorage.getItem("customPath") || "",
          prependNumbers: prependNumbers.toString(),
          collectionType: info.contentType || "playlist",
        });
        if (scope === "playlist") {
          queryParams.append(
            "selectedItems",
            Array.from(overrideTracks || selectedTracks)
              .sort((a, b) => a - b)
              .join(","),
          );
        }
        if (scheduleTime) {
          queryParams.append("scheduleTime", scheduleTime);
        }
        jobId = queryParams.get("jobId");

        const res = await fetch(`${endpoint}?${queryParams.toString()}`);
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          if (data.scheduled) {
            setDownloading(false);
            setDownloadComplete(true);
            setFinalFilename(`[Programat la ${scheduleTime}]`);
            return;
          }
        }
      }

      setCurrentJobId(jobId);
      localStorage.setItem("ytdl_job_id", jobId);
      localStorage.setItem("ytdl_job_scope", scope);
      reconnectToJob(jobId);
    } catch (err) {
      setError(err.message);
      setDownloading(false);
      setStep(0);
    }
  };

  const startDownload = (overrideTracks = null) => {
    if (
      pendingScope === "playlist" &&
      (overrideTracks || selectedTracks).size === 0
    ) {
      alert("Te rog selecteaza cel putin o melodie.");
      return;
    }

    setShowOptionsModal(false);
    if (!url) return;

    setDownloadStatus(
      pendingScope === "playlist"
        ? "Se pregateste playlistul..."
        : "Se pregateste descarcarea...",
    );

    if (pendingScope === "playlist" && info?.playlist?.title) {
      setOutputName(
        info.playlist.title
          .replace(/[^a-zA-Z0-9 _-]/g, "")
          .trim()
          .slice(0, 60) || "youtube_playlist",
      );
    }

    let formatStr;
    if (mediaType === "audio") {
      const af =
        AUDIO_FORMATS.find((a) => a.id === selectedAudio) || AUDIO_FORMATS[0];
      formatStr = `audio:${af.audioFmt}:${af.quality}`;
    } else {
      const resOpt =
        RESOLUTIONS.find((r) => r.id === selectedRes) || RESOLUTIONS[2];
      formatStr = `video:${resOpt.format}`;
    }
    setDownloadFormat(formatStr);

    handleDownload(
      pendingScope,
      formatStr,
      overrideTracks instanceof Set ? overrideTracks : null,
    );
  };

  const handleJobAction = async (action) => {
    if (!currentJobId) return;
    try {
      await fetch(
        `/api/ytdl/job-action?jobId=${currentJobId}&action=${action}`,
      );
      if (action === "cancel") {
        if (eventSourceRef.current) eventSourceRef.current.close();
        handleReset();
      }
    } catch (err) {
      console.error(`Failed to ${action} job`, err);
    }
  };

  const handleReset = () => {
    if (downloading && !currentJobId) {
      if (!confirm("Esti sigur ca vrei sa anulezi descarcarea curenta?"))
        return;
    }
    setInfo(null);
    setUrl("");
    setDownloadComplete(false);
    setDownloading(false);
    setIsPaused(false);
    setProgress(0);
    setFinalFilename("");
    setError(null);
    setDownloadScope("single");
    setDownloadStatus("");
    setStep(0);
    setCurrentJobId(null);
    setAppMode(null);
    setShowLibrary(false);
    setScheduleTime("");
    // Cancel any active YTMusic stream
    if (ytMusicAbortRef.current) { ytMusicAbortRef.current.abort(); ytMusicAbortRef.current = null; }
    setYtMusicFallbackStatus(null);
    setYtMusicFailedTracks([]);
    setYtMusicStats(null);
    setYtMusicCurrentThumbnail(null);
    localStorage.removeItem("ytdl_job_id");
    localStorage.removeItem("ytdl_job_scope");
    localStorage.removeItem("ytdl_url");
    localStorage.removeItem("ytdl_info");
  };

  const selectAppMode = (mode) => {
    setAppMode(mode);
    if (mode === "music") {
      setMediaType("audio");
      setDownloadFormat("audio");
      setDownloadSourceMode("standard");
    } else {
      setMediaType("video");
      setDownloadSourceMode("standard");
    }
  };

  return (
    <div
      className={`ytdl-page ${appMode === "music" ? "mode-music" : ""}`}
      style={{ "--ambient-color": ambientColor }}
    >
      <div className="ytdl-bg-glow" />
      <WaveformBg isActive={downloading} color={ambientColor} />

      <div className="ytdl-layout">
        <motion.header
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="ytdl-header"
        >
          {/* Left spacer — balances the right actions column */}
          <div className="ytdl-header-center">
            <div className="ytdl-platform-badge">
              {appMode === "music" ? (
                <>
                  <Music size={14} strokeWidth={2.5} />
                  YT Music
                </>
              ) : (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="14"
                    height="14"
                  >
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  YouTube
                </>
              )}
            </div>
            <h1 className="ytdl-title">YouTube video & music</h1>
            <p className="ytdl-subtitle">
              A focused workspace for video, audio, playlists and YouTube Music.
            </p>
          </div>

          {/* Right: action buttons */}
          <div className="ytdl-header-actions">
            {info && !downloading && (
              <button
                className="ytdl-reset-btn"
                onClick={handleReset}
                title="Resetare"
              >
                <RefreshCw size={18} />
              </button>
            )}
          </div>
        </motion.header>

        <AnimatePresence>
          {systemStatus && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className={`ytdl-system-status ${isStatusExpanded ? "expanded" : "collapsed"}`}
            >
              <div
                className="ytdl-status-header-row"
                onClick={() => setIsStatusExpanded(!isStatusExpanded)}
              >
                <div className="ytdl-status-quick">
                  <Activity size={16} />
                  <span>System Status</span>
                  {systemStatus.activeJobs > 0 && (
                    <span className="ytdl-status-badge">
                      {systemStatus.activeJobs} Active Jobs
                    </span>
                  )}
                  {(1 - systemStatus.freeMem / systemStatus.totalMem) * 100 >
                    85 && (
                      <span className="ytdl-status-badge warning">High RAM</span>
                    )}
                </div>
                <div className="ytdl-status-toggle">
                  {isStatusExpanded ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </div>
              </div>

              <AnimatePresence>
                {isStatusExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="ytdl-status-grid-container"
                  >
                    <div className="ytdl-status-grid">
                      <div className="ytdl-status-item" title="API Hits">
                        <Activity size={16} />
                        <span>
                          API Hits:{" "}
                          <strong>{systemStatus.totalHits || 0}</strong>
                        </span>
                      </div>
                      <div
                        className="ytdl-status-item"
                        title="Timp de rulare server (Uptime)"
                      >
                        <Clock size={16} />
                        <span>
                          Uptime:{" "}
                          <strong>
                            {Math.floor((systemStatus.uptime || 0) / 60000)}m
                          </strong>
                        </span>
                      </div>
                      <div
                        className="ytdl-status-item"
                        title="Sarcini de descarcare active"
                      >
                        <Zap size={16} />
                        <span>
                          Active: <strong>{systemStatus.activeJobs}</strong>
                        </span>
                      </div>
                      <div
                        className="ytdl-status-item"
                        title="Rata de succes a descarcarilor"
                      >
                        <CheckCircle2 size={16} />
                        <span>
                          Succes:{" "}
                          <strong>
                            {systemStatus.totalHits > 0
                              ? (
                                (systemStatus.successfulDownloads /
                                  Math.max(
                                    1,
                                    systemStatus.successfulDownloads +
                                    systemStatus.failedDownloads,
                                  )) *
                                100
                              ).toFixed(0) + "%"
                              : "100%"}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="ytdl-status-bars">
                      <div className="ytdl-status-bar-wrapper">
                        <div className="ytdl-status-bar-labels">
                          <span>
                            <Cpu size={14} /> RAM Usage
                          </span>
                          <strong>
                            {(
                              (1 -
                                systemStatus.freeMem / systemStatus.totalMem) *
                              100
                            ).toFixed(1)}
                            %
                          </strong>
                        </div>
                        <div className="ytdl-status-progress-bg">
                          <div
                            className="ytdl-status-progress-fill"
                            style={{
                              width: `${(1 - systemStatus.freeMem / systemStatus.totalMem) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="ytdl-status-bar-wrapper">
                        <div className="ytdl-status-bar-labels">
                          <span>
                            <HardDrive size={14} /> Free Space
                          </span>
                          <strong
                            className={
                              systemStatus.freeSpace < 1073741824
                                ? "text-danger"
                                : ""
                            }
                          >
                            {formatBytes(systemStatus.freeSpace)}
                          </strong>
                        </div>
                        <div className="ytdl-status-progress-bg">
                          <div
                            className="ytdl-status-progress-fill space-fill"
                            style={{
                              width: `${Math.max(0, Math.min(100, 100 - (systemStatus.freeSpace / 500000000000) * 100))}%`,
                            }} /* Dummy visualization, free space scale can be hard to map perfectly */
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {!downloading && !downloadComplete && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={`ytdl-url-card ${appMode === "music" ? "music-active" : "youtube-active"}`}
            style={{ position: "relative", zIndex: 50 }}
          >
            <div className="ytdl-input-section-label">
              <span>New download</span>
              <small>Paste a YouTube video, playlist, or Music link</small>
            </div>
            {!downloading && !downloadComplete && (
              <div className="ytdl-mode-toggle">
                <button
                  className={`ytdl-mode-toggle-btn ${appMode !== "music" ? "active" : ""}`}
                  onClick={() => selectAppMode("youtube")}
                >
                  <MonitorPlay size={14} /> Video
                </button>
                <button
                  className={`ytdl-mode-toggle-btn ${appMode === "music" ? "active" : ""}`}
                  onClick={() => selectAppMode("music")}
                >
                  <Music size={14} /> Music
                </button>
              </div>
            )}

            {clipboardToast && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="ytdl-clipboard-toast"
              >
                Link detectat din clipboard!
              </motion.div>
            )}

            <div className="ytdl-url-icon">
              <Link2 size={24} />
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                position: "relative",
              }}
            >
              <input
                type="text"
                placeholder={
                  appMode === "music"
                    ? "Lipeste link-ul piesei de YouTube Music..."
                    : "Lipeste link-ul de YouTube (Video)..."
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setShowHistory(true)}
                onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
                disabled={loadingInfo}
                className="ytdl-url-input"
                style={{ width: "100%", paddingRight: url ? "3rem" : "0" }}
              />
              {url && (
                <button
                  className="ytdl-input-clear"
                  type="button"
                  aria-label="Clear URL"
                  title="Clear URL"
                  onClick={() => {
                    setUrl("");
                    setInfo(null);
                    setDownloadComplete(false);
                  }}
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
            <AnimatePresence>
              {showHistory && history.length > 0 && !url && (
                <motion.div
                  className="ytdl-history-dropdown"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#121218",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    padding: "0.5rem",
                    zIndex: 100,
                    marginTop: "0.5rem",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "rgba(255,255,255,0.5)",
                      padding: "0 0.5rem 0.5rem",
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Ultimele descarcari
                  </div>
                  {history.map((h, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "0.5rem",
                        cursor: "pointer",
                        borderRadius: "4px",
                        fontSize: "0.85rem",
                        color: "#fff",
                      }}
                      onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(255,255,255,0.1)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                      onMouseDown={() => {
                        setUrl(h.url);
                        setShowHistory(false);
                        setTimeout(() => fetchInfo(h.url), 100);
                      }}
                    >
                      {h.thumbnail ? (
                        <img
                          src={h.thumbnail}
                          alt=""
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "4px",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <Clock size={14} style={{ opacity: 0.5 }} />
                      )}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {h.title}
                        </span>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            <button
              className="ytdl-fetch-btn"
              onClick={() => fetchInfo()}
              disabled={!url || loadingInfo}
            >
              {loadingInfo ? (
                <>
                  <Loader2 className="spin" size={20} /> Se cauta...
                </>
              ) : (
                <>
                  <Zap size={20} fill="currentColor" /> Proceseaza
                </>
              )}
            </button>
            <div className="ytdl-capability-row">
              <span>
                <MonitorPlay size={14} /> MP4 up to 4K
              </span>
              <span>
                <Headphones size={14} /> High-quality audio
              </span>
              <span>
                <ListVideo size={14} /> Playlist selection
              </span>
              <span>
                <Zap size={14} /> Local processing
              </span>
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="ytdl-error"
            >
              <AlertCircle size={20} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {loadingInfo && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.3 }}
              className="ytdl-skeleton-card"
            >
              <motion.div
                className="ytdl-skel-cover"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.05, duration: 0.4 }}
              />
              <div className="ytdl-skel-lines">
                {[
                  { cls: "long", delay: 0.1 },
                  { cls: "short", delay: 0.18 },
                  { cls: "chips", delay: 0.26 },
                ].map(({ cls, delay }) => (
                  <motion.div
                    key={cls}
                    className={`ytdl-skel-line ${cls}`}
                    initial={{ opacity: 0, scaleX: 0, originX: 0 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ delay, duration: 0.4, ease: "easeOut" }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(info || downloading || downloadComplete) && !loadingInfo && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
              className="ytdl-main-card"
            >
              {info && (
                <>
                  <div className="ytdl-preview-section">
                    <div
                      className={
                        "ytdl-thumbnail-wrapper" +
                        (info.contentType === "track" ||
                          info.contentType === "album" ||
                          info.contentType === "playlist"
                          ? " ytdl-thumbnail-square"
                          : "")
                      }
                    >
                      <img
                        src={info.playlist?.thumbnail || info.thumbnail}
                        alt="thumbnail"
                        className="ytdl-thumbnail"
                        onError={(e) => {
                          if (e.target.src.includes("maxresdefault.jpg")) {
                            e.target.src = e.target.src.replace("maxresdefault.jpg", "hqdefault.jpg");
                          }
                        }}
                      />
                      {info.contentType !== "playlist" && (
                        <span className="ytdl-duration-badge">
                          {formatDuration(info.duration)}
                        </span>
                      )}
                    </div>
                    <div className="ytdl-video-meta">
                      <h2 className="ytdl-video-title">{info.playlist?.title || info.title}</h2>
                      <div className="ytdl-video-channel">
                        <span style={{ fontWeight: 700, color: "#f1f5f9" }}>
                          {info.playlist?.uploader || info.uploader}
                        </span>{" "}
                        •{" "}
                        {info.platform === "youtube_music"
                          ? "YouTube Music"
                          : "YouTube"}
                      </div>
                      {/* Only show album/track info for actual tracks or albums, NOT playlists */}
                      {info.contentType !== "playlist" && info.album && (
                        <p className="ytdl-video-album">
                          {info.album}
                          {info.albumArtist &&
                            info.albumArtist !== info.uploader
                            ? ` · ${info.albumArtist}`
                            : ""}
                        </p>
                      )}
                      <div className="ytdl-video-stats">
                        {info.contentType !== "playlist" && (
                          <span className="ytdl-stat-chip">
                            <Clock size={14} /> {formatDuration(info.duration)}
                          </span>
                        )}
                        {info.contentType !== "playlist" &&
                          info.trackNumber &&
                          info.trackCount && (
                            <span className="ytdl-stat-chip">
                              Track {info.trackNumber} / {info.trackCount}
                            </span>
                          )}
                        {info.contentType !== "playlist" &&
                          info.releaseYear && (
                            <span className="ytdl-stat-chip">
                              {info.releaseYear}
                            </span>
                          )}
                        {info.contentType === "playlist" && info.playlist && (
                          <span className="ytdl-stat-chip">
                            <ListVideo size={13} />{" "}
                            {info.playlist.downloadableCount} songs
                          </span>
                        )}
                        <div className="ytdl-content-tags">
                          <span
                            className={`ytdl-content-badge ytdl-content-badge--${info.contentType || "video"}`}
                          >
                            {info.contentType === "album"
                              ? "Album"
                              : info.contentType === "playlist"
                                ? "Playlist"
                                : info.contentType === "track"
                                  ? "Track"
                                  : "Video"}
                          </span>
                          {info.album && info.contentType === "track" && (
                            <span className="ytdl-content-badge ytdl-content-badge--album">
                              Album track
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {info.playlist && !downloading && !downloadComplete && (
                    <div className="ytdl-playlist-panel">
                      <div className="ytdl-playlist-panel-top">
                        <div className="ytdl-playlist-panel-icon">
                          <ListVideo size={20} />
                        </div>
                        <div>
                          <span className="ytdl-eyebrow">
                            {info.contentType === "album"
                              ? "ALBUM GASIT"
                              : "PLAYLIST GASIT"}
                          </span>
                          <strong>{info.playlist.title}</strong>
                        </div>
                        <div className="ytdl-playlist-count">
                          {info.playlist.downloadableCount}
                          <small>
                            {appMode === "music"
                              ? `PIES${info.playlist.downloadableCount !== 1 ? "E" : "A"}`
                              : `VIDEO${info.playlist.downloadableCount !== 1 ? "S" : ""}`}
                          </small>
                        </div>
                      </div>

                      <div className="ytdl-playlist-preview">
                        <div className="ytdl-playlist-toolbar">
                          <div className="ytdl-playlist-toolbar-left">
                            <span className="ytdl-playlist-selection-count">
                              {selectedTracks.size} selected
                            </span>
                          </div>
                          <div className="ytdl-playlist-toolbar-right">
                            <div
                              style={{
                                display: "flex",
                                gap: "4px",
                                marginRight: "8px",
                              }}
                            >
                              <button
                                className={`ytdl-playlist-tool-btn ${playlistViewMode === "list" ? "active" : ""}`}
                                onClick={() => setPlaylistViewMode("list")}
                                title="List View"
                                style={
                                  playlistViewMode === "list"
                                    ? {
                                      background: "var(--theme-primary)",
                                      color: "#fff",
                                      borderColor: "var(--theme-primary)",
                                    }
                                    : {}
                                }
                              >
                                <ListVideo size={14} />
                              </button>
                              <button
                                className={`ytdl-playlist-tool-btn ${playlistViewMode === "grid" ? "active" : ""}`}
                                onClick={() => setPlaylistViewMode("grid")}
                                title="Grid View"
                                style={
                                  playlistViewMode === "grid"
                                    ? {
                                      background: "var(--theme-primary)",
                                      color: "#fff",
                                      borderColor: "var(--theme-primary)",
                                    }
                                    : {}
                                }
                              >
                                <LayoutGrid size={14} />
                              </button>
                            </div>
                            <button
                              className="ytdl-playlist-tool-btn"
                              onClick={() =>
                                setSelectedTracks(
                                  new Set(
                                    info.playlist.entries.map((e) => e.index),
                                  ),
                                )
                              }
                            >
                              Select All
                            </button>
                            <button
                              className="ytdl-playlist-tool-btn"
                              onClick={() => setSelectedTracks(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        <div
                          className={
                            playlistViewMode === "grid"
                              ? "ytdl-playlist-grid"
                              : "ytdl-track-list"
                          }
                        >
                          {playlistViewMode === "list" && (
                            <div className="ytdl-playlist-preview-header">
                              <div></div>
                              <div></div>
                              <div>Titlu</div>
                              <div>Artist</div>
                              <div>Album</div>
                              <div style={{ textAlign: "right" }}>Durata</div>
                              <div></div>
                            </div>
                          )}

                          {info.playlist.entries
                            .slice(0, 10)
                            .map((entry, i) => {
                              const isSelected = selectedTracks.has(
                                entry.index,
                              );

                              let cleanTitle = entry.title;
                              let featArtist = "";
                              const featMatch =
                                cleanTitle.match(
                                  /\((?:feat\.|ft\.)\s+(.+?)\)/i,
                                ) ||
                                cleanTitle.match(
                                  /\[(?:feat\.|ft\.)\s+(.+?)\]/i,
                                ) ||
                                cleanTitle.match(
                                  /feat\.\s+(.+?)(?=\s*-|\s*$)/i,
                                );
                              if (featMatch) {
                                featArtist = featMatch[1];
                                cleanTitle = cleanTitle
                                  .replace(featMatch[0], "")
                                  .trim();
                              }

                              let isExplicit = false;
                              if (
                                cleanTitle.match(/\(Explicit\)/i) ||
                                cleanTitle.match(/\[Explicit\]/i)
                              ) {
                                isExplicit = true;
                                cleanTitle = cleanTitle
                                  .replace(/\(Explicit\)/i, "")
                                  .replace(/\[Explicit\]/i, "")
                                  .trim();
                              }

                              if (playlistViewMode === "grid") {
                                return (
                                  <div
                                    key={entry.index}
                                    className={`ytdl-playlist-card ${isSelected ? "selected" : ""}`}
                                    onClick={() => toggleTrack(entry.index)}
                                  >
                                    <div className="ytdl-playlist-card-thumb">
                                      {entry.thumbnail ? (
                                        <img src={entry.thumbnail} alt="" />
                                      ) : (
                                        <div className="ytdl-playlist-card-fallback">
                                          <Music size={24} />
                                        </div>
                                      )}

                                      <div className="ytdl-playlist-card-overlay">
                                        <div className="ytdl-playlist-card-top">
                                          <div
                                            className={`ytdl-playlist-card-check ${isSelected ? "checked" : ""}`}
                                          >
                                            {isSelected && (
                                              <Check
                                                size={12}
                                                strokeWidth={3}
                                              />
                                            )}
                                          </div>
                                        </div>
                                        <div className="ytdl-playlist-card-bottom">
                                          <span className="ytdl-playlist-card-duration">
                                            {formatDuration(entry.duration)}
                                          </span>
                                          <button
                                            className="ytdl-playlist-card-quick-dl"
                                            title="Download only this track"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setPendingScope("playlist");
                                              startDownload(
                                                new Set([entry.index]),
                                              );
                                            }}
                                          >
                                            <Download size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="ytdl-playlist-card-info">
                                      <strong className="ytdl-playlist-card-title">
                                        {cleanTitle}
                                        {isExplicit && (
                                          <span
                                            className="ytdl-explicit-badge"
                                            style={{ marginLeft: 4 }}
                                          >
                                            E
                                          </span>
                                        )}
                                      </strong>
                                      <div
                                        className="ytdl-playlist-card-artist"
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "6px",
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: 18,
                                            height: 18,
                                            borderRadius: "50%",
                                            overflow: "hidden",
                                            flexShrink: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            background: "rgba(255,255,255,0.1)",
                                          }}
                                        >
                                          {entry.artistThumbnail ||
                                            (info.contentType !== "playlist" &&
                                              !(
                                                entry.uploader &&
                                                info.albumArtist &&
                                                entry.uploader.toLowerCase() !==
                                                info.albumArtist.toLowerCase()
                                              ) &&
                                              info.artistThumbnail) ? (
                                            <img
                                              src={
                                                entry.artistThumbnail ||
                                                info.artistThumbnail
                                              }
                                              alt=""
                                              style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "cover",
                                              }}
                                            />
                                          ) : (
                                            <User size={12} color="#94a3b8" />
                                          )}
                                        </div>
                                        <span
                                          style={{
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                        >
                                          {entry.uploader ||
                                            info.albumArtist ||
                                            "Unknown"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              } else {
                                return (
                                  <div
                                    key={entry.index}
                                    className={`ytdl-playlist-preview-row ${isSelected ? "selected" : ""}`}
                                    onClick={() => toggleTrack(entry.index)}
                                  >
                                    <div className="ytdl-preview-checkbox-wrapper">
                                      <span className="ytdl-track-num">
                                        {i + 1}
                                      </span>
                                      <div
                                        className={`ytdl-playlist-checkbox ${isSelected ? "checked" : ""}`}
                                      >
                                        {isSelected && (
                                          <Check
                                            size={12}
                                            strokeWidth={2.5}
                                            color="#fff"
                                          />
                                        )}
                                      </div>
                                    </div>
                                    {entry.thumbnail ? (
                                      <img
                                        src={entry.thumbnail}
                                        alt=""
                                        className="ytdl-preview-row-thumb"
                                      />
                                    ) : (
                                      <div className="ytdl-preview-row-thumb-fallback">
                                        <Music size={14} />
                                      </div>
                                    )}
                                    <div className="ytdl-preview-row-title-col">
                                      <strong>
                                        {cleanTitle}
                                        {isExplicit && (
                                          <span className="ytdl-explicit-badge">
                                            E
                                          </span>
                                        )}
                                      </strong>
                                      {featArtist && (
                                        <span className="ytdl-feat-artist">
                                          feat. {featArtist}
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      className="ytdl-preview-row-text-col"
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 28,
                                          height: 28,
                                          borderRadius: "50%",
                                          overflow: "hidden",
                                          flexShrink: 0,
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          background: "rgba(255,255,255,0.1)",
                                        }}
                                      >
                                        {entry.artistThumbnail ||
                                          (!(
                                            entry.uploader &&
                                            info.albumArtist &&
                                            entry.uploader.toLowerCase() !==
                                            info.albumArtist.toLowerCase()
                                          ) &&
                                            info.artistThumbnail) ? (
                                          <img
                                            src={
                                              entry.artistThumbnail ||
                                              info.artistThumbnail
                                            }
                                            alt=""
                                            style={{
                                              width: "100%",
                                              height: "100%",
                                              objectFit: "cover",
                                            }}
                                          />
                                        ) : (
                                          <User size={16} color="#94a3b8" />
                                        )}
                                      </div>
                                      <span
                                        style={{
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                        }}
                                      >
                                        {entry.uploader ||
                                          info.albumArtist ||
                                          "Unknown"}
                                      </span>
                                    </div>
                                    <div className="ytdl-preview-row-text-col" title={entry.album || (info.contentType === "album" && info.playlist?.title ? info.playlist.title.replace(/^Album\s*-\s*/i, "") : "-")}>
                                      {entry.album ||
                                        (info.contentType === "album" && info.playlist?.title
                                          ? info.playlist.title.replace(
                                            /^Album\s*-\s*/i,
                                            "",
                                          )
                                          : "-")}
                                    </div>
                                    <span className="ytdl-preview-row-duration">
                                      {formatDuration(entry.duration)}
                                    </span>
                                    <button
                                      className="ytdl-preview-quick-dl"
                                      title="Download only this track"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        let formatStr;
                                        if (mediaType === "audio") {
                                          const af =
                                            AUDIO_FORMATS.find(
                                              (a) => a.id === selectedAudio,
                                            ) || AUDIO_FORMATS[0];
                                          formatStr = `audio:${af.audioFmt}:${af.quality}`;
                                        } else {
                                          const resOpt =
                                            RESOLUTIONS.find(
                                              (r) => r.id === selectedRes,
                                            ) || RESOLUTIONS[2];
                                          formatStr = `video:${resOpt.format}`;
                                        }
                                        handleDownload(
                                          "playlist",
                                          formatStr,
                                          new Set([entry.index]),
                                        );
                                      }}
                                    >
                                      <Download size={14} />
                                    </button>
                                  </div>
                                );
                              }
                            })}
                        </div>

                        {info.playlist.entries.length > 10 && (
                          <div
                            className="ytdl-playlist-utility"
                            style={{ opacity: 0.7, cursor: "default" }}
                          >
                            + {info.playlist.entries.length - 10} mai multe melodii (vor fi descărcate toate)
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              <AnimatePresence>
                {showOptionsModal && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="ytdl-modal-overlay"
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="ytdl-modal"
                    >
                      <h3 className="ytdl-modal-title">
                        {pendingScope === "playlist"
                          ? "Setari Descarcare Playlist"
                          : "Setari Descarcare"}
                      </h3>

                      <div className="ytdl-modal-body ytdl-settings">
                        <div className="ytdl-setting-group">
                          <span className="ytdl-setting-label">Sursa:</span>
                          <div className="ytdl-type-tabs">
                            <button
                              className={`ytdl-type-tab ${downloadSourceMode === "standard" ? "active" : ""}`}
                              onClick={() => setDownloadSourceMode("standard")}
                            >
                              Standard (Link exact)
                            </button>
                            <button
                              className={`ytdl-type-tab ${downloadSourceMode === "smart" ? "active" : ""}`}
                              onClick={() => setDownloadSourceMode("smart")}
                              disabled={appMode === "youtube"}
                            >
                              Smart Song Match
                            </button>
                          </div>
                        </div>
                        <div className="ytdl-setting-group">
                          <span className="ytdl-setting-label">
                            Formatul dorit:
                          </span>
                          <div className="ytdl-type-tabs">
                            <button
                              className={`ytdl-type-tab ${mediaType === "video" ? "active" : ""}`}
                              onClick={() => setMediaType("video")}
                            >
                              <MonitorPlay size={18} /> Video (MP4)
                            </button>
                            <button
                              className={`ytdl-type-tab ${mediaType === "audio" ? "active" : ""}`}
                              onClick={() => setMediaType("audio")}
                            >
                              <Headphones size={18} /> Audio
                            </button>
                          </div>
                        </div>

                        <div className="ytdl-formats-grid">
                          {mediaType === "video"
                            ? RESOLUTIONS.map((resOpt) => (
                              <div
                                key={resOpt.id}
                                onClick={() => setSelectedRes(resOpt.id)}
                                className={`ytdl-format-card ${selectedRes === resOpt.id ? "selected" : ""}`}
                              >
                                <div className="ytdl-format-label">
                                  {resOpt.label}
                                </div>
                                <div className="ytdl-format-sub">
                                  {resOpt.sub}
                                </div>
                              </div>
                            ))
                            : AUDIO_FORMATS.map((af) => (
                              <div
                                key={af.id}
                                onClick={() => setSelectedAudio(af.id)}
                                className={`ytdl-format-card ${selectedAudio === af.id ? "selected" : ""}`}
                              >
                                <div className="ytdl-format-label">
                                  {af.label}
                                </div>
                                <div className="ytdl-format-sub">
                                  {af.sub}
                                </div>
                              </div>
                            ))}
                        </div>

                        {pendingScope === "playlist" && (
                          <div
                            className="ytdl-setting-group"
                            style={{ marginTop: "1rem" }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                cursor: "pointer",
                                color: "#cbd5e1",
                                fontSize: "0.9rem",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={prependNumbers}
                                onChange={(e) => {
                                  setPrependNumbers(e.target.checked);
                                  localStorage.setItem(
                                    "ytdl_prepend_numbers",
                                    JSON.stringify(e.target.checked),
                                  );
                                }}
                                style={{
                                  accentColor: "var(--theme-primary)",
                                  width: "16px",
                                  height: "16px",
                                }}
                              />
                              Adaugă numărul piesei în numele fișierului (ex:
                              001 - Nume Piesă)
                            </label>
                          </div>
                        )}

                        {pendingScope === "playlist" && info?.playlist && (
                          <div className="ytdl-track-selection-section">
                            <div className="ytdl-track-selection-header">
                              <label className="ytdl-modal-label">
                                Selecteaza melodiile ({selectedTracks.size}{" "}
                                alese)
                              </label>
                              <div className="ytdl-track-utils">
                                <button
                                  className="ytdl-track-util-btn"
                                  onClick={selectAllTracks}
                                >
                                  Toate
                                </button>
                                <button
                                  className="ytdl-track-util-btn"
                                  onClick={deselectAllTracks}
                                >
                                  Niciuna
                                </button>
                              </div>
                            </div>
                            <div className="ytdl-track-list">
                              {info.playlist.entries.map((entry) => {
                                const isSelected = selectedTracks.has(
                                  entry.index,
                                );
                                return (
                                  <div
                                    key={entry.index}
                                    className={`ytdl-track-item ${isSelected ? "selected" : ""}`}
                                    onClick={() => toggleTrack(entry.index)}
                                  >
                                    <div className="ytdl-track-checkbox" />
                                    <span className="ytdl-track-index">
                                      {entry.index}.
                                    </span>
                                    <span className="ytdl-track-name">
                                      {entry.title}
                                    </span>
                                    <span className="ytdl-track-duration">
                                      {formatDuration(entry.duration)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div
                          className="ytdl-setting-group"
                          style={{ marginTop: "1rem" }}
                        >
                          <span className="ytdl-setting-label">
                            <CalendarClock
                              size={16}
                              style={{
                                display: "inline",
                                verticalAlign: "text-bottom",
                                marginRight: "4px",
                              }}
                            />{" "}
                            Programare descarcare (optional)
                          </span>
                          <p className="ytdl-setting-desc">
                            Lasati liber pentru descarcare imediata sau setati o
                            ora la care sa inceapa procesul automat.
                          </p>
                          <input
                            type="time"
                            className="ytdl-url-input ytdl-time-input"
                            style={{ width: "100%", cursor: "text" }}
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                          />
                        </div>

                        <div
                          className="ytdl-setting-group"
                          style={{ marginTop: "1rem" }}
                        >
                          <span className="ytdl-setting-label">
                            <FolderOpen
                              size={16}
                              style={{
                                display: "inline",
                                verticalAlign: "text-bottom",
                                marginRight: "4px",
                              }}
                            />{" "}
                            Folder Descarcare (doar pentru acest fisier)
                          </span>
                          <p className="ytdl-setting-desc">
                            Selectati un folder personalizat doar pentru aceasta descarcare, ignorand setarile globale.
                          </p>
                          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                            <input
                              type="text"
                              className="ytdl-url-input"
                              readOnly
                              value={localCustomPath || "Folder implicit"}
                              style={{ flex: 1, color: localCustomPath ? "#ffffff" : "#888888" }}
                            />
                            <button
                              className="ytdl-btn ytdl-btn-primary"
                              onClick={handleSelectLocalFolder}
                              style={{ padding: "0 1rem" }}
                            >
                              Alege folder
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="ytdl-modal-actions">
                        <button
                          className="ytdl-modal-cancel"
                          onClick={() => setShowOptionsModal(false)}
                        >
                          Anuleaza
                        </button>
                        <button
                          className="ytdl-modal-confirm"
                          onClick={startDownload}
                          disabled={
                            pendingScope === "playlist" &&
                            selectedTracks.size === 0
                          }
                        >
                          Incepe descarcarea
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="ytdl-action-area">
                <AnimatePresence mode="wait">
                  {info && !downloadComplete && !downloading && (
                    <motion.div
                      key="actions"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className={`ytdl-download-actions ${info.playlist ? "ytdl-dl-actions" : ""}`}
                    >
                      <div className="ytdl-download-action-copy">
                        <span className="ytdl-dl-copy-title">
                          {info.contentType === "album"
                            ? "Album ready"
                            : info.playlist
                              ? "Collection ready"
                              : "Ready to download"}
                        </span>
                        <span className="ytdl-dl-copy-sub">
                          {info.playlist
                            ? `${info.playlist.downloadableCount} ${appMode === "music" ? "tracks" : "videos"} available`
                            : `${mediaType === "audio" ? "Audio" : "Video"} · Choose your preferred quality`}
                        </span>
                      </div>
                      <div className="ytdl-dl-btn-group">
                        <button
                          className={`ytdl-dl-btn ${info.playlist ? "ytdl-single-dl-btn" : ""}`}
                          onClick={() => openDownloadModal("single")}
                        >
                          <Download size={20} />{" "}
                          {info.playlist
                            ? appMode === "music"
                              ? "Descarca doar aceasta piesa"
                              : "Descarca doar acest clip"
                            : "Descarca acum"}
                        </button>
                        {info.playlist && (
                          <button
                            className="ytdl-dl-btn ytdl-playlist-dl-btn"
                            onClick={() => openDownloadModal("playlist")}
                          >
                            <ListVideo size={20} />{" "}
                            {appMode === "music"
                              ? "Descarca albumul / playlistul"
                              : "Descarca playlistul"}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {downloading && (
                    <motion.div
                      key="progress"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="ytdl-progress-block"
                    >
                      {/* Multi-step timeline */}
                      <div className="ytdl-step-timeline">
                        {[
                          { label: "Pregatire", idx: 1 },
                          { label: "Descarcare", idx: 2 },
                          { label: "Finalizare", idx: 3 },
                        ].map(({ label, idx }, i, arr) => (
                          <div key={idx} className="ytdl-step-timeline-item">
                            <div
                              className={`ytdl-step-node ${step >= idx ? "active" : ""} ${step === idx ? "current" : ""}`}
                            >
                              {step > idx ? (
                                <CheckCircle2 size={14} />
                              ) : (
                                <span>{idx}</span>
                              )}
                            </div>
                            <span
                              className={`ytdl-step-label ${step >= idx ? "active" : ""}`}
                            >
                              {label}
                            </span>
                            {i < arr.length - 1 && (
                              <div
                                className={`ytdl-step-connector ${step > idx ? "filled" : ""}`}
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Track info spotlight if thumbnail available */}
                      {(currentVinylImage || info?.thumbnail) && (
                        <div
                          className="sp-prog-spotlight"
                          style={{ paddingTop: "0.5rem" }}
                        >
                          <div className="sp-prog-vinyl-wrap">
                            <motion.div
                              className="sp-prog-vinyl"
                              animate={isPaused ? {} : { rotate: 360 }}
                              transition={{
                                repeat: Infinity,
                                duration: 6,
                                ease: "linear",
                              }}
                              style={{
                                backgroundImage: `url(${currentVinylImage || (pendingScope === 'playlist' ? info?.playlist?.thumbnail : info?.thumbnail) || info?.thumbnail})`,
                                transition: "background-image 0.5s ease-in-out",
                              }}
                            >
                              <div className="sp-prog-vinyl-hole" />
                            </motion.div>
                          </div>
                          <div className="sp-prog-spotlight-meta">
                            <div className="sp-prog-now-label">
                              {isPaused ? "PAUSED" : "DOWNLOADING"}
                            </div>
                            <div className="sp-prog-track-name">
                              {pendingScope === "playlist"
                                ? (info?.playlist?.title || info?.title || "YouTube Playlist")
                                : (info?.title || "YouTube Video")}
                            </div>
                            <div className="sp-prog-track-artist">
                              {pendingScope === "playlist"
                                ? (info?.playlist?.uploader || info?.uploader || "")
                                : (info?.uploader || "")}
                            </div>
                            {downloadStatus && (
                              <div className="sp-prog-eq-row">
                                {isPaused ? (
                                  <Pause
                                    size={13}
                                    style={{ color: "#fb923c" }}
                                  />
                                ) : (
                                  <Loader2
                                    size={13}
                                    className="spin"
                                    style={{ color: "#60a5fa" }}
                                  />
                                )}
                                <span className="sp-prog-status-text">
                                  {downloadStatus}
                                </span>
                              </div>
                            )}
                            {/* YTMusic per-track fallback status with cover art */}
                            {ytMusicFallbackStatus && (
                              <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                marginTop: "0.4rem",
                                padding: "0.35rem 0.5rem",
                                borderRadius: "8px",
                                backgroundColor: ytMusicFallbackStatus.stage === "searching"
                                  ? "rgba(245,158,11,0.08)"
                                  : ytMusicFallbackStatus.stage === "found"
                                    ? "rgba(74,222,128,0.08)"
                                    : "rgba(248,113,113,0.08)",
                                border: `1px solid ${ytMusicFallbackStatus.stage === "searching"
                                    ? "rgba(245,158,11,0.25)"
                                    : ytMusicFallbackStatus.stage === "found"
                                      ? "rgba(74,222,128,0.25)"
                                      : "rgba(248,113,113,0.25)"
                                  }`,
                                transition: "all 0.3s ease",
                              }}>
                                {/* Cover art */}
                                {(ytMusicFallbackStatus.thumbnail || ytMusicCurrentThumbnail) && (
                                  <img
                                    src={ytMusicFallbackStatus.thumbnail || ytMusicCurrentThumbnail}
                                    alt="cover"
                                    style={{
                                      width: "32px",
                                      height: "32px",
                                      borderRadius: "4px",
                                      objectFit: "cover",
                                      flexShrink: 0,
                                      opacity: 0.9,
                                    }}
                                  />
                                )}
                                {/* Status icon + text */}
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem", minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                                    {ytMusicFallbackStatus.stage === "searching" && (
                                      <><Loader2 size={11} className="spin" style={{ color: "#f59e0b", flexShrink: 0 }} />
                                        <span style={{ color: "#f59e0b", fontSize: "0.76rem", fontWeight: 600 }}>Searching YouTube for fallback…</span>
                                      </>
                                    )}
                                    {ytMusicFallbackStatus.stage === "found" && (
                                      <><CheckCircle2 size={11} style={{ color: "#4ade80", flexShrink: 0 }} />
                                        <span style={{ color: "#4ade80", fontSize: "0.76rem", fontWeight: 600 }}>Replacement found</span>
                                      </>
                                    )}
                                    {ytMusicFallbackStatus.stage === "failed" && (
                                      <><XCircle size={11} style={{ color: "#f87171", flexShrink: 0 }} />
                                        <span style={{ color: "#f87171", fontSize: "0.76rem", fontWeight: 600 }}>No replacement — skipping</span>
                                      </>
                                    )}
                                  </div>
                                  <span style={{ color: "#64748b", fontSize: "0.7rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "180px" }}>
                                    {ytMusicFallbackStatus.stage === "found"
                                      ? ytMusicFallbackStatus.fallbackTitle
                                      : ytMusicFallbackStatus.trackTitle}
                                  </span>
                                </div>
                              </div>
                            )}
                            {/* YTMusic live counter */}
                            {ytMusicStats && ytMusicStats.total > 0 && (
                              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.3rem", fontSize: "0.76rem", opacity: 0.75 }}>
                                <span style={{ color: "#4ade80" }}>✓ {ytMusicStats.completed || 0}</span>
                                {(ytMusicStats.failed || 0) > 0 && <span style={{ color: "#f87171" }}>✗ {ytMusicStats.failed}</span>}
                                <span style={{ color: "#94a3b8" }}>/ {ytMusicStats.total}</span>
                              </div>
                            )}
                          </div>
                          <div
                            className="sp-prog-counter sp-prog-counter--remain"
                            style={{
                              fontSize: "1rem",
                              fontWeight: 700,
                              padding: "0.4rem 0.75rem",
                            }}
                          >
                            {progress.toFixed(0)}%
                          </div>
                        </div>
                      )}

                      {/* Progress bar with glow */}
                      <div className="sp-prog-bar-section">
                        {!info?.thumbnail && (
                          <div className="sp-prog-bar-labels">
                            <span>
                              {isPaused
                                ? "Paused"
                                : downloadScope === "playlist"
                                  ? "Downloading playlist..."
                                  : "Downloading..."}
                            </span>
                            <span>{progress.toFixed(1)}%</span>
                          </div>
                        )}
                        <div className="sp-prog-bar-outer">
                          <motion.div
                            className={`sp-prog-bar-fill${isPaused ? " sp-prog-bar-fill--paused" : ""}`}
                            animate={{ width: `${progress}%` }}
                            transition={{ ease: "linear", duration: 0.3 }}
                          />
                          {!isPaused && (
                            <motion.div
                              className="sp-prog-bar-glow"
                              animate={{
                                left: `${Math.min(progress - 2, 97)}%`,
                              }}
                              transition={{ ease: "linear", duration: 0.3 }}
                            />
                          )}
                        </div>
                      </div>

                      {!info?.thumbnail && downloadStatus && (
                        <div
                          className={`ytdl-progress-detail ${isPaused ? "paused-text" : ""}`}
                        >
                          {downloadStatus}
                        </div>
                      )}

                      <div className="ytdl-job-actions">
                        {/* Hide pause/resume for YTMusic per-track downloads (no jobId) */}
                        {!ytMusicAbortRef.current && (
                          isPaused ? (
                            <button
                              className="ytdl-job-btn resume"
                              onClick={() => handleJobAction("resume")}
                            >
                              <Play size={18} /> Reia descarcarea
                            </button>
                          ) : (
                            <button
                              className="ytdl-job-btn pause"
                              onClick={() => handleJobAction("pause")}
                              disabled={step === 3}
                            >
                              <Pause size={18} /> Pune pe pauza
                            </button>
                          )
                        )}
                        <button
                          className="ytdl-job-btn cancel"
                          onClick={() => {
                            if (ytMusicAbortRef.current) {
                              ytMusicAbortRef.current.abort();
                              ytMusicAbortRef.current = null;
                              setDownloading(false);
                              setStep(0);
                            } else {
                              handleJobAction("cancel");
                            }
                          }}
                        >
                          <XCircle size={18} /> Anuleaza
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {downloadComplete && finalFilename && (
                    <motion.div
                      key="complete"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="ytdl-complete-block"
                    >
                      <div className="ytdl-complete-icon">
                        <CheckCircle2 size={36} />
                      </div>
                      <div className="ytdl-complete-info">
                        <span className="ytdl-complete-title">
                          {downloadScope === "playlist"
                            ? "Playlist descarcat cu succes!"
                            : "Descarcare finalizata!"}
                        </span>

                        {downloadScope === "playlist" ? (
                          <div className="ytdl-archive-notice">
                            {/* YTMusic summary */}
                            {ytMusicStats ? (
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '0.75rem', fontSize: '0.92rem' }}>
                                  <span style={{ color: '#4ade80', fontWeight: 700 }}>
                                    ✓ Downloaded: {ytMusicStats.completed || 0} / {ytMusicStats.total || 0}
                                  </span>
                                  {(ytMusicStats.failed || 0) > 0 && (
                                    <span style={{ color: '#f87171', fontWeight: 700 }}>
                                      ✗ Failed: {ytMusicStats.failed}
                                    </span>
                                  )}
                                </div>
                                {ytMusicFailedTracks.length > 0 && (
                                  <div style={{ marginTop: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                    <div style={{ color: '#f87171', fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                      Failed Songs
                                    </div>
                                    {ytMusicFailedTracks.map((t, i) => (
                                      <div key={i} style={{ marginBottom: '0.6rem', paddingBottom: '0.5rem', borderBottom: i < ytMusicFailedTracks.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                                        <div style={{ color: '#e2e8f0', fontSize: '0.83rem', fontWeight: 600 }}>
                                          • {t.artist ? `${t.artist} — ${t.title}` : t.title}
                                        </div>
                                        <div style={{ color: '#94a3b8', fontSize: '0.76rem', marginTop: '0.2rem' }}>
                                          Reason: {t.error}
                                        </div>
                                        {t.fallbackNote && (
                                          <div style={{ color: '#64748b', fontSize: '0.74rem', marginTop: '0.1rem' }}>
                                            Fallback: {t.fallbackNote}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {ytMusicFailedTracks.length === 0 && (
                                  <div style={{ color: '#94a3b8', fontSize: '0.83rem' }}>All tracks downloaded successfully.</div>
                                )}
                              </div>
                            ) : (
                              <>
                                Fisierele au fost salvate cu succes in locatia ta.
                                {missingTracks && (
                                  <div style={{ marginTop: '1rem', color: '#f87171', fontSize: '0.9rem', textAlign: 'left', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', wordBreak: 'break-word' }}>
                                    <strong>Avertisment:</strong> Au fost descărcate {missingTracks.actual}/{missingTracks.expected} fișiere.
                                    {missingTracks.missing && missingTracks.missing.length > 0 && (
                                      <div style={{ marginTop: '0.5rem' }}>
                                        Lipsă: {missingTracks.missing.map(e => e.uploader ? `${e.uploader} - ${e.title}` : e.title).join(', ')}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ) : (
                          <div
                            className="ytdl-name-input-row"
                            style={{
                              justifyContent: "center",
                              margin: "1rem 0",
                              flexDirection: "column",
                              alignItems: "center",
                            }}
                          >
                            <p className="ytdl-complete-media-title">
                              {info?.title || finalFilename}
                            </p>
                            {info?.uploader && (
                              <p className="ytdl-complete-media-sub">
                                {info.uploader} ·{" "}
                                {downloadFormat === "audio" ? "Audio" : "Video"}{" "}
                                saved locally
                              </p>
                            )}
                            <p
                              className="ytdl-ready-filename"
                              title={finalFilename}
                            >
                              {finalFilename}
                            </p>
                          </div>
                        )}

                        <div
                          style={{
                            display: "flex",
                            gap: "1rem",
                            marginTop: "1rem",
                            justifyContent: "center",
                            width: "100%",
                          }}
                        >
                          <button
                            className="ytdl-new-dl-btn"
                            onClick={() => {
                              const cp =
                                localStorage.getItem("customPath") || "";
                              const q = finalFilename
                                ? `?target=${encodeURIComponent(finalFilename)}&customPath=${encodeURIComponent(cp)}`
                                : `?customPath=${encodeURIComponent(cp)}`;
                              fetch(`/api/ytdl/open-folder${q}`);
                            }}
                            style={{
                              marginTop: 0,
                              width: "auto",
                              padding: "0.8rem 1.5rem",
                              background: "rgba(255,255,255,0.1)",
                            }}
                          >
                            <FolderOpen size={18} /> Deschide Folder
                          </button>
                          <button
                            className="ytdl-new-dl-btn"
                            onClick={handleReset}
                            style={{
                              marginTop: 0,
                              width: "auto",
                              padding: "0.8rem 1.5rem",
                            }}
                          >
                            <RefreshCw size={18} /> Alt videoclip
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {history.length > 0 && (
          <>
            <section className="ytdl-artist-gallery">
              <div className="ytdl-history-panel-title">
                <Music size={14} /> Recently played channels
              </div>
              <div className="ytdl-artist-bubbles">
                {recentChannels.map((item, index) => (
                  <button
                    key={item.url}
                    className="ytdl-artist-bubble"
                    style={{ "--bubble-index": index }}
                    onClick={() => {
                      setUrl(item.url);
                      fetchInfo(item.url);
                    }}
                    title={item.uploader || item.title}
                  >
                    {item.artistThumbnail ? (
                      <img src={item.artistThumbnail} alt="" />
                    ) : (
                      <span>
                        {(item.uploader || item.title)
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                    )}
                    <strong>{item.uploader || item.title}</strong>
                    <span
                      className="ytdl-history-remove"
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeChannelHistory(item.uploader);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          removeChannelHistory(item.uploader);
                        }
                      }}
                      title="Remove channel from history"
                      aria-label={`Remove ${item.uploader} from history`}
                    >
                      <X size={12} strokeWidth={2.5} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="ytdl-history-panels">
              <div className="ytdl-history-panel">
                <div className="ytdl-history-panel-title">
                  <Music size={14} /> Recent channels
                </div>
                <div className="ytdl-channel-chips">
                  {recentChannels.map((item) => (
                    <button
                      key={item.uploader}
                      className="ytdl-channel-chip"
                      onClick={() => {
                        setUrl(item.url);
                        fetchInfo(item.url);
                      }}
                      title={`Open ${item.uploader}`}
                    >
                      {item.artistThumbnail ? (
                        <img
                          src={item.artistThumbnail}
                          alt=""
                          className="ytdl-channel-avatar"
                        />
                      ) : (
                        <span className="ytdl-channel-avatar">
                          {item.uploader.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="ytdl-channel-name">{item.uploader}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ytdl-history-panel">
                <div className="ytdl-history-panel-title">
                  <Clock size={14} /> Recent downloads
                </div>
                <div className="ytdl-recent-list">
                  {history.slice(0, 4).map((item) => (
                    <button
                      key={item.url}
                      className="ytdl-recent-item"
                      onClick={() => {
                        setUrl(item.url);
                        fetchInfo(item.url);
                      }}
                    >
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="ytdl-recent-thumb"
                        />
                      ) : (
                        <span className="ytdl-recent-thumb" />
                      )}
                      <span className="ytdl-recent-name">{item.title}</span>
                      <span className="ytdl-recent-date">
                        {new Date(item.date).toLocaleDateString()}
                      </span>
                      <span
                        className="ytdl-recent-remove"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeHistoryItem(item.url);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            removeHistoryItem(item.url);
                          }
                        }}
                        title="Remove from history"
                        aria-label={`Remove ${item.title} from history`}
                      >
                        <X size={13} strokeWidth={2.5} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        <footer className="ytdl-footer">
          <div className="ytdl-footer-brand">
            <span className="ytdl-footer-dot" /> MediaDL YouTube
          </div>
          <div className="ytdl-footer-details">
            <span>Video & audio</span>
            <span>Playlist-aware</span>
            <span>Powered by yt-dlp + FFmpeg</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default YoutubeDownloader;
