'use strict';

(async () => {
  /* ================= HELPERS ================= */

  const byId = (root, id) => (root ? root.querySelector(`#${CSS.escape(id)}`) : null);


  function isVisible(el) {
    return el.offsetParent !== null;
  }
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
  baseContainer.parentNode.style.position = 'relative'

  const dataStationContainer = baseContainer.cloneNode(true);

  dataStationContainer.id = 'data-station-container-no-rds';
  dataStationContainer.style.display = 'none';
  dataStationContainer.style.position = 'absolute';
  dataStationContainer.style.top = '0px';
  dataStationContainer.style.left = '0px';
  dataStationContainer.style.width = '100%';
  dataStationContainer.style.height = '100%';


  baseContainer.parentNode.appendChild(dataStationContainer);

  const origStationLogoPhone = byId(document, 'logo-container-phone')
  const origStationLogo = byId(document, 'logo-container-desktop')

  console.log({
    origStationLogoPhone: isVisible(origStationLogoPhone),
    origStationLogo: isVisible(origStationLogo)
  });

  origStationLogoPhone.parentNode.style.position = 'relative'
  origStationLogo.parentNode.style.position = 'relative'

  const stationLogoPhone = origStationLogoPhone.cloneNode(true)
  const stationLogo = origStationLogo.cloneNode(true)

  stationLogoPhone.style.position = 'relative'
  stationLogoPhone.style.top = '0px'
  stationLogoPhone.style.left = '0px'
  stationLogoPhone.style.width = 'auto'
  stationLogoPhone.style.height = '70px'
  stationLogoPhone.style.zIndex = '9999'

  stationLogo.style.position = 'relative'
  stationLogo.style.top = '0px'
  stationLogo.style.left = '0px'
  stationLogo.style.width = '215px'
  stationLogo.style.height = '60px'
  stationLogo.style.zIndex = '9999'

  origStationLogoPhone.parentNode.appendChild(stationLogoPhone)
  origStationLogo.parentNode.appendChild(stationLogo)

  const logo = isVisible(origStationLogo) ? stationLogo : stationLogoPhone
  const logoOriginal = isVisible(origStationLogo) ? origStationLogo : origStationLogoPhone
  const displayValueLogo = `${logoOriginal.style.display}`

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
    logoOriginal.style.display = displayValueLogo
    logo.style.display = 'none'
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


    currentCandidates = candidates;

    // если индекс ещё валиден — сохраняем
    if (currentCandidateIndex >= currentCandidates.length) {
      currentCandidateIndex = 0;
    }

    if (!currentCandidates.length) {
      hideNoRdsUI();
      return;
    }

    if (isServer) {
      dataStationContainer.style.display = 'none';
      hideNoRdsUI();
    } else {
      dataStationContainer.style.display = 'block';
      renderCandidate(currentCandidateIndex);
    }
  }

  function showStationsOverlay(candidates, onSelect) {
    if (!Array.isArray(candidates) || !candidates.length) return;
  
    // если уже открыт — не создаём второй
    if (document.getElementById('stations-overlay')) return;
  
    const overlay = document.createElement('div');
    overlay.id = 'stations-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
  
    const panel = document.createElement('div');
    panel.style.cssText = `
      background: var(--color-2, #111);
      color: var(--color-main, #fff);
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      border-radius: 8px;
      padding: 12px 12px 8px;
      display: flex;
      flex-direction: column;
    `;

    if ((window.visualViewport?.width || window.innerWidth) < 500) {
      overlay.style.alignItems = 'stretch';
      overlay.style.justifyContent = 'stretch';
    
      panel.style.width = '100vw';
      panel.style.maxWidth = '100vw';
      panel.style.height = '100vh';
      panel.style.maxHeight = '100vh';
      panel.style.borderRadius = '0';
      panel.style.padding = '12px 10px 10px';
    }
  
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    `;
  
    const title = document.createElement('div');
    title.textContent = `Stations (${candidates.length})`;
    title.style.color = 'var(--color-text)'
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
  
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      cursor: pointer;
      font-size: 20px;
      color: var(--color-text);
      opacity: 0.7;
    `;
    closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.7';
  
    const list = document.createElement('div');
    list.style.cssText = `
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;
  
    candidates.forEach((c, index) => {
      const item = document.createElement('div');
      item.style.cssText = `
        display: grid;
        grid-template-columns: 56px 1fr auto;
        gap: 8px;
        align-items: center;
        padding: 6px;
        border-radius: 4px;
        cursor: pointer;
        background: var(--color-3, #1a1a1a);
      `;
  
      item.onmouseenter = () => item.style.background = 'var(--color-4, #2a2a2a)';
      item.onmouseleave = () => item.style.background = 'var(--color-3, #1a1a1a)';
  
      const logo = document.createElement('img');
      logo.src = c.logoUrl || '';
      logo.style.cssText = `
        width: 50px;
        height: 50px;
        object-fit: contain;
      `;
  
      const info = document.createElement('div');
      info.innerHTML = `
        <div style="font-weight:600; color: var(--color-text);">${c.station || '—'}</div>
        <div style="font-size:12px; opacity:.8; color: var(--color-text);">
          ${c.location || ''} · ${c.itu || ''} · ${c.azimuth ?? '?'}°
        </div>
      `;
  
      const meta = document.createElement('div');
      meta.style.cssText = `
        font-size: 12px;
        opacity: 0.8;
        white-space: nowrap;
        color: var(--color-text);
      `;
      meta.textContent = `${c.erp ?? '?'} kW · ${c.distance ?? '?'} km`;
  
      item.append(logo, info, meta);
  
      item.onclick = (e) => {
        e.stopPropagation();
        const text = `${c.freq} - ${c.pi || 'noPi'} | ${c.station} [${c.location}, ${c.itu}] - ${c.distance} | ${c.erp} kW`;
        copyToClipboard(text);
      };
  
      list.appendChild(item);
    });
  
    header.append(title, closeBtn);
    panel.append(header, list);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
  
    closeBtn.onclick = close;
    overlay.onclick = close;
    panel.onclick = e => e.stopPropagation();
    document.addEventListener('keydown', onKey);
  }
  


  function renderCandidate(index) {
    const c = currentCandidates[index];
    if (!c) return;

    // логотип — обновляем ТОЛЬКО если изменился
    if (c.logoUrl) {
      logo.children[0].src = c.logoUrl;
      logo.style.display = displayValueLogo
      logoOriginal.style.display = 'none'
    } else {
      logoOriginal.style.display = displayValueLogo
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

    const otherStations = byId(dataStationContainer, 'data-station-azimuth').parentNode
    const elements = document.querySelectorAll('#other-stations-no-rds');
    elements.forEach(el => el.remove());

    const docOtherSt = document.createElement('span')
    docOtherSt.id = 'other-stations-no-rds'
    docOtherSt.style.background = `var(--color-4)`
    docOtherSt.style.color = `var(--color-main)`
    docOtherSt.style.borderRadius = `4px`
    docOtherSt.style.padding = `0px 4px`
    docOtherSt.style.cursor = `pointer`

    if (currentCandidates.length > 1) {
      docOtherSt.innerHTML = `+${currentCandidates.length}`
      otherStations.appendChild(docOtherSt)
      docOtherSt.addEventListener('click', (event) => {
        event.stopPropagation()

        showStationsOverlay(currentCandidates);
        console.log('Нужно показать оверлей со списком станций, так же нужен крестик и адаптивность под мобилку, по esc тоже закрытие');
      })
    }

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
