import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { STRINGS } from './i18n.js';
import { isBinaryStl } from './stl-parse.js';

const config = document.querySelector('script[data-mesh-url]')?.dataset ?? {};
const meshUrl = config.meshUrl ?? '/api/model/mesh.stl';
/** 'glb' for the compressed build artefact, 'stl' for the raw NIH download. */
const meshFormat = config.meshFormat === 'glb' ? 'glb' : 'stl';
/** Rotation about X that brings the file's up axis onto three.js' +Y. */
const UP_AXIS_TILT = { y: 0, '-y': Math.PI, z: -Math.PI / 2, '-z': Math.PI / 2 };
const upTilt = UP_AXIS_TILT[config.upAxis] ?? 0;

const THEMES = {
  dark: { background: 0x0d1014, grid: [0x35414f, 0x222a33], icon: '☾' },
  // The cast is near-white, so the light scene sits a few shades below the
  // page chrome to keep the silhouette readable.
  light: { background: 0xdbe2ea, grid: [0x8ca0b3, 0xb4c1cd], icon: '☀' },
};

const el = {
  canvas: document.getElementById('viewport'),
  loader: document.getElementById('loader'),
  loaderBar: document.getElementById('loader-bar'),
  loaderLabel: document.getElementById('loader-label'),
  error: document.getElementById('error'),
  errorMessage: document.getElementById('error-message'),
  retry: document.getElementById('retry'),
  panel: document.getElementById('panel'),
  panelToggle: document.getElementById('panel-toggle'),
  viewButtons: document.querySelectorAll('button[data-view]'),
  autorotate: document.getElementById('autorotate'),
  grid: document.getElementById('grid'),
  clip: document.getElementById('clip'),
  clipValue: document.getElementById('clip-value'),
  factSize: document.getElementById('fact-size'),
  lang: document.getElementById('lang'),
  theme: document.getElementById('theme'),
  themeIcon: document.getElementById('theme-icon'),
  qr: document.getElementById('qr'),
  qrModal: document.getElementById('qr-modal'),
  qrCode: document.getElementById('qr-code'),
  qrUrl: document.getElementById('qr-url'),
  qrClose: document.getElementById('qr-close'),
};

/* ------------------------------------------------------------------ i18n */

let lang = document.documentElement.lang === 'de' ? 'de' : 'en';

function t(key, args) {
  const entry = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return typeof entry === 'function' ? entry(args) : entry;
}

function applyLanguage() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n, node.dataset);
  }
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
  }
  el.lang.textContent = lang === 'de' ? 'EN' : 'DE';
  el.panelToggle.title = t(panelOpen() ? 'panel.hide' : 'panel.show');
  refreshDynamicText();
}

/** Re-renders the strings that carry live values rather than static markup. */
function refreshDynamicText() {
  if (modelSize) {
    el.factSize.textContent = `${modelSize.x.toFixed(0)} × ${modelSize.z.toFixed(
      0,
    )} × ${modelSize.y.toFixed(0)} mm`;
  }
  const clipPercent = Number(el.clip.value);
  el.clipValue.textContent = clipPercent >= 100 ? t('clip.off') : `${clipPercent}%`;
}

/* ----------------------------------------------------------------- setup */

function fatal(message) {
  el.loader.hidden = true;
  el.errorMessage.textContent = message;
  el.retry.hidden = true;
  el.error.hidden = false;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: el.canvas,
    // MSAA buys almost nothing at >=1.5x device pixel ratio but costs real
    // fill rate, so it is only enabled on low-density displays.
    antialias: window.devicePixelRatio < 1.5,
    powerPreference: 'high-performance',
  });
} catch (error) {
  fatal(t('error.webgl'));
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Low damping trails the pointer by ~130 ms and reads as lag; this settles in
// about a third of that while still feeling smooth.
controls.dampingFactor = 0.2;
controls.rotateSpeed = 0.9;
controls.zoomToCursor = true;
controls.autoRotateSpeed = 1.6;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
keyLight.position.set(1, 1.4, 1);
const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.7);
fillLight.position.set(-1.2, 0.4, -0.8);
scene.add(keyLight, fillLight, new THREE.HemisphereLight(0xdfe8ff, 0x1a1d22, 0.5));

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), Number.POSITIVE_INFINITY);

