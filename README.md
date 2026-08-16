# RankCut Studio

RankCut Studio is a local-first vertical video editor for creating ranked TikTok, Reels, and YouTube Shorts compilations. Paste video links or upload local footage, arrange the ranking, add styled text, trim each clip, and render one downloadable MP4.

## Start the app

1. Double-click **Start RankCut.bat**.
2. On a fresh clone, the launcher runs the one-time `setup.ps1` repair step and downloads portable Node.js, FFmpeg, FFprobe, and yt-dlp from their official release sources. Existing tools are reused.
3. RankCut opens at `http://127.0.0.1:4174` in your default browser.

No install or account is required. The server only listens on your own computer (`127.0.0.1`). Project data, source videos, and exports remain inside this folder.

## Share to another PC

The source package is self-contained and can be shared through this GitHub repository:

```powershell
git clone https://github.com/adib-cyber007/RankCut.git
cd RankCut
.\Start RankCut.bat
```

The first launch downloads the ignored media-tool executables into `tools/`. GitHub does not store those large binaries, local uploads, exports, or `data/project.json`.

To move an editable project between PCs, copy `data/project.json` and the matching files in `data/uploads/` together. To share only the editor, clone the repository and start it with an empty local project.

## Editor workflow

- Paste one TikTok or YouTube URL per line, then choose **Import**.
- You can also choose **Upload** for MP4, MOV, M4V, WebM, or MKV files.
- Assign each video's rank from its **Clip settings** panel. Ranks stay attached to their videos.
- Drag videos in the **Entrance order**, use the arrow to move one later, or choose Shuffle. These actions change only when videos enter; they never change the assigned ranks.
- Use **Video title** for text shared across the full export.
- Use **List text** for the selected video's individual ranked entry. All rank numbers remain visible; each entry stays on screen after it is revealed.
- Click individual word chips, then apply a palette or custom color.
- Use the Clip tab to trim, fit/crop, rename, mute, or change volume.
- Choose **Export video** to render a 1080 × 1920 H.264 MP4.

## Where files are stored

- Project state: `data/project.json`
- Imported/uploaded videos: `data/uploads/`
- Finished MP4 files: `data/exports/`

## Notes

- TikTok and YouTube sometimes change their delivery systems. You can rerun `setup.ps1` after removing `tools/yt-dlp.exe` to fetch the current downloader.
- Some protected, private, age-restricted, region-limited, or DRM-controlled videos cannot be downloaded. Only import media you are allowed to use.
- Long or high-resolution source videos require more rendering time and disk space.
- Closing the editor tab does not delete your project. It autosaves locally.

## Manual start

From PowerShell in this folder:

```powershell
node server.js
```

Then open `http://127.0.0.1:4174`.
