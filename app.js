import { db } from './db.js';

const $ = id => document.getElementById(id);
const state = { albums: [], photos: [], currentPhoto: null, selection: null, detectedSpines: [], marking: false, dragStart: null, editingSpines: false, editingSpineIndex: null, replaceEditedSpine: false, highlightedId: null, deferredInstall: null };
const views = [...document.querySelectorAll('.view')];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindNavigation();
  bindScanning();
  bindLibrary();
  bindLocation();
  bindMore();
  bindInstall();
  $('dueInput').valueAsDate = new Date(Date.now() + 30 * 86400000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  await refresh();
}

async function refresh() {
  state.albums = (await db.albums.all()).sort((a, b) => new Date(b.AddedAt) - new Date(a.AddedAt));
  state.photos = await db.photos.all();
  renderAll();
}

function bindNavigation() {
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-go]');
    if (go) navigate(go.dataset.go);
  });
}

function navigate(name) {
  views.forEach(view => view.classList.toggle('active', view.dataset.view === name));
  document.querySelectorAll('.bottom-nav [data-go]').forEach(button => button.classList.toggle('active', button.dataset.go === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'locate') renderPhotoOptions();
  if (name === 'library') renderLibrary();
}

function bindScanning() {
  const handlePhoto = async event => {
    const file = event.target.files?.[0];
    if (file) await loadScanPhoto(file);
    event.target.value = '';
  };
  $('photoInput').addEventListener('change', handlePhoto);
  $('galleryInput').addEventListener('change', handlePhoto);
  $('ocrBtn').addEventListener('click', runOcr);
  $('smartBtn').addEventListener('click', runSmartRecognition);
  $('barcodeBtn').addEventListener('click', runBarcode);
  $('markBtn').addEventListener('click', () => {
    if (!state.currentPhoto) return toast('Prima scegli una fotografia');
    state.marking = !state.marking;
    $('scanStage').classList.toggle('marking', state.marking);
    $('markBtn').classList.toggle('active', state.marking);
    toast(state.marking ? 'Trascina un riquadro sul dorso del CD' : 'Selezione disattivata');
  });
  $('editSpinesBtn').addEventListener('click', beginSpineEditing);
  $('addSpineBtn').addEventListener('click', () => beginSpineDrawing(false));
  $('redrawSpineBtn').addEventListener('click', () => {
    if (state.editingSpineIndex === null) return toast('Prima seleziona il riquadro da ridisegnare');
    beginSpineDrawing(true);
  });
  $('deleteSpineBtn').addEventListener('click', deleteSelectedSpine);
  $('finishSpinesBtn').addEventListener('click', finishSpineEditing);
  const stage = $('scanStage');
  stage.addEventListener('pointerdown', selectionStart);
  stage.addEventListener('pointermove', selectionMove);
  stage.addEventListener('pointerup', selectionEnd);
  stage.addEventListener('pointercancel', selectionEnd);
  $('albumForm').addEventListener('submit', saveAlbum);
  $('musicSearchBtn').addEventListener('click', searchMusicBrainz);
}

async function loadScanPhoto(blob, existingPhotoId = null) {
  if (state.currentPhoto?.url) URL.revokeObjectURL(state.currentPhoto.url);
  const url = URL.createObjectURL(blob);
  state.currentPhoto = { blob, url, id: existingPhotoId };
  state.selection = null;
  state.detectedSpines = [];
  state.editingSpines = false;
  state.editingSpineIndex = null;
  $('scanImage').src = url;
  $('scanWorkspace').classList.remove('hidden');
  $('selectionBox').classList.add('hidden');
  $('spineLayer').innerHTML = '';
  $('editSpinesBtn').classList.add('hidden');
  $('editSpinesPanel').classList.add('hidden');
}

function pointPercent(event) {
  const rect = $('scanStage').getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
}

function selectionStart(event) {
  if (!state.marking) return;
  event.preventDefault();
  state.dragStart = pointPercent(event);
  $('scanStage').setPointerCapture?.(event.pointerId);
  drawSelection({ x: state.dragStart.x, y: state.dragStart.y, w: 0, h: 0 });
}

function selectionMove(event) {
  if (!state.marking || !state.dragStart) return;
  const point = pointPercent(event);
  drawSelection(rectFromPoints(state.dragStart, point));
}

function selectionEnd(event) {
  if (!state.marking || !state.dragStart) return;
  const point = pointPercent(event);
  const rect = rectFromPoints(state.dragStart, point);
  state.dragStart = null;
  if (rect.w < .01 || rect.h < .02) return toast('Riquadro troppo piccolo: riprova');
  state.selection = rect;
  if (state.editingSpines) {
    if (state.replaceEditedSpine && state.editingSpineIndex !== null) state.detectedSpines[state.editingSpineIndex] = rect;
    else { state.detectedSpines.push(rect); state.editingSpineIndex = state.detectedSpines.length - 1; }
    state.replaceEditedSpine = false;
    renderDetectedSpines();
  }
  state.marking = false;
  $('scanStage').classList.remove('marking');
  $('spineLayer').classList.remove('drawing');
  $('markBtn').classList.remove('active');
  $('markBtn').textContent = 'Posizione segnata ✓';
  drawSelection(rect);
  toast(state.editingSpines ? 'Riquadro aggiornato' : 'Posizione del CD memorizzata');
}

function beginSpineEditing() {
  if (!state.detectedSpines.length) return;
  state.editingSpines = true;
  state.editingSpineIndex = null;
  state.selection = null;
  $('selectionBox').classList.add('hidden');
  $('editSpinesBtn').classList.add('hidden');
  $('editSpinesPanel').classList.remove('hidden');
  renderDetectedSpines();
  toast('Tocca un riquadro per ridisegnarlo o eliminarlo');
}

function beginSpineDrawing(replace) {
  state.replaceEditedSpine = replace;
  state.marking = true;
  $('scanStage').classList.add('marking');
  $('spineLayer').classList.add('drawing');
  toast(replace ? 'Trascina il nuovo contorno del riquadro' : 'Trascina un riquadro sul dorso mancante');
}

function deleteSelectedSpine() {
  if (state.editingSpineIndex === null) return toast('Prima seleziona il riquadro da eliminare');
  state.detectedSpines.splice(state.editingSpineIndex, 1);
  state.editingSpineIndex = null;
  state.selection = null;
  $('selectionBox').classList.add('hidden');
  renderDetectedSpines();
  toast('Riquadro eliminato');
}

function finishSpineEditing() {
  state.editingSpines = false;
  state.editingSpineIndex = null;
  state.replaceEditedSpine = false;
  state.marking = false;
  state.selection = null;
  $('scanStage').classList.remove('marking');
  $('spineLayer').classList.remove('drawing');
  $('selectionBox').classList.add('hidden');
  $('editSpinesPanel').classList.add('hidden');
  $('editSpinesBtn').classList.toggle('hidden', !state.detectedSpines.length);
  renderDetectedSpines();
  toast(`${state.detectedSpines.length} riquadri pronti: tocca un dorso per riconoscerlo`);
}

function rectFromPoints(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
function drawSelection(rect) {
  const box = $('selectionBox');
  box.classList.remove('hidden');
  Object.assign(box.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
}

async function runSmartRecognition() {
  if (!state.currentPhoto) return toast('Prima scegli una fotografia');
  if (!window.Tesseract) return toast('Motore OCR non disponibile: controlla Internet');
  if (!state.selection) {
    setProgress(true, 'Individuazione dei dorsi sul dispositivo…');
    try {
      state.detectedSpines = await detectSpines(state.currentPhoto.blob);
      renderDetectedSpines();
      $('editSpinesBtn').classList.toggle('hidden', !state.detectedSpines.length);
      toast(`Trovati ${state.detectedSpines.length} possibili dorsi. Puoi correggere i riquadri prima del riconoscimento`);
    } catch (error) { toast(`Rilevamento non riuscito: ${error.message}`); }
    finally { setProgress(false); }
    return;
  }
  await recognizeSelectedSpine();
}

async function detectSpines(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 1200 / bitmap.width);
  const width = Math.max(80, Math.round(bitmap.width * scale));
  const height = Math.max(80, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height); bitmap.close?.();
  const pixels = context.getImageData(0, 0, width, height).data;
  const lumaAt = (x, y) => { const i = (y * width + x) * 4; return pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114; };
  const smoothValues = (values, radius) => {
    const result = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) {
      let sum = 0, count = 0;
      for (let offset = -radius; offset <= radius; offset++) if (i + offset >= 0 && i + offset < values.length) { sum += values[i + offset]; count++; }
      result[i] = sum / Math.max(1, count);
    }
    return result;
  };

  const rowScores = new Float32Array(height), xStep = Math.max(1, Math.floor(width / 700));
  for (let y = 1; y < height; y++) {
    let sum = 0, strong = 0, samples = 0;
    for (let x = 1; x < width; x += xStep) {
      const difference = Math.abs(lumaAt(x, y) - lumaAt(x, y - 1));
      sum += difference; if (difference >= 16) strong++; samples++;
    }
    rowScores[y] = sum / Math.max(1, samples) + 18 * strong / Math.max(1, samples);
  }
  const rows = smoothValues(rowScores, Math.max(1, Math.floor(height / 900)));
  const searchEnd = Math.max(3, Math.floor(height * .62));
  const upper = Array.from(rows.slice(1, searchEnd));
  const rowMean = upper.reduce((sum, value) => sum + value, 0) / upper.length;
  const rowDeviation = Math.sqrt(upper.reduce((sum, value) => sum + (value - rowMean) ** 2, 0) / upper.length);
  const rowCandidates = [];
  for (let y = 2; y < searchEnd - 1; y++) if (rows[y] >= rowMean + rowDeviation * .9 && rows[y] >= rows[y - 1] && rows[y] >= rows[y + 1]) rowCandidates.push(y);
  const rowPeaks = [];
  const rowGap = Math.max(8, Math.floor(height / 45));
  for (const y of rowCandidates.sort((a, b) => rows[b] - rows[a])) if (rowPeaks.every(existing => Math.abs(existing - y) >= rowGap)) rowPeaks.push(y);
  rowPeaks.sort((a, b) => a - b);
  let top = Math.max(1, Math.floor(height / 25)), bottom = Math.min(height - 1, height - Math.floor(height / 40));
  if (rowPeaks.length >= 3 && rowPeaks.at(-1) >= height * .20 && rowPeaks.at(-1) <= height * .45 && rowPeaks.at(-1) - rowPeaks[0] >= height * .12) top = Math.min(Math.floor(height * .55), rowPeaks.at(-1) + Math.max(2, Math.floor(height / 250)));
  else {
    const texture = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0, squaredSum = 0, samples = 0;
      for (let x = 0; x < width; x += xStep) { const value = lumaAt(x, y); sum += value; squaredSum += value * value; samples++; }
      const mean = sum / Math.max(1, samples), deviation = Math.sqrt(Math.max(0, squaredSum / Math.max(1, samples) - mean * mean));
      texture[y] = 255 - mean + deviation * .85;
    }
    const smoothTexture = smoothValues(texture, Math.max(2, Math.floor(height / 180)));
    const ordered = Array.from(smoothTexture).sort((a, b) => a - b);
    const low = ordered[Math.floor((ordered.length - 1) * .10)], high = ordered[Math.floor((ordered.length - 1) * .85)];
    const threshold = low + (high - low) * .38, allowedGap = Math.max(3, Math.floor(height / 55));
    let bestStart = 0, bestEnd = -1, start = -1, gap = 0;
    for (let y = 0; y < height; y++) {
      if (smoothTexture[y] >= threshold) { if (start < 0) start = y; gap = 0; }
      else if (start >= 0 && ++gap > allowedGap) {
        const end = y - gap;
        if (end - start > bestEnd - bestStart) { bestStart = start; bestEnd = end; }
        start = -1; gap = 0;
      }
    }
    if (start >= 0 && height - start > bestEnd - bestStart) { bestStart = start; bestEnd = height - 1; }
    if (bestEnd - bestStart >= height * .30) {
      const padding = Math.max(2, Math.floor(height / 100));
      top = Math.max(1, bestStart - padding); bottom = Math.min(height - 1, bestEnd + padding);
    }
  }
  const bandHeight = Math.max(1, bottom - top);
  const energy = new Float32Array(width);
  const yStep = Math.max(1, Math.floor(bandHeight / 520)), allowedGap = Math.max(3, Math.floor(bandHeight / 45));
  for (let x = 1; x < width; x++) {
    let sum = 0, samples = 0, strong = 0, run = 0, longestRun = 0, gap = 0;
    for (let y = top; y < bottom; y += yStep) {
      const difference = Math.abs(lumaAt(x, y) - lumaAt(x - 1, y));
      sum += difference; samples++;
      if (difference >= 11) { strong++; run += gap + 1; gap = 0; longestRun = Math.max(longestRun, run); }
      else if (++gap > allowedGap / yStep) { run = 0; gap = 0; }
    }
    energy[x] = sum / samples + 12 * strong / samples + 28 * longestRun / samples;
  }
  const smooth = smoothValues(energy, Math.max(1, Math.floor(width / 1100)));
  const minimumGap = Math.max(10, Math.floor(width / 120), Math.floor(bandHeight * .03)), localRadius = Math.max(30, Math.floor(width / 12));
  const peakCandidates = [];
  for (let x = 2; x < width - 2; x++) {
    if (smooth[x] < smooth[x - 1] || smooth[x] < smooth[x + 1]) continue;
    const local = Array.from(smooth.slice(Math.max(1, x - localRadius), Math.min(width - 1, x + localRadius)));
    const mean = local.reduce((sum, value) => sum + value, 0) / local.length;
    const deviation = Math.sqrt(local.reduce((sum, value) => sum + (value - mean) ** 2, 0) / local.length);
    if (smooth[x] >= mean + deviation * .62) peakCandidates.push(x);
  }
  const selected = [];
  for (const x of peakCandidates.sort((a, b) => smooth[b] - smooth[a])) {
    if (selected.every(existing => Math.abs(existing - x) >= minimumGap)) selected.push(x);
    if (selected.length >= 70) break;
  }
  let boundaries = [0, ...selected.sort((a, b) => a - b), width - 1];
  const minimumWidth = Math.max(9, Math.floor(width / 145), Math.floor(bandHeight * .03));
  let changed = true;
  while (changed && boundaries.length > 2) {
    changed = false;
    for (let index = 0; index < boundaries.length - 1; index++) if (boundaries[index + 1] - boundaries[index] < minimumWidth) {
      if (index === 0) boundaries.splice(1, 1);
      else if (index === boundaries.length - 2) boundaries.splice(index, 1);
      else if (smooth[boundaries[index]] < smooth[boundaries[index + 1]]) boundaries.splice(index, 1);
      else boundaries.splice(index + 1, 1);
      changed = true; break;
    }
  }
  const plausibleMin = Math.max(9, Math.floor(bandHeight * .035)), plausibleMax = Math.max(plausibleMin + 1, Math.floor(bandHeight * .14));
  const plausible = boundaries.slice(0, -1).map((left, index) => boundaries[index + 1] - left).filter(gap => gap >= plausibleMin && gap <= plausibleMax).sort((a, b) => a - b);
  const typical = plausible.length ? plausible[Math.floor(plausible.length / 2)] : Math.max(22, Math.floor(width / 35));
  const split = [boundaries[0]];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const left = boundaries[index], gap = boundaries[index + 1] - left;
    const parts = gap > typical * 1.75 ? clamp(Math.round(gap / typical), 2, 8) : 1;
    for (let part = 1; part <= parts; part++) split.push(left + Math.round(gap * part / parts));
  }
  boundaries = [...new Set(split)].sort((a, b) => a - b);
  const yPadding = Math.max(2, Math.floor(bandHeight / 100));
  const resultTop = Math.max(0, top - yPadding), resultBottom = Math.min(height, bottom + yPadding);
  let results = boundaries.slice(0, -1).map((left, index) => ({ x: left / width, y: resultTop / height, w: (boundaries[index + 1] - left) / width, h: (resultBottom - resultTop) / height })).filter(rect => rect.w * width >= Math.max(6, width / 220));
  if (results.length < 4) {
    const count = clamp(Math.floor(width / Math.max(24, bandHeight / 11)), 6, 45);
    results = Array.from({ length: count }, (_, index) => ({ x: index / count, y: resultTop / height, w: 1 / count, h: (resultBottom - resultTop) / height }));
  }
  return results;
}

