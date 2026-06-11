import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

type CardHalf = 'top' | 'bottom';
const SAFE_MARGIN_POINTS = 28.35;
const HEADER_FONT_SIZE = 8;

interface SourceCard {
  kind: 'source';
  sourcePageIndex: number;
  half: CardHalf;
}

interface StackSourceCard extends SourceCard {
  laneNumber: number;
}

interface DividerCard {
  kind: 'divider';
  laneNumber: number;
}

type CardRef = StackSourceCard | DividerCard;

export interface ReorderOptions {
  laneCount: number;
  splitOffsetPoints: number;
  topTrimPoints: number;
  bottomTrimPoints: number;
  contentTopOffsetPoints: number;
  meetHeader: string;
  meetHeaderOffsetPoints: number;
  addLaneNumbers: boolean;
  laneNumberOffsetPoints: number;
  addLaneDividers: boolean;
}

export interface ReorderResult {
  bytes: Uint8Array;
  sourcePageCount: number;
  cardCount: number;
  dividerCount: number;
  outputPageCount: number;
  ignoredTrailingBlank: boolean;
}

export async function reorderTimerCardPdf(
  bytes: ArrayBuffer | Uint8Array,
  options: ReorderOptions,
): Promise<ReorderResult> {
  const sourcePdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const sourcePages = sourcePdf.getPages();

  if (sourcePages.length === 0) {
    throw new Error('This PDF has no pages.');
  }

  if (!Number.isInteger(options.laneCount) || options.laneCount < 1) {
    throw new Error('Enter a whole number of lanes.');
  }

  if (!Number.isFinite(options.splitOffsetPoints)) {
    throw new Error('Enter a valid split line adjustment.');
  }

  if (!Number.isFinite(options.topTrimPoints) || options.topTrimPoints < 0) {
    throw new Error('Enter a valid top trim amount.');
  }

  if (!Number.isFinite(options.bottomTrimPoints) || options.bottomTrimPoints < 0) {
    throw new Error('Enter a valid bottom trim amount.');
  }

  if (!Number.isFinite(options.contentTopOffsetPoints) || options.contentTopOffsetPoints < 0) {
    throw new Error('Enter a valid content top offset.');
  }

  if (!Number.isFinite(options.meetHeaderOffsetPoints) || options.meetHeaderOffsetPoints < 12) {
    throw new Error('Enter a valid meet header position.');
  }

  if (!Number.isFinite(options.laneNumberOffsetPoints) || options.laneNumberOffsetPoints < 0) {
    throw new Error('Enter a valid lane number position.');
  }

  const outputPdf = await PDFDocument.create();
  const dividerFont = await outputPdf.embedFont(StandardFonts.HelveticaBold);
  const headerFont = await outputPdf.embedFont(StandardFonts.HelveticaBold);
  const allCards = buildCardList(sourcePages.length);
  const { cards, ignoredTrailingBlank } = trimTrailingBlankIfNeeded(allCards, options.laneCount);

  if (cards.length < 2) {
    throw new Error('This PDF needs at least two card halves to reorder.');
  }

  const desiredStack = buildDesiredStack(cards, options.laneCount, options.addLaneDividers);
  const outputPageCount = Math.ceil(desiredStack.length / 2);
  const templatePage = sourcePages[0];
  const { width, height } = templatePage.getSize();

  for (let outputIndex = 0; outputIndex < outputPageCount; outputIndex += 1) {
    const topCard = desiredStack[outputIndex];
    const bottomCard = desiredStack[outputIndex + outputPageCount];
    const outputPage = outputPdf.addPage([width, height]);

    await drawCardHalf(sourcePdf, outputPage, topCard, 'top', dividerFont, headerFont, options);

    if (bottomCard) {
      await drawCardHalf(sourcePdf, outputPage, bottomCard, 'bottom', dividerFont, headerFont, options);
    }

    drawCutLine(outputPage);
  }

  return {
    bytes: await outputPdf.save(),
    sourcePageCount: sourcePages.length,
    cardCount: cards.length,
    dividerCount: options.addLaneDividers ? options.laneCount : 0,
    outputPageCount,
    ignoredTrailingBlank,
  };
}

function buildCardList(pageCount: number): SourceCard[] {
  const cards: SourceCard[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    cards.push({ kind: 'source', sourcePageIndex: pageIndex, half: 'top' });
    cards.push({ kind: 'source', sourcePageIndex: pageIndex, half: 'bottom' });
  }

  return cards;
}

