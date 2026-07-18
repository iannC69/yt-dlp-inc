export async function getAverageColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous"; // Try to avoid CORS issues
    img.src = src;

    img.onload = () => {
      try {
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
        // If canvas is tainted by CORS, default to green
        resolve('rgb(29, 185, 84)');
      }
    };
    img.onerror = () => resolve('rgb(29, 185, 84)');
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