function renderDetectedSpines() {
  const layer = $('spineLayer');
  layer.innerHTML = state.detectedSpines.map((spine, index) => `<button type="button" class="spine-choice${state.editingSpineIndex === index ? ' selected' : ''}" data-spine="${index}" aria-label="${state.editingSpines ? 'Seleziona' : 'Riconosci'} dorso ${index + 1}" style="left:${spine.x * 100}%;top:${spine.y * 100}%;width:${spine.w * 100}%;height:${spine.h * 100}%"></button>`).join('');
  layer.onclick = async event => {
    const button = event.target.closest('[data-spine]'); if (!button) return;
    const index = Number(button.dataset.spine);
    state.selection = state.detectedSpines[index];
    drawSelection(state.selection); layer.innerHTML = '';
    if (state.editingSpines) {
      state.editingSpineIndex = index;
      renderDetectedSpines();
      return toast('Riquadro selezionato');
    }
    await recognizeSelectedSpine();
  };
}

async function recognizeSelectedSpine() {
  setProgress(true, 'Preparazione del dorso e miglioramento del contrasto…');
  try {
    const texts = [];
    const variants = [];
    for (const rotation of [90, 270]) {
      variants.push({ rotation, enhanced: false, image: await cropSpine(state.currentPhoto.blob, state.selection, rotation, false) });
      variants.push({ rotation, enhanced: true, image: await cropSpine(state.currentPhoto.blob, state.selection, rotation, true) });
    }
    const logger = message => {
      if (message.progress) setProgress(true, `Lettura OCR migliorata · ${Math.round(message.progress * 100)}%`);
    };
    if (Tesseract.createWorker) {
      const worker = await Tesseract.createWorker('ita+eng', 1, { logger });
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
        for (let index = 0; index < variants.length; index++) {
          setProgress(true, `Lettura variante ${index + 1} di ${variants.length}…`);
          const result = await worker.recognize(variants[index].image);
          if (result.data.text?.trim()) texts.push(result.data.text.trim());
        }
      } finally { await worker.terminate(); }
    } else {
      for (const variant of variants) {
        const result = await Tesseract.recognize(variant.image, 'ita+eng', { logger, tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
        if (result.data.text?.trim()) texts.push(result.data.text.trim());
      }
    }
    const lines = [...new Set(texts.flatMap(text => text.split(/\r?\n/)).map(cleanOcrLine).filter(line => line.length >= 3 && /[A-Za-zÀ-ÿ]/.test(line)))];
    $('ocrText').value = lines.join('\n');
    if (!lines.length) throw new Error('testo insufficiente; seleziona il dorso più precisamente');
    setProgress(true, 'Confronto con pubblicazioni musicali reali…');
    const releases = await searchMusicBrainzFromText(lines);
    renderMusicCandidates(releases, lines.join(' '));
    if (!releases.length) return toast('Nessuna corrispondenza: prova barcode o correzione manuale');
    const best = releases[0];
    if (best.smartScore >= 65) applyMusicCandidate(best);
    toast(`Migliore corrispondenza ${best.smartScore}%: verifica il risultato`);
  } catch (error) { toast(`Riconoscimento non riuscito: ${error.message}`); }
  finally { setProgress(false); }
}

async function cropSpine(blob, rect, rotation, enhanced = false) {
  const bitmap = await createImageBitmap(blob);
  const horizontalPadding = Math.max(1, Math.round(rect.w * bitmap.width * .04));
  const verticalPadding = Math.max(1, Math.round(rect.h * bitmap.height * .012));
  const sx = Math.max(0, Math.round(rect.x * bitmap.width) - horizontalPadding), sy = Math.max(0, Math.round(rect.y * bitmap.height) - verticalPadding);
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.w * bitmap.width) + horizontalPadding * 2));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.h * bitmap.height) + verticalPadding * 2));
  const scale = Math.min(6, Math.max(1, 88 / sw, 1500 / sh), 2400 / sh);
  const padding = Math.max(12, Math.round(sw * scale * .18));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(sh * scale) + padding * 2; canvas.height = Math.round(sw * scale) + padding * 2;
  const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
  context.drawImage(bitmap, sx, sy, sw, sh, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale); bitmap.close?.();
  if (enhanced) enhanceSpineCanvas(canvas, context);
  return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('ritaglio non disponibile')), 'image/png'));
}

