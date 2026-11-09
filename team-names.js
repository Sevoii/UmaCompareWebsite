// Named teams from Uma Musume media, used as default names for newly saved teams.
// Source: https://umamusu.wiki/Teams_and_Clubs (anime, game main story / Unity Cup,
// Party Dash, and the Star Blossom manga).
export const TEAM_NAMES = [
  // Anime
  'Team Spica', 'Team Rigil', 'Team Canopus', 'Team Capella',
  // Game
  'Team Sirius', 'Team Zenith', 'Team Ascella',
  // Party Dash
  'Team Cosmos', 'Team Freesia', 'Team Rose', 'Team Lily', 'Team Iris', 'Team Geranium', 'Team Primrose',
  // Star Blossom manga
  'Team Alkes', 'Team Hadar', 'Team Regulus', 'Team Aldebaran', 'Team Denebola', 'Team Alphard', 'Team Betelgeuse',
];

/**
 * A random team name not in `taken` (a Set of names already used). Once every name is used,
 * a number is appended ("Team Spica 2", then 3, ...).
 */
export function randomTeamName(taken = new Set(), random = Math.random) {
  for (let round = 1; ; round++) {
    const free = TEAM_NAMES.map((name) => (round === 1 ? name : `${name} ${round}`)).filter((name) => !taken.has(name));
    if (free.length) return free[Math.floor(random() * free.length)];
  }
}
