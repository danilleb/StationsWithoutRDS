'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

const config = require('../../config.json');
const { logInfo, logError } = require('../../server/console');

function throttleLeading(fn, intervalMs) {
  let lastCallTs = 0;

  function throttled(...args) {
    const now = Date.now();
    if (now - lastCallTs >= intervalMs) {
      lastCallTs = now;
      fn.apply(this, args);
    }
  }

  throttled.reset = () => {
    lastCallTs = 0;
  };

  return throttled;
}

/* ================= PATHS / CONFIG FILE ================= */

const rootDir = path.dirname(require.main.filename);
const cfgDir = path.join(rootDir, 'plugins_configs');
const cfgFile = path.join(cfgDir, 'StationsWithoutRDS.json');

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function writeJsonSync(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function readJsonSafe(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return { ...fallback };

    const out = { ...fallback, ...obj };
    if (!Array.isArray(out.myStantions)) out.myStantions = [];
    out.mode = Number(out.mode) || 1;
    out.thresholdSignal = Number(out.thresholdSignal ?? fallback.thresholdSignal);
    out.stableTime = Number(out.stableTime ?? fallback.stableTime); // seconds
    out.maxDistanceKm = Number(out.maxDistanceKm ?? fallback.maxDistanceKm);
    out.refreshStationsMs = Number(out.refreshStationsMs ?? fallback.refreshStationsMs);

    return out;
  } catch {
    return { ...fallback };
  }
}

const defaultConfig = {
  mode: 1,
  myStantions: [],
  thresholdSignal: 10, // dBµV
  stableTime: 3, // seconds
  maxDistanceKm: 500, // km
  refreshStationsMs: 24, // hours
};

ensureDirSync(cfgDir);
if (!fs.existsSync(cfgFile)) writeJsonSync(cfgFile, defaultConfig);

let pluginConfig = readJsonSafe(cfgFile, defaultConfig);
writeJsonSync(cfgFile, pluginConfig);


let lastFrequency = null;
let signalFixed = false

/* ================= QTH ================= */

const qthLat = Number(config?.identification?.lat);
const qthLon = Number(config?.identification?.lon);

if (!qthLat || !qthLon) {
  logError('[StationsWithoutRDS] QTH coordinates are missing in config.json (identification.lat/lon)');
}

/* ================= GEO ================= */

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function normalizeFreq(f) {
  const n = Number(f);
  if (!Number.isFinite(n)) return null;
  let min, max, stepKHz;
  if (n >= 65.9 && n <= 74.0) {
    min = 65.9; max = 74.0; stepKHz = 30;
  } else if (n > 74.0 && n <= 108.0) {
    min = 74.0; max = 108.0; stepKHz = 100;
  } else if (n === 74.0) {
    min = 74.0; max = 108.0; stepKHz = 100;
  } else {
    return null;
  }
  const khz = n * 1000;
  const roundedKHz = Math.round(khz / stepKHz) * stepKHz;
  const out = roundedKHz / 1000;
  if (out < min - 1e-9 || out > max + 1e-9) return null;
  return Number(out.toFixed(3));
}


function normalizePi(pi) {
  const s = String(pi ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return s ? s : null;
}

function normalizeName(str = '') {
  return String(str)
    .toUpperCase()
    .replace(/RADIO/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\w]/g, '');
}

/* ================= MAPS.FMDX CACHE ================= */

let locationsCache = [];
let lastStationsLoadTs = 0;

