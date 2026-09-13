/* Read-only snapshot UI. Never submit, refresh or cancel facility requests. */
(() => {
  'use strict';
  const form = document.getElementById('telescope-filters');
  if (!form) return;
  const status = document.getElementById('telescope-status');
  const more = document.getElementById('telescope-more');
  const plot = document.getElementById('telescope-lightcurve');
  const display = window.telescopeDisplay;
  const expectedSnapshot = form.dataset.snapshotSha256;
  const generated = document.getElementById('telescope-generated');
  generated.textContent = display.timestamp(generated.dateTime);
  const restored = new URLSearchParams(location.search);
  for (const field of ['telescope', 'band', 'date_from', 'date_to']) {
    if (restored.has(field)) form.elements.namedItem(field).value = restored.get(field);
  }
  let controller;
  let generation = 0;
  let points = [];
  let nextOffset = null;
  let activeFilters;
  const text = display.text;
  const yesNo = value => value === true ? '是' : value === false ? '否' : '未提供';
  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function clear() {
    for (const id of ['telescope-points', 'telescope-requests', 'telescope-qa', 'telescope-daily']) {
      document.getElementById(id).replaceChildren();
    }
    if (window.Plotly) window.Plotly.purge(plot);
    plot.replaceChildren();
    more.hidden = true;
  }
  async function fetchSection(section, filters, signal, offset = 0) {
    const params = new URLSearchParams({limit: '100', offset: String(offset)});
    if (filters.telescope) params.set('telescope', filters.telescope);
    if (['photometry', 'qa'].includes(section) && filters.band) params.set('band', filters.band);
    // Only photometry uses UTC observation dates. QA archive days and daily
    // report days must not silently inherit this filter; request dates are submission dates.
    if (section === 'photometry') {
      for (const field of ['date_from', 'date_to']) if (filters[field]) params.set(field, filters[field]);
    }
    const response = await fetch(`/telescope-data/api/v1/targets/${encodeURIComponent(filters.target)}/${section}?${params}`, {
      signal, credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('会话可能已失效，请重新登录。');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `数据读取失败（${response.status}）。`);
    return data;
  }
  function renderPoints() {
    const table = document.getElementById('telescope-points');
    table.replaceChildren();
    const groups = new Map();
    for (const row of points) {
      const tr = element('tr');
      for (const value of [row.telescope, row.band, row.mjd, row.mag, row.err, row.limMag, yesNo(row.detected), yesNo(row.templateSubtracted)]) tr.append(element('td', text(value)));
      table.append(tr);
      // Unknown/non-detections are not silently promoted to detections or upper limits.
      if (row.detected !== true || !Number.isFinite(row.mjd) || !Number.isFinite(row.mag)) continue;
      const key = JSON.stringify([row.telescope, row.band, row.templateSubtracted]);
      if (!groups.has(key)) groups.set(key, {type: 'scatter', mode: 'markers',
        name: `${text(row.telescope)} / ${text(row.band)} / 模板减除:${yesNo(row.templateSubtracted)}`,
        x: [], y: [], error_y: {type: 'data', array: [], visible: true}});
      const trace = groups.get(key);
      trace.x.push(row.mjd);
      trace.y.push(row.mag);
      trace.error_y.array.push(Number.isFinite(row.err) && row.err >= 0 ? row.err : null);
    }
    if (!points.length) {
      const row = element('tr');
      const cell = element('td', '没有符合当前筛选条件的测光记录；可清除筛选后重试。');
      cell.colSpan = 8;
      row.append(cell); table.append(row);
    }
    if (window.Plotly && groups.size) {
      window.Plotly.react(plot, [...groups.values()], {
        xaxis: {title: 'MJD（按日报原值）'}, yaxis: {title: 'mag（原始星等）', autorange: 'reversed'},
        margin: {t: 30, r: 20, b: 75, l: 60}, legend: {orientation: 'h', y: -0.25},
      }, {responsive: true, displaylogo: false});
    } else {
      if (window.Plotly) window.Plotly.purge(plot);
      plot.replaceChildren(element('p', groups.size ? '曲线组件不可用，请查看测光表。' : '当前已加载记录没有可绘制的明确探测点。'));
    }
  }
  function renderRecords(id, data, fields) {
    const container = document.getElementById(id);
    container.replaceChildren(element('p', `显示 ${data.count} / ${data.total} 条快照记录。`));
    for (const row of data.items) {
      const card = element('dl', undefined, 'border rounded p-3');
      for (const [key, label] of fields) {
        const value = key.includes('status') ? display.state(row[key]) : key === 'submitted_at' ? display.timestamp(row[key]) : text(row[key]);
        card.append(element('dt', label), element('dd', value));
      }
      if (row.consistency_warnings?.length) card.append(element('p', '状态存在矛盾：不能据此认定本次请求已完成。', 'text-danger'));
      container.append(card);
    }
    if (data.next_offset !== null) container.append(element('p', '记录超过本页上限；其余记录未在此页显示。', 'text-muted'));
  }
  function renderQA(data) {
    const container = document.getElementById('telescope-qa');
    container.replaceChildren(element('p', `显示 ${data.count} / ${data.total} 条质控记录（不使用测光 UTC 日期筛选）。`));
    for (const row of data.items) {
      const card = element('div', undefined, 'col-md-6');
      card.append(element('p', `${text(row.telescope)} · ${text(row.band)} · ${text(row.date)} · ${display.state(row.stage)}`));
      // Server emits opaque authenticated same-origin image URLs, never upstream src.
      if (row.asset_url?.startsWith('/telescope-data/assets/')) {
        const img = element('img');
        img.src = row.asset_url;
        img.alt = text(row.caption || row.label || row.stage);
        img.className = 'img-fluid'; img.loading = 'lazy';
        img.addEventListener('error', () => img.replaceWith(element('p', '图片暂不可读取；如日报已更新，请刷新页面。')));
        card.append(img);
      } else card.append(element('p', '未提供可读取的质控图。', 'text-muted'));
      container.append(card);
    }
    if (data.next_offset !== null) container.append(element('p', '其余质控记录未在本页显示。'));
  }
  async function load(append = false) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const version = ++generation;
    if (!append) { activeFilters = Object.fromEntries(new FormData(form)); points = []; nextOffset = null; clear(); }
    if (!append) {
      const url = new URL(location.href);
      url.search = '';
      for (const [key, value] of Object.entries(activeFilters)) if (value) url.searchParams.set(key, value);
      history.replaceState(null, '', url);
      const targetSelect = form.elements.namedItem('target');
      const name = targetSelect.selectedOptions[0]?.textContent || activeFilters.target;
      const targetLink = document.getElementById('telescope-target-link');
      targetLink.href = `/from-snclock/${encodeURIComponent(name)}/`;
      targetLink.textContent = `查看 ${name} 的目标与观测`;
    }
    more.disabled = true;
    status.className = 'text-muted';
    status.textContent = '正在读取日报快照…';
    try {
      const filters = activeFilters;
      if (!filters.target) throw new Error('日报中没有可选择的目标。');
      const results = await Promise.all(append
        ? [fetchSection('photometry', filters, signal, nextOffset)]
        : ['photometry', 'requests', 'qa', 'daily'].map(section => fetchSection(section, filters, signal)));
      if (version !== generation) return;
      if (!display.sameSnapshot(expectedSnapshot, results)) throw new Error('日报已更新。请刷新页面后查看，避免混用不同批次的数据。');
      const [photometry, requests, qa, daily] = results;
      points = append ? points.concat(photometry.items) : photometry.items;
      nextOffset = photometry.next_offset;
      renderPoints();
      if (!append) {
        renderRecords('telescope-requests', requests, [['telescope', '望远镜'], ['external_id', '设施请求标识'], ['submitted_at', '提交时刻'], ['facility_status', '设施状态'], ['raw_files', '本请求文件数'], ['reported_status', '日报处理状态']]);
        renderQA(qa);
        renderRecords('telescope-daily', daily, [['date', '北京时间报告日'], ['telescope', '望远镜'], ['status', '报告状态'], ['added_count', '新增记录'], ['reason', '说明']]);
      }
      status.textContent = `已加载 ${points.length} / ${photometry.total} 个测光点；日报生成：${display.timestamp(photometry.generated_at)}。`;
      more.hidden = nextOffset === null;
    } catch (error) {
      if (version !== generation || error.name === 'AbortError') return;
      clear(); points = []; nextOffset = null;
      status.className = 'text-danger';
      status.textContent = error.message;
      const retry = element('a', ' 刷新页面');
      retry.href = location.href;
      status.append(retry);
    } finally { if (version === generation) more.disabled = false; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); load(); });
  more.addEventListener('click', () => load(true));
  document.getElementById('telescope-reset').addEventListener('click', () => {
    for (const field of ['telescope', 'band', 'date_from', 'date_to']) form.elements.namedItem(field).value = '';
    load();
  });
  load();
})();