function enhanceSpineCanvas(canvas, transformedContext) {
  transformedContext.setTransform(1, 0, 0, 1, 0, 0);
  const image = transformedContext.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
  const histogram = new Uint32Array(256); let sum = 0, count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.round(data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114);
    histogram[value]++; sum += value; count++;
  }
  let totalSum = 0; for (let value = 0; value < 256; value++) totalSum += value * histogram[value];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 128;
  for (let value = 0; value < 256; value++) {
    backgroundWeight += histogram[value]; if (!backgroundWeight || backgroundWeight === count) continue;
    backgroundSum += value * histogram[value];
    const foregroundWeight = count - backgroundWeight;
    const difference = backgroundSum / backgroundWeight - (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * difference * difference;
    if (variance > bestVariance) { bestVariance = variance; threshold = value; }
  }
  const invert = sum / Math.max(1, count) < 128;
  for (let index = 0; index < data.length; index += 4) {
    const luma = data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
    let value = luma >= threshold ? 255 : 0; if (invert) value = 255 - value;
    data[index] = data[index + 1] = data[index + 2] = value; data[index + 3] = 255;
  }
  transformedContext.putImageData(image, 0, 0);
}

function cleanOcrLine(value) { return value.replace(/\s+/g, ' ').replace(/^[\s._|,:;\\/-]+|[\s._|,:;\\/-]+$/g, '').trim(); }

