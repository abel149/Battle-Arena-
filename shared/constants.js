/**
 * @fileoverview Shared constants and protocol definitions for Web3 Battle Arena.
 * Shared across client and server environments.
 */

export const SOCKET_EVENTS = {
  // Authentication & Identity
  IDENTIFY: 'identify',
  PLAYER_REGISTER: 'player:register',
  PLAYER_REGISTERED: 'player:registered',
  PLAYER_PROFILE: 'player:profile',
  PLAYER_ERROR: 'player:error',

  // Matchmaking & Room Management
  MATCH_QUEUE: 'match:queue',
  MATCH_CANCEL: 'match:cancel',
  MATCH_BOT: 'match:bot',
  MATCH_START: 'match:start',
  MATCH_CREATED: 'match:created',
  MATCH_END: 'match:end',
  MATCH_COUNT: 'match:count',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_STATE: 'room:state',

  // Gameplay
  GAME_STATE: 'game:state',
  GAME_MOVE: 'game:move',
  GAME_ERROR: 'game:error',
  SPECTATOR_JOIN: 'spectator:join',

  // Social & Chat
  CHAT_MESSAGE: 'chat:message',
  CHAT_HISTORY: 'chat:history',
};

export const GAME_TYPES = {
  MATH: 'math',
  MEMORY: 'memory',
  CONNECT_FOUR: 'connectfour',
  CYBER_BLASTER: 'blaster',
};

export const CONNECT_FOUR = {
  ROWS: 6,
  COLS: 7,
  WIN_LENGTH: 4,
  EMPTY_CELL: null,
};

export const ENERGY_CONFIG = {
  DEFAULT_MAX_ENERGY: 5,
  MATCH_COST: 1,
  CHORE_REFILL_ENERGY: 2,
};

export const REWARD_CONFIG = {
  WIN_TOKENS: 10,
  WIN_XP: 50,
  DRAW_TOKENS: 3,
  DRAW_XP: 20,
  LOSS_TOKENS: 1,
  LOSS_XP: 10,
  DAILY_BONUS_XP: 15,
  BATTLE_PASS_MATCH_XP: 25,
  BATTLE_PASS_TIER_XP: 100,
  MAX_BATTLE_PASS_TIER: 10,
};

export const TIMING_CONFIG = {
  ANSWER_TIME_LIMIT_SEC: 15,
  BOT_MOVE_MIN_DELAY_MS: 600,
  BOT_MOVE_MAX_DELAY_MS: 1200,
  SPECTATOR_DEBOUNCE_MS: 100,
};

export const BOT_ADDRESS = '0xB07000000000000000000000000000000000000B';
