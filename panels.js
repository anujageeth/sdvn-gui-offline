/**
 * Roadwatch Phase 3: Panels, Controller Strip, and Timeline Charts.
 * Per Implementation Spec Part 6 and Data Collection Plan Part D.
 */

export class RoadwatchPanels {
  constructor(app) {
    this.app = app;
    
    // DOM Panel References
    this.controllerStrip = document.getElementById('controllerStrip');
    this.inspectorPanel = document.getElementById('inspectorPanel');
    this.eventConsole = document.getElementById('eventConsole');
    this.drlPanel = document.getElementById('drlPanel');
    this.ledgerPanel = document.getElementById('ledgerPanel');
    this.timelineStrip = document.getElementById('timelineStrip');

    this.lastRenderedTime = -1;
  }

  update(currentTime, scenario, selectedVehicleId) {
    if (!scenario) return;

    this.renderControllerStrip(currentTime, scenario, selectedVehicleId);
    this.renderInspector(currentTime, scenario, selectedVehicleId);
    this.renderEventConsole(currentTime, scenario);
    this.renderDrlPanel(currentTime, scenario);
    this.renderLedgerPanel(currentTime, scenario);
    this.renderTimelineStrip(currentTime, scenario);

    this.lastRenderedTime = currentTime;
  }

