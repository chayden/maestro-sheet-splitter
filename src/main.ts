import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { reorderTimerCardPdf } from './pdfReorder';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ProcessResult {
  blob: Blob;
  fileName: string;
  sourcePageCount: number;
  cardCount: number;
  dividerCount: number;
  outputPageCount: number;
  ignoredTrailingBlank: boolean;
}

type GuideKind = 'split' | 'topTrim' | 'bottomTrim';
const SAFE_MARGIN_POINTS = 28.35;
const HEADER_PREVIEW_FONT_SIZE = 10;

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

app.innerHTML = `
  <section class="workspace" aria-labelledby="title">
    <div class="intro">
      <p class="eyebrow">Browser-only PDF tool</p>
      <h1 id="title">Timer Card PDF Reorderer</h1>
      <p class="summary">
        Drop in a PDF where each page contains two timer cards sorted by lane, then event. The new
        PDF is arranged so one cut makes lane-ordered stacks with dividers between lanes.
      </p>
    </div>

    <form class="panel" id="controls">
      <label class="drop-zone" id="dropZone" for="pdfInput">
        <input id="pdfInput" type="file" accept="application/pdf,.pdf" />
        <span class="drop-title">Drop PDF here</span>
        <span class="drop-detail">or click to choose a file</span>
      </label>

      <div class="options">
        <label class="field-row" for="laneCount">
          <span>Number of lanes</span>
          <input id="laneCount" type="number" min="1" max="24" step="1" value="6" inputmode="numeric" />
        </label>
        <label class="field-row wide-field" for="meetHeader">
          <span>Meet header</span>
          <input id="meetHeader" type="text" maxlength="120" placeholder="no header" />
        </label>
        <label class="field-row" for="meetHeaderOffsetPoints">
          <span>Header position</span>
          <input id="meetHeaderOffsetPoints" type="number" min="12" max="180" step="1" value="44" inputmode="numeric" />
        </label>
        <label class="field-row" for="contentTopOffsetPoints">
          <span>Content top offset</span>
          <input id="contentTopOffsetPoints" type="number" min="29" max="216" step="1" value="30" inputmode="numeric" />
        </label>
        <label class="check-field" for="addLaneNumbers">
          <input id="addLaneNumbers" type="checkbox" checked />
          <span>Add lane number to every timer card</span>
        </label>
        <label class="field-row" for="laneNumberOffsetPoints">
          <span>Lane number position</span>
          <input id="laneNumberOffsetPoints" type="number" min="29" max="180" step="1" value="30" inputmode="numeric" />
        </label>
        <label class="field-row" for="splitOffsetPoints">
          <span>Input split offset</span>
          <input id="splitOffsetPoints" type="number" min="-144" max="144" step="1" value="21" inputmode="numeric" />
        </label>
        <label class="field-row" for="topTrimPoints">
          <span>Top trim</span>
          <input id="topTrimPoints" type="number" min="0" max="216" step="1" value="51" inputmode="numeric" />
        </label>
        <label class="field-row" for="bottomTrimPoints">
          <span>Bottom trim</span>
          <input id="bottomTrimPoints" type="number" min="0" max="216" step="1" value="76" inputmode="numeric" />
        </label>
        <p class="field-help">Points from center of the source PDF. Positive moves the source split up; negative moves it down.</p>
      </div>

      <button class="primary" id="convertButton" type="submit" disabled>Build reordered PDF</button>
    </form>

    <section class="preview" id="previewPanel" aria-label="PDF split preview" hidden>
      <div class="preview-header">
        <div>
          <strong>Preview</strong>
          <p>Adjust the source crop on the left and preview the generated output page on the right.</p>
        </div>
        <button class="secondary" id="resetSplitButton" type="button">Center</button>
      </div>
      <div class="preview-grid">
        <div class="preview-column">
          <div class="preview-title">Source page</div>
          <div class="preview-stage" id="previewStage">
            <canvas id="previewCanvas"></canvas>
            <button class="guide-line trim-line top-trim-line" id="topTrimLine" type="button" aria-label="Drag top trim line">
              <span id="topTrimLabel">Top 0 pt</span>
            </button>
            <button class="guide-line split-line" id="splitLine" type="button" aria-label="Drag source split line">
              <span id="splitLabel">0 pt</span>
            </button>
            <button class="guide-line trim-line bottom-trim-line" id="bottomTrimLine" type="button" aria-label="Drag bottom trim line">
              <span id="bottomTrimLabel">Bottom 0 pt</span>
            </button>
          </div>
        </div>
        <div class="preview-column">
          <div class="preview-title">Generated page preview</div>
          <div class="output-page-stage" id="outputPageStage">
            <canvas id="outputPreviewCanvas"></canvas>
            <button class="output-header-handle" id="outputHeaderHandle" type="button" aria-label="Drag meet header position">
              <span id="outputHeaderText">Meet header</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="status" id="status" aria-live="polite">
      <p>Choose a PDF to begin.</p>
    </section>
  </section>
`;

