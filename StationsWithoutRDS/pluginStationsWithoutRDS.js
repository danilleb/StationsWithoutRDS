'use strict';

(async () => {

  /* =========================================================
     HELPERS
     ========================================================= */

  const byId = (root, id) => {
    if (!root) return null;

    try {
      return root.querySelector(`#${CSS.escape(id)}`);
    } catch {
      return root.querySelector(`[id="${id}"]`);
    }
  };


  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }


  function stableStringify(obj) {

    if (
      obj === null ||
      typeof obj !== 'object'
    ) {
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      return `[${obj.map(stableStringify).join(',')}]`;
    }

    return `{${Object.keys(obj)
      .sort()
      .map(
        k =>
          `"${k}":${stableStringify(obj[k])}`
      )
      .join(',')}}`;
  }


  function hashCandidates(list) {
    return stableStringify(list);
  }


  /* =========================================================
     STATE
     ========================================================= */

  let loc = null;

  let currentCandidates = [];
  let currentCandidateIndex = 0;

  let lastCandidatesHash = null;
  let lastCandidatesLength = 0;

  let ws = null;

  const pluginName =
    'StationsWithoutRDS';


  /*
   * Current logo supplied by StationsWithoutRDS.
   *
   * null = plugin is not controlling the logo.
   */
  let noRdsLogoUrl = null;


  /*
   * Currently active original FM-DX logo image.
   */
  let activeLogoElement = null;


  /*
   * Original src values of the two Station Logo images.
   *
   * These are maintained independently because the page
   * can dynamically switch between desktop and mobile.
   */
  const originalLogoSources = new WeakMap();


  /*
   * Prevent our own src modifications from being interpreted
   * as changes made by the original Station Logo plugin.
   */
  const ownLogoChanges = new WeakSet();


  /*
   * Resize debounce.
   */
  let responsiveTimer = null;


  /* =========================================================
     BASE CONTAINER
     ========================================================= */

  const baseContainer =
    byId(
      document,
      'data-station-container'
    );


  if (!baseContainer) {

    console.warn(
      '[StationsWithoutRDS] #data-station-container not found'
    );

    return;
  }


  /* =========================================================
     ORIGINAL STATION LOGO ELEMENTS
     
     IMPORTANT:
     We DO NOT create another logo container.
     We DO NOT use position:fixed.
     We DO NOT use getBoundingClientRect().
     
     We use the original Station Logo elements directly.
     ========================================================= */

  const origStationLogoPhone =
    byId(
      document,
      'logo-container-phone'
    );


  const origStationLogoDesktop =
    byId(
      document,
      'logo-container-desktop'
    );


  const origLogoPhone =
    origStationLogoPhone
      ? origStationLogoPhone.querySelector(
          '#station-logo-phone'
        )
      : null;


  const origLogoDesktop =
    origStationLogoDesktop
      ? origStationLogoDesktop.querySelector(
          '#station-logo'
        )
      : null;


  if (
    !origLogoPhone &&
    !origLogoDesktop
  ) {

    console.warn(
      '[StationsWithoutRDS] Original Station Logo images not found'
    );

    return;
  }


  /* =========================================================
     SAVE ORIGINAL LOGO SOURCES
     ========================================================= */

  function rememberOriginalLogo(
    logo
  ) {

    if (!logo) return;

    if (
      !originalLogoSources.has(logo)
    ) {

      originalLogoSources.set(
        logo,
        logo.getAttribute('src') || ''
      );
    }
  }


  rememberOriginalLogo(
    origLogoPhone
  );


  rememberOriginalLogo(
    origLogoDesktop
  );


  /* =========================================================
     ORIGINAL LOGO SRC OBSERVATION
     
     Station Logo may independently change src.
     
     When StationsWithoutRDS is NOT controlling the image,
     we update our saved original src.
     
     When StationsWithoutRDS IS controlling it, our own src
     changes are ignored.
     ========================================================= */

  function watchOriginalLogo(
    logo
  ) {

    if (!logo) return;


    const observer =
      new MutationObserver(
        mutations => {

          for (
            const mutation of mutations
          ) {

            if (
              mutation.type !== 'attributes' ||
              mutation.attributeName !== 'src'
            ) {
              continue;
            }


            if (
              ownLogoChanges.has(logo)
            ) {

              ownLogoChanges.delete(
                logo
              );

              continue;
            }


            /*
             * The original Station Logo plugin changed
             * its source.
             *
             * Remember the new source unless we are
             * deliberately displaying StationsWithoutRDS.
             */
            if (
              !noRdsLogoUrl
            ) {

              originalLogoSources.set(
                logo,
                logo.getAttribute('src') || ''
              );
            }
          }
        }
      );


    observer.observe(
      logo,
      {
        attributes: true,
        attributeFilter: ['src']
      }
    );
  }


  watchOriginalLogo(
    origLogoPhone
  );


  watchOriginalLogo(
    origLogoDesktop
  );


  /* =========================================================
     MOBILE / DESKTOP
     
     Use the SAME responsive logic as the original plugin.
     ========================================================= */

  function isMobile() {

    if (
      origStationLogoPhone &&
      origStationLogoDesktop
    ) {

      const phoneStyle =
        window.getComputedStyle(
          origStationLogoPhone
        );


      const desktopStyle =
        window.getComputedStyle(
          origStationLogoDesktop
        );


      if (
        phoneStyle.display !== 'none' &&
        desktopStyle.display === 'none'
      ) {
        return true;
      }


      if (
        desktopStyle.display !== 'none' &&
        phoneStyle.display === 'none'
      ) {
        return false;
      }
    }


    /*
     * Same fallback breakpoint as original plugin.
     */
    return window.innerWidth < 768;
  }


  /* =========================================================
     GET ACTIVE ORIGINAL LOGO
     ========================================================= */

  function getActiveOriginalLogo() {

    return isMobile()
      ? origLogoPhone
      : origLogoDesktop;
  }


  /* =========================================================
     SET ORIGINAL LOGO SOURCE
     ========================================================= */

  function setLogoSrc(
    logo,
    src
  ) {

    if (!logo) return;


    const current =
      logo.getAttribute('src') || '';


    if (
      current === src
    ) {
      return;
    }


    ownLogoChanges.add(
      logo
    );


    if (src) {

      logo.setAttribute(
        'src',
        src
      );

    } else {

      logo.removeAttribute(
        'src'
      );
    }
  }


  /* =========================================================
     RESTORE ORIGINAL LOGO
     ========================================================= */

  function restoreOriginalLogo(
    logo
  ) {

    if (!logo) return;


    const original =
      originalLogoSources.get(
        logo
      );


    if (
      typeof original === 'string'
    ) {

      setLogoSrc(
        logo,
        original
      );
    }
  }


  /* =========================================================
     APPLY NO-RDS LOGO
     
     This is the key part.
     
     We don't change:
       - width
       - height
       - margin
       - position
       - max-width
       - max-height
       - parent
       - flex layout
     
     We change ONLY src.
     ========================================================= */

  function applyNoRdsLogo() {

    const newActiveLogo =
      getActiveOriginalLogo();


    /*
     * Active responsive element changed.
     *
     * Restore the old one first.
     */
    if (
      activeLogoElement &&
      activeLogoElement !== newActiveLogo
    ) {

      restoreOriginalLogo(
        activeLogoElement
      );
    }


    activeLogoElement =
      newActiveLogo;


    if (!activeLogoElement) {
      return;
    }


    if (noRdsLogoUrl) {

      setLogoSrc(
        activeLogoElement,
        noRdsLogoUrl
      );

    } else {

      restoreOriginalLogo(
        activeLogoElement
      );
    }
  }


  /* =========================================================
     SET NO-RDS LOGO
     ========================================================= */

  function showNoRdsLogo(
    url
  ) {

    if (!url) {

      hideNoRdsLogo();

      return;
    }


    noRdsLogoUrl =
      url;


    applyNoRdsLogo();
  }


  /* =========================================================
     HIDE NO-RDS LOGO
     ========================================================= */

  function hideNoRdsLogo() {

    noRdsLogoUrl =
      null;


    /*
     * Restore BOTH images.
     *
     * This is important when switching
     * Desktop <-> Mobile.
     */
    restoreOriginalLogo(
      origLogoPhone
    );


    restoreOriginalLogo(
      origLogoDesktop
    );


    activeLogoElement =
      getActiveOriginalLogo();
  }


  /* =========================================================
     RESPONSIVE UPDATE
     
     No coordinates are calculated.
     We simply switch between the two original
     Station Logo elements.
     ========================================================= */

  function scheduleResponsiveUpdate() {

    clearTimeout(
      responsiveTimer
    );


    responsiveTimer =
      setTimeout(
        () => {

          const newActive =
            getActiveOriginalLogo();


          if (
            newActive !==
            activeLogoElement
          ) {

            if (
              activeLogoElement
            ) {

              restoreOriginalLogo(
                activeLogoElement
              );
            }


            activeLogoElement =
              newActive;
          }


          if (
            noRdsLogoUrl
          ) {

            applyNoRdsLogo();
          }

        },
        50
      );
  }


  window.addEventListener(
    'resize',
    scheduleResponsiveUpdate
  );


  if (
    window.visualViewport
  ) {

    window.visualViewport.addEventListener(
      'resize',
      scheduleResponsiveUpdate
    );
  }


  /* =========================================================
     DATA CONTAINER CLONE
     
     This is the original station information panel
     used by StationsWithoutRDS.
     ========================================================= */

  const dataStationContainer =
    baseContainer.cloneNode(true);


  dataStationContainer.id =
    'data-station-container-no-rds';


  dataStationContainer.style.display =
    'none';


  dataStationContainer.style.position =
    'absolute';


  dataStationContainer.style.top =
    '0px';


  dataStationContainer.style.left =
    '0px';


  dataStationContainer.style.width =
    '100%';


  dataStationContainer.style.height =
    '100%';


  dataStationContainer.style.zIndex =
    '9998';


  if (
    baseContainer.parentNode
  ) {

    baseContainer.parentNode.appendChild(
      dataStationContainer
    );
  }


  /* =========================================================
     HIDE NO-RDS UI
     ========================================================= */

  function hideNoRdsUI() {

    hideNoRdsLogo();


    dataStationContainer.style.display =
      'none';


    currentCandidates = [];


    currentCandidateIndex = 0;
  }


  function hidePlugin() {

    hideNoRdsUI();
  }


  /* =========================================================
     WATCH ORIGINAL RDS CONTAINER
     
     If the normal RDS station data panel becomes visible,
     StationsWithoutRDS immediately gets out of the way.
     ========================================================= */

  function watchDisplayBlock(
    container
  ) {

    if (!container) {
      return;
    }


    const check = () => {

      const style =
        window.getComputedStyle(
          container
        );


      if (
        style.display === 'block'
      ) {

        hidePlugin();
      }
    };


    check();


    const observer =
      new MutationObserver(
        () => {
          check();
        }
      );


    observer.observe(
      container,
      {
        attributes: true,
        attributeFilter: [
          'style',
          'class'
        ]
      }
    );
  }


  watchDisplayBlock(
    baseContainer
  );


  /* =========================================================
     OPEN STATION ON MAP
     ========================================================= */

  function openSt(
    st
  ) {

    if (
      !loc ||
      !st ||
      !st.id
    ) {
      return;
    }


    const url =
      `https://maps.fmdx.org/#qth=${loc.qthLat},${loc.qthLon}` +
      `&freq=${st.freq}` +
      `&findId=${st.id}`;


    window.open(
      url,
      '_blank'
    );
  }


  /* =========================================================
     CANDIDATE SIDE BUTTONS
     ========================================================= */

  function ensureSideButtons() {

    if (
      byId(
        dataStationContainer,
        'candidate-prev'
      )
    ) {
      return;
    }


    const mkBtn =
      (
        id,
        symbol,
        side
      ) => {

        const b =
          document.createElement(
            'div'
          );


        b.id =
          id;


        b.textContent =
          symbol;


        b.style.position =
          'absolute';


        b.style.top =
          '50%';


        b.style.transform =
          'translateY(-50%)';


        b.style[side] =
          '10px';


        b.style.cursor =
          'pointer';


        b.style.opacity =
          '0.6';


        b.style.userSelect =
          'none';


        b.style.fontSize =
          '32px';


        b.style.lineHeight =
          '1';


        b.style.zIndex =
          '10001';


        b.style.padding =
          '5px';


        b.style.touchAction =
          'manipulation';


        b.onmouseenter =
          () => {

            b.style.opacity =
              '1';
          };


        b.onmouseleave =
          () => {

            b.style.opacity =
              '0.6';
          };


        return b;
      };


    const prev =
      mkBtn(
        'candidate-prev',
        '‹',
        'left'
      );


    const next =
      mkBtn(
        'candidate-next',
        '›',
        'right'
      );


    prev.onclick =
      e => {

        switchCandidate(
          e,
          -1
        );
      };


    next.onclick =
      e => {

        switchCandidate(
          e,
          1
        );
      };


    dataStationContainer.append(
      prev,
      next
    );
  }


  /* =========================================================
     SWITCH CANDIDATE
     ========================================================= */

  function switchCandidate(
    e,
    dir
  ) {

    e.stopPropagation();


    if (
      currentCandidates.length <= 1
    ) {
      return;
    }


    currentCandidateIndex =
      (
        currentCandidateIndex +
        dir +
        currentCandidates.length
      ) %
      currentCandidates.length;


    renderCandidate(
      currentCandidateIndex
    );
  }


  /* =========================================================
     STATIONS OVERLAY
     ========================================================= */

  function showStationsOverlay(
    candidates,
    onSelect
  ) {

    if (
      !Array.isArray(candidates) ||
      !candidates.length
    ) {
      return;
    }


    if (
      document.getElementById(
        'stations-overlay'
      )
    ) {
      return;
    }


    const overlay =
      document.createElement(
        'div'
      );


    overlay.id =
      'stations-overlay';


    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;


    const panel =
      document.createElement(
        'div'
      );


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
      box-sizing: border-box;
    `;


    if (
      (
        window.visualViewport?.width ||
        window.innerWidth
      ) < 500
    ) {

      overlay.style.alignItems =
        'stretch';


      overlay.style.justifyContent =
        'stretch';


      panel.style.width =
        '100vw';


      panel.style.maxWidth =
        '100vw';


      panel.style.height =
        '100vh';


      panel.style.maxHeight =
        '100vh';


      panel.style.borderRadius =
        '0';


      panel.style.padding =
        '12px 10px 10px';
    }


    const header =
      document.createElement(
        'div'
      );


    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-shrink: 0;
    `;


    const title =
      document.createElement(
        'div'
      );


    title.textContent =
      `Stations (${candidates.length})`;


    title.style.color =
      'var(--color-text)';


    title.style.fontSize =
      '16px';


    title.style.fontWeight =
      '600';


    const closeBtn =
      document.createElement(
        'div'
      );


    closeBtn.textContent =
      '✕';


    closeBtn.style.cssText = `
      cursor: pointer;
      font-size: 20px;
      color: var(--color-text);
      opacity: 0.7;
      padding: 5px;
      touch-action: manipulation;
    `;


    closeBtn.onmouseenter =
      () => {

        closeBtn.style.opacity =
          '1';
      };


    closeBtn.onmouseleave =
      () => {

        closeBtn.style.opacity =
          '0.7';
      };


    const list =
      document.createElement(
        'div'
      );


    list.style.cssText = `
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      -webkit-overflow-scrolling: touch;
      min-height: 0;
    `;


    candidates.forEach(
      (c, index) => {

        const item =
          document.createElement(
            'div'
          );


        item.style.cssText = `
          display: grid;
          grid-template-columns: 56px 1fr auto;
          gap: 8px;
          align-items: center;
          padding: 6px;
          border-radius: 4px;
          cursor: pointer;
          background: var(--color-3, #1a1a1a);
          box-sizing: border-box;
          touch-action: manipulation;
        `;


        item.onmouseenter =
          () => {

            item.style.background =
              'var(--color-4, #2a2a2a)';
          };


        item.onmouseleave =
          () => {

            item.style.background =
              'var(--color-3, #1a1a1a)';
          };


        const logo =
          document.createElement(
            'img'
          );


        logo.src =
          c.logoUrl || '';


        logo.style.cssText = `
          width: 50px;
          height: 50px;
          object-fit: contain;
        `;


        const info =
          document.createElement(
            'div'
          );


        const stationName =
          document.createElement(
            'div'
          );


        stationName.textContent =
          c.station || '—';


        stationName.style.cssText = `
          font-weight:600;
          color:var(--color-text);
        `;


        const stationInfo =
          document.createElement(
            'div'
          );


        stationInfo.textContent =
          `${c.location || ''} · ` +
          `${c.itu || ''} · ` +
          `${c.azimuth ?? '?'}°`;


        stationInfo.style.cssText = `
          font-size:12px;
          opacity:.8;
          color:var(--color-text);
        `;


        info.append(
          stationName,
          stationInfo
        );


        const meta =
          document.createElement(
            'div'
          );


        meta.style.cssText = `
          font-size:12px;
          opacity:0.8;
          white-space:nowrap;
          color:var(--color-text);
        `;


        meta.textContent =
          `${c.pol
            ? `[${String(c.pol).toUpperCase()}] ·`
            : ''
          } ${c.erp ?? '?'} kW · ` +
          `${c.distance ?? '?'} km`;


        item.append(
          logo,
          info,
          meta
        );


        item.onclick =
          e => {

            e.stopPropagation();


            const text =
              `${c.freq} - ${c.pi || 'noPi'} | ` +
              `${c.station} [` +
              `${c.location}, ${c.itu}] - ` +
              `${c.distance} | ${c.erp} kW`;


            if (
              typeof copyToClipboard ===
              'function'
            ) {

              copyToClipboard(
                text
              );
            }


            openSt(
              c
            );


            if (
              typeof onSelect ===
              'function'
            ) {

              onSelect(
                c,
                index
              );
            }
          };


        list.appendChild(
          item
        );
      }
    );


    header.append(
      title,
      closeBtn
    );


    panel.append(
      header,
      list
    );


    overlay.appendChild(
      panel
    );


    document.body.appendChild(
      overlay
    );


    function close() {

      overlay.remove();


      document.removeEventListener(
        'keydown',
        onKey
      );
    }


    function onKey(e) {

      if (
        e.key === 'Escape'
      ) {
        close();
      }
    }


    closeBtn.onclick =
      close;


    overlay.onclick =
      close;


    panel.onclick =
      e => {

        e.stopPropagation();
      };


    document.addEventListener(
      'keydown',
      onKey
    );
  }


  /* =========================================================
     RENDER CANDIDATE
     ========================================================= */

  function renderCandidate(
    index
  ) {

    const c =
      currentCandidates[index];


    if (!c) {
      return;
    }


    /* -------------------------------------------------------
       LOGO
       
       Use the ORIGINAL Station Logo element.
       ------------------------------------------------------- */

    if (
      c.logoUrl
    ) {

      showNoRdsLogo(
        c.logoUrl
      );

    } else {

      hideNoRdsLogo();
    }


    /* -------------------------------------------------------
       STATION DATA
       ------------------------------------------------------- */

    const setText =
      (
        id,
        value
      ) => {

        const el =
          byId(
            dataStationContainer,
            id
          );


        const v =
          value ?? '';


        if (
          el &&
          el.textContent !==
          String(v)
        ) {

          el.textContent =
            String(v);
        }
      };


    setText(
      'data-station-name',
      c.station
    );


    setText(
      'data-station-city',
      c.location
    );


    setText(
      'data-station-itu',
      c.itu
    );


    setText(
      'data-station-erp',
      c.erp
    );


    setText(
      'data-station-pol',
      c.pol
    );


    setText(
      'data-station-azimuth',
      (c.azimuth ?? '') + '°'
    );


    setText(
      'data-station-distance',
      Number(c.distance ?? 0) +
      ' km'
    );


    /* -------------------------------------------------------
       +N
       ------------------------------------------------------- */

    const azimuthElement =
      byId(
        dataStationContainer,
        'data-station-azimuth'
      );


    if (
      azimuthElement
    ) {

      const otherStations =
        azimuthElement.parentNode;


      document
        .querySelectorAll(
          '#other-stations-no-rds'
        )
        .forEach(
          el => el.remove()
        );


      if (
        currentCandidates.length > 1
      ) {

        const docOtherSt =
          document.createElement(
            'span'
          );


        docOtherSt.id =
          'other-stations-no-rds';


        docOtherSt.style.background =
          'var(--color-4)';


        docOtherSt.style.color =
          'var(--color-main)';


        docOtherSt.style.borderRadius =
          '4px';


        docOtherSt.style.padding =
          '0px 4px';


        docOtherSt.style.cursor =
          'pointer';


        docOtherSt.style.marginLeft =
          '4px';


        docOtherSt.style.userSelect =
          'none';


        docOtherSt.textContent =
          `+${currentCandidates.length}`;


        otherStations.appendChild(
          docOtherSt
        );


        docOtherSt.addEventListener(
          'click',
          event => {

            event.stopPropagation();


            showStationsOverlay(
              currentCandidates
            );
          }
        );
      }
    }


    /* -------------------------------------------------------
       NAVIGATION BUTTONS
       ------------------------------------------------------- */

    ensureSideButtons();


    const show =
      currentCandidates.length > 1
        ? 'block'
        : 'none';


    const prev =
      byId(
        dataStationContainer,
        'candidate-prev'
      );


    const next =
      byId(
        dataStationContainer,
        'candidate-next'
      );


    if (prev) {

      prev.style.display =
        show;
    }


    if (next) {

      next.style.display =
        show;
    }


    /* -------------------------------------------------------
       STATION NAME
       ------------------------------------------------------- */

    const stationName =
      byId(
        dataStationContainer,
        'data-station-name'
      );


    if (
      stationName?.parentNode
    ) {

      stationName.parentNode.style.display =
        'block';


      stationName.parentNode.style.padding =
        '0px';
    }


    /* -------------------------------------------------------
       SHOW DATA PANEL
       ------------------------------------------------------- */

    dataStationContainer.style.display =
      'block';


    /* -------------------------------------------------------
       COPY ON CLICK
       ------------------------------------------------------- */

    dataStationContainer.onclick =
      e => {

        e.stopPropagation();


        if (
          e.target.closest(
            '#candidate-prev'
          ) ||
          e.target.closest(
            '#candidate-next'
          ) ||
          e.target.closest(
            '#other-stations-no-rds'
          )
        ) {

          return;
        }


        const text =
          `${c.freq} - ${c.pi || 'noPi'} | ` +
          `${c.station} [` +
          `${c.location}, ${c.itu}] - ` +
          `${c.distance} | ${c.erp} kW`;


        if (
          typeof copyToClipboard ===
          'function'
        ) {

          copyToClipboard(
            text
          );
        }
      };
  }


  /* =========================================================
     SHOW CANDIDATES
     ========================================================= */

  function showCandidates(
    list,
    isServer = false
  ) {

    const candidates =
      Array.isArray(list)
        ? list
        : [];


    const newHash =
      hashCandidates(
        candidates
      );


    /*
     * Identical data:
     * don't redraw anything.
     */

    if (
      newHash ===
        lastCandidatesHash &&
      candidates.length ===
        lastCandidatesLength
    ) {

      /*
       * Still make sure responsive logo state is correct.
       */
      if (
        noRdsLogoUrl
      ) {

        applyNoRdsLogo();
      }

      return;
    }


    lastCandidatesHash =
      newHash;


    lastCandidatesLength =
      candidates.length;


    currentCandidates =
      candidates;


    if (
      currentCandidateIndex >=
      currentCandidates.length
    ) {

      currentCandidateIndex =
        0;
    }


    if (
      !currentCandidates.length
    ) {

      hideNoRdsUI();

      return;
    }


    /*
     * Server RDS result:
     * normal RDS data has priority.
     */

    if (
      isServer
    ) {

      hideNoRdsUI();

      return;
    }


    dataStationContainer.style.display =
      'block';


    renderCandidate(
      currentCandidateIndex
    );
  }


  /* =========================================================
     DATA PLUGIN WEBSOCKET
     ========================================================= */

  const url =
    new URL(
      location.href
    );


  const protocol =
    url.protocol === 'https:'
      ? 'wss:'
      : 'ws:';


  const basePath =
    url.pathname
      .replace(
        /setup/g,
        ''
      )
      .replace(
        /\/?$/,
        '/'
      );


  const WS_URL =
    `${protocol}//${url.host}${basePath}data_plugins`;


  /* =========================================================
     WEBSOCKET
     ========================================================= */

  function connectDataWS() {

    try {

      ws =
        new WebSocket(
          WS_URL
        );

    } catch (err) {

      console.error(
        '[StationsWithoutRDS] WebSocket creation failed:',
        err
      );


      setTimeout(
        connectDataWS,
        3000
      );


      return;
    }


    ws.onopen =
      () => {

        console.log(
          '[StationsWithoutRDS] WebSocket connected'
        );
      };


    ws.onmessage =
      e => {

        const msg =
          safeJsonParse(
            e.data
          );


        if (
          !msg ||
          msg.type !==
            pluginName
        ) {

          return;
        }


        const v =
          msg.value;


        /*
         * Only process "find".
         */

        if (
          v?.action ===
          'find'
        ) {

          loc =
            v?.loc ||
            null;


          showCandidates(
            v.list,
            v?.isServer ||
            false
          );
        }
      };


    ws.onerror =
      err => {

        console.warn(
          '[StationsWithoutRDS] WebSocket error:',
          err
        );
      };


    ws.onclose =
      () => {

        console.log(
          '[StationsWithoutRDS] WebSocket closed. Reconnecting...'
        );


        setTimeout(
          connectDataWS,
          3000
        );
      };
  }


  /* =========================================================
     START
     ========================================================= */

  activeLogoElement =
    getActiveOriginalLogo();


  console.log(
    '[StationsWithoutRDS] Plugin initialized'
  );


  console.log(
    '[StationsWithoutRDS] Using original Station Logo containers'
  );


  connectDataWS();

})();
