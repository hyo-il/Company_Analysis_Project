// Chart.js 래퍼. 패널 단위로 인스턴스를 관리해 페이지 전환 시 destroy.

const registry = new WeakMap(); // panel -> Map<canvasId, Chart>

function getOrCreatePanelMap(panel) {
  let m = registry.get(panel);
  if (!m) { m = new Map(); registry.set(panel, m); }
  return m;
}

export function destroyChartsIn(panel) {
  const m = registry.get(panel);
  if (!m) return;
  m.forEach(c => { try { c.destroy(); } catch {} });
  m.clear();
}

function track(panel, id, chart) {
  const m = getOrCreatePanelMap(panel);
  if (m.has(id)) { try { m.get(id).destroy(); } catch {} }
  m.set(id, chart);
}

export function sparkline(canvas, values, color = '#8b5cb0') {
  if (!canvas || !window.Chart) return null;
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: color + '20',
        borderWidth: 1.5,
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      }],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      animation: false,
    },
  });
  const panel = canvas.closest('.panel') || canvas.closest('.route-panel');
  if (panel) track(panel, canvas.id || canvas, chart);
  return chart;
}

// 막대그래프 + 각 막대 위 값 표기. formatFn은 값 포맷터.
export function trendChart(canvas, values, labels, formatFn = v => String(Math.round(v))) {
  if (!canvas || !window.Chart) return null;
  const n = values.length;
  // 라벨 표시: 현재(마지막)·최대·최소만 (겹침 방지)
  let minIdx = 0, maxIdx = 0;
  values.forEach((v, i) => {
    if (v == null) return;
    if (values[minIdx] == null || v < values[minIdx]) minIdx = i;
    if (values[maxIdx] == null || v > values[maxIdx]) maxIdx = i;
  });
  const showIdx = new Set([n - 1, minIdx, maxIdx]);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels && labels.length === n ? labels : values.map((_, i) => String(i + 1)),
      datasets: [{
        data: values,
        backgroundColor: '#8b5cb0',
        hoverBackgroundColor: '#774b9b',
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 28,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 8, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true, callbacks: { label: ctx => formatFn(ctx.parsed.y) } },
        datalabels: {
          display: ctx => showIdx.has(ctx.dataIndex),
          anchor: 'end',
          align: 'top',
          offset: 4,
          clamp: true,
          clip: false,
          color: '#6b7280',
          font: { size: 11, family: 'system-ui, -apple-system, sans-serif', weight: '500' },
          formatter: v => v == null ? '' : formatFn(v),
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#6b7280' }, grid: { display: false } },
        y: { display: false, grace: '15%' },
      },
      animation: false,
    },
  });
  const panel = canvas.closest('.panel') || canvas.closest('.route-panel');
  if (panel) track(panel, canvas.id || canvas, chart);
  return chart;
}

export function bandChart(canvas, { labels, values, meanLine, upperBand, lowerBand, title }) {
  if (!canvas || !window.Chart) return null;
  const n = values.length;
  // 현재 시점(마지막 인덱스) 큰 점 + 라벨
  const lastIdx = n - 1;
  const currentVal = values[lastIdx];
  const pointRadius = values.map((_, i) => i === lastIdx ? 5 : 0);
  const pointBg = values.map((_, i) => i === lastIdx ? '#8b5cb0' : 'transparent');
  const pointBorder = values.map((_, i) => i === lastIdx ? '#fff' : 'transparent');

  const currentLabelPlugin = {
    id: 'currentLabel',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data[lastIdx]) return;
      const pt = meta.data[lastIdx];
      const { ctx } = chart;
      const text = `현재 ${Number(currentVal).toFixed(2)}x`;
      ctx.save();
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      const w = ctx.measureText(text).width + 10;
      const h = 18;
      const x = Math.min(pt.x + 8, chart.chartArea.right - w);
      const y = Math.max(pt.y - h - 4, chart.chartArea.top + 2);
      ctx.fillStyle = 'rgba(139,92,176,0.95)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 4) : ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 5, y + h / 2);
      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // 0: 본 시계열
        { label: title, data: values, borderColor: '#8b5cb0', backgroundColor: 'transparent', borderWidth: 2,
          tension: 0, pointRadius, pointBackgroundColor: pointBg, pointBorderColor: pointBorder, pointBorderWidth: 2, order: 0 },
        // 1: 상단 밴드 (+1σ) — fill to 하단 밴드 → 단일 음영 밴드
        { label: '+1σ', data: upperBand, borderColor: 'rgba(199,170,219,0.6)', borderDash: [4, 3], borderWidth: 1,
          pointRadius: 0, fill: '+2', backgroundColor: 'rgba(139,92,176,0.12)', tension: 0, order: 2 },
        // 2: 평균 — 가로 점선
        { label: '평균', data: meanLine, borderColor: '#774b9b', borderDash: [2, 3], borderWidth: 1,
          pointRadius: 0, fill: false, tension: 0, order: 3 },
        // 3: 하단 밴드 (−1σ)
        { label: '−1σ', data: lowerBand, borderColor: 'rgba(199,170,219,0.6)', borderDash: [4, 3], borderWidth: 1,
          pointRadius: 0, fill: false, tension: 0, order: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        datalabels: { display: false },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { font: { size: 10 } }, grid: { color: '#ece6f1' } },
      },
      animation: false,
    },
    plugins: [currentLabelPlugin],
  });
  const panel = canvas.closest('.panel') || canvas.closest('.route-panel');
  if (panel) track(panel, canvas.id || canvas, chart);
  return chart;
}