const form = document.querySelector<HTMLFormElement>('#controls');
const input = document.querySelector<HTMLInputElement>('#pdfInput');
const dropZone = document.querySelector<HTMLLabelElement>('#dropZone');
const button = document.querySelector<HTMLButtonElement>('#convertButton');
const statusBox = document.querySelector<HTMLElement>('#status');
const laneCountInput = document.querySelector<HTMLInputElement>('#laneCount');
const meetHeaderInput = document.querySelector<HTMLInputElement>('#meetHeader');
const meetHeaderOffsetInput = document.querySelector<HTMLInputElement>('#meetHeaderOffsetPoints');
const contentTopOffsetInput = document.querySelector<HTMLInputElement>('#contentTopOffsetPoints');
const addLaneNumbersInput = document.querySelector<HTMLInputElement>('#addLaneNumbers');
const laneNumberOffsetInput = document.querySelector<HTMLInputElement>('#laneNumberOffsetPoints');
const splitOffsetInput = document.querySelector<HTMLInputElement>('#splitOffsetPoints');
const topTrimInput = document.querySelector<HTMLInputElement>('#topTrimPoints');
const bottomTrimInput = document.querySelector<HTMLInputElement>('#bottomTrimPoints');
const previewPanel = document.querySelector<HTMLElement>('#previewPanel');
const previewStage = document.querySelector<HTMLElement>('#previewStage');
const previewCanvas = document.querySelector<HTMLCanvasElement>('#previewCanvas');
const splitLine = document.querySelector<HTMLButtonElement>('#splitLine');
const topTrimLine = document.querySelector<HTMLButtonElement>('#topTrimLine');
const bottomTrimLine = document.querySelector<HTMLButtonElement>('#bottomTrimLine');
const splitLabel = document.querySelector<HTMLElement>('#splitLabel');
const topTrimLabel = document.querySelector<HTMLElement>('#topTrimLabel');
const bottomTrimLabel = document.querySelector<HTMLElement>('#bottomTrimLabel');
const resetSplitButton = document.querySelector<HTMLButtonElement>('#resetSplitButton');
const outputPageStage = document.querySelector<HTMLElement>('#outputPageStage');
const outputPreviewCanvas = document.querySelector<HTMLCanvasElement>('#outputPreviewCanvas');
const outputHeaderHandle = document.querySelector<HTMLButtonElement>('#outputHeaderHandle');
const outputHeaderText = document.querySelector<HTMLElement>('#outputHeaderText');

let selectedFile: File | null = null;
let lastDownloadUrl: string | null = null;
let previewState: { pageWidthPoints: number; pageHeightPoints: number; cssScale: number } | null = null;

