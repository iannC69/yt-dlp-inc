/**
 * Upgrades a YouTube thumbnail URL to the highest available quality.
 * YouTube thumbnail quality ladder (by resolution):
 *   maxresdefault.jpg  → 1280×720  (not always available)
 *   sddefault.jpg      → 640×480
 *   hqdefault.jpg      → 480×360   (always available)
 *   mqdefault.jpg      → 320×180
 *   default.jpg        → 120×90
 */
export function getBestYtThumbnail(url) {
  if (!url || !url.includes('ytimg.com')) return url;
  // Replace any quality variant with maxresdefault
  return url.replace(
    /(\/vi(?:_webp)?\/[^/]+\/)([^/?#]+)(\.(?:jpg|webp))/i,
    '$1maxresdefault$3'
  );
}

export async function getAverageColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const isYoutube = src.includes('ytimg.com');
    
    // YouTube blocks CORS for canvas, so don't request Anonymous to avoid ugly console errors
    if (!isYoutube) {
      img.crossOrigin = "Anonymous";
    }
    
    img.src = src;

    img.onload = () => {
      try {
        if (isYoutube) throw new Error("CORS fallback for YouTube");
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;

        context.drawImage(img, 0, 0, img.width, img.height);
        
        // Get image data
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        let r = 0, g = 0, b = 0;
        let count = 0;

        // Sample every 4th pixel to speed up
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        // Boost saturation slightly for better glow
        const hsl = rgbToHsl(r, g, b);
        hsl.s = Math.min(1, hsl.s * 1.5); // Boost saturation
        const boostedRgb = hslToRgb(hsl.h, hsl.s, hsl.l);

        resolve(`rgb(${Math.floor(boostedRgb.r)}, ${Math.floor(boostedRgb.g)}, ${Math.floor(boostedRgb.b)})`);
      } catch (e) {
        // Fallback colors if tainted by CORS
        if (isYoutube) {
          resolve('rgb(25, 25, 35)'); // Dark neutral for YouTube
        } else {
          resolve('rgb(29, 185, 84)'); // Spotify green fallback
        }
      }
    };
    img.onerror = () => {
      if (isYoutube) resolve('rgb(25, 25, 35)');
      else resolve('rgb(29, 185, 84)');
    };
  });
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

export function getVibrantAccent(rgbStr) {
  if (!rgbStr || !rgbStr.startsWith('rgb')) return rgbStr;
  const match = rgbStr.match(/\d+/g);
  if (!match || match.length < 3) return rgbStr;
  const r = parseInt(match[0], 10);
  const g = parseInt(match[1], 10);
  const b = parseInt(match[2], 10);
  
  const hsl = rgbToHsl(r, g, b);
  // Ensure minimum lightness and saturation for UI accents
  hsl.s = Math.max(0.6, hsl.s);
  hsl.l = Math.max(0.45, Math.min(0.65, hsl.l)); 
  
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}
