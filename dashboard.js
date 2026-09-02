/**
 * Roadwatch Phase 4: Results Dashboard & Analytics
 * Hand-authored inline SVG charts, confusion matrix, latency budgets, and scorecard.
 * Per Implementation Spec Part 7 and Traceability Appendix B.
 */

/**
 * The eight scored classes, in the order they appear in attack_matrix.csv's
 * TP_ / FP_ / FN_ / TN_ column families. Single source of truth for every
 * renderer in this file.
 */
export const ATTACK_CLASS_META = {
  TA:     { name: "Traffic Analysis (TA)",     plane: "data" },
  EA:     { name: "Eavesdropping (EA)",        plane: "data" },
  SI:     { name: "Sybil Injection (SI)",      plane: "data" },
  DIM:    { name: "Data Manipulation (DIM)",   plane: "data" },
  CC_TA:  { name: "Control-Channel TA",        plane: "control" },
  CC_EA:  { name: "Control-Channel EA",        plane: "control" },
  CC_SI:  { name: "Control-Channel Sybil",     plane: "control" },
  CC_DIM: { name: "Control-Channel DIM",       plane: "control" },
};
export const ATTACK_CLASS_KEYS = Object.keys(ATTACK_CLASS_META);

export class RoadwatchDashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.sweepData = null;   // the flat/top-level series for the active attack
    this.allSweeps = null;   // the whole sweep.json, incl. per-attack series
    this.activeAttack = null;
    this.activeTableViews = {};
    // OVERALL_MCC_COMPARISON_2026-09-01: collapsed by default, expandable
    // via the "Show more" button in its own card header.
    this.mccPanelExpanded = false;
    this.init();
  }

  async init() {
    try {
      if (window.ROADWATCH_DATA?.sweep) {
        this.allSweeps = window.ROADWATCH_DATA.sweep;
      } else {
        const res = await fetch('data/sweep.json');
        if (res.ok) {
          this.allSweeps = await res.json();
        }
      }
      // Attack-impact evolution (IFR_EA/LIE_TA/MFR_DIM/FIIR_SI) -- data-plane
      // only, see ATTACK_IMPACT_PANEL_2026-08-31. Non-fatal if absent: the
      // rest of the dashboard works without it.
      if (window.ROADWATCH_DATA?.impactMetrics) {
        this.impactMetrics = window.ROADWATCH_DATA.impactMetrics;
      } else {
        try {
          const impRes = await fetch('data/impact_metrics.json');
          if (impRes.ok) this.impactMetrics = await impRes.json();
        } catch (e) {
          console.warn("[Roadwatch] impact_metrics.json not available:", e);
        }
      }
      // Overall-MCC-vs-baselines comparison (2026-09-01 retrain: sigma_iat
      // leak fix + fresh TA training data). Its own file, loaded
      // independently of sweep.json/impact_metrics.json so the rest of the
      // dashboard's data is untouched -- see OVERALL_MCC_COMPARISON_2026-09-01.
      if (window.ROADWATCH_DATA?.overallMccComparison) {
        this.overallMccComparison = window.ROADWATCH_DATA.overallMccComparison;
      } else {
        try {
          const mccRes = await fetch('data/overall_mcc_comparison.json');
          if (mccRes.ok) this.overallMccComparison = await mccRes.json();
        } catch (e) {
          console.warn("[Roadwatch] overall_mcc_comparison.json not available:", e);
        }
      }
      // REPORT_FIGURES_2026-09-02: the per-class MCC / impact-metric figure
      // set written by scratch/DCA/gen_per_class_8attacks.py. Served from
      // data/figures/ normally; the standalone bundler replaces the whole map
      // with data: URIs under window.ROADWATCH_DATA.figures. Absent = the
      // section hides itself, same as every other optional payload here.
      if (window.ROADWATCH_DATA?.figures) {
        this.figures = window.ROADWATCH_DATA.figures;
      } else {
        try {
          const figRes = await fetch('data/figures/index.json');
          if (figRes.ok) this.figures = await figRes.json();
        } catch (e) {
          console.warn("[Roadwatch] data/figures/index.json not available:", e);
        }
      }
      if (this.allSweeps) {
        // ATTACK_PICKER_DROP_EVERYTHING_2026-09-02: attack 17 ("Everything")
        // is removed from the picker below, so don't default onto it even
        // though it's still sweep.json's headline_attack -- fall through to
        // the next best populated attack instead.
        let headline = String(this.allSweeps.headline_attack ?? '');
        if (headline === '17') headline = '';
        this.activeAttack = headline || String(this.firstPopulatedAttack() ?? '11');
        this.selectAttack(this.activeAttack);
      }
      this.render();
    } catch (e) {
      console.error("[Roadwatch] Failed to load sweep data for dashboard:", e);
    }
  }

  /** How many percentages of this attack actually have data. */
  filledCount(a) {
    return (a?.mcc_k9 || []).filter(v => v !== null && v !== undefined).length;
  }

  /**
   * attack_number 7-11 are data-plane (EA/TA/DIM/SI/All-data-plane, per
   * renderAttackPicker's meta and ATTACK_CLASS_META's plane tags); 12-16 are
   * control-plane (CC_*); 17 is everything. The impact-evolution panel
   * (IFR_EA/LIE_TA/MFR_DIM/FIIR_SI) has no control-plane analogue, so it is
   * gated on this exactly, not on ATTACK_CLASS_META (which is keyed by class
   * name, not by the numeric attack_number this.activeAttack holds).
   */
  isDataPlaneAttack(key) {
    const n = Number(key);
    return n >= 7 && n <= 11;
  }

  firstPopulatedAttack() {
    const m = this.allSweeps?.attacks || {};
    let best = null, bestN = 0;
    for (const [k, v] of Object.entries(m)) {
      const n = this.filledCount(v);
      if (n > bestN) { bestN = n; best = k; }
    }
    return best;
  }

  /** Point the renderers at one attack's series. */
  selectAttack(key) {
    const per = this.allSweeps?.attacks?.[String(key)];
    if (!per) return;
    this.activeAttack = String(key);
    this.sweepData = { ...per, pcts: this.allSweeps.pcts };
  }

  /**
   * Attack picker + summary figures, all computed from the loaded sweep.
   * ATTACK_PICKER_DROP_EVERYTHING_2026-09-02: attack 17 ("Everything",
   * pooled across all 8 classes) is deliberately excluded from the picker
   * at the user's request -- init() steers the default selection away from
   * it too, see there.
   */
  renderAttackPicker() {
    const per = this.allSweeps?.attacks || {};
    const meta = {
      7: 'EA', 8: 'TA', 9: 'DIM', 10: 'Sybil', 11: 'All data-plane',
      12: 'CC-TA', 13: 'CC-EA', 14: 'CC-DIM', 15: 'CC-SI',
      16: 'All CC',
    };
    const opts = Object.keys(per)
      .filter(k => k !== '17')
      .sort((a, b) => Number(a) - Number(b))
      .map(k => {
        const n = this.filledCount(per[k]);
        const label = `${meta[k] || 'Attack ' + k}${n ? ` (${n}/5)` : ' — not collected'}`;
        return `<option value="${k}" ${k === this.activeAttack ? 'selected' : ''} ${n ? '' : 'disabled'}>${label}</option>`;
      }).join('');
    return `<select id="dashAttackSelect" class="dash-attack-select"
              style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;
                     border-radius:6px;padding:.35rem .6rem;font-size:13px;">${opts}</select>`;
  }

  render() {
    if (!this.container) return;
    if (!this.allSweeps) return;

    // GUI_SUMMARY_TRIM_2026-08-31: Macro MCC_K9, Measured End-to-End Latency,
    // and Collected Runs were removed from this banner at the user's request.
    // Root cause (left here in case they come back): build_sweep.py's
    // mcc_k9 aggregation (see MCC_K9_ZERO_VS_NULL note in that file) reads
    // the raw MCC_K9 column without checking MCC_K9_windows, so a
    // FORCE_LIGHTWEIGHT-pinned run (genuinely zero Full-mode windows, not a
    // real 0.0 score) gets averaged in as a literal 0.000 instead of being
    // treated as "no data" -- misleadingly precise-looking for any attack
    // whose whole sweep was collected in Lightweight mode.
    this.container.innerHTML = `
      <div class="dashboard-wrapper">
        <!-- Section 1: Summary Banner (all values computed from sweep.json) -->
        <div class="dash-summary-bar">
          <div class="dash-summary-item">
            <span class="dash-stat-label">Attack Scenario</span>
            <span class="dash-stat-val">${this.renderAttackPicker()}</span>
          </div>
        </div>

        <!-- Section 1b: Overall MCC vs Baselines (2026-09-01 retrain results) -->
        ${this.renderOverallMccComparison()}

        <!-- Section 2: Sweep Small-Multiples (8 Attack Curves with Min/Max Bands) -->
        <div class="dash-card">
          <div class="dash-card-header">
            <div>
              <h2 class="dash-card-title">Per-Attack Detection Quality (MCC vs Attack Intensity)</h2>
              <p class="dash-card-subtitle">8 small-multiples with episode min/max empirical variation bands. Zero-denominator guarded (null emitted as gap, never 0).</p>
            </div>
            <button class="dash-toggle-btn" id="toggleSweepTables">View as Data Tables</button>
          </div>
          <div class="small-multiples-grid" id="smallMultiplesContainer">
            ${this.renderSmallMultiples()}
          </div>
        </div>

        <!-- Section 2b: Attack Impact Evolution (data-plane only, hidden for CC_*) -->
        ${this.renderImpactMetrics()}

        <!-- Section 2c: Report Figure Set (per-class MCC + impact metrics) -->
        ${this.renderReportFigures()}

        <!-- Section 3: Latency Budget & Confusion Matrix Grid -->
        <div class="dash-two-col">
          <!-- Stacked Latency Budget -->
          <div class="dash-card">
            <div class="dash-card-header">
              <div>
                <h2 class="dash-card-title">End-to-End Latency Budget (ms)</h2>
                <p class="dash-card-subtitle">L_detect → L_drl → L_bc → L_dkg across attack intensities</p>
              </div>
            </div>
            <div class="latency-chart-container">
              ${this.renderLatencyBudget()}
            </div>
          </div>

          <!-- 9-Class Confusion Matrix -->
          <div class="dash-card">
            <div class="dash-card-header">
              <div>
                <h2 class="dash-card-title">Per-Class Confusion Cells &amp; MCC</h2>
                <p class="dash-card-subtitle">Real TP/FP/FN/TN per class from attack_matrix.csv. The logs carry
                per-class <em>binary</em> cells only — no cross-class 9&times;9 counts exist, so none are shown.</p>
              </div>
            </div>
            <div class="confusion-matrix-container">
              ${this.renderConfusionMatrix()}
            </div>
          </div>
        </div>

        <!-- Section 4: Scorecard Table -->
        <div class="dash-card">
          <div class="dash-card-header">
            <div>
              <h2 class="dash-card-title">Attack Defense Scorecard & Success Trade-off</h2>
              <p class="dash-card-subtitle">Comprehensive metrics traceable to source simulation results</p>
            </div>
          </div>
          <div class="scorecard-container">
            ${this.renderScorecardTable()}
          </div>
        </div>
      </div>
    `;

    this.attachEvents();
  }

  /**
   * OVERALL_MCC_COMPARISON_2026-09-01: headline MCC-vs-attack-intensity
   * chart from the 2026-09-01 retrain (sigma_iat leak fix + fresh TA
   * training data), plotted against the three single-mechanism baselines.
   * Sourced from web/data/overall_mcc_comparison.json only -- does not
   * read or alter sweep.json / impact_metrics.json, so the rest of the
   * dashboard's attack/detection/mitigation data is untouched.
   */
  renderOverallMccComparison() {
    const data = this.overallMccComparison;
    if (!data || !Array.isArray(data.series) || data.series.length === 0) return '';

    const w = 640, h = 300;
    const padL = 42, padR = 16, padT = 16, padB = 32;
    const xMin = 15, xMax = 105;
    const yMin = 0, yMax = 1.0;

    const xOf = x => padL + ((x - xMin) / (xMax - xMin)) * (w - padL - padR);
    const yOf = y => padT + (1 - (y - yMin) / (yMax - yMin)) * (h - padT - padB);

    const gridY = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const gridLines = gridY.map(v => `
      <line x1="${padL}" y1="${yOf(v).toFixed(1)}" x2="${w - padR}" y2="${yOf(v).toFixed(1)}"
            stroke="rgba(51,65,85,0.25)" stroke-dasharray="2,2" />
      <text x="${padL - 6}" y="${(yOf(v) + 3).toFixed(1)}" font-size="9" fill="#64748b" text-anchor="end">${v.toFixed(1)}</text>
    `).join('');

    const thresh = data.target_threshold;
    const threshLine = (thresh !== undefined && thresh !== null) ? `
      <line x1="${padL}" y1="${yOf(thresh).toFixed(1)}" x2="${w - padR}" y2="${yOf(thresh).toFixed(1)}"
            stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3" />
      <text x="${w - padR}" y="${(yOf(thresh) - 4).toFixed(1)}" font-size="9" fill="#94a3b8" text-anchor="end">target ${thresh.toFixed(2)}</text>
    ` : '';

    const seriesSvg = data.series.map(s => {
      const pts = s.x.map((xv, i) => `${xOf(xv).toFixed(1)},${yOf(s.y[i]).toFixed(1)}`).join(' ');
      const dots = s.x.map((xv, i) =>
        `<circle cx="${xOf(xv).toFixed(1)}" cy="${yOf(s.y[i]).toFixed(1)}" r="3.2" fill="${s.color}"/>`
      ).join('');
      const isProposed = s.key === 'proposed';
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${isProposed ? 2.8 : 1.8}" stroke-linecap="round"/>${dots}`;
    }).join('');

    const legend = data.series.map(s => `
      <span class="lat-dot" style="background:${s.color}"></span><span>${s.label}</span>
    `).map(item => `<span style="margin-right:14px; display:inline-flex; align-items:center; gap:5px;">${item}</span>`).join('');

    const expanded = this.mccPanelExpanded;
    const body = expanded ? `
        <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto;">
          ${gridLines}
          ${threshLine}
          <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="rgba(51,65,85,0.6)" stroke-width="1" />
          <text x="${padL}" y="${h - 8}" font-size="9" fill="#64748b">20%</text>
          <text x="${(xOf(60)).toFixed(1)}" y="${h - 8}" font-size="9" fill="#64748b" text-anchor="middle">60%</text>
          <text x="${w - padR}" y="${h - 8}" font-size="9" fill="#64748b" text-anchor="end">100%</text>
          ${seriesSvg}
        </svg>
        <div class="lat-legend" style="margin-top:8px;">${legend}</div>
    ` : '';

    return `
      <div class="dash-card">
        <div class="dash-card-header">
          <div>
            <h2 class="dash-card-title">${data.title || 'Overall MCC vs Attack Intensity'}</h2>
            <p class="dash-card-subtitle">${data.note || ''}</p>
          </div>
          <button class="dash-toggle-btn" id="toggleMccComparison">${expanded ? 'Show Less' : 'Show More'}</button>
        </div>
        ${body}
      </div>
    `;
  }

  renderSmallMultiples() {
    const attacks = ATTACK_CLASS_KEYS.map(key => ({
      key,
      name: ATTACK_CLASS_META[key].name,
      plane: ATTACK_CLASS_META[key].plane === 'data' ? 'Data' : 'Control',
    }));

    const pcts = this.sweepData.pcts || [];
    const w = 260, h = 130;
    const padL = 32, padR = 12, padT = 16, padB = 26;

    let html = '';

    attacks.forEach(atk => {
      const means = this.sweepData.mcc?.[atk.key] || [];
      const mins = this.sweepData.mcc_bands?.[atk.key]?.min || [];
      const maxs = this.sweepData.mcc_bands?.[atk.key]?.max || [];

      // Generate Band Area polygon
      let bandPointsTop = [];
      let bandPointsBottom = [];
      let lineSegments = [];
      let currentSeg = [];

      pcts.forEach((pct, idx) => {
        const x = padL + (pct / 100.0) * (w - padL - padR);
        const meanVal = means[idx];
        const minVal = mins[idx] !== null ? mins[idx] : meanVal;
        const maxVal = maxs[idx] !== null ? maxs[idx] : meanVal;

        if (meanVal !== null) {
          const yMean = padT + (1.0 - meanVal) * (h - padT - padB);
          const yMin = padT + (1.0 - minVal) * (h - padT - padB);
          const yMax = padT + (1.0 - maxVal) * (h - padT - padB);

          bandPointsTop.push(`${x.toFixed(1)},${yMax.toFixed(1)}`);
          bandPointsBottom.unshift(`${x.toFixed(1)},${yMin.toFixed(1)}`);
          currentSeg.push(`${x.toFixed(1)},${yMean.toFixed(1)}`);
        } else {
          if (currentSeg.length > 0) {
            lineSegments.push(currentSeg.join(' '));
            currentSeg = [];
          }
        }
      });
      if (currentSeg.length > 0) lineSegments.push(currentSeg.join(' '));

      const bandPoly = (bandPointsTop.length > 0 && bandPointsBottom.length > 0)
        ? `<polygon points="${bandPointsTop.join(' ')} ${bandPointsBottom.join(' ')}" fill="rgba(56, 189, 248, 0.15)" />`
        : '';

      const linesSvg = lineSegments.map(seg => `<polyline points="${seg}" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>`).join('');

      html += `
        <div class="small-mult-card">
          <div class="sm-header">
            <span class="sm-title">${atk.name}</span>
            <span class="sm-plane-tag ${atk.plane.toLowerCase()}">${atk.plane}</span>
          </div>
          <svg class="sm-svg" viewBox="0 0 ${w} ${h}">
            <!-- Grid Lines -->
            <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="rgba(51,65,85,0.4)" stroke-width="0.8" />
            <line x1="${padL}" y1="${padT + (h - padT - padB)*0.5}" x2="${w - padR}" y2="${padT + (h - padT - padB)*0.5}" stroke="rgba(51,65,85,0.2)" stroke-dasharray="2,2" />
            <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="rgba(51,65,85,0.6)" stroke-width="1" />

            <!-- Axes Labels -->
            <text x="${padL - 4}" y="${padT + 4}" font-size="8" fill="#64748b" text-anchor="end">1.0</text>
            <text x="${padL - 4}" y="${padT + (h - padT - padB)*0.5 + 3}" font-size="8" fill="#64748b" text-anchor="end">0.5</text>
            <text x="${padL - 4}" y="${h - padB + 2}" font-size="8" fill="#64748b" text-anchor="end">0.0</text>

            <text x="${padL}" y="${h - 8}" font-size="8" fill="#64748b">0%</text>
            <text x="${padL + (w - padL - padR)*0.5}" y="${h - 8}" font-size="8" fill="#64748b" text-anchor="middle">50%</text>
            <text x="${w - padR}" y="${h - 8}" font-size="8" fill="#64748b" text-anchor="end">100%</text>

            <!-- Band & MCC Line -->
            ${bandPoly}
            ${linesSvg}
          </svg>
        </div>
      `;
    });

    return html;
  }

  /**
   * ATTACK_IMPACT_PANEL_2026-08-31: attacker-payoff evolution (the four
   * DEI-V components, report.tex Eq. dei_v_terms) -- measures what the
   * attacker actually achieved, independent of detection. Data-plane only:
   * no CC_* analogue exists for these, so the whole section is gated on
   * isDataPlaneAttack() and returns '' otherwise (hidden, not greyed out --
   * showing it disabled for e.g. CC-SI would imply these metrics apply
   * there, which they don't per report.tex's own framing).
   *
   * Small multiples in the same visual language as renderSmallMultiples()
   * (small-mult-card / sm-header / sm-title classes reused) but x-axis is
   * detection cycle, not attack intensity, and y-axis is auto-scaled per
   * metric since IFR_EA (~0-8), LIE_TA (~0-60m), MFR_DIM (~0-0.15) and
   * FIIR_SI (always 0, see its own note) are not on a common scale.
   */
  renderImpactMetrics() {
    if (!this.impactMetrics || !this.isDataPlaneAttack(this.activeAttack)) return '';

    const order = ["EA", "TA", "SI", "DIM"];
    const colorOf = { EA: "#a855f7", TA: "#38bdf8", SI: "#34d399", DIM: "#fbbf24" };
    const w = 260, h = 130;
    const padL = 34, padR = 12, padT = 14, padB = 24;

    const cards = order.map(key => {
      const m = this.impactMetrics.attacks?.[key];
      if (!m) return '';
      const cur = m.current || [];
      const avg = m.average || [];
      const cyc = m.cycles || cur.map((_, i) => i);
      const nCyc = cyc.length || 1;

      // Auto-scale: FIIR_SI is a real, confirmed-flat 0 line (not missing
      // data, see m.note) -- give it a fixed [0,1] range rather than a
      // degenerate 0/0 scale.
      const dataMax = Math.max(...cur, ...avg, 0);
      const yMax = dataMax > 0 ? dataMax * 1.12 : 1.0;

      const xOf = i => padL + (nCyc <= 1 ? 0 : (i / (nCyc - 1)) * (w - padL - padR));
      const yOf = v => padT + (1 - (v / yMax)) * (h - padT - padB);

      const curPts = cur.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      const avgPts = avg.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      const dots = cur.map((v, i) =>
        `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="2.2" fill="${colorOf[key]}"/>`
      ).join('');

      const unit = m.unit ? ` ${m.unit}` : '';
      const noteBadge = m.note
        ? `<span class="im-note-badge" title="${m.note.replace(/"/g, '&quot;')}">flat by design ⓘ</span>`
        : '';

      return `
        <div class="small-mult-card">
          <div class="sm-header">
            <span class="sm-title">${m.label}</span>
            ${noteBadge}
          </div>
          <svg class="sm-svg" viewBox="0 0 ${w} ${h}">
            <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="rgba(51,65,85,0.4)" stroke-width="0.8" />
            <line x1="${padL}" y1="${padT + (h - padT - padB) * 0.5}" x2="${w - padR}" y2="${padT + (h - padT - padB) * 0.5}" stroke="rgba(51,65,85,0.2)" stroke-dasharray="2,2" />
            <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="rgba(51,65,85,0.6)" stroke-width="1" />

            <text x="${padL - 4}" y="${padT + 4}" font-size="8" fill="#64748b" text-anchor="end">${yMax.toFixed(2)}${unit}</text>
            <text x="${padL - 4}" y="${h - padB + 2}" font-size="8" fill="#64748b" text-anchor="end">0${unit}</text>
            <text x="${padL}" y="${h - 8}" font-size="8" fill="#64748b">cyc 0</text>
            <text x="${w - padR}" y="${h - 8}" font-size="8" fill="#64748b" text-anchor="end">cyc ${nCyc - 1}</text>

            <polyline points="${avgPts}" fill="none" stroke="#64748b" stroke-width="1.4" stroke-dasharray="3,2" stroke-linecap="round"/>
            <polyline points="${curPts}" fill="none" stroke="${colorOf[key]}" stroke-width="2.2" stroke-linecap="round"/>
            ${dots}
          </svg>
        </div>
      `;
    }).join('');

    return `
      <div class="dash-card">
        <div class="dash-card-header">
          <div>
            <h2 class="dash-card-title">Attack Impact Evolution (60% Intensity, Data-Plane)</h2>
            <p class="dash-card-subtitle">Attacker-payoff metrics (DEI-V components) — what the attacker
            achieved, independent of detection. Solid = current cycle, dashed grey = cumulative average.
            Source: ${Object.values(this.impactMetrics.attacks || {}).map(m => m.source_file).join(', ')}.</p>
          </div>
        </div>
        <div class="small-multiples-grid impact-metrics-grid">
          ${cards}
        </div>
      </div>
    `;
  }

  /**
   * REPORT_FIGURES_2026-09-02: the publication figure set generated by
   * scratch/DCA/gen_per_class_8attacks.py straight from the run snapshots
   * under tools/roadwatch/raw/. These are static images, not re-plots of
   * sweep.json -- they carry provenance and caveats the live charts above
   * deliberately don't (undefined MCC cells, the IFREA multiplicity, the
   * missing CC ground truth), so they are shown as generated rather than
   * redrawn here and silently diverging from the report.
   *
   * Unlike the impact-evolution panel this is NOT gated on the active
   * attack: every figure spans all eight classes at once.
   */
  renderReportFigures() {
    const figs = Array.isArray(this.figures?.figures) ? this.figures.figures : null;
    if (!figs || figs.length === 0) return '';

    const base = this.figures.inlined ? '' : 'data/figures/';
    const tiles = figs.map(f => {
      const src = this.figures.inlined ? (f.data || '') : `${base}${f.file}`;
      if (!src) return '';
      return `
        <figure class="report-fig" data-fig-src="${src}" data-fig-title="${this.esc(f.title)}"
                tabindex="0" role="button" aria-label="Enlarge figure: ${this.esc(f.title)}">
          <div class="report-fig-imgwrap">
            <img src="${src}" alt="${this.esc(f.alt || f.title)}" loading="lazy">
            <span class="report-fig-zoom">Click to enlarge</span>
          </div>
          <figcaption>
            <span class="report-fig-tag">${this.esc(f.tag)}</span>
            <span class="report-fig-title">${this.esc(f.title)}</span>
            <span class="report-fig-note">${this.esc(f.note)}</span>
          </figcaption>
        </figure>`;
    }).join('');

    return `
      <div class="dash-card">
        <div class="dash-card-header">
          <div>
            <h2 class="dash-card-title">Per-Class Results — Report Figure Set</h2>
            <p class="dash-card-subtitle">
              One-vs-rest MCC across all eight attack classes and the four data-plane impact
              metrics, generated by <code>gen_per_class_8attacks.py</code> from the run
              snapshots in <code>tools/roadwatch/raw/</code>${this.figures.generated
                ? ` &middot; ${this.esc(this.figures.generated)}` : ''}.
            </p>
          </div>
        </div>
        <div class="report-fig-grid">${tiles}</div>
      </div>`;
  }

  /** Full-size figure overlay. Escape or a click on the backdrop closes it. */
  openFigure(src, title) {
    if (!src) return;
    let ov = document.getElementById('reportFigOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'reportFigOverlay';
      ov.className = 'report-fig-overlay';
      ov.innerHTML = `
        <div class="report-fig-overlay-bar">
          <span class="report-fig-overlay-title"></span>
          <button class="report-fig-overlay-close" aria-label="Close figure">Close &times;</button>
        </div>
        <img alt="">`;
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => {
        if (e.target === ov || e.target.classList.contains('report-fig-overlay-close')) {
          this.closeFigure();
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeFigure();
      });
    }
    ov.querySelector('.report-fig-overlay-title').textContent = title || '';
    const img = ov.querySelector('img');
    img.src = src;
    img.alt = title || '';
    ov.classList.add('open');
  }

  closeFigure() {
    const ov = document.getElementById('reportFigOverlay');
    if (ov) ov.classList.remove('open');
  }

  /** Minimal HTML-attribute escape for the caption/alt strings above. */
  esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  renderLatencyBudget() {
    const pcts = this.sweepData.pcts || [];
    const latData = this.sweepData.latency;

    if (!latData) {
      return `<div class="conf-caption">No latency data collected yet.</div>`;
    }

    // Scale to the widest real total rather than a fixed 85 ms, so a run whose
    // detector takes 145 ms is not silently clipped to a full-width bar.
    let maxScale = 0;
    pcts.forEach((_, i) => {
      const t = (latData.detect?.[i] || 0) + (latData.drl?.[i] || 0)
              + (latData.bc?.[i] || 0) + (latData.dkg?.[i] || 0);
      if (t > maxScale) maxScale = t;
    });
    if (maxScale <= 0) {
      return `<div class="conf-caption">No latency data collected yet.
        Run <code>tools/roadwatch/scripts/run_all.sh</code>, then rebuild
        <code>web/data/</code>.</div>`;
    }
    maxScale *= 1.05;

    let barsHtml = '';
    pcts.forEach((pct, idx) => {
      // A missing measurement renders as an empty row, never as a default.
      if (latData.detect?.[idx] === null || latData.detect?.[idx] === undefined) {
        barsHtml += `
          <div class="lat-row">
            <span class="lat-label">${pct}% Malicious</span>
            <div class="lat-stacked-track"></div>
            <span class="lat-total" style="color:#64748b;">no data</span>
          </div>`;
        return;
      }
      const lDet = latData.detect[idx];
      const lDrl = latData.drl?.[idx] || 0;
      const lBc = latData.bc?.[idx] || 0;
      const lDkg = latData.dkg?.[idx] || 0;
      const total = (lDet + lDrl + lBc + lDkg).toFixed(1);
      const pctDet = ((lDet / maxScale) * 100).toFixed(1);
      const pctDrl = ((lDrl / maxScale) * 100).toFixed(1);
      const pctBc = ((lBc / maxScale) * 100).toFixed(1);

      barsHtml += `
        <div class="lat-row">
          <span class="lat-label">${pct}% Malicious</span>
          <div class="lat-stacked-track">
            <div class="lat-seg seg-det" style="width:${pctDet}%" title="L_detect: ${lDet} ms">${lDet > 15 ? lDet.toFixed(0) : ''}</div>
            <div class="lat-seg seg-drl" style="width:${pctDrl}%" title="L_drl: ${lDrl} ms">${lDrl > 10 ? lDrl.toFixed(0) : ''}</div>
            <div class="lat-seg seg-bc" style="width:${pctBc}%" title="L_bc: ${lBc} ms">${lBc > 15 ? lBc.toFixed(0) : ''}</div>
          </div>
          <span class="lat-total">${total} ms</span>
        </div>
      `;
    });

    return `
      <div class="lat-legend">
        <span><span class="lat-dot" style="background:#38bdf8"></span> L_detect (Detector)</span>
        <span><span class="lat-dot" style="background:#a855f7"></span> L_drl (Agent Action)</span>
        <span><span class="lat-dot" style="background:#34d399"></span> L_bc (Fabric Notarization)</span>
      </div>
      <div class="lat-bars-list">${barsHtml}</div>
    `;
  }

  /**
   * Per-class confusion cells at the selected percentage.
   *
   * This is deliberately NOT a 9x9 confusion matrix. The simulation logs only
   * per-class BINARY cells (TP_TA, FP_TA, ... TN_CC_DIM) -- no cross-class
   * counts exist anywhere in attack_matrix.csv, so a 9x9 grid cannot be
   * derived from this data and any such grid would be invented. One row per
   * class with its real TP/FP/FN/TN and the MCC computed from them is the
   * strongest claim the logs actually support.
   */
  renderConfusionMatrix() {
    const classes = ATTACK_CLASS_KEYS;
    const pcts = this.sweepData.pcts || [];
    // Show the highest percentage that has data -- the hardest operating point.
    let idx = -1;
    for (let i = pcts.length - 1; i >= 0; i--) {
      if (classes.some(c => this.sweepData.cells?.[c]?.[i])) { idx = i; break; }
    }

    if (idx < 0) {
      return `<div class="conf-caption">No confusion data collected yet.
        Run <code>tools/roadwatch/scripts/run_all.sh</code>, then rebuild
        <code>web/data/</code>.</div>`;
    }

    const maxTp = Math.max(...classes.map(c => this.sweepData.cells?.[c]?.[idx]?.tp || 0), 1);

    // CONF_MATRIX_MID_PCT_FALLBACK_2026-09-02: the shared idx above always
    // lands on the highest-% row (typically 100%), where a single-attack-type
    // run has no surviving benign traffic left -- TN collapses to 0, which
    // zeroes one of MCC's four denominator factors and makes it genuinely
    // undefined (see the caption below), not missing data. EA and TA are the
    // two classes users hit this on in practice (attacks 7/8 @ 100%, see
    // GUI question 2026-09-02), so for those two specifically, fall back to
    // the highest lower percentage where THIS class's MCC is actually
    // defined, and annotate the cell with which % it came from. Other
    // classes are left as-is (still "—" at the shared idx if undefined) --
    // this is a per-class display fallback, not a change to the underlying
    // data or to the table's shared idx.
    const midPctFallbackClasses = ['EA', 'TA'];

    let rowsHtml = '';
    classes.forEach(c => {
      let rowIdx = idx;
      if (midPctFallbackClasses.includes(c)) {
        const mccAtIdx = this.sweepData.mcc?.[c]?.[idx];
        if (mccAtIdx === null || mccAtIdx === undefined) {
          for (let i = idx - 1; i >= 0; i--) {
            const v = this.sweepData.mcc?.[c]?.[i];
            if (v !== null && v !== undefined) { rowIdx = i; break; }
          }
        }
      }

      const cell = this.sweepData.cells?.[c]?.[rowIdx];
      const mcc = this.sweepData.mcc?.[c]?.[rowIdx];
      if (!cell) {
        rowsHtml += `<tr><td><b>${c.replace('_', '-')}</b></td>
          <td colspan="5" style="color:#64748b;font-style:italic;">not scored in this run</td></tr>`;
        return;
      }
      const op = Math.min(1.0, cell.tp / maxTp);
      const pctNote = rowIdx !== idx
        ? `<span style="color:#64748b;font-size:.85em;"> (@${pcts[rowIdx]}%)</span>` : '';
      rowsHtml += `<tr>
        <td><b>${c.replace('_', '-')}</b></td>
        <td class="num" style="background:rgba(2,132,199,${op});color:#fff;font-weight:700;">${cell.tp}</td>
        <td class="num" style="color:#fca5a5;">${cell.fp}</td>
        <td class="num" style="color:#fca5a5;">${cell.fn}</td>
        <td class="num">${cell.tn}</td>
        <td class="num" style="color:#38bdf8;font-weight:700;">${mcc === null || mcc === undefined ? '—' : mcc.toFixed(3)}${pctNote}</td>
      </tr>`;
    });

    const k9 = this.sweepData.mcc_k9?.[idx];
    return `
      <div class="matrix-scroll">
        <table class="conf-matrix-table">
          <thead><tr>
            <th>Class</th><th class="num">TP</th><th class="num">FP</th>
            <th class="num">FN</th><th class="num">TN</th><th class="num">MCC</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="conf-caption">
        Per-class binary confusion cells at ${pcts[idx]}% malicious, end-of-episode.
        MCC computed as (TP·TN − FP·FN)/√((TP+FP)(TP+FN)(TN+FP)(TN+FN)); “—” means the
        denominator was zero, so MCC is undefined.
        EA/TA fall back to the highest lower percentage with a defined MCC when
        ${pcts[idx]}% collapses to zero benign traffic (annotated “@X%” in that row).
        ${k9 !== null && k9 !== undefined ? `Macro MCC_K9 = ${k9.toFixed(3)}.` : ''}
        Source: <code>attack_matrix.csv</code> TP_*/FP_*/FN_*/TN_* columns.
      </div>
    `;
  }

  /**
   * One row per class, every figure derived from that class's real confusion
   * cells at the hardest percentage with data. FPR = FP/(FP+TN). No column is
   * shown unless it can be computed from a logged cell.
   */
  renderScorecardTable() {
    const classes = ATTACK_CLASS_KEYS;
    const pcts = this.sweepData.pcts || [];
    // SCORECARD_MCC_GAP_FIX_2026-08-31: previously searched for the last
    // pct with ANY cell data, which can land on a pct where cells exist but
    // MCC is null (e.g. TA @ 100% has real TP/FP/FN/TN=1172/0/378/0, but
    // MCC is genuinely undefined there since TN=0 -- no benign vehicles in
    // an isolated 100%-intensity run makes the MCC denominator zero). That
    // produced a table where every row read "--" in the MCC column even
    // though real MCC values existed at lower percentages. Now prefers the
    // last pct where at least one class has a DEFINED mcc value, falling
    // back to cell-only availability (old behaviour) only if no pct has any
    // MCC at all -- so cells-but-no-MCC never masks a usable pct.
    let idx = -1;
    for (let i = pcts.length - 1; i >= 0; i--) {
      if (classes.some(c => {
        const v = this.sweepData.mcc?.[c]?.[i];
        return v !== null && v !== undefined;
      })) { idx = i; break; }
    }
    if (idx < 0) {
      for (let i = pcts.length - 1; i >= 0; i--) {
        if (classes.some(c => this.sweepData.cells?.[c]?.[i])) { idx = i; break; }
      }
    }

    if (idx < 0) {
      return `<div class="conf-caption">No scorecard data collected yet.
        Run <code>tools/roadwatch/scripts/run_all.sh</code>, then rebuild
        <code>web/data/</code>.</div>`;
    }

    const fmt = (v, d = 3) => (v === null || v === undefined ? '—' : v.toFixed(d));
    let tbody = '';
    classes.forEach(c => {
      const meta = ATTACK_CLASS_META[c];
      const cell = this.sweepData.cells?.[c]?.[idx];
      const mcc = this.sweepData.mcc?.[c]?.[idx];
      const band = this.sweepData.mcc_bands?.[c];
      const lo = band?.min?.[idx], hi = band?.max?.[idx];

      let fpr = null, recall = null;
      if (cell) {
        if (cell.fp + cell.tn > 0) fpr = cell.fp / (cell.fp + cell.tn);
        if (cell.tp + cell.fn > 0) recall = cell.tp / (cell.tp + cell.fn);
      }
      const bandTxt = (lo !== null && lo !== undefined && hi !== null && hi !== undefined && hi > lo)
        ? `<span style="color:#64748b;font-size:.85em;"> ±${((hi - lo) / 2).toFixed(2)}</span>` : '';

      tbody += `
        <tr>
          <td><b>${meta.name}</b></td>
          <td><span class="sm-plane-tag ${meta.plane}">${meta.plane}</span></td>
          <td class="num" style="color:#38bdf8;font-weight:700;">${fmt(mcc)}${bandTxt}</td>
          <td class="num">${recall === null ? '—' : (recall * 100).toFixed(1) + '%'}</td>
          <td class="num">${fpr === null ? '—' : (fpr * 100).toFixed(2) + '%'}</td>
          <td class="num" style="color:#64748b;">${cell ? `${cell.tp}/${cell.fp}/${cell.fn}/${cell.tn}` : '—'}</td>
        </tr>
      `;
    });

    return `
      <table class="scorecard-table">
        <thead>
          <tr>
            <th>Attack Threat Model</th>
            <th>Plane</th>
            <th class="num">MCC @ ${pcts[idx]}%</th>
            <th class="num">Recall</th>
            <th class="num">False Positive Rate</th>
            <th class="num">TP/FP/FN/TN</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
      <div class="conf-caption">
        All figures computed from <code>attack_matrix.csv</code> confusion cells at
        ${pcts[idx]}% malicious. Recall = TP/(TP+FN); FPR = FP/(FP+TN).
        “±” is half the episode min–max spread where repeat episodes exist.
        “—” means the value is undefined for this run, not zero.
      </div>
    `;
  }

  attachEvents() {
    // REPORT_FIGURES_2026-09-02: click / Enter on a figure opens it full-size
    // in an overlay. One overlay node is reused and lives on <body>, not
    // inside the dashboard container, so a re-render doesn't strand it open.
    this.container.querySelectorAll('.report-fig').forEach(fig => {
      const open = () => this.openFigure(fig.dataset.figSrc, fig.dataset.figTitle);
      fig.addEventListener('click', open);
      fig.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });

    const toggleBtn = document.getElementById('toggleSweepTables');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        alert("Full sweep numerical metrics are exported and available in web/data/sweep.json.");
      });
    }
    const toggleMccBtn = document.getElementById('toggleMccComparison');
    if (toggleMccBtn) {
      toggleMccBtn.addEventListener('click', () => {
        this.mccPanelExpanded = !this.mccPanelExpanded;
        this.render();
      });
    }
    const sel = document.getElementById('dashAttackSelect');
    if (sel) {
      sel.addEventListener('change', (e) => {
        this.selectAttack(e.target.value);
        this.render();          // re-renders every panel against the new attack
      });
    }
  }
}