if (
  !form ||
  !input ||
  !dropZone ||
  !button ||
  !statusBox ||
  !laneCountInput ||
  !meetHeaderInput ||
  !meetHeaderOffsetInput ||
  !contentTopOffsetInput ||
  !addLaneNumbersInput ||
  !laneNumberOffsetInput ||
  !splitOffsetInput ||
  !topTrimInput ||
  !bottomTrimInput ||
  !previewPanel ||
  !previewStage ||
  !previewCanvas ||
  !splitLine ||
  !topTrimLine ||
  !bottomTrimLine ||
  !splitLabel ||
  !topTrimLabel ||
  !bottomTrimLabel ||
  !resetSplitButton ||
  !outputPageStage ||
  !outputPreviewCanvas ||
  !outputHeaderHandle ||
  !outputHeaderText
) {
  throw new Error('Required UI elements were not created.');
}

const pdfInput = input;
const convertButton = button;
const statusPanel = statusBox;
const laneInput = laneCountInput;
const meetHeader = meetHeaderInput;
const meetHeaderOffset = meetHeaderOffsetInput;
const contentTopOffset = contentTopOffsetInput;
const addLaneNumbers = addLaneNumbersInput;
const laneNumberOffset = laneNumberOffsetInput;
const splitInput = splitOffsetInput;
const topTrim = topTrimInput;
const bottomTrim = bottomTrimInput;
const preview = previewPanel;
const stage = previewStage;
const canvas = previewCanvas;
const splitHandle = splitLine;
const topTrimHandle = topTrimLine;
const bottomTrimHandle = bottomTrimLine;
const splitValueLabel = splitLabel;
const topTrimValueLabel = topTrimLabel;
const bottomTrimValueLabel = bottomTrimLabel;
const centerSplitButton = resetSplitButton;
const outputStage = outputPageStage;
const outputCanvas = outputPreviewCanvas;
const outputHeader = outputHeaderHandle;
const outputHeaderPreviewText = outputHeaderText;

pdfInput.addEventListener('change', () => {
  const file = pdfInput.files?.[0] ?? null;
  void setSelectedFile(file);
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}

dropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0] ?? null;
  void setSelectedFile(file);
});

splitInput.addEventListener('input', () => {
  updatePreviewGuidesFromInputs();
});

topTrim.addEventListener('input', () => {
  updatePreviewGuidesFromInputs();
});

bottomTrim.addEventListener('input', () => {
  updatePreviewGuidesFromInputs();
});

meetHeader.addEventListener('input', () => {
  updateOutputHeaderPreview();
});

meetHeaderOffset.addEventListener('input', () => {
  updateOutputHeaderPreview();
});

contentTopOffset.addEventListener('input', () => {
  renderOutputPreview();
});

addLaneNumbers.addEventListener('change', () => {
  renderOutputPreview();
});

laneNumberOffset.addEventListener('input', () => {
  renderOutputPreview();
});

outputHeader.addEventListener('pointerdown', (event) => {
  outputHeader.setPointerCapture(event.pointerId);
  updateOutputHeaderFromPointer(event);
});

outputHeader.addEventListener('pointermove', (event) => {
  if (!outputHeader.hasPointerCapture(event.pointerId)) {
    return;
  }

  updateOutputHeaderFromPointer(event);
});

centerSplitButton.addEventListener('click', () => {
  setSplitOffset(0);
  setTopTrim(0);
  setBottomTrim(0);
});

attachGuideDrag(splitHandle, 'split');
attachGuideDrag(topTrimHandle, 'topTrim');
attachGuideDrag(bottomTrimHandle, 'bottomTrim');
updateOutputHeaderPreview();

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!selectedFile) {
    return;
  }

  setBusy(true);
  setStatus(`Processing ${selectedFile.name}...`);

  try {
    const laneCount = parseLaneCount(laneInput.value);
    const splitOffsetPoints = parseSplitOffset(splitInput.value);
    const topTrimPoints = parseTrim(topTrim.value, 'top');
    const bottomTrimPoints = parseTrim(bottomTrim.value, 'bottom');
    const contentTopOffsetPoints = parseContentTopOffset(contentTopOffset.value);
    const meetHeaderOffsetPoints = parseMeetHeaderOffset(meetHeaderOffset.value);
    const laneNumberOffsetPoints = parseLaneNumberOffset(laneNumberOffset.value);
    const result = await reorderTimerCards(selectedFile, {
      laneCount,
      splitOffsetPoints,
      topTrimPoints,
      bottomTrimPoints,
      contentTopOffsetPoints,
      meetHeader: meetHeader.value,
      meetHeaderOffsetPoints,
      addLaneNumbers: addLaneNumbers.checked,
      laneNumberOffsetPoints,
    });

    showResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong while processing the PDF.';
    setStatus(message, 'error');
  } finally {
    setBusy(false);
  }
});

