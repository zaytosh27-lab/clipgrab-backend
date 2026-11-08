const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { spawn, execFile } = require("child_process");

const app = express();
app.set("trust proxy", 1);
// Set ALLOWED_ORIGIN to your site, e.g. https://clipgrab.yourdomain.com
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(rateLimit({ windowMs: 60_000, max: 15 }));

const HOSTS = /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/i;

function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || !HOSTS.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}
// TikTok serves single-file MP4s, so no merging is needed.
const fmt = q => (q === "720" ? "b[height<=720]/b" : "b[height<=480]/b");

app.get("/health", (_, res) => res.send("ok"));

app.get("/api/download", (req, res) => {
  const url = cleanUrl(req.query.url);
  const q = req.query.quality === "720" ? "720" : "480";
  if (!url) return res.status(400).json({ error: "Not a TikTok link" });

  execFile("yt-dlp", ["-J", "--no-playlist", "--", url], { timeout: 30_000, maxBuffer: 20e6 }, (err, out) => {
    if (err) return res.status(502).json({ error: "Could not read that video" });
    try {
      const d = JSON.parse(out);
      const base = `${req.protocol}://${req.get("host")}`;
      res.json({
        title: d.title || "TikTok video",
        thumbnail: d.thumbnail || "",
        downloadUrl: `${base}/api/file?quality=${q}&url=${encodeURIComponent(url)}`,
      });
    } catch { res.status(502).json({ error: "Bad response" }); }
  });
});

app.get("/api/file", (req, res) => {
  const url = cleanUrl(req.query.url);
  const q = req.query.quality === "720" ? "720" : "480";
  if (!url) return res.status(400).end();

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="tiktok-${q}p.mp4"`);
  const p = spawn("yt-dlp", ["-f", fmt(q), "--no-playlist", "-o", "-", "--", url]);
  const kill = setTimeout(() => p.kill("SIGKILL"), 120_000);
  p.stdout.pipe(res);
  p.on("close", () => clearTimeout(kill));
  res.on("close", () => p.kill("SIGKILL"));
});

app.listen(process.env.PORT || 3000, () => console.log("Clipgrab backend running"));
