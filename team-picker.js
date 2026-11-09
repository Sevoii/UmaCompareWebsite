// "Saved Teams" modal: lists the roster's teams (favorites first). Click a team to select it;
// each card also has favorite / rename / delete icons. Search, import-from-file and close live
// in the header. Uses the <dialog id="teamPicker"> in index.html.
import { umaLabel } from './globalsim/index.js';
import { loadTeam, strategyName } from './compare.js';
import { teamFromFile } from './team-import.js';
import { hakurakuTeamName, importHakurakuTeam } from './hakuraku-import.js';
import { OUTFITS } from './outfits.js';

// GitHub Octicons (MIT), 16px.
const svg = (path, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
export const ICONS = {
  starOutline: svg('M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z', 'uc-star-outline'),
  starFill: svg('M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z', 'uc-star-fill'),
  pencil: svg('M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z'),
  trash: svg('M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z'),
  arrowSwitch: svg('M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3Zm5.56-6.5a.75.75 0 1 1-1.06-1.06l1.72-1.72H2.75a.75.75 0 0 1 0-1.5h8.69L9.72 2.28a.75.75 0 0 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3Z'),
  // Bootstrap Icons "floppy" (MIT).
  save: svg('M11 2H9v3h2zM1.5 0h11.586a1.5 1.5 0 0 1 1.06.44l1.415 1.414A1.5 1.5 0 0 1 16 2.914V14.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5v-13A1.5 1.5 0 0 1 1.5 0M1 1.5v13a.5.5 0 0 0 .5.5H2v-4.5A1.5 1.5 0 0 1 3.5 9h9a1.5 1.5 0 0 1 1.5 1.5V15h.5a.5.5 0 0 0 .5-.5V2.914a.5.5 0 0 0-.146-.353l-1.415-1.415A.5.5 0 0 0 13.086 1H13v4.5A1.5 1.5 0 0 1 11.5 7h-7A1.5 1.5 0 0 1 3 5.5V1H1.5a.5.5 0 0 0-.5.5m3 4a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V1H4zM3 15h10v-4.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5z'),
  copy: svg('M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z'),
  arrowLeft: svg('M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z'),
  x: svg('M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z'),
};

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Display name and strategy for a runner JSON. */
export function memberInfo(data) {
  let name;
  try { name = umaLabel(data.charaId); } catch { name = `Uma ${data.charaId}`; }
  let strategy;
  try { strategy = strategyName(data.strategy); } catch { strategy = String(data.strategy ?? ''); }
  return { name, strategy };
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Bump when the portrait images change, so browsers don't keep showing cached old ones.
const ICON_VERSION = 'umalator-2';

/** A costume's portrait (umalator's framed icon). */
export const outfitIconUrl = (outfitId) => `./assets/outfit_icons/${Number(outfitId)}.webp?v=${ICON_VERSION}`;

/**
 * Default portrait for a character: umalator's icon for its first costume, or its plain
 * character icon if it has no costume data.
 */
export function umaIconUrl(charaId) {
  const first = outfitsOf(charaId).find((o) => o.icon);
  return first ? outfitIconUrl(first.id) : `./assets/uma_icons/chr_icon_${Number(charaId)}.webp?v=${ICON_VERSION}`;
}

// ---- costumes (outfits) ----
// An outfit id is CCCCNN: charaId + the costume number. Its 3★+ unique skill is
// 1 (NN-1) CCC 1, e.g. outfit 101102 -> 110111 (the rule umalator uses).

/** The costumes a character has (see outfits.js), oldest first. */
export const outfitsOf = (charaId) => OUTFITS[charaId] ?? [];

/** The unique skill id of an outfit. */
export function uniqueForOutfit(outfitId) {
  const s = String(outfitId);
  return String(100000 + 10000 * (Number(s.slice(-2)) - 1) + Number(s.slice(1, -2)) * 10 + 1);
}

/** The outfit a unique skill belongs to (6-digit 3★+ uniques, or the older 5-digit ones). */
export function outfitForUnique(skillId) {
  const s = String(skillId ?? '');
  if (s.length === 6 && s[0] === '1' && s[5] === '1') return 100000 + Number(s.slice(2, 5)) * 100 + Number(s[1]) + 1;
  if (s.length === 5 && s[0] === '1' && s[4] === '1') return Math.floor(Number(s) / 10) * 100 + (Number(s) % 10);
  return null;
}

/**
 * An uma's costume: its `outfitId` field if it has one, else worked out from its unique skill,
 * or null if neither identifies one of the character's outfits.
 */
export function outfitOf(data) {
  const list = outfitsOf(data.charaId);
  const find = (id) => (id == null ? undefined : list.find((o) => o.id === Number(id)));
  return find(data.outfitId) ?? find(outfitForUnique(data.skills?.find?.((s) => s.isUnique)?.skillId)) ?? null;
}

/** Portrait for an uma: its costume's icon when known, else the character's default one. */
export function portraitUrl(data) {
  const outfit = outfitOf(data);
  return outfit?.icon ? outfitIconUrl(outfit.id) : umaIconUrl(data.charaId);
}

// [runner JSON field, short label, full name, icon in assets/stats/]
const STATS = [
  ['speed', 'Spd', 'Speed', 'speed'], ['stamina', 'Sta', 'Stamina', 'stamina'], ['power', 'Pow', 'Power', 'power'],
  ['guts', 'Gut', 'Guts', 'guts'], ['wisdom', 'Wit', 'Wit', 'wit'],
];
// [runner JSON field, short label, full name]
const APTITUDES = [
  ['surfaceAptitude', 'Surf', 'Surface'], ['distanceAptitude', 'Dist', 'Distance'], ['strategyAptitude', 'Style', 'Style'],
];

/** An aptitude grade drawn with the game's letter glyph (assets/grades/<letter>.webp). */
const gradeHtml = (grade) => {
  const letter = String(grade);
  if (!/^[SABCDEFG]$/.test(letter)) return '<b class="uc-grade uc-grade-none">?</b>';
  return `<img class="uc-grade" src="./assets/grades/${letter}.webp" alt="${letter}" title="${letter}">`;
};

/**
 * Inner HTML of an uma chip (runner JSON): portrait, display name, strategy, the five stats
 * and the three aptitudes. `nickname` is the uma's saved nickname; without one the character's
 * name is shown. The badge holds the uma's initials under the portrait; if the image is missing
 * it removes itself and the initials show instead.
 */
export function umaChipBody(data, nickname = null) {
  const { name: character, strategy } = memberInfo(data);
  const name = nickname || character;
  const subtitle = name === character ? strategy : `${strategy} · ${character}`;
  const outfit = outfitOf(data);
  const fullName = outfit ? `${outfit.epithet} ${character}` : character; // hover text: costume + character
  const stats = STATS.map(([field, label, full, icon]) =>
    `<div title="${full}"><dt><img src="./assets/stats/${icon}.webp" alt="${full}"><span>${label}</span></dt><dd>${escapeHtml(data[field] ?? '–')}</dd></div>`).join('');
  const aptitudes = APTITUDES.map(([field, label, full]) =>
    `<div title="${full} ${escapeHtml(data[field] ?? '?')}"><dt>${label}</dt><dd>${gradeHtml(data[field])}</dd></div>`).join('');
  return `<div class="uc-member-head">
      <span class="uc-member-badge" title="${escapeHtml(fullName)}">${escapeHtml(initials(character))}<img src="${portraitUrl(data)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>
      <span class="uc-member-title"><strong title="${escapeHtml(name === character ? fullName : name)}">${escapeHtml(name)}</strong><small title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</small></span>
      <dl class="uc-member-apts">${aptitudes}</dl>
    </div>
    <dl class="uc-member-stats">${stats}</dl>`;
}

/** Display name of an uma: its nickname, else its character's name. */
export const umaDisplayName = (data, nickname = null) => nickname || memberInfo(data).name;

/**
 * <li> chips for a team's members (runner JSON, or null for an empty slot). `names[k]` is
 * member k's nickname. With `pickable`, every slot carries data-index=k: empty slots are
 * "Add Uma" buttons (data-action="pick-uma") and filled chips open the editor
 * (data-action="edit-uma").
 */
export function memberChipsHtml(members, names = [], { pickable = false } = {}) {
  return members.map((data, k) => {
    if (!data) {
      const pick = pickable ? ` data-action="pick-uma" data-index="${k}"` : '';
      return `<li><button type="button" class="uc-add-uma"${pick}><span aria-hidden="true">+</span><strong>Add Uma</strong></button></li>`;
    }
    const label = escapeHtml(umaDisplayName(data, names[k]));
    const attrs = pickable
      ? ` data-action="edit-uma" data-index="${k}" tabindex="0" role="button" title="Click to edit, right-click to remove" aria-label="Edit ${label}"`
      : '';
    // Pickable chips also get a corner ✕ that empties the slot (data-action="clear-uma").
    const clear = pickable
      ? `<button type="button" class="uc-chip-clear" data-action="clear-uma" data-index="${k}" title="Remove uma" aria-label="Remove ${label}">${ICONS.x}</button>`
      : '';
    return `<li class="uc-member${pickable ? ' uc-member-pickable' : ''}"${attrs}>${clear}${umaChipBody(data, names[k])}</li>`;
  }).join('');
}

export const teamDisplayName = (team) => team.name || 'Unnamed team';

/**
 * Swap `label` for a text box to rename a saved team. Enter or leaving the box saves (the
 * roster's onChange listeners re-render); Escape, or an unchanged name, calls `onCancel`
 * so the caller can put the label back.
 */
export function renameSavedTeam(roster, id, label, { onCancel, onError = console.error }) {
  const team = roster.team(id);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm uc-rename-input';
  input.value = team.name ?? '';
  input.placeholder = 'Team name';
  input.setAttribute('aria-label', 'Team name');
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim() || null;
    if (input.isConnected) input.replaceWith(label); // put the label back before anything re-renders
    if (save && roster.team(id) && name !== (team.name ?? null)) {
      try { roster.renameTeam(id, name); } catch (error) { onError(error.message); onCancel(); }
    } else {
      onCancel();
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  return input;
}

/**
 * Wire the modal. `onSelect(slot, teamId)` (slot = index of the team box) runs when a team is
 * picked; the modal then closes. Returns { open(slot) }.
 */
export function createTeamPicker({ roster, onSelect, preferCm = null }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('teamPicker');
  const list = $('teamPickerList');
  const search = $('teamPickerSearch');
  const count = $('teamPickerCount');
  const fileInput = $('teamPickerFile');
  const errorBox = $('teamPickerError');
  let slot = null;
  let renaming = null; // team id whose name is being edited

  const showError = (message) => {
    errorBox.textContent = message ?? '';
    errorBox.hidden = !message;
  };

  /** Lower-case text a search matches against: team name, uma names and uma nicknames. */
  function haystack(team) {
    const parts = [teamDisplayName(team)];
    for (const id of team.members) {
      const uma = roster.uma(id);
      if (!uma) continue;
      if (uma.name) parts.push(uma.name);
      parts.push(memberInfo(uma.data).name);
    }
    return parts.join('\n').toLowerCase();
  }

  function cardHtml(team) {
    const umas = team.members.map((id) => roster.uma(id)).filter(Boolean);
    const members = umas.map((uma) => uma.data);
    const names = umas.map((uma) => uma.name);
    const name = escapeHtml(teamDisplayName(team));
    const favoriteLabel = team.favorite ? 'Unfavorite' : 'Favorite';
    return `<article class="uc-team uc-picker-team" data-id="${team.id}" tabindex="0" aria-label="Select ${name}">
      <header>
        <span class="uc-team-name uc-renamable" data-action="rename" tabindex="0" role="button"
          title="${name} (click to rename)" aria-label="Rename ${name}">${name}</span>
        <div class="uc-team-actions">
          <button type="button" class="uc-icon-button uc-star" data-action="favorite" aria-pressed="${Boolean(team.favorite)}"
            title="${favoriteLabel}" aria-label="${favoriteLabel} ${name}">${ICONS.starOutline}${ICONS.starFill}</button>
          <button type="button" class="uc-icon-button uc-delete" data-action="delete" title="Delete" aria-label="Delete ${name}">${ICONS.trash}</button>
        </div>
      </header>
      <ul class="uc-team-slots">${memberChipsHtml(members, names)}</ul>
    </article>`;
  }

  function render() {
    renaming = null;
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const all = roster.teams({ favoritesFirst: true });
    const shown = terms.length ? all.filter((team) => {
      const text = haystack(team);
      return terms.every((term) => text.includes(term));
    }) : all;
    const noun = (n) => `${n} team${n === 1 ? '' : 's'}`;
    count.textContent = terms.length ? `${shown.length} of ${noun(all.length)}` : noun(all.length);
    if (!all.length) {
      list.innerHTML = '<p class="uc-picker-empty">No saved teams yet. Use <strong>Import from hakuraku</strong> or <strong>Import from file</strong> to add one.</p>';
    } else if (!shown.length) {
      list.innerHTML = '<p class="uc-picker-empty">No teams match your search.</p>';
    } else {
      list.innerHTML = shown.map(cardHtml).join('');
    }
  }

  function select(id) {
    onSelect(slot, id);
    dialog.close();
  }

  function startRename(card, id) {
    renaming = id;
    renameSavedTeam(roster, id, card.querySelector('.uc-team-name'), { onCancel: render, onError: showError });
  }

  list.addEventListener('click', (event) => {
    const card = event.target.closest('.uc-picker-team');
    if (!card) return;
    const id = card.dataset.id;
    const team = roster.team(id);
    if (!team) return;
    if (event.target.closest('input')) return; // clicks inside the rename box
    const button = event.target.closest('[data-action]'); // an icon button, or the name (rename)
    showError(null);
    try {
      if (!button) {
        select(id); // a click anywhere else on the card
      } else if (button.dataset.action === 'favorite') {
        roster.toggleFavoriteTeam(id);
      } else if (button.dataset.action === 'rename') {
        startRename(card, id);
      } else if (button.dataset.action === 'delete') {
        if (confirm(`Delete "${teamDisplayName(team)}"? Its umas stay saved.`)) roster.removeTeam(id);
      }
    } catch (error) {
      showError(error.message);
    }
  });

  // Keyboard: Enter or Space on a focused card selects it; on a focused name, renames.
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (target.dataset?.action === 'rename') {
      event.preventDefault();
      const card = target.closest('.uc-picker-team');
      startRename(card, card.dataset.id);
    } else if (target.classList?.contains('uc-picker-team')) {
      event.preventDefault();
      select(target.dataset.id);
    }
  });

  search.addEventListener('input', render);

  $('teamPickerImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const problems = [];
    for (const file of fileInput.files) {
      const name = file.name.replace(/\.json$/i, '');
      try {
        const team = teamFromFile(JSON.parse(await file.text()), name); // validates every member
        await roster.importTeam(team, { name });
      } catch (error) {
        problems.push(`${file.name}: ${error.message}`);
      }
    }
    fileInput.value = '';
    showError(problems.length ? problems.join('\n') : null);
  });

  // ---- Import from hakuraku: paste a hakuraku.moe UmaLogs team link ----
  const hkForm = $('teamPickerHakuraku');
  const hkLink = $('teamPickerHakurakuLink');
  const hkStatus = $('teamPickerHakurakuStatus');
  const showStatus = (message) => { hkStatus.textContent = message ?? ''; hkStatus.hidden = !message; };
  const closeHakuraku = () => { hkForm.hidden = true; hkLink.value = ''; showStatus(null); };

  $('teamPickerHakurakuOpen').addEventListener('click', () => {
    showError(null);
    hkForm.hidden = !hkForm.hidden;
    if (!hkForm.hidden) hkLink.focus();
    else closeHakuraku();
  });
  $('teamPickerHakurakuCancel').addEventListener('click', closeHakuraku);
  hkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = hkForm.querySelector('[type=submit]');
    submit.disabled = true;
    showError(null);
    showStatus('Looking up the team on hakuraku…');
    try {
      const imported = await importHakurakuTeam(hkLink.value, { preferCm: preferCm?.() });
      const name = hakurakuTeamName(imported);
      const team = loadTeam({ id: imported.teamId, members: imported.members }, name); // validates every member
      const id = await roster.importTeam(team, { name });
      closeHakuraku();
      const skipped = imported.skipped.flat();
      if (skipped.length) showError(`Imported "${name}", but left out skills GlobalSim doesn't know: ${skipped.join(', ')}`);
      // Bring the imported team into view and flash it.
      search.value = '';
      render();
      const card = list.querySelector(`[data-id="${id}"]`);
      card?.scrollIntoView({ block: 'nearest' });
      card?.classList.add('uc-flash');
      setTimeout(() => card?.classList.remove('uc-flash'), 1600);
    } catch (error) {
      showStatus(null);
      showError(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  $('teamPickerClose').addEventListener('click', () => dialog.close());
  // A click on the dialog element itself (not its contents) is a click on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  // Escape while renaming cancels the rename, not the whole modal.
  dialog.addEventListener('cancel', (event) => {
    if (renaming) event.preventDefault();
  });

  roster.onChange(() => { if (dialog.open) render(); });

  return {
    open(slotIndex) {
      slot = slotIndex;
      search.value = '';
      showError(null);
      closeHakuraku();
      render();
      dialog.showModal();
      search.focus();
    },
  };
}