function trimTrailingBlankIfNeeded(
  cards: SourceCard[],
  laneCount: number,
): { cards: SourceCard[]; ignoredTrailingBlank: boolean } {
  if (cards.length % laneCount === 0) {
    return { cards, ignoredTrailingBlank: false };
  }

  if ((cards.length - 1) % laneCount === 0) {
    return { cards: cards.slice(0, -1), ignoredTrailingBlank: true };
  }

  throw new Error(
    `This PDF has ${cards.length} half-page slots, which cannot be split evenly across ${laneCount} lanes.`,
  );
}

function buildDesiredStack(cards: SourceCard[], laneCount: number, addDividers: boolean): CardRef[] {
  const cardsPerLane = cards.length / laneCount;
  const desiredStack: CardRef[] = [];

  for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
    if (addDividers) {
      desiredStack.push({ kind: 'divider', laneNumber: laneIndex + 1 });
    }
    const laneStart = laneIndex * cardsPerLane;
    desiredStack.push(
      ...cards.slice(laneStart, laneStart + cardsPerLane).map((card) => ({
        ...card,
        laneNumber: laneIndex + 1,
      })),
    );
  }

  return desiredStack;
}

async function drawCardHalf(
  sourcePdf: PDFDocument,
  outputPage: PDFPage,
  card: CardRef,
  destination: CardHalf,
  dividerFont: PDFFont,
  headerFont: PDFFont,
  options: ReorderOptions,
): Promise<void> {
  if (card.kind === 'divider') {
    drawDividerCard(outputPage, card, destination, dividerFont);
    drawMeetHeader(outputPage, destination, headerFont, options.meetHeader, options.meetHeaderOffsetPoints);
    return;
  }

  const sourcePage = sourcePdf.getPage(card.sourcePageIndex);
  const { width, height } = outputPage.getSize();
  const sourceSize = sourcePage.getSize();
  const sourceBox = getSourceBox(sourceSize.width, sourceSize.height, card.half, options);
  const destinationHalfHeight = height / 2;
  const sourceCropWidth = sourceBox.right - sourceBox.left;
  const sourceCropHeight = sourceBox.top - sourceBox.bottom;
  const contentTopOffset = getSafeContentTopOffset(options.contentTopOffsetPoints, destinationHalfHeight);
  const availableContentHeight = Math.max(1, destinationHalfHeight - contentTopOffset - SAFE_MARGIN_POINTS);
  const scale = Math.min(width / sourceCropWidth, availableContentHeight / sourceCropHeight);
  const drawWidth = sourceCropWidth * scale;
  const drawHeight = sourceCropHeight * scale;
  const embeddedPage = await outputPage.doc.embedPage(sourcePage, sourceBox);
  const y = destination === 'top' ? destinationHalfHeight : 0;

  outputPage.drawPage(embeddedPage, {
    x: (width - drawWidth) / 2,
    y: y + destinationHalfHeight - contentTopOffset - drawHeight,
    width: drawWidth,
    height: drawHeight,
  });

  drawLaneNumber(outputPage, destination, headerFont, card, options);
  drawMeetHeader(outputPage, destination, headerFont, options.meetHeader, options.meetHeaderOffsetPoints);
}

function getSafeContentTopOffset(offsetPoints: number, halfHeight: number): number {
  return Math.max(SAFE_MARGIN_POINTS, Math.min(halfHeight - SAFE_MARGIN_POINTS - 1, offsetPoints));
}

function getSourceBox(
  sourcePageWidth: number,
  sourcePageHeight: number,
  half: CardHalf,
  options: ReorderOptions,
): { left: number; bottom: number; right: number; top: number } {
  const splitY = sourcePageHeight / 2 + options.splitOffsetPoints;

  if (splitY <= 0 || splitY >= sourcePageHeight) {
    throw new Error('The split line adjustment is outside the source page.');
  }

  const topLimit = sourcePageHeight - options.topTrimPoints;
  const bottomLimit = options.bottomTrimPoints;
  const sourceBox =
    half === 'top'
      ? { left: 0, bottom: splitY, right: sourcePageWidth, top: topLimit }
      : { left: 0, bottom: bottomLimit, right: sourcePageWidth, top: splitY };

  if (sourceBox.top <= sourceBox.bottom) {
    throw new Error('The trim lines leave no content to copy for one of the card halves.');
  }

  return sourceBox;
}

