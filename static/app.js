(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PALETTE = ['#FFFFFF', '#FFE66D', '#FF795C', '#78D8BE', '#77AEFF', '#B99CFF', '#171925'];
  const HISTORY_LIMIT = 50;

  const elements = {
    projectName: $('#project-name'), saveStatus: $('#save-status'), toolStatus: $('#tool-status'),
    clipCount: $('#clip-count'), clipList: $('#clip-list'), rankEmpty: $('#rank-empty'),
    urlInput: $('#url-input'), importButton: $('#import-button'), importProgress: $('#import-progress'),
    fileInput: $('#file-input'), shuffleButton: $('#shuffle-button'), exportButton: $('#export-button'),
    exportSideButton: $('#export-side-button'),
    previewEmpty: $('#preview-empty'), phoneStage: $('#phone-stage'), previewVideo: $('#preview-video'),
    titleOverlay: $('#title-overlay'), countdownOverlay: $('#countdown-overlay'),
    transport: $('#transport'), playButton: $('#play-button'), scrubber: $('#scrubber'), currentTime: $('#current-time'), durationTime: $('#duration-time'),
    skipBack: $('#skip-back'), skipForward: $('#skip-forward'), mutePreview: $('#mute-preview'), fitButton: $('#fit-button'),
    timelineTrack: $('#timeline-track'), timelineDuration: $('#timeline-duration'),
    titleEnabled: $('#title-enabled'), titleInput: $('#title-input'), titleTokens: $('#title-tokens'), titlePalette: $('#title-palette'), titleCustomColor: $('#title-custom-color'),
    titleSize: $('#title-size'), titleSizeValue: $('#title-size-value'), titleY: $('#title-y'), titleYValue: $('#title-y-value'), titleBackground: $('#title-background'), titleBackgroundValue: $('#title-background-value'),
    listEditor: $('#list-editor'), noClipEditor: $('#no-clip-editor'), editingRank: $('#editing-rank'), listInput: $('#list-input'), listTokens: $('#list-tokens'), listPalette: $('#list-palette'), listCustomColor: $('#list-custom-color'),
    listSize: $('#list-size'), listSizeValue: $('#list-size-value'), listY: $('#list-y'), listYValue: $('#list-y-value'), listBackground: $('#list-background'), listBackgroundValue: $('#list-background-value'), badgeColor: $('#badge-color'),
    clipPanelEmpty: $('#clip-panel-empty'), clipControls: $('#clip-controls'), clipName: $('#clip-name'), clipSource: $('#clip-source'), clipDimensions: $('#clip-dimensions'), clipOriginalDuration: $('#clip-original-duration'),
    trimStart: $('#trim-start'), trimEnd: $('#trim-end'), clipMuted: $('#clip-muted'), clipVolume: $('#clip-volume'), volumeValue: $('#volume-value'), deleteClip: $('#delete-clip'),
    undoButton: $('#undo-button'), redoButton: $('#redo-button'), qualitySelect: $('#quality-select'), speedSelect: $('#speed-select'), recentExports: $('#recent-exports'), refreshExports: $('#refresh-exports'),
    exportDialog: $('#export-dialog'), exportConfirm: $('#export-confirm'), exportRunning: $('#export-running'), exportComplete: $('#export-complete'), exportSummary: $('#export-summary'), exportPreviewStrip: $('#export-preview-strip'),
    startRender: $('#start-render'), renderPercent: $('#render-percent'), renderProgress: $('#render-progress'), renderMessage: $('#render-message'), renderTitle: $('#render-title'), downloadExport: $('#download-export'), exportResultVideo: $('#export-result-video'), closeExport: $('#close-export'),
    toastRegion: $('#toast-region'), helpButton: $('#help-button'), helpDialog: $('#help-dialog'),
  };

  const defaultProject = () => ({
    version: 2,
    name: 'My ranked short',
    selectedId: null,
    title: {
      enabled: true,
      text: 'THE MOST SATISFYING CLIPS RANKED',
      tokens: [
        { text: 'THE', color: '#FFFFFF' }, { text: 'MOST', color: '#FFFFFF' },
        { text: 'SATISFYING', color: '#FFE66D' }, { text: 'CLIPS', color: '#FFFFFF' },
        { text: 'RANKED', color: '#FF795C' },
      ],
      size: 78, y: 9, background: 66, align: 'center', effect: 'outline',
    },
    clips: [],
    export: { crf: 20, preset: 'medium' },
    updatedAt: new Date().toISOString(),
  });

  let project = defaultProject();
  let undoStack = [];
  let redoStack = [];
  let titleSelection = new Set([2]);
  let listSelection = new Set();
  let saveTimer = null;
  let dragId = null;
  let importBusy = false;
  let renderPoll = null;

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function formatTime(seconds, tenths = false) {
    const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(tenths ? 1 : 0).padStart(tenths ? 4 : 2, '0')}`;
  }

  function formatBytes(bytes) {
    if (!Number(bytes)) return '0 MB';
    const mb = bytes / 1024 / 1024;
    return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }

  function extractImportUrls(value) {
    const pattern = /(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be|tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/[^\s<>"']+/gi;
    return [...String(value || '').matchAll(pattern)]
      .map((match) => match[0].replace(/[),.;!?\]}]+$/g, ''))
      .map((url) => /^https?:\/\//i.test(url) ? url : `https://${url}`)
      .filter((url, index, all) => all.indexOf(url) === index);
  }

  function selectedClip() {
    return project.clips.find((clip) => clip.id === project.selectedId) || null;
  }

  function selectedIndex() {
    return project.clips.findIndex((clip) => clip.id === project.selectedId);
  }

  function normalizedTokens(text, previous = [], defaultColor = '#FFFFFF') {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    return words.map((word, index) => {
      const exact = previous[index]?.text === word ? previous[index] : previous.find((token, oldIndex) => oldIndex >= index - 1 && oldIndex <= index + 1 && token.text === word);
      return { text: word, color: exact?.color || defaultColor };
    });
  }

  function ensureClipShape(clip) {
    const duration = Math.max(.1, Number(clip.duration) || 10);
    const listText = clip.list?.text || 'WORTH THE WATCH';
    return {
      ...clip,
      trimStart: clamp(clip.trimStart ?? 0, 0, duration - .1),
      trimEnd: clamp(clip.trimEnd ?? duration, .1, duration),
      volume: clamp(clip.volume ?? 1, 0, 2),
      muted: Boolean(clip.muted),
      fit: clip.fit === 'contain' ? 'contain' : 'cover',
      list: {
        text: listText,
        tokens: Array.isArray(clip.list?.tokens) ? clip.list.tokens : normalizedTokens(listText, [], '#FFFFFF'),
        size: clamp(clip.list?.size ?? 60, 24, 110),
        y: clamp(clip.list?.y ?? 73, 25, 88),
        background: clamp(clip.list?.background ?? 72, 0, 100),
        badgeColor: /^#[0-9a-f]{6}$/i.test(clip.list?.badgeColor || '') ? clip.list.badgeColor : '#FF795C',
        effect: ['outline', 'shadow', 'glow', 'none'].includes(clip.list?.effect) ? clip.list.effect : 'outline',
      },
    };
  }

  function normalizeProject(input) {
    const base = defaultProject();
    const next = input && typeof input === 'object' ? input : base;
    next.title = { ...base.title, ...(next.title || {}) };
    if (!['outline', 'shadow', 'glow', 'none'].includes(next.title.effect)) next.title.effect = 'outline';
    next.title.tokens = Array.isArray(next.title.tokens) ? next.title.tokens : normalizedTokens(next.title.text, [], '#FFFFFF');
    next.clips = Array.isArray(next.clips) ? next.clips.map(ensureClipShape) : [];
    next.export = { ...base.export, ...(next.export || {}) };
    if (!next.clips.some((clip) => clip.id === next.selectedId)) next.selectedId = next.clips[0]?.id || null;
    return next;
  }

  function snapshot() {
    return JSON.stringify(project);
  }

  function pushHistory() {
    const value = snapshot();
    if (undoStack.at(-1) !== value) undoStack.push(value);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    elements.undoButton.disabled = undoStack.length === 0;
    elements.redoButton.disabled = redoStack.length === 0;
  }

  function mutate(mutator, options = {}) {
    if (options.history !== false) pushHistory();
    mutator(project);
    project.updatedAt = new Date().toISOString();
    scheduleSave();
    if (options.render === false) return;
    if (options.render === 'preview') renderPreview();
    else renderAll();
  }

  function restoreFrom(stackFrom, stackTo) {
    if (!stackFrom.length) return;
    stackTo.push(snapshot());
    project = normalizeProject(JSON.parse(stackFrom.pop()));
    updateHistoryButtons();
    scheduleSave();
    renderAll();
  }

  function scheduleSave() {
    elements.saveStatus.classList.add('saving');
    elements.saveStatus.classList.remove('error');
    elements.saveStatus.lastChild.textContent = ' Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProject, 650);
  }

  async function saveProject() {
    clearTimeout(saveTimer);
    try {
      await api('/api/project', { method: 'POST', body: { project } });
      elements.saveStatus.classList.remove('saving', 'error');
      elements.saveStatus.lastChild.textContent = ' Saved locally';
    } catch (error) {
      elements.saveStatus.classList.remove('saving');
      elements.saveStatus.classList.add('error');
      elements.saveStatus.lastChild.textContent = ' Save failed';
      toast(error.message, 'error');
    }
  }

  async function api(url, options = {}) {
    const init = { ...options };
    if (init.body && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer)) {
      init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
      init.body = JSON.stringify(init.body);
    }
    const response = await fetch(url, init);
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.detail || data?.error || `Request failed (${response.status}).`);
    return data;
  }

  function toast(message, kind = 'success', timeout = 3200) {
    const item = document.createElement('div');
    item.className = `toast ${kind}`;
    item.textContent = message;
    elements.toastRegion.append(item);
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => item.remove(), 220);
    }, timeout);
  }

  function tokenMarkup(tokens) {
    return (tokens || []).map((token, index) => `<span data-token="${index}" style="color:${escapeHtml(token.color || '#FFFFFF')}">${escapeHtml(token.text)}${index < tokens.length - 1 ? ' ' : ''}</span>`).join('');
  }

  function renderPalette(container, target) {
    container.innerHTML = PALETTE.map((color) => `<button class="swatch" data-color="${color}" data-target="${target}" type="button" style="--swatch:${color}" aria-label="Apply ${color}"></button>`).join('');
  }

  function renderTokenField(container, tokens, selected, target) {
    container.innerHTML = (tokens || []).map((token, index) => `
      <button type="button" class="word-token ${selected.has(index) ? 'selected' : ''}" data-token-index="${index}" data-token-target="${target}" style="--token-color:${escapeHtml(token.color)}">${escapeHtml(token.text)}</button>
    `).join('');
  }

  function clipDuration(clip) {
    return Math.max(.1, Number(clip.trimEnd) - Number(clip.trimStart));
  }

  function renderClipList() {
    elements.clipCount.textContent = project.clips.length;
    elements.rankEmpty.hidden = project.clips.length > 0;
    elements.clipList.innerHTML = project.clips.map((clip, index) => `
      <article class="clip-card ${clip.id === project.selectedId ? 'selected' : ''}" data-clip-id="${escapeHtml(clip.id)}" draggable="true" tabindex="0" aria-label="Rank ${index + 1}: ${escapeHtml(clip.name)}">
        <span class="drag-handle" title="Drag to reorder"><svg viewBox="0 0 16 20"><circle cx="5" cy="4" r="1"/><circle cx="11" cy="4" r="1"/><circle cx="5" cy="10" r="1"/><circle cx="11" cy="10" r="1"/><circle cx="5" cy="16" r="1"/><circle cx="11" cy="16" r="1"/></svg></span>
        <span class="clip-thumb">${clip.poster ? `<img src="${escapeHtml(clip.poster)}" alt="" />` : ''}<b class="clip-rank">${String(index + 1).padStart(2, '0')}</b></span>
        <span class="clip-info"><strong>${escapeHtml(clip.name || `Video ${index + 1}`)}</strong><span class="clip-meta"><i class="source-pill">${escapeHtml(clip.source || 'Video')}</i>${formatTime(clipDuration(clip), true)}</span></span>
        <button class="card-menu" type="button" data-move-down="${escapeHtml(clip.id)}" title="Move down one rank" aria-label="Move ${escapeHtml(clip.name)} down one rank"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
      </article>
    `).join('');
  }

  function renderTimeline() {
    const total = project.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
    elements.timelineDuration.textContent = formatTime(total);
    elements.timelineTrack.innerHTML = project.clips.map((clip, index) => `
      <button type="button" class="timeline-clip ${clip.id === project.selectedId ? 'selected' : ''}" data-timeline-id="${escapeHtml(clip.id)}" style="--duration:${Math.max(1, clipDuration(clip))}">
        ${clip.poster ? `<img src="${escapeHtml(clip.poster)}" alt="" />` : ''}<span>${String(index + 1).padStart(2, '0')}</span><i>${formatTime(clipDuration(clip), true)}</i>
      </button>
    `).join('');
  }

  function renderPreview() {
    const clip = selectedClip();
    const hasClip = Boolean(clip);
    elements.previewEmpty.hidden = hasClip;
    elements.phoneStage.hidden = !hasClip;
    elements.transport.hidden = !hasClip;
    if (!clip) {
      elements.previewVideo.pause();
      elements.previewVideo.removeAttribute('src');
      return;
    }

    if (elements.previewVideo.dataset.clipId !== clip.id) {
      elements.previewVideo.pause();
      elements.previewVideo.src = clip.url;
      elements.previewVideo.dataset.clipId = clip.id;
      elements.previewVideo.load();
      elements.previewVideo.currentTime = Number(clip.trimStart) || 0;
      elements.playButton.classList.remove('playing');
    }
    elements.phoneStage.classList.toggle('contain', clip.fit === 'contain');
    elements.fitButton.textContent = clip.fit === 'contain' ? 'Fit inside' : 'Fill frame';
    elements.titleOverlay.hidden = project.title.enabled === false || !project.title.tokens?.length;
    elements.titleOverlay.innerHTML = tokenMarkup(project.title.tokens);
    elements.titleOverlay.style.top = `${project.title.y}%`;
    elements.titleOverlay.style.background = `rgba(9,11,18,${project.title.background / 100})`;
    elements.titleOverlay.style.fontSize = `${Math.max(12, elements.phoneStage.clientWidth * project.title.size / 1080)}px`;
    elements.titleOverlay.classList.remove('effect-outline', 'effect-shadow', 'effect-glow', 'effect-none');
    elements.titleOverlay.classList.add(`effect-${project.title.effect || 'outline'}`);
    elements.titleOverlay.classList.toggle('align-left', project.title.align === 'left');
    elements.titleOverlay.classList.toggle('align-right', project.title.align === 'right');

    const rank = selectedIndex() + 1;
    const rowHeightPercent = Math.min(6.2, 34 / Math.max(1, project.clips.length));
    const maxTop = Math.max(22, 91 - project.clips.length * rowHeightPercent);
    elements.countdownOverlay.style.top = `${Math.min(clip.list.y, maxTop)}%`;
    elements.countdownOverlay.style.fontSize = `${Math.max(9, elements.phoneStage.clientWidth * Math.min(clip.list.size, 760 / Math.max(1, project.clips.length)) / 1080)}px`;
    elements.countdownOverlay.innerHTML = project.clips.map((item, index) => {
      const active = index === rank - 1;
      const opacity = item.list.background / 100;
      return `<div class="countdown-row ${active ? 'active' : ''}" style="--rank-color:${escapeHtml(item.list.badgeColor)};--label-bg:rgba(9,11,18,${opacity})">
        <span class="countdown-number">${index + 1}.</span>
        <span class="countdown-label effect-${escapeHtml(item.list.effect || 'outline')}">${active ? tokenMarkup(item.list.tokens) : ''}</span>
      </div>`;
    }).join('');
    elements.durationTime.textContent = formatTime(clipDuration(clip), true);
    updateTransport();
  }

  function renderTextInspector() {
    elements.titleEnabled.checked = project.title.enabled !== false;
    elements.titleInput.value = project.title.text;
    elements.titleSize.value = project.title.size;
    elements.titleSizeValue.textContent = project.title.size;
    elements.titleY.value = project.title.y;
    elements.titleYValue.textContent = `${project.title.y}%`;
    elements.titleBackground.value = project.title.background;
    elements.titleBackgroundValue.textContent = `${project.title.background}%`;
    renderTokenField(elements.titleTokens, project.title.tokens, titleSelection, 'title');
    $$('.segmented [data-align]').forEach((button) => button.classList.toggle('active', button.dataset.align === project.title.align));
    $$('[data-effect-target="title"] [data-effect]').forEach((button) => button.classList.toggle('active', button.dataset.effect === project.title.effect));

    const clip = selectedClip();
    elements.noClipEditor.hidden = Boolean(clip);
    elements.listEditor.hidden = !clip;
    elements.editingRank.textContent = clip ? `Rank ${String(selectedIndex() + 1).padStart(2, '0')}` : 'No clip';
    if (!clip) return;
    elements.listInput.value = clip.list.text;
    renderTokenField(elements.listTokens, clip.list.tokens, listSelection, 'list');
    elements.listSize.value = clip.list.size;
    elements.listSizeValue.textContent = clip.list.size;
    elements.listY.value = clip.list.y;
    elements.listYValue.textContent = `${clip.list.y}%`;
    elements.listBackground.value = clip.list.background;
    elements.listBackgroundValue.textContent = `${clip.list.background}%`;
    elements.badgeColor.value = clip.list.badgeColor;
    $$('[data-effect-target="list"] [data-effect]').forEach((button) => button.classList.toggle('active', button.dataset.effect === clip.list.effect));
  }

  function renderClipInspector() {
    const clip = selectedClip();
    elements.clipPanelEmpty.hidden = Boolean(clip);
    elements.clipControls.hidden = !clip;
    if (!clip) return;
    elements.clipName.value = clip.name;
    elements.clipSource.textContent = clip.source || 'Video';
    elements.clipDimensions.textContent = clip.width && clip.height ? `${clip.width} × ${clip.height}` : 'Unknown';
    elements.clipOriginalDuration.textContent = formatTime(clip.duration, true);
    elements.trimStart.value = Number(clip.trimStart).toFixed(1);
    elements.trimStart.max = Math.max(0, clip.trimEnd - .1).toFixed(1);
    elements.trimEnd.value = Number(clip.trimEnd).toFixed(1);
    elements.trimEnd.max = Number(clip.duration).toFixed(1);
    elements.clipMuted.checked = clip.muted;
    elements.clipVolume.value = Math.round(clip.volume * 100);
    elements.volumeValue.textContent = `${Math.round(clip.volume * 100)}%`;
    $$('.choice-cards [data-fit]').forEach((button) => button.classList.toggle('active', button.dataset.fit === clip.fit));
  }

  function renderOutputInspector() {
    elements.qualitySelect.value = String(project.export.crf);
    elements.speedSelect.value = project.export.preset;
  }

  function renderAll() {
    elements.projectName.value = project.name;
    renderClipList();
    renderTimeline();
    renderPreview();
    renderTextInspector();
    renderClipInspector();
    renderOutputInspector();
    updateHistoryButtons();
  }

  function updateTransport() {
    const clip = selectedClip();
    if…1216 tokens truncated…(project.clips.length < 2) {
      toast('Add at least two videos to shuffle.', 'warning');
      return;
    }
    mutate((draft) => {
      const before = draft.clips.map((clip) => clip.id).join('|');
      for (let i = draft.clips.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [draft.clips[i], draft.clips[j]] = [draft.clips[j], draft.clips[i]];
      }
      if (draft.clips.map((clip) => clip.id).join('|') === before) {
        draft.clips.push(draft.clips.shift());
      }
    });
    toast('Ranking shuffled. Undo is available.');
  }

  function moveClip(id, targetId) {
    if (!id || !targetId || id === targetId) return;
    mutate((draft) => {
      const from = draft.clips.findIndex((clip) => clip.id === id);
      const to = draft.clips.findIndex((clip) => clip.id === targetId);
      if (from < 0 || to < 0) return;
      const [item] = draft.clips.splice(from, 1);
      draft.clips.splice(to, 0, item);
    });
  }

  function moveDown(id) {
    const index = project.clips.findIndex((clip) => clip.id === id);
    if (index < 0 || project.clips.length < 2) return;
    mutate((draft) => {
      const next = (index + 1) % draft.clips.length;
      [draft.clips[index], draft.clips[next]] = [draft.clips[next], draft.clips[index]];
    });
  }

  function openExportDialog() {
    if (!project.clips.length) {
      toast('Add at least one video before exporting.', 'warning');
      return;
    }
    const missing = project.clips.find((clip) => !clip.file);
    if (missing) {
      toast(`“${missing.name}” is missing its local media file.`, 'error');
      return;
    }
    elements.exportConfirm.hidden = false;
    elements.exportRunning.hidden = true;
    elements.exportComplete.hidden = true;
    const duration = project.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
    elements.exportSummary.textContent = `${project.clips.length} video${project.clips.length === 1 ? '' : 's'} · ${formatTime(duration, true)} total. Titles, word colors, rank badges, and list text will be burned into the MP4.`;
    elements.exportPreviewStrip.innerHTML = project.clips.slice(0, 7).map((clip, index) => `
      <span class="export-preview-card" style="--offset:${Math.abs(index - Math.min(3, project.clips.length / 2)) * 3}px;--rotate:${(index - 3) * 2}deg">${clip.poster ? `<img src="${escapeHtml(clip.poster)}" alt="" />` : ''}<span>${String(index + 1).padStart(2, '0')}</span></span>
    `).join('');
    elements.exportDialog.showModal();
  }

  async function startRender() {
    elements.exportConfirm.hidden = true;
    elements.exportRunning.hidden = false;
    elements.exportComplete.hidden = true;
    elements.renderPercent.textContent = '0%';
    elements.renderProgress.style.width = '0%';
    elements.renderMessage.textContent = 'Preparing media';
    elements.renderTitle.textContent = 'Building your video…';
    try {
      await saveProject();
      const data = await api('/api/export', { method: 'POST', body: { project } });
      clearInterval(renderPoll);
      renderPoll = setInterval(() => pollRender(data.jobId), 900);
      pollRender(data.jobId);
    } catch (error) {
      showRenderError(error.message);
    }
  }

  async function pollRender(jobId) {
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      const job = data.job;
      elements.renderPercent.textContent = `${job.progress || 0}%`;
      elements.renderProgress.style.width = `${job.progress || 0}%`;
      elements.renderMessage.textContent = job.message || 'Rendering';
      if (job.status === 'complete') {
        clearInterval(renderPoll);
        showRenderComplete(job.output);
      } else if (job.status === 'error') {
        clearInterval(renderPoll);
        showRenderError(job.error || job.message);
      }
    } catch (error) {
      clearInterval(renderPoll);
      showRenderError(error.message);
    }
  }

  function showRenderError(message) {
    elements.renderTitle.textContent = 'Export stopped';
    elements.renderMessage.textContent = message;
    elements.renderPercent.textContent = '—';
    elements.renderProgress.style.width = '0%';
    toast(`Export failed: ${message}`, 'error', 6000);
  }

  function showRenderComplete(output) {
    elements.exportRunning.hidden = true;
    elements.exportComplete.hidden = false;
    elements.downloadExport.href = output.url;
    elements.downloadExport.download = output.name;
    elements.exportResultVideo.src = output.url;
    loadRecentExports();
  }

  async function loadRecentExports() {
    try {
      const data = await api('/api/exports');
      if (!data.exports.length) {
        elements.recentExports.innerHTML = '<span class="muted-copy">No exports yet.</span>';
        return;
      }
      elements.recentExports.innerHTML = data.exports.map((item) => `
        <div class="export-item"><svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14h16V9l-6-6Zm0 0v6h6M9 14l2 2 4-4"/></svg><div><strong>${escapeHtml(item.name)}</strong><small>${formatBytes(item.size)}</small></div><a href="${escapeHtml(item.url)}" download="${escapeHtml(item.name)}">Save</a></div>
      `).join('');
    } catch {
      elements.recentExports.innerHTML = '<span class="muted-copy">Could not load exports.</span>';
    }
  }

  function bindEvents() {
    elements.projectName.addEventListener('change', () => mutate((draft) => { draft.name = elements.projectName.value.trim() || 'Untitled ranking'; }));
    elements.projectName.addEventListener('input', () => { project.name = elements.projectName.value; scheduleSave(); });
    elements.importButton.addEventListener('click', importLinks);
    elements.urlInput.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') importLinks(); });
    elements.fileInput.addEventListener('change', () => uploadFiles(elements.fileInput.files));
    elements.shuffleButton.addEventListener('click', shuffleRanking);
    elements.exportButton.addEventListener('click', openExportDialog);
    elements.exportSideButton.addEventListener('click', openExportDialog);
    elements.startRender.addEventListener('click', startRender);
    elements.closeExport.addEventListener('click', () => elements.exportDialog.close());
    elements.helpButton.addEventListener('click', () => elements.helpDialog.showModal());
    elements.refreshExports.addEventListener('click', loadRecentExports);

    elements.clipList.addEventListener('click', (event) => {
      const move = event.target.closest('[data-move-down]');
      if (move) { event.stopPropagation(); moveDown(move.dataset.moveDown); return; }
      const card = event.target.closest('[data-clip-id]');
      if (card) selectClip(card.dataset.clipId);
    });
    elements.clipList.addEventListener('keydown', (event) => {
      const card = event.target.closest('[data-clip-id]');
      if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectClip(card.dataset.clipId); }
    });
    elements.clipList.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-clip-id]');
      if (!card) return;
      dragId = card.dataset.clipId;
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });
    elements.clipList.addEventListener('dragover', (event) => {
      const card = event.target.closest('[data-clip-id]');
      if (!card || card.dataset.clipId === dragId) return;
      event.preventDefault();
      $$('.drag-over', elements.clipList).forEach((item) => item.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    elements.clipList.addEventListener('drop', (event) => {
      const card = event.target.closest('[data-clip-id]');
      event.preventDefault();
      if (card) moveClip(dragId, card.dataset.clipId);
    });
    elements.clipList.addEventListener('dragend', () => { dragId = null; $$('.clip-card', elements.clipList).forEach((item) => item.classList.remove('dragging', 'drag-over')); });
    elements.timelineTrack.addEventListener('click', (event) => {
      const clip = event.target.closest('[data-timeline-id]');
      if (clip) selectClip(clip.dataset.timelineId);
    });

    elements.titleInput.addEventListener('focus', pushHistory);
    elements.listInput.addEventListener('focus', pushHistory);
    elements.titleInput.addEventListener('input', () => updateClipText('title', elements.titleInput.value));
    elements.listInput.addEventListener('input', () => updateClipText('list', elements.listInput.value));
    elements.titleTokens.addEventListener('click', tokenClick);
    elements.listTokens.addEventListener('click', tokenClick);
    elements.titlePalette.addEventListener('click', paletteClick);
    elements.listPalette.addEventListener('click', paletteClick);
    elements.titleCustomColor.addEventListener('input', () => applyTokenColor('title', elements.titleCustomColor.value));
    elements.listCustomColor.addEventListener('input', () => applyTokenColor('list', elements.listCustomColor.value));
    document.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'select-all-title') { titleSelection = new Set(project.title.tokens.map((_, i) => i)); renderTextInspector(); }
      if (action === 'select-all-list') { const clip = selectedClip(); listSelection = new Set((clip?.list.tokens || []).map((_, i) => i)); renderTextInspector(); }
    });
    elements.titleEnabled.addEventListener('change', () => mutate((draft) => { draft.title.enabled = elements.titleEnabled.checked; }));
    elements.titleSize.addEventListener('input', () => rangeUpdate('title', 'size', elements.titleSize.value));
    elements.titleY.addEventListener('input', () => rangeUpdate('title', 'y', elements.titleY.value));
    elements.titleBackground.addEventListener('input', () => rangeUpdate('title', 'background', elements.titleBackground.value));
    elements.listSize.addEventListener('input', () => rangeUpdate('list', 'size', elements.listSize.value));
    elements.listY.addEventListener('input', () => rangeUpdate('list', 'y', elements.listY.value));
    elements.listBackground.addEventListener('input', () => rangeUpdate('list', 'background', elements.listBackground.value));
    elements.badgeColor.addEventListener('input', () => { const clip = selectedClip(); if (clip) { clip.list.badgeColor = elements.badgeColor.value; scheduleSave(); renderPreview(); } });
    $$('.effect-picker [data-effect]').forEach((button) => button.addEventListener('click', () => {
      const target = button.closest('[data-effect-target]').dataset.effectTarget;
      mutate((draft) => {
        if (target === 'title') draft.title.effect = button.dataset.effect;
        else {
          const clip = selectedClip();
          if (clip) clip.list.effect = button.dataset.effect;
        }
      });
    }));
    $$('.emoji-strip button').forEach((button) => button.addEventListener('click', () => {
      const target = button.closest('[data-emoji-target]').dataset.emojiTarget;
      const input = target === 'title' ? elements.titleInput : elements.listInput;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const spacer = start > 0 && !/\s/.test(input.value[start - 1]) ? ' ' : '';
      const suffix = end < input.value.length && !/\s/.test(input.value[end]) ? ' ' : '';
      input.value = `${input.value.slice(0, start)}${spacer}${button.textContent}${suffix}${input.value.slice(end)}`;
      const caret = start + spacer.length + button.textContent.length + suffix.length;
      input.setSelectionRange(caret, caret);
      updateClipText(target, input.value);
      input.focus();
    }));
    $$('.segmented [data-align]').forEach((button) => button.addEventListener('click', () => mutate((draft) => { draft.title.align = button.dataset.align; })));

    elements.previewVideo.addEventListener('loadedmetadata', () => {
      const clip = selectedClip();
      if (!clip) return;
      if (!Number(clip.duration) && Number.isFinite(elements.previewVideo.duration)) clip.duration = elements.previewVideo.duration;
      elements.previewVideo.currentTime = clip.trimStart;
      updateTransport();
    });
    elements.previewVideo.addEventListener('timeupdate', () => {
      const clip = selectedClip();
      if (!clip) return;
      if (elements.previewVideo.currentTime >= clip.trimEnd - .025) {
        elements.previewVideo.pause();
        elements.playButton.classList.remove('playing');
        if (selectedIndex() < project.clips.length - 1) stepClip(1, true);
        else elements.previewVideo.currentTime = clip.trimStart;
      }
      updateTransport();
    });
    elements.previewVideo.addEventListener('play', () => elements.playButton.classList.add('playing'));
    elements.previewVideo.addEventListener('pause', () => elements.playButton.classList.remove('playing'));
    elements.playButton.addEventListener('click', togglePlayback);
    elements.skipBack.addEventListener('click', () => stepClip(-1));
    elements.skipForward.addEventListener('click', () => stepClip(1));
    elements.scrubber.addEventListener('input', () => { const clip = selectedClip(); if (clip) elements.previewVideo.currentTime = clip.trimStart + Number(elements.scrubber.value); });
    elements.mutePreview.addEventListener('click', () => { elements.previewVideo.muted = !elements.previewVideo.muted; elements.mutePreview.classList.toggle('is-muted', elements.previewVideo.muted); });
    elements.fitButton.addEventListener('click', () => { const clip = selectedClip(); if (clip) mutate(() => { clip.fit = clip.fit === 'cover' ? 'contain' : 'cover'; }); });

    elements.clipName.addEventListener('change', () => { const clip = selectedClip(); if (clip) mutate(() => { clip.name = elements.clipName.value.trim() || 'Untitled video'; }); });
    elements.trimStart.addEventListener('change', () => updateTrim());
    elements.trimEnd.addEventListener('change', () => updateTrim());
    elements.clipMuted.addEventListener('change', () => { const clip = selectedClip(); if (clip) mutate(() => { clip.muted = elements.clipMuted.checked; }); });
    elements.clipVolume.addEventListener('input', () => { const clip = selectedClip(); if (clip) { clip.volume = Number(elements.clipVolume.value) / 100; elements.volumeValue.textContent = `${elements.clipVolume.value}%`; scheduleSave(); elements.previewVideo.volume = Math.min(1, clip.volume); } });
    $$('.choice-cards [data-fit]').forEach((button) => button.addEventListener('click', () => { const clip = selectedClip(); if (clip) mutate(() => { clip.fit = button.dataset.fit; }); }));
    elements.deleteClip.addEventListener('click', deleteSelectedClip);
    elements.qualitySelect.addEventListener('change', () => mutate((draft) => { draft.export.crf = Number(elements.qualitySelect.value); }, { render: false }));
    elements.speedSelect.addEventListener('change', () => mutate((draft) => { draft.export.preset = elements.speedSelect.value; }, { render: false }));
    elements.undoButton.addEventListener('click', () => restoreFrom(undoStack, redoStack));
    elements.redoButton.addEventListener('click', () => restoreFrom(redoStack, undoStack));
    $$('.inspector-tabs [data-tab]').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));

    window.addEventListener('resize', renderPreview);
    document.addEventListener('keydown', keyboardShortcuts);
  }

  function tokenClick(event) {
    const button = event.target.closest('[data-token-index]');
    if (!button) return;
    const target = button.dataset.tokenTarget;
    const index = Number(button.dataset.tokenIndex);
    const set = target === 'title' ? titleSelection : listSelection;
    if (set.has(index)) set.delete(index); else set.add(index);
    renderTextInspector();
  }

  function paletteClick(event) {
    const button = event.target.closest('[data-color]');
    if (button) applyTokenColor(button.dataset.target, button.dataset.color);
  }

  function rangeUpdate(target, property, value) {
    const numeric = Number(value);
    if (target === 'title') project.title[property] = numeric;
    else { const clip = selectedClip(); if (!clip) return; clip.list[property] = numeric; }
    project.updatedAt = new Date().toISOString();
    scheduleSave();
    renderPreview();
    const output = target === 'title'
      ? property === 'size' ? elements.titleSizeValue : property === 'y' ? elements.titleYValue : elements.titleBackgroundValue
      : property === 'size' ? elements.listSizeValue : property === 'y' ? elements.listYValue : elements.listBackgroundValue;
    output.textContent = property === 'size' ? numeric : `${numeric}%`;
  }

  function updateTrim() {
    const clip = selectedClip();
    if (!clip) return;
    const start = clamp(elements.trimStart.value, 0, clip.duration - .1);
    const end = clamp(elements.trimEnd.value, start + .1, clip.duration);
    mutate(() => { clip.trimStart = start; clip.trimEnd = end; });
    elements.previewVideo.currentTime = start;
  }

  function deleteSelectedClip() {
    const clip = selectedClip();
    if (!clip) return;
    const name = clip.name;
    mutate((draft) => {
      const index = selectedIndex();
      draft.clips.splice(index, 1);
      draft.selectedId = draft.clips[Math.min(index, draft.clips.length - 1)]?.id || null;
    });
    toast(`“${name}” removed from this project.`);
  }

  function togglePlayback() {
    const clip = selectedClip();
    if (!clip) return;
    if (elements.previewVideo.paused) {
      if (elements.previewVideo.currentTime < clip.trimStart || elements.previewVideo.currentTime >= clip.trimEnd) elements.previewVideo.currentTime = clip.trimStart;
      elements.previewVideo.play().catch(() => toast('The browser could not play this video format.', 'error'));
    } else elements.previewVideo.pause();
  }

  function selectTab(tab) {
    $$('.inspector-tabs [data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.inspector-panel[data-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
  }

  function keyboardShortcuts(event) {
    if (event.target.matches('input, textarea, select') || elements.exportDialog.open || elements.helpDialog.open) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); stepClip(-1); }
    if (event.key === 'ArrowDown') { event.preventDefault(); stepClip(1); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) restoreFrom(redoStack, undoStack); else restoreFrom(undoStack, redoStack);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); toast('Project saved locally.'); }
  }

  async function init() {
    renderPalette(elements.titlePalette, 'title');
    renderPalette(elements.listPalette, 'list');
    bindEvents();
    try {
      const [saved, health] = await Promise.all([api('/api/project'), api('/api/health')]);
      if (saved.project) project = normalizeProject(saved.project);
      const ready = health.tools?.ytdlp && health.tools?.ffmpeg && health.tools?.ffprobe;
      elements.toolStatus.className = `tool-status ${ready ? 'ready' : 'error'}`;
      elements.toolStatus.textContent = ready ? 'Media engine ready' : 'Run setup.ps1';
      elements.toolStatus.title = ready ? 'yt-dlp and FFmpeg are ready' : 'Media tools are missing. Run setup.ps1.';
    } catch (error) {
      elements.toolStatus.className = 'tool-status error';
      elements.toolStatus.textContent = 'Server issue';
      toast(error.message, 'error');
    }
    renderAll();
    loadRecentExports();
  }

  init();
})();
