const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const config = require("../config");
const logger = require("../logger");

const fontFiles = [
  ["JameelNooriNastaleeq.ttf", "Jameel"],
  ["NotoSansDevanagari-Bold.ttf", "NotoDevanagari"],
  ["NotoSansSC-Bold.ttf", "NotoSC"],
];

for (const [file, family] of fontFiles) {
  const fontPath = path.join(__dirname, "..", "..", "fonts", file);
  if (!fs.existsSync(fontPath)) throw new Error(`Required card font is missing: ${file}`);
  GlobalFonts.registerFromPath(fontPath, family);
}

const toneSearch = {
  Islamic: "mosque sunrise",
  Romantic: "romantic sunrise",
  Professional: "city sunrise",
  Funny: "happy sunrise",
  Poetic: "misty sunrise",
  Motivational: "mountain sunrise",
};

const palettes = {
  sunrise: ["#6d3e61", "#f2994a", "#fdd355"],
  minimal: ["#263238", "#546e7a", "#c5d7dc"],
  floral: ["#44334c", "#b36377", "#f3c7b1"],
};

async function fetchPayloadWithRetry(url, responseType, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new Error(`Image source returned HTTP ${response.status}`);
      if (responseType === "json") return await response.json();
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) throw new Error("Image source returned a non-image response.");
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function loadBackground(tone) {
  if (config.UNSPLASH_ACCESS_KEY) {
    try {
      const query = encodeURIComponent(toneSearch[tone] || "sunrise");
      const metadata = await fetchPayloadWithRetry(
        `https://api.unsplash.com/photos/random?query=${query}&orientation=portrait&client_id=${encodeURIComponent(config.UNSPLASH_ACCESS_KEY)}`,
        "json",
      );
      const imageUrl = metadata.urls && (metadata.urls.regular || metadata.urls.full);
      if (!imageUrl) throw new Error("Unsplash did not return an image URL.");
      const parsedImageUrl = new URL(imageUrl);
      if (parsedImageUrl.protocol !== "https:" || parsedImageUrl.hostname !== "images.unsplash.com") {
        throw new Error("Unsplash returned an unexpected image host.");
      }
      return await fetchPayloadWithRetry(parsedImageUrl.href, "image");
    } catch (error) {
      logger.warn({ error: error.message }, "Unsplash background unavailable");
    }
  }

  try {
    return await fetchPayloadWithRetry(`https://picsum.photos/1080/1350?random=${Date.now()}`, "image");
  } catch (error) {
    logger.warn({ error: error.message }, "Picsum background unavailable; using a solid background");
    return null;
  }
}

function isRtl(text) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text);
}

function fontFor(text) {
  if (isRtl(text)) return "Jameel";
  if (/[\u0900-\u097F]/u.test(text)) return "NotoDevanagari";
  if (/[\u3400-\u9FFF\uF900-\uFAFF]/u.test(text)) return "NotoSC";
  return "Arial";
}

function splitLongWord(ctx, word, maxWidth) {
  const chunks = [];
  let current = "";
  for (const character of Array.from(word)) {
    const candidate = current + character;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = "";
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        const pieces = splitLongWord(ctx, word, maxWidth);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] || "";
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

async function renderGreetingCard({ greeting, tone = "Motivational", style = "sunrise", userName = "" }) {
  const width = 1080;
  const height = 1350;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const background = await loadBackground(tone);

  if (background) {
    try {
      const image = await loadImage(background);
      context.drawImage(image, 0, 0, width, height);
    } catch (error) {
      logger.warn({ error: error.message }, "Downloaded card background could not be decoded");
      context.fillStyle = palettes[style][0];
      context.fillRect(0, 0, width, height);
    }
  } else {
    const palette = palettes[style] || palettes.sunrise;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(0.55, palette[1]);
    gradient.addColorStop(1, palette[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  const overlay = context.createLinearGradient(0, 0, 0, height);
  overlay.addColorStop(0, "rgba(0,0,0,0.12)");
  overlay.addColorStop(0.32, "rgba(0,0,0,0.22)");
  overlay.addColorStop(1, "rgba(0,0,0,0.78)");
  context.fillStyle = overlay;
  context.fillRect(0, 0, width, height);

  const rtl = isRtl(greeting);
  const fontFamily = fontFor(greeting);
  const maxWidth = 860;
  const maxHeight = 760;
  let fontSize = 74;
  let lineHeight = 0;
  let lines = [];

  while (fontSize >= 34) {
    context.font = `bold ${fontSize}px "${fontFamily}"`;
    lines = wrapText(context, greeting, maxWidth);
    lineHeight = Math.round(fontSize * 1.4);
    if (lines.length * lineHeight <= maxHeight) break;
    fontSize -= 2;
  }

  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/u, "")}…`;
  }

  const textStart = 310 + (maxHeight - lines.length * lineHeight) / 2;
  context.direction = rtl ? "rtl" : "ltr";
  context.textAlign = rtl ? "right" : "center";
  context.textBaseline = "middle";
  context.font = `bold ${fontSize}px "${fontFamily}"`;
  context.fillStyle = "#fff";
  context.shadowColor = "rgba(0,0,0,0.75)";
  context.shadowBlur = 12;

  lines.forEach((line, index) => {
    context.fillText(line, rtl ? width - 110 : width / 2, textStart + index * lineHeight, maxWidth);
  });

  context.shadowBlur = 0;
  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(110, 270);
  context.lineTo(width - 110, 270);
  context.stroke();
  context.textAlign = "center";
  context.font = "600 30px Arial";
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.fillText(userName ? `From ${userName}` : "Good Morning AI", width / 2, 1190, 860);

  return `data:image/jpeg;base64,${canvas.toBuffer("image/jpeg", 88).toString("base64")}`;
}

module.exports = { renderGreetingCard };