function drawDividerCard(
  outputPage: PDFPage,
  card: DividerCard,
  destination: CardHalf,
  font: PDFFont,
): void {
  const { width, height } = outputPage.getSize();
  const halfHeight = height / 2;
  const y = destination === 'top' ? halfHeight : 0;
  const label = `LANE ${card.laneNumber}`;
  const labelSize = Math.min(72, width / 6.8);
  const labelWidth = font.widthOfTextAtSize(label, labelSize);

  outputPage.drawText(label, {
    x: (width - labelWidth) / 2,
    y: y + halfHeight / 2 - labelSize / 3,
    size: labelSize,
    font,
    color: rgb(0.05, 0.09, 0.16),
  });
}

function drawMeetHeader(
  outputPage: PDFPage,
  destination: CardHalf,
  font: PDFFont,
  rawText: string,
  headerOffsetPoints: number,
): void {
  const text = sanitizeHeaderText(rawText);

  if (!text) {
    return;
  }

  const { width, height } = outputPage.getSize();
  const halfHeight = height / 2;
  const y = destination === 'top' ? halfHeight : 0;
  const maxTextWidth = width - 72;
  const fontSize = getFittingFontSize(font, text, HEADER_FONT_SIZE, maxTextWidth);
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const textX = (width - textWidth) / 2;
  const textY = y + halfHeight - getSafeHeaderOffset(headerOffsetPoints, halfHeight, fontSize);

  outputPage.drawRectangle({
    x: Math.max(24, textX - 6),
    y: textY - 3,
    width: Math.min(width - 48, textWidth + 12),
    height: fontSize + 6,
    color: rgb(1, 1, 1),
    opacity: 0.92,
  });
  outputPage.drawText(text, {
    x: textX,
    y: textY,
    size: fontSize,
    font,
    color: rgb(0.05, 0.09, 0.16),
  });
}

function drawLaneNumber(
  outputPage: PDFPage,
  destination: CardHalf,
  font: PDFFont,
  card: StackSourceCard,
  options: ReorderOptions,
): void {
  if (!options.addLaneNumbers) {
    return;
  }

  const { width, height } = outputPage.getSize();
  const halfHeight = height / 2;
  const y = destination === 'top' ? halfHeight : 0;
  const fontSize = HEADER_FONT_SIZE;
  const label = `LANE ${card.laneNumber}`;
  const labelWidth = font.widthOfTextAtSize(label, fontSize);
  const offset = Math.max(
    SAFE_MARGIN_POINTS,
    Math.min(halfHeight - SAFE_MARGIN_POINTS - fontSize, options.laneNumberOffsetPoints),
  );

  outputPage.drawText(label, {
    x: (width - labelWidth) / 2,
    y: y + offset,
    size: fontSize,
    font,
    color: rgb(0.05, 0.09, 0.16),
  });
}

function getSafeHeaderOffset(headerOffsetPoints: number, halfHeight: number, fontSize: number): number {
  const fallbackOffset = 44;
  const minOffset = SAFE_MARGIN_POINTS + fontSize;
  const maxOffset = halfHeight - SAFE_MARGIN_POINTS;

  if (Number.isFinite(headerOffsetPoints)) {
    return Math.max(minOffset, Math.min(maxOffset, headerOffsetPoints));
  }

  return Math.max(minOffset, Math.min(maxOffset, fallbackOffset));
}

function sanitizeHeaderText(rawText: string): string {
  return rawText
    .trim()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e]/g, '');
}

function getFittingFontSize(font: PDFFont, text: string, preferredSize: number, maxWidth: number): number {
  let fontSize = preferredSize;

  while (fontSize > 6 && font.widthOfTextAtSize(text, fontSize) > maxWidth) {
    fontSize -= 0.5;
  }

  return fontSize;
}

function drawCutLine(outputPage: PDFPage): void {
  const { width, height } = outputPage.getSize();

  outputPage.drawLine({
    start: { x: 18, y: height / 2 },
    end: { x: width - 18, y: height / 2 },
    thickness: 1,
    color: rgb(0.25, 0.31, 0.39),
    dashArray: [4, 4],
  });
}