async function setSelectedFile(file: File | null): Promise<void> {
  if (!file) {
    selectedFile = null;
    convertButton.disabled = true;
    hidePreview();
    setStatus('Choose a PDF to begin.');
    return;
  }

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    selectedFile = null;
    convertButton.disabled = true;
    hidePreview();
    setStatus('Please choose a PDF file.', 'error');
    return;
  }

  selectedFile = file;
  convertButton.disabled = false;
  setStatus(`Ready: ${file.name}`);

  try {
    await renderPreview(file);
  } catch (error) {
    hidePreview();
    const message = error instanceof Error ? error.message : 'Could not render the PDF preview.';
    setStatus(message, 'error');
  }
}

function setBusy(isBusy: boolean): void {
  convertButton.disabled = isBusy || !selectedFile;
  pdfInput.disabled = isBusy;
  laneInput.disabled = isBusy;
  meetHeader.disabled = isBusy;
  meetHeaderOffset.disabled = isBusy;
  contentTopOffset.disabled = isBusy;
  addLaneNumbers.disabled = isBusy;
  laneNumberOffset.disabled = isBusy;
  splitInput.disabled = isBusy;
  topTrim.disabled = isBusy;
  bottomTrim.disabled = isBusy;
  convertButton.textContent = isBusy ? 'Building...' : 'Build reordered PDF';
}

function setStatus(message: string, tone: 'neutral' | 'error' = 'neutral'): void {
  statusPanel.className = tone === 'error' ? 'status error' : 'status';
  statusPanel.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function showResult(result: ProcessResult): void {
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
  }

  lastDownloadUrl = URL.createObjectURL(result.blob);
  statusPanel.className = 'status success';
  statusPanel.innerHTML = `
    <div>
      <strong>Done.</strong>
      <p>
        Read ${result.sourcePageCount} source page${plural(result.sourcePageCount)} and arranged
        ${result.cardCount} timer card${plural(result.cardCount)}
        ${result.dividerCount > 0 ? `plus ${result.dividerCount} lane divider${plural(result.dividerCount)} ` : ''}
        across
        ${result.outputPageCount} output page${plural(result.outputPageCount)}.
        ${result.ignoredTrailingBlank ? 'Ignored one trailing blank half-page while splitting lanes.' : ''}
      </p>
    </div>
    <a class="download" href="${lastDownloadUrl}" download="${escapeAttribute(result.fileName)}">
      Download reordered PDF
    </a>
  `;
}

async function reorderTimerCards(
  file: File,
  options: {
    laneCount: number;
    splitOffsetPoints: number;
    topTrimPoints: number;
    bottomTrimPoints: number;
    contentTopOffsetPoints: number;
    meetHeader: string;
    meetHeaderOffsetPoints: number;
    addLaneNumbers: boolean;
    laneNumberOffsetPoints: number;
  },
): Promise<ProcessResult> {
  const bytes = await file.arrayBuffer();
  const result = await reorderTimerCardPdf(bytes, options);
  const outputBuffer = new ArrayBuffer(result.bytes.byteLength);
  new Uint8Array(outputBuffer).set(result.bytes);

  return {
    blob: new Blob([outputBuffer], { type: 'application/pdf' }),
    fileName: buildOutputFileName(file.name),
    sourcePageCount: result.sourcePageCount,
    cardCount: result.cardCount,
    dividerCount: result.dividerCount,
    outputPageCount: result.outputPageCount,
    ignoredTrailingBlank: result.ignoredTrailingBlank,
  };
}

