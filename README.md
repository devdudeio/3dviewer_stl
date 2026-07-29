# NIH 3D tooth viewer

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

First page load takes as long as the upstream download; subsequent loads are served from
`.cache/models/`.

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