async function runOcr() {
  if (!state.currentPhoto) return toast('Prima scegli una fotografia');
  if (!window.Tesseract) return toast('Motore OCR non disponibile: controlla Internet');
  setProgress(true, 'Lettura del testo sul dispositivo…');
  try {
    const result = await Tesseract.recognize(state.currentPhoto.blob, 'ita+eng', { logger: message => {
      if (message.progress) setProgress(true, `OCR ${Math.round(message.progress * 100)}%`);
    }});
    $('ocrText').value = result.data.text.trim();
    const lines = result.data.text.split(/\r?\n/).map(x => x.trim()).filter(x => x.length > 2);
    if (!$('artistInput').value && lines[0]) $('artistInput').value = lines[0];
    if (!$('titleInput').value && lines[1]) $('titleInput').value = lines[1];
    toast('Testo riconosciuto: verifica artista e titolo');
  } catch (error) { toast(`OCR non riuscito: ${error.message}`); }
  finally { setProgress(false); }
}

async function runBarcode() {
  if (!state.currentPhoto) return toast('Fotografa il retro del CD o scegli una foto');
  setProgress(true, 'Lettura del codice a barre…');
  try {
    let value = null;
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      const bitmap = await createImageBitmap(state.currentPhoto.blob);
      const codes = await detector.detect(bitmap);
      value = codes[0]?.rawValue;
    }
    if (!value && window.ZXing) {
      const reader = new ZXing.BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(state.currentPhoto.url);
      value = result?.text;
    }
    if (!value) throw new Error('nessun codice individuato');
    $('barcodeInput').value = value;
    toast(`Barcode trovato: ${value}`);
  } catch (error) { toast(`Barcode non trovato: ${error.message}`); }
  finally { setProgress(false); }
}

function setProgress(show, text = '') {
  $('scanProgress').classList.toggle('hidden', !show);
  if (text) $('scanProgress').querySelector('span').textContent = text;
}

