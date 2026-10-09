import { db } from './db.js';

const $ = id => document.getElementById(id);
const state = { albums: [], photos: [], currentPhoto: null, selection: null, marking: false, dragStart: null, highlightedId: null, deferredInstall: null };
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
  $('photoInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (file) await loadScanPhoto(file);
  });
  $('ocrBtn').addEventListener('click', runOcr);
  $('barcodeBtn').addEventListener('click', runBarcode);
  $('markBtn').addEventListener('click', () => {
    if (!state.currentPhoto) return toast('Prima scegli una fotografia');
    state.marking = !state.marking;
    $('scanStage').classList.toggle('marking', state.marking);
    $('markBtn').classList.toggle('active', state.marking);
    toast(state.marking ? 'Trascina un riquadro sul dorso del CD' : 'Selezione disattivata');
  });
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
  $('scanImage').src = url;
  $('scanWorkspace').classList.remove('hidden');
  $('selectionBox').classList.add('hidden');
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
  state.marking = false;
  $('scanStage').classList.remove('marking');
  $('markBtn').classList.remove('active');
  $('markBtn').textContent = 'Posizione segnata ✓';
  drawSelection(rect);
  toast('Posizione del CD memorizzata');
}

function rectFromPoints(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
function drawSelection(rect) {
  const box = $('selectionBox');
  box.classList.remove('hidden');
  Object.assign(box.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
}

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
    const response = await fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=6`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('servizio non disponibile');
    const data = await response.json();
    $('candidateList').innerHTML = (data.releases || []).map((release, index) => `<button type="button" class="candidate" data-candidate="${index}"><b>${escapeHtml(release['artist-credit']?.[0]?.name || 'Artista sconosciuto')} — ${escapeHtml(release.title)}</b><small>${escapeHtml((release.date || '').slice(0,4))}</small></button>`).join('');
    const releases = data.releases || [];
    $('candidateList').onclick = event => {
      const button = event.target.closest('[data-candidate]'); if (!button) return;
      const release = releases[Number(button.dataset.candidate)];
      $('artistInput').value = release['artist-credit']?.[0]?.name || '';
      $('titleInput').value = release.title || '';
      $('yearInput').value = (release.date || '').slice(0,4);
      $('candidateList').innerHTML = '';
    };
  } catch (error) { toast(`Ricerca non riuscita: ${error.message}`); }
  finally { setProgress(false); }
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
  state.currentPhoto = null; state.selection = null; state.marking = false;
  $('scanWorkspace').classList.add('hidden'); $('selectionBox').classList.add('hidden'); $('markBtn').textContent = 'Segna dorso';
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
  if (choosePhoto) { $('photoInput').click(); setTimeout(() => { state.marking = true; $('scanStage').classList.add('marking'); $('markBtn').classList.add('active'); }, 400); }
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
