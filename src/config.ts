/**
 * Centralized balancing configuration for Slime Feast.
 * Every gameplay number lives here so tuning never requires touching systems code.
 *
 * Core rules that must NOT change: 60/40 split, 1.20 consumption threshold,
 * and split portions using the normal size-based speed formula (no bonus).
 */
export const CONFIG = {
  /** Fixed simulation timestep (seconds). */
  SIM_DT: 1 / 60,
  /** Max catch-up steps per rendered frame (prevents spiral of death). */
  MAX_STEPS_PER_FRAME: 5,

  // ── Mass & size ─────────────────────────────────────────────
  STARTING_MASS: 25,
  /** radius = BASE_RADIUS * sqrt(mass / STARTING_MASS) */
  BASE_RADIUS: 20,

  // ── Speed ───────────────────────────────────────────────────
  /** speed = SPEED_BASE * (mass / STARTING_MASS) ^ -SPEED_EXPONENT, clamped. */
  SPEED_BASE: 335,
  SPEED_EXPONENT: 0.27,
  SPEED_MIN: 120,
  SPEED_MAX: 360,
  /** How quickly velocity approaches the desired velocity (1/s). Higher = snappier. */
  ACCEL_RESPONSE: 13,

  // ── Consumption ─────────────────────────────────────────────
  CONSUME_RATIO: 1.2,
  /** Float tolerance on the 1.20 comparison (relative). */
  CONSUME_EPSILON: 1e-9,
  /**
   * Required overlap: prey is eaten when centre distance <= R - r * CONSUME_OVERLAP.
   * 0.1: the prey's centre (plus a 10% margin) must be inside the predator — an edge brush never counts.
   */
  CONSUME_OVERLAP: 0.1,
  /** Fraction of overlap removed per step when two slimes can't eat each other. */
  BUMP_STRENGTH: 0.5,

  // ── Split ───────────────────────────────────────────────────
  MIN_SPLIT_MASS: 100,
  SPLIT_STATIONARY_RATIO: 0.6,
  /** Extra gap (world units) between the two portions' rims right after a split. */
  SPLIT_GAP: 22,
  /**
   * Separation latch: recombination is armed once the rim gap between portions
   * exceeds this distance (i.e. the mobile portion has physically moved away),
   * or after RECOMBINE_LATCH_MAX_TIME seconds — whichever comes first.
   */
  RECOMBINE_LATCH_CLEAR: 26,
  RECOMBINE_LATCH_MAX_TIME: 0.45,
  /** Joystick magnitude that counts as deliberate aiming. */
  AIM_HELD: 0.35,
  /** Aim smoothing time constant (s): ignores the flick when the thumb leaves the stick. */
  AIM_SMOOTH: 0.1,

  // ── Arena ───────────────────────────────────────────────────
  WORLD_WIDTH: 3000,
  WORLD_HEIGHT: 3000,
  DECOR_COUNT: 70,

  // ── Food ────────────────────────────────────────────────────
  FOOD_MASS: 2,
  FOOD_BIG_MASS: 5,
  FOOD_BIG_CHANCE: 0.08,
  FOOD_TARGET: 380,
  /** Pellets respawned per second while below target. */
  FOOD_RESPAWN_RATE: 22,
  /** Extra pellets placed near spawn at run start. */
  FOOD_START_CLUSTER: 60,
  FOOD_RADIUS: 6,
  FOOD_BIG_RADIUS: 10,

  // ── Enemies ─────────────────────────────────────────────────
  ENEMY_COUNT_START: 26,
  ENEMY_COUNT_MAX: 56,
  /** Hard cap for mobile performance. */
  ENEMY_HARD_CAP: 60,
  ENEMY_MIN_MASS: 8,
  /** Enemies move at this fraction of the shared speed formula. */
  ENEMY_SPEED_FACTOR: 0.87,
  ENEMY_SPEED_FACTOR_MAX: 1.0,
  /** Spawn clearance from any player portion = view radius estimate + this. */
  ENEMY_SPAWN_CLEARANCE: 520,
  /** Large predators spawn at least this far from the player at run start. */
  ENEMY_START_PREDATOR_DIST: 1100,
  /** Enemies farther than this from every player portion may be recycled. */
  ENEMY_DESPAWN_DIST: 1500,
  ENEMY_RECYCLE_INTERVAL: 2.5,

  // ── AI ──────────────────────────────────────────────────────
  AI_THINK_MIN: 0.14,
  AI_THINK_MAX: 0.3,
  /** Detection range = AI_DETECT_BASE + radius * AI_DETECT_RADIUS_MULT. */
  AI_DETECT_BASE: 260,
  AI_DETECT_RADIUS_MULT: 3,
  /** Threats are noticed at this multiple of the detection range. */
  AI_FLEE_RANGE_MULT: 0.75,
  /** Max turn rate (radians / s). */
  AI_TURN_RATE: 4.2,
  AI_WALL_MARGIN: 140,
  /** Chance a hunter prefers the player's home portion when it is a valid target. */
  AI_HOME_INTEREST: 0.6,

  // ── Difficulty (seconds) ────────────────────────────────────
  PHASE_HUNT: 25,
  PHASE_SURVIVAL: 75,
  PHASE_ENDLESS: 150,
  /** After PHASE_ENDLESS, pressure keeps rising at this rate per minute (asymptotic). */
  ENDLESS_RAMP_PER_MIN: 0.3,

  // ── Camera ──────────────────────────────────────────────────
  /** World units visible across the narrow screen dimension at starting size. */
  VIEW_SPAN_MIN: 440,
  /** Additional span per unit of player radius. */
  VIEW_SPAN_PER_RADIUS: 6.5,
  VIEW_SPAN_MAX: 2200,
  CAMERA_FOLLOW: 6,
  CAMERA_ZOOM_FOLLOW: 2.2,

  // ── Warnings / indicator ────────────────────────────────────
  HOME_THREAT_DIST: 420,

  // ── Effects ─────────────────────────────────────────────────
  MAX_PARTICLES: 140,
  MAX_DPR: 2,

  // ── Persistence ─────────────────────────────────────────────
  SAVE_INTERVAL: 3,
  SAVE_VERSION: 1,
} as const;

export type Config = typeof CONFIG;