const material = new THREE.MeshStandardMaterial({
  color: 0xf2ece2,
  roughness: 0.42,
  metalness: 0.02,
  // Backface culling halves the fragment work; the mesh is closed, so the only
  // time interior faces matter is while the section plane is active.
  side: THREE.FrontSide,
});

/** Camera framing derived from the loaded geometry. */
const view = { target: new THREE.Vector3(), distance: 10, height: 1 };
let mesh = null;
let grid = null;
let modelSize = null;

/* ------------------------------------------------------- render on demand */

let frameRequested = false;

/**
 * Renders exactly one frame per request instead of running a permanent rAF
 * loop. OrbitControls' 'change' event re-arms it, so damping and auto-rotate
 * keep animating while they need to and the GPU goes fully idle afterwards.
 */
function requestRender() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame() {
  frameRequested = false;
  controls.update(); // fires 'change' -> requestRender while still moving
  renderer.render(scene, camera);
  if (controls.autoRotate) requestRender();
}

controls.addEventListener('change', requestRender);

function resize() {
  const { clientWidth: w, clientHeight: h } = renderer.domElement;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}

/* ------------------------------------------------------------------ views */

// This cast's anterior teeth face -Z, so "front" looks down the -Z axis.
const VIEW_DIRECTIONS = {
  reset: [-0.55, 0.5, -0.75],
  top: [0, 1, 0.001],
  front: [0, 0.12, -1],
  side: [1, 0.12, 0],
};

function setView(name) {
  const d = view.distance;
  const dir = new THREE.Vector3(...(VIEW_DIRECTIONS[name] ?? VIEW_DIRECTIONS.reset)).setLength(d);
  camera.position.copy(view.target).add(dir);
  controls.target.copy(view.target);
  camera.near = d / 100;
  camera.far = d * 100;
  camera.updateProjectionMatrix();
  controls.update();
  requestRender();
}

/* ------------------------------------------------------------------ theme */

function applyTheme(name) {
  const theme = THEMES[name] ?? THEMES.dark;
  document.documentElement.dataset.theme = name;
  localStorage.setItem('viewer.theme', name);
  el.themeIcon.textContent = theme.icon;
  scene.background = new THREE.Color(theme.background);
  if (grid) {
    grid.material.color.setHex(theme.grid[0]);
    grid.material.dispose();
    scene.remove(grid);
    grid = null;
    addGrid();
  }
  requestRender();
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/* ------------------------------------------------------------------- load */

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Streams the STL so we can report real progress. `X-Uncompressed-Length` lets
 * the bar stay accurate when the server sends a gzip-encoded body, and lets us
 * allocate the destination once instead of concatenating ~1400 chunks.
 */
async function fetchMesh() {
  const response = await fetch(meshUrl);
  if (!response.ok) {
    throw new Error(t('error.status', response.status));
  }

  const total =
    Number(response.headers.get('x-uncompressed-length')) ||
    Number(response.headers.get('content-length')) ||
    0;

  const reader = response.body.getReader();
  let buffer = total ? new Uint8Array(total) : null;
  const chunks = buffer ? null : [];
  let received = 0;
  let lastPaint = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    if (buffer && received + value.length <= buffer.length) {
      buffer.set(value, received);
    } else {
      // Upstream length disagreed with the header: fall back to collecting.
      if (buffer) {
        chunks?.push(buffer.subarray(0, received));
        buffer = null;
      }
      chunks.push(value);
    }
    received += value.length;

    // Throttle DOM writes: repainting per 64 KB chunk is pure jank.
    if (performance.now() - lastPaint > 100) {
      lastPaint = performance.now();
      const ratio = total ? received / total : 0;
      el.loaderBar.style.width = `${Math.min(ratio, 1) * 100}%`;
      el.loaderLabel.textContent = total
        ? t('loading.progress', [formatBytes(received), formatBytes(total)])
        : t('loading.progressUnknown', formatBytes(received));
    }
  }

  if (buffer) return buffer.buffer;

  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined.buffer;
}

/**
 * Decodes the meshopt-compressed GLB produced by `npm run build:mesh`.
 * Loaded lazily so the STL path never pays for GLTFLoader.
 */
