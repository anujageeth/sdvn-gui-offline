/**
 * Roadwatch Main Application Controller (Phase 4)
 * Playback Clock, Interactions, Panels, Sweep Slider, Drop-Zone, and Results Dashboard.
 */

import { RoadwatchRenderer } from './render.js';
import { RoadwatchPanels } from './panels.js';
import { RoadwatchDashboard } from './dashboard.js';

class RoadwatchApp {
  constructor() {
    this.canvas = document.getElementById('mapCanvas');
    this.renderer = new RoadwatchRenderer(this.canvas);
    this.panels = new RoadwatchPanels(this);
    this.dashboard = new RoadwatchDashboard('dashboardContainer');

    // Playback State
    this.t0 = 5.0;
    this.t1 = 30.0;
    this.currentTime = 5.0;
    this.playing = true;
    this.rate = 1.0;
    this.lastFrameTime = performance.now();
    this.lastPanelUpdateTime = 0;

    // DOM Elements
    this.scenarioSelect = document.getElementById('scenarioSelect');
    this.sweepSlider = document.getElementById('sweepSlider');
    this.sweepPctBadge = document.getElementById('sweepPctBadge');
    this.playBtn = document.getElementById('playBtn');
    this.playIcon = document.getElementById('playIcon');
    this.timeDisplay = document.getElementById('timeDisplay');
    this.timelineSlider = document.getElementById('timelineSlider');
    this.tooltip = document.getElementById('vehicleTooltip');
    this.zoomInBtn = document.getElementById('zoomInBtn');
    this.zoomOutBtn = document.getElementById('zoomOutBtn');
    this.zoomResetBtn = document.getElementById('zoomResetBtn');
    this.mapLegend = document.getElementById('mapLegend');
    this.legendToggleBtn = document.getElementById('legendToggleBtn');
    this.rateButtons = document.querySelectorAll('.rate-btn');

    // Tab Navigation & Views (Task 20)
    this.tabReplayBtn = document.getElementById('tabReplayBtn');
    this.tabResultsBtn = document.getElementById('tabResultsBtn');
    this.replayView = document.getElementById('replayView');
    this.resultsView = document.getElementById('resultsView');
    this.headerReplayControls = document.getElementById('headerReplayControls');

    // Dropzone Overlay (Task 21)
    this.dropZoneOverlay = document.getElementById('dropZoneOverlay');

    // Drag State
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    this.initEventListeners();
    this.restoreLegendState();
    this.loadInitialData();
    this.startLoop();
  }

  async loadInitialData() {
    try {
      if (window.ROADWATCH_DATA && window.ROADWATCH_DATA.index) {
        this.indexData = window.ROADWATCH_DATA.index;
        this.populateScenarioSelect(this.indexData);
        const defaultScenId = this.pickDefaultScenario(this.indexData);
        if (!defaultScenId) throw new Error('index.json lists no scenarios');
        this.loadScenarioData(window.ROADWATCH_DATA.scenarios[defaultScenId]);
        return;
      }

      const indexRes = await fetch('data/index.json');
      if (!indexRes.ok) throw new Error(`HTTP ${indexRes.status} fetching index.json`);
      this.indexData = await indexRes.json();
      this.populateScenarioSelect(this.indexData);

      const defaultId = this.pickDefaultScenario(this.indexData);
      if (!defaultId) throw new Error('index.json lists no scenarios');
      await this.loadScenario(defaultId);
    } catch (err) {
      console.error("[Roadwatch] Failed to initialize data:", err);
      this.showFatal(err);
    }
  }

  /**
   * Pick the scenario to open with, from whatever was actually collected.
   *
   * Never hardcode an id here. The percentage grid is 0/25/50/75/100 and the
   * collection order is data-plane -> control-plane -> combined, so a17_* may
   * legitimately not exist yet. A hardcoded default silently 404s and the app
   * comes up blank.
   */
  pickDefaultScenario(index) {
    const scens = index?.scenarios || [];
    if (!scens.length) return null;
    // Prefer the mixed scenario at a mid intensity if it was collected,
    // otherwise just take the first available.
    const preferred = ['a17_p50', 'a17_p25', 'a11_p50', 'a9_p50'];
    for (const id of preferred) {
      if (scens.some(s => s.id === id)) return id;
    }
    return scens[0].id;
  }