async function searchMusicBrainz() {
  const barcode = $('barcodeInput').value.trim();
  const artist = $('artistInput').value.trim();
  const title = $('titleInput').value.trim();
  if (!barcode && !artist && !title) return toast('Inserisci barcode, artista o titolo');
  setProgress(true, 'Ricerca su MusicBrainz…');
  try {
    const query = barcode ? `barcode:${barcode}` : [artist && `artist:"${artist}"`, title && `release:"${title}"`].filter(Boolean).join(' AND ');
    const response = await fetchWithRetry(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=6`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('servizio non disponibile');
    const data = await response.json();
    let releases = data.releases || [];
    if (!releases.length && !barcode) releases = await searchITunesFromText([`${artist} ${title}`]);
    renderMusicCandidates(releases, `${artist} ${title}`);
  } catch (error) {
    if (!barcode) {
      try { renderMusicCandidates(await searchITunesFromText([`${artist} ${title}`]), `${artist} ${title}`); toast('MusicBrainz non risponde: risultati dal catalogo Apple Music'); }
      catch { toast('Cataloghi musicali temporaneamente non disponibili: riprova tra qualche minuto'); }
    } else toast('Catalogo temporaneamente non disponibile: riprova tra qualche minuto');
  }
  finally { setProgress(false); }
}

async function searchMusicBrainzFromText(lines) {
  const useful = lines.map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length >= 3).slice(0, 8);
  const hypotheses = buildMusicHypotheses(useful);
  if (!hypotheses.length) throw new Error('testo insufficiente');
  const query = hypotheses.slice(0, 20).join(' OR ');
  let releases;
  try {
    const response = await fetchWithRetry(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=12`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('MusicBrainz non disponibile');
    const data = await response.json(); releases = data.releases || [];
  } catch { releases = await searchITunesFromText(useful); }
  if (!releases.length) releases = await searchITunesFromText(useful);
  const sourceTokens = musicTokens(useful.join(' '));
  return releases.map(release => {
    const labelInfo = release['label-info']?.[0];
    const candidateTokens = musicTokens(`${release['artist-credit']?.[0]?.name || ''} ${release.title || ''}`);
    const coverage = candidateTokens.length ? candidateTokens.filter(token => sourceTokens.includes(token)).length * 100 / candidateTokens.length : 0;
    const formats = [...new Set((release.media || []).map(item => item.format).filter(Boolean))];
    const cdBonus = formats.some(format => /(^|\s)CD($|\s)/i.test(format)) ? 5 : 0;
    return { ...release, detectedFormat: formats.join(' + '), smartScore: Math.max(1, Math.min(100, Math.round((Number(release.score) || 0) * .55 + coverage * .45 + cdBonus))) };
  }).sort((a, b) => b.smartScore - a.smartScore);
}

async function fetchWithRetry(url, options = {}) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, options);
    if (response.ok || ![429, 502, 503, 504].includes(response.status)) return response;
    if (attempt < 2) {
      const retrySeconds = Number(response.headers.get('Retry-After'));
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retrySeconds) ? Math.min(4000, retrySeconds * 1000) : 900 * (attempt + 1)));
    }
  }
  return response;
}