async function parseGlb(buffer) {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  let mesh = null;
  gltf.scene.traverse((object) => {
    if (!mesh && object.isMesh) mesh = object;
  });
  if (!mesh) throw new Error('the GLB contains no mesh');

  // Quantisation (KHR_mesh_quantization) stores positions as normalised Int16
  // and leaves the real scale on the node — the bare geometry is ~2 units
  // across, not 66 mm. The matrix is returned rather than baked in: baking it
  // would corrupt the integer attribute, and the quantised form is half the
  // GPU memory of Float32.
  mesh.updateWorldMatrix(true, false);
  return { geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() };
}

/**
 * Parses the STL in a worker so the ~330 ms of parsing never freezes the page.
 * The buffer is only transferred once we know the worker can handle it, so the
 * main-thread fallback always has an intact buffer to work with.
 */
function parseStl(buffer) {
  return new Promise((resolve, reject) => {
    let worker;
    if (!isBinaryStl(buffer)) {
      resolve({ geometry: new STLLoader().parse(buffer), matrix: null });
      return;
    }
    try {
      worker = new Worker('/static/js/stl-worker.js', { type: 'module' });
    } catch {
      resolve({ geometry: new STLLoader().parse(buffer), matrix: null });
      return;
    }

    worker.onerror = () => {
      worker.terminate();
      // Retry on the main thread only if the transfer has not detached it yet.
      if (buffer.byteLength) resolve({ geometry: new STLLoader().parse(buffer), matrix: null });
      else reject(new Error(t('error.generic')));
    };
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
      // Bounds measured during parsing, so three never has to walk the vertices.
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(...data.min),
        new THREE.Vector3(...data.max),
      );
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      resolve({ geometry, matrix: null });
    };
    worker.postMessage(buffer, [buffer]);
  });
}

function addGrid() {
  const theme = THEMES[currentTheme()];
  grid = new THREE.GridHelper(view.distance * 2, 24, theme.grid[0], theme.grid[1]);
  grid.position.set(view.target.x, view.target.y - view.height / 2, view.target.z);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.visible = el.grid.checked;
  scene.add(grid);
}

function addMesh({ geometry, matrix }) {
  // Both are already supplied by the worker; this covers the fallback parser.
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.attributes.normal) geometry.computeVertexNormals();

  mesh = new THREE.Mesh(geometry, material);
  if (matrix) mesh.applyMatrix4(matrix);

  // Recentring happens on the object, not with geometry.translate(), which
  // would rewrite every vertex on the main thread. Three levels: the pivot
  // tilts the model upright, the middle group centres it, the mesh keeps any
  // transform the source file carried.
  const centring = new THREE.Group().add(mesh);
  const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  centring.position.copy(center).negate();

  const pivot = new THREE.Group();
  pivot.rotation.x = upTilt;
  pivot.add(centring);
  scene.add(pivot);

  const bounds = new THREE.Box3().setFromObject(pivot);
  modelSize = bounds.getSize(new THREE.Vector3());
  view.target.copy(bounds.getCenter(new THREE.Vector3()));
  view.distance = Math.max(modelSize.x, modelSize.y, modelSize.z) * 1.9;
  view.height = modelSize.y;

  addGrid();

  controls.minDistance = view.distance * 0.05;
  controls.maxDistance = view.distance * 6;
  setView('reset');
  refreshDynamicText();
}

async function load() {
  el.error.hidden = true;
  el.loader.hidden = false;
  el.loaderBar.style.width = '0%';
  el.loaderLabel.textContent = t('loading.fetch');

  try {
    const tFetch = performance.now();
    const buffer = await fetchMesh();
    el.loaderBar.style.width = '100%';
    el.loaderLabel.textContent = t('loading.building');
    // Yield twice so the label actually paints before the parser blocks.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    const tParse = performance.now();
    const geometry = meshFormat === 'glb' ? await parseGlb(buffer) : await parseStl(buffer);
    const tAdd = performance.now();
    addMesh(geometry);
    const tDone = performance.now();
    window.__timing = {
      fetch: Math.round(tParse - tFetch),
      parse: Math.round(tAdd - tParse),
      addMesh: Math.round(tDone - tAdd),
    };
    el.loader.hidden = true;
    modelLoaded = true;
    el.panelToggle.hidden = false;
    setPanelOpen(localStorage.getItem('viewer.panel') !== 'closed');
  } catch (error) {
    el.loader.hidden = true;
    el.errorMessage.textContent = error instanceof Error ? error.message : t('error.generic');
    el.error.hidden = false;
  }
}