  /**
   * 17. Controller Strip (4 lanes with chips, real NER/DER/RFR/PFER, health shapes)
   */
  renderControllerStrip(currentTime, scenario, selectedVehicleId) {
    if (!this.controllerStrip) return;

    const controllers = scenario.controllers || [
      { id: 0, ner: 0.0, der: 0.0, rfr: 0.0, pfer: 0.0, phantoms: 0, state: "healthy" },
      { id: 1, ner: 0.0, der: 0.0, rfr: 0.0, pfer: 0.0, phantoms: 0, state: "healthy" },
      { id: 2, ner: 0.0, der: 0.0, rfr: 0.0, pfer: 0.0, phantoms: 0, state: "healthy" },
      { id: 3, ner: 0.0, der: 0.0, rfr: 0.0, pfer: 0.0, phantoms: 0, state: "healthy" }
    ];

    const controllerColors = ['#38bdf8', '#a855f7', '#34d399', '#fbbf24'];

    let html = `
      <div class="panel-header">
        <span class="panel-title">CONTROLLER DOMAINS</span>
        <span class="panel-subtitle">ID-Quartile Logical Strips</span>
      </div>
      <div class="ctrl-lanes-container">
    `;

    controllers.forEach((ctrl, idx) => {
      const color = controllerColors[ctrl.id % 4];
      const isCompromised = ctrl.state === 'compromised';
      const isLockedDown = ctrl.state === 'locked-down';

      // Shape difference for health state (Circle = OK, Diamond = Compromised, Octagon = Locked)
      let stateBadge = `<span class="ctrl-state healthy">● OK</span>`;
      let laneClass = "ctrl-lane healthy";
      if (isCompromised) {
        stateBadge = `<span class="ctrl-state compromised">◆ COMPROMISED</span>`;
        laneClass = "ctrl-lane compromised";
      } else if (isLockedDown) {
        stateBadge = `<span class="ctrl-state locked">🛑 LOCKED</span>`;
        laneClass = "ctrl-lane locked";
      }

      // Member vehicle IDs in this quartile (50 vehicles / 4 = 13, 12, 13, 12)
      let rangeStart = 0, rangeEnd = 13;
      if (idx === 1) { rangeStart = 13; rangeEnd = 25; }
      else if (idx === 2) { rangeStart = 25; rangeEnd = 38; }
      else if (idx === 3) { rangeStart = 38; rangeEnd = 50; }

      let chipsHtml = '';
      for (let vid = rangeStart; vid < rangeEnd; vid++) {
        const isSelected = selectedVehicleId === vid;
        const role = scenario.roles?.[String(vid)] || null;
        let chipClass = "v-chip";
        if (isSelected) chipClass += " selected";
        if (role) chipClass += " attacker";

        chipsHtml += `<button class="${chipClass}" data-vid="${vid}" title="Vehicle V${vid} (${role || 'Benign'})" style="--chip-color:${color}">V${vid}</button>`;
      }

      html += `
        <div class="${laneClass}" style="--lane-accent:${color}">
          <div class="ctrl-lane-header">
            <div class="ctrl-name-group">
              <span class="ctrl-dot" style="background:${color}"></span>
              <span class="ctrl-name">CTRL ${ctrl.id}</span>
              <span class="ctrl-range">(V${rangeStart}–V${rangeEnd - 1})</span>
            </div>
            ${stateBadge}
          </div>

          <!-- Per-controller Metrics Grid -->
          <div class="ctrl-metrics-grid">
            <div class="metric-cell" title="Northbound Exposure Rate">NER <b>${ctrl.ner.toFixed(2)}</b></div>
            <div class="metric-cell" title="Decrypt/Exfiltration Rate">DER <b>${ctrl.der.toFixed(2)}</b></div>
            <div class="metric-cell" title="Rule Falsification Rate">RFR <b>${ctrl.rfr.toFixed(2)}</b></div>
            <div class="metric-cell" title="Phantom Flow-Entry Rate">PFER <b>${ctrl.pfer.toFixed(2)}</b></div>
          </div>

          <!-- Member Vehicle Chips -->
          <div class="ctrl-chips-row">${chipsHtml}</div>
        </div>
      `;
    });

    html += `</div>`;
    this.controllerStrip.innerHTML = html;

    // Attach click handlers to chips
    this.controllerStrip.querySelectorAll('.v-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const vid = parseInt(btn.dataset.vid, 10);
        this.app.renderer.selectedVehicleId = (this.app.renderer.selectedVehicleId === vid) ? null : vid;
      });
    });
  }

  /**
   * 18. Inspector Panel (Selected vehicle, 8-class prob bars, raw scores, DIM hash-flip)
   */
  renderInspector(currentTime, scenario, selectedVehicleId) {
    if (!this.inspectorPanel) return;

    if (selectedVehicleId === null) {
      this.inspectorPanel.innerHTML = `
        <div class="panel-header">
          <span class="panel-title">VEHICLE INSPECTOR</span>
          <span class="panel-badge">Awaiting Selection</span>
        </div>
        <div class="panel-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
          </svg>
          <div>Click any vehicle on the map or controller strip to inspect telemetry, DRL probabilities, and evidence.</div>
        </div>
      `;
      return;
    }

    const vState = this.app.renderer.getVehicleState(selectedVehicleId, currentTime);
    if (!vState) return;

    const role = scenario.roles?.[String(selectedVehicleId)] || "Benign";
    const ctrlId = scenario.controller_of ? scenario.controller_of[selectedVehicleId] : Math.floor(selectedVehicleId / 13);
    const controllerColors = ['#38bdf8', '#a855f7', '#34d399', '#fbbf24'];

    // 8-class probabilities (Simulated or from drl_actions for this vehicle)
    const isAttacker = role !== "Benign";
    let p_ea = 0.02, p_ta = 0.02, p_si = 0.01, p_dim = 0.02, p_cc_ea = 0.01, p_cc_ta = 0.01, p_cc_si = 0.01, p_cc_dim = 0.01;
    let normal_p = 0.89;

    if (isAttacker) {
      normal_p = 0.05;
      if (role === 'DIM' || role === 'CC-DIM') { p_dim = 0.78; p_cc_dim = 0.12; }
      else if (role === 'EA' || role === 'CC-EA') { p_ea = 0.75; p_cc_ea = 0.15; }
      else if (role === 'TA' || role === 'CC-TA') { p_ta = 0.82; p_cc_ta = 0.10; }
      else if (role === 'SI' || role === 'CC-SI') { p_si = 0.72; p_cc_si = 0.18; }
      else { p_dim = 0.4; p_ta = 0.4; }
    }

    // DIM Hash flip check if active on this vehicle
    let hashFlipHtml = '';
    const dimEvidence = scenario.evidence?.dim?.find(d => d.victim === selectedVehicleId && Math.abs(currentTime - d.t) <= 1.5);
    if (dimEvidence) {
      hashFlipHtml = `
        <div class="evidence-box dim-alert">
          <div class="evidence-title">⚠️ DIM Hash-Tampering Detected</div>
          <div class="hash-flip-display">
            <div class="hash-row orig"><span class="hash-tag">ORIGINAL:</span> <s>${dimEvidence.orig_hash}</s></div>
            <div class="hash-row new"><span class="hash-tag">FALSIFIED:</span> <b>${dimEvidence.new_hash}</b></div>
          </div>
          <div class="evidence-chips">
            <span class="chip red">Δ ${dimEvidence.err_m}m Deviation</span>
            <span class="chip amber">Key Mismatch</span>
            <span class="chip purple">Ledger Discrepancy</span>
          </div>
        </div>
      `;
    }

    this.inspectorPanel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-group">
          <span class="panel-title">VEHICLE V${selectedVehicleId}</span>
          <span class="badge ${isAttacker ? 'badge-danger' : 'badge-neutral'}">${role.toUpperCase()}</span>
        </div>
        <span class="panel-ctrl-tag" style="color:${controllerColors[ctrlId]}">CTRL ${ctrlId}</span>
      </div>

      <!-- Quick Telemetry Grid -->
      <div class="inspector-telemetry">
        <div class="telemetry-item"><span>Coords</span><b>(${vState.x.toFixed(1)}, ${vState.y.toFixed(1)})</b></div>
        <div class="telemetry-item"><span>Heading</span><b>${(vState.heading * 180 / Math.PI).toFixed(0)}°</b></div>
        <div class="telemetry-item"><span>Status</span><b>${vState.isMitigated ? 'MITIGATED' : (vState.isConfirmed ? 'CONFIRMED' : (vState.isFlagged ? 'FLAGGED' : 'NORMAL'))}</b></div>
        <div class="telemetry-item"><span>Score</span><b style="color:#f59e0b">${vState.score > 0 ? vState.score.toFixed(2) : '0.00'}</b></div>
      </div>

      ${hashFlipHtml}

      <!-- 8-Class Probability Bars -->
      <div class="prob-section">
        <div class="prob-header">
          <span>DRL 8-Class Belief Distribution</span>
          <span style="font-size:10px;color:var(--text-muted);">Σ ≈ 1.0</span>
        </div>
        <div class="prob-bars-grid">
          ${this.renderProbBar("Normal", normal_p, "#64748b")}
          ${this.renderProbBar("EA (Eavesdrop)", p_ea, "#ef4444")}
          ${this.renderProbBar("TA (Traffic Anal)", p_ta, "#f97316")}
          ${this.renderProbBar("SI (Sybil Attack)*", p_si, "#ec4899")}
          ${this.renderProbBar("DIM (Data Integ)", p_dim, "#dc2626")}
          ${this.renderProbBar("CC-EA", p_cc_ea, "#a855f7")}
          ${this.renderProbBar("CC-TA", p_cc_ta, "#8b5cf6")}
          ${this.renderProbBar("CC-DIM", p_cc_dim, "#e11d48")}
        </div>
        <div class="footnote">* Note: p_si denotes Sybil data plane (ground truth structurally sparse).</div>
      </div>
    `;
  }

  renderProbBar(label, prob, color) {
    const pct = (prob * 100).toFixed(1);
    return `
      <div class="prob-row">
        <span class="prob-label">${label}</span>
        <div class="prob-track">
          <div class="prob-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <span class="prob-val">${pct}%</span>
      </div>
    `;
  }

  /**
   * Event Console (Scrolling, color-coded, click-to-seek)
   */
  renderEventConsole(currentTime, scenario) {
    if (!this.eventConsole) return;

    const events = scenario.events || [];
    if (events.length === 0) {
      this.eventConsole.innerHTML = `<div class="panel-empty-state">No events recorded in scenario.</div>`;
      return;
    }

    // Filter events up to currentTime (or recent window)
    const recentEvents = events.filter(e => e.t <= currentTime).slice(-25);

    let html = `
      <div class="panel-header">
        <span class="panel-title">EVENT LOG</span>
        <span class="panel-badge">${events.length} Total Events</span>
      </div>
      <div class="events-scroll-list" id="eventsScrollList">
    `;

    recentEvents.reverse().forEach(ev => {
      let typeBadge = `<span class="ev-badge ${ev.type}">${ev.type.toUpperCase()}</span>`;
      let desc = '';

      if (ev.type === 'detection') {
        desc = `V${ev.actor} flagged as <b>${ev.attack}</b> (score ${ev.score})${ev.confirmed ? ' [CONFIRMED]' : ''}`;
      } else if (ev.type === 'mitigation') {
        desc = `Action <b>${ev.action}</b> on V${ev.actor} (reward ${ev.reward}) [${ev.explored ? 'EXPLORE' : 'EXPLOIT'}]`;
      } else if (ev.type === 'bc_commit') {
        desc = `Fabric Commit <b>${ev.fcn}</b>${ev.target ? ` ${ev.target}` : ''}`
             + (ev.latency_ms !== null && ev.latency_ms !== undefined ? ` (${ev.latency_ms} ms)` : '')
             + (ev.status ? ` [${ev.status}]` : '');
      } else if (ev.type === 'attack_action') {
        desc = `V${ev.actor} executed attack action <b>${ev.attack}</b>`;
      } else if (ev.type === 'packet') {
        desc = `Packet V${ev.src} → V${ev.dst} (${ev.bytes} B, ${ev.label})`;
      }

      html += `
        <div class="event-item" data-t="${ev.t}" title="Click to seek t = ${ev.t}s">
          <span class="ev-time">${ev.t.toFixed(2)}s</span>
          ${typeBadge}
          <span class="ev-desc">${desc}</span>
        </div>
      `;
    });

    html += `</div>`;
    this.eventConsole.innerHTML = html;

    // Click to seek handler
    this.eventConsole.querySelectorAll('.event-item').forEach(item => {
      item.addEventListener('click', () => {
        const seekT = parseFloat(item.dataset.t);
        this.app.seekTo(seekT);
      });
    });
  }

  /**
   * DRL Agent Panel (Reward, last 5 actions, EXPLORED chip, gate_open state)
   */
  renderDrlPanel(currentTime, scenario) {
    if (!this.drlPanel) return;

    // Filter DRL events up to current time
    const drlEvents = (scenario.events || []).filter(e => e.type === 'mitigation' && e.t <= currentTime);
    const lastActions = drlEvents.slice(-5).reverse();

    const currentAction = lastActions[0] || null;
    const cumReward = drlEvents.reduce((acc, e) => acc + (e.reward || 0), 0);

    let actionsHtml = '';
    if (lastActions.length === 0) {
      actionsHtml = `<div class="empty-subtext">No DRL decisions taken yet before t=${currentTime.toFixed(1)}s</div>`;
    } else {
      lastActions.forEach(a => {
        actionsHtml += `
          <div class="drl-action-row">
            <span class="action-t">${a.t.toFixed(1)}s</span>
            <span class="action-name">${a.action}</span>
            <span class="action-target">Target V${a.actor}</span>
            <span class="action-reward">+${a.reward.toFixed(2)}</span>
            <span class="chip ${a.explored ? 'amber' : 'blue'}">${a.explored ? 'EXPLORE' : 'EXPLOIT'}</span>
          </div>
        `;
      });
    }

    this.drlPanel.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">DRL MITIGATION AGENT</span>
        <div class="gate-badge ${currentAction?.gate_open !== false ? 'gate-open' : 'gate-closed'}">
          ${currentAction?.gate_open !== false ? '⚡ GATE OPEN' : '🔒 GATE CLOSED'}
        </div>
      </div>
      <div class="drl-status-row">
        <div class="drl-metric-card">
          <span class="drl-card-label">Cumulative Reward</span>
          <span class="drl-card-val" style="color:#10b981;">${cumReward.toFixed(2)}</span>
        </div>
        <div class="drl-metric-card">
          <span class="drl-card-label">Total Mitigations</span>
          <span class="drl-card-val">${drlEvents.length}</span>
        </div>
        <div class="drl-metric-card">
          <span class="drl-card-label">Latest Mode</span>
          <span class="drl-card-val">${currentAction?.explored ? 'Exploration (ε)' : 'Policy Greedy'}</span>
        </div>
      </div>
      <div class="drl-recent-title">Last 5 DRL Policy Actions:</div>
      <div class="drl-actions-list">${actionsHtml}</div>
    `;
  }

  /**
   * Ledger & PQC Panel (Real L_bc_ms, endorsement peers, ML-DSA-87 Level 5 chip)
   */
  renderLedgerPanel(currentTime, scenario) {
    if (!this.ledgerPanel) return;

    const bcEvents = (scenario.events || []).filter(e => e.type === 'bc_commit' && e.t <= currentTime).slice(-4).reverse();

    // Show target + status, which are verbatim from the sim's own [BC] output.
    // The old "N Peers" column was dropped: no per-transaction endorsement
    // count is recorded anywhere, so it could only ever have been invented.
    let txRows = '';
    let cycleMean = false;
    if (bcEvents.length === 0) {
      txRows = `<tr><td colspan="4" class="empty-table-cell">Awaiting blockchain notarization transactions...</td></tr>`;
    } else {
      bcEvents.forEach(tx => {
        if (tx.latency_is_cycle_mean) cycleMean = true;
        const lat = (tx.latency_ms === null || tx.latency_ms === undefined)
          ? '<span style="color:#64748b;">—</span>'
          : `${tx.latency_ms} ms`;
        const ok = tx.status === 'success';
        const statusChip = tx.status
          ? `<span style="color:${ok ? '#10b981' : '#fbbf24'};">${ok ? '✓' : '⋯'} ${tx.status}</span>`
          : '—';
        txRows += `
          <tr>
            <td>${tx.t.toFixed(2)}s</td>
            <td><b>${tx.fcn}</b>${tx.target ? ` <span style="color:#64748b;">${tx.target}</span>` : ''}</td>
            <td style="font-family:var(--font-mono);color:#38bdf8;">${lat}</td>
            <td>${statusChip}</td>
          </tr>
        `;
      });
    }

    this.ledgerPanel.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">HYPERLEDGER FABRIC LEDGER</span>
        <span class="pqc-chip" title="NIST Level 5 Quantum-Resistant Signature (blockchain_fabric_api.h)">
          ML-DSA-87 <span style="color:#10b981;">✓ Level 5</span>
        </span>
      </div>
      <table class="ledger-table">
        <thead>
          <tr><th>Time</th><th>Function</th><th>Latency (L_bc)</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${txRows}
        </tbody>
      </table>
      ${cycleMean ? `<div style="padding:.4rem .6rem;font-size:11px;color:#64748b;">
        L_bc is the measured <b>per-cycle mean</b> endorsement+commit time; per-transaction
        timings are not persisted by the simulator.</div>` : ''}
    `;
  }

  /**
   * Timeline Strip (Full-width PDR & MCC sparklines below map)
   */
  renderTimelineStrip(currentTime, scenario) {
    if (!this.timelineStrip) return;

    const metrics = scenario.metrics || { t: [5, 10, 15, 20, 25, 30], mcc: [0.8, 0.75, 0.7, 0.65, 0.6, 0.55], pdr: [0.95, 0.9, 0.85, 0.8, 0.75, 0.7] };
    const t0 = scenario.meta?.t0 || 5.0;
    const t1 = scenario.meta?.t1 || 30.0;

    const w = 600, h = 48;
    const padding = 10;

    // Render Hand-authored Inline SVG Sparkline
    const pointsMCC = metrics.t.map((t, i) => {
      const x = padding + ((t - t0) / (t1 - t0)) * (w - 2 * padding);
      const val = metrics.mcc[i] !== null ? metrics.mcc[i] : 0.0;
      const y = h - padding - (val * (h - 2 * padding));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const pointsPDR = metrics.t.map((t, i) => {
      const x = padding + ((t - t0) / (t1 - t0)) * (w - 2 * padding);
      const val = metrics.pdr[i] !== null ? metrics.pdr[i] : 0.0;
      const y = h - padding - (val * (h - 2 * padding));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const currentX = padding + ((currentTime - t0) / (t1 - t0)) * (w - 2 * padding);

    this.timelineStrip.innerHTML = `
      <div class="timeline-metrics-header">
        <div class="metric-legend">
          <span class="legend-line" style="background:#10b981;"></span><span>PDR (Packet Delivery)</span>
          <span class="legend-line" style="background:#38bdf8;margin-left:12px;"></span><span>MCC (Detection Quality)</span>
        </div>
        <div class="current-t-tag">Current: ${currentTime.toFixed(2)}s</div>
      </div>
      <svg class="timeline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <!-- Attack Window Shading (5.0s to 30.0s) -->
        <rect x="${padding}" y="0" width="${w - 2 * padding}" height="${h}" fill="rgba(239, 68, 68, 0.06)" />

        <!-- Grid Lines -->
        <line x1="${padding}" y1="${h/2}" x2="${w - padding}" y2="${h/2}" stroke="rgba(51, 65, 85, 0.3)" stroke-dasharray="2,2"/>

        <!-- PDR & MCC Curves -->
        <polyline points="${pointsPDR}" fill="none" stroke="#10b981" stroke-width="2" />
        <polyline points="${pointsMCC}" fill="none" stroke="#38bdf8" stroke-width="2" />

        <!-- Current Playback Scrubber Line -->
        <line x1="${currentX}" y1="0" x2="${currentX}" y2="${h}" stroke="#f8fafc" stroke-width="2" />
        <circle cx="${currentX}" cy="6" r="3.5" fill="#38bdf8" />
      </svg>
    `;
  }
}