  /** Make a load failure visible in the page, not just the console. */
  showFatal(err) {
    const host = document.getElementById('viewportContainer') || document.body;
    const box = document.createElement('div');
    box.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'padding:2rem;text-align:center;font:14px/1.6 system-ui,sans-serif;color:#94a3b8;z-index:50;';
    box.innerHTML =
      `<div><div style="font-size:15px;color:#e2e8f0;margin-bottom:.5rem;">No scenario data loaded</div>` +
      `<div>${String(err.message || err)}</div>` +
      `<div style="margin-top:1rem;font-family:ui-monospace,monospace;font-size:12px;">` +
      `collect runs: <b>tools/roadwatch/scripts/run_all.sh data</b><br>` +
      `then build:  <b>tools/roadwatch/.venv/bin/python tools/roadwatch/build_scenarios.py</b></div></div>`;
    host.appendChild(box);
  }

  populateScenarioSelect(index) {
    if (!this.scenarioSelect || !index.scenarios) return;
    this.scenarioSelect.innerHTML = '';

    const groups = {
      data: document.createElement('optgroup'),
      control: document.createElement('optgroup'),
      both: document.createElement('optgroup')
    };
    groups.data.label = 'Data-Plane Attacks (Vehicles Compromised)';
    groups.control.label = 'Control-Channel Attacks (Controller Adversary)';
    groups.both.label = 'Mixed Attacks (Intensity Sweep)';

    index.scenarios.forEach(scen => {
      const opt = document.createElement('option');
      opt.value = scen.id;
      const atkInfo = index.attacks?.[String(scen.attack)] || { name: `Attack ${scen.attack}`, plane: 'both' };
      opt.textContent = `${scen.id.toUpperCase()} — ${atkInfo.name} (${scen.pct}%)`;

      const plane = atkInfo.plane || 'both';
      if (groups[plane]) groups[plane].appendChild(opt);
      else groups.both.appendChild(opt);
    });

    Object.values(groups).forEach(g => {
      if (g.children.length > 0) this.scenarioSelect.appendChild(g);
    });

    this.scenarioSelect.value = 'a17_p40';
  }

  async loadScenario(scenarioId) {
    try {
      if (window.ROADWATCH_DATA?.scenarios?.[scenarioId]) {
        this.loadScenarioData(window.ROADWATCH_DATA.scenarios[scenarioId]);
        return;
      }
      const res = await fetch(`data/${scenarioId}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for data/${scenarioId}.json`);
      const scenario = await res.json();
      this.loadScenarioData(scenario);
    } catch (err) {
      console.error(`[Roadwatch] Error loading scenario ${scenarioId}:`, err);
    }
  }

  loadScenarioData(scenario) {
    this.scenario = scenario;
    this.t0 = scenario.meta?.t0 || 5.0;
    this.t1 = scenario.meta?.t1 || 30.0;
    this.currentTime = this.t0;
    this.timelineSlider.min = this.t0;
    this.timelineSlider.max = this.t1;
    this.timelineSlider.value = this.t0;

    if (scenario.id?.startsWith('a17_p')) {
      const pct = scenario.meta?.pct || 40;
      if (this.sweepSlider) this.sweepSlider.value = pct;
      if (this.sweepPctBadge) this.sweepPctBadge.textContent = `${pct}%`;
    }

    if (this.scenarioSelect && scenario.id) {
      this.scenarioSelect.value = scenario.id;
    }

    this.renderer.setScenario(scenario);
    this.updateTimeDisplay();
    this.panels.update(this.currentTime, this.scenario, this.renderer.selectedVehicleId);
  }

