'use strict';

(async () => {

  /* ================= SETTINGS (приедут с сервера) ================= */

  let thresholdSignal = 10;
  let STABLE_TIME = 3000;

  const byId = (root, id) =>
    root ? root.querySelector(`#${CSS.escape(id)}`) : null;

  let lastFrequency = null;
  let pendingFrequency = null;
  let stableTimer = null;

  let currentCandidates = [];
  let currentCandidateIndex = 0;

  // чтобы принять только свой ответ
  let activeRequestId = null;

  /* ================= UI INIT ================= */

  const baseContainer = byId(document, 'data-station-container');
  if (!baseContainer) return;

  const dataStationContainer = baseContainer.cloneNode(true);
  dataStationContainer.id = 'data-station-container-no-rds';
  dataStationContainer.style.display = 'none';
  dataStationContainer.style.position = 'relative';
  baseContainer.parentNode.appendChild(dataStationContainer);

  const stationLogoPhone = byId(document, 'logo-container-phone');
  const stationLogo = byId(document, 'logo-container-desktop');

  /* ================= UI ================= */

  function ensureSideButtons() {
    if (byId(dataStationContainer, 'candidate-prev')) return;

    const mkBtn = (id, symbol, side) => {
      const b = document.createElement('div');
      b.id = id;
      b.textContent = symbol;
      b.style.position = 'absolute';
      b.style.top = '50%';
      b.style.transform = 'translateY(-50%)';
      b.style[side] = '10px';
      b.style.cursor = 'pointer';
      b.style.opacity = '0.6';
      b.style.userSelect = 'none';
      b.style.fontSize = '32px';
      b.onmouseenter = () => b.style.opacity = '1';
      b.onmouseleave = () => b.style.opacity = '0.6';
      return b;
    };

    const prev = mkBtn('candidate-prev', '‹', 'left');
    const next = mkBtn('candidate-next', '›', 'right');

    prev.onclick = () => switchCandidate(-1);
    next.onclick = () => switchCandidate(1);

    dataStationContainer.append(prev, next);
  }

  function switchCandidate(dir) {
    if (currentCandidates.length <= 1) return;

    currentCandidateIndex =
      (currentCandidateIndex + dir + currentCandidates.length) %
      currentCandidates.length;

    renderCandidate(currentCandidateIndex);
  }

  function renderCandidate(index) {
    const c = currentCandidates[index];
    if (!c) return;

    if (c.logoUrl) {
      stationLogoPhone?.children?.[0] && (stationLogoPhone.children[0].src = c.logoUrl);
      stationLogo?.children?.[0] && (stationLogo.children[0].src = c.logoUrl);
    }

    byId(dataStationContainer, 'data-station-name').parentNode.style.display = 'block';
    byId(dataStationContainer, 'data-station-name').textContent = c.station;
    byId(dataStationContainer, 'data-station-city').textContent = c.location;
    byId(dataStationContainer, 'data-station-itu').textContent = c.itu;
    byId(dataStationContainer, 'data-station-erp').textContent = c.erp ?? '';
    byId(dataStationContainer, 'data-station-pol').textContent = c.pol ?? '';
    byId(dataStationContainer, 'data-station-azimuth').textContent = c.azimuth + '°';
    byId(dataStationContainer, 'data-station-distance').textContent =
      Number(c.distance) + ' km';

    ensureSideButtons();

    const show = currentCandidates.length > 1 ? 'block' : 'none';
    byId(dataStationContainer, 'candidate-prev').style.display = show;
    byId(dataStationContainer, 'candidate-next').style.display = show;

    dataStationContainer.style.display = 'block';
  }

  /* ================= CORE ================= */

  function resetPendingUIOnly() {
    dataStationContainer.style.display = 'none';
    currentCandidates = [];
    currentCandidateIndex = 0;
  }

  function onFrequencyStable(freq) {
    requestCandidates(freq);
  }

  /* ================= WS (data_plugins) ================= */

  const pluginName = 'StationsWithoutRDS';
  const url = new URL(location.href);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = url.pathname.replace(/setup/g, '').replace(/\/?$/, '/');
  const WS_URL = `${protocol}//${url.host}${basePath}data_plugins`;

  let ws;

  function connectDataWS() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log(`[${pluginName}] connected`);

      // попросим конфиг
      ws.send(JSON.stringify({
        type: 'StationsWithoutRDS',
        value: { action: 'get_config' }
      }));
    };

    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'StationsWithoutRDS') return;

        const v = msg.value;

        // config
        if (v?.action === 'config') {
          thresholdSignal = Number(v.thresholdSignal ?? thresholdSignal);
          STABLE_TIME = Number(v.stableTime ?? STABLE_TIME); // сервер отдаёт в ms
          console.log(`[${pluginName}] config`, { thresholdSignal, STABLE_TIME });
          return;
        }

        // result: {requestId, list}
        if (v && typeof v === 'object' && v.requestId) {
          // принимаем только свой ответ
          if (!activeRequestId || v.requestId !== activeRequestId) return;

          const list = Array.isArray(v.list) ? v.list : [];
          currentCandidates = list;
          currentCandidateIndex = 0;

          if (!currentCandidates.length) return;

          renderCandidate(0);
        }

      } catch (err) {
        console.error(`[${pluginName}] parse error`, err);
      }
    };

    ws.onclose = () => setTimeout(connectDataWS, 3000);
  }

  function requestCandidates(freq) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // новый requestId на каждый запрос
    activeRequestId = (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

    ws.send(JSON.stringify({
      type: 'StationsWithoutRDS',
      value: { action: 'find', freq, requestId: activeRequestId }
    }));
  }

  connectDataWS();

  /* ================= MAIN SOCKET ================= */

  function resetPendingAll() {
    resetPendingUIOnly();
    pendingFrequency = null;
    lastFrequency = null;
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    activeRequestId = null;
  }

  function connectMainSocket() {
    if (!window.socket || window.socket.readyState > 1) {
      window.socket = new WebSocket(socketAddress);
    }

    window.socket.addEventListener('message', onMainMessage);
    window.socket.addEventListener('close', () =>
      setTimeout(connectMainSocket, 3000)
    );
  }

  function onMainMessage(event) {
    try {
      const data = JSON.parse(event.data);

      const frequency = data.freq;
      const signalDbuv = (data.sig ?? 0) - 11.25;
      const hasTxInfo = !!data?.txInfo?.tx || !!data?.txInfo?.id || (!(data.pi.includes('?')))

      if (hasTxInfo) {
        resetPendingAll();
        lastFrequency = frequency;
        return;
      }

      if (signalDbuv >= thresholdSignal && frequency) {
        if (frequency !== pendingFrequency) {
          // при смене частоты скрываем UI, но не трогаем lastFrequency
          resetPendingUIOnly();

          pendingFrequency = frequency;

          if (stableTimer) clearTimeout(stableTimer);

          stableTimer = setTimeout(() => {
            if (pendingFrequency !== lastFrequency) {
              lastFrequency = pendingFrequency;
              onFrequencyStable(lastFrequency);
            }
          }, STABLE_TIME);
        }
      } else {
        resetPendingAll();
      }

    } catch (e) {
      console.error('main WS parse error', e);
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', connectMainSocket);
  } else {
    connectMainSocket();
  }

})();
