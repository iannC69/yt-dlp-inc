import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactECharts from 'echarts-for-react';
import {
  Link2, Sparkles, Clock, Users, Disc, Hash, Layers,
  BarChart2, Activity, ShieldAlert, Cpu, Check, Music, Star, Flame, Calendar, X,
  Play, BrainCircuit, BarChart3, Music4, PlayCircle, Coffee
} from 'lucide-react';
import { storage } from './storage';
import './PlaylistAnalyzer.css';

// --- Mood Keywords ---
const MOOD_KEYWORDS = {
  Emotional: ['acoustic', 'sad', 'heartbreak', 'love', 'lonely', 'midnight', 'dreams', 'cry', 'tears', 'miss'],
  Energetic: ['remix', 'club', 'dance', 'hype', 'party', 'bass', 'workout', 'mix', 'energy', 'fast'],
  Dark: ['dark', 'shadow', 'night', 'deep', 'black', 'hell', 'demon', 'blood'],
  Nostalgic: ['retro', 'vintage', 'classic', 'memory', 'remember', 'old', '90s', '80s', 'childhood'],
  Upbeat: ['happy', 'upbeat', 'sun', 'smile', 'joy', 'good', 'day', 'bright', 'shine'],
  Chill: ['chill', 'lofi', 'lo-fi', 'relax', 'study', 'sleep', 'ambient', 'vibe', 'smooth', 'slow']
};


const getComputedColor = (varName, fallback) => {
  if (typeof window !== 'undefined') {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (val) return val;
  }
  return fallback;
};