async function loadStationsFromMaps() {
  if (!qthLat || !qthLon) return;

  try {
    const url =
      `https://proxy.fm-tuner.ru/https://maps.fmdx.org/api/?qth=${qthLat},${qthLon}&date=${new Date().toLocaleDateString('en-CA')}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`maps.fmdx HTTP ${res.status}`);

    const json = await res.json();
    locationsCache = Object.values(json.locations || {});
    lastStationsLoadTs = Date.now();

    logInfo('[StationsWithoutRDS] maps.fmdx loaded:', locationsCache.length);
  } catch (e) {
    logError('[StationsWithoutRDS] maps.fmdx load failed', e);
  }
}

// стартовая загрузка
loadStationsFromMaps();

// периодическое обновление (по refreshStationsMs из конфига)
setInterval(() => {
  pluginConfig = readJsonSafe(cfgFile, defaultConfig);

  const hours = Number(pluginConfig.refreshStationsMs || 24);
  const intervalMs = hours * 60 * 60 * 1000;

  if (!lastStationsLoadTs || Date.now() - lastStationsLoadTs >= intervalMs) {
    loadStationsFromMaps();
  }
}, 60 * 1000);

/* ================= LOGOS ================= */

const logosDir = path.join(rootDir, 'web', 'logos');
let localLogos = {};

try {
  if (fs.existsSync(logosDir)) {
    const files = fs.readdirSync(logosDir);

    for (const file of files) {
      if (!/\.(png|svg|gif|jpg|jpeg)$/i.test(file)) continue;
      const nameWithoutExt = file.replace(/\.[^.]+$/, '');
      const key = normalizeName(nameWithoutExt);
      if (key) localLogos[key] = file;
    }
    logInfo('[StationsWithoutRDS] local logos loaded:', Object.keys(localLogos).length);
  } else {
    logInfo('[StationsWithoutRDS] logos directory not found:', logosDir);
  }
} catch (e) {
  logError('[StationsWithoutRDS] failed to load local logos', e);
}

const noobishCache = {}; // ITU -> [files]

async function getNoobishLogos(itu) {
  const key = String(itu || '').toUpperCase();
  if (!key) return [];
  if (noobishCache[key]) return noobishCache[key];

  try {
    const url = `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${key}/`;
    const res = await fetch(url);
    if (!res.ok) {
      noobishCache[key] = [];
      return [];
    }

    const html = await res.text();
    const files = [...html.matchAll(/href="([^"]+\.(png|svg|gif))"/gi)]
      .map((m) => m[1])
      .filter(Boolean);

    noobishCache[key] = files;
    return files;
  } catch {
    noobishCache[key] = [];
    return [];
  }
}

async function findLogoUrl(st) {
  const itu = String(st?.itu || '').toUpperCase() || 'RUS';
  const target = normalizeName(st?.station || '');

  // 1) локальные
  if (localLogos && typeof localLogos === 'object') {
    const keys = Object.keys(localLogos);

    const tryFind = (search, strongly = false) => {
      if (!search) return null;
      const searchNorm = normalizeName(search);
      // 1️⃣ Строгое совпадение
      for (const k of keys) {
        const localKeyNorm = normalizeName(k);
        if (localKeyNorm === searchNorm) {
          const file = localLogos[k];
          if (file) return `/logos/${file}`;
        }
      }
      // 2️⃣ Частичное совпадение
      if (strongly) {
        for (const k of keys) {
          const localKeyNorm = normalizeName(k);
          if (
            localKeyNorm.includes(searchNorm) ||
            searchNorm.includes(localKeyNorm)
          ) {
            const file = localLogos[k];
            if (file) return `/logos/${file}`;
          }
        }
      }
      return null;
    };
    // потом target
    const result = tryFind(target);
    if (result) return result;

    // сначала st.pi
    if (st?.pi && (st?.pi || '').toUpperCase() !== 'NOPI') {
      const result = tryFind(st.pi, true);
      if (result) return result;
    }

  }

  // 2) noobish
  const files = await getNoobishLogos(itu);
  if (files.length) {
    const sName = String(st?.station || '').toUpperCase();
    const normalizeStrong = (s) => normalizeName(s).replace(/^RADIO/, '').replace(/RADIO/g, '');
    const stripExt = (s) => s.replace(/\.(svg|gif|webp|png|jpg|jpeg)$/i, '');
    const fNormOf = (file) => normalizeStrong(stripExt(file));

    if (st.pi) {
      for (const file of files) {
        const fNorm = stripExt(file);
        if (`${normalizeName(st.pi)}_${sName.replaceAll(' ', '')}` === fNorm) {
          return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${itu}/${file}`;
        }
      }
      for (const file of files) {
        const fNorm = stripExt(file);
        if (`${normalizeName(st.pi)}` === fNorm) {
          return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${itu}/${file}`;
        }
      }
    }

    const candidates = [
      normalizeName(sName),
      normalizeName(sName.replace('RADIO', '')),
      normalizeName(sName.replaceAll(' ', '')),
      normalizeName(sName.replace('RADIO', '').replaceAll(' ', '')),
    ].filter(Boolean);

    const candNorm = candidates.map(normalizeStrong);

    for (const file of files) {
      const fNorm = fNormOf(file);
      if (candNorm.includes(fNorm)) {
        return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${itu}/${file}`;
      }
    }

    for (const file of files) {
      const fNorm = fNormOf(file);
      if (candNorm.some((n) => n.length >= 4 && (fNorm.includes(n) || n.includes(fNorm)))) {
        return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${itu}/${file}`;
      }
    }
  }

  return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/default-logo.png`;
}

/* ================= SEARCH ================= */

function buildRecordFromLocStation(loc, st) {
  const distance = haversine(qthLat, qthLon, Number(loc.lat), Number(loc.lon));
  const az = bearing(qthLat, qthLon, Number(loc.lat), Number(loc.lon));
  return {
    freq: normalizeFreq(st.freq),
    station: (st.station || 'Unknown').replace('R.', 'Radio '),
    location: loc.name || '',
    itu: String(loc.itu || '').toUpperCase(),
    distance: Math.round(Number(distance)),
    azimuth: Math.round(az),
    pi: st.pi || '',
    pol: st.pol || '',
    erp: st.erp ?? null,
  };
}

async function searchInMaps(freq, pi) {
  const f = normalizeFreq(freq);
  const p = normalizePi(pi);
  if (f === null && !p) return [];

  const maxD = Number(pluginConfig.maxDistanceKm || 500);
  const result = [];

  for (const loc of locationsCache) {
    const d = haversine(qthLat, qthLon, Number(loc.lat), Number(loc.lon));
    if (d > maxD) continue;

    for (const st of loc.stations || []) {
      if (st.inactive) continue;
      if (f !== null && normalizeFreq(st.freq) !== f) continue;
      if (p && normalizePi(st.pi) !== p) continue;
      result.push(buildRecordFromLocStation(loc, st));
    }
  }

  result.sort((a, b) => Number(a.distance) - Number(b.distance));
  for (const r of result) r.logoUrl = await findLogoUrl(r);

  return result;
}

async function searchInMyStations(freq, pi, ant) {
  const f = normalizeFreq(freq);
  const p = normalizePi(pi);
  if (f === null && !p) return [];

  const list = Array.isArray(pluginConfig.myStantions)
    ? pluginConfig.myStantions
    : [];

  const filtered = list
    .filter((s) => {
      if (f !== null && normalizeFreq(s.freq) !== f) return false;
      if ('antenna' in s) {
        const sAnt = Number(s.antenna ?? s.ant ?? 0);
        if (Number(ant) !== sAnt) return false;
      }

      return true;
    })
    .map((s) => ({
      freq: normalizeFreq(s.freq),
      station: s.station || 'Unknown',
      location: s.location || '',
      itu: String(s.itu || '').toUpperCase(),
      distance: Number((Number(s.distance) || 0).toFixed(1)),
      azimuth: Math.round(Number(s.azimuth) || 0),
      pi: s.pi || '',
      pol: s.pol || '',
      erp: s.erp ?? null,
      logoUrl: s.logoUrl || null,
    }));

  filtered.sort((a, b) => Number(a.distance) - Number(b.distance));

  for (const r of filtered) {
    if (!r.logoUrl) r.logoUrl = await findLogoUrl(r);
  }

  return filtered;
}



async function searchStations(freq, pi, ant) {
  pluginConfig = readJsonSafe(cfgFile, defaultConfig);
  const mode = Number(pluginConfig.mode || 1);

  if (mode === 2) return await searchInMyStations(freq, pi, ant);
  if (mode === 3) {
    const first = await searchInMyStations(freq, pi, ant);
    if (first.length) return first;
    return await searchInMaps(freq, pi);
  }
  return await searchInMaps(freq, pi);
}

/* ================= WS ENDPOINTS ================= */

const pluginName = 'StationsWithoutRDS';
const PORT = config?.webserver?.webserverPort || 8080;
const WS_BASE = `ws://127.0.0.1:${PORT}`;

let wsPlugins = null; // /data_plugins
let wsText = null; // /text

function wsSendPlugins(obj) {
  try {
    if (wsPlugins && wsPlugins.readyState === WebSocket.OPEN) {
      wsPlugins.send(JSON.stringify(obj));
    }
  } catch {
    // ignore
  }
}

/* ================= RESET UI ON FREQ CHANGE ================= */

function resetMonitorState() {
  monitorState.pendingFrequency = null;
  monitorState.pendingPi = null;
  monitorState.pendingAnt = null;

  if (monitorState.stableTimer) clearTimeout(monitorState.stableTimer);
  monitorState.stableTimer = null;

  stopFindBroadcast();
}


function resetAllOnFrequencyChange() {
  // monitor
  resetMonitorState();

  // TX throttle
  throttledSendTx.reset();

  // очистить UI (пустой find)
  wsSendPlugins({
    type: pluginName,
    value: {
      action: 'find',
      freq: null,
      pi: null,
      ts: Date.now(),
      list: [],
    },
  });
}

/* ================= MONITOR /text -> BROADCAST find каждые 3 сек ================= */

const monitorState = {
  pendingFrequency: null,
  pendingPi: null,
  pendingAnt: null,
  stableTimer: null,

  active: false,
  activeFrequency: null,
  activePi: null,
  ant: null,

  broadcastTimer: null,
  lastBroadcastAt: 0,
};


function stopFindBroadcast() {
  monitorState.active = false;
  monitorState.activeFrequency = null;
  monitorState.activePi = null;

  if (monitorState.broadcastTimer) clearInterval(monitorState.broadcastTimer);
  monitorState.broadcastTimer = null;
  monitorState.lastBroadcastAt = 0;
}

async function broadcastFindOnce() {
  if (!monitorState.active || !monitorState.activeFrequency) return;

  const freq = monitorState.activeFrequency;
  const pi = monitorState.activePi;
  const ant = monitorState.ant;

  try {
    const list = await searchStations(freq, pi, ant);

    wsSendPlugins({
      type: pluginName,
      value: {
        action: 'find',
        freq,
        pi: pi || null,
        ts: Date.now(),
        list,
      },
    });

    monitorState.lastBroadcastAt = Date.now();
  } catch (e) {
    logError('[StationsWithoutRDS] broadcastFindOnce failed', e);
  }
}

function startFindBroadcast(freq, pi, ant) {
  monitorState.active = true;
  monitorState.activeFrequency = freq;
  monitorState.activePi = pi || null;
  monitorState.ant = ant;

  // сразу отправляем
  broadcastFindOnce();

  if (monitorState.broadcastTimer) clearInterval(monitorState.broadcastTimer);

  monitorState.broadcastTimer = setInterval(() => {
    broadcastFindOnce();
  }, 3000);
}

function getThresholdForFrequency(freq, pluginConfig) {
  const f = Number(freq);
  if (!Number.isFinite(f)) {
    return Number(pluginConfig.thresholdSignal ?? 10);
  }

  const map = pluginConfig.thresholdSignals;

  // ❗ если thresholdSignals нет — используем старый thresholdSignal
  if (!map || typeof map !== 'object') {
    return Number(pluginConfig.thresholdSignal ?? 10);
  }

  // 1️⃣ точная частота
  for (const key of Object.keys(map)) {
    if (key === 'all') continue;
    if (!key.includes('-')) {
      const kf = Number(key);
      if (Number.isFinite(kf) && Math.abs(kf - f) < 0.0001) {
        return Number(map[key]);
      }
    }
  }

  // 2️⃣ диапазоны
  for (const key of Object.keys(map)) {
    if (!key.includes('-')) continue;

    const [a, b] = key.split('-').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    const min = Math.min(a, b);
    const max = Math.max(a, b);

    if (f >= min && f <= max) {
      return Number(map[key]);
    }
  }

  // 3️⃣ all
  if (map.all !== undefined) {
    return Number(map.all);
  }

  // 4️⃣ fallback — только если thresholdSignals есть, но ничего не подошло
  return Number(pluginConfig.thresholdSignal ?? 10);
}



/* ================= TX MODE: sendRequest/throttle ================= */

function sendRequest({ pluginName, frequency, pi, data }) {
  wsSendPlugins({
    type: pluginName,
    value: {
      action: 'find',
      freq: frequency,
      pi: pi || null,
      ts: Date.now(),
      list: [
        {
          isServer: true,
          freq: frequency,
          station: data?.txInfo?.tx,
          location: data?.txInfo?.city,
          itu: data?.txInfo?.itu,
          distance: data?.txInfo?.dist,
          azimuth: data?.txInfo?.azi,
          pi: data?.txInfo?.pi,
          pol: data?.txInfo?.pol,
          erp: data?.txInfo?.erp,
          logoUrl: null,
        },
      ],
    },
  });
}

const throttledSendTx = throttleLeading(sendRequest, 250);

/* ================= /text handler ================= */

function onTextMessage(data) {
  pluginConfig = readJsonSafe(cfgFile, defaultConfig);

  const frequency = data?.freq;
  const signalDbuv = (data?.sig ?? 0) - 11.25;
  let pi = String(data?.pi || '').includes('?') || data?.ps === ''
    ? null
    : data?.pi;

  const ant = Number(data?.ant ?? 0);

  const threshold = getThresholdForFrequency(frequency, pluginConfig);
  const thresholdTolerance = 3;
  const effectiveThreshold = threshold - thresholdTolerance;

  const stableTimeMs = Number(pluginConfig.stableTime || 3) * 1000;

  // ====== DETECT FREQUENCY CHANGE ===
  // ===
  if (frequency !== lastFrequency) {
    lastFrequency = frequency;
    resetAllOnFrequencyChange();
  }

  const hasTx = Boolean(!!data?.txInfo?.tx && !!pi);

  // ====== TX MODE ======
  if (hasTx) {
    throttledSendTx({
      pluginName,
      frequency,
      pi,
      data,
    });
    return;
  }

  const freqChanged = frequency !== monitorState.pendingFrequency;
  // signalFixed
  if (!freqChanged && (signalDbuv >= effectiveThreshold) && !signalFixed) {
    signalFixed = true
  }

  if (freqChanged) {
    signalFixed = false
  }

  // ====== SEARCH MODE ======
  if (!frequency || !Number.isFinite(signalDbuv)) return;

  if (signalDbuv < effectiveThreshold && !signalFixed) {
    stopFindBroadcast();
    return;
  }

  const piChanged = pi !== monitorState.pendingPi;
  const antChanged = ant !== monitorState.pendingAnt;

  if (freqChanged || piChanged || antChanged) {
    monitorState.pendingFrequency = frequency;
    monitorState.pendingPi = pi;
    monitorState.pendingAnt = ant;

    if (monitorState.stableTimer) clearTimeout(monitorState.stableTimer);

    monitorState.stableTimer = setTimeout(() => {
      stopFindBroadcast();
      startFindBroadcast(frequency, pi, ant);
    }, stableTimeMs);

    return;
  }

  if (!monitorState.active && !monitorState.stableTimer) {
    monitorState.stableTimer = setTimeout(() => {
      startFindBroadcast(frequency, pi, ant);
    }, stableTimeMs);
  }
}


/* ================= CONNECT: /data_plugins ================= */

function connectPluginsWS() {
  if (wsPlugins && wsPlugins.readyState === WebSocket.OPEN) return;

  wsPlugins = new WebSocket(`${WS_BASE}/data_plugins`);

  wsPlugins.onopen = () => {
    logInfo('[StationsWithoutRDS] /data_plugins connected');
  };

  wsPlugins.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== pluginName) return;

      // В этой версии сервер ничего не принимает от клиента (только пушит find).
      // Оставлено намеренно пустым.
    } catch (e) {
      logError('[StationsWithoutRDS] invalid plugins message', e);
    }
  };

  wsPlugins.onerror = (err) => {
    logError('[StationsWithoutRDS] /data_plugins error', err);
  };

  wsPlugins.onclose = () => {
    logInfo('[StationsWithoutRDS] /data_plugins closed, reconnecting...');
    setTimeout(connectPluginsWS, 2000);
  };
}

