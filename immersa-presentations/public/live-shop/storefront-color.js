(function () {
  function dominantColor(pixels, width, height) {
    const colors = new Map();
    let edgeCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const lightest = Math.max(red, green, blue);
        const darkest = Math.min(red, green, blue);
        const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
        if (edge) edgeCount++;
        if (pixels[offset + 3] < 128 || (lightest >= 232 && darkest >= 220)) continue;

        const key = [red, green, blue].map(channel => channel >> 5).join(",");
        const color = colors.get(key) || { red: 0, green: 0, blue: 0, weight: 0, edge: 0 };
        const centrality = 1 - Math.max(Math.abs((x + .5) / width - .5), Math.abs((y + .5) / height - .5)) * 2;
        const weight = .55 + centrality * .7 + (lightest - darkest) / 510;
        color.red += red * weight;
        color.green += green * weight;
        color.blue += blue * weight;
        color.weight += weight;
        color.edge += Number(edge);
        colors.set(key, color);
      }
    }

    let dominant;
    let bestScore = 0;
    for (const color of colors.values()) {
      // A flat color across the edges is more likely to be the photo backdrop.
      const backdrop = Math.min(.94, color.edge / Math.max(1, edgeCount) * 2.4);
      const score = color.weight * (1 - backdrop);
      if (score <= bestScore) continue;
      bestScore = score;
      dominant = color;
    }
    if (!dominant) return null;
    return [dominant.red, dominant.green, dominant.blue].map(value => Math.round(value / dominant.weight));
  }

  function buttonColors(rgb) {
    const [red, green, blue] = rgb || [34, 37, 35];
    const linear = channel => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    };
    const luminance = .2126 * linear(red) + .7152 * linear(green) + .0722 * linear(blue);
    return { background: "rgb(" + [red, green, blue].join(", ") + ")", foreground: luminance > .179 ? "#000" : "#fff" };
  }

  function applyImageColor(image, button) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const canvas = document.createElement("canvas");
    const scale = 48 / Math.max(image.naturalWidth, image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const { background, foreground } = buttonColors(dominantColor(pixels, canvas.width, canvas.height));
      button.style.setProperty("--shop-button", background);
      button.style.setProperty("--shop-button-text", foreground);
    } catch (_error) {
      // An unavailable pixel buffer keeps the default button colors.
    }
  }

  if (typeof module === "object" && module.exports) module.exports = { dominantColor, buttonColors };
  else window.ImmersaShopImageColor = applyImageColor;
})();
