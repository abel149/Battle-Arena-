/**
 * @file cyber-blaster.js
 * @description Cyber Blaster Arena 2D top-down cyberpunk duel shooter game engine.
 * Real-time physics engine featuring obstacle cover collision, powerup pickups,
 * projectile trajectory simulation, skin-based laser styles, round resets,
 * and multi-tiered tactical bot AI (easy, medium, hard).
 */

const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 600;
const PLAYER_RADIUS = 18;
const BULLET_RADIUS = 5;
const BULLET_SPEED = 14;
const BULLET_DAMAGE = 20;
const BASE_SPEED = 4.5;
const DASH_DISTANCE = 70;
const DASH_COOLDOWN_MS = 3000;
const SHOOT_COOLDOWN_MS = 350;
const OVERCHARGE_COOLDOWN_MS = 180;
const ROUNDS_TO_WIN = 2; // Best of 3 rounds

/**
 * Static map obstacles defining boundary cover pillars in the arena.
 * @constant {Array<{x: number, y: number, w: number, h: number}>}
 */
export const OBSTACLES = [
  { x: 180, y: 140, w: 50, h: 100 },
  { x: 570, y: 140, w: 50, h: 100 },
  { x: 180, y: 360, w: 50, h: 100 },
  { x: 570, y: 360, w: 50, h: 100 },
  { x: 375, y: 260, w: 50, h: 80 },  // Central cyber pillar
];

const POWERUP_TYPES = ['shield', 'overcharge', 'speed', 'heal'];

/**
 * Detects 2D Axis-Aligned Bounding Box (AABB) collision against a circle.
 *
 * @function boxCircleCollision
 * @param {{x: number, y: number, w: number, h: number}} box - Rectangular obstacle box.
 * @param {number} cx - Circle center X coordinate.
 * @param {number} cy - Circle center Y coordinate.
 * @param {number} radius - Circle radius.
 * @returns {boolean} True if circle overlaps with bounding box.
 */