/* ================= CONNECT: /text ================= */

function connectTextWS() {
  if (wsText && wsText.readyState === WebSocket.OPEN) return;

  wsText = new WebSocket(`${WS_BASE}/text`);

  wsText.onopen = () => {
    logInfo('[StationsWithoutRDS] /text connected');
  };

  wsText.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onTextMessage(data);
    } catch (e) {
      // ignore invalid /text frames
    }
  };

  wsText.onerror = (err) => {
    logError('[StationsWithoutRDS] /text error', err);
  };

  wsText.onclose = () => {
    logInfo('[StationsWithoutRDS] /text closed, reconnecting...');
    setTimeout(connectTextWS, 2000);
  };
}

/* ================= LIVE CONFIG WATCH (простая) ================= */

let lastCfgMtime = 0;
setInterval(() => {
  try {
    const st = fs.statSync(cfgFile);
    const m = Number(st.mtimeMs || 0);
    if (m && m !== lastCfgMtime) {
      lastCfgMtime = m;
      pluginConfig = readJsonSafe(cfgFile, defaultConfig);
      // find/settings ничего дополнительно не шлём — сервер просто начнёт использовать новые значения.
    }
  } catch {
    // ignore
  }
}, 2000);

/* ================= START ================= */

connectPluginsWS();
connectTextWS();

module.exports = {};
