(() => {
  "use strict";

  const CATALOG_TIMEOUT_MS = 12000;
  const CATALOG_RADIUS_DEG = 0.03;

  const setMapMessage = (panel, message, hidden = false) => {
    const element = panel.querySelector(".sky-context-map-message");
    element.textContent = message;
    element.hidden = hidden;
  };

  const setCatalogStatus = (panel, key, label, state, count = null) => {
    const element = panel.querySelector(`[data-catalog-status="${key}"]`);
    if (!element) return;

    element.classList.remove("is-pending", "is-unavailable");
    if (state === "pending") element.classList.add("is-pending");
    if (state === "unavailable") element.classList.add("is-unavailable");

    const suffix = {
      pending: "加载中",
      ready: count === null ? "已加载" : `${count} 个`,
      unavailable: "暂不可用",
    }[state];
    element.lastChild.textContent = `${label}：${suffix}`;
  };

  const catalogCount = (catalog) => {
    if (!catalog || typeof catalog.getSources !== "function") return null;
    return catalog.getSources().length;
  };

  const addCatalog = (panel, aladin, definition) => {
    setCatalogStatus(panel, definition.key, definition.label, "pending");
    let settled = false;

    const markReady = () => {
      settled = true;
      setCatalogStatus(
        panel,
        definition.key,
        definition.label,
        "ready",
        catalogCount(catalog),
      );
    };
    const markUnavailable = () => {
      settled = true;
      setCatalogStatus(panel, definition.key, definition.label, "unavailable");
    };

    let catalog;
    try {
      catalog = definition.create(markReady, markUnavailable);
      aladin.addCatalog(catalog);
    } catch (error) {
      console.warn(`Unable to load ${definition.label} catalog`, error);
      markUnavailable();
      return;
    }

    window.setTimeout(() => {
      if (!settled) markUnavailable();
    }, CATALOG_TIMEOUT_MS);
  };

  const initializePanel = async (panel) => {
    const ra = Number.parseFloat(panel.dataset.ra);
    const dec = Number.parseFloat(panel.dataset.dec);
    const name = panel.dataset.targetName || "当前目标";
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
      setMapMessage(panel, "目标坐标无效，无法显示天区图。");
      return;
    }

    try {
      await window.A.init;
      const mapElement = panel.querySelector(".sky-context-map");
      const aladin = window.A.aladin(mapElement, {
        target: `${ra} ${dec}`,
        survey: "P/2MASS/color",
        fov: 0.08,
        cooFrame: "ICRSd",
        projection: "TAN",
        showCooGrid: true,
        showCooGridControl: true,
        showContextMenu: true,
        showFullscreenControl: true,
        showGotoControl: true,
        showLayersControl: true,
        showReticle: true,
        showSimbadPointerControl: true,
      });

      const targetCatalog = window.A.catalog({
        name: "当前目标",
        color: "#d72d42",
        shape: "cross",
        sourceSize: 14,
        onClick: "showPopup",
      });
      targetCatalog.addSources([
        window.A.marker(ra, dec, {
          popupTitle: name,
          popupDesc: `RA ${ra.toFixed(6)}°, Dec ${dec.toFixed(6)}°`,
        }),
      ]);
      aladin.addCatalog(targetCatalog);
      setMapMessage(panel, "", true);

      const position = { ra, dec };
      const definitions = [
        {
          key: "simbad",
          label: "SIMBAD",
          create: (ready, failed) => window.A.catalogFromSimbad(
            position,
            CATALOG_RADIUS_DEG,
            {
              name: "SIMBAD",
              color: "#298653",
              shape: "circle",
              sourceSize: 7,
              limit: 200,
              onClick: "showPopup",
            },
            ready,
            failed,
          ),
        },
        {
          key: "ned",
          label: "NED",
          create: (ready, failed) => window.A.catalogFromNED(
            position,
            CATALOG_RADIUS_DEG,
            {
              name: "NED",
              color: "#bd6b13",
              shape: "plus",
              sourceSize: 9,
              limit: 200,
              onClick: "showPopup",
            },
            ready,
            failed,
          ),
        },
        {
          key: "gaia",
          label: "Gaia DR3",
          create: (ready, failed) => window.A.catalogFromVizieR(
            "I/355/gaiadr3",
            position,
            CATALOG_RADIUS_DEG,
            {
              name: "Gaia DR3",
              color: "#2166ad",
              shape: "square",
              sourceSize: 5,
              limit: 300,
              onClick: "showPopup",
            },
            ready,
            failed,
          ),
        },
      ];
      definitions.forEach((definition) => {
        addCatalog(panel, aladin, definition);
      });
    } catch (error) {
      console.error("Unable to initialize Aladin Lite", error);
      setMapMessage(
        panel,
        "CDS 底图暂不可用；目标坐标和下方外部星表链接仍可使用。",
      );
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".sky-context").forEach(initializePanel);
  });
})();
