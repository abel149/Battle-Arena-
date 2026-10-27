// Educational card decks for Memory Match.
// Each pair has two DIFFERENT representations (a, b) that must be
// matched — e.g. a flag and its country name — so kids learn by playing.
// New decks can be added here without touching game logic.

export const DECKS = {
  flags: {
    label: 'Flags & Countries',
    pairs: [
      { a: '🇫🇷', b: 'France' },      { a: '🇯🇵', b: 'Japan' },
      { a: '🇧🇷', b: 'Brazil' },      { a: '🇪🇬', b: 'Egypt' },
      { a: '🇰🇪', b: 'Kenya' },       { a: '🇨🇦', b: 'Canada' },
      { a: '🇮🇳', b: 'India' },       { a: '🇦🇺', b: 'Australia' },
      { a: '🇩🇪', b: 'Germany' },     { a: '🇲🇽', b: 'Mexico' },
      { a: '🇿🇦', b: 'South Africa' },{ a: '🇰🇷', b: 'South Korea' },
    ],
  },
  math: {
    label: 'Math Pairs',
    pairs: [
      { a: '6 × 7', b: '42' },    { a: '9 × 8', b: '72' },
      { a: '12 + 13', b: '25' },  { a: '7²', b: '49' },
      { a: '81 ÷ 9', b: '9' },    { a: '15 × 4', b: '60' },
      { a: '100 − 37', b: '63' }, { a: '11 × 11', b: '121' },
      { a: '56 ÷ 8', b: '7' },    { a: '3!', b: '6' },
    ],
  },
  animals: {
    label: 'Animals & Names',
    pairs: [
      { a: '🦁', b: 'Lion' },     { a: '🐘', b: 'Elephant' },
      { a: '🦒', b: 'Giraffe' },  { a: '🐍', b: 'Snake' },
      { a: '🦈', b: 'Shark' },    { a: '🐧', b: 'Penguin' },
      { a: '🦉', b: 'Owl' },      { a: '🐝', b: 'Bee' },
      { a: '🐳', b: 'Whale' },    { a: '🦊', b: 'Fox' },
    ],
  },
  swahili: {
    label: 'English ↔ Kiswahili',
    pairs: [
      { a: 'Hello', b: 'Jambo' },      { a: 'Thank you', b: 'Asante' },
      { a: 'Water', b: 'Maji' },       { a: 'Friend', b: 'Rafiki' },
      { a: 'Love', b: 'Upendo' },      { a: 'Sun', b: 'Jua' },
      { a: 'Dog', b: 'Mbwa' },         { a: 'Book', b: 'Kitabu' },
      { a: 'School', b: 'Shule' },     { a: 'Star', b: 'Nyota' },
    ],
  },
};

// Deterministic "daily challenge" deck — same for everyone on a given day
export function dailyDeckId() {
  const ids = Object.keys(DECKS);
  const day = Math.floor(Date.now() / 86400000);
  return ids[day % ids.length];
}