function boxCircleCollision(box, cx, cy, radius) {
  const closestX = Math.max(box.x, Math.min(cx, box.x + box.w));
  const closestY = Math.max(box.y, Math.min(cy, box.y + box.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Checks whether a given circular coordinate overlaps with any arena obstacle.
 *
 * @function collidesWithObstacles
 * @param {number} x - Target center X.
 * @param {number} y - Target center Y.
 * @param {number} radius - Target radius.
 * @returns {boolean} True if target collides with any obstacle.
 */
function collidesWithObstacles(x, y, radius) {
  for (const obs of OBSTACLES) {
    if (boxCircleCollision(obs, x, y, radius)) return true;
  }
  return false;
}

/**
 * Restricts a numeric value within a minimum and maximum range.
 *
 * @function clamp
 * @param {number} val - Value to clamp.
 * @param {number} min - Lower boundary.
 * @param {number} max - Upper boundary.
 * @returns {number} Clamped value.
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Resets player coordinates, health, modifiers, bullets, and powerups for a new round.
 *
 * @function resetRoundPositions
 * @param {Object} game - Mutable game state object.
 */
function resetRoundPositions(game) {
  game.pState.X.x = 100;
  game.pState.X.y = 300;
  game.pState.X.vx = 0;
  game.pState.X.vy = 0;
  game.pState.X.angle = 0;
  game.pState.X.hp = 100;
  game.pState.X.shield = 0;
  game.pState.X.speedBoostUntil = 0;
  game.pState.X.overchargeUntil = 0;
  game.pState.X.lastShot = 0;
  game.pState.X.lastDash = 0;

  game.pState.O.x = 700;
  game.pState.O.y = 300;
  game.pState.O.vx = 0;
  game.pState.O.vy = 0;
  game.pState.O.angle = Math.PI;
  game.pState.O.hp = 100;
  game.pState.O.shield = 0;
  game.pState.O.speedBoostUntil = 0;
  game.pState.O.overchargeUntil = 0;
  game.pState.O.lastShot = 0;
  game.pState.O.lastDash = 0;

  game.bullets = [];
  game.powerups = [];
  game.nextPowerupAt = Date.now() + 6000;
}

/**
 * Initializes a new Cyber Blaster Arena match instance.
 *
 * @function createGame
 * @param {string} addrX - Player 1 (X) wallet address.
 * @param {string} addrO - Player 2 (O) wallet address.
 * @param {Object} [opts={}] - Optional match parameters.
 * @param {'easy'|'medium'|'hard'} [opts.difficulty='medium'] - Bot difficulty.
 * @param {Object} [opts.skins] - Cosmetic skin IDs ({ X: string, O: string }).
 * @param {number} [opts.targetWins=2] - Round wins required to win match.
 * @returns {Object} New game state object.
 */
export function createGame(addrX, addrO, opts = {}) {
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';

  const skins = {
    X: opts?.skins?.X || opts?.skinX || 'neon-striker',
    O: opts?.skins?.O || opts?.skinO || 'neon-striker',
  };

  const game = {
    players: { X: addrX, O: addrO },
    difficulty,
    skins,
    targetWins: opts?.targetWins || ROUNDS_TO_WIN,
    score: { X: 0, O: 0 },
    round: 1,
    winner: null,
    pState: {
      X: {
        x: 100, y: 300, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100,
        shield: 0, speedBoostUntil: 0, overchargeUntil: 0, lastShot: 0, lastDash: 0,
      },
      O: {
        x: 700, y: 300, vx: 0, vy: 0, angle: Math.PI, hp: 100, maxHp: 100,
        shield: 0, speedBoostUntil: 0, overchargeUntil: 0, lastShot: 0, lastDash: 0,
      },
    },
    bullets: [],
    powerups: [],
    events: [],
    nextPowerupAt: Date.now() + 6000,
    moves: [],
    lastTick: Date.now(),
  };

  return game;
}

/**
 * Handles directional velocity, aim orientation, dash, and firing moves from players.
 *
 * @function applyMove
 * @param {Object} game - Game state.
 * @param {string} address - Player wallet address.
 * @param {Object} move - Input move payload.
 * @param {string} [move.type] - Move type ('input' or 'dash').
 * @param {number} [move.vx] - Horizontal movement vector (-1 to 1).
 * @param {number} [move.vy] - Vertical movement vector (-1 to 1).
 * @param {number} [move.angle] - Aim angle in radians.
 * @param {boolean} [move.dash] - Flag indicating dash activation.
 * @param {boolean} [move.shoot] - Flag indicating bullet fire.
 * @returns {{ok?: boolean, error?: string}} Move outcome.
 */
export function applyMove(game, address, move) {
  if (game.winner) return { error: 'Game already finished' };
  const seat = game.players.X === address ? 'X' : game.players.O === address ? 'O' : null;
  if (!seat) return { error: 'Not a player in this match' };

  const now = Date.now();
  const p = game.pState[seat];

  if (move?.type === 'input') {
    // Movement inputs: vx (-1 to 1), vy (-1 to 1), angle in radians
    const rawVx = Number(move.vx) || 0;
    const rawVy = Number(move.vy) || 0;
    const len = Math.hypot(rawVx, rawVy);
    if (len > 0) {
      p.vx = (rawVx / len);
      p.vy = (rawVy / len);
    } else {
      p.vx = 0;
      p.vy = 0;
    }

    if (typeof move.angle === 'number' && !isNaN(move.angle)) {
      p.angle = move.angle;
    }

    // Dash
    if (move.dash && now - p.lastDash >= DASH_COOLDOWN_MS) {
      p.lastDash = now;
      const dashAngle = len > 0 ? Math.atan2(p.vy, p.vx) : p.angle;
      const targetX = clamp(p.x + Math.cos(dashAngle) * DASH_DISTANCE, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS);
      const targetY = clamp(p.y + Math.sin(dashAngle) * DASH_DISTANCE, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS);
      if (!collidesWithObstacles(targetX, targetY, PLAYER_RADIUS)) {
        p.x = targetX;
        p.y = targetY;
        game.events.push({ type: 'dash', seat, x: p.x, y: p.y, t: now });
      }
    }

    // Shoot
    if (move.shoot) {
      const isOvercharged = now < p.overchargeUntil;
      const cooldown = isOvercharged ? OVERCHARGE_COOLDOWN_MS : SHOOT_COOLDOWN_MS;
      if (now - p.lastShot >= cooldown) {
        p.lastShot = now;
        const skinId = game.skins[seat];
        const bx = p.x + Math.cos(p.angle) * (PLAYER_RADIUS + 6);
        const by = p.y + Math.sin(p.angle) * (PLAYER_RADIUS + 6);
        const b = {
          id: `b_${seat}_${now}_${Math.random().toString(36).substring(2, 6)}`,
          seat,
          x: bx,
          y: by,
          vx: Math.cos(p.angle) * BULLET_SPEED,
          vy: Math.sin(p.angle) * BULLET_SPEED,
          skinId,
          bornAt: now,
          lifeTicks: 0,
        };
        game.bullets.push(b);
        game.events.push({ type: 'shoot', seat, x: bx, y: by, angle: p.angle, skinId, t: now });
      }
    }

    return { ok: true };
  }

  // Direct action moves (e.g. from bot or specific calls)
  if (move?.type === 'dash') {
    if (now - p.lastDash >= DASH_COOLDOWN_MS) {
      p.lastDash = now;
      const targetX = clamp(p.x + Math.cos(p.angle) * DASH_DISTANCE, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS);
      const targetY = clamp(p.y + Math.sin(p.angle) * DASH_DISTANCE, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS);
      if (!collidesWithObstacles(targetX, targetY, PLAYER_RADIUS)) {
        p.x = targetX;
        p.y = targetY;
        game.events.push({ type: 'dash', seat, x: p.x, y: p.y, t: now });
      }
    }
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Advance physics simulation step by dtMs: updates player coordinates, spawns powerups,
 * translates bullets, resolves bullet hits and player damage, and triggers round end.
 *
 * @function tick
 * @param {Object} game - Mutable game state.
 * @param {number} [dtMs=40] - Delta time in milliseconds.
 * @returns {{events: Array<Object>}} Simulation events emitted during this tick.
 */
export function tick(game, dtMs = 40) {
  if (game.winner) return { events: [] };
  const now = Date.now();
  const tickEvents = [];

  // 1. Update player positions
  for (const seat of ['X', 'O']) {
    const p = game.pState[seat];
    const isSpeedBoosted = now < p.speedBoostUntil;
    const speed = isSpeedBoosted ? BASE_SPEED * 1.45 : BASE_SPEED;

    const nextX = clamp(p.x + p.vx * speed, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS);
    const nextY = clamp(p.y + p.vy * speed, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS);

    if (!collidesWithObstacles(nextX, p.y, PLAYER_RADIUS)) {
      p.x = nextX;
    }
    if (!collidesWithObstacles(p.x, nextY, PLAYER_RADIUS)) {
      p.y = nextY;
    }
  }

  // 2. Spawn powerups
  if (now >= game.nextPowerupAt && game.powerups.length < 2) {
    const pType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const px = Math.floor(Math.random() * 260) + 270; // 270 - 530
    const py = Math.floor(Math.random() * 240) + 180; // 180 - 420
    if (!collidesWithObstacles(px, py, 15)) {
      const pow = { id: `pow_${now}`, type: pType, x: px, y: py, r: 14 };
      game.powerups.push(pow);
      tickEvents.push({ type: 'powerup_spawn', powerup: pow });
    }
    game.nextPowerupAt = now + Math.floor(Math.random() * 6000) + 9000;
  }

  // 3. Player powerup pickups
  for (let i = game.powerups.length - 1; i >= 0; i--) {
    const pow = game.powerups[i];
    for (const seat of ['X', 'O']) {
      const p = game.pState[seat];
      const dist = Math.hypot(p.x - pow.x, p.y - pow.y);
      if (dist < PLAYER_RADIUS + pow.r) {
        if (pow.type === 'shield') p.shield = 1;
        else if (pow.type === 'overcharge') p.overchargeUntil = now + 8000;
        else if (pow.type === 'speed') p.speedBoostUntil = now + 8000;
        else if (pow.type === 'heal') p.hp = Math.min(p.maxHp, p.hp + 25);

        tickEvents.push({ type: 'powerup_collect', seat, powerupType: pow.type, x: pow.x, y: pow.y });
        game.powerups.splice(i, 1);
        break;
      }
    }
  }

  // 4. Update bullets & check collisions
  for (let i = game.bullets.length - 1; i >= 0; i--) {
    const b = game.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    b.lifeTicks += 1;

    // Out of bounds
    if (b.x < 0 || b.x > ARENA_WIDTH || b.y < 0 || b.y > ARENA_HEIGHT || b.lifeTicks > 55) {
      game.bullets.splice(i, 1);
      continue;
    }

    // Obstacle hit
    if (collidesWithObstacles(b.x, b.y, BULLET_RADIUS)) {
      tickEvents.push({ type: 'bullet_impact', x: b.x, y: b.y, obstacle: true });
      game.bullets.splice(i, 1);
      continue;
    }

    // Opponent player hit
    const targetSeat = b.seat === 'X' ? 'O' : 'X';
    const target = game.pState[targetSeat];
    const distToTarget = Math.hypot(b.x - target.x, b.y - target.y);

    if (distToTarget < PLAYER_RADIUS + BULLET_RADIUS) {
      if (target.shield > 0) {
        target.shield = 0;
        tickEvents.push({ type: 'shield_absorb', seat: targetSeat, x: target.x, y: target.y });
      } else {
        target.hp = Math.max(0, target.hp - BULLET_DAMAGE);
        tickEvents.push({
          type: 'player_hit',
          targetSeat,
          damage: BULLET_DAMAGE,
          hpRemaining: target.hp,
          x: target.x,
          y: target.y,
          shooterSeat: b.seat,
        });
      }
      game.bullets.splice(i, 1);

      // Check KO / Round winner
      if (target.hp <= 0) {
        const roundWinner = b.seat;
        game.score[roundWinner] += 1;
        tickEvents.push({
          type: 'round_end',
          roundWinner,
          score: { ...game.score },
          round: game.round,
        });

        if (game.score[roundWinner] >= game.targetWins) {
          game.winner = roundWinner; // 'X' or 'O'
          tickEvents.push({ type: 'match_end', winner: roundWinner });
        } else {
          game.round += 1;
          resetRoundPositions(game);
        }
        break;
      }
    }
  }

  game.events.push(...tickEvents);
  if (game.events.length > 50) game.events.splice(0, game.events.length - 50);

  return { events: tickEvents };
}

/**
 * Generates an automated combat decision for bot opponent including predictive aiming,
 * strafing, bullet dodging, and tactical powerup pickups.
 *
 * @function botMove
 * @param {Object} game - Game state.
 * @param {'easy'|'medium'|'hard'} [difficulty] - Bot tactical intelligence level.
 * @returns {Object} Move input object.
 */
export function botMove(game, difficulty = game.difficulty || 'medium') {
  const botSeat = 'O';
  const playerSeat = 'X';
  const bot = game.pState[botSeat];
  const player = game.pState[playerSeat];
  const now = Date.now();

  let targetAngle = Math.atan2(player.y - bot.y, player.x - bot.x);
  let shouldShoot = false;
  let moveX = 0;
  let moveY = 0;
  let shouldDash = false;

  // 1. Difficulty-based aim accuracy and predictive shooting
  if (difficulty === 'easy') {
    // 35% chance to wander or aim with wide jitter
    targetAngle += (Math.random() - 0.5) * 0.7;
    shouldShoot = Math.random() < 0.08;
    moveX = Math.random() > 0.4 ? (player.x > bot.x ? 0.6 : -0.6) : 0;
    moveY = Math.random() > 0.4 ? (player.y > bot.y ? 0.6 : -0.6) : 0;
  } else if (difficulty === 'medium') {
    // Slight jitter, shoots when roughly aligned
    targetAngle += (Math.random() - 0.5) * 0.2;
    const dist = Math.hypot(player.x - bot.x, player.y - bot.y);
    shouldShoot = Math.random() < 0.22 && dist < 550;

    // Move toward powerup if one is active, otherwise strafe
    if (game.powerups.length > 0) {
      const pow = game.powerups[0];
      moveX = pow.x > bot.x ? 1 : -1;
      moveY = pow.y > bot.y ? 1 : -1;
    } else {
      // Keep distance, strafe around player
      const idealDist = 320;
      if (dist < idealDist) {
        moveX = bot.x > player.x ? 1 : -1;
        moveY = bot.y > player.y ? 1 : -1;
      } else {
        moveX = Math.cos(targetAngle + Math.PI / 2);
        moveY = Math.sin(targetAngle + Math.PI / 2);
      }
    }
  } else {
    // Hard: Lead target, dodge incoming bullets, aggressively take powerups
    const dist = Math.hypot(player.x - bot.x, player.y - bot.y);
    const flightTime = dist / BULLET_SPEED;
    // Lead target with player's current velocity
    const leadX = player.x + player.vx * flightTime * BASE_SPEED;
    const leadY = player.y + player.vy * flightTime * BASE_SPEED;
    targetAngle = Math.atan2(leadY - bot.y, leadX - bot.x);
    shouldShoot = Math.random() < 0.35;

    // Bullet dodging
    let bulletThreat = null;
    for (const b of game.bullets) {
      if (b.seat === playerSeat) {
        const d = Math.hypot(b.x - bot.x, b.y - bot.y);
        if (d < 160) {
          bulletThreat = b;
          break;
        }
      }
    }

    if (bulletThreat) {
      // Strafe perpendicular to bullet trajectory
      const bAngle = Math.atan2(bulletThreat.vy, bulletThreat.vx);
      moveX = Math.cos(bAngle + Math.PI / 2);
      moveY = Math.sin(bAngle + Math.PI / 2);
      if (Math.hypot(bulletThreat.x - bot.x, bulletThreat.y - bot.y) < 70) {
        shouldDash = true;
      }
    } else if (game.powerups.length > 0) {
      const pow = game.powerups[0];
      moveX = pow.x > bot.x ? 1 : -1;
      moveY = pow.y > bot.y ? 1 : -1;
    } else {
      // Tactical kiting
      if (bot.hp < 40) {
        // Retreat to cover pillar
        const safePillar = OBSTACLES[1]; // top right pillar
        moveX = safePillar.x > bot.x ? 1 : -1;
        moveY = safePillar.y > bot.y ? 1 : -1;
      } else {
        moveX = Math.cos(targetAngle + Math.PI / 2.3);
        moveY = Math.sin(targetAngle + Math.PI / 2.3);
      }
    }
  }

  return {
    type: 'input',
    vx: moveX,
    vy: moveY,
    angle: targetAngle,
    shoot: shouldShoot,
    dash: shouldDash,
  };
}

/**
 * Serializes the complete Cyber Blaster state including static arena geometry.
 *
 * @function serialize
 * @param {Object} game - Game state.
 * @returns {Object} Full client-safe state.
 */
export function serialize(game) {
  return {
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    obstacles: OBSTACLES,
    players: game.players,
    skins: game.skins,
    score: game.score,
    round: game.round,
    targetWins: game.targetWins,
    winner: game.winner,
    pState: {
      X: {
        x: Math.round(game.pState.X.x),
        y: Math.round(game.pState.X.y),
        angle: Number(game.pState.X.angle.toFixed(3)),
        hp: game.pState.X.hp,
        shield: game.pState.X.shield,
        speedBoost: Date.now() < game.pState.X.speedBoostUntil,
        overcharged: Date.now() < game.pState.X.overchargeUntil,
      },
      O: {
        x: Math.round(game.pState.O.x),
        y: Math.round(game.pState.O.y),
        angle: Number(game.pState.O.angle.toFixed(3)),
        hp: game.pState.O.hp,
        shield: game.pState.O.shield,
        speedBoost: Date.now() < game.pState.O.speedBoostUntil,
        overcharged: Date.now() < game.pState.O.overchargeUntil,
      },
    },
    bullets: game.bullets.map(b => ({
      id: b.id,
      seat: b.seat,
      x: Math.round(b.x),
      y: Math.round(b.y),
      skinId: b.skinId,
    })),
    powerups: game.powerups,
    events: game.events.slice(-10),
  };
}

/**
 * Lightweight serializer for high-frequency (25Hz) real-time game tick broadcasts.
 * Omits static arena boundaries and obstacles to minimize network bandwidth.
 *
 * @function serializeTick
 * @param {Object} game - Game state.
 * @returns {Object} Compact tick payload.
 */
export function serializeTick(game) {
  return {
    score: game.score,
    round: game.round,
    winner: game.winner,
    pState: {
      X: {
        x: Math.round(game.pState.X.x),
        y: Math.round(game.pState.X.y),
        angle: Number(game.pState.X.angle.toFixed(3)),
        hp: game.pState.X.hp,
        shield: game.pState.X.shield,
        speedBoost: Date.now() < game.pState.X.speedBoostUntil,
        overcharged: Date.now() < game.pState.X.overchargeUntil,
      },
      O: {
        x: Math.round(game.pState.O.x),
        y: Math.round(game.pState.O.y),
        angle: Number(game.pState.O.angle.toFixed(3)),
        hp: game.pState.O.hp,
        shield: game.pState.O.shield,
        speedBoost: Date.now() < game.pState.O.speedBoostUntil,
        overcharged: Date.now() < game.pState.O.overchargeUntil,
      },
    },
    bullets: game.bullets.map(b => ({
      id: b.id,
      seat: b.seat,
      x: Math.round(b.x),
      y: Math.round(b.y),
      skinId: b.skinId,
    })),
    powerups: game.powerups,
    events: game.events.slice(-10),
  };
}
