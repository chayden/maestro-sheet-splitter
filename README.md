# Timer Card PDF Reorderer

A browser-only tool for reordering swim meet timer-card PDFs before printing.

The expected input is a PDF where each page has two cards and the source cards are sorted by lane,
then event:

- lane 1, event 1
- lane 1, event 2
- lane 1, event 3
- lane 2, event 1
- lane 2, event 2

Enter the number of lanes before building the output PDF. The app inserts a lane divider card at the
start of each lane group and rearranges the output so one horizontal cut creates the final stack
order:

- Lane 1 divider
- lane 1 cards
- Lane 2 divider
- lane 2 cards
- Lane 3 divider
- lane 3 cards

The output PDF also draws a dotted cut line halfway down each page.

Optionally paste a meet name and date into **Meet header**. That text is stamped at the top center
of every generated half-sheet, including timer cards and lane divider cards.

Use **Header position** or drag the header in the output half-sheet preview to move that stamped text
down from the top edge. The default is `44` points, roughly 1 cm lower than the original placement.

If the source PDF's two cards are not split exactly at the page center, adjust **Input split
offset** before building the PDF. The value is in PDF points:

- `0` uses the exact center of the source page
- positive values move the source split up
- negative values move the source split down
- `72` points equals 1 inch

After selecting a PDF, the app renders page 1 with draggable guides:

- the blue split line marks the boundary between the two source cards
- the purple top trim line removes source content above it
- the purple bottom trim line removes source content below it

The preview shows the source page on the left and a generated output page on the right. The output
preview copies the two source card crops into the generated half-sheets, draws the middle cut line,
and shows the meet header position.

Use **Content top offset** to place copied source content a fixed distance down from the top of each
generated half-sheet. Enable **Add lane number to every timer card** to stamp `LANE N` on each timer
card; **Lane number position** controls how far that stamp sits above the bottom edge.

Generated half-sheets reserve a 1 cm safe zone at both the top and bottom. Header text, optional
lane-number stamps, and copied source content are clamped into the printable area between those
safe zones. The lane-number stamp uses the same small text size as the meet header.

After printing and cutting the stack horizontally, put the top pile on top of the bottom pile to get
one ordered stack.

All processing runs in the browser. No PDF is uploaded to a server.

## Run Locally

```sh
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Build

```sh
npm run build
```

The static site is emitted to `dist/`.