/* ---------------------------------------------------------------- qr code */

/**
 * QR code for the page's own address, so the viewer can be handed to a phone
 * during a demo. Encoded at runtime rather than at build time so it follows
 * whatever host the page is actually served from; the URL is printed beneath
 * it, which also makes a localhost address obvious rather than confusing.
 */
let qrShownFor = null;

async function openQr() {
  const url = `${location.origin}${location.pathname}`;

  if (qrShownFor !== url) {
    try {
      const { default: encodeQR } = await import('/vendor/qr/index.js');
      // border: 4 is the quiet zone the QR spec requires. With 2, longer URLs
      // produce enough modules that scanners fail to lock onto the code.
      el.qrCode.innerHTML = encodeQR(url, 'svg', { ecc: 'medium', border: 4 });
      qrShownFor = url;
    } catch {
      el.qrCode.textContent = url;
    }
  }

  el.qrUrl.textContent = url;
  el.qrModal.hidden = false;
  el.qrClose.focus();
}

function closeQr() {
  el.qrModal.hidden = true;
  el.qr.focus();
}

/* --------------------------------------------------------------- controls */

let modelLoaded = false;

function panelOpen() {
  return el.panelToggle.getAttribute('aria-expanded') === 'true';
}

function setPanelOpen(open) {
  // The panel stays out of the way until there is something to control.
  el.panel.hidden = !(open && modelLoaded);
  el.panelToggle.setAttribute('aria-expanded', String(open));
  el.panelToggle.title = t(open ? 'panel.hide' : 'panel.show');
  localStorage.setItem('viewer.panel', open ? 'open' : 'closed');
}

function bindControls() {
  el.viewButtons.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  el.autorotate.addEventListener('change', () => {
    controls.autoRotate = el.autorotate.checked;
    requestRender();
  });

  el.grid.addEventListener('change', () => {
    if (grid) grid.visible = el.grid.checked;
    requestRender();
  });

  el.clip.addEventListener('input', () => {
    const percent = Number(el.clip.value);
    const off = percent >= 100;
    // The clipping shader path and double-sided rendering are only paid for
    // while the section plane is actually in use.
    renderer.localClippingEnabled = !off;
    material.clippingPlanes = off ? null : [clipPlane];
    material.side = off ? THREE.FrontSide : THREE.DoubleSide;
    material.needsUpdate = true;
    if (!off) {
      // Plane normal is -Y, so constant = cut height keeps everything below it.
      clipPlane.constant = view.target.y - view.height / 2 + (view.height * percent) / 100;
    }
    refreshDynamicText();
    requestRender();
  });

  el.panelToggle.addEventListener('click', () => setPanelOpen(!panelOpen()));

  el.lang.addEventListener('click', () => {
    lang = lang === 'de' ? 'en' : 'de';
    localStorage.setItem('viewer.lang', lang);
    applyLanguage();
  });

  el.theme.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  el.retry.addEventListener('click', load);

  el.qr.addEventListener('click', openQr);
  el.qrClose.addEventListener('click', closeQr);
  // Clicking the backdrop, but not the card itself, dismisses the dialog.
  el.qrModal.addEventListener('click', (event) => {
    if (event.target === el.qrModal) closeQr();
  });

  document.addEventListener('keydown', (event) => {
    const qrOpen = !el.qrModal.hidden;
    if (event.key === 'Escape' && qrOpen) {
      closeQr();
      return;
    }
    if (event.key === 'h' && !qrOpen && !event.metaKey && !event.ctrlKey && !el.panelToggle.hidden) {
      setPanelOpen(!panelOpen());
    }
  });
}

// Debug handle: lets the perf harness (and the console) inspect the live scene.
window.__viewer = {
  renderer,
  scene,
  camera,
  controls,
  material,
  requestRender,
  get mesh() {
    return mesh;
  },
};

window.addEventListener('resize', resize);
bindControls();
applyTheme(currentTheme());
applyLanguage();
setPanelOpen(localStorage.getItem('viewer.panel') !== 'closed');
resize();
void load();
