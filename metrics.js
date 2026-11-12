/* Diagnostics only: never changes BP messages, schedule, or stopping rules. */
function temporalMetrics(history, metadata, windowSize = 5) {
  const rows = [];
  if (!history.length) return rows;
  const sums = history[0].map(() => 0);
  let previousIteration = 0;
  for (let index = 1; index < history.length; index++) {
    const meta = metadata[index];
    // Flooding: after both half-steps. Serial: after an entire VN sweep.
    if (!meta || meta.iteration <= previousIteration) continue;
    previousIteration = meta.iteration;
    const llr = history[index].slice();
    const count = rows.length + 1;
    const signedMean = llr.map((value, j) => (sums[j] += value) / count);
    const A = signedMean.map(Math.abs);
    const R = sums.map(Math.abs);
    const recent = rows.slice(-Math.max(0, windowSize - 1)).map(row => row.llr);
    if (windowSize === 1) recent.length = 0;
    recent.push(llr);
    const windowMean = llr.map((_, j) => recent.reduce((s, v) => s + v[j], 0) / recent.length);
    const windowStd = windowMean.map((mean, j) => Math.sqrt(recent.reduce((s, v) => s + (v[j] - mean) ** 2, 0) / recent.length));
    const prev = rows.at(-1);
    rows.push({index, iteration: meta.iteration, count, step: meta.step,
      unsatisfied: meta.unsatisfied, llr, R, A, signedMean, windowMean, windowStd,
      deltaA: A.map((value, j) => prev ? Math.abs(value - prev.A[j]) : null)});
  }
  return rows;
}

if (typeof module !== 'undefined') module.exports = {temporalMetrics};

