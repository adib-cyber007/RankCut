(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#memeCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const status = $('#status');
  const empty = $('#canvasEmpty');
  const defaultLayer = (type = 'text') => ({
    id: `layer_${Date.now()}_${Math.random().toString(16).slice(2)}`, type, text: type === 'sticker' ? '🔥' : type === 'bubble' ? 'Say what?' : 'YOUR TEXT',
    x: 90, y: 90, w: 900, h: type === 'sticker' ? 180 : 230, font: type === 'text' ? 'Impact' : 'Arial Black', size: type === 'sticker' ? 130 : 82,
    fill: type === 'bubble' ? '#111111' : '#ffffff', stroke: type === 'text' ? 8 : 0, shadow: type === 'text', background: false, autoShrink: true,
  });
  const baseProject = () => ({ version: 1, aspect: '1:1', image: null, layers: [], filter: 'none', distortion: 'none', layout: 'single' });
  let project = baseProject();
  let sourceImage = null;
  let selectedId = null;
  let activeTool = 'select';
  let drag = null;
  let saveTimer = null;
  let searchTimer = null;
  let searchGeneration = 0;
  let searchSource = 'templates';
  const stickerImages = new Map();

  function setStatus(message, kind = '') { status.textContent = message; status.dataset.kind = kind; }
  function selected() { return project.layers.find((layer) => layer.id === selectedId) || null; }
  function aspectSize(value) { return value === '9:16' ? [1080, 1920] : value === '16:9' ? [1920, 1080] : [1080, 1080]; }
  function resizeCanvas() { const [w, h] = aspectSize(project.aspect); canvas.width = w; canvas.height = h; render(); }
  function roundedRect(context, x, y, w, h, r) { const radius = Math.min(r, w / 2, h / 2); context.beginPath(); context.roundRect(x, y, w, h, radius); }

  function drawImageCover(image, x, y, w, h) {
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const boxRatio = w / h;
    let sw = image.naturalWidth, sh = image.naturalHeight, sx = 0, sy = 0;
    if (imageRatio > boxRatio) { sw = image.naturalHeight * boxRatio; sx = (image.naturalWidth - sw) / 2; }
    else { sh = image.naturalWidth / boxRatio; sy = (image.naturalHeight - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function drawSource(impact = 0) {
    ctx.fillStyle = '#11131a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!sourceImage) return;
    ctx.save();
    const filterMap = { 'deep-fry': 'saturate(2.8) contrast(1.8) brightness(1.08)', mono: 'grayscale(1) contrast(1.75)', vintage: 'sepia(.45) saturate(1.5) contrast(1.25)' };
    ctx.filter = filterMap[project.filter] || 'none';
    const stretch = project.distortion === 'stretch' ? 1.16 : project.distortion === 'squish' ? .82 : 1;
    const shakeX = impact ? Math.sin(impact * Math.PI * 4) * 18 : 0;
    const shakeY = impact ? Math.cos(impact * Math.PI * 6) * 12 : 0;
    const zoom = impact ? 1 + Math.sin(impact * Math.PI) * .12 : 1;
    ctx.translate(canvas.width / 2 + shakeX, canvas.height / 2 + shakeY); ctx.scale(stretch * zoom, zoom); ctx.translate(-canvas.width / 2, -canvas.height / 2);
    if (project.layout === 'quad') {
      const gap = 12, pw = canvas.width / 2 - gap / 2, ph = canvas.height / 2 - gap / 2;
      [[0,0],[pw+gap,0],[0,ph+gap],[pw+gap,ph+gap]].forEach(([x,y]) => drawImageCover(sourceImage,x,y,pw,ph));
    } else if (project.layout === 'comparison') {
      const gap = 12, pw = canvas.width / 2 - gap / 2;
      drawImageCover(sourceImage, 0, 0, pw, canvas.height); drawImageCover(sourceImage, pw + gap, 0, pw, canvas.height);
    } else drawImageCover(sourceImage, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (project.filter === 'deep-fry') {
      ctx.save(); ctx.globalAlpha = .16;
      for (let i = 0; i < 420; i += 1) { const n = (i * 9301 + 49297) % 233280; ctx.fillStyle = i % 2 ? '#ff4218' : '#fff36a'; ctx.fillRect((n / 233280) * canvas.width, ((n * 17) % 233280 / 233280) * canvas.height, 2 + (i % 4), 2 + (i % 3)); }
      ctx.restore();
    }
  }

  function wrapLines(layer, fontSize) {
    ctx.font = `900 ${fontSize}px ${layer.font || 'Impact'}`;
    const max = Math.max(40, layer.w - 28);
    const output = [];
    String(layer.text || '').split('\n').forEach((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean); let line = '';
      if (!words.length) output.push('');
      words.forEach((word) => { const next = line ? `${line} ${word}` : word; if (line && ctx.measureText(next).width > max) { output.push(line); line = word; } else line = next; });
      if (line) output.push(line);
    });
    return output;
  }

  function fittedText(layer) {
    let size = Number(layer.size) || 76; let lines = wrapLines(layer, size);
    if (layer.autoShrink) while (size > 18 && (lines.length * size * 1.08 > layer.h - 20 || Math.max(0, ...lines.map((line) => ctx.measureText(line).width)) > layer.w - 24)) { size -= 2; lines = wrapLines(layer, size); }
    return { size, lines, lineHeight: size * 1.08 };
  }

  function stickerImage(url) {
    if (!stickerImages.has(url)) {
      const image = new Image();
      image.onload = render;
      image.onerror = () => setStatus('A bundled sticker could not be loaded.', 'error');
      image.src = url;
      stickerImages.set(url, image);
    }
    return stickerImages.get(url);
  }

  function drawLayer(layer) {
    ctx.save();
    if (layer.type === 'image-sticker') {
      const image = stickerImage(layer.imageUrl);
      if (image?.complete && image.naturalWidth) ctx.drawImage(image, layer.x, layer.y, layer.w, layer.h);
      ctx.restore();
      return;
    }
    if (layer.type === 'bubble') {
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111111'; ctx.lineWidth = 6; roundedRect(ctx, layer.x, layer.y, layer.w, layer.h - 34, 44); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(layer.x + layer.w * .25, layer.y + layer.h - 38); ctx.lineTo(layer.x + layer.w * .18, layer.y + layer.h); ctx.lineTo(layer.x + layer.w * .4, layer.y + layer.h - 38); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (layer.background) { ctx.fillStyle = 'rgba(0,0,0,.72)'; roundedRect(ctx, layer.x - 10, layer.y - 8, layer.w + 20, layer.h + 16, 18); ctx.fill(); }
    const fit = fittedText(layer); ctx.font = `900 ${fit.size}px ${layer.font || 'Impact'}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (layer.shadow) { ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 7; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 7; }
    const centerY = layer.y + layer.h / 2 - (fit.lines.length - 1) * fit.lineHeight / 2;
    fit.lines.forEach((line, index) => { const x = layer.x + layer.w / 2, y = centerY + index * fit.lineHeight; if (Number(layer.stroke) > 0) { ctx.strokeStyle = '#000000'; ctx.lineWidth = Number(layer.stroke) * 2; ctx.strokeText(line, x, y, layer.w - 18); } ctx.fillStyle = layer.fill || '#ffffff'; ctx.fillText(line, x, y, layer.w - 18); });
    ctx.restore();
  }

  function render(showGuides = true, impact = 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height); drawSource(impact); project.layers.forEach(drawLayer);
    const layer = selected();
    if (showGuides && layer) { ctx.save(); ctx.setLineDash([12, 9]); ctx.strokeStyle = '#d5ff54'; ctx.lineWidth = 3; ctx.strokeRect(layer.x, layer.y, layer.w, layer.h); ctx.setLineDash([]); ctx.fillStyle = '#d5ff54'; ctx.fillRect(layer.x + layer.w - 16, layer.y + layer.h - 16, 32, 32); ctx.restore(); }
  }

  function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveProject, 550); }
  async function saveProject() { try { const response = await fetch('/api/meme/project', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ project }) }); if (!response.ok) throw new Error((await response.json()).error); setStatus('Project saved locally.'); } catch (error) { setStatus(error.message || 'Project could not be saved.', 'error'); } }

  function loadImage(asset) {
    project.image = asset;
    if (!asset?.url) { sourceImage = null; empty.classList.remove('hidden'); render(); return; }
    const image = new Image(); image.onload = () => { sourceImage = image; empty.classList.add('hidden'); render(); queueSave(); }; image.onerror = () => setStatus('The selected image could not be opened.', 'error'); image.src = asset.url;
  }

  function syncInspector() {
    const layer = selected(); const controls = ['layerText','fontSelect','fontSize','fillColor','strokeWidth','shadowToggle','backgroundToggle','autoShrinkToggle'];
    controls.forEach((id) => { $(`#${id}`).disabled = !layer || layer.type === 'image-sticker'; });
    if (!layer) return;
    $('#layerText').value = layer.text || ''; $('#fontSelect').value = layer.font || 'Impact'; $('#fontSize').value = layer.size || 76; $('#fillColor').value = layer.fill || '#ffffff'; $('#strokeWidth').value = layer.stroke || 0; $('#shadowToggle').checked = Boolean(layer.shadow); $('#backgroundToggle').checked = Boolean(layer.background); $('#autoShrinkToggle').checked = layer.autoShrink !== false;
  }

  function selectLayer(id) { selectedId = id; syncInspector(); render(); }
  function addLayer(type, x = 90, y = 90) { const layer = defaultLayer(type); layer.x = Math.max(10, Math.min(canvas.width - layer.w - 10, x)); layer.y = Math.max(10, Math.min(canvas.height - layer.h - 10, y)); project.layers.push(layer); selectLayer(layer.id); queueSave(); }
  function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x:(event.clientX - rect.left) * canvas.width / rect.width, y:(event.clientY - rect.top) * canvas.height / rect.height }; }
  function hitLayer(point) { return [...project.layers].reverse().find((layer) => point.x >= layer.x && point.x <= layer.x + layer.w && point.y >= layer.y && point.y <= layer.y + layer.h); }

  canvas.addEventListener('pointerdown', (event) => {
    const point = canvasPoint(event);
    if (activeTool !== 'select') { addLayer(activeTool, point.x - 240, point.y - 90); setTool('select'); return; }
    const current = selected(); const resizing = current && Math.abs(point.x - (current.x + current.w)) < 38 && Math.abs(point.y - (current.y + current.h)) < 38;
    const layer = resizing ? current : hitLayer(point); if (!layer) { selectLayer(null); return; }
    selectLayer(layer.id); drag = { mode:resizing ? 'resize' : 'move', start:point, initial:{ x:layer.x, y:layer.y, w:layer.w, h:layer.h } }; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => { if (!drag) return; const layer = selected(); if (!layer) return; const point = canvasPoint(event), dx = point.x - drag.start.x, dy = point.y - drag.start.y; if (drag.mode === 'resize') { layer.w = Math.max(120, drag.initial.w + dx); layer.h = Math.max(80, drag.initial.h + dy); } else { layer.x = Math.max(-layer.w + 50, Math.min(canvas.width - 50, drag.initial.x + dx)); layer.y = Math.max(-layer.h + 50, Math.min(canvas.height - 50, drag.initial.y + dy)); } render(); });
  canvas.addEventListener('pointerup', () => { if (drag) { drag = null; queueSave(); } });

  function setTool(tool) { activeTool = tool; document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool)); }
  document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
  function updateSourceTabs(activeButton) { document.querySelectorAll('.tabs button').forEach((item) => { const active = item === activeButton; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); }); if (activeButton) $('#searchInput').placeholder = `Search ${activeButton.textContent.toLowerCase()}`; }
  function searchNow() { clearTimeout(searchTimer); searchMemes(); }
  document.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => { if (button.disabled) return; searchSource = button.dataset.source; updateSourceTabs(button); searchNow(); }));

  function renderSearchSkeletons() {
    const grid = $('#resultGrid'); grid.replaceChildren();
    for (let index = 0; index < 8; index += 1) { const tile = document.createElement('div'); tile.className = 'result skeleton'; tile.setAttribute('aria-hidden', 'true'); tile.append(document.createElement('span')); grid.append(tile); }
  }

  async function loadIntegrations() {
    try {
      const response = await fetch('/api/meme/integrations'); const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const summaries = [];
      document.querySelectorAll('.tabs button').forEach((button) => { const integration = data.integrations?.[button.dataset.source]; button.disabled = integration?.enabled === false; button.setAttribute('aria-disabled', String(button.disabled)); button.title = integration?.message || `${integration?.provider || 'Meme'} search`; summaries.push(`${integration?.provider || button.textContent}: ${integration?.enabled ? 'active' : integration?.message || 'off'}`); });
      $('#integrationNote').textContent = summaries.join(' · ');
      const current = document.querySelector(`.tabs button[data-source="${searchSource}"]`);
      if (current?.disabled) { const fallback = document.querySelector('.tabs button:not(:disabled)'); if (fallback) { searchSource = fallback.dataset.source; updateSourceTabs(fallback); } else { updateSourceTabs(null); $('#resultNote').textContent = current.title; } }
    } catch (error) { $('#integrationNote').textContent = error.message || 'Search integrations could not be checked.'; }
  }

  async function searchMemes() {
    const generation = ++searchGeneration; const grid = $('#resultGrid'); renderSearchSkeletons(); $('#resultNote').textContent = 'Searching…';
    try { const response = await fetch(`/api/meme/search?source=${encodeURIComponent(searchSource)}&q=${encodeURIComponent($('#searchInput').value)}`); const data = await response.json(); if (generation !== searchGeneration) return; if (!response.ok || !data.ok) throw new Error(data.error || 'Search failed.'); const items = data.items || []; grid.replaceChildren(); $('#resultNote').textContent = data.message || data.error || `${items.length} results · click one to use it`; items.forEach((item) => { const button = document.createElement('button'); button.className = 'result'; const image = document.createElement('img'); image.loading = 'lazy'; image.src = item.url; image.alt = ''; const label = document.createElement('span'); label.textContent = item.name; button.append(image,label); button.addEventListener('click', () => importRemote(item)); grid.append(button); }); if (!items.length && !data.message) $('#resultNote').textContent = 'No results. Try a broader phrase.'; } catch (error) { if (generation !== searchGeneration) return; grid.replaceChildren(); $('#resultNote').textContent = error.message; }
  }
  async function importRemote(item) { setStatus(`Importing ${item.name || 'image'}…`); try { const response = await fetch('/api/meme/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url:item.url }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); loadImage(data.asset); setStatus('Template ready. Add the punchline.'); } catch (error) { setStatus(error.message || 'Template import failed.', 'error'); } }
  $('#searchButton').addEventListener('click', searchNow); $('#searchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') searchNow(); }); $('#searchInput').addEventListener('input', () => { searchGeneration += 1; clearTimeout(searchTimer); searchTimer = setTimeout(searchMemes, 320); });
  $('#importUrlButton').addEventListener('click', async () => { const url = $('#imageUrlInput').value.trim(); if (!url) return setStatus('Paste a public image URL first.', 'error'); setStatus('Importing image URL…'); $('#importUrlButton').disabled = true; try { const response = await fetch('/api/meme/import', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url, manual:true }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); loadImage(data.asset); $('#imageUrlInput').value = ''; setStatus('Image URL imported.'); } catch (error) { setStatus(error.message || 'Image URL import failed.', 'error'); } finally { $('#importUrlButton').disabled = false; } });
  $('#imageUrlInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#importUrlButton').click(); });
  $('#imageUpload').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; setStatus('Copying image into this workspace…'); try { const response = await fetch(`/api/meme/upload?filename=${encodeURIComponent(file.name)}`, { method:'PUT', body:file }); const data = await response.json(); if (!response.ok) throw new Error(data.error); loadImage(data.asset); setStatus('Image ready.'); } catch (error) { setStatus(error.message || 'Upload failed.', 'error'); } event.target.value = ''; });

  $('#classicButton').addEventListener('click', () => { const top = defaultLayer('text'), bottom = defaultLayer('text'); top.text = 'WHEN YOU'; top.y = 42; bottom.text = 'FINALLY SHIP IT'; bottom.y = canvas.height - bottom.h - 42; project.layers.push(top,bottom); selectLayer(bottom.id); queueSave(); });
  document.querySelectorAll('[data-sticker]').forEach((button) => button.addEventListener('click', () => { const layer = defaultLayer('sticker'); layer.text = button.dataset.sticker; layer.x = canvas.width / 2 - layer.w / 2; layer.y = canvas.height / 2 - layer.h / 2; project.layers.push(layer); selectLayer(layer.id); queueSave(); }));
  document.querySelectorAll('[data-sticker-image]').forEach((button) => button.addEventListener('click', () => { const layer = { ...defaultLayer('sticker'), type:'image-sticker', text:'', imageUrl:button.dataset.stickerImage, w:280, h:280, x:canvas.width / 2 - 140, y:canvas.height / 2 - 140 }; project.layers.push(layer); stickerImage(layer.imageUrl); selectLayer(layer.id); queueSave(); }));
  $('#duplicateButton').addEventListener('click', () => { const layer = selected(); if (!layer) return; const copy = { ...layer, id:`layer_${Date.now()}`, x:layer.x + 28, y:layer.y + 28 }; project.layers.push(copy); selectLayer(copy.id); queueSave(); });
  $('#deleteButton').addEventListener('click', () => { if (!selectedId) return; project.layers = project.layers.filter((layer) => layer.id !== selectedId); selectedId = null; syncInspector(); render(); queueSave(); });

  const layerBindings = { layerText:['text','value'], fontSelect:['font','value'], fontSize:['size','number'], fillColor:['fill','value'], strokeWidth:['stroke','number'], shadowToggle:['shadow','checked'], backgroundToggle:['background','checked'], autoShrinkToggle:['autoShrink','checked'] };
  Object.entries(layerBindings).forEach(([id, [property, mode]]) => $(`#${id}`).addEventListener('input', (event) => { const layer = selected(); if (!layer) return; layer[property] = mode === 'checked' ? event.target.checked : mode === 'number' ? Number(event.target.value) : event.target.value; render(); queueSave(); }));
  [['filterSelect','filter'],['distortSelect','distortion'],['layoutSelect','layout']].forEach(([id,key]) => $(`#${id}`).addEventListener('change', (event) => { project[key] = event.target.value; render(); queueSave(); }));
  $('#aspectSelect').addEventListener('change', (event) => { project.aspect = event.target.value; resizeCanvas(); queueSave(); });
  $('#saveButton').addEventListener('click', saveProject);

  async function createStaticExport(label = project.aspect) { render(false); const format = $('#formatSelect').value; const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'; const dataUrl = canvas.toDataURL(mime, .92); render(true); const response = await fetch('/api/meme/export', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ dataUrl, filename:`rankcut-meme-${label.replace(':','x')}.${format}` }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.export; }
  async function exportStatic() { if (!sourceImage) return setStatus('Choose an image before exporting.', 'error'); setStatus('Saving image export…'); try { const output = await createStaticExport(); setStatus('Image export ready.'); const link = document.createElement('a'); link.href = output.url; link.download = output.name; link.click(); } catch (error) { setStatus(error.message || 'Export failed.', 'error'); } }
  $('#exportButton').addEventListener('click', exportStatic);
  $('#batchAspectButton').addEventListener('click', async () => { if (!sourceImage) return setStatus('Choose an image before exporting.', 'error'); const original = project.aspect; const links = $('#batchLinks'); links.replaceChildren(); $('#batchAspectButton').disabled = true; try { for (const aspect of ['1:1','9:16','16:9']) { project.aspect = aspect; $('#aspectSelect').value = aspect; resizeCanvas(); setStatus(`Saving ${aspect} version…`); const output = await createStaticExport(aspect); const link = document.createElement('a'); link.href = output.url; link.download = output.name; link.textContent = aspect; links.append(link); } setStatus('All three aspect ratios are ready.'); } catch (error) { setStatus(error.message || 'Batch export failed.', 'error'); } finally { project.aspect = original; $('#aspectSelect').value = original; resizeCanvas(); $('#batchAspectButton').disabled = false; } });
  $('#animateButton').addEventListener('click', async () => { if (!sourceImage) return setStatus('Choose an image before exporting.', 'error'); const frames = []; setStatus('Drawing impact frames…'); for (let index = 0; index < 14; index += 1) { render(false, index / 13); frames.push(canvas.toDataURL('image/jpeg', .76)); } render(true); try { const response = await fetch('/api/meme/export-animated', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ frames, fps:12, format:$('#animationFormat').value }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus('Animated export ready.'); const link = document.createElement('a'); link.href = data.export.url; link.download = data.export.name; link.click(); } catch (error) { setStatus(error.message || 'Animated export failed.', 'error'); } });

  async function init() { syncInspector(); document.fonts?.load('72px Bangers').then(() => render()).catch(() => {}); try { const response = await fetch('/api/meme/project'); const data = await response.json(); if (data.project) { project = { ...baseProject(), ...data.project, layers:Array.isArray(data.project.layers) ? data.project.layers : [] }; $('#aspectSelect').value = project.aspect; $('#filterSelect').value = project.filter; $('#distortSelect').value = project.distortion; $('#layoutSelect').value = project.layout; resizeCanvas(); loadImage(project.image); } else resizeCanvas(); } catch { resizeCanvas(); } await loadIntegrations(); if (!document.querySelector(`.tabs button[data-source="${searchSource}"]`)?.disabled) searchMemes(); }
  init();
})();