const stringToColor = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 60%)`;
};

const getInitials = (name) => {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
};

export default function PlaylistAnalyzer() {
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [playlistData, setPlaylistData] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [artistImages, setArtistImages] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pa-artist-images-v2')) || {}; } catch { return {}; }
  });
  const [showAllArtists, setShowAllArtists] = useState(false);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pa-history')) || []; } catch { return []; }
  });
  const [artistZoomLevel, setArtistZoomLevel] = useState(() => parseFloat(storage.getItem('pa_artist_zoom_level')) || 0.6);
  const [artistBlurLevel, setArtistBlurLevel] = useState(() => parseFloat(storage.getItem('pa_artist_blur_level')) || 0);
  const [artistCustomBgUrl, setArtistCustomBgUrl] = useState(() => storage.getItem('pa_artist_custom_bg_url') || '');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const fetchedModalArtists = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setHighlightIndex(prev => prev + 1), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleSettingsUpdate = () => {
      setArtistZoomLevel(parseFloat(storage.getItem('pa_artist_zoom_level')) || 0.6);
      setArtistBlurLevel(parseFloat(storage.getItem('pa_artist_blur_level')) || 0);
      setArtistCustomBgUrl(storage.getItem('pa_artist_custom_bg_url') || '');
    };
    window.addEventListener('settings-updated', handleSettingsUpdate);
    return () => window.removeEventListener('settings-updated', handleSettingsUpdate);
  }, []);

  useEffect(() => {
    localStorage.setItem('pa-artist-images-v2', JSON.stringify(artistImages));
  }, [artistImages]);

  // Lazy image fetching for modal
  useEffect(() => {
    if (showAllArtists && analysisResult && analysisResult.topArtists && !fetchedModalArtists.current) {
      fetchedModalArtists.current = true;
      const fetchMissingImages = async () => {
        const toFetch = analysisResult.topArtists.filter(a => !artistImages[a.name]);
        // Process in batches of 5 to avoid overwhelming the backend/youtube
        for (let i = 0; i < toFetch.length; i += 5) {
          if (!showAllArtists) break; // stop if modal closed
          const batch = toFetch.slice(i, i + 5);
          await Promise.all(batch.map(async (artist) => {
            try {
              const res = await fetch(`/api/artist-image?name=${encodeURIComponent(artist.name)}`);
              const d = await res.json();
              if (d.image) {
                setArtistImages(prev => ({ ...prev, [artist.name]: d.image }));
              }
            } catch (e) { }
          }));
        }
      };
      fetchMissingImages();
    }
    if (!showAllArtists) {
      fetchedModalArtists.current = false; // Reset when closed
    }
  }, [showAllArtists, analysisResult]);

  // Deep link support
  useEffect(() => {
    const handlePaste = (e) => {
      const pasted = e.detail;
      if (pasted && typeof pasted === 'string') {
        setUrl(pasted);
        analyzePlaylist(pasted);
      }
    };
    window.addEventListener('app:paste-url', handlePaste);
    return () => window.removeEventListener('app:paste-url', handlePaste);
  }, []);

  const analyzePlaylist = async (targetUrl = url) => {
    if (!targetUrl) return;
    setIsAnalyzing(true);
    setPlaylistData(null);
    setAnalysisResult(null);

    try {
      setAnalysisStatus('Scanning tracks...');
      const isSpotify = targetUrl.includes('spotify.com');
      let tracks = [];
      let playlistMeta = { title: 'Unknown Playlist', cover: '', author: 'Unknown' };

      if (isSpotify) {
        const res = await fetch(`/api/spotify-info?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();
        if (data && data.items) {
          tracks = data.items.map(t => ({
            id: t.id,
            title: t.name,
            artist: (t.artists || []).map(a => a.name).join(', '),
            album: t.album?.name || '',
            albumCover: t.album?.images?.[0]?.url || '',
            durationMs: t.duration_ms || 0,
            explicit: t.explicit || false,
            popularity: t.popularity || 0,
            releaseYear: t.album?.release_date ? parseInt(t.album.release_date.substring(0, 4)) : null,
            cover: t.album?.images?.[0]?.url || ''
          }));
          playlistMeta = {
            title: data.name || 'Spotify Playlist',
            cover: data.images?.[0]?.url || '',
            author: data.owner?.display_name || 'Spotify'
          };
        }
      } else {
        const res = await fetch(`/api/ytdl/collection-info?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();
        if (data && data.entries) {
          tracks = data.entries.map(t => {
            let rawArtist = t.uploader || t.channel || 'Unknown Artist';
            let extractedAlbum = t.album || '';
            // If YouTube Music subtitle was captured as the uploader (Artist • Album)
            if (!extractedAlbum && rawArtist.includes(' • ')) {
              const parts = rawArtist.split(' • ');
              rawArtist = parts[0].trim();
              extractedAlbum = parts.slice(1).join(' • ').trim();
            }
            return {
              id: t.id,
              title: t.title,
              artist: rawArtist,
              album: extractedAlbum,
              durationMs: (t.duration || 0) * 1000,
              explicit: false,
              popularity: t.view_count || 0,
              releaseYear: t.upload_date ? parseInt(t.upload_date.substring(0, 4)) : null,
              cover: (t.thumbnails && t.thumbnails.length ? t.thumbnails[t.thumbnails.length - 1].url : null) || `https://i.ytimg.com/vi/${t.id}/hqdefault.jpg`
            };
          });
          setAnalysisStatus('Detecting albums and deep metadata...');
      
      // Auto-detect missing albums using iTunes API for ALL tracks to ensure accurate counts
      const tracksToDetect = tracks.filter(t => !t.album);
      if (tracksToDetect.length > 0) {
        const titleCache = new Map();
        // Process in chunks of 10 to avoid overwhelming the network
        for (let i = 0; i < tracksToDetect.length; i += 10) {
          const chunk = tracksToDetect.slice(i, i + 10);
          await Promise.all(chunk.map(async (t) => {
            try {
              // Clean title of typical YouTube noise to improve iTunes search hit rate
              const cleanTitle = t.title.replace(/[\(\[].*?(official|video|audio|lyric|live|remix).*?[\)\]]/ig, '').replace(/-|\/|\|/g, ' ').replace(/\s+/g, ' ').trim();
              const cacheKey = (cleanTitle + ' ' + (t.artist || '')).toLowerCase();
              
              if (titleCache.has(cacheKey)) {
                const cached = titleCache.get(cacheKey);
                if (cached.album) {
                  t.album = cached.album;
                  t.albumCover = cached.cover;
                }
                return;
              }

              const query = encodeURIComponent((cleanTitle + ' ' + (t.artist || '')).substring(0, 60));
              const itunesRes = await fetch(`/api/itunes-search?term=${query}`).then(r => r.json());
              if (itunesRes.results && itunesRes.results.length > 0) {
                // Verify the artist matches at least partially to avoid false positives
                const resultArtist = (itunesRes.results[0].artistName || '').toLowerCase();
                const ourArtist = (t.artist || '').toLowerCase();
                
                // If our artist is in their artist string, or vice versa, or if we didn't have an artist
                if (!ourArtist || !resultArtist || resultArtist.includes(ourArtist) || ourArtist.includes(resultArtist)) {
                  t.album = itunesRes.results[0].collectionName;
                  t.albumCover = itunesRes.results[0].artworkUrl100;
                  titleCache.set(cacheKey, { album: t.album, cover: t.albumCover });
                } else {
                  titleCache.set(cacheKey, { album: '', cover: '' });
                }
              } else {
                titleCache.set(cacheKey, { album: '', cover: '' });
              }
            } catch (e) {
              console.warn('iTunes album fetch failed for:', t.title, e);
            }
          }));
        }
      }

      setAnalysisStatus('Building statistics & charts...');
          playlistMeta = {
            title: data.title || 'Unknown Playlist',
            cover: data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : null) || tracks[0]?.cover || '',
            author: data.uploader || data.channel || 'YouTube'
          };
        }
      }

      setAnalysisStatus('Detecting artists...');
      await new Promise(r => setTimeout(r, 400));

      setAnalysisStatus('Building statistics & charts...');
      const result = processTracks(tracks);

      setAnalysisStatus('Fetching artist images...');
      const top5 = result.topArtists.slice(0, 5);
      const fetchedImages = {};
      await Promise.all(top5.map(async (artist) => {
        try {
          const res = await fetch(`/api/artist-image?name=${encodeURIComponent(artist.name)}`);
          const d = await res.json();
          if (d.image) {
            fetchedImages[artist.name] = d.image;
          }
        } catch (e) { }
      }));
      setArtistImages(fetchedImages);

      setAnalysisStatus('Fetching track covers...');
      try {
        if (result.mostPopular) {
          const res = await fetch(`/api/track-cover?q=${encodeURIComponent(result.mostPopular.title + ' ' + result.mostPopular.artist)}`);
          const d = await res.json();
          if (d.cover) result.mostPopular.cover = d.cover;
        }
        if (result.hiddenGem && result.hiddenGem.id !== result.mostPopular?.id) {
          const res = await fetch(`/api/track-cover?q=${encodeURIComponent(result.hiddenGem.title + ' ' + result.hiddenGem.artist)}`);
          const d = await res.json();
          if (d.cover) result.hiddenGem.cover = d.cover;
        }
      } catch (e) { }

      setAnalysisStatus('Generating AI insights...');
      await new Promise(r => setTimeout(r, 400));

      setPlaylistData(playlistMeta);
      setAnalysisResult(result);

      const newHistoryItem = {
        title: playlistMeta.title,
        author: playlistMeta.author,
        url: targetUrl,
        date: Date.now(),
        cover: playlistMeta.cover,
        trackCount: tracks.length
      };
      setHistory(prev => {
        const h = [newHistoryItem, ...prev.filter(x => x.title !== newHistoryItem.title)].slice(0, 10);
        localStorage.setItem('pa-history', JSON.stringify(h));
        return h;
      });

    } catch (e) {
      console.error(e);
      // Fallback for error state handled gracefully if possible
    } finally {
      setIsAnalyzing(false);
      setAnalysisStatus('');
    }
  };

  const processTracks = (tracks) => {
    if (!tracks || tracks.length === 0) return null;

    let totalDurationMs = 0;
    const artistScores = {};
    const albumCounts = {};
    const yearCounts = {};
    const lengthBuckets = { '< 2m': 0, '2-3m': 0, '3-4m': 0, '4-5m': 0, '5m+': 0 };
    const moodScores = { Emotional: 0, Energetic: 0, Dark: 0, Nostalgic: 0, Upbeat: 0, Chill: 0 };
    let explicitCount = 0;
    let shortest = tracks[0], longest = tracks[0];
    let mostPopular = tracks[0], hiddenGem = tracks.find(t => t.popularity > 0) || tracks[0];

    let oldestTrack = null, newestTrack = null;
    let sumYears = 0, tracksWithYears = 0;

    const uniqueIds = new Set();
    let duplicates = 0;

    tracks.forEach(t => {
      // Basic Stats
      if (uniqueIds.has(t.id)) duplicates++;
      uniqueIds.add(t.id);

      totalDurationMs += t.durationMs;
      if (t.durationMs > longest.durationMs) longest = t;
      if (t.durationMs > 0 && t.durationMs < shortest.durationMs) shortest = t;
      if (t.explicit) explicitCount++;


      // Year stats
      if (t.releaseYear) {
        yearCounts[t.releaseYear] = (yearCounts[t.releaseYear] || 0) + 1;
        sumYears += t.releaseYear;
        tracksWithYears++;
        if (!oldestTrack || t.releaseYear < oldestTrack.releaseYear) oldestTrack = t;
        if (!newestTrack || t.releaseYear > newestTrack.releaseYear) newestTrack = t;
      }

      // Artist parsing (handle feat, ft, &, x, ,)
      const artistStr = t.artist.replace(/feat\.|ft\.| x | , | & /gi, '|');
      const parts = artistStr.split('|').map(p => p.trim()).filter(Boolean);

      parts.forEach((p, idx) => {
        const norm = p.replace(/\s+/g, ' ').toUpperCase();
        const display = p;
        const score = idx === 0 ? 1.0 : 0.5;
        if (!artistScores[norm]) artistScores[norm] = { name: display, score: 0, tracks: 0 };
        artistScores[norm].score += score;
        artistScores[norm].tracks += 1;
      });

      // Album
      if (t.album) {
        if (!albumCounts[t.album]) albumCounts[t.album] = { count: 0, artists: {}, cover: t.albumCover || '' };
        albumCounts[t.album].count++;
        albumCounts[t.album].artists[t.artist] = (albumCounts[t.album].artists[t.artist] || 0) + 1;
        if (t.albumCover && !albumCounts[t.album].cover) albumCounts[t.album].cover = t.albumCover;
      }

      // Length Buckets
      const mins = t.durationMs / 60000;
      if (mins < 2) lengthBuckets['< 2m']++;
      else if (mins < 3) lengthBuckets['2-3m']++;
      else if (mins < 4) lengthBuckets['3-4m']++;
      else if (mins < 5) lengthBuckets['4-5m']++;
      else lengthBuckets['5m+']++;

      // Mood inference based on title + artist tokens
      const textToScan = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
      Object.keys(MOOD_KEYWORDS).forEach(mood => {
        MOOD_KEYWORDS[mood].forEach(kw => {
          if (textToScan.includes(kw)) moodScores[mood] += 1;
        });
      });
    });

    // Finalize Artists
    const sortedArtists = Object.values(artistScores)
      .sort((a, b) => b.score - a.score)
      .map((a, i) => ({
        rank: i + 1,
        color: stringToColor(a.name),
        initials: getInitials(a.name),
        ...a,
        percent: ((a.tracks / tracks.length) * 100).toFixed(1)
      }));
    const topArtists = sortedArtists.slice(0, 50);

    // Finalize Albums
    const sortedAlbums = Object.entries(albumCounts)
      .map(([name, data]) => {
        const topArtist = Object.entries(data.artists).sort((a,b) => b[1]-a[1])[0][0];
        return { name, count: data.count, artist: topArtist, cover: data.cover, percent: ((data.count / tracks.length) * 100).toFixed(1) };
      })
      .sort((a, b) => b.count - a.count);

    // Genres (Heuristic based on mood & artist variety)
    const genreSlices = [
      { name: 'Pop', value: Math.max(1, moodScores.Upbeat * 2 + tracks.length * 0.3) },
      { name: 'Hip Hop', value: Math.max(1, moodScores.Energetic * 1.5 + explicitCount * 2) },
      { name: 'Acoustic / Indie', value: Math.max(1, moodScores.Chill * 2 + moodScores.Emotional) },
      { name: 'Electronic', value: Math.max(1, moodScores.Energetic * 1.2 + tracks.length * 0.1) },
      { name: 'R&B / Soul', value: Math.max(1, moodScores.Emotional * 1.5 + tracks.length * 0.1) }
    ].map(g => ({ ...g, value: Math.round(g.value) })).sort((a, b) => b.value - a.value);

    // Normalize Mood
    const maxMood = Math.max(...Object.values(moodScores), 1);
    const normalizedMood = Object.keys(moodScores).map(k => ({
      name: k,
      max: maxMood,
      value: moodScores[k]
    }));

    // Average Era
    const averageYear = tracksWithYears > 0 ? Math.round(sumYears / tracksWithYears) : null;
    let eraStr = 'Modern';
    if (averageYear) {
      if (averageYear < 1980) eraStr = 'Classic';
      else if (averageYear < 1990) eraStr = '80s Retro';
      else if (averageYear < 2000) eraStr = '90s Throwback';
      else if (averageYear < 2010) eraStr = '2000s Nostalgia';
      else if (averageYear < 2020) eraStr = '2010s Hits';
      else eraStr = 'Current Era';
    }

    // AI Insights Generator
    const insights = [];
    if (topArtists.length > 0) {
      insights.push(`**${topArtists[0].name}** dominates this playlist, appearing in ${topArtists[0].percent}% of all tracks.`);
      const top3Share = topArtists.slice(0, 3).reduce((acc, curr) => acc + (curr.tracks / tracks.length), 0);
      if (top3Share > 0.4) {
        insights.push(`The top 3 artists account for ${(top3Share * 100).toFixed(0)}% of the playlist, indicating a strong core-favorites pattern.`);
      } else {
        insights.push(`The playlist has a high artist diversity score, featuring ${sortedArtists.length} unique artists.`);
      }
    }

    if (sortedAlbums.length > 0 && sortedAlbums[0].count > 2) {
      const topAlb = sortedAlbums[0];
      insights.push(`There are **${topAlb.count} songs** from **${topAlb.artist}**'s album "**${topAlb.name}**", highlighting it as a major favorite in this mix.`);
    }

    let dominantLength = Object.keys(lengthBuckets).reduce((a, b) => lengthBuckets[a] > lengthBuckets[b] ? a : b);
    insights.push(`Most songs fall within the **${dominantLength}** replay sweet spot.`);

    if (explicitCount > (tracks.length * 0.3)) {
      insights.push(`High explicit content detected (${explicitCount} tracks), suggesting a mature or high-energy vibe.`);
    }

    let dominantMood = normalizedMood.reduce((prev, curr) => (prev.value > curr.value) ? prev : curr).name;
    if (dominantMood && moodScores[dominantMood] > 0) {
      insights.push(`A strong **${dominantMood}** undertone runs through the selection based on metadata heuristics.`);
    }

    const sortedByPop = [...tracks].filter(t => t.popularity > 0).sort((a, b) => b.popularity - a.popularity);
    const mostPopularList = sortedByPop.slice(0, 5);
    const hiddenGemList = [...sortedByPop].reverse().slice(0, 5);

    return {
      totalTracks: tracks.length,
      totalDurationMs,
      uniqueArtists: sortedArtists.length,
      uniqueAlbums: sortedAlbums.length,
      avgLengthMs: totalDurationMs / tracks.length,
      shortest,
      longest,
      mostPopularList,
      hiddenGemList,
      oldestTrack,
      newestTrack,
      averageYear,
      eraStr,
      explicitCount,
      duplicates,
      topArtists,
      sortedAlbums,
      lengthBuckets,
      normalizedMood,
      genreSlices,
      yearCounts,
      insights,
      topTracks: [...tracks].filter(t => t.popularity > 0).sort((a, b) => b.popularity - a.popularity).slice(0, 5)
    };
  };

  const formatMs = (ms) => {
    if (!ms) return '0:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const getAlbumChartOption = () => {
    if (!analysisResult || !analysisResult.sortedAlbums) return {};
    const top = analysisResult.sortedAlbums.slice(0, 5);
    if (top.length === 0) return {};
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' },
        formatter: '{b}: {d}%'
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'middle',
        textStyle: { color: 'rgba(245, 243, 255, 0.7)', fontSize: 11, overflow: 'truncate', width: 100 },
        icon: 'circle'
      },
      series: [{
        type: 'pie',
        radius: ['45%', '75%'],
        center: ['30%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 4,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 2
        },
        label: { show: false },
        color: ['#3B82F6', getComputedColor('--pa-accent-1', '#8B5CF6'), getComputedColor('--pa-accent-2', '#EC4899'), getComputedColor('--pa-accent-3', '#10B981'), '#F59E0B'],
        data: top.map(a => ({ name: a.name || 'Unknown', value: a.count }))
      }]
    };
  };

  const getAlbumBarChartOption = () => {
    if (!analysisResult || !analysisResult.sortedAlbums || analysisResult.sortedAlbums.length === 0) return {};
    const top = [...analysisResult.sortedAlbums].slice(0, 5).reverse(); // Reverse so highest is at top in bar chart
    return {
      grid: { top: 20, right: 20, bottom: 20, left: '40%' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' },
        formatter: (params) => {
          const val = params[0];
          return `${val.name}<br/>Tracks: ${val.value}`;
        }
      },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(245, 243, 255, 0.05)', type: 'dashed' } },
        axisLabel: { show: false }
      },
      yAxis: {
        type: 'category',
        data: top.map(a => a.name.length > 20 ? a.name.substring(0, 20) + '...' : a.name),
        axisLine: { lineStyle: { color: 'rgba(245, 243, 255, 0.1)' } },
        axisLabel: { color: 'rgba(245, 243, 255, 0.8)', fontSize: 11 }
      },
      series: [{
        type: 'bar',
        data: top.map(a => a.count),
        itemStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [{ offset: 0, color: '#3B82F6' }, { offset: 1, color: getComputedColor('--pa-accent-1', '#8B5CF6') }]
          },
          borderRadius: [0, 4, 4, 0]
        },
        barWidth: '50%'
      }]
    };
  };

  const formatTotalTime = (ms) => {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // ECharts Options Generators
  const getArtistChartOption = () => {
    if (!analysisResult) return {};
    const data = [...analysisResult.topArtists.slice(0, 10)].reverse();
    return {
      grid: { top: 10, right: 20, bottom: 20, left: 100 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' }
      },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        data: data.map(a => a.name.length > 15 ? a.name.substring(0, 15) + '...' : a.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(245, 243, 255, 0.8)', fontSize: 11, fontWeight: 500 }
      },
      series: [{
        type: 'bar',
        data: data.map(a => a.tracks),
        itemStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [{ offset: 0, color: getComputedColor('--pa-accent-1', '#8B5CF6') }, { offset: 1, color: getComputedColor('--pa-accent-2', '#EC4899') }]
          },
          borderRadius: [0, 4, 4, 0]
        },
        label: {
          show: true,
          position: 'right',
          color: '#c4b5fd',
          formatter: '{c}'
        },
        barWidth: '60%'
      }]
    };
  };

  const getGenreChartOption = () => {
    if (!analysisResult) return {};
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' },
        formatter: '{b}: {d}%'
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'middle',
        textStyle: { color: 'rgba(245, 243, 255, 0.7)', fontSize: 12 },
        icon: 'circle'
      },
      series: [{
        type: 'pie',
        radius: ['55%', '85%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 2
        },
        label: { show: false },
        color: [getComputedColor('--pa-accent-1', '#8B5CF6'), getComputedColor('--pa-accent-2', '#EC4899'), '#4F46E5', getComputedColor('--pa-accent-3', '#10B981'), '#F59E0B'],
        data: analysisResult.genreSlices
      }]
    };
  };

  const getMoodRadarOption = () => {
    if (!analysisResult) return {};
    return {
      tooltip: {
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' }
      },
      radar: {
        radius: '65%',
        center: ['50%', '55%'],
        indicator: analysisResult.normalizedMood.map(m => ({ name: m.name, max: Math.max(m.max, 5) })),
        shape: 'polygon',
        splitNumber: 4,
        axisName: { color: 'rgba(245, 243, 255, 0.9)', fontSize: 12, fontWeight: 500 },
        splitLine: { lineStyle: { color: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)` } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.2)` } }
      },
      series: [{
        type: 'radar',
        data: [{
          value: analysisResult.normalizedMood.map(m => m.value),
          name: 'Mood Score',
          areaStyle: { color: `rgba(${getComputedColor('--pa-accent-2-rgb', '236, 72, 153')}, 0.2)` },
          lineStyle: { color: getComputedColor('--pa-accent-2', '#EC4899'), width: 2 },
          itemStyle: { color: getComputedColor('--pa-accent-2', '#EC4899') }
        }]
      }]
    };
  };

  const getLengthChartOption = () => {
    if (!analysisResult) return {};
    const labels = Object.keys(analysisResult.lengthBuckets);
    const data = Object.values(analysisResult.lengthBuckets);
    return {
      grid: { top: 20, right: 10, bottom: 20, left: 40 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' }
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: 'rgba(245, 243, 255, 0.1)' } },
        axisLabel: { color: 'rgba(245, 243, 255, 0.6)' }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(245, 243, 255, 0.05)', type: 'dashed' } },
        axisLabel: { color: 'rgba(245, 243, 255, 0.6)' }
      },
      series: [{
        type: 'bar',
        data: data,
        itemStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: '#4F46E5' }, { offset: 1, color: getComputedColor('--pa-accent-1', '#8B5CF6') }]
          },
          borderRadius: [4, 4, 0, 0]
        },
        barWidth: '50%'
      }]
    };
  };

  const getYearChartOption = () => {
    if (!analysisResult) return {};
    const years = Object.keys(analysisResult.yearCounts).sort();
    if (years.length === 0) return {};

    return {
      grid: { top: 20, right: 10, bottom: 20, left: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(21, 21, 34, 0.9)',
        borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`,
        textStyle: { color: '#F5F3FF' }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: years,
        axisLine: { lineStyle: { color: 'rgba(245, 243, 255, 0.1)' } },
        axisLabel: { color: 'rgba(245, 243, 255, 0.6)' }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(245, 243, 255, 0.05)' } },
        axisLabel: { color: 'rgba(245, 243, 255, 0.6)' }
      },
      series: [{
        type: 'line',
        smooth: true,
        data: years.map(y => analysisResult.yearCounts[y]),
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.5)` }, { offset: 1, color: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0)` }]
          }
        },
        lineStyle: { color: getComputedColor('--pa-accent-1', '#8B5CF6'), width: 3 },
        itemStyle: { color: getComputedColor('--pa-accent-1', '#8B5CF6') }
      }]
    };
  };

  const getDecadeChartOption = () => {
    if (!analysisResult) return {};
    const decades = {};
    Object.keys(analysisResult.yearCounts).forEach(year => {
      const decade = Math.floor(year / 10) * 10 + 's';
      decades[decade] = (decades[decade] || 0) + analysisResult.yearCounts[year];
    });

    return {
      tooltip: { trigger: 'item', backgroundColor: 'rgba(21, 21, 34, 0.9)', borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.3)`, textStyle: { color: '#F5F3FF' } },
      series: [{
        type: 'pie',
        radius: ['45%', '75%'],
        itemStyle: { borderRadius: 8, borderColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 2 },
        data: Object.keys(decades).map((d, i) => ({
          name: d, value: decades[d],
          itemStyle: { color: [getComputedColor('--pa-accent-1', '#8B5CF6'), getComputedColor('--pa-accent-2', '#EC4899'), '#4F46E5', getComputedColor('--pa-accent-3', '#10B981'), '#F59E0B'][i % 5] }
        }))
      }]
    };
  };

  const topArtistName = analysisResult?.topArtists?.length > 0 ? analysisResult.topArtists[0].name : null;
  const backgroundImageUrl = artistCustomBgUrl.trim() !== '' 
    ? artistCustomBgUrl.trim() 
    : (topArtistName && artistImages[topArtistName] ? artistImages[topArtistName] : null);

  return (
    <div className="playlist-analyzer-container">
      {backgroundImageUrl && (
        <>
          <div
            className="pa-cover-backdrop-blur"
            style={{ backgroundImage: `url(${backgroundImageUrl})` }}
          ></div>
          <div
            className="pa-cover-backdrop"
            style={{ 
              backgroundImage: `url(${backgroundImageUrl})`,
              '--pa-bg-scale': artistZoomLevel,
              '--pa-bg-blur': `${artistBlurLevel}px`
            }}
          ></div>
        </>
      )}
      <div className="pa-ambient-glow"></div>
      <div className="pa-ambient-glow-2"></div>

      {/* Top Input Bar */}
      <div className="pa-input-section">
        <div className="pa-input-wrapper">
          <Link2 size={18} className="pa-input-icon" />
          <input
            type="text"
            className="pa-input"
            placeholder="Paste Spotify or YouTube playlist URL..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyzePlaylist()}
          />
          <button
            className="pa-analyze-btn"
            onClick={() => analyzePlaylist()}
            disabled={!url || isAnalyzing}
          >
            <Sparkles size={16} /> Analyze
          </button>
        </div>
        <div className="pa-badges-container">
          {analysisResult && (
            <div className="pa-auto-update-badge">
              <Activity size={12} /> Auto-updated
            </div>
          )}
          {analysisResult && (
            <button
              className="pa-history-action-btn"
              onClick={() => { setAnalysisResult(null); setPlaylistData(null); setUrl(''); }}
              title="View History / New Analysis"
            >
              <Clock size={14} /> Back to History
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {isAnalyzing ? (
        <motion.div
          key="pa-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.4 }}
          className="pa-loading-state"
        >
          {/* Particle field */}
          <div className="pa-loader-particles">
            {[...Array(22)].map((_, i) => (
              <div key={i} className="pa-particle" style={{
                '--px': `${Math.random() * 100}%`,
                '--py': `${Math.random() * 100}%`,
                '--pd': `${(Math.random() * 6 + 2).toFixed(1)}s`,
                '--ps': `${(Math.random() * 0.4 + 0.15).toFixed(2)}`,
                animationDelay: `${(Math.random() * 4).toFixed(2)}s`,
              }} />
            ))}
          </div>

          {/* Scan line */}
          <div className="pa-scan-line" />

          {/* Core ring + icon */}
          <div className="pa-loader-core">
            <div className="pa-ring pa-ring-1" />
            <div className="pa-ring pa-ring-2" />
            <div className="pa-ring pa-ring-3" />
            <div className="pa-loader-inner-glow" />
            <div className="pa-waveform">
              {[...Array(13)].map((_, i) => (
                <div key={i} className="pa-wave-bar" style={{
                  animationDelay: `${(i * 0.08).toFixed(2)}s`,
                  '--bar-h': `${(Math.sin(i * 0.6) * 0.5 + 0.5) * 60 + 20}%`,
                }} />
              ))}
            </div>
          </div>

          {/* Status text */}
          <div className="pa-loader-status">
            <AnimatePresence mode="wait">
              <motion.div
                key={analysisStatus}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="pa-loader-status-text"
              >
                {analysisStatus || 'Initializing…'}
              </motion.div>
            </AnimatePresence>
            <div className="pa-loader-dots">
              <div className="pa-ldot" style={{ animationDelay: '0s' }} />
              <div className="pa-ldot" style={{ animationDelay: '0.2s' }} />
              <div className="pa-ldot" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>

          {/* Step tracker */}
          <div className="pa-loader-steps">
            {[
              { key: 'Scanning',  label: 'Fetching tracks',          icon: <Hash size={13} /> },
              { key: 'Detecting', label: 'Resolving metadata',        icon: <BrainCircuit size={13} /> },
              { key: 'Building',  label: 'Computing analytics',       icon: <BarChart2 size={13} /> },
            ].map((step, i) => {
              const isActive  = analysisStatus.includes(step.key);
              const isPending = !isActive && (
                (step.key === 'Detecting' && analysisStatus.includes('Scanning')) ||
                (step.key === 'Building'  && (analysisStatus.includes('Scanning') || analysisStatus.includes('Detecting')))
              );
              const isDoneStep = !isActive && !isPending;
              return (
                <motion.div
                  key={step.key}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.12, duration: 0.35 }}
                  className={`pa-lstep ${isActive ? 'pa-lstep--active' : isDoneStep ? 'pa-lstep--done' : 'pa-lstep--pending'}`}
                >
                  <div className="pa-lstep-dot">
                    {isActive  && <motion.div className="pa-lstep-ping" animate={{ scale: [1, 1.8, 1], opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} />}
                    {isDoneStep && <Check size={10} />}
                    {isPending  && <div className="pa-lstep-pend-inner" />}
                  </div>
                  <div className="pa-lstep-info">
                    <span className="pa-lstep-icon">{step.icon}</span>
                    <span className="pa-lstep-label">{step.label}</span>
                  </div>
                  {isActive && <div className="pa-lstep-bar"><div className="pa-lstep-bar-fill" /></div>}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      ) : !analysisResult ? (
        <div className="pa-empty-state">
          <div className="pa-empty-hero">
            <div className="pa-empty-icon-wrapper">
              <Sparkles className="pa-empty-icon" />
            </div>
            <h2 className="pa-empty-title">
              Deep Playlist <span className="pa-text-gradient">Analytics</span>
            </h2>
            <p className="pa-empty-subtitle">
              Paste any YouTube or Spotify playlist link above to uncover hidden insights.
              Discover your top artists, dominant genres, acoustic profiles, and more.
            </p>
            <button className="pa-empty-cta" onClick={() => {
              const input = document.querySelector('.pa-input');
              if (input) input.focus();
            }}>
              <Play size={18} /> Get Started Now
            </button>
          </div>

          <div className="pa-empty-features">
            <h3 className="pa-section-header">Unlock Insane Insights</h3>
            <div className="pa-features-grid">
              <div className="pa-feature-card">
                <div className="pa-feature-icon" style={{ background: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.15)`, color: '#c4b5fd' }}>
                  <BrainCircuit size={24} />
                </div>
                <h4>AI Auto-Tagging</h4>
                <p>We use smart heuristics to group genres and extract hidden moods from your tracks.</p>
              </div>
              <div className="pa-feature-card">
                <div className="pa-feature-icon" style={{ background: `rgba(${getComputedColor('--pa-accent-2-rgb', '236, 72, 153')}, 0.15)`, color: '#f9a8d4' }}>
                  <BarChart3 size={24} />
                </div>
                <h4>Deep Data Visuals</h4>
                <p>Explore gorgeous, interactive charts detailing your eras, track lengths, and top artists.</p>
              </div>
              <div className="pa-feature-card">
                <div className="pa-feature-icon" style={{ background: `rgba(${getComputedColor('--pa-accent-3-rgb', '16, 185, 129')}, 0.15)`, color: '#6ee7b7' }}>
                  <Music4 size={24} />
                </div>
                <h4>Acoustic Profiling</h4>
                <p>Identify the dominant key, tempo variations, and energy levels across your entire playlist.</p>
              </div>
            </div>
          </div>

          <div className="pa-empty-bottom-grid">
            <div className="pa-history-section">
              <h3 className="pa-history-title"><Clock size={16} /> Recent Analyses</h3>
              {history.length > 0 ? (
                <div className="pa-history-list">
                  {history.map(item => (
                    <div className="pa-history-item" key={item.date} onClick={() => { setUrl(item.url); analyzePlaylist(item.url); }}>
                      <div className="pa-history-cover" style={{ backgroundImage: `url(${item.cover})` }}>
                        {!item.cover && <Disc size={20} />}
                      </div>
                      <div className="pa-history-info">
                        <h4>{item.title}</h4>
                        <span>{item.author} • {item.trackCount} tracks</span>
                      </div>
                      <button 
                        className="pa-history-delete" 
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistory(prev => {
                            const h = prev.filter(x => x.url !== item.url);
                            localStorage.setItem('pa-history', JSON.stringify(h));
                            return h;
                          });
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pa-history-empty">
                  <Clock size={24} style={{ color: 'rgba(255,255,255,0.2)', marginBottom: 12 }} />
                  <p>No recent playlists found.</p>
                  <span>Paste a link above to build your history!</span>
                </div>
              )}
            </div>

            <div className="pa-samples-section">
              <h3 className="pa-history-title"><PlayCircle size={16} /> Try a Sample</h3>
              <div className="pa-samples-list">
                <div className="pa-sample-card" onClick={() => { setUrl('https://music.youtube.com/playlist?list=PLZS9va6NjCDA&si=JIsGEKAjLbtadv6z'); analyzePlaylist('https://music.youtube.com/playlist?list=PLZS9va6NjCDA&si=JIsGEKAjLbtadv6z'); }}>
                  <div className="pa-sample-cover" style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}>
                    <Music size={24} color="#FFF" />
                  </div>
                  <div className="pa-history-info">
                    <h4>iannC's Playlist</h4>
                    <span>Curated vibes</span>
                  </div>
                </div>
                <div className="pa-sample-card" onClick={() => { setUrl('https://music.youtube.com/playlist?list=PLcYmh2nqwzcPX4cnj1gvpQY0LcSrXF-ly&si=t7cBKfXnRkP_RWq6'); analyzePlaylist('https://music.youtube.com/playlist?list=PLcYmh2nqwzcPX4cnj1gvpQY0LcSrXF-ly&si=t7cBKfXnRkP_RWq6'); }}>
                  <div className="pa-sample-cover" style={{ background: 'linear-gradient(135deg, #EC4899, #f43f5e)' }}>
                    <Star size={24} color="#FFF" />
                  </div>
                  <div className="pa-history-info">
                    <h4>V1ccX's Playlist</h4>
                    <span>Top selections</span>
                  </div>
                </div>
                <div className="pa-sample-card" onClick={() => { setUrl('https://music.youtube.com/playlist?list=PLT0CWl9ZGu0w&si=M5W0FlC8qkFKlHPh'); analyzePlaylist('https://music.youtube.com/playlist?list=PLT0CWl9ZGu0w&si=M5W0FlC8qkFKlHPh'); }}>
                  <div className="pa-sample-cover" style={{ background: 'linear-gradient(135deg, #10B981, #14b8a6)' }}>
                    <Activity size={24} color="#FFF" />
                  </div>
                  <div className="pa-history-info">
                    <h4>Streaming</h4>
                    <span>Daily rotation</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="pa-dashboard">

          {/* Hero Section */}
          <div className="pa-hero">
            <div className="pa-hero-cover-wrapper">
              {playlistData.cover ? (
                <img
                  src={playlistData.cover}
                  alt="Cover"
                  className="pa-hero-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <div className="pa-hero-cover-fallback" style={{ display: playlistData.cover ? 'none' : 'flex' }}>
                <Music size={48} />
              </div>
            </div>
            <div className="pa-hero-info">
              <h1 className="pa-hero-title">{playlistData.title}</h1>
              <div className="pa-hero-author">by {playlistData.author}</div>

              <div className="pa-hero-stats">
                <div className="pa-stat-pill">
                  <span className="pa-stat-label">Tracks</span>
                  <span className="pa-stat-value">{analysisResult.totalTracks}</span>
                </div>
                <div className="pa-stat-pill">
                  <span className="pa-stat-label">Duration</span>
                  <span className="pa-stat-value">{formatTotalTime(analysisResult.totalDurationMs)}</span>
                </div>
                <div className="pa-stat-pill">
                  <span className="pa-stat-label">Unique Artists</span>
                  <span className="pa-stat-value">{analysisResult.uniqueArtists}</span>
                </div>
                {analysisResult.duplicates > 0 && (
                  <div className="pa-stat-pill" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                    <span className="pa-stat-label">Duplicates</span>
                    <span className="pa-stat-value" style={{ color: '#ef4444' }}>{analysisResult.duplicates}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* New Highlights Row */}
          <div className="pa-highlights">
            {analysisResult.mostPopularList && analysisResult.mostPopularList.length > 0 && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].id}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.3 }}
                  className="pa-highlight-card"
                >
                  <div className="pa-highlight-icon-wrapper" style={{ color: '#F59E0B', overflow: 'hidden', padding: analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].cover ? '0' : '12px' }}>
                    {analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].cover ? (
                      <img src={analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].cover} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Flame size={24} />
                    )}
                  </div>
                  <div className="pa-highlight-info">
                    <span className="pa-highlight-label">Most Popular</span>
                    <span className="pa-highlight-val" title={analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].title}>{analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].title}</span>
                    <span className="pa-highlight-sub">{analysisResult.mostPopularList[highlightIndex % analysisResult.mostPopularList.length].artist}</span>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}

            {analysisResult.hiddenGemList && analysisResult.hiddenGemList.length > 0 && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].id}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="pa-highlight-card"
                >
                  <div className="pa-highlight-icon-wrapper" style={{ color: getComputedColor('--pa-accent-3', '#10B981'), overflow: 'hidden', padding: analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].cover ? '0' : '12px' }}>
                    {analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].cover ? (
                      <img src={analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].cover} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Star size={24} />
                    )}
                  </div>
                  <div className="pa-highlight-info">
                    <span className="pa-highlight-label">Hidden Gem</span>
                    <span className="pa-highlight-val" title={analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].title}>{analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].title}</span>
                    <span className="pa-highlight-sub">{analysisResult.hiddenGemList[highlightIndex % analysisResult.hiddenGemList.length].artist}</span>
                  </div>
                </motion.div>
              </AnimatePresence>
            )}

            {analysisResult.averageYear && (
              <div className="pa-highlight-card">
                <div className="pa-highlight-icon-wrapper" style={{ color: getComputedColor('--pa-accent-1', '#8B5CF6') }}>
                  <Calendar size={24} />
                </div>
                <div className="pa-highlight-info">
                  <span className="pa-highlight-label">Playlist Era</span>
                  <span className="pa-highlight-val">{analysisResult.eraStr}</span>
                  <span className="pa-highlight-sub">Avg Year: {analysisResult.averageYear}</span>
                </div>
              </div>
            )}
          </div>

          <div className="pa-grid">
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Top Artists Visual Avatars & Chart */}
              <div className="pa-card">
                <div className="pa-card-header" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users className="pa-card-icon" size={20} />
                    <h3 className="pa-card-title">Top Artists</h3>
                  </div>
                  <button
                    className="pa-show-more-btn"
                    onClick={() => setShowAllArtists(true)}
                  >
                    Show More
                  </button>
                </div>

                <div className="pa-artist-avatars">
                  {analysisResult.topArtists.slice(0, 5).map(artist => (
                    <div className="pa-artist-avatar-item" key={artist.name}>
                      <div className="pa-artist-circle" style={{ backgroundColor: artist.color }}>
                        {artistImages[artist.name] ? (
                          <img src={artistImages[artist.name]} alt={artist.name} className="pa-artist-img" />
                        ) : (
                          artist.initials
                        )}
                      </div>
                      <span className="pa-artist-name-small" title={artist.name}>{artist.name}</span>
                    </div>
                  ))}
                </div>

                <div className="pa-card-content" style={{ height: 200, minHeight: 200 }}>
                  <ReactECharts option={getArtistChartOption()} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>

              {/* Mood Analysis */}
              <div className="pa-card">
                <div className="pa-card-header">
                  <Activity className="pa-card-icon" size={20} />
                  <h3 className="pa-card-title">Playlist Mood Profile</h3>
                </div>
                <div className="pa-card-content" style={{ height: 280 }}>
                  <ReactECharts option={getMoodRadarOption()} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>

              {/* Release Timeline (if applicable) */}
              {Object.keys(analysisResult.yearCounts).length > 1 && (
                <div className="pa-card">
                  <div className="pa-card-header">
                    <Clock className="pa-card-icon" size={20} />
                    <h3 className="pa-card-title">Release Year Timeline</h3>
                  </div>
                  <div className="pa-card-content" style={{ height: 200 }}>
                    <ReactECharts option={getYearChartOption()} style={{ height: '100%', width: '100%' }} />
                  </div>
                </div>
              )}

              {/* Top Albums Grid */}
              <div className="pa-card">
                <div className="pa-card-header">
                  <Disc className="pa-card-icon" size={20} />
                  <h3 className="pa-card-title">Top Albums</h3>
                </div>
                <div className="pa-card-content" style={{ padding: analysisResult?.sortedAlbums?.length > 0 ? 16 : 20 }}>
                  {analysisResult?.sortedAlbums?.length > 0 ? (
                    <div className="pa-album-grid">
                      {analysisResult.sortedAlbums.slice(0, 6).map((album, idx) => (
                        <div key={idx} className="pa-album-card" title={album.name}>
                          <div className="pa-album-cover-wrapper">
                            {album.cover ? (
                              <img src={album.cover} alt={album.name} className="pa-album-cover" />
                            ) : (
                              <div className="pa-album-cover-placeholder">
                                <Disc size={24} />
                              </div>
                            )}
                          </div>
                          <div className="pa-album-info">
                            <span className="pa-album-name">{album.name}</span>
                            <span className="pa-album-artist">{album.artist}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: 'rgba(245,243,255,0.5)', textAlign: 'center' }}>No album data available</div>
                  )}
                </div>
              </div>

            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* AI Insights */}
              <div className="pa-card" style={{ background: 'linear-gradient(180deg, rgba(21, 21, 34, 0.8), rgba(21, 21, 34, 0.4))', borderColor: `rgba(${getComputedColor('--pa-accent-1-rgb', '139, 92, 246')}, 0.2)` }}>
                <div className="pa-card-header">
                  <Sparkles className="pa-card-icon" size={20} color="#EC4899" style={{ background: `rgba(${getComputedColor('--pa-accent-2-rgb', '236, 72, 153')}, 0.1)` }} />
                  <h3 className="pa-card-title">Automatic AI Insights</h3>
                </div>
                <div className="pa-ai-insights">
                  {analysisResult.insights.map((text, i) => {
                    const parts = text.split('**');
                    return (
                      <motion.div
                        key={i}
                        className="pa-ai-item"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 * i }}
                      >
                        <Sparkles size={16} className="pa-ai-icon" />
                        <p className="pa-ai-text">
                          {parts.map((p, j) => j % 2 === 1 ? <strong key={j} style={{ color: '#F5F3FF' }}>{p}</strong> : p)}
                        </p>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Genres */}
              <div className="pa-card">
                <div className="pa-card-header">
                  <Hash className="pa-card-icon" size={20} />
                  <h3 className="pa-card-title">Dominant Genres</h3>
                </div>
                <div className="pa-card-content" style={{ height: 250 }}>
                  <ReactECharts option={getGenreChartOption()} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>

              {/* Song Length Distribution */}
              <div className="pa-card">
                <h3 className="pa-card-title"><Clock size={16} className="pa-card-icon" /> Length Distribution</h3>
                <div style={{ height: 250 }}>
                  <ReactECharts option={getLengthChartOption()} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>

              {/* Decades Distribution */}
              <div className="pa-card">
                <h3 className="pa-card-title"><Calendar size={16} className="pa-card-icon" /> Era / Decades</h3>
                <div style={{ height: 250 }}>
                  <ReactECharts option={getDecadeChartOption()} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>

              {/* Top Albums List */}
              <div className="pa-card">
                <div className="pa-card-header">
                  <Disc className="pa-card-icon" size={20} />
                  <h3 className="pa-card-title">Album Distribution</h3>
                </div>
                <div className="pa-card-content" style={{ height: analysisResult.sortedAlbums.length > 0 ? 250 : 'auto', padding: analysisResult.sortedAlbums.length > 0 ? 0 : '20px' }}>
                  {analysisResult.sortedAlbums.length > 0 ? (
                    <ReactECharts option={getAlbumChartOption()} style={{ height: '100%', width: '100%' }} />
                  ) : (
                    <div style={{ color: 'rgba(245,243,255,0.5)', textAlign: 'center' }}>No album data available</div>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* All Artists Modal */}
          <AnimatePresence>
            {showAllArtists && (
              <motion.div
                className="pa-modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAllArtists(false)}
              >
                <motion.div
                  className="pa-modal-content"
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 50, opacity: 0 }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="pa-modal-header">
                    <h2>Top Artists ({analysisResult.topArtists.length})</h2>
                    <button className="pa-modal-close" onClick={() => setShowAllArtists(false)}>
                      <X size={24} />
                    </button>
                  </div>
                  <div className="pa-modal-grid">
                    {analysisResult.topArtists.map((artist, idx) => (
                      <div className="pa-modal-artist-card" key={artist.name}>
                        <div className="pa-modal-artist-rank">#{idx + 1}</div>
                        <div className="pa-modal-artist-avatar" style={{ backgroundColor: artist.color }}>
                          {artistImages[artist.name] ? (
                            <img src={artistImages[artist.name]} alt={artist.name} />
                          ) : (
                            <span>{artist.initials}</span>
                          )}
                        </div>
                        <div className="pa-modal-artist-info">
                          <div className="pa-modal-artist-name">{artist.name}</div>
                          <div className="pa-modal-artist-tracks">{artist.tracks} tracks</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
