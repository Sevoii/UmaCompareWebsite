/** A character can appear only once in a team, regardless of outfit or build. Empty slots are allowed. */
export function validateTeamMembers(members) {
  const seen = new Set();
  for (const member of members) {
    if (!member) continue;
    const id = String(member.charaId);
    if (seen.has(id)) throw new Error('A team cannot use the same Uma more than once, even in different outfits.');
    seen.add(id);
  }
}
