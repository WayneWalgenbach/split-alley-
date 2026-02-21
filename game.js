(() => {
  "use strict";

  // ===== Canvas =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // ===== UI =====
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const toast = document.getElementById("toast");

  const hpText = document.getElementById("hpText");
  const ammoText = document.getElementById("ammoText");
  const grenText = document.getElementById("grenText");
  const scoreText = document.getElementById("scoreText");
  const waveText = document.getElementById("waveText");

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 1300);
  }

  // ===== Helpers =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();

  // ===== Input =====
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);

    if (k === "p") togglePause();
    if (k === "r") restart();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  // ===== Game State =====
  let running = false;
  let paused = false;
  let lastT = 0;

  // World
  const W = canvas.width, H = canvas.height;
  const groundY = 445;

  // Entities
  let bullets = [];
  let grenades = [];
  let particles = [];
  let enemies = [];
  let pickups = [];
  let boss = null;

  // Progression
  let score = 0;
  let wave = 1;
  let waveTimer = 0;
  let spawnBudget = 0;

  // ===== Player =====
  const player = {
    x: 120,
    y: groundY,
    vx: 0,
    vy: 0,
    w: 34,
    h: 52,
    facing: 1,
    onGround: true,

    hp: 100,
    gren: 3,

    // combat
    fireCD: 0,
    dashCD: 0,
    invuln: 0,
    slideT: 0,

    // momentum (signature twist)
    momentum: 0, // 0..100
    lastMoveT: 0,
  };

  function resetAll() {
    bullets = [];
    grenades = [];
    particles = [];
    enemies = [];
    pickups = [];
    boss = null;

    score = 0;
    wave = 1;
    waveTimer = 0;
    spawnBudget = 0;

    player.x = 120;
    player.y = groundY;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    player.onGround = true;
    player.hp = 100;
    player.gren = 3;
    player.fireCD = 0;
    player.dashCD = 0;
    player.invuln = 0;
    player.slideT = 0;
    player.momentum = 0;
    player.lastMoveT = now();

    syncHUD();
  }

  function syncHUD() {
    hpText.textContent = Math.max(0, Math.floor(player.hp));
    ammoText.textContent = "∞";
    grenText.textContent = player.gren;
    scoreText.textContent = score;
    waveText.textContent = wave;
  }

  // ===== Enemy Types =====
  function spawnDrone() {
    enemies.push({
      type: "drone",
      x: W + 40,
      y: rand(210, 330),
      vx: rand(-120, -180),
      vy: rand(-20, 20),
      w: 28,
      h: 18,
      hp: 12,
      t: rand(0, 10),
      dmg: 12,
      score: 30,
    });
  }

  function spawnRaider() {
    enemies.push({
      type: "raider",
      x: W + 40,
      y: groundY,
      vx: rand(-70, -110),
      vy: 0,
      w: 30,
      h: 48,
      hp: 22,
      t: 0,
      dmg: 18,
      score: 45,
      shootCD: rand(900, 1400),
    });
  }

  function spawnShield() {
    enemies.push({
      type: "shield",
      x: W + 60,
      y: groundY,
      vx: rand(-55, -85),
      vy: 0,
      w: 34,
      h: 52,
      hp: 40,
      t: 0,
      dmg: 22,
      score: 80,
      shield: true,
    });
  }

  function spawnBoss() {
    boss = {
      type: "boss",
      x: W + 200,
      y: groundY,
      vx: -45,
      vy: 0,
      w: 130,
      h: 110,
      hp: 550 + wave * 90,
      maxhp: 550 + wave * 90,
      phase: 0,
      atkCD: 1200,
      dmg: 28,
    };
    showToast("BOSS INBOUND: Foreclosure King");
  }

  // ===== Combat Objects =====
  function shoot() {
    if (player.fireCD > 0) return;

    // Momentum reduces fire cooldown
    const m = player.momentum / 100; // 0..1
    const cd = 140 - Math.floor(70 * m); // 140ms -> 70ms
    player.fireCD = cd;

    const speed = 520;
    bullets.push({
      x: player.x + player.facing * 28,
      y: player.y - 26,
      vx: player.facing * speed,
      vy: 0,
      r: 3,
      dmg: 10 + Math.floor(6 * m),
    });

    // add particles
    for (let i = 0; i < 2; i++) {
      particles.push({
        x: player.x + player.facing * 30,
        y: player.y - 26,
        vx: player.facing * rand(60, 140),
        vy: rand(-60, 60),
        life: 200,
      });
    }
  }

  function throwGrenade() {
    if (player.gren <= 0) return;
    player.gren--;
    syncHUD();

    grenades.push({
      x: player.x + player.facing * 18,
      y: player.y - 36,
      vx: player.facing * 280,
      vy: -380,
      r: 6,
      t: 0,
      fuse: 900,
      dmg: 70,
      blast: 95,
    });

    showToast("GRENADE!");
  }

  function explode(x, y, blast, dmg) {
    // particles
    for (let i = 0; i < 26; i++) {
      particles.push({
        x, y,
        vx: rand(-320, 320),
        vy: rand(-320, 320),
        life: rand(250, 520),
      });
    }

    // damage enemies
    for (const e of enemies) {
      const dx = (e.x - x);
      const dy = (e.y - y);
      const dist = Math.hypot(dx, dy);
      if (dist < blast) {
        const scale = 1 - dist / blast;
        e.hp -= Math.floor(dmg * (0.45 + 0.55 * scale));
        e.vx += Math.sign(dx) * 120 * scale;
      }
    }

    if (boss) {
      const dx = boss.x - x;
      const dy = boss.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < blast + 40) {
        const scale = 1 - dist / (blast + 40);
        boss.hp -= Math.floor(dmg * (0.35 + 0.65 * scale));
        boss.vx += Math.sign(dx) * 70 * scale;
      }
    }
  }

  // ===== Movement / Abilities =====
  function jump() {
    if (!player.onGround) return;
    player.vy = -520;
    player.onGround = false;
  }

  function slide() {
    if (!player.onGround) return;
    if (player.slideT > 0) return;
    player.slideT = 320;
    player.vx = player.facing * 360;
    player.invuln = Math.max(player.invuln, 120);
  }

  function dash() {
    if (player.dashCD > 0) return;
    // Momentum reduces dash cooldown
    const m = player.momentum / 100;
    player.dashCD = 1100 - Math.floor(450 * m); // 1100 -> 650

    player.vx = player.facing * 560;
    player.invuln = Math.max(player.invuln, 180);
    for (let i = 0; i < 10; i++) {
      particles.push({
        x: player.x,
        y: player.y - 20,
        vx: rand(-120, 120),
        vy: rand(-80, 80),
        life: rand(180, 320),
      });
    }
  }

  // ===== Damage =====
  function hurt(amount) {
    if (player.invuln > 0) return;
    player.hp -= amount;
    player.invuln = 520;
    player.momentum = Math.max(0, player.momentum - 22);
    syncHUD();
    showToast("HIT!");
    if (player.hp <= 0) {
      gameOver();
    }
  }

  // ===== Spawning Logic =====
  function waveLogic(dt) {
    waveTimer += dt;

    // Every ~22 seconds, push a boss wave
    const bossEvery = 22_000;
    const shouldBoss = (wave % 3 === 0) && !boss;

    // Spawn budget grows with time
    spawnBudget += dt;

    // Regular spawns
    while (spawnBudget > 900) {
      spawnBudget -= rand(700, 1100);

      const r = Math.random();
      if (r < 0.42) spawnRaider();
      else if (r < 0.78) spawnDrone();
      else spawnShield();
    }

    // Boss trigger: after time and enough score/waves
    if (!boss && (waveTimer > bossEvery) && shouldBoss) {
      spawnBoss();
      waveTimer = 0;
    }

    // Increase wave over time
    if (waveTimer > 12_000 && !boss) {
      wave++;
      waveTimer = 0;
      spawnBudget += 2500;
      showToast(`WAVE ${wave}`);
      syncHUD();
    }
  }

  // ===== Update Loop =====
  function update(dt) {
    if (!running || paused) return;

    // Player input
    const left = keys.has("a");
    const right = keys.has("d");
    const wantShoot = keys.has("j");
    const wantGren = keys.has("k");
    const wantDash = keys.has("l");
    const wantJump = keys.has("w");
    const wantSlide = keys.has("s");

    // Facing + movement
    let move = 0;
    if (left) move -= 1;
    if (right) move += 1;

    if (move !== 0) {
      player.facing = move;
      player.lastMoveT = now();
      // momentum rises from moving + existing combat
      player.momentum = clamp(player.momentum + dt * 0.015, 0, 100);
    } else {
      // lose momentum if camping
      const idleMs = now() - player.lastMoveT;
      if (idleMs > 450) player.momentum = clamp(player.momentum - dt * 0.03, 0, 100);
    }

    // Base accel
    const speed = 240 + (player.momentum / 100) * 70;
    const targetVx = move * speed;

    if (player.slideT <= 0) {
      player.vx += (targetVx - player.vx) * (player.onGround ? 0.18 : 0.08);
    } else {
      player.slideT -= dt;
      if (player.slideT <= 0) player.slideT = 0;
    }

    if (wantJump) jump();
    if (wantSlide) slide();
    if (wantDash) dash();

    // Shooting / grenades (edge-ish: simple cooldown)
    if (wantShoot) shoot();
    if (wantGren && player._grenLatch !== true) {
      throwGrenade();
      player._grenLatch = true;
    }
    if (!wantGren) player._grenLatch = false;

    // Physics
    player.vy += 1200 * (dt / 1000);
    player.x += player.vx * (dt / 1000);
    player.y += player.vy * (dt / 1000);

    // World bounds
    player.x = clamp(player.x, 30, W - 30);

    // Ground
    if (player.y >= groundY) {
      player.y = groundY;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    // Timers
    player.fireCD = Math.max(0, player.fireCD - dt);
    player.dashCD = Math.max(0, player.dashCD - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    // Update bullets
    for (const b of bullets) {
      b.x += b.vx * (dt / 1000);
      b.y += b.vy * (dt / 1000);
    }
    bullets = bullets.filter(b => b.x > -50 && b.x < W + 50);

    // Update grenades
    for (const g of grenades) {
      g.t += dt;
      g.vy += 1100 * (dt / 1000);
      g.x += g.vx * (dt / 1000);
      g.y += g.vy * (dt / 1000);

      // bounce off ground
      if (g.y > groundY - 6) {
        g.y = groundY - 6;
        g.vy *= -0.45;
        g.vx *= 0.76;
      }

      if (g.t >= g.fuse) {
        g._boom = true;
        explode(g.x, g.y, g.blast, g.dmg);
      }
    }
    grenades = grenades.filter(g => !g._boom && g.x > -80 && g.x < W + 80);

    // Update particles
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * (dt / 1000);
      p.y += p.vy * (dt / 1000);
      p.vx *= 0.985;
      p.vy *= 0.985;
    }
    particles = particles.filter(p => p.life > 0);

    // Spawning / waves
    waveLogic(dt);

    // Update enemies
    for (const e of enemies) {
      e.t += dt;

      if (e.type === "drone") {
        e.x += e.vx * (dt / 1000);
        e.y += (Math.sin(e.t * 0.006) * 55 + e.vy) * (dt / 1000);
        e.y = clamp(e.y, 140, 380);
      } else if (e.type === "raider") {
        e.x += e.vx * (dt / 1000);

        e.shootCD -= dt;
        if (e.shootCD <= 0 && Math.abs(e.x - player.x) < 520) {
          // Raider shoots a slow bolt
          bullets.push({
            x: e.x - 20,
            y: e.y - 26,
            vx: -360,
            vy: 0,
            r: 3,
            dmg: 8,
            hostile: true
          });
          e.shootCD = rand(950, 1500);
        }
      } else if (e.type === "shield") {
        e.x += e.vx * (dt / 1000);
      }

      // collision with player
      const px = player.x, py = player.y;
      if (aabb(px - player.w/2, py - player.h, player.w, player.h,
               e.x - e.w/2, e.y - e.h, e.w, e.h)) {
        hurt(e.dmg);
        // knockback
        player.vx = -player.facing * 260;
      }
    }

    // Hostile bullets hit player
    for (const b of bullets) {
      if (!b.hostile) continue;
      if (circleAabb(b.x, b.y, b.r,
                     player.x - player.w/2, player.y - player.h, player.w, player.h)) {
        b._dead = true;
        hurt(b.dmg);
      }
    }
    bullets = bullets.filter(b => !b._dead);

    // Player bullets hit enemies/boss
    for (const b of bullets) {
      if (b.hostile) continue;

      // boss
      if (boss && circleAabb(b.x, b.y, b.r, boss.x - boss.w/2, boss.y - boss.h, boss.w, boss.h)) {
        b._dead = true;
        boss.hp -= b.dmg;
        score += 2;
        // momentum reward for hits
        player.momentum = clamp(player.momentum + 0.7, 0, 100);
      }

      // enemies
      for (const e of enemies) {
        if (circleAabb(b.x, b.y, b.r, e.x - e.w/2, e.y - e.h, e.w, e.h)) {
          // shield unit blocks frontal shots
          if (e.shield && b.vx > 0) {
            b._dead = true;
            particles.push({ x: b.x, y: b.y, vx: rand(-90,90), vy: rand(-90,90), life: 180 });
            break;
          }

          b._dead = true;
          e.hp -= b.dmg;
          score += 5;
          player.momentum = clamp(player.momentum + 1.2, 0, 100);
          break;
        }
      }
    }
    bullets = bullets.filter(b => !b._dead);

    // Remove dead enemies, drop pickups sometimes
    const kept = [];
    for (const e of enemies) {
      if (e.hp > 0 && e.x > -120) {
        kept.push(e);
        continue;
      }
      if (e.hp <= 0) {
        score += e.score;
        // occasional grenade pickup
        if (Math.random() < 0.14) {
          pickups.push({ type:"gren", x:e.x, y:e.y-30, vy:-120, t:0 });
        }
        // occasional hp pickup
        if (Math.random() < 0.08) {
          pickups.push({ type:"hp", x:e.x, y:e.y-30, vy:-140, t:0 });
        }
        // pop fx
        explode(e.x, e.y - 25, 40, 0);
      }
    }
    enemies = kept;

    // Pickups update
    for (const p of pickups) {
      p.t += dt;
      p.vy += 800 * (dt/1000);
      p.y += p.vy * (dt/1000);
      if (p.y > groundY - 6) {
        p.y = groundY - 6;
        p.vy *= -0.25;
      }

      if (aabb(player.x - player.w/2, player.y - player.h, player.w, player.h,
               p.x - 12, p.y - 12, 24, 24)) {
        if (p.type === "gren") {
          player.gren = clamp(player.gren + 1, 0, 9);
          showToast("+1 Grenade");
        } else if (p.type === "hp") {
          player.hp = clamp(player.hp + 18, 0, 100);
          showToast("+HP");
        }
        p._take = true;
        syncHUD();
      }
    }
    pickups = pickups.filter(p => !p._take && p.x > -200);

    // Boss update
    if (boss) {
      boss.x += boss.vx * (dt / 1000);

      // approach to arena position
      const targetX = W - 210;
      if (boss.x < targetX) boss.vx = 0;

      boss.atkCD -= dt;
      if (boss.atkCD <= 0 && boss.vx === 0) {
        boss.atkCD = rand(900, 1400);

        // choose attack
        const r = Math.random();
        if (r < 0.55) {
          // burst
          for (let i = 0; i < 4; i++) {
            bullets.push({
              x: boss.x - boss.w/2 + 12,
              y: boss.y - boss.h + 34 + i*14,
              vx: -420,
              vy: rand(-40, 40),
              r: 4,
              dmg: 10,
              hostile: true
            });
          }
        } else {
          // stomp shockwave
          particles.push({ x: boss.x, y: boss.y - 6, vx: 0, vy: 0, life: 520 });
          if (Math.abs(player.x - boss.x) < 240) hurt(16);
        }
      }

      // player collision
      if (aabb(player.x - player.w/2, player.y - player.h, player.w, player.h,
               boss.x - boss.w/2, boss.y - boss.h, boss.w, boss.h)) {
        hurt(boss.dmg);
        player.vx = -player.facing * 360;
      }

      if (boss.hp <= 0) {
        score += 1200 + wave * 80;
        explode(boss.x, boss.y - 40, 140, 0);
        boss = null;
        wave++;
        waveTimer = 0;
        spawnBudget += 3200;
        showToast("BOSS DOWN!");
        syncHUD();
      }
    }

    syncHUD();
  }

  // ===== Collision Helpers =====
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function circleAabb(cx, cy, cr, rx, ry, rw, rh) {
    const px = clamp(cx, rx, rx + rw);
    const py = clamp(cy, ry, ry + rh);
    const dx = cx - px, dy = cy - py;
    return (dx*dx + dy*dy) <= cr*cr;
  }

  // ===== Render =====
  function drawBackground() {
    // sky
    ctx.fillStyle = "#070a0f";
    ctx.fillRect(0, 0, W, H);

    // distant dunes
    ctx.fillStyle = "rgba(103,232,249,.08)";
    for (let i = 0; i < 6; i++) {
      const y = 240 + i * 26;
      ctx.fillRect(0, y, W, 2);
    }

    // horizon glow
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(103,232,249,.10)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ground
    ctx.fillStyle = "#0e1625";
    ctx.fillRect(0, groundY, W, H - groundY);

    // ground line
    ctx.fillStyle = "rgba(103,232,249,.18)";
    ctx.fillRect(0, groundY, W, 2);

    // billboard silhouettes
    ctx.fillStyle = "rgba(231,238,252,.08)";
    for (let i = 0; i < 5; i++) {
      const x = 80 + i * 190;
      ctx.fillRect(x, groundY - 95, 60, 34);
      ctx.fillRect(x + 26, groundY - 61, 8, 61);
    }
  }

  function drawPlayer() {
    const x = player.x, y = player.y;
    const inv = player.invuln > 0 && Math.floor(now()/70)%2===0;

    // body
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = inv ? 0.45 : 1;

    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 20, 6, 0, 0, Math.PI*2);
    ctx.fill();

    // legs
    ctx.fillStyle = "#1f2b40";
    ctx.fillRect(-10, -20, 8, 20);
    ctx.fillRect(2, -20, 8, 20);

    // torso
    ctx.fillStyle = "#243453";
    ctx.fillRect(-14, -54, 28, 34);

    // visor (neon)
    ctx.fillStyle = "rgba(103,232,249,.95)";
    ctx.fillRect(-10, -50, 20, 8);

    // mohawk
    ctx.fillStyle = "rgba(251,113,133,.9)";
    ctx.fillRect(-2, -68, 4, 14);

    // gun
    ctx.fillStyle = "#e7eefc";
    const fx = player.facing;
    ctx.fillRect(10*fx, -40, 22*fx, 4);
    ctx.fillRect(20*fx, -44, 8*fx, 12);

    // momentum meter above
    const m = player.momentum/100;
    ctx.strokeStyle = "rgba(103,232,249,.35)";
    ctx.strokeRect(-22, -82, 44, 6);
    ctx.fillStyle = "rgba(103,232,249,.85)";
    ctx.fillRect(-22, -82, 44*m, 6);

    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      if (e.type === "drone") {
        ctx.fillStyle = "rgba(103,232,249,.9)";
        ctx.fillRect(e.x - e.w/2, e.y - e.h/2, e.w, e.h);
        ctx.fillStyle = "rgba(251,113,133,.9)";
        ctx.fillRect(e.x + 6, e.y - 2, 6, 4);
      } else if (e.type === "raider") {
        ctx.fillStyle = "rgba(231,238,252,.88)";
        ctx.fillRect(e.x - e.w/2, e.y - e.h, e.w, e.h);
        ctx.fillStyle = "rgba(103,232,249,.35)";
        ctx.fillRect(e.x - 10, e.y - 16, 20, 6);
      } else if (e.type === "shield") {
        ctx.fillStyle = "rgba(231,238,252,.75)";
        ctx.fillRect(e.x - e.w/2, e.y - e.h, e.w, e.h);
        // shield plate
        ctx.fillStyle = "rgba(103,232,249,.30)";
        ctx.fillRect(e.x - 22, e.y - 42, 14, 30);
      }

      // small hp bar
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(e.x - 18, e.y - e.h - 10, 36, 4);
      ctx.fillStyle = "rgba(52,211,153,.85)";
      const hpw = clamp((e.hp/40), 0, 1) * 36;
      ctx.fillRect(e.x - 18, e.y - e.h - 10, hpw, 4);
    }
  }

  function drawBoss() {
    if (!boss) return;

    // body
    ctx.fillStyle = "rgba(231,238,252,.8)";
    ctx.fillRect(boss.x - boss.w/2, boss.y - boss.h, boss.w, boss.h);

    // accents
    ctx.fillStyle = "rgba(103,232,249,.35)";
    ctx.fillRect(boss.x - boss.w/2 + 16, boss.y - boss.h + 22, boss.w - 32, 10);

    // HP bar top
    const pad = 40;
    const barW = W - pad*2;
    const hp = clamp(boss.hp / boss.maxhp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(pad, 18, barW, 10);
    ctx.fillStyle = "rgba(251,113,133,.85)";
    ctx.fillRect(pad, 18, barW * hp, 10);

    ctx.fillStyle = "rgba(231,238,252,.85)";
    ctx.font = "12px system-ui";
    ctx.fillText("FORECLOSURE KING", pad, 14);
  }

  function drawProjectiles() {
    // bullets
    for (const b of bullets) {
      ctx.fillStyle = b.hostile ? "rgba(251,113,133,.9)" : "rgba(103,232,249,.95)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fill();
    }

    // grenades
    for (const g of grenades) {
      ctx.fillStyle = "rgba(231,238,252,.9)";
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = "rgba(103,232,249,.55)";
      ctx.fillRect(g.x - 2, g.y - 10, 4, 8);
    }
  }

  function drawPickups() {
    for (const p of pickups) {
      ctx.fillStyle = p.type === "gren" ? "rgba(103,232,249,.9)" : "rgba(52,211,153,.9)";
      ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(p.x - 7, p.y - 2, 14, 4);
    }
  }

  function drawParticles() {
    ctx.fillStyle = "rgba(103,232,249,.6)";
    for (const p of particles) {
      const a = clamp(p.life/520, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    drawBackground();
    drawPickups();
    drawEnemies();
    drawBoss();
    drawProjectiles();
    drawParticles();
    drawPlayer();

    if (paused) {
      ctx.fillStyle = "rgba(3,6,12,.65)";
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle = "rgba(231,238,252,.9)";
      ctx.font = "900 32px system-ui";
      ctx.fillText("PAUSED", W/2 - 70, H/2 - 10);
      ctx.font = "14px system-ui";
      ctx.fillStyle = "rgba(159,176,204,.95)";
      ctx.fillText("Press P to resume", W/2 - 74, H/2 + 18);
    }
  }

  // ===== Loop =====
  function loop(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(40, t - lastT);
    lastT = t;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ===== Start / Pause / Restart =====
  function start() {
    overlay.style.display = "none";
    running = true;
    paused = false;
    lastT = 0;
    showToast("GO!");
    syncHUD();
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    showToast(paused ? "Paused" : "Unpaused");
  }

  function restart() {
    resetAll();
    if (!running) overlay.style.display = "grid";
    showToast("Restarted");
  }

  function gameOver() {
    running = false;
    paused = false;
    overlay.style.display = "grid";
    overlay.querySelector(".panelTitle").textContent = "Game Over";
    startBtn.textContent = "Restart";
    showToast("Game Over");
  }

  // ===== Wiring =====
  startBtn.addEventListener("click", () => {
    // restore title (in case of game over)
    overlay.querySelector(".panelTitle").textContent = "Controls";
    startBtn.textContent = "Start";
    resetAll();
    start();
  });

  // Boot
  resetAll();
  requestAnimationFrame(loop);
})();
