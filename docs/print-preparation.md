# Print preparation — Definitely Maybe?

Record of what was done to the supplied artwork, and the constraint it imposes.

## The source file

| | |
|---|---|
| Format | JPEG, baseline |
| Dimensions | 1080 × 1080 px |
| Colour | sRGB, no embedded ICC profile |
| Density | 72 DPI (screen), no alpha channel |
| Size | 182,566 bytes |
| sha256 | `53f2383f0b8c6775c383551584af2df2407ac744b9e7f437e3d13d3c0fbf8eb5` |

Measured JPEG block-boundary gradient is 1.44× the interior gradient, so there
are real compression artefacts: mild mottling in the flat skin and wall areas
and slight stepping on the hard red edges. Visible on close inspection at print
size; not visible at arm's length.

## The resolution ceiling

1080 px is the hard limit. It cannot be increased by processing.

| Effective resolution | Largest printed width |
|---|---|
| 300 DPI (preferred) | 91 mm |
| 200 DPI | 137 mm |
| 150 DPI (policy floor) | 183 mm |

A full-front placement is 305 × 406 mm. Stretching this file across it gives
90 DPI on the width and 67.5 DPI on the height — well below the floor, and the
validator rejects it.

**Recommended print size: 180 × 180 mm square, 152 DPI effective.** Sits just
above the floor with a small margin; 183 mm is 149.9 DPI and is correctly
rejected.

## Why 150 DPI is a workable floor here

Direct-to-garment printing on cotton is far more forgiving than litho on paper:
the fabric weave itself limits perceivable detail, so the gain from 300 DPI is
much smaller than on a poster. 150 DPI is a real floor rather than a
conservative one — but it is still a floor, and a physical sample is required
before this goes live.

## Composition: panel, not cutout

The head is cropped by the original frame at the top, the right edge and the
bottom. A background-removed "floating head" therefore has hard straight cuts
along those edges and reads as broken rather than intentional. A warm/cool
separation mask (subject is warm, wall is cool and bright) isolates the subject
reasonably well, but leaves fringes near the left ear and in the top corners
where wall highlights fall inside the warm threshold.

**Print the full square panel, teal wall included.** It preserves the
composition, it is a deliberate art-label look, and it avoids the cropped
silhouette entirely. The cutout files are supplied for completeness and are not
recommended.

The panel is opaque, so on a dark garment it needs a white underbase. That
changes hand-feel and unit cost, and the cost must come from a live supplier
quote rather than an assumption.

## Files produced

Under `artwork/print/` (gitignored — the artwork is not committed):

| File | Pixels | Purpose |
|---|---|---|
| `panel-180mm.png` | 1080² | **Master.** Recommended print, 152 DPI |
| `panel-137mm.png` | 1080² | Smaller, safer 200 DPI |
| `panel-91mm.png` | 1080² | Pocket size, full 300 DPI |
| `panel-180mm-cleaned.png` | 1080² | Mild artefact reduction (mean delta 0.33/255) |
| `cutout-180mm.png` | 1080² | Background removed — not recommended |
| `front-placement-panel.png` | 3600×4800 | Producer canvas, artwork placed |
| `front-placement-cutout-3600x4800.png` | 3600×4800 | Cutout on producer canvas |

All are PNG (lossless from here on) with an explicit `sRGB` chunk and `pHYs`
density set to declare the intended print size.

The placement canvases contain a 1.97× Lanczos upscale with a mild unsharp
mask, positioned 180 mm square, centred, with its top edge at 10% of the canvas
height. Effective resolution is unchanged at 152 DPI — the upscale exists so
the producer receives unambiguous placement, not to claim resolution.

## Processing applied

- JPEG → PNG. No further lossy compression.
- `sRGB` chunk and `pHYs` density written explicitly.
- No colour correction. Tonal range is 0–255 with only 9 pure-black pixels and
  no clipped whites, so there was nothing to fix.
- Artefact reduction offered as a separate variant only: an edge-aware median
  blend that smooths flat areas and leaves linework alone. The master is
  unprocessed so the artwork is preserved exactly.

## What would remove the constraint

The original at higher resolution. At 300 DPI a full 305 mm front print needs
3600 px; a 250 mm print needs 2953 px. If the painting exists as a physical
work, a flatbed scan at 600 DPI would cover any garment size and remove the
JPEG artefacts at the same time.
