# RankCut Studio

RankCut Studio is a local-first vertical video editor for creating ranked TikTok, Reels, and YouTube Shorts compilations. Paste video links or upload local footage, arrange the ranking, add styled text, trim each clip, and render one downloadable MP4.

## Start the app

1. Double-click **Start RankCut.bat**.
2. The portable Node.js runtime, FFmpeg, FFprobe, and yt-dlp are already included. If a tool is ever missing, the launcher runs the one-time repair setup automatically.
3. RankCut opens at `http://127.0.0.1:4174` in your default browser.

## Running a GitHub clone

The published source repository does not include the large Windows media binaries. After cloning it, right-click `setup.ps1` and choose **Run with PowerShell** once; it downloads the same local Node.js, FFmpeg, FFprobe, and yt-dlp tools into `tools/`. Then double-click **Start RankCut.bat** normally.

No install or account is required. The server only listens on your own computer (`127.0.0.1`). Project data, source videos, and exports remain inside this folder.

## Editor workflow

- Paste TikTok or YouTube Share links, full copied share messages, or multiple links, then choose **Import**.
- You can also choose **Upload** for MP4, MOV, M4V, WebM, or MKV files.
- Drag videos in the Rank stack to reorder them, use the arrow on a card to move it down one rank, or use Shuffle.
- Use **Video title** for text shared across the full export.
- Use **List text** for the selected video's individual ranked entry.
- Every countdown number remains visible for the full compilation. Only the active video's list label is revealed beside its number.
- Click individual word chips, then apply a palette or custom color.
- Add common emojis and choose Outline, Shadow, Glow, or Clean text effects.
- Use the Clip tab to trim, fit/crop, rename, mute, or change volume.
- Choose **Export video** to render a 1080 × 1920 H.264 MP4.

## Where files are stored

- Project state: `data/project.json`
- Imported/uploaded videos: `data/uploads/`
- Finished MP4 files: `data/exports/`

## Notes

- TikTok and YouTube sometimes change their delivery systems. Rerun `setup.ps1` to update the downloader extractors.
- TikTok links require TikTok to be reachable from this PC. If the network blocks TikTok, upload a video file directly.
- Some protected, private, age-restricted, region-limited, or DRM-controlled videos cannot be downloaded. Only import media you are allowed to use.
- Long or high-resolution source videos require more rendering time and disk space.
- Closing the editor tab does not delete your project. It autosaves locally.

## Manual start

From PowerShell in this folder:

```powershell
node server.js
```

Then open `http://127.0.0.1:4174`.
