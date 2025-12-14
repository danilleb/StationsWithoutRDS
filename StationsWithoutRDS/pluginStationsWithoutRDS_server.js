'use strict';

/*
  StationsWithoutRDS
  Server-side WebSocket plugin for FM-DX-Webserver
*/

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

const config = require('../../config.json');
const { logInfo, logError } = require('../../server/console');

/* ================= CONFIG FILE ================= */

const rootDir = path.dirname(require.main.filename);
const cfgDir = path.join(rootDir, 'plugins_configs');
const cfgFile = path.join(cfgDir, 'StationsWithoutRDS.json');

const defaultConfig = {
  mode: 1,
  myStantions: [],
  thresholdSignal: 10,   // dBµV
  stableTime: 3,         // seconds
  maxDistanceKm: 500,    // km
  refreshStationsMs: 24  // hours
};

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
    out.stableTime = Number(out.stableTime ?? fallback.stableTime);
    out.maxDistanceKm = Number(out.maxDistanceKm ?? fallback.maxDistanceKm);
    out.refreshStationsMs = Number(out.refreshStationsMs ?? fallback.refreshStationsMs);

    return out;
  } catch {
    return { ...fallback };
  }
}

function writeJsonSync(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

ensureDirSync(cfgDir);
if (!fs.existsSync(cfgFile)) writeJsonSync(cfgFile, defaultConfig);

let pluginConfig = readJsonSafe(cfgFile, defaultConfig);
writeJsonSync(cfgFile, pluginConfig);

/* ================= QTH ================= */

const qthLat = Number(config?.identification?.lat);
const qthLon = Number(config?.identification?.lon);

if (!qthLat || !qthLon) {
  logError('[StationsWithoutRDS] QTH coordinates are missing in config.json (identification.lat/lon)');
}

/* ================= GEO ================= */

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.cos(toRad(lon2 - lon1));

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function normalizeFreq(f) {
  const n = Number(f);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(1));
}

/* ================= MAPS.FMDX CACHE ================= */

let locationsCache = []; // [{lat,lon,name,itu,stations:[...]}]
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

// обновление раз в N часов
setInterval(() => {
  // перечитываем конфиг на лету (удобно)
  pluginConfig = readJsonSafe(cfgFile, defaultConfig);

  const hours = Number(pluginConfig.refreshStationsMs || 24);
  const intervalMs = hours * 60 * 60 * 1000;

  // setInterval уже стоит — но чтобы не плодить, просто делаем load сейчас
  // (интервал оставляем фиксированный раз в минуту, а реально обновляем по времени)
}, 60 * 1000);

// реальный планировщик обновления по времени
setInterval(() => {
  pluginConfig = readJsonSafe(cfgFile, defaultConfig);
  const hours = Number(pluginConfig.refreshStationsMs || 24);
  const intervalMs = hours * 60 * 60 * 1000;

  if (!lastStationsLoadTs || (Date.now() - lastStationsLoadTs) >= intervalMs) {
    loadStationsFromMaps();
  }
}, 60 * 1000);

/* ================= LOGOS ================= */

// локальные логотипы (попытка)
/* ================= LOCAL LOGOS ================= */

// папка с логотипами
const logosDir = path.join(rootDir, 'web', 'logos');

// localLogos: { NORMALIZED_NAME: 'FILENAME.png' }
let localLogos = {};

function normalizeName(str = '') {
  return String(str)
    .toUpperCase()
    .replace(/RADIO/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\w]/g, '');
}

try {
  if (fs.existsSync(logosDir)) {
    const files = fs.readdirSync(logosDir);

    for (const file of files) {
      // только изображения
      if (!/\.(png|svg|gif|jpg|jpeg)$/i.test(file)) continue;

      const nameWithoutExt = file.replace(/\.[^.]+$/, '');
      const key = normalizeName(nameWithoutExt);

      if (key) {
        localLogos[key] = file;
      }
    }

    logInfo('[StationsWithoutRDS] local logos loaded:', Object.keys(localLogos).length);
  } else {
    logInfo('[StationsWithoutRDS] logos directory not found:', logosDir);
  }
} catch (e) {
  logError('[StationsWithoutRDS] failed to load local logos', e);
}


const noobishCache = {}; // { ITU: [file1.png, ...] }