function parseLaneCount(value: string): number {
  const laneCount = Number(value);

  if (!Number.isInteger(laneCount) || laneCount < 1) {
    throw new Error('Enter a whole number of lanes.');
  }

  return laneCount;
}

function parseSplitOffset(value: string): number {
  const splitOffset = Number(value);

  if (!Number.isFinite(splitOffset) || splitOffset < -144 || splitOffset > 144) {
    throw new Error('Enter a split line adjustment between -144 and 144 points.');
  }

  return splitOffset;
}

function parseTrim(value: string, edge: 'top' | 'bottom'): number {
  const trim = Number(value);

  if (!Number.isFinite(trim) || trim < 0 || trim > 216) {
    throw new Error(`Enter a ${edge} trim between 0 and 216 points.`);
  }

  return trim;
}

function parseContentTopOffset(value: string): number {
  const offset = Number(value);

  if (!Number.isFinite(offset) || offset < SAFE_MARGIN_POINTS || offset > 216) {
    throw new Error('Enter a content top offset between 29 and 216 points.');
  }

  return offset;
}

function parseMeetHeaderOffset(value: string): number {
  const offset = Number(value);

  if (!Number.isFinite(offset) || offset < 12 || offset > 180) {
    throw new Error('Enter a header position between 12 and 180 points.');
  }

  return offset;
}

function parseLaneNumberOffset(value: string): number {
  const offset = Number(value);

  if (!Number.isFinite(offset) || offset < SAFE_MARGIN_POINTS || offset > 180) {
    throw new Error('Enter a lane number position between 29 and 180 points.');
  }

  return offset;
}

function updateOutputHeaderFromPointer(event: PointerEvent): void {
  const rect = outputStage.getBoundingClientRect();
  const halfHeightPoints = previewState ? previewState.pageHeightPoints / 2 : 396;
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const offset = Math.round((y / rect.height) * (halfHeightPoints * 2));

  meetHeaderOffset.value = String(clampMeetHeaderOffset(offset));
  updateOutputHeaderPreview();
}

function updateOutputHeaderPreview(): void {
  const offset = clampMeetHeaderOffset(Number(meetHeaderOffset.value) || 44);
  const pageHeightPoints = previewState?.pageHeightPoints ?? 792;

  meetHeaderOffset.value = String(offset);
  outputHeaderPreviewText.textContent = `${offset} pt`;
  outputHeader.style.top = `${(offset / pageHeightPoints) * 100}%`;
  renderOutputPreview();
}

function clampMeetHeaderOffset(offset: number): number {
  const halfHeightPoints = previewState ? previewState.pageHeightPoints / 2 : 396;
  return Math.max(SAFE_MARGIN_POINTS + 10, Math.min(180, halfHeightPoints - SAFE_MARGIN_POINTS, offset));
}

async function renderPreview(file: File): Promise<void> {
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(1);
  const unscaledViewport = page.getViewport({ scale: 1 });
  preview.hidden = false;
  const maxPreviewWidth = Math.min(stage.parentElement?.clientWidth || 560, 520);
  const cssScale = maxPreviewWidth / unscaledViewport.width;
  const deviceScale = window.devicePixelRatio || 1;
  const renderViewport = page.getViewport({ scale: cssScale * deviceScale });
  const cssWidth = renderViewport.width / deviceScale;
  const cssHeight = renderViewport.height / deviceScale;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas preview is not available in this browser.');
  }

  canvas.width = renderViewport.width;
  canvas.height = renderViewport.height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  stage.style.width = `${cssWidth}px`;
  stage.style.height = `${cssHeight}px`;

  await page.render({
    canvas,
    canvasContext: context,
    viewport: renderViewport,
  }).promise;

  previewState = {
    pageWidthPoints: unscaledViewport.width,
    pageHeightPoints: unscaledViewport.height,
    cssScale,
  };
  updatePreviewGuidesFromInputs();
  updateOutputHeaderPreview();
}

