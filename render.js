/**
 * Roadwatch Map Renderer (Canvas2D)
 * Per Implementation Spec Part 5 & Data Collection Plan.
 */

export class RoadwatchRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // World & Viewport Configuration
    this.worldSize = 2000.0; // 2000m x 2000m Shibuya
    this.zoom = 1.0;
    this.minZoom = 0.8;
    this.maxZoom = 8.0;
    this.panX = 0;
    this.panY = 0;

    // Static Asset Cache
    this.roadsImage = new Image();
    this.roadsLoaded = false;
    this.roadsImage.src = 'data/roads.png';
    this.roadsImage.onload = () => {
      this.roadsLoaded = true;
      this.cacheStaticLayer();
    };

    this.staticCanvas = document.createElement('canvas');
    this.staticCtx = this.staticCanvas.getContext('2d');
    this.staticLayerCached = false;

    // Active Scenario Data
    this.scenario = null;
    this.selectedVehicleId = null;
    this.hoveredVehicleId = null;

    // Controller Palette
    this.controllerColors = [
      '#38bdf8', // Ctrl 0: Sky Blue
      '#a855f7', // Ctrl 1: Purple
      '#34d399', // Ctrl 2: Emerald
      '#fbbf24'  // Ctrl 3: Amber
    ];

    // Static RSUs and Controller Hubs (nominal logical infrastructure coordinates)
    this.controllers = [
      { id: 0, x: 500,  y: 500,  name: "CTRL 0" },
      { id: 1, x: 1500, y: 500,  name: "CTRL 1" },
      { id: 2, x: 500,  y: 1500, name: "CTRL 2" },
      { id: 3, x: 1500, y: 1500, name: "CTRL 3" }
    ];

    this.rsus = [
      { id: 0, x: 1000, y: 600 },
      { id: 1, x: 600,  y: 1000 },
      { id: 2, x: 1400, y: 1000 },
      { id: 3, x: 1000, y: 1400 }
    ];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);

    this.cacheStaticLayer();
  }

  setScenario(scenario) {
    this.scenario = scenario;
    this.cacheStaticLayer();
  }

  cacheStaticLayer() {
    if (!this.width || !this.height) return;
    this.staticCanvas.width = this.width;
    this.staticCanvas.height = this.height;

    const ctx = this.staticCtx;
    ctx.clearRect(0, 0, this.width, this.height);

    // High-contrast dark cyber-slate background
    ctx.fillStyle = '#080d1a';
    ctx.fillRect(0, 0, this.width, this.height);

    // Draw subtle coordinate grid
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
    ctx.lineWidth = 1;
    const gridSize = 200;
    for (let x = 0; x <= this.worldSize; x += gridSize) {
      const p1 = this.worldToScreen(x, 0);
      const p2 = this.worldToScreen(x, this.worldSize);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let y = 0; y <= this.worldSize; y += gridSize) {
      const p1 = this.worldToScreen(0, y);
      const p2 = this.worldToScreen(this.worldSize, y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Draw high-definition rasterized road network
    if (this.roadsLoaded) {
      const p0 = this.worldToScreen(0, 0);
      const p1 = this.worldToScreen(this.worldSize, this.worldSize);
      const roadW = p1.x - p0.x;
      const roadH = p1.y - p0.y;

      // Draw road network base layer
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.drawImage(this.roadsImage, p0.x, p0.y, roadW, roadH);

      // Add additive glow pass for major arterials
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.45;
      ctx.drawImage(this.roadsImage, p0.x, p0.y, roadW, roadH);
      ctx.restore();
    }

    // Shibuya Landmark Badges
    const landmarks = [
      { name: "SHIBUYA STATION", x: 1000, y: 1050, type: "transit" },
      { name: "DOGENZAKA", x: 650, y: 1100, type: "district" },
      { name: "MEIJI-DORI", x: 1350, y: 800, type: "avenue" },
      { name: "ROPPONGI-DORI", x: 1400, y: 1450, type: "avenue" },
      { name: "YOYOGI PARKWAY", x: 750, y: 450, type: "district" }
    ];

    landmarks.forEach(lm => {
      const p = this.worldToScreen(lm.x, lm.y);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lm.name, p.x, p.y);
    });

    // Draw RSUs
    this.rsus.forEach(rsu => {
      const p = this.worldToScreen(rsu.x, rsu.y);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.fillRect(p.x - 6, p.y - 6, 12, 12);

      ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`RSU-${rsu.id}`, p.x + 9, p.y + 3);
    });

    this.staticLayerCached = true;
  }

  worldToScreen(wx, wy) {
    const scale = (Math.min(this.width, this.height) / this.worldSize) * this.zoom;
    const offsetX = (this.width - this.worldSize * scale) / 2 + this.panX;
    const offsetY = (this.height - this.worldSize * scale) / 2 + this.panY;
    return {
      x: wx * scale + offsetX,
      y: wy * scale + offsetY,
      scale
    };
  }

  screenToWorld(sx, sy) {
    const scale = (Math.min(this.width, this.height) / this.worldSize) * this.zoom;
    const offsetX = (this.width - this.worldSize * scale) / 2 + this.panX;
    const offsetY = (this.height - this.worldSize * scale) / 2 + this.panY;
    return {
      x: (sx - offsetX) / scale,
      y: (sy - offsetY) / scale
    };
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Sub-frame position interpolation across 5 Hz grid (dt = 0.2s)
   */
  getVehicleState(vid, t) {
    if (!this.scenario || !this.scenario.positions) return null;
    const meta = this.scenario.meta;
    const t0 = meta.t0 || 5.0;
    const dt = meta.dt || 0.2;
    const positions = this.scenario.positions;

    const frameFloat = (t - t0) / dt;
    const i = Math.floor(frameFloat);
    const alpha = frameFloat - i;

    if (i < 0 || i >= positions.length) return null;

    const f1 = positions[i];
    const f2 = (i + 1 < positions.length) ? positions[i + 1] : f1;

    const x1 = f1[vid * 2];
    const y1 = f1[vid * 2 + 1];
    const x2 = f2[vid * 2];
    const y2 = f2[vid * 2 + 1];

    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

    const x = this.lerp(x1, x2, alpha);
    const y = this.lerp(y1, y2, alpha);
    const heading = Math.atan2(y2 - y1, x2 - x1);

    // Compute status flags from events up to time t
    let isFlagged = false;
    let isConfirmed = false;
    let isMitigated = false;
    let detectionScore = 0.0;
    let attackType = this.scenario.roles?.[String(vid)] || null;

    if (this.scenario.events) {
      for (const ev of this.scenario.events) {
        if (ev.t > t) break;
        if (ev.actor === vid) {
          if (ev.type === 'detection') {
            isFlagged = true;
            detectionScore = ev.score || 0.85;
            if (ev.confirmed) isConfirmed = true;
          } else if (ev.type === 'mitigation') {
            isMitigated = true;
          }
        }
      }
    }

    const ctrlId = this.scenario.controller_of ? this.scenario.controller_of[vid] : Math.floor(vid / 13);

    return {
      id: vid,
      x,
      y,
      heading,
      ctrlId,
      attackType,
      isAttacker: !!attackType,
      isFlagged,
      isConfirmed,
      isMitigated,
      score: detectionScore
    };
  }

  render(currentTime) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Layer 0 & 1: Static Layer (roads, grid, RSUs)
    this.cacheStaticLayer();
    ctx.drawImage(this.staticCanvas, 0, 0);

    if (!this.scenario) return;

    // Layer 2: Packets
    this.renderPackets(currentTime);

    // Layer 3: Mechanism Evidence & Tethers (DIM, SI, EA, TA)
    this.renderEvidenceTethers(currentTime);

    // Layer 4 & 5: Vehicles and Ghosts
    this.renderVehicles(currentTime);

    // Layer 6: Selection & Reticle Overlays
    this.renderSelectionOverlay(currentTime);
  }

  renderPackets(currentTime) {
    if (!this.scenario?.events) return;
    const ctx = this.ctx;

    // Active packet window = 300ms fade
    const windowStart = currentTime - 0.3;
    for (const ev of this.scenario.events) {
      if (ev.t < windowStart) continue;
      if (ev.t > currentTime) break;
      if (ev.type === 'packet') {
        const pSrcState = this.getVehicleState(ev.src, currentTime);
        const pDstState = this.getVehicleState(ev.dst, currentTime);
        if (pSrcState && pDstState) {
          const s1 = this.worldToScreen(pSrcState.x, pSrcState.y);
          const s2 = this.worldToScreen(pDstState.x, pDstState.y);

          const age = currentTime - ev.t;
          const alpha = Math.max(0, 1.0 - (age / 0.3));

          ctx.strokeStyle = ev.label === 'Normal' ? `rgba(56, 189, 248, ${alpha * 0.5})` : `rgba(239, 68, 68, ${alpha * 0.8})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.stroke();

          // Packet Pulse Dot
          const pulseT = age / 0.3;
          const px = this.lerp(s1.x, s2.x, pulseT);
          const py = this.lerp(s1.y, s2.y, pulseT);
          ctx.fillStyle = ev.label === 'Normal' ? '#38bdf8' : '#ef4444';
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  renderEvidenceTethers(currentTime) {
    if (!this.scenario?.evidence) return;
    const ctx = this.ctx;
    const evidence = this.scenario.evidence;

    // 1. DIM Lie Tether (Hold visible 1.2s per §5.4)
    if (evidence.dim) {
      evidence.dim.forEach(tether => {
        const dt = currentTime - tether.t;
        if (dt >= 0 && dt <= 1.2) {
          const alpha = 1.0 - (dt / 1.5) * 0.4;
          const truePt = this.worldToScreen(tether.true_xy[0], tether.true_xy[1]);
          const liePt = this.worldToScreen(tether.lie_xy[0], tether.lie_xy[1]);

          // Dashed connecting line
          ctx.save();
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.9})`;
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.moveTo(truePt.x, truePt.y);
          ctx.lineTo(liePt.x, liePt.y);
          ctx.stroke();
          ctx.restore();

          // Distance delta label at midpoint
          const midX = (truePt.x + liePt.x) / 2;
          const midY = (truePt.y + liePt.y) / 2;
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`Δ ${tether.err_m} m`, midX, midY - 6);

          // Ghost at falsified coordinates (dashed circle)
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.7})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(liePt.x, liePt.y, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(239, 68, 68, ${alpha * 0.2})`;
          ctx.fill();

          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.font = '10px Inter, sans-serif';
          ctx.fillText("LIE GHOST", liePt.x, liePt.y + 16);
          ctx.restore();
        }
      });
    }

    // 2. SI Phantoms
    if (evidence.si) {
      evidence.si.forEach(phantom => {
        const donorState = this.getVehicleState(phantom.donor_vehicle_id, currentTime);
        const pPt = this.worldToScreen(phantom.fake_xy[0], phantom.fake_xy[1]);

        // Draw phantom sprite (dashed circle)
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pPt.x, pPt.y, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(236, 72, 153, 0.2)';
        ctx.fill();

        ctx.fillStyle = '#ec4899';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(`SI-${phantom.phantom_id}`, pPt.x + 9, pPt.y + 3);

        // Tether to donor vehicle
        if (donorState) {
          const dPt = this.worldToScreen(donorState.x, donorState.y);
          ctx.strokeStyle = 'rgba(236, 72, 153, 0.35)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(pPt.x, pPt.y);
          ctx.lineTo(dPt.x, dPt.y);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    // 3. EA Capture Rays
    if (evidence.ea) {
      evidence.ea.forEach(burst => {
        const dt = currentTime - burst.t;
        if (dt >= 0 && dt <= 1.0) {
          const ctrl = this.controllers[burst.ctrl_id % 4];
          const cPt = this.worldToScreen(ctrl.x, ctrl.y);
          burst.victims.forEach(vid => {
            const vState = this.getVehicleState(vid, currentTime);
            if (vState) {
              const vPt = this.worldToScreen(vState.x, vState.y);
              ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
              ctx.lineWidth = 1.0;
              ctx.beginPath();
              ctx.moveTo(cPt.x, cPt.y);
              ctx.lineTo(vPt.x, vPt.y);
              ctx.stroke();
            }
          });
        }
      });
    }
  }

  renderVehicles(currentTime) {
    const ctx = this.ctx;
    const nVehicles = this.scenario?.meta?.n_vehicles || 50;

    for (let vid = 0; vid < nVehicles; vid++) {
      const v = this.getVehicleState(vid, currentTime);
      if (!v) continue;

      const p = this.worldToScreen(v.x, v.y);
      const ctrlColor = this.controllerColors[v.ctrlId % 4];

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(v.heading);

      // --- Vehicle Visual States (Spec §5.3 & Grayscale distinctness) ---
      if (v.isMitigated) {
        // Mitigated: Muted Grey + Dashed Square Cage
        ctx.fillStyle = '#64748b';
        this.drawVehicleBody(ctx);

        ctx.rotate(-v.heading);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-10, -10, 20, 20); // Square cage
      } else if (v.isConfirmed) {
        // Confirmed Attacker: Solid Amber Double Ring
        ctx.fillStyle = '#ef4444';
        this.drawVehicleBody(ctx);

        ctx.rotate(-v.heading);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.stroke();
      } else if (v.isFlagged) {
        // Flagged Attacker: Pulsing Amber Ring (radius proportional to score)
        ctx.fillStyle = '#ef4444';
        this.drawVehicleBody(ctx);

        ctx.rotate(-v.heading);
        const pulse = 10 + (v.score * 6) + Math.sin(currentTime * 8) * 2;
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, pulse, 0, Math.PI * 2);
        ctx.stroke();
      } else if (v.isAttacker) {
        // Attacker Undetected: Critical Red + Diamond Badge
        ctx.fillStyle = '#ef4444';
        this.drawVehicleBody(ctx);

        ctx.rotate(-v.heading);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(12, 0);
        ctx.lineTo(0, 12);
        ctx.lineTo(-12, 0);
        ctx.closePath();
        ctx.stroke();
      } else {
        // Benign: Tinted by controller hue (scattered on map)
        ctx.fillStyle = ctrlColor;
        this.drawVehicleBody(ctx);
      }

      ctx.restore();

      // Vehicle ID Label when zoomed in or selected
      if (this.zoom > 2.0 || this.selectedVehicleId === vid) {
        ctx.fillStyle = '#f8fafc';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`V${vid}`, p.x, p.y - 12);
      }
    }
  }

  drawVehicleBody(ctx) {
    ctx.beginPath();
    ctx.moveTo(7, 0);       // Nose
    ctx.lineTo(-6, -4.5);   // Left wing
    ctx.lineTo(-4, 0);      // Inset
    ctx.lineTo(-6, 4.5);    // Right wing
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  renderSelectionOverlay(currentTime) {
    const ctx = this.ctx;
    if (this.selectedVehicleId !== null) {
      const v = this.getVehicleState(this.selectedVehicleId, currentTime);
      if (v) {
        const p = this.worldToScreen(v.x, v.y);
        ctx.save();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.0;

        // Target reticle
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
        ctx.stroke();

        // Crosshairs
        ctx.beginPath();
        ctx.moveTo(p.x - 20, p.y);
        ctx.lineTo(p.x - 12, p.y);
        ctx.moveTo(p.x + 12, p.y);
        ctx.lineTo(p.x + 20, p.y);
        ctx.moveTo(p.x, p.y - 20);
        ctx.lineTo(p.x, p.y - 12);
        ctx.moveTo(p.x, p.y + 12);
        ctx.lineTo(p.x, p.y + 20);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  findVehicleAtScreen(sx, sy, currentTime) {
    if (!this.scenario) return null;
    const nVehicles = this.scenario?.meta?.n_vehicles || 50;
    const clickThreshold = 18; // px

    let nearest = null;
    let minDist = clickThreshold;

    for (let vid = 0; vid < nVehicles; vid++) {
      const v = this.getVehicleState(vid, currentTime);
      if (!v) continue;
      const p = this.worldToScreen(v.x, v.y);
      const dist = Math.hypot(p.x - sx, p.y - sy);
      if (dist < minDist) {
        minDist = dist;
        nearest = v;
      }
    }
    return nearest;
  }
}