if (typeof document !== 'undefined' && typeof bp !== 'undefined') {
  const section = document.createElement('section');
  section.className = 'temporalMetrics';
  section.innerHTML = `
    <h2>LLRの時間和・時間平均を追う</h2>
    <p>初期値 t=0 を除き、Floodingは完全な1反復、Serialは全変数の1スイープ後に記録します。上の履歴スライダー・ビット選択と連動します。</p>
    <div class="metricsActions"><label>直近の窓幅 W <input id="metricsWindow" type="number" min="1" max="1000" value="5"></label>
    <button id="metricsExport" type="button">指標のCSVを保存</button></div>
    <p id="metricsStatus" aria-live="polite"></p>
    <div id="metricsCharts"></div>
    <p>R(T)=|Σ L(t)|、A(T)=|Σ L(t)/T|。符号付き平均と窓内標準偏差も表示します。窓が満たされる前は取得済みの反復だけを使います。</p>
    <p>平均の安定は非収束の保証ではありません。累積平均の変化量は反復数が増えるだけでも小さくなります。この表示からの自動停止は行いません。</p>
    <p>出典：<a href="https://arxiv.org/html/2512.07057v1#S2" target="_blank" rel="noreferrer">Beam Search Decoder §II</a>・<a href="https://arxiv.org/html/2512.07057v1#A2" target="_blank" rel="noreferrer">付録B・Algorithm 3, line 27</a>。Rは変数選択、Σ Aは探索枝の評価に使われます。窓平均・標準偏差・ΔAは今回追加した診断表示です。</p>`;
  document.querySelector('.workspace').append(section);
  const windowInput = document.getElementById('metricsWindow');
  const status = document.getElementById('metricsStatus');
  const charts = document.getElementById('metricsCharts');
  let cachedHistory, cachedLength, cachedWindow, cachedRows;
  function getRows() {
    const W = Math.max(1, Math.min(1000, Math.trunc(Number(windowInput.value) || 5)));
    if (cachedHistory !== bp.history || cachedLength !== bp.history.length || cachedWindow !== W) {
      cachedHistory = bp.history; cachedLength = bp.history.length; cachedWindow = W;
      cachedRows = temporalMetrics(bp.history, bp.traceMeta, W);
    }
    return cachedRows;
  }
  function chart(rows, ids, key, title, cursor) {
    const width = 900, height = 185, left = 65, top = 15, right = 20, bottom = 30;
    const values = rows.flatMap(row => ids.map(j => row[key][j])).filter(Number.isFinite);
    let low = values.reduce((a,b) => Math.min(a,b),0), high = values.reduce((a,b) => Math.max(a,b),0);
    if (high === low) high = low + 1;
    const padding = (high - low) * .05;
    high += padding; if (low < 0) low -= padding;
    const maxT = Math.max(1, rows.at(-1)?.iteration || 1);
    const x = t => left + t / maxT * (width - left - right);
    const y = v => top + (high - v) / (high - low) * (height - top - bottom);
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">`;
    for (let k = 0; k <= 4; k++) {
      const v = low + (high-low)*k/4;
      svg += `<path d="M${left},${y(v)}H${width-right}" stroke="#dde3eb"/><text x="${left-7}" y="${y(v)+4}" text-anchor="end">${v.toPrecision(3)}</text>`;
    }
    for (const j of ids) {
      const points = rows.filter(row => Number.isFinite(row[key][j])).map(row => `${x(row.iteration)},${y(row[key][j])}`).join(' ');
      svg += `<polyline points="${points}" fill="none" stroke="${variableColor(j)}" stroke-width="${ids.length===1?2.5:1.2}" opacity="${ids.length===1?1:.5}"><title>v${j}</title></polyline>`;
    }
    const row = rows.filter(row => row.index <= cursor).at(-1);
    if (row) svg += `<path d="M${x(row.iteration)},${top}V${height-bottom}" stroke="#11967b" stroke-dasharray="4 3"/>`;
    svg += `<text x="${left}" y="${height-8}">0</text><text x="${width-right}" y="${height-8}" text-anchor="end">${maxT}</text><text x="${width/2}" y="${height-8}" text-anchor="middle">iteration / sweep</text></svg>`;
    return `<figure><figcaption>${title}</figcaption>${svg}</figure>`;
  }
  function renderMetrics() {
    const rows = getRows();
    const cursor = Number(llrUi.cursor.value);
    const id = llrUi.bit.value;
    const ids = id === '' ? code.variables.map(v => v.id) : [Number(id)];
    const row = rows.filter(row => row.index <= cursor).at(-1);
    status.textContent = row ? `完全反復 T=${row.count} / iteration ${row.iteration} / step ${row.step} / 未充足 ${row.unsatisfied}` : '完全な1反復が終わると値を表示します。';
    if (row && id !== '') {
      const j = Number(id), f = v => v === null ? '—' : v.toPrecision(7);
      status.textContent += ` · v${j}: L=${f(row.llr[j])}, R=${f(row.R[j])}, A=${f(row.A[j])}, ΔA=${f(row.deltaA[j])}, 窓平均=${f(row.windowMean[j])}, 窓標準偏差=${f(row.windowStd[j])}`;
    }
    charts.innerHTML = [
      ['R', '時間和の絶対値 R(T)'], ['A', '時間平均の絶対値 A(T)'],
      ['signedMean', '符号付き累積平均 Σ L(t)/T'], ['deltaA', '時間平均の変化量 |A(T) − A(T−1)|'],
      ['windowMean', `直近 W=${windowInput.value} 反復の符号付き平均`],
      ['windowStd', '直近の窓内標準偏差（揺れの大きさ）']
    ].map(([key,title]) => chart(rows, ids, key, title, cursor)).join('');
  }
  windowInput.addEventListener('input', renderMetrics);
  // Existing controls captured the original render function before this extension loaded.
  llrUi.bit.addEventListener('change', renderMetrics);
  llrUi.cursor.addEventListener('input', renderMetrics);
  document.getElementById('metricsExport').addEventListener('click', () => {
    const rows = getRows(), id = llrUi.bit.value;
    const ids = id === '' ? code.variables.map(v => v.id) : [Number(id)];
    const fields = ['llr','R','A','signedMean','deltaA','windowMean','windowStd'];
    const csv = [['T','iteration','step','unsatisfied','window','variable','schedule','damping','code','size','prior_llr','true_error_bits','syndrome',...fields].join(',')];
    const errors = code.variables.filter(v => v.error).map(v => v.id).join(';');
    const syndrome = code.checks.map(c => c.syndrome).join('');
    for (const row of rows) for (const j of ids) {
      const meta = bp.traceMeta[row.index];
      csv.push([row.count,row.iteration,row.step,row.unsatisfied,cachedWindow,j,meta.schedule,meta.damping,code.type,code.size,bp.prior,errors,syndrome,...fields.map(key => row[key][j] ?? '')].join(','));
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF'+csv.join('\r\n')], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href=url; a.download=`bp-temporal-${code.type}-${id===''?'all':`v${id}`}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const originalRender = render;
  render = function() { originalRender(); renderMetrics(); };
  renderMetrics();
}