function hidePreview(): void {
  preview.hidden = true;
  previewState = null;
}

function updatePreviewGuidesFromInputs(): void {
  if (!previewState) {
    return;
  }

  const offset = clampSplitOffset(Number(splitInput.value) || 0);
  setSplitOffset(offset);
  setTopTrim(clampTopTrim(Number(topTrim.value) || 0));
  setBottomTrim(clampBottomTrim(Number(bottomTrim.value) || 0));
}

function attachGuideDrag(handle: HTMLButtonElement, guide: GuideKind): void {
  handle.addEventListener('pointerdown', (event) => {
    if (!previewState) {
      return;
    }

    handle.setPointerCapture(event.pointerId);
    updateGuideFromPointer(guide, event);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) {
      return;
    }

    updateGuideFromPointer(guide, event);
  });
}

function updateGuideFromPointer(guide: GuideKind, event: PointerEvent): void {
  if (!previewState) {
    return;
  }

  const rect = stage.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const pointYFromTop = y / previewState.cssScale;

  if (guide === 'split') {
    const offset = previewState.pageHeightPoints / 2 - pointYFromTop;
    setSplitOffset(Math.round(clampSplitOffset(offset)));
  } else if (guide === 'topTrim') {
    setTopTrim(Math.round(clampTopTrim(pointYFromTop)));
  } else {
    setBottomTrim(Math.round(clampBottomTrim(previewState.pageHeightPoints - pointYFromTop)));
  }
}

function setSplitOffset(offset: number): void {
  const clampedOffset = clampSplitOffset(offset);

  splitInput.value = String(clampedOffset);
  topTrim.value = String(clampTopTrim(Number(topTrim.value) || 0));
  bottomTrim.value = String(clampBottomTrim(Number(bottomTrim.value) || 0));
  positionGuides();
}

function setTopTrim(trim: number): void {
  const clampedTrim = clampTopTrim(trim);

  topTrim.value = String(clampedTrim);
  positionGuides();
}

function setBottomTrim(trim: number): void {
  const clampedTrim = clampBottomTrim(trim);

  bottomTrim.value = String(clampedTrim);
  positionGuides();
}

function positionGuides(): void {
  if (!previewState) {
    return;
  }

  const offset = clampSplitOffset(Number(splitInput.value) || 0);
  const topTrimPoints = clampTopTrim(Number(topTrim.value) || 0);
  const bottomTrimPoints = clampBottomTrim(Number(bottomTrim.value) || 0);
  const top = (previewState.pageHeightPoints / 2 - offset) * previewState.cssScale;
  const topTrimY = topTrimPoints * previewState.cssScale;
  const bottomTrimY = (previewState.pageHeightPoints - bottomTrimPoints) * previewState.cssScale;

  splitHandle.style.top = `${top}px`;
  topTrimHandle.style.top = `${topTrimY}px`;
  bottomTrimHandle.style.top = `${bottomTrimY}px`;
  splitValueLabel.textContent = `${offset} pt`;
  topTrimValueLabel.textContent = `Top ${topTrimPoints} pt`;
  bottomTrimValueLabel.textContent = `Bottom ${bottomTrimPoints} pt`;
  renderOutputPreview();
}

function clampSplitOffset(offset: number): number {
  return Math.max(-144, Math.min(144, offset));
}

function clampTopTrim(trim: number): number {
  if (!previewState) {
    return Math.max(0, Math.min(216, trim));
  }

  const splitYFromTop = previewState.pageHeightPoints / 2 - clampSplitOffset(Number(splitInput.value) || 0);
  return Math.max(0, Math.min(216, splitYFromTop - 12, trim));
}

function clampBottomTrim(trim: number): number {
  if (!previewState) {
    return Math.max(0, Math.min(216, trim));
  }

  const splitYFromTop = previewState.pageHeightPoints / 2 - clampSplitOffset(Number(splitInput.value) || 0);
  const availableBottom = previewState.pageHeightPoints - splitYFromTop - 12;
  return Math.max(0, Math.min(216, availableBottom, trim));
}

