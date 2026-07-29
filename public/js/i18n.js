/**
 * UI strings for the viewer. Values are either plain strings or functions that
 * receive the element's `data-n` value (or an array of runtime arguments).
 *
 * Model metadata (title, author, licence) is deliberately not translated — it
 * is quoted from the NIH 3D entry.
 */
const enNumber = new Intl.NumberFormat('en-US');
const deNumber = new Intl.NumberFormat('de-DE');

export const STRINGS = {
  en: {
    'link.entry': 'NIH 3D entry',
    'app.code': 'Viewer code: MIT © 2026 Robert Lech',
    'stats.triangles': ({ n }) => `${enNumber.format(Number(n))} triangles`,
    'stats.bytes': ({ n, fmt }) => `${n} MB ${fmt}`,
    'qr.title': 'Scan to open this viewer',
    'btn.close': 'Close',
    'lang.title': 'Switch to German',
    'theme.title': 'Toggle light / dark theme',
    'panel.hide': 'Hide panel (H)',
    'panel.show': 'Show panel (H)',
    'loading.fetch': 'Loading model…',
    'loading.hint': ({ n }) =>
      `First load pulls ${n} MB from 3d.nih.gov and caches it on the server.`,
    'loading.hintGlb': ({ n }) =>
      `Streaming a ${n} MB compressed mesh built from the NIH 3D original.`,
    'loading.building': 'Building geometry…',
    'loading.progress': ([received, total]) => `Downloading ${received} of ${total}`,
    'loading.progressUnknown': (received) => `Downloading ${received}`,
    'error.webgl': 'WebGL is not available in this browser, so the model cannot be displayed.',
    'error.status': (status) => `The server returned ${status} while fetching the model.`,
    'error.generic': 'The model could not be loaded. Please retry.',
    'btn.retry': 'Retry',
    'view.reset': 'Reset',
    'view.top': 'Occlusal',
    'view.front': 'Front',
    'view.side': 'Side',
    'toggle.autorotate': 'Auto-rotate',
    'toggle.grid': 'Ground grid',
    'label.clip': 'Clip',
    'clip.off': 'off',
    'facts.size': 'Size',
    'facts.units': 'Units',
    help: 'Drag to orbit · scroll to zoom · right-drag or two-finger drag to pan. Press H or ☰ to hide this panel.',
  },
  de: {
    'link.entry': 'NIH-3D-Eintrag',
    'app.code': 'Viewer-Code: MIT © 2026 Robert Lech',
    'stats.triangles': ({ n }) => `${deNumber.format(Number(n))} Dreiecke`,
    'stats.bytes': ({ n, fmt }) => `${n} MB ${fmt}`,
    'qr.title': 'Zum Öffnen des Viewers scannen',
    'btn.close': 'Schließen',
    'lang.title': 'Auf Englisch umschalten',
    'theme.title': 'Helles / dunkles Design umschalten',
    'panel.hide': 'Bedienfeld ausblenden (H)',
    'panel.show': 'Bedienfeld einblenden (H)',
    'loading.fetch': 'Modell wird geladen…',
    'loading.hint': ({ n }) =>
      `Beim ersten Laden werden ${n} MB von 3d.nih.gov geholt und auf dem Server zwischengespeichert.`,
    'loading.hintGlb': ({ n }) =>
      `Es werden ${n} MB komprimierte Geometrie geladen, erzeugt aus dem NIH-3D-Original.`,
    'loading.building': 'Geometrie wird aufgebaut…',
    'loading.progress': ([received, total]) => `${received} von ${total} geladen`,
    'loading.progressUnknown': (received) => `${received} geladen`,
    'error.webgl': 'WebGL ist in diesem Browser nicht verfügbar, das Modell kann nicht angezeigt werden.',
    'error.status': (status) => `Der Server hat beim Laden des Modells ${status} zurückgegeben.`,
    'error.generic': 'Das Modell konnte nicht geladen werden. Bitte erneut versuchen.',
    'btn.retry': 'Erneut versuchen',
    'view.reset': 'Zurücksetzen',
    'view.top': 'Okklusal',
    'view.front': 'Frontal',
    'view.side': 'Seitlich',
    'toggle.autorotate': 'Autorotation',
    'toggle.grid': 'Bodenraster',
    'label.clip': 'Schnitt',
    'clip.off': 'aus',
    'facts.size': 'Größe',
    'facts.units': 'Einheiten',
    help: 'Ziehen zum Drehen · Scrollen zum Zoomen · Rechtsziehen oder Zwei-Finger-Ziehen zum Verschieben. Mit H oder ☰ das Bedienfeld ausblenden.',
  },
};
