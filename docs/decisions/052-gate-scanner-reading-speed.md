---
id: ADR-052
title: "Gate scanner reading speed: the phone's own reader first, a centre crop for WebAssembly"
date: 2026-10-04
status: accepted
area: Gate scanner
supersedes: []
extends: [ADR-030]
---

# ADR-052 — Gate scanner reading speed: the phone's own reader first, a centre crop for WebAssembly

**Date:** 2026-10-04 · **Status:** Accepted · extends [ADR-030](030-gate-scanner-slice-a.md)

**Context:** The gate scanner redesign (slice 2 of 4) aims at under 0.3 s
from a code entering the frame to the answer on screen. ADR-030 decoded
every frame with zxing-cpp compiled to WebAssembly: the full 720p frame,
about ten times a second, on the main thread. Chrome on Android ships its
own `BarcodeDetector` (Google's on-device reader); iOS Safari has none.

**Decision:**

- **The browser's own reader when it reads QR codes** (`getSupportedFormats`
  includes `qr_code`), else zxing. A reader that is declared but throws is
  treated as absent.
- **zxing reads the centre square** of the frame (75 % of the short side,
  scaled to at most 480 px: `centreCrop`), where the viewfinder asks staff
  to hold the code; **every 5th read is the full frame**, for a code held
  off to the side. The native reader gets the full frame.
- **Up to ~16 reads a second** (60 ms apart, one at a time), was 10.
- **Warm-up at Start:** one throw-away read on a blank image before the
  camera shows "on" (capped at 3 s). Measured: the native reader's first
  read took ~1.5 s, the next ones 12–17 ms; the first person in the queue
  must not pay for it.
- **Measured, not assumed:** the camera loop keeps a running average of one
  read (the first 3 left out) and exposes it with the reader's kind
  (`data-read-ms`, `data-decoder`) for the pre-doors test and e2e.
- **Never silent:** after 5 failed native reads in a row the loop swaps in
  zxing. The page always loads zxing before saving its offline copy
  (ADR-035), so a reload without signal has a reader that needs nothing
  from the phone.
- 1x/2x zoom and continuous focus where the camera offers them; a 20 ms
  click the moment a code is read, before the answer.

**Consequences:**

- `tests/e2e/door-camera.spec.ts` plays a generated video of a real ticket
  QR through Chromium's fake camera and admits it with each reader (the
  native one hidden for the second run). On the developer's Mac: native
  ~15 ms, zxing ~4 ms per read after warm-up; phones are slower, which the
  pre-doors test will show per device.
- Android phones also download the ~1 MB WebAssembly file once, for the
  offline copy.

**Rejected:** a Web Worker for zxing (the crop already brings a read to a
few ms; revisit if the pre-doors test shows slow phones); a commercial SDK
(native apps only, or licence cost, and a third party at the gate).