function renderOutputPreview(): void {
  if (!previewState) {
    return;
  }

  const context = outputCanvas.getContext('2d');

  if (!context) {
    return;
  }

  const containerWidth = outputStage.parentElement?.clientWidth || stage.clientWidth || 360;
  const cssWidth = Math.min(containerWidth, 520);
  const cssHeight = cssWidth * (previewState.pageHeightPoints / previewState.pageWidthPoints);
  const deviceScale = window.devicePixelRatio || 1;

  outputCanvas.width = Math.round(cssWidth * deviceScale);
  outputCanvas.height = Math.round(cssHeight * deviceScale);
  outputCanvas.style.width = `${cssWidth}px`;
  outputCanvas.style.height = `${cssHeight}px`;
  outputStage.style.width = `${cssWidth}px`;
  outputStage.style.height = `${cssHeight}px`;
  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cssWidth, cssHeight);
  contentTopOffset.value = String(Math.round(clampContentTopOffset(Number(contentTopOffset.value) || SAFE_MARGIN_POINTS)));
  laneNumberOffset.value = String(Math.round(clampLaneNumberOffset(Number(laneNumberOffset.value) || SAFE_MARGIN_POINTS)));

  drawOutputHalfPreview(context, 'top', cssWidth, cssHeight);
  drawOutputHalfPreview(context, 'bottom', cssWidth, cssHeight);
  drawOutputCutLine(context, cssWidth, cssHeight);
  drawLaneNumberPreview(context, 'top', cssWidth, cssHeight);
  drawLaneNumberPreview(context, 'bottom', cssWidth, cssHeight);
  drawOutputHeaderPreview(context, 'top', cssWidth, cssHeight);
  drawOutputHeaderPreview(context, 'bottom', cssWidth, cssHeight);
  updateOutputHeaderPositionOnly();
}

function drawOutputHalfPreview(
  context: CanvasRenderingContext2D,
  half: 'top' | 'bottom',
  outputWidth: number,
  outputHeight: number,
): void {
  if (!previewState) {
    return;
  }

  const sourceBox = getPreviewSourceBox(half);
  const sourceScaleX = canvas.width / previewState.pageWidthPoints;
  const sourceScaleY = canvas.height / previewState.pageHeightPoints;
  const sourceX = sourceBox.left * sourceScaleX;
  const sourceY = (previewState.pageHeightPoints - sourceBox.top) * sourceScaleY;
  const sourceWidth = (sourceBox.right - sourceBox.left) * sourceScaleX;
  const sourceHeight = (sourceBox.top - sourceBox.bottom) * sourceScaleY;
  const outputHalfHeight = outputHeight / 2;
  const halfHeightPoints = previewState.pageHeightPoints / 2;
  const contentOffset = clampContentTopOffset(Number(contentTopOffset.value) || SAFE_MARGIN_POINTS);
  const availableContentHeight = Math.max(1, halfHeightPoints - contentOffset - SAFE_MARGIN_POINTS);
  const outputScale = Math.min(
    outputWidth / (sourceBox.right - sourceBox.left),
    (availableContentHeight / (sourceBox.top - sourceBox.bottom)) * (outputHeight / previewState.pageHeightPoints),
  );
  const drawWidth = (sourceBox.right - sourceBox.left) * outputScale;
  const drawHeight = (sourceBox.top - sourceBox.bottom) * outputScale;
  const targetX = (outputWidth - drawWidth) / 2;
  const contentOffsetCss = (contentOffset / previewState.pageHeightPoints) * outputHeight;
  const targetY =
    (half === 'top' ? 0 : outputHalfHeight) +
    Math.min(Math.max(0, outputHalfHeight - drawHeight), contentOffsetCss);

  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, targetX, targetY, drawWidth, drawHeight);
}