async function searchITunesFromText(lines) {
  const queries = [];
  for (const line of lines) {
    const words = String(line).match(/[\p{L}\p{N}][\p{L}\p{N}'’&.-]*/gu) || [];
    let bestStart = -1, bestLength = 0, runStart = -1;
    for (let index = 0; index <= words.length; index++) {
      const word = words[index] || '';
      const upper = word.length >= 3 && word === word.toLocaleUpperCase('it') && word !== word.toLocaleLowerCase('it');
      if (upper && runStart < 0) runStart = index;
      if (!upper && runStart >= 0) {
        if (index - runStart > bestLength) { bestStart = runStart; bestLength = index - runStart; }
        runStart = -1;
      }
    }
    if (bestLength >= 2) queries.push(words.slice(bestStart, Math.min(words.length, bestStart + bestLength + 4)).join(' '));
    if (words.length >= 2) queries.push(words.slice(0, 8).join(' '));
  }
  for (const term of [...new Set(queries)].slice(0, 3)) {
    const response = await fetchWithRetry(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=12&country=IT`);
    if (!response.ok) continue;
    const data = await response.json();
    if (data.results?.length) return data.results.map(item => ({
      id: `itunes:${item.collectionId || ''}`, title: item.collectionName || '', date: item.releaseDate || '', country: item.country || '',
      score: 70, detectedFormat: 'Catalogo Apple Music', media: [{ format: 'Catalogo Apple Music' }],
      'artist-credit': [{ name: item.artistName || 'Artista sconosciuto' }],
      'label-info': [{ label: { name: item.primaryGenreName || '' }, 'catalog-number': '' }]
    }));
  }
  return [];
}

function buildMusicHypotheses(lines) {
  const clauses = [];
  const add = value => { if (value && !clauses.includes(value)) clauses.push(value); };
  const quote = value => String(value).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const line of lines) {
    const words = line.match(/[\p{L}\p{N}][\p{L}\p{N}'’&.-]*/gu) || [];
    let bestStart = -1, bestLength = 0, runStart = -1;
    for (let index = 0; index <= words.length; index++) {
      const word = words[index] || '';
      const upper = word.length >= 3 && word === word.toLocaleUpperCase('it') && word !== word.toLocaleLowerCase('it');
      if (upper && runStart < 0) runStart = index;
      if (!upper && runStart >= 0) {
        if (index - runStart > bestLength) { bestStart = runStart; bestLength = index - runStart; }
        runStart = -1;
      }
    }
    if (bestLength >= 2) {
      const artist = quote(words.slice(bestStart, bestStart + bestLength).join(' '));
      const after = words.slice(bestStart + bestLength).filter(word => word.length >= 2);
      const before = words.slice(0, bestStart).filter(word => word.length >= 2);
      for (const titleWords of [after, before]) {
        for (let count = Math.min(4, titleWords.length); count >= 2; count--) {
          const title = quote(titleWords.slice(0, count).join(' '));
          add(`(artist:"${artist}" AND release:"${title}")`);
        }
      }
    }
    for (let size = Math.min(4, words.length); size >= 2; size--) {
      for (let start = 0; start + size <= words.length && clauses.length < 20; start++) {
        const phrase = quote(words.slice(start, start + size).join(' '));
        if (phrase.length >= 5) { add(`release:"${phrase}"`); add(`artist:"${phrase}"`); }
      }
    }
  }
  return clauses;
}

function musicTokens(value) {
  return [...new Set(String(value).toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(token => token.length >= 2))];
}

function renderMusicCandidates(releases, sourceText = '') {
  const sourceTokens = musicTokens(sourceText);
  const prepared = releases.map(release => {
    if (release.smartScore) return release;
    const artist = release['artist-credit']?.[0]?.name || '';
    const candidateTokens = musicTokens(`${artist} ${release.title || ''}`);
    const overlap = sourceTokens.length ? sourceTokens.filter(token => candidateTokens.includes(token)).length * 100 / sourceTokens.length : 0;
    return { ...release, smartScore: Math.max(Number(release.score) || 0, Math.round(overlap)) };
  });
  $('candidateList').innerHTML = prepared.map((release, index) => {
    const artist = release['artist-credit']?.[0]?.name || 'Artista sconosciuto';
    const labelInfo = release['label-info']?.[0];
    const format = release.detectedFormat || [...new Set((release.media || []).map(item => item.format).filter(Boolean))].join(' + ');
    const details = [(release.date || '').slice(0,4), format, release.country, labelInfo?.label?.name, labelInfo?.['catalog-number'], release.smartScore ? `${release.smartScore}%` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="candidate" data-candidate="${index}"><b>${escapeHtml(artist)} — ${escapeHtml(release.title || '')}</b><small>${escapeHtml(details)}</small></button>`;
  }).join('');
  $('candidateList').onclick = event => {
    const button = event.target.closest('[data-candidate]'); if (!button) return;
    applyMusicCandidate(prepared[Number(button.dataset.candidate)]);
    $('candidateList').innerHTML = '';
  };
}

function applyMusicCandidate(release) {
  $('artistInput').value = release['artist-credit']?.[0]?.name || '';
  $('titleInput').value = release.title || '';
  $('yearInput').value = (release.date || '').slice(0,4);
}

async function saveAlbum(event) {
  event.preventDefault();
  const editingId = $('editingId').value;
  const existing = editingId ? await db.albums.get(editingId) : null;
  const artist = $('artistInput').value.trim(), title = $('titleInput').value.trim(), barcode = $('barcodeInput').value.trim();
  if (!artist || !title) return toast('Artista e titolo sono obbligatori');
  const duplicate = state.albums.find(a => a.Id !== editingId && ((!barcode || !a.Barcode) ? normalize(a.Artist) === normalize(artist) && normalize(a.Title) === normalize(title) : a.Barcode === barcode));
  if (duplicate && !confirm(`“${duplicate.Title}” sembra già presente. Salvare comunque?`)) return;
  let photoId = existing?.PhotoId || '';
  if (state.currentPhoto?.blob && (!state.currentPhoto.id || state.currentPhoto.id !== photoId)) {
    photoId = state.currentPhoto.id || crypto.randomUUID();
    await db.photos.put({ id: photoId, blob: state.currentPhoto.blob, name: state.currentPhoto.blob.name || `ripiano-${Date.now()}.jpg`, createdAt: new Date().toISOString() });
  }
  const selection = state.selection || (existing?.ImageWidth > 0 ? { x: existing.ImageX, y: existing.ImageY, w: existing.ImageWidth, h: existing.ImageHeight } : null);
  const album = {
    ...(existing || {}), Id: editingId || crypto.randomUUID(), Artist: artist, Title: title,
    Year: $('yearInput').value.trim(), Genre: $('genreInput').value.trim(), Position: $('positionInput').value.trim(),
    Notes: existing?.Notes || '', Barcode: barcode, PhotoId: photoId, SourceImage: photoId ? `idb:${photoId}` : '',
    ImageX: selection?.x || 0, ImageY: selection?.y || 0, ImageWidth: selection?.w || 0, ImageHeight: selection?.h || 0,
    LoanedTo: existing?.LoanedTo || '', LoanedAt: existing?.LoanedAt || null, DueAt: existing?.DueAt || null,
    AddedAt: existing?.AddedAt || new Date().toISOString()
  };
  await db.albums.put(album);
  resetForm();
  await refresh();
  navigate('library');
  toast(editingId ? 'CD aggiornato' : 'CD aggiunto alla collezione');
}

function resetForm() {
  $('albumForm').reset(); $('editingId').value = ''; $('candidateList').innerHTML = '';
  state.currentPhoto = null; state.selection = null; state.detectedSpines = []; state.marking = false; state.editingSpines = false; state.editingSpineIndex = null; state.replaceEditedSpine = false;
  $('scanWorkspace').classList.add('hidden'); $('selectionBox').classList.add('hidden'); $('spineLayer').innerHTML = ''; $('markBtn').textContent = 'Segna dorso';
  $('editSpinesBtn').classList.add('hidden'); $('editSpinesPanel').classList.add('hidden');
}

function bindLibrary() {
  $('librarySearch').addEventListener('input', renderLibrary);
  $('manualAddBtn').addEventListener('click', () => { resetForm(); navigate('scan'); $('artistInput').focus(); });
  $('duplicatesBtn').addEventListener('click', showDuplicates);
  $('libraryList').addEventListener('click', async event => {
    const button = event.target.closest('[data-album-action]'); if (!button) return;
    const album = state.albums.find(a => a.Id === button.dataset.id); if (!album) return;
    if (button.dataset.albumAction === 'menu') showAlbumMenu(album);
  });
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) closeModal(); });
}

function renderAll() {
  $('statAlbums').textContent = state.albums.length;
  $('statPhotos').textContent = state.photos.length;
  $('statLoans').textContent = state.albums.filter(a => a.LoanedTo).length;
  $('loanBadge').textContent = state.albums.filter(a => a.LoanedTo).length;
  renderRecent(); renderLibrary(); renderLoans(); renderPhotoOptions(); renderStorage();
}

function renderRecent() { renderAlbumCards($('recentList'), state.albums.slice(0, 4)); }
function renderLibrary() {
  const query = normalize($('librarySearch').value);
  const filtered = state.albums.filter(a => !query || [a.Artist,a.Title,a.Position,a.Genre,a.Barcode].some(value => normalize(value).includes(query)));
  renderAlbumCards($('libraryList'), filtered);
}

function renderAlbumCards(container, albums) {
  container.classList.toggle('empty-state', albums.length === 0);
  container.innerHTML = albums.length ? albums.map(a => `<article class="album-card"><div class="album-disc"></div><div class="album-main"><b>${escapeHtml(a.Title)}</b><span>${escapeHtml(a.Artist)}${a.Year ? ` · ${escapeHtml(a.Year)}` : ''}</span><span class="album-meta">${escapeHtml(a.Position || 'Posizione non indicata')}${a.LoanedTo ? ` · Prestato a ${escapeHtml(a.LoanedTo)}` : ''}</span></div><button class="album-menu" data-album-action="menu" data-id="${a.Id}" aria-label="Azioni">•••</button></article>`).join('') : 'Nessun CD catalogato';
}

