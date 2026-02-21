(() => {
  "use strict";

  // ===== DOM =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const toast = document.getElementById("toast");

  const hpText = document.getElementById("hpText");
  const ammoText = document.getElementById("ammoText");
  const grenText = document.getElementById("grenText");
  const scoreText = document.getElementById("scoreText");
  const waveText = document.getElementById("waveText");

  // Touch buttons
  const btnLeft  = document.getElementById("btnLeft");
  const btnRight = document.getElementById("btnRight");
  const btnJump  = document.getElementById("btnJump");
  const btnShoot = document.getElementById("btnShoot");
  const btnGren  = document.getElementById("btnGren");
  const btnDash  = document.getElementById("btnDash");
  const btnSlide = document.getElementById("btnSlide");

  // ===== Utils =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 1200);
  }

  // ===== iPhone: stop scroll/gesture stealing input =====
  canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

  // ===== Input (keyboard + touch) =====
  const keys = new Set();
  const setKey = (k, down) => down ? keys.add(k) : keys.delete(k);

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === "p") togglePause();
    if (k === "r") restart();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  function bindHold(el, key) {
    if (!el) return;
    const on = (ev) => { ev.preventDefault(); setKey(key, true); };
    const off = (ev) => { ev.preventDefault(); setKey(key, false); };

    if (window.PointerEvent) {
      el.addEventListener("pointerdown", on, { passive:false });
      el.addEventListener("pointerup", off, { passive:false });
      el.addEventListener("pointercancel", off, { passive:false });
      el.addEventListener("pointerleave", off, { passive:false });
    } else {
      el.addEventListener("touchstart", on, { passive:false });
      el.addEventListener("touchend", off, { passive:false });
      el.addEventListener("touchcancel", off, { passive:false });
    }
  }

  function bindTap(el, key) {
    if (!el) return;
    const tap = (ev) => {
      ev.preventDefault();
      setKey(key, true);
      setTimeout(() => setKey(key, false), 70);
    };
    if (window.PointerEvent) el.addEventListener("pointerdown", tap, { passive:false });
    else el.addEventListener("touchstart", tap, { passive:false });
  }

  bindHold(btnLeft,  "a");
  bindHold(btnRight, "d");
  bindTap(btnJump,   "w");
  bindHold(btnShoot, "j");     // hold to fire
  bindTap(btnGren,   "k");
  bindTap(btnDash,   "l");
  bindTap(btnSlide,  "s");

  // ===== Canvas DPI scaling =====
  const BASE_W = 960, BASE_H = 540;
  const W = BASE_W, H = BASE_H;
  let sx = 1, sy = 1;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    sx = cssW / BASE_W;
    sy = cssH / BASE_H;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas);
  setTimeout(resizeCanvas, 0);

  // ===== Game State =====
  let running = false;
  let paused = false;
  let lastT = 0;

  const groundY = 445;

  let bullets = [];
  let grenades = [];
  let particles = []; // {x,y,vx,vy,life,kind}
  let enemies = [];
  let pickups = [];
  let boss = null;

  let score = 0;
  let wave = 1;
  let waveTimer = 0;
  let spawnBudget = 0;

  // Visual juice
  let shake = 0;
  let flash = 0;
  let scroll = 0;  // background motion

  const player = {
    x: 150, y: groundY, vx: 0, vy: 0,
    w: 30, h: 54,
    facing: 1, onGround: true,
    hp: 100, gren: 3,
    fireCD: 0, dashCD: 0, invuln: 0, slideT: 0,
    momentum: 0, lastMoveT: 0,
    _grenLatch: false
  };

  function syncHUD() {
    if (hpText) hpText.textContent = Math.max(0, Math.floor(player.hp));
    if (ammoText) ammoText.textContent = "∞";
    if (grenText) grenText.textContent = player.gren;
    if (scoreText) scoreText.textContent = score;
    if (waveText) waveText.textContent = wave;
  }

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

    shake = 0;
    flash = 0;
    scroll = 0;

    player.x = 150;
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
    player._grenLatch = false;

    syncHUD();
  }

  // ===== Spawns =====
  function spawnDrone() {
    enemies.push({
      type:"drone", x: W+60, y: rand(210,330),
      vx: rand(-160,-230), vy: rand(-25,25),
      w: 34, h: 18, hp: 16, t: rand(0,10), dmg: 12, score: 40
    });
  }

  function spawnRaider() {
    enemies.push({
      type:"raider", x: W+60, y: groundY,
      vx: rand(-90,-140), vy: 0,
      w: 30, h: 48, hp: 30, t: 0, dmg: 18, score: 60,
      shootCD: rand(900,1400)
    });
  }

  function spawnShield() {
    enemies.push({
      type:"shield", x: W+80, y: groundY,
      vx: rand(-70,-110), vy: 0,
      w: 34, h: 52, hp: 54, t: 0, dmg: 22, score: 100,
      shield: true
    });
  }

  function spawnBoss() {
    boss = {
      type:"boss", x: W+220, y: groundY, vx: -55,
      w: 150, h: 116,
      hp: 600 + wave*90, maxhp: 600 + wave*90,
      atkCD: 1100, dmg: 28
    };
    showToast("BOSS: Foreclosure King");
  }

  // ===== Combat =====
  function shoot() {
    if (player.fireCD > 0) return;

    const m = player.momentum / 100;
    player.fireCD = 120 - Math.floor(65*m);

    bullets.push({
      x: player.x + player.facing*28,
      y: player.y - 30,
      vx: player.facing*(560 + 120*m),
      vy: 0,
      r: 3,
      dmg: 10 + Math.floor(6*m),
      hostile: false
    });

    // muzzle sparks + shell bits
    for (let i=0;i<6;i++){
      particles.push({
        x: player.x + player.facing*26,
        y: player.y - 32,
        vx: player.facing*rand(160,340),
        vy: rand(-220,-40),
        life: rand(120,220),
        kind: "spark"
      });
    }
  }

  function throwGrenade() {
    if (player.gren <= 0) return;
    player.gren--;
    syncHUD();

    grenades.push({
      x: player.x + player.facing*18,
      y: player.y - 40,
      vx: player.facing*320,
      vy: -430,
      r: 6, t: 0, fuse: 850, dmg: 90, blast: 120
    });

    showToast("GRENADE!");
  }

  function explode(x,y,blast,dmg) {
    shake = Math.max(shake, 10);
    flash = Math.max(flash, 120);

    for (let i=0;i<56;i++){
      particles.push({
        x, y,
        vx: rand(-480,480),
        vy: rand(-520,360),
        life: rand(180,620),
        kind: (i%3===0 ? "smoke" : "spark")
      });
    }

    for (const e of enemies){
      const dist = Math.hypot(e.x-x, (e.y-20)-y);
      if (dist < blast){
        const s = 1 - dist/blast;
        e.hp -= Math.floor(dmg*(0.45+0.55*s));
        e.vx += Math.sign(e.x-x)*160*s;
      }
    }

    if (boss){
      const dist = Math.hypot(boss.x-x, (boss.y-44)-y);
      if (dist < blast+60){
        const s = 1 - dist/(blast+60);
        boss.hp -= Math.floor(dmg*(0.35+0.65*s));
        boss.vx += Math.sign(boss.x-x)*95*s;
      }
    }
  }

  // ===== Movement =====
  function jump() {
    if (!player.onGround) return;
    player.vy = -560;
    player.onGround = false;
  }

  function slide() {
    if (!player.onGround) return;
    if (player.slideT > 0) return;
    player.slideT = 320;
    player.vx = player.facing*440;
    player.invuln = Math.max(player.invuln, 120);
    for (let i=0;i<10;i++){
      particles.push({x:player.x,y:player.y-6,vx:rand(-160,160),vy:rand(-80,40),life:rand(140,220),kind:"dust"});
    }
  }

  function dash() {
    if (player.dashCD > 0) return;
    const m = player.momentum/100;
    player.dashCD = 980 - Math.floor(430*m);
    player.vx = player.facing*(680 + 140*m);
    player.invuln = Math.max(player.invuln, 180);
    shake = Math.max(shake, 4);
    for (let i=0;i<14;i++){
      particles.push({x:player.x,y:player.y-22,vx:rand(-180,180),vy:rand(-140,140),life:rand(140,260),kind:"smoke"});
    }
  }

  function hurt(amount) {
    if (player.invuln > 0) return;
    player.hp -= amount;
    player.invuln = 520;
    player.momentum = Math.max(0, player.momentum-22);
    syncHUD();
    shake = Math.max(shake, 6);
    showToast("HIT!");
    if (player.hp <= 0) gameOver();
  }

  // ===== Logic =====
  function aabb(ax,ay,aw,ah,bx,by,bw,bh){
    return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by;
  }
  function circleAabb(cx,cy,cr,rx,ry,rw,rh){
    const px = clamp(cx, rx, rx+rw);
    const py = clamp(cy, ry, ry+rh);
    const dx = cx-px, dy = cy-py;
    return (dx*dx+dy*dy) <= cr*cr;
  }

  function waveLogic(dt){
    waveTimer += dt;
    spawnBudget += dt;

    while (spawnBudget > 900) {
      spawnBudget -= rand(700,1100);
      const r = Math.random();
      if (r < 0.44) spawnRaider();
      else if (r < 0.82) spawnDrone();
      else spawnShield();
    }

    const shouldBoss = (wave % 3 === 0) && !boss;
    if (!boss && waveTimer > 20000 && shouldBoss) {
      spawnBoss();
      waveTimer = 0;
    }

    if (waveTimer > 12000 && !boss) {
      wave++;
      waveTimer = 0;
      spawnBudget += 2600;
      showToast(`WAVE ${wave}`);
      syncHUD();
    }
  }

  function update(dt){
    if (!running || paused) return;

    // side-scroll illusion
    scroll += dt * 0.06;

    const left = keys.has("a");
    const right = keys.has("d");
    const wantShoot = keys.has("j");
    const wantGren = keys.has("k");
    const wantDash = keys.has("l");
    const wantJump = keys.has("w");
    const wantSlide = keys.has("s");

    let move = 0;
    if (left) move -= 1;
    if (right) move += 1;

    if (move !== 0) {
      player.facing = move;
      player.lastMoveT = now();
      player.momentum = clamp(player.momentum + dt*0.015, 0, 100);
    } else {
      const idle = now() - player.lastMoveT;
      if (idle > 450) player.momentum = clamp(player.momentum - dt*0.03, 0, 100);
    }

    const speed = 260 + (player.momentum/100)*90;
    const targetVx = move*speed;

    if (player.slideT <= 0) {
      player.vx += (targetVx - player.vx) * (player.onGround ? 0.18 : 0.08);
    } else {
      player.slideT -= dt;
      if (player.slideT < 0) player.slideT = 0;
    }

    if (wantJump) jump();
    if (wantSlide) slide();
    if (wantDash) dash();
    if (wantShoot) shoot();

    if (wantGren && player._grenLatch !== true){
      throwGrenade();
      player._grenLatch = true;
    }
    if (!wantGren) player._grenLatch = false;

    // physics
    player.vy += 1250*(dt/1000);
    player.x += player.vx*(dt/1000);
    player.y += player.vy*(dt/1000);
    player.x = clamp(player.x, 34, W-34);

    if (player.y >= groundY){
      player.y = groundY;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    player.fireCD = Math.max(0, player.fireCD - dt);
    player.dashCD = Math.max(0, player.dashCD - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    flash = Math.max(0, flash - dt);
    shake = Math.max(0, shake - dt*0.015);

    // bullets
    for (const b of bullets){
      b.x += b.vx*(dt/1000);
      b.y += b.vy*(dt/1000);
    }
    bullets = bullets.filter(b => b.x > -120 && b.x < W+120);

    // grenades
    for (const g of grenades){
      g.t += dt;
      g.vy += 1100*(dt/1000);
      g.x += g.vx*(dt/1000);
      g.y += g.vy*(dt/1000);
      if (g.y > groundY-6){
        g.y = groundY-6;
        g.vy *= -0.45;
        g.vx *= 0.76;
        for (let i=0;i<4;i++){
          particles.push({x:g.x,y:g.y,vx:rand(-140,140),vy:rand(-140,20),life:rand(90,150),kind:"spark"});
        }
      }
      if (g.t >= g.fuse){
        g._boom = true;
        explode(g.x, g.y, g.blast, g.dmg);
      }
    }
    grenades = grenades.filter(g => !g._boom);

    // particles
    for (const p of particles){
      p.life -= dt;
      p.x += p.vx*(dt/1000);
      p.y += p.vy*(dt/1000);
      if (p.kind === "smoke") { p.vx *= 0.985; p.vy = p.vy*0.985 - 10*(dt/1000); }
      else { p.vx *= 0.975; p.vy *= 0.975; }
    }
    particles = particles.filter(p => p.life > 0);

    // spawn waves
    waveLogic(dt);

    // enemies update
    for (const e of enemies){
      e.t += dt;

      if (e.type === "drone"){
        e.x += e.vx*(dt/1000);
        e.y += (Math.sin(e.t*0.006)*55 + e.vy)*(dt/1000);
        e.y = clamp(e.y, 140, 380);
      } else if (e.type === "raider"){
        e.x += e.vx*(dt/1000);
        e.shootCD -= dt;
        if (e.shootCD <= 0 && Math.abs(e.x-player.x) < 520){
          bullets.push({x:e.x-18,y:e.y-30,vx:-380,vy:0,r:3,dmg:8,hostile:true});
          e.shootCD = rand(950,1500);
        }
      } else {
        e.x += e.vx*(dt/1000);
      }

      // collision
      if (aabb(player.x-player.w/2, player.y-player.h, player.w, player.h,
              e.x-e.w/2, e.y-e.h, e.w, e.h)){
        hurt(e.dmg);
        player.vx = -player.facing*280;
      }
    }

    // hostile bullets -> player
    for (const b of bullets){
      if (!b.hostile) continue;
      if (circleAabb(b.x,b.y,b.r, player.x-player.w/2, player.y-player.h, player.w, player.h)){
        b._dead = true;
        hurt(b.dmg);
        for (let i=0;i<10;i++){
          particles.push({x:b.x,y:b.y,vx:rand(-240,240),vy:rand(-240,240),life:rand(80,140),kind:"spark"});
        }
      }
    }
    bullets = bullets.filter(b => !b._dead);

    // player bullets -> enemies/boss
    for (const b of bullets){
      if (b.hostile) continue;

      if (boss && circleAabb(b.x,b.y,b.r, boss.x-boss.w/2, boss.y-boss.h, boss.w, boss.h)){
        b._dead = true;
        boss.hp -= b.dmg;
        score += 2;
        player.momentum = clamp(player.momentum + 0.7, 0, 100);
        for (let i=0;i<8;i++){
          particles.push({x:b.x,y:b.y,vx:rand(-180,180),vy:rand(-180,180),life:rand(70,120),kind:"spark"});
        }
      }

      for (const e of enemies){
        if (circleAabb(b.x,b.y,b.r, e.x-e.w/2, e.y-e.h, e.w, e.h)){
          if (e.shield && b.vx > 0){ b._dead = true; break; }
          b._dead = true;
          e.hp -= b.dmg;
          score += 5;
          player.momentum = clamp(player.momentum + 1.2, 0, 100);
          for (let i=0;i<10;i++){
            particles.push({x:b.x,y:b.y,vx:rand(-240,240),vy:rand(-240,240),life:rand(80,150),kind:"spark"});
          }
          break;
        }
      }
    }
    bullets = bullets.filter(b => !b._dead);

    // cleanup dead enemies + drops
    const kept = [];
    for (const e of enemies){
      if (e.hp > 0 && e.x > -160){ kept.push(e); continue; }
      if (e.hp <= 0){
        score += e.score;
        explode(e.x, e.y-26, 55, 0);
        if (Math.random() < 0.14) pickups.push({type:"gren",x:e.x,y:e.y-30,vy:-120,t:0});
        if (Math.random() < 0.08) pickups.push({type:"hp",x:e.x,y:e.y-30,vy:-140,t:0});
      }
    }
    enemies = kept;

    // pickups
    for (const p of pickups){
      p.t += dt;
      p.vy += 800*(dt/1000);
      p.y += p.vy*(dt/1000);
      if (p.y > groundY-6){ p.y = groundY-6; p.vy *= -0.25; }

      if (aabb(player.x-player.w/2, player.y-player.h, player.w, player.h, p.x-12, p.y-12, 24, 24)){
        if (p.type === "gren"){ player.gren = clamp(player.gren+1, 0, 9); showToast("+1 Gren"); }
        else { player.hp = clamp(player.hp+18, 0, 100); showToast("+HP"); }
        p._take = true;
        syncHUD();
      }
    }
    pickups = pickups.filter(p => !p._take);

    // boss
    if (boss){
      boss.x += boss.vx*(dt/1000);
      const targetX = W-220;
      if (boss.x < targetX) boss.vx = 0;

      boss.atkCD -= dt;
      if (boss.atkCD <= 0 && boss.vx === 0){
        boss.atkCD = rand(900,1400);
        const r = Math.random();
        if (r < 0.6){
          for (let i=0;i<5;i++){
            bullets.push({x:boss.x-boss.w/2+20,y:boss.y-boss.h+36+i*14,vx:-420,vy:rand(-40,40),r:4,dmg:10,hostile:true});
          }
          shake = Math.max(shake, 3);
        } else {
          if (Math.abs(player.x-boss.x) < 260) hurt(16);
        }
      }

      if (aabb(player.x-player.w/2, player.y-player.h, player.w, player.h,
              boss.x-boss.w/2, boss.y-boss.h, boss.w, boss.h)){
        hurt(boss.dmg);
        player.vx = -player.facing*360;
      }

      if (boss.hp <= 0){
        score += 1400 + wave*90;
        explode(boss.x, boss.y-44, 160, 0);
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

  // ===== Render (Metal-Slug-ish) =====
  function drawBackground(){
    // sky
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,"#0b1220");
    g.addColorStop(1,"#02040a");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // stars
    ctx.fillStyle = "rgba(231,238,252,.15)";
    for (let i=0;i<55;i++){
      const x = (i*173 + (scroll*0.3)) % W;
      const y = (i*97) % 220;
      ctx.fillRect(x, y, 2, 2);
    }

    // far mountains (parallax)
    ctx.fillStyle = "rgba(40,80,120,0.28)";
    for (let i=0;i<7;i++){
      const x = ((i*220) - (scroll*0.22 % 220));
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x+110, groundY-130);
      ctx.lineTo(x+220, groundY);
      ctx.fill();
    }

    // mid ruins
    ctx.fillStyle = "rgba(10,16,28,0.85)";
    for (let i=0;i<10;i++){
      const x = (i*140) - (scroll*0.55 % 140);
      ctx.fillRect(x, groundY-70, 26, 70);
      ctx.fillRect(x+18, groundY-100, 10, 100);
    }

    // ground tiles
    for (let x=0; x<W; x+=32){
      const t = ((x + Math.floor(scroll*1.2)) / 32) | 0;
      const shade = (t%2===0) ? "#2a1f12" : "#241a10";
      ctx.fillStyle = shade;
      ctx.fillRect(x, groundY, 32, H-groundY);
      ctx.fillStyle = "rgba(103,232,249,.12)";
      ctx.fillRect(x, groundY, 32, 2);
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.fillRect(x+2, groundY+6, 28, 2);
      ctx.fillRect(x+4, groundY+14, 24, 2);
    }
  }

  function drawPlayer(){
    const inv = player.invuln>0 && Math.floor(now()/70)%2===0;

    // shadow
    ctx.fillStyle="rgba(0,0,0,.45)";
    ctx.beginPath();
    ctx.ellipse(player.x, player.y+6, 16, 5, 0, 0, Math.PI*2);
    ctx.fill();

    // body (chunky sprite)
    const px = player.x|0;
    const py = player.y|0;
    const fx = player.facing;

    ctx.globalAlpha = inv ? 0.55 : 1;

    // legs
    ctx.fillStyle = "#1f2b40";
    ctx.fillRect(px-10, py-18, 8, 18);
    ctx.fillRect(px+2,  py-18, 8, 18);

    // torso
    ctx.fillStyle = "#cfd8ff";
    ctx.fillRect(px-12, py-44, 24, 26);

    // head
    ctx.fillStyle = "#8aa2ff";
    ctx.fillRect(px-7, py-58, 14, 14);

    // mohawk stripe
    ctx.fillStyle = "#ff3d6e";
    ctx.fillRect(px-1, py-64, 2, 10);

    // gun
    ctx.fillStyle="#ffd166";
    ctx.fillRect(px + fx*12, py-36, fx*22, 4);
    ctx.fillStyle="#e7eefc";
    ctx.fillRect(px + fx*22, py-40, fx*10, 12);

    // muzzle flash when holding shoot
    if (keys.has("j") && player.fireCD > 70){
      ctx.fillStyle = "rgba(255,220,120,0.9)";
      ctx.beginPath();
      ctx.arc(px + fx*40, py-34, 7, 0, Math.PI*2);
      ctx.fill();
    }

    // momentum bar (tiny)
    const m = player.momentum/100;
    ctx.strokeStyle="rgba(103,232,249,.35)";
    ctx.strokeRect(px-22, py-78, 44, 6);
    ctx.fillStyle="rgba(103,232,249,.85)";
    ctx.fillRect(px-22, py-78, 44*m, 6);

    ctx.globalAlpha = 1;
  }

  function drawEnemies(){
    for (const e of enemies){
      const ex = e.x|0, ey = e.y|0;

      // shadow
      ctx.fillStyle="rgba(0,0,0,.35)";
      ctx.beginPath();
      ctx.ellipse(ex, ey+6, e.type==="drone"?12:15, 4, 0, 0, Math.PI*2);
      ctx.fill();

      if (e.type === "drone"){
        ctx.fillStyle = "#ffb703";
        ctx.fillRect(ex-16, ey-24, 32, 12);
        ctx.fillStyle = "#fb5607";
        ctx.fillRect(ex+6, ey-20, 8, 4);
        ctx.fillStyle = "rgba(103,232,249,.25)";
        ctx.fillRect(ex-10, ey-30, 20, 4);
      } else if (e.type === "raider"){
        ctx.fillStyle = "#adb5bd";
        ctx.fillRect(ex-12, ey-44, 24, 28);
        ctx.fillStyle = "#6c757d";
        ctx.fillRect(ex-6, ey-58, 12, 12);
        ctx.fillStyle = "#ffd166";
        ctx.fillRect(ex-18, ey-34, 16, 4);
      } else {
        // shield guy
        ctx.fillStyle = "#adb5bd";
        ctx.fillRect(ex-12, ey-48, 24, 32);
        ctx.fillStyle = "#6c757d";
        ctx.fillRect(ex-6, ey-62, 12, 12);
        ctx.fillStyle = "rgba(103,232,249,.28)";
        ctx.fillRect(ex-30, ey-46, 16, 30);
      }
    }
  }

  function drawBoss(){
    if (!boss) return;

    const bx = boss.x|0, by = boss.y|0;

    // shadow
    ctx.fillStyle="rgba(0,0,0,.45)";
    ctx.beginPath();
    ctx.ellipse(bx, by+8, 40, 10, 0, 0, Math.PI*2);
    ctx.fill();

    // body
    ctx.fillStyle = "rgba(231,238,252,.85)";
    ctx.fillRect(bx-boss.w/2, by-boss.h, boss.w, boss.h);

    // face plate
    ctx.fillStyle = "rgba(103,232,249,.25)";
    ctx.fillRect(bx-boss.w/2+20, by-boss.h+26, boss.w-40, 14);

    // HP bar
    const pad = 40;
    const barW = W - pad*2;
    const hp = clamp(boss.hp/boss.maxhp, 0, 1);

    ctx.fillStyle="rgba(0,0,0,.55)";
    ctx.fillRect(pad, 18, barW, 10);
    ctx.fillStyle="rgba(251,113,133,.85)";
    ctx.fillRect(pad, 18, barW*hp, 10);

    ctx.fillStyle="rgba(231,238,252,.9)";
    ctx.font="12px system-ui";
    ctx.fillText("FORECLOSURE KING", pad, 14);
  }

  function drawProjectiles(){
    for (const b of bullets){
      ctx.fillStyle = b.hostile ? "rgba(251,113,133,.95)" : "rgba(255,209,102,.95)";
      ctx.fillRect((b.x-2)|0, (b.y-1)|0, 7, 2);
    }
    for (const g of grenades){
      ctx.fillStyle = "#cfd8ff";
      ctx.beginPath();
      ctx.arc(g.x, g.y, 6, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgba(103,232,249,.55)";
      ctx.fillRect(g.x-2, g.y-12, 4, 8);
    }
  }

  function drawPickups(){
    for (const p of pickups){
      ctx.fillStyle = p.type==="gren" ? "rgba(103,232,249,.95)" : "rgba(52,211,153,.95)";
      ctx.fillRect((p.x-10)|0, (p.y-10)|0, 20, 20);
      ctx.fillStyle="rgba(0,0,0,.35)";
      ctx.fillRect((p.x-7)|0, (p.y-2)|0, 14, 4);
    }
  }

  function drawParticles(){
    for (const p of particles){
      const a = clamp(p.life/620, 0, 1);
      ctx.globalAlpha = a;

      if (p.kind === "smoke"){
        ctx.fillStyle = "rgba(180,200,240,.20)";
        ctx.fillRect((p.x)|0, (p.y)|0, 6, 6);
      } else if (p.kind === "dust"){
        ctx.fillStyle = "rgba(160,120,70,.35)";
        ctx.fillRect((p.x)|0, (p.y)|0, 3, 3);
      } else {
        ctx.fillStyle = "rgba(255,200,120,.85)";
        ctx.fillRect((p.x)|0, (p.y)|0, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function render(){
    // scale to CSS
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);

    ctx.save();
    ctx.scale(sx, sy);

    // screen shake
    if (shake > 0.001){
      const dx = (Math.random()-0.5) * (shake*10);
      const dy = (Math.random()-0.5) * (shake*10);
      ctx.translate(dx, dy);
    }

    ctx.clearRect(0, 0, W, H);

    drawBackground();
    drawPickups();
    drawEnemies();
    drawBoss();
    drawProjectiles();
    drawParticles();
    drawPlayer();

    // flash overlay
    if (flash > 0){
      ctx.fillStyle = `rgba(255,240,200,${clamp(flash/140,0,1)*0.25})`;
      ctx.fillRect(0,0,W,H);
    }

    if (paused){
      ctx.fillStyle="rgba(3,6,12,.65)";
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle="rgba(231,238,252,.9)";
      ctx.font="900 32px system-ui";
      ctx.fillText("PAUSED", W/2-70, H/2-10);
      ctx.font="14px system-ui";
      ctx.fillStyle="rgba(159,176,204,.95)";
      ctx.fillText("Press P to resume", W/2-78, H/2+18);
    }

    ctx.restore();
  }

  function loop(t){
    if (!lastT) lastT = t;
    const dt = Math.min(40, t - lastT);
    lastT = t;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  function start(){
    overlay.style.display = "none";
    running = true;
    paused = false;
    lastT = 0;
    showToast("GO!");
    syncHUD();
  }

  function togglePause(){
    if (!running) return;
    paused = !paused;
    showToast(paused ? "Paused" : "Unpaused");
  }

  function restart(){
    resetAll();
    overlay.style.display = "grid";
    showToast("Restarted");
  }

  function gameOver(){
    running = false;
    paused = false;
    overlay.style.display = "grid";
    overlay.querySelector(".panelTitle").textContent = "Game Over";
    startBtn.textContent = "Restart";
    showToast("Game Over");
  }

  startBtn.addEventListener("click", () => {
    overlay.querySelector(".panelTitle").textContent = "Touch Controls (iPhone)";
    startBtn.textContent = "Start";
    resetAll();
    start();
  });

  // init
  resetAll();
  requestAnimationFrame(loop);
})();