function getPreviewSourceBox(half: 'top' | 'bottom'): { left: number; bottom: number; right: number; top: number } {
  if (!previewState) {
    return { left: 0, bottom: 0, right: 0, top: 0 };
  }

  const splitY = previewState.pageHeightPoints / 2 + clampSplitOffset(Number(splitInput.value) || 0);
  const topLimit = previewState.pageHeightPoints - clampTopTrim(Number(topTrim.value) || 0);
  const bottomLimit = clampBottomTrim(Number(bottomTrim.value) || 0);

  return half === 'top'
    ? { left: 0, bottom: splitY, right: previewState.pageWidthPoints, top: topLimit }
    : { left: 0, bottom: bottomLimit, right: previewState.pageWidthPoints, top: splitY };
}

function drawOutputCutLine(context: CanvasRenderingContext2D, outputWidth: number, outputHeight: number): void {
  context.save();
  context.strokeStyle = '#334866';
  context.lineWidth = 1;
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(12, outputHeight / 2);
  context.lineTo(outputWidth - 12, outputHeight / 2);
  context.stroke();
  context.restore();
}

function drawOutputHeaderPreview(
  context: CanvasRenderingContext2D,
  half: 'top' | 'bottom',
  outputWidth: number,
  outputHeight: number,
): void {
  const text = meetHeader.value.trim();

  if (!text) {
    return;
  }

  const offset = clampMeetHeaderOffset(Number(meetHeaderOffset.value) || 44);
  const y = (half === 'top' ? 0 : outputHeight / 2) + (offset / (previewState?.pageHeightPoints ?? 792)) * outputHeight;

  context.save();
  context.font = `bold ${HEADER_PREVIEW_FONT_SIZE}px Helvetica, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const metrics = context.measureText(text);
  context.fillStyle = 'rgba(255, 255, 255, 0.92)';
  context.fillRect((outputWidth - metrics.width) / 2 - 8, y - 10, metrics.width + 16, 20);
  context.fillStyle = '#101828';
  context.fillText(text, outputWidth / 2, y);
  context.restore();
}

function drawLaneNumberPreview(
  context: CanvasRenderingContext2D,
  half: 'top' | 'bottom',
  outputWidth: number,
  outputHeight: number,
): void {
  if (!addLaneNumbers.checked || !previewState) {
    return;
  }

  const offset = clampLaneNumberOffset(Number(laneNumberOffset.value) || 0);
  const halfTop = half === 'top' ? 0 : outputHeight / 2;
  const halfHeight = outputHeight / 2;
  const y = halfTop + halfHeight - (offset / previewState.pageHeightPoints) * outputHeight;
  const text = 'LANE 1';

  context.save();
  context.font = `bold ${HEADER_PREVIEW_FONT_SIZE}px Helvetica, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#101828';
  context.fillText(text, outputWidth / 2, y);
  context.restore();
}

function updateOutputHeaderPositionOnly(): void {
  const offset = clampMeetHeaderOffset(Number(meetHeaderOffset.value) || 44);
  const pageHeightPoints = previewState?.pageHeightPoints ?? 792;

  outputHeader.style.top = `${(offset / pageHeightPoints) * 100}%`;
  outputHeaderPreviewText.textContent = `${offset} pt`;
}

function clampContentTopOffset(offset: number): number {
  const halfHeightPoints = previewState ? previewState.pageHeightPoints / 2 : 396;
  return Math.max(SAFE_MARGIN_POINTS, Math.min(halfHeightPoints - SAFE_MARGIN_POINTS - 1, 216, offset));
}

function clampLaneNumberOffset(offset: number): number {
  const halfHeightPoints = previewState ? previewState.pageHeightPoints / 2 : 396;
  return Math.max(SAFE_MARGIN_POINTS, Math.min(halfHeightPoints - SAFE_MARGIN_POINTS - 10, 180, offset));
}

function buildOutputFileName(inputName: string): string {
  const trimmed = inputName.replace(/\.pdf$/i, '');
  return `${trimmed || 'timer-cards'}-reordered.pdf`;
}

function plural(value: number): string {
  return value === 1 ? '' : 's';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return replacements[character];
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
