# NIH 3D tooth viewer

**Live demo: [3dviewer-stl.vercel.app](https://3dviewer-stl.vercel.app)**

A NestJS app that serves one page: an interactive WebGL viewer for the NIH 3D Print Exchange
entry [3DPX-003002 — "Upper dental tooth model"](https://3d.nih.gov/entries/3dpx-003002)
(maxillary teeth with base) by Michael D. Scherer, DMD, MS, FACP, released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The mesh is **not** committed to the repo. The server downloads the 91 MB binary STL from
NIH 3D on the first request, verifies it, caches it on disk, and streams it (gzip-encoded,
~69 MB) to the browser on every later request.

## Run

```bash
npm install
npm run start:dev     # http://localhost:3000
```

The page loads whichever mesh is available:

- **`public/models/*.glb`** — the compressed build artefact, committed to the repo. Used when
  present (5.6 MB, loads in ~200 ms).
- **the STL** — otherwise the server downloads 91 MB from NIH 3D on first request and caches it
  in `.cache/models/`.

To regenerate the compressed mesh (needs the STL, which it downloads if missing):

```bash
npm run build:mesh              # lossless: 1.9M triangles, 5.9 MB
npm run build:mesh -- --ratio 0.35   # simplified: 666k triangles, 2.3 MB
```

## Routes

| Route                     | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `GET /`                   | Server-rendered viewer page (Handlebars)                    |
| `GET /api/model/metadata` | Title, author, license, triangle count, mesh URL            |
| `GET /api/model/:id.stl`  | Binary STL stream — gzip + `ETag`/`304` + `Cache-Control`   |
| `GET /static/*`           | Page CSS/JS                                                 |
| `GET /vendor/three/*`     | three.js ES modules served straight from `node_modules`      |

## Viewer

`public/js/viewer.js` is a plain ES module — no bundler, no CDN. three.js is resolved through
an import map that points at `/vendor/three/...`, which `ServeStaticModule` maps onto the
installed `three` package.

- Drag to orbit, scroll to zoom, right-drag to pan.
- View presets (reset / occlusal / front / side), auto-rotate, ground grid, section-plane slider.
- Panel can be hidden with its toggle or the `H` key.
- **Drop an STL or GLB onto the page** (or use *Open STL / GLB…*) to view your own model. The
  file is read with `File.arrayBuffer()` and parsed in the tab — nothing is uploaded, and the
  static deployment has no endpoint that could accept an upload. Binary and ASCII STL and
  self-contained GLB are supported; `.gltf` with external buffers is not.
  - **Orientation is measured, not guessed.** STL carries none, so while parsing, the worker
    accumulates the surface area facing each of the six axis directions (counting only faces
    within 15° of an axis). The largest flat side of a scan or print is its base, so "up" is the
    opposite of whichever way that side faces. On the NIH cast, +Y holds 61% of the axis-aligned
    area — six times the runner-up — which correctly yields −Y. When no direction dominates
    (a box has six equal sides) it falls back to the STL convention of +Z. GLB is taken at its
    word: glTF defines +Y as up. The panel's **up-axis** selector overrides either, and re-tilts
    without re-parsing.
  - Units are left as *unknown* rather than claiming millimetres — STL has no units and glTF's
    convention is metres. The header swaps to the file name so the NIH attribution never
    describes someone else's model.
- **QR** button renders a QR code for the page's own address, for handing the viewer to a phone
  mid-demo. It encodes `location.origin + location.pathname` at runtime, so it follows whatever
  host the page is served from, and prints the URL underneath — which also makes it obvious when
  you are showing a `localhost` address that nobody else can reach.
- German / English toggle and light / dark theme, both persisted in `localStorage`.
- Download progress is byte-accurate even under gzip, via `X-Uncompressed-Length`.

The model's display orientation lives in `TOOTH_MODEL.upAxis` (`-y` here — the cast is exported
base-up) and is applied client-side, since STL itself carries no orientation.

## Performance

1.9M triangles is enough that the naive path stutters. Measured on an M3 at a 3024×1754 drawing
buffer, before → after:

| Metric                              | Before  | After |
| ----------------------------------- | ------- | ----- |
| Frame cost                          | 1.92 ms | 1.11 ms |
| Frame time p95                      | 11.3 ms | 3.5 ms |
| Frames over 8.3 ms (120 Hz budget)  | 43%     | 0.04% |
| Main-thread stall during load       | 333 ms  | none  |
| Idle GPU work                       | every frame | none |

What does the work:

- **Parsing runs in a worker** (`public/js/stl-worker.js`). three's `STLLoader` can't be used
  there — it imports the bare specifier `three` and import maps are document-scoped — so the
  worker reads binary STL directly and transfers the attribute buffers back without copying.
  The main thread keeps `STLLoader` as a fallback for anything the worker rejects.
- **The worker also returns the bounding box**, measured while it is already touching every
  vertex. That removed a 294 ms main-thread stall from `computeBoundingBox`/`computeBoundingSphere`.
- **Centring uses an object-space offset**, not `geometry.translate()`, which would rewrite all
  5.7M vertices on the main thread.
- **Render on demand**: one frame per change instead of a permanent `requestAnimationFrame`
  loop. OrbitControls' `change` event re-arms it, so damping and auto-rotate still animate and
  the GPU goes fully idle afterwards.
- **Backface culling** (`FrontSide`); double-sided rendering and the clipping shader path are
  only switched on while the section plane is in use.
- **MSAA is disabled at ≥1.5× device pixel ratio**, where it costs fill rate and buys nothing.
- **`dampingFactor` 0.06 → 0.2**: the old value trailed the pointer by ~130 ms, which reads as
  lag no matter how fast the renderer is.

`window.__viewer` and `window.__timing` are exposed for profiling in the console.

### Payload

`scripts/build-mesh.mjs` converts the STL to a meshopt-compressed GLB. The STL stores three
unshared vertices per triangle with a flat face normal each, so dropping the normals lets the
weld merge 5.7M vertices down to 951k; smooth normals are then recomputed (gltf-transform's
`normals()` cannot be used — it un-indexes the primitive, undoing the weld).

| Output                     | Triangles | Size    | vs STL |
| -------------------------- | --------- | ------- | ------ |
| STL (source)               | 1,902,630 | 91 MB   | —      |
| GLB, `--ratio 1` (default) | 1,902,630 | 5.9 MB  | 16×    |
| GLB, `--ratio 0.35`        | 665,920   | 2.3 MB  | 41×    |
| GLB, `--ratio 0.15`        | 285,394   | 1.1 MB  | 85×    |

Load time on localhost went from 400 ms (fetch 341 + parse 33) to 73 ms (fetch 30 + parse 42).
Positions stay quantised as normalised `Int16` — half the GPU memory of `Float32` — so the
viewer carries the node's scale on the object instead of baking it into the attribute.

## Deploying to Vercel (free tier)

Deployed at [3dviewer-stl.vercel.app](https://3dviewer-stl.vercel.app).

The server design cannot be deployed as-is, for two reasons worth knowing before you try:

- A Vercel Function caps its **response body at 4.5 MB**, and the STL route streams 69 MB.
- **3d.nih.gov sends no CORS headers**, so the browser cannot fetch the mesh directly either
  (verified: `GET` with an `Origin` returns 200 with no `access-control-allow-origin`, and the
  preflight answers 204 with only `allow: GET, HEAD, OPTIONS`).

So the deployment is fully static — no functions, nothing to time out, nothing to cap:

```bash
npm run build:mesh      # only when the mesh changes; the .glb is committed
npm run build:static    # prerenders the page into out/  (8.3 MB total)
```

`out/` contains `index.html`, the viewer assets, the GLB, the eight three.js modules the page
actually imports, and the QR encoder. `vercel.json` already sets the build command, the output directory, and
cache headers (immutable for the content-hashed GLB, revalidate for the rest).

Then either:

- **Dashboard**: import `devdudeio/3dviewer_stl` at vercel.com/new. It reads `vercel.json`, so
  leave the framework preset on "Other" and don't override anything.
- **CLI**: `npx vercel` (preview) and `npx vercel --prod` (production).

Hobby-plan headroom: 8.3 MB per cold visitor against 100 GB/month of transfer is roughly 12,000
full loads, and repeat visits re-download nothing but the HTML.

Note the Hobby plan cannot connect repositories owned by a GitHub *organization* — `devdudeio`
is a personal account, so this repo is fine.

If you would rather not commit a 5.6 MB binary, drop `public/models/` from git and change the
Vercel build command to `npm run build:mesh && npm run build:static`; the build container then
pulls the STL from NIH 3D on every deploy, which costs about a minute and depends on NIH being up.

## Configuration

| Env var           | Default               | Meaning                 |
| ----------------- | --------------------- | ----------------------- |
| `PORT`            | `3000`                | HTTP port               |
| `MODEL_CACHE_DIR` | `<cwd>/.cache/models` | Where the STL is cached |

## Notes

- The model's own S3 URL advertised by NIH 3D is not publicly readable; `src/model/model.constants.ts`
  uses the entry's `3d.nih.gov/api/.../output-files/91756` endpoint instead.
- Downloads are validated (byte length + binary STL triangle-count header) before being cached,
  so an HTML error page can never end up in the cache.
- Concurrent first requests share a single upstream download.

## License

Code is MIT licensed — see [LICENSE](LICENSE). The 3D model itself is not part of this repo and
is public domain (CC0 1.0) via NIH 3D.
