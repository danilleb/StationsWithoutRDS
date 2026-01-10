'use strict';

(async () => {
  /* ================= HELPERS ================= */

  const byId = (root, id) => (root ? root.querySelector(`#${CSS.escape(id)}`) : null);

  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function stableStringify(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
    return `{${Object.keys(obj).sort().map(k => `"${k}":${stableStringify(obj[k])}`).join(',')}}`;
  }

  function hashCandidates(list) {
    return stableStringify(list);
  }

  let lastCandidatesHash = null;
  let lastCandidatesLength = 0;



  /* ================= UI INIT ================= */

  const baseContainer = byId(document, 'data-station-container');
  if (!baseContainer) return;

  const dataStationContainer = baseContainer.cloneNode(true);

  function hiddenBaseContainer() {
    if (baseContainer) {
      baseContainer?.remove();
    }
  }

  dataStationContainer.id = 'data-station-container-no-rds';
  dataStationContainer.style.display = 'none';
  dataStationContainer.style.position = 'relative';

  baseContainer.parentNode.appendChild(dataStationContainer);
  hiddenBaseContainer();

  const stationLogoPhone = byId(document, 'logo-container-phone');
  const stationLogo = byId(document, 'logo-container-desktop');

  /* ================= UI RENDER ================= */

  let currentCandidates = [];
  let currentCandidateIndex = 0;

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
      b.onmouseenter = () => (b.style.opacity = '1');
      b.onmouseleave = () => (b.style.opacity = '0.6');
      return b;
    };

    const prev = mkBtn('candidate-prev', '‹', 'left');
    const next = mkBtn('candidate-next', '›', 'right');

    prev.onclick = (e) => switchCandidate(e, -1);
    next.onclick = (e) => switchCandidate(e, 1);

    dataStationContainer.append(prev, next);
  }

  function switchCandidate(e, dir) {
    e.stopPropagation();
    
    if (currentCandidates.length <= 1) return;

    currentCandidateIndex =
      (currentCandidateIndex + dir + currentCandidates.length) % currentCandidates.length;

    renderCandidate(currentCandidateIndex);
  }

  function hideNoRdsUI() {
    dataStationContainer.style.display = 'none';
    currentCandidates = [];
    currentCandidateIndex = 0;
  }

  function showCandidates(list, isServer = false) {
    const candidates = Array.isArray(list) ? list : [];

    const newHash = hashCandidates(candidates);

    // 🔴 НИЧЕГО НЕ ДЕЛАЕМ если данные те же
    if (
      newHash === lastCandidatesHash &&
      candidates.length === lastCandidatesLength
    ) {
      return;
    }

    lastCandidatesHash = newHash;
    lastCandidatesLength = candidates.length;

    hiddenBaseContainer();

    currentCandidates = candidates;

    // если индекс ещё валиден — сохраняем
    if (currentCandidateIndex >= currentCandidates.length) {
      currentCandidateIndex = 0;
    }

    if (!currentCandidates.length) {
      hideNoRdsUI();
      return;
    }

    const others = byId(dataStationContainer, 'data-station-others')
    if (others) {
      if (!isServer) {
        others.style.visibility = "hidden"
        others.style.height = "0px"
        others.style.width = "0px"
      } else {
        others.style.visibility = "visible"
        others.style.removeProperty('height')
        others.style.removeProperty('width')
      }
    }

    renderCandidate(currentCandidateIndex);
  }


  function renderCandidate(index) {
    const c = currentCandidates[index];
    if (!c) return;

    // логотип — обновляем ТОЛЬКО если изменился
    if (c.logoUrl) {
      if (stationLogoPhone?.children?.[0] && stationLogoPhone.children[0].src !== c.logoUrl) {
        stationLogoPhone.children[0].src = c.logoUrl;
      }
      if (stationLogo?.children?.[0] && stationLogo.children[0].src !== c.logoUrl) {
        stationLogo.children[0].src = c.logoUrl;
      }
    }

    const setText = (id, value) => {
      const el = byId(dataStationContainer, id);
      const v = value ?? '';
      if (el && el.textContent !== String(v)) {
        el.textContent = v;
      }
    };

    setText('data-station-name', c.station);
    setText('data-station-city', c.location);
    setText('data-station-itu', c.itu);
    setText('data-station-erp', c.erp);
    setText('data-station-pol', c.pol);
    setText('data-station-azimuth', (c.azimuth ?? '') + '°');
    setText('data-station-distance', Number(c.distance ?? 0) + ' km');

    ensureSideButtons();

    const show = currentCandidates.length > 1 ? 'block' : 'none';
    byId(dataStationContainer, 'candidate-prev').style.display = show;
    byId(dataStationContainer, 'candidate-next').style.display = show;

    const parentStName = byId(dataStationContainer, 'data-station-name').parentNode
    parentStName.style.display = 'block'
    parentStName.style.padding = '0px'
    dataStationContainer.style.display = 'block';
    dataStationContainer.onclick = (e) => {
      e.stopPropagation();
      const text = `${c.freq} - ${c.pi || 'noPi'} | ${c.station} [${c.location}, ${c.itu}] - ${c.distance} | ${c.erp} kW`;
      copyToClipboard(text);
    };
  }


  /* ================= DATA_PLUGINS WS ================= */

  const pluginName = 'StationsWithoutRDS';

  const url = new URL(location.href);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = url.pathname.replace(/setup/g, '').replace(/\/?$/, '/');
  const WS_URL = `${protocol}//${url.host}${basePath}data_plugins`;

  let ws = null;

  function connectDataWS() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => { };

    ws.onmessage = (e) => {
      const msg = safeJsonParse(e.data);
      if (!msg || msg.type !== pluginName) return;

      const v = msg.value;

      // Оставляем только find
      if (v?.action === 'find') {
        showCandidates(v.list, v?.isServer || false);
        return;
      }
    };

    ws.onclose = () => setTimeout(connectDataWS, 3000);
  }

  connectDataWS();
})();