function showAlbumMenu(album) {
  $('modalBody').innerHTML = `<span class="eyebrow">${escapeHtml(album.Artist)}</span><h2>${escapeHtml(album.Title)}</h2><p class="muted">${escapeHtml(album.Position || 'Posizione non indicata')}</p><div class="modal-actions"><button class="primary" id="showAlbumLocation">Mostra posizione nella foto</button><button class="secondary" id="editAlbum">Modifica dati</button><button class="secondary" id="associateAlbum">Associa a una foto</button><button class="secondary danger" id="deleteAlbum">Elimina dal catalogo</button></div>`;
  openModal();
  $('showAlbumLocation').onclick = () => { closeModal(); showLocation(album); };
  $('editAlbum').onclick = () => { closeModal(); editAlbum(album, false); };
  $('associateAlbum').onclick = () => { closeModal(); editAlbum(album, true); };
  $('deleteAlbum').onclick = async () => { if (!confirm(`Eliminare “${album.Title}”?`)) return; await db.albums.delete(album.Id); closeModal(); await refresh(); toast('CD eliminato'); };
}

async function editAlbum(album, choosePhoto) {
  resetForm();
  $('editingId').value = album.Id; $('artistInput').value = album.Artist; $('titleInput').value = album.Title;
  $('yearInput').value = album.Year || ''; $('genreInput').value = album.Genre || ''; $('positionInput').value = album.Position || ''; $('barcodeInput').value = album.Barcode || '';
  if (album.PhotoId) {
    const photo = await db.photos.get(album.PhotoId);
    if (photo) { await loadScanPhoto(photo.blob, photo.id); if (album.ImageWidth > 0) { state.selection = { x: album.ImageX, y: album.ImageY, w: album.ImageWidth, h: album.ImageHeight }; drawSelection(state.selection); } }
  }
  navigate('scan');
  if (choosePhoto) { $('galleryInput').click(); setTimeout(() => { state.marking = true; $('scanStage').classList.add('marking'); $('markBtn').classList.add('active'); }, 400); }
}

function showDuplicates() {
  const groups = new Map();
  state.albums.forEach(a => { const key = a.Barcode ? `b:${a.Barcode}` : `t:${normalize(a.Artist)}|${normalize(a.Title)}`; groups.set(key, [...(groups.get(key)||[]), a]); });
  const duplicates = [...groups.values()].filter(group => group.length > 1);
  if (!duplicates.length) return toast('Nessun duplicato trovato');
  $('modalBody').innerHTML = `<h2>Possibili duplicati</h2>${duplicates.map(group => `<p><b>${escapeHtml(group[0].Artist)} — ${escapeHtml(group[0].Title)}</b><br><span class="muted">${group.length} copie</span></p>`).join('')}`;
  openModal();
}

function bindLocation() {
  $('locationSearchBtn').addEventListener('click', searchLocation);
  $('locationSearch').addEventListener('keydown', event => { if (event.key === 'Enter') searchLocation(); });
  $('photoSelect').addEventListener('change', async event => { state.highlightedId = null; if (event.target.value) await displayPhoto(event.target.value); });
}

async function searchLocation() {
  const query = normalize($('locationSearch').value); if (!query) return;
  const album = state.albums.find(a => (normalize(a.Title).includes(query) || normalize(a.Artist).includes(query)) && a.PhotoId && a.ImageWidth > 0);
  if (!album) return toast('Titolo non trovato o posizione fotografica non associata');
  await showLocation(album);
}

async function showLocation(album) {
  if (!album.PhotoId || !album.ImageWidth) return toast('Associa prima questo CD a una fotografia');
  state.highlightedId = album.Id;
  navigate('locate');
  $('locationSearch').value = album.Title;
  $('photoSelect').value = album.PhotoId;
  await displayPhoto(album.PhotoId);
  setLocationInfo(album);
}

function renderPhotoOptions() {
  const select = $('photoSelect'); const current = select.value;
  const used = new Map();
  state.albums.filter(a => a.PhotoId && a.ImageWidth > 0).forEach(a => used.set(a.PhotoId, (used.get(a.PhotoId)||0)+1));
  select.innerHTML = `<option value="">Scegli una foto…</option>${[...used.entries()].map(([id,count],index) => `<option value="${id}">Foto ${index+1} · ${count} CD associati</option>`).join('')}`;
  if (used.has(current)) select.value = current;
}

async function displayPhoto(photoId) {
  const photo = await db.photos.get(photoId); if (!photo) return toast('Fotografia non disponibile');
  const url = URL.createObjectURL(photo.blob);
  $('locationImage').src = url; $('locationStage').style.minHeight = '0'; $('locationEmpty').classList.add('hidden');
  $('locationImage').onload = () => { URL.revokeObjectURL(url); renderHotspots(photoId); };
  renderHotspots(photoId);
}

function renderHotspots(photoId) {
  const layer = $('hotspotLayer');
  const albums = state.albums.filter(a => a.PhotoId === photoId && a.ImageWidth > 0);
  layer.innerHTML = albums.map(a => `<button class="hotspot ${a.Id === state.highlightedId ? 'highlight' : ''}" data-hotspot="${a.Id}" style="left:${a.ImageX*100}%;top:${a.ImageY*100}%;width:${a.ImageWidth*100}%;height:${a.ImageHeight*100}%" aria-label="${escapeHtml(a.Title)}"></button>`).join('');
  layer.onclick = event => { const spot = event.target.closest('[data-hotspot]'); if (!spot) return; const album = state.albums.find(a => a.Id === spot.dataset.hotspot); if (album) { state.highlightedId = album.Id; setLocationInfo(album); renderHotspots(photoId); } };
}

function setLocationInfo(album) { $('locationInfo').innerHTML = `<b>${escapeHtml(album.Artist)} — ${escapeHtml(album.Title)}</b><br>${escapeHtml(album.Position || 'Posizione non indicata')}`; }

function bindMore() {
  $('loanForm').addEventListener('submit', addLoan);
  $('loanList').addEventListener('click', async event => { const button = event.target.closest('[data-return]'); if (!button) return; const album = await db.albums.get(button.dataset.return); album.LoanedTo=''; album.LoanedAt=null; album.DueAt=null; await db.albums.put(album); await refresh(); toast('CD restituito'); });
  $('backupBtn').addEventListener('click', exportBackup);
  $('restoreInput').addEventListener('change', importBackup);
  $('windowsExportBtn').addEventListener('click', exportWindowsCatalog);
  $('csvBtn').addEventListener('click', exportCsv);
  $('pdfBtn').addEventListener('click', () => { navigate('library'); setTimeout(() => window.print(), 200); });
}