  initEventListeners() {
    // Tab Navigation (Task 20)
    if (this.tabReplayBtn && this.tabResultsBtn) {
      this.tabReplayBtn.addEventListener('click', () => this.switchTab('replay'));
      this.tabResultsBtn.addEventListener('click', () => this.switchTab('results'));
    }

    // Scenario picker dropdown change
    this.scenarioSelect.addEventListener('change', (e) => {
      this.loadScenario(e.target.value);
    });

    // Sweep Slider (Task 19)
    if (this.sweepSlider) {
      this.sweepSlider.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        if (this.sweepPctBadge) this.sweepPctBadge.textContent = `${pct}%`;
        const scenId = `a17_p${pct}`;
        this.loadScenario(scenId);
      });
    }

    // Play / Pause
    this.playBtn.addEventListener('click', () => this.togglePlay());

    // Timeline Scrubber
    this.timelineSlider.addEventListener('input', (e) => {
      this.currentTime = parseFloat(e.target.value);
      this.updateTimeDisplay();
      this.panels.update(this.currentTime, this.scenario, this.renderer.selectedVehicleId);
    });

    // Speed Rate Buttons
    this.rateButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.rateButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.rate = parseFloat(btn.dataset.rate || '1.0');
      });
    });

    // Zoom Buttons
    this.zoomInBtn.addEventListener('click', () => this.adjustZoom(1.25));
    this.zoomOutBtn.addEventListener('click', () => this.adjustZoom(0.8));
    this.zoomResetBtn.addEventListener('click', () => this.resetView());

    // Legend collapse / expand
    if (this.legendToggleBtn) {
      this.legendToggleBtn.addEventListener('click', () => this.toggleLegend());
    }

    // Canvas Mouse Interaction: Pan & Drag
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        this.dragStartX = e.clientX - this.renderer.panX;
        this.dragStartY = e.clientY - this.renderer.panY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.renderer.panX = e.clientX - this.dragStartX;
        this.renderer.panY = e.clientY - this.dragStartY;
      } else {
        this.handleCanvasHover(e);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.adjustZoom(zoomFactor);
    }, { passive: false });

    // Vehicle Click Selection
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const v = this.renderer.findVehicleAtScreen(sx, sy, this.currentTime);
      if (v) {
        this.renderer.selectedVehicleId = v.id;
      } else {
        this.renderer.selectedVehicleId = null;
      }
      this.panels.update(this.currentTime, this.scenario, this.renderer.selectedVehicleId);
    });

    // Dropzone Drag & Drop JSON Loading (Task 21 / §F.3)
    const dropTarget = document.body;
    dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dropZoneOverlay) this.dropZoneOverlay.style.display = 'flex';
    });

    dropTarget.addEventListener('dragleave', (e) => {
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        if (this.dropZoneOverlay) this.dropZoneOverlay.style.display = 'none';
      }
    });

    dropTarget.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (this.dropZoneOverlay) this.dropZoneOverlay.style.display = 'none';
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith('.json')) return;

      try {
        const text = await file.text();
        const droppedScenario = JSON.parse(text);
        if (!droppedScenario.meta || !droppedScenario.positions) {
          throw new Error('Not a valid Roadwatch scenario file format');
        }
        console.log(`[Roadwatch] Loaded dropped scenario: ${file.name}`);
        this.loadScenarioData(droppedScenario);
      } catch (err) {
        alert(`Could not load ${file.name}: ${err.message}`);
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.seekRelative(-1.0);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.seekRelative(1.0);
      } else if (e.key === '[') {
        this.stepRate(-1);
      } else if (e.key === ']') {
        this.stepRate(1);
      } else if (e.key === 'r' || e.key === 'R') {
        this.resetView();
      } else if (e.key === 'l' || e.key === 'L') {
        this.toggleLegend();
      }
    });
  }

  restoreLegendState() {
    let collapsed = false;
    try { collapsed = localStorage.getItem('roadwatch.legendCollapsed') === '1'; } catch (e) { /* file:// */ }
    this.toggleLegend(!collapsed);
  }

  toggleLegend(force) {
    if (!this.mapLegend) return;
    const collapsed = (force !== undefined)
      ? !force
      : !this.mapLegend.classList.contains('collapsed');
    this.mapLegend.classList.toggle('collapsed', collapsed);
    if (this.legendToggleBtn) {
      this.legendToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    }
    try { localStorage.setItem('roadwatch.legendCollapsed', collapsed ? '1' : '0'); } catch (e) { /* file:// */ }
  }

  switchTab(tab) {
    if (tab === 'results') {
      this.tabReplayBtn.classList.remove('active');
      this.tabResultsBtn.classList.add('active');
      this.replayView.style.display = 'none';
      this.resultsView.style.display = 'flex';
      this.headerReplayControls.style.display = 'none';
      this.dashboard.render();
    } else {
      this.tabResultsBtn.classList.remove('active');
      this.tabReplayBtn.classList.add('active');
      this.resultsView.style.display = 'none';
      this.replayView.style.display = 'flex';
      this.headerReplayControls.style.display = 'flex';
      this.renderer.resize();
    }
  }

  togglePlay() {
    this.playing = !this.playing;
    this.playIcon.textContent = this.playing ? '⏸' : '▶';
  }

  seekRelative(deltaSeconds) {
    this.seekTo(this.currentTime + deltaSeconds);
  }

  seekTo(targetT) {
    this.currentTime = Math.max(this.t0, Math.min(this.t1, targetT));
    this.timelineSlider.value = this.currentTime;
    this.updateTimeDisplay();
    this.panels.update(this.currentTime, this.scenario, this.renderer.selectedVehicleId);
  }

  stepRate(dir) {
    const rates = [0.25, 0.5, 1.0, 2.0, 4.0];
    let idx = rates.indexOf(this.rate);
    if (idx === -1) idx = 2;
    idx = Math.max(0, Math.min(rates.length - 1, idx + dir));
    this.rate = rates[idx];
    this.rateButtons.forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.rate) === this.rate);
    });
  }

  adjustZoom(factor) {
    const newZoom = Math.max(this.renderer.minZoom, Math.min(this.renderer.maxZoom, this.renderer.zoom * factor));
    this.renderer.zoom = newZoom;
  }

  resetView() {
    this.renderer.zoom = 1.0;
    this.renderer.panX = 0;
    this.renderer.panY = 0;
  }

  handleCanvasHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) {
      this.tooltip.style.display = 'none';
      return;
    }

    const v = this.renderer.findVehicleAtScreen(sx, sy, this.currentTime);
    if (v) {
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = `${e.clientX}px`;
      this.tooltip.style.top = `${e.clientY}px`;

      let roleBadge = '<span class="tooltip-badge" style="background:#1e293b;color:#94a3b8">Benign</span>';
      if (v.isMitigated) roleBadge = '<span class="tooltip-badge" style="background:#475569;color:#f8fafc">Mitigated</span>';
      else if (v.isConfirmed) roleBadge = '<span class="tooltip-badge" style="background:#b45309;color:#fff">Confirmed</span>';
      else if (v.isFlagged) roleBadge = '<span class="tooltip-badge" style="background:#d97706;color:#fff">Flagged</span>';
      else if (v.isAttacker) roleBadge = `<span class="tooltip-badge" style="background:#dc2626;color:#fff">${v.attackType}</span>`;

      this.tooltip.innerHTML = `
        <div class="tooltip-header">
          <span class="tooltip-title">Vehicle V${v.id}</span>
          ${roleBadge}
        </div>
        <div class="tooltip-row"><span>Controller:</span><span class="tooltip-val" style="color:${this.renderer.controllerColors[v.ctrlId]}">CTRL ${v.ctrlId}</span></div>
        <div class="tooltip-row"><span>Position:</span><span class="tooltip-val">(${v.x.toFixed(1)}, ${v.y.toFixed(1)})</span></div>
        <div class="tooltip-row"><span>Heading:</span><span class="tooltip-val">${(v.heading * 180 / Math.PI).toFixed(0)}°</span></div>
        ${v.score > 0 ? `<div class="tooltip-row"><span>Detection Score:</span><span class="tooltip-val" style="color:#f59e0b">${v.score.toFixed(2)}</span></div>` : ''}
      `;
    } else {
      this.tooltip.style.display = 'none';
    }
  }

  updateTimeDisplay() {
    this.timeDisplay.textContent = `t = ${this.currentTime.toFixed(2)} s`;
  }

  startLoop() {
    const tick = (now) => {
      const deltaMs = now - this.lastFrameTime;
      this.lastFrameTime = now;

      if (this.playing) {
        const deltaSeconds = (deltaMs / 1000.0) * this.rate;
        this.currentTime += deltaSeconds;

        if (this.currentTime >= this.t1) {
          this.currentTime = this.t0;
        }

        this.timelineSlider.value = this.currentTime;
        this.updateTimeDisplay();
      }

      this.renderer.render(this.currentTime);

      if (now - this.lastPanelUpdateTime > 100) {
        this.panels.update(this.currentTime, this.scenario, this.renderer.selectedVehicleId);
        this.lastPanelUpdateTime = now;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.roadwatchApp = new RoadwatchApp();
});