function normalizeName(str = '') {
  return String(str)
    .toUpperCase()
    .replace(/RADIO/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\w]/g, '');
}

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
    // простая вытяжка файлов по href="....png|svg|gif"
    const files = [...html.matchAll(/href="([^"]+\.(png|svg|gif))"/gi)]
      .map(m => m[1])
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
  // 1) локальные (ключи могут быть разными, ищем совпадения по нормализованным)
  if (localLogos && typeof localLogos === 'object') {
    for (const k of Object.keys(localLogos)) {
      const localKeyNorm = normalizeName(k);
      // допускаем совпадение в обе стороны
      if (localKeyNorm.includes(target) || target.includes(localKeyNorm)) {
        const file = localLogos[k];
        if (file) return `/logos/${file}`;
      }
    }
  }

  // 2) noobish — ищем подходящий файл
  const files = await getNoobishLogos(itu);
  if (files.length) {
    // пробуем несколько вариантов имени (как у тебя было на клиенте)
    const sName = String(st?.station || '').toUpperCase();
    const candidates = [
      normalizeName(sName),
      normalizeName(sName.replace('RADIO', '')),
      normalizeName(sName.replaceAll(' ', '')),
      normalizeName(sName.replace('RADIO', '').replaceAll(' ', ''))
    ].filter(Boolean);

    for (const file of files) {
      const fNorm = normalizeName(file);
      if (candidates.some(n => fNorm.includes(n) || n.includes(fNorm))) {
        return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${itu}/${file}`;
      }
    }
  }

  // 3) fallback default-logo
  return `https://proxy.fm-tuner.ru/https://tef.noobish.eu/logos/${itu}/default-logo.png`;
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
    distance: Number(distance.toFixed(1)),
    azimuth: Math.round(az),
    pol: st.pol || '',
    erp: (st.erp ?? null)
  };
}

async function searchInMaps(freq) {
  const f = normalizeFreq(freq);
  if (f === null) return [];

  const result = [];

  for (const loc of locationsCache) {
    const d = haversine(qthLat, qthLon, Number(loc.lat), Number(loc.lon));
    if (d > Number(pluginConfig.maxDistanceKm || 500)) continue;

    for (const st of (loc.stations || [])) {
      if (st.inactive) continue;
      if (normalizeFreq(st.freq) !== f) continue;

      result.push(buildRecordFromLocStation(loc, st));
    }
  }

  // СОРТ по distance (число)
  result.sort((a, b) => Number(a.distance) - Number(b.distance));

  // logoUrl
  for (const r of result) {
    r.logoUrl = await findLogoUrl(r);
  }

  return result;
}

async function searchInMyStations(freq) {
  const f = normalizeFreq(freq);
  if (f === null) return [];

  const list = Array.isArray(pluginConfig.myStantions) ? pluginConfig.myStantions : [];
  const filtered = list
    .filter(s => normalizeFreq(s.freq) === f)
    .map(s => ({
      freq: normalizeFreq(s.freq),
      station: s.station || 'Unknown',
      location: s.location || '',
      itu: String(s.itu || '').toUpperCase(),
      distance: Number((Number(s.distance) || 0).toFixed(1)),
      azimuth: Math.round(Number(s.azimuth) || 0),
      pol: s.pol || '',
      erp: (s.erp ?? null),
      // logoUrl: если задан — используем, иначе попробуем найти
      logoUrl: s.logoUrl || null
    }));

  // сортируем по distance
  filtered.sort((a, b) => Number(a.distance) - Number(b.distance));

  // если logoUrl не задан — доберём
  for (const r of filtered) {
    if (!r.logoUrl) r.logoUrl = await findLogoUrl(r);
  }

  return filtered;
}

async function searchStations(freq) {
  // перечитываем конфиг на каждый запрос (чтобы правки конфиг-файла применялись сразу)
  pluginConfig = readJsonSafe(cfgFile, defaultConfig);

  const mode = Number(pluginConfig.mode || 1);

  if (mode === 2) {
    return await searchInMyStations(freq);
  }

  if (mode === 3) {
    const first = await searchInMyStations(freq);
    if (first.length) return first;
    return await searchInMaps(freq);
  }

  // mode 1 default
  return await searchInMaps(freq);
}

/* ================= WS (data_plugins) ================= */

const PORT = config.webserver.webserverPort || 8080;
const WS_BASE = `ws://127.0.0.1:${PORT}`;

let wsData = null;

// анти-спам: запоминаем requestId, на который уже ответили
const processedRequests = new Map(); // requestId -> timestamp

function gcProcessed() {
  const now = Date.now();
  // живём 2 минуты
  const TTL = 2 * 60 * 1000;
  for (const [k, ts] of processedRequests.entries()) {
    if (now - ts > TTL) processedRequests.delete(k);
  }
}
setInterval(gcProcessed, 30 * 1000);

function connectDataWS() {
  if (wsData && wsData.readyState === WebSocket.OPEN) return;

  wsData = new WebSocket(`${WS_BASE}/data_plugins`);

  wsData.onopen = () => {
    logInfo('[StationsWithoutRDS] /data_plugins connected');
  };

  wsData.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'StationsWithoutRDS') return;

      const payload = msg.value;

      // ✅ важный фикс: иногда платформа присылает массив событий
      // берем последнее
      const data = Array.isArray(payload) ? payload[payload.length - 1] : payload;
      if (!data || typeof data !== 'object') return;

      const action = data.action;
      const requestId = data.requestId;

      // 1) отдать конфиг
      if (action === 'get_config') {
        pluginConfig = readJsonSafe(cfgFile, defaultConfig);

        wsData.send(JSON.stringify({
          type: 'StationsWithoutRDS',
          value: {
            action: 'config',
            thresholdSignal: Number(pluginConfig.thresholdSignal),
            stableTime: Number(pluginConfig.stableTime) * 1000, // клиенту в ms
            maxDistanceKm: Number(pluginConfig.maxDistanceKm)
          }
        }));
        return;
      }

      // 2) find по частоте
      if (action === 'find') {
        const freq = data.freq;
        if (!requestId) return;

        // анти-спам по requestId
        if (processedRequests.has(requestId)) return;
        processedRequests.set(requestId, Date.now());

        const list = await searchStations(freq);

        wsData.send(JSON.stringify({
          type: 'StationsWithoutRDS',
          value: {
            requestId,
            list
          }
        }));

        return;
      }

    } catch (e) {
      logError('[StationsWithoutRDS] invalid message', e);
    }
  };

  wsData.onerror = (err) => {
    logError('[StationsWithoutRDS] /data_plugins error', err);
  };

  wsData.onclose = () => {
    logInfo('[StationsWithoutRDS] /data_plugins closed, reconnecting...');
    setTimeout(connectDataWS, 2000);
  };
}

connectDataWS();

module.exports = {};