function renderLoans() {
  const available = state.albums.filter(a => !a.LoanedTo);
  $('loanAlbum').innerHTML = `<option value="">Scegli un album…</option>${available.map(a => `<option value="${a.Id}">${escapeHtml(a.Artist)} — ${escapeHtml(a.Title)}</option>`).join('')}`;
  const loans = state.albums.filter(a => a.LoanedTo);
  $('loanList').classList.toggle('empty-state', !loans.length);
  $('loanList').innerHTML = loans.length ? loans.map(a => `<div class="loan-item"><div><b>${escapeHtml(a.Title)}</b><small>A ${escapeHtml(a.LoanedTo)} · entro ${formatDate(a.DueAt)}</small></div><button data-return="${a.Id}">Restituito</button></div>`).join('') : 'Nessun prestito attivo';
}

async function addLoan(event) {
  event.preventDefault(); const album = await db.albums.get($('loanAlbum').value); if (!album) return toast('Scegli un album');
  album.LoanedTo = $('borrowerInput').value.trim(); album.LoanedAt = new Date().toISOString(); album.DueAt = $('dueInput').value ? new Date(`${$('dueInput').value}T12:00:00`).toISOString() : null;
  await db.albums.put(album); event.target.reset(); await refresh(); toast('Prestito registrato');
}

async function exportBackup() {
  toast('Preparazione del backup…');
  const photos = [];
  for (const photo of state.photos) photos.push({ id: photo.id, name: photo.name, createdAt: photo.createdAt, data: await blobToDataUrl(photo.blob) });
  const payload = { format: 'CDWall', version: 2, createdAt: new Date().toISOString(), albums: state.albums, photos };
  const file = new File([JSON.stringify(payload)], `CDWall-backup-${dateStamp()}.cdwall`, { type: 'application/json' });
  await shareOrDownload(file, 'Backup CD Wall');
}

async function importBackup(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const albums = Array.isArray(payload) ? payload : payload.albums;
    if (!Array.isArray(albums)) throw new Error('formato non riconosciuto');
    if (!confirm(`Importare ${albums.length} album? Gli elementi con lo stesso ID verranno aggiornati.`)) return;
    for (const photo of (payload.photos || [])) await db.photos.put({ id: photo.id, name: photo.name, createdAt: photo.createdAt, blob: await (await fetch(photo.data)).blob() });
    for (const raw of albums) await db.albums.put(normalizeImportedAlbum(raw));
    await refresh(); toast('Backup importato');
  } catch (error) { toast(`Importazione non riuscita: ${error.message}`); }
  finally { event.target.value = ''; }
}

function normalizeImportedAlbum(raw) {
  const sourceImage = raw.SourceImage || raw.sourceImage || '';
  const photoId = raw.PhotoId || raw.photoId || (sourceImage.startsWith('idb:') ? sourceImage.slice(4) : '');
  return { Id: raw.Id || raw.id || crypto.randomUUID(), Artist: raw.Artist || raw.artist || '', Title: raw.Title || raw.title || '', Year: raw.Year || raw.year || '', Genre: raw.Genre || raw.genre || '', Position: raw.Position || raw.position || '', Notes: raw.Notes || raw.notes || '', Barcode: raw.Barcode || raw.barcode || '', PhotoId: photoId, SourceImage: photoId ? `idb:${photoId}` : '', ImageX: Number(raw.ImageX ?? raw.imageX)||0, ImageY: Number(raw.ImageY ?? raw.imageY)||0, ImageWidth: Number(raw.ImageWidth ?? raw.imageWidth)||0, ImageHeight: Number(raw.ImageHeight ?? raw.imageHeight)||0, LoanedTo: raw.LoanedTo || raw.loanedTo || '', LoanedAt: raw.LoanedAt || raw.loanedAt || null, DueAt: raw.DueAt || raw.dueAt || null, AddedAt: raw.AddedAt || raw.addedAt || new Date().toISOString() };
}

async function exportWindowsCatalog() {
  const file = new File([JSON.stringify(state.albums, null, 2)], `catalogo-${dateStamp()}.json`, { type: 'application/json' });
  await shareOrDownload(file, 'Catalogo CD Wall JSON');
}

async function exportCsv() {
  const headers = ['Artista','Album','Anno','Genere','Posizione','Barcode','Prestato a','Data prestito','Restituzione prevista','Note'];
  const rows = state.albums.map(a => [a.Artist,a.Title,a.Year,a.Genre,a.Position,a.Barcode,a.LoanedTo,a.LoanedAt,a.DueAt,a.Notes].map(csv).join(';'));
  const file = new File(['\ufeff'+[headers.join(';'),...rows].join('\r\n')], `collezione-cd-${dateStamp()}.csv`, { type: 'text/csv' });
  await shareOrDownload(file, 'Catalogo CD Wall CSV');
}

async function shareOrDownload(file, title) {
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ title, files: [file] }); return; } catch (error) { if (error.name === 'AbortError') return; } }
  const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}

async function renderStorage() {
  const estimate = await navigator.storage?.estimate?.();
  $('storageInfo').textContent = estimate ? `${formatBytes(estimate.usage || 0)} utilizzati sul dispositivo` : `${state.photos.length} fotografie archiviate localmente`;
}

function bindInstall() {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.deferredInstall = event; $('installBtn').classList.remove('hidden'); });
  $('installBtn').addEventListener('click', async () => { if (state.deferredInstall) { await state.deferredInstall.prompt(); state.deferredInstall=null; $('installBtn').classList.add('hidden'); } else toast('In Safari: Condividi → Aggiungi alla schermata Home'); });
}

function openModal(){ $('modal').classList.remove('hidden'); }
function closeModal(){ $('modal').classList.add('hidden'); }
let toastTimer;
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3200); }
function normalize(value=''){ return String(value).toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''); }
function escapeHtml(value=''){ return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function clamp(value,min,max){ return Math.min(max,Math.max(min,value)); }
function csv(value=''){ return `"${String(value||'').replaceAll('"','""')}"`; }
function formatDate(value){ return value ? new Intl.DateTimeFormat('it-IT').format(new Date(value)) : 'senza data'; }
function dateStamp(){ return new Date().toISOString().slice(0,10); }
function formatBytes(bytes){ if(bytes<1024)return `${bytes} B`; if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1048576).toFixed(1)} MB`; }
function blobToDataUrl(blob){ return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(reader.error); reader.readAsDataURL(blob); }); }
