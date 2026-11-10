// Uma editor modal, modelled on umalator's (alpha123/uma-tools) uma editor: character + nickname,
// the five stats with their rank glyphs, aptitudes, running style, and the skill list with a
// searchable skill picker. Footer: Export uma / Cancel / Confirm. Uses <dialog id="umaEditor">.
//
// The editor only edits a copy of the runner JSON; Confirm validates it with UmaBuilder and hands
// it to `onConfirm(data, nickname)` (which is where saving happens).
import { Skill, Strategy, Uma, UmaBuilder, skillLabel, umaLabel } from './globalsim/index.js';
import { strategyName } from './compare.js';
import { SKILL_ICONS } from './skill-icons.js';
import {
  ICONS, escapeHtml, outfitForUnique, outfitIconUrl, outfitOf, outfitsOf, portraitUrl, umaIconUrl, uniqueForOutfit,
} from './team-picker.js';
import { canonicalJson } from './roster.js';

const GRADES = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
// [runner JSON field, label, icon in assets/stats/]
const STATS = [
  ['speed', 'Speed', 'speed'], ['stamina', 'Stamina', 'stamina'], ['power', 'Power', 'power'],
  ['guts', 'Guts', 'guts'], ['wisdom', 'Wit', 'wit'],
];
const STAT_MAX = 2000;
const APTITUDE_FIELDS = [
  ['surfaceAptitude', 'Surface aptitude'], ['distanceAptitude', 'Distance aptitude'], ['strategyAptitude', 'Style aptitude'],
];

export const skillIconUrl = (id) => {
  const icon = SKILL_ICONS[String(id)];
  return icon ? `./assets/skill_icons/utx_ico_skill_${icon}.webp` : './assets/skill_icons/generic.webp';
};
const gradeUrl = (grade) => `./assets/grades/${grade}.webp`;

/**
 * Index of the game's stat-rank glyph (assets/statusrank/utx_ico_statusrank_NN.webp) for a stat:
 * G..A+ in 50s up to 400, C..S+ in 100s up to 1100, SS / SS+, then the UG.. ranks.
 */
export function statRank(value) {
  const x = Math.max(0, Math.floor(Number(value) || 0));
  if (x > 2000) return Math.min(98 + Math.floor((x - 2001) / 125) * 25 + Math.floor(((x - 1) % 125) / 5), 97);
  if (x > 1200) return Math.min(18 + Math.floor((x - 1200) / 100) * 10 + (Math.floor(x / 10) % 10), 97);
  if (x >= 1150) return 17;
  if (x >= 1100) return 16;
  if (x >= 400) return 8 + Math.floor((x - 400) / 100);
  return Math.floor(x / 50);
}
const statRankUrl = (value) => `./assets/statusrank/utx_ico_statusrank_${String(statRank(value)).padStart(2, '0')}.webp`;
/** Rank glyph for a stat input: none while the stat is empty. */
const statRankImg = (field, value) => `<img src="${statRankUrl(value)}" alt="" data-rank-for="${field}"${value === '' || value == null ? ' style="visibility:hidden"' : ''}>`;

/**
 * A blank uma for "New uma": no character and no stats yet. Picking a character fills in its
 * costume's unique skill, running style and aptitudes.
 */
export function newUmaDraft() {
  return {
    charaId: null, speed: '', stamina: '', power: '', guts: '', wisdom: '',
    strategy: 'Senkou', surfaceAptitude: 'A', distanceAptitude: 'A', strategyAptitude: 'A', skills: [],
  };
}

const charaNameOf = (charaId) => {
  if (charaId == null) return '';
  try { return umaLabel(charaId); } catch { return `Uma ${charaId}`; }
};

/**
 * Read-only view of an uma in the editor's layout (portrait, name, costume, stats, aptitudes,
 * style, skills). Used by the Saved Umas preview.
 */
export function umaPreviewHtml(data, nickname = null) {
  const character = charaNameOf(data.charaId);
  const outfit = outfitOf(data);
  const name = nickname || character;
  const unique = (data.skills ?? []).find((s) => s.isUnique);
  const others = (data.skills ?? []).filter((s) => !s.isUnique);
  const skill = (entry) => {
    const id = String(entry.skillId);
    const label = escapeHtml(skillLabel(Number(id)));
    return `<li class="uc-ed-skill${entry.isUnique ? ' uc-ed-skill-unique' : ''}">
        <span class="uc-ed-skill-main"><img src="${skillIconUrl(id)}" alt=""><span>${label}</span></span>
        ${entry.isUnique ? `<span class="uc-ed-skill-level">Lv ${Number(entry.level) || 1}</span>` : ''}
      </li>`;
  };
  const grade = (g) => (GRADES.includes(g) ? `<img src="${gradeUrl(g)}" alt="${g}" title="${g}">` : '?');
  return `
    <section class="uc-ed-top">
      <img class="uc-ed-portrait" src="${portraitUrl(data)}" alt="" onerror="this.style.visibility='hidden'">
      <div class="uc-preview-identity">
        <h3>${escapeHtml(name)}</h3>
        <div>${escapeHtml([outfit?.epithet, name !== character ? character : null].filter(Boolean).join(' '))}</div>
        <div class="uc-preview-style">${escapeHtml(strategyName(data.strategy))}</div>
      </div>
    </section>
    <section class="uc-ed-stats">
      ${STATS.map(([, label, icon]) => `<div class="uc-ed-stat-head"><img src="./assets/stats/${icon}.webp" alt="">${label}</div>`).join('')}
      ${STATS.map(([field]) => `<div class="uc-ed-stat"><img src="${statRankUrl(data[field])}" alt=""><span class="uc-preview-stat">${escapeHtml(data[field] ?? '–')}</span></div>`).join('')}
    </section>
    <section class="uc-ed-apts">
      <div class="uc-ed-apt"><span>Surface aptitude</span><span class="uc-preview-grade">${grade(data.surfaceAptitude)}</span></div>
      <div class="uc-ed-apt"><span>Distance aptitude</span><span class="uc-preview-grade">${grade(data.distanceAptitude)}</span></div>
      <div class="uc-ed-apt"><span>Style</span><strong>${escapeHtml(strategyName(data.strategy))}</strong></div>
      <div class="uc-ed-apt"><span>Style aptitude</span><span class="uc-preview-grade">${grade(data.strategyAptitude)}</span></div>
    </section>
    <section>
      <div class="uc-ed-skills-head">Skills</div>
      <ul class="uc-ed-skills">${[unique, ...others].filter(Boolean).map(skill).join('') || '<li class="uc-picker-empty">No skills</li>'}</ul>
    </section>`;
}

// ---- which skills belong to whom ----
// Character uniques are 1 O CCC 1 (O = outfit, CCC = last 3 digits of the charaId), or the
// older 1 CCC 1. 9-digit ids starting with the charaId are that character's evolved skills.
const isUniqueId = (id) => (id.length === 6 && id[0] === '1' && id[5] === '1') || (id.length === 5 && id[0] === '1' && id[4] === '1');
const isOwnUnique = (charaId, id) => {
  const c = String(charaId).slice(1);
  return (id.length === 6 && isUniqueId(id) && id.slice(2, 5) === c) || (id.length === 5 && isUniqueId(id) && id.slice(1, 4) === c);
};
const isEvolved = (id) => id.length === 9 && id[0] === '1';

const ALL_SKILLS = Object.values(Skill).map((id) => ({ id: String(id), label: skillLabel(id) }))
  .sort((a, b) => a.label.localeCompare(b.label));
const SKILL_IDS = new Set(ALL_SKILLS.map((s) => s.id));
// Every costume of every character ("[Epithet] Name"); characters without outfit data get one
// plain entry.
const ALL_OUTFITS = Object.values(Uma).flatMap((chara) => {
  const name = umaLabel(chara);
  const outfits = outfitsOf(chara);
  if (!outfits.length) return [{ chara, outfit: null, label: name, icon: umaIconUrl(chara) }];
  return outfits.map((o) => ({
    chara, outfit: o.id, label: `${o.epithet} ${name}`, name,
    icon: o.icon ? outfitIconUrl(o.id) : umaIconUrl(chara),
  }));
}).sort((a, b) => (a.name ?? a.label).localeCompare(b.name ?? b.label) || a.label.localeCompare(b.label));
const STRATEGY_ORDER = ['Nige', 'Senkou', 'Sasi', 'Oikomi']; // outfit aptitude order (Runaway uses Front)

/** Skills the picker offers for this uma: not uniques, and only this character's evolved skills. */
const pickableSkill = (charaId, id) => !isUniqueId(id) && (!isEvolved(id) || id.startsWith(String(charaId)));

/** Default unique for a character: its original outfit's (1 0 CCC 1), else the first one. */
function defaultUnique(charaId) {
  const own = ALL_SKILLS.filter((s) => isOwnUnique(charaId, s.id)).map((s) => s.id);
  return own.find((id) => id[1] === '0') ?? own[0] ?? null;
}

/** A draft for the inline editor: a copy of `data` with only its unique skill kept. */
const inlineDraft = (data) => {
  const draft = structuredClone(data);
  draft.skills = (Array.isArray(draft.skills) ? draft.skills : []).filter((s) => s.isUnique);
  return draft;
};

/**
 * The editor. By default it is the modal on <dialog id="umaEditor"> (`open(...)`, confirm / cancel).
 * With `inline` (an element) it is embedded there instead: no dialog, header, nickname, Save /
 * Cancel or prompts, and only the unique skill (the optimizer picks the rest). Every change calls
 * `onChange(draft, error)` (a copy of the draft, and why it isn't valid yet, or null); drive it
 * with `set`, `get`, `validate` and `setCourse`. See `createUmaInlineEditor`.
 */
export function createUmaEditor({ onConfirm, onClose, inline = null, onChange }) {
  const dialog = inline ?? document.getElementById('umaEditor');
  if (!inline) dialog.addEventListener('close', () => onClose?.(target));
  let silent = false; // set() renders without reporting a change
  let draft = null; // runner JSON being edited
  let nickname = '';
  let target = null;
  let picker = null; // null | 'skill' | 'unique'
  let charOpen = false;
  let snapshot = null; // what the editor opened with, to tell whether anything changed
  let course = null; // { surface, category } of the race being compared, for costume defaults
  let isNew = false; // creating a new uma rather than editing one

  const state = () => canonicalJson({ draft, nickname: nickname.trim() });
  const isDirty = () => snapshot !== null && state() !== snapshot;
  /** Show the pink unsaved-changes dot next to the title while there are changes. */
  const updateDirtyDot = () => {
    const dot = dialog.querySelector('.uc-ed-dirty');
    if (dot) dot.hidden = !isDirty();
  };

  /** Close via the backdrop, ✕ or Escape: ask first if there are unsaved changes. */
  function requestClose() {
    if (!isDirty() || window.confirm('Discard unsaved changes to this uma?')) dialog.close();
  }

  const skillsOf = () => (Array.isArray(draft.skills) ? draft.skills : (draft.skills = []));
  const uniqueEntry = () => skillsOf().find((s) => s.isUnique);

  // ---- rendering ----
  function aptitudeButton(field, label) {
    const grade = GRADES.includes(draft[field]) ? draft[field] : 'G';
    return `<div class="uc-ed-apt">
        <span>${label}</span>
        <div class="uc-ed-apt-select">
          <button type="button" class="uc-ed-apt-current" data-action="apt-open" data-field="${field}" aria-haspopup="listbox"
            aria-label="${label}: ${grade}"><img src="${gradeUrl(grade)}" alt="${grade}"></button>
          <ul class="uc-ed-apt-menu" role="listbox" data-field="${field}" hidden>
            ${GRADES.map((g) => `<li><button type="button" data-action="apt-set" data-field="${field}" data-grade="${g}"
              aria-label="${g}"${g === grade ? ' aria-selected="true"' : ''}><img src="${gradeUrl(g)}" alt=""></button></li>`).join('')}
          </ul>
        </div>
      </div>`;
  }

  function skillRow(entry) {
    const id = String(entry.skillId);
    const label = escapeHtml(skillLabel(Number(id)));
    if (entry.isUnique) {
      const level = Number(entry.level) || 1;
      return `<li class="uc-ed-skill uc-ed-skill-unique" data-skill="${id}">
          <button type="button" class="uc-ed-skill-main" data-action="open-unique" title="Change unique skill">
            <img src="${skillIconUrl(id)}" alt=""><span>${label}</span>
          </button>
          <label class="uc-ed-skill-level">Lv <select data-action="unique-level">
            ${[1, 2, 3, 4, 5, 6].map((n) => `<option${n === level ? ' selected' : ''}>${n}</option>`).join('')}
          </select></label>
        </li>`;
    }
    return `<li class="uc-ed-skill" data-skill="${id}">
        <span class="uc-ed-skill-main"><img src="${skillIconUrl(id)}" alt=""><span>${label}</span></span>
        <button type="button" class="uc-ed-skill-remove" data-action="remove-skill" title="Remove skill" aria-label="Remove ${label}">${ICONS.x}</button>
      </li>`;
  }

  /** Inline mode: report the draft (and why it isn't valid yet) after every change. */
  function emit() {
    if (!inline || silent) return;
    const { error } = validate();
    showError(error);
    onChange?.(structuredClone(draft), error);
  }

  function render() {
    const charaName = charaNameOf(draft.charaId);
    const outfit = outfitOf(draft);
    const charaLabel = outfit ? `${outfit.epithet} ${charaName}` : charaName;
    const unique = uniqueEntry();
    const others = skillsOf().filter((s) => !s.isUnique);
    dialog.innerHTML = inline ? inlineHtml(charaLabel, unique) : `
      <header class="uc-modal-header">
        <h2 id="umaEditorTitle">${isNew ? 'New Uma' : 'Edit Uma'}</h2>
        <span class="uc-unsaved-dot uc-ed-dirty" title="Unsaved changes" aria-label="Unsaved changes" hidden></span>
        <div class="uc-modal-header-actions">
          <button type="button" class="btn-close" data-action="close" aria-label="Close"></button>
        </div>
      </header>
      <div class="uc-ed-body">
        <section class="uc-ed-top">
          ${draft.charaId == null
            ? '<div class="uc-ed-portrait uc-ed-portrait-empty" aria-hidden="true">?</div>'
            : `<img class="uc-ed-portrait" src="${portraitUrl(draft)}" alt="" onerror="this.style.visibility='hidden'">`}
          <div class="uc-ed-identity">
            <label class="form-label" for="umaEditorChara">Character</label>
            <div class="uc-ed-combo">
              <input type="text" class="form-control" id="umaEditorChara" value="${escapeHtml(charaLabel)}" autocomplete="off"
                placeholder="Search for a character"
                role="combobox" aria-expanded="false" aria-controls="umaEditorCharaList">
              <ul class="uc-ed-combo-list" id="umaEditorCharaList" role="listbox" hidden></ul>
            </div>
            <label class="form-label" for="umaEditorNickname">Nickname</label>
            <input type="text" class="form-control" id="umaEditorNickname" value="${escapeHtml(nickname)}" placeholder="${escapeHtml(charaName || 'Optional')}">
          </div>
        </section>

        <section class="uc-ed-stats">
          ${STATS.map(([field, label, icon]) => `<div class="uc-ed-stat-head"><img src="./assets/stats/${icon}.webp" alt="">${label}</div>`).join('')}
          ${STATS.map(([field, label]) => `<div class="uc-ed-stat">
              ${statRankImg(field, draft[field])}
              <input type="number" class="form-control" min="1" max="${STAT_MAX}" step="1" value="${escapeHtml(draft[field] ?? '')}"
                data-stat="${field}" aria-label="${label}">
            </div>`).join('')}
        </section>

        <section class="uc-ed-apts">
          ${aptitudeButton('surfaceAptitude', 'Surface aptitude')}
          ${aptitudeButton('distanceAptitude', 'Distance aptitude')}
          <div class="uc-ed-apt">
            <span>Style</span>
            <select class="form-select form-select-sm" data-action="strategy" aria-label="Style">
              ${Object.values(Strategy).map((s) => `<option value="${s}"${s === draft.strategy ? ' selected' : ''}>${strategyName(s)}</option>`).join('')}
            </select>
          </div>
          ${aptitudeButton('strategyAptitude', 'Style aptitude')}
        </section>

        <section>
          <div class="uc-ed-skills-head">Skills</div>
          <ul class="uc-ed-skills">
            ${unique ? skillRow(unique) : `<li class="uc-ed-skill"><button type="button" class="uc-ed-add-skill" data-action="open-unique"><span>+</span>Set unique skill</button></li>`}
            ${others.map(skillRow).join('')}
            <li class="uc-ed-skill"><button type="button" class="uc-ed-add-skill" data-action="open-skill"><span>+</span>Add Skill</button></li>
          </ul>
        </section>

        <div class="uc-ed-picker" ${picker ? '' : 'hidden'}>
          <div class="uc-ed-picker-head">
            <strong>${picker === 'unique' ? 'Choose unique skill' : 'Add skill'}</strong>
            <input type="search" class="form-control form-control-sm" id="umaEditorSkillSearch" placeholder="Search skills" aria-label="Search skills">
            <button type="button" class="btn-close" data-action="close-picker" aria-label="Close skill picker"></button>
          </div>
          <ul class="uc-ed-picker-list" id="umaEditorSkillList"></ul>
        </div>
      </div>
      <footer class="uc-ed-footer">
        <button type="button" class="btn btn-outline-light" data-action="export">Export</button>
        <p class="uc-modal-error" id="umaEditorError" role="alert" hidden></p>
        <div class="uc-ed-footer-right">
          <button type="button" class="btn btn-outline-secondary" data-action="cancel">Cancel</button>
          ${isNew ? '' : `<button type="button" class="btn btn-outline-pink" data-action="confirm-copy"
            title="Save the changes as a separate uma; the original stays as it is">Save as copy</button>`}
          <button type="button" class="btn btn-pink" data-action="confirm"
            title="${isNew ? 'Save this uma and use it here' : 'Save the changes to this uma (everywhere it is used)'}">Save</button>
        </div>
      </footer>`;
    if (picker) renderPickerList();
    updateDirtyDot();
    emit();
  }

  /** The inline layout: the same sections as the modal, minus nickname, extra skills and the footer buttons. */
  function inlineHtml(charaLabel, unique) {
    return `
      <div class="uc-ed-body uc-ed-inline">
        <section class="uc-ed-top">
          ${draft.charaId == null
            ? '<div class="uc-ed-portrait uc-ed-portrait-empty" aria-hidden="true">?</div>'
            : `<img class="uc-ed-portrait" src="${portraitUrl(draft)}" alt="" onerror="this.style.visibility='hidden'">`}
          <div class="uc-ed-identity">
            <label class="form-label" for="umaEditorChara">Character</label>
            <div class="uc-ed-combo">
              <input type="text" class="form-control" id="umaEditorChara" value="${escapeHtml(charaLabel)}" autocomplete="off"
                placeholder="Search for a character"
                role="combobox" aria-expanded="false" aria-controls="umaEditorCharaList">
              <ul class="uc-ed-combo-list" id="umaEditorCharaList" role="listbox" hidden></ul>
            </div>
          </div>
        </section>
        <section class="uc-ed-stats">
          ${STATS.map(([, label, icon]) => `<div class="uc-ed-stat-head"><img src="./assets/stats/${icon}.webp" alt="">${label}</div>`).join('')}
          ${STATS.map(([field, label]) => `<div class="uc-ed-stat">
              ${statRankImg(field, draft[field])}
              <input type="number" class="form-control" min="1" max="${STAT_MAX}" step="1" value="${escapeHtml(draft[field] ?? '')}"
                data-stat="${field}" aria-label="${label}">
            </div>`).join('')}
        </section>
        <section class="uc-ed-apts">
          ${aptitudeButton('surfaceAptitude', 'Surface aptitude')}
          ${aptitudeButton('distanceAptitude', 'Distance aptitude')}
          <div class="uc-ed-apt">
            <span>Style</span>
            <select class="form-select form-select-sm" data-action="strategy" aria-label="Style">
              ${Object.values(Strategy).map((s) => `<option value="${s}"${s === draft.strategy ? ' selected' : ''}>${strategyName(s)}</option>`).join('')}
            </select>
          </div>
          ${aptitudeButton('strategyAptitude', 'Style aptitude')}
        </section>
        <section>
          <div class="uc-ed-skills-head">Unique skill</div>
          <ul class="uc-ed-skills">
            ${unique ? skillRow(unique) : `<li class="uc-ed-skill"><button type="button" class="uc-ed-add-skill" data-action="open-unique"><span>+</span>Set unique skill</button></li>`}
          </ul>
        </section>
        <div class="uc-ed-picker" ${picker ? '' : 'hidden'}>
          <div class="uc-ed-picker-head">
            <strong>Choose unique skill</strong>
            <input type="search" class="form-control form-control-sm" id="umaEditorSkillSearch" placeholder="Search skills" aria-label="Search skills">
            <button type="button" class="btn-close" data-action="close-picker" aria-label="Close skill picker"></button>
          </div>
          <ul class="uc-ed-picker-list" id="umaEditorSkillList"></ul>
        </div>
        <div class="uc-ed-inline-actions">
          <button type="button" class="btn btn-sm btn-outline-light" data-action="export">Export</button>
          <button type="button" class="btn btn-sm btn-outline-light" data-action="import">Import</button>
          <input type="file" accept=".json,application/json" data-action="import-file" hidden>
          <p class="uc-modal-error" id="umaEditorError" role="alert" hidden></p>
        </div>
      </div>`;
  }

  function renderPickerList() {
    const list = document.getElementById('umaEditorSkillList');
    const query = (document.getElementById('umaEditorSkillSearch')?.value ?? '').toLowerCase().trim();
    const have = new Set(skillsOf().map((s) => String(s.skillId)));
    const candidates = ALL_SKILLS.filter((s) => (picker === 'unique' ? isOwnUnique(draft.charaId, s.id) : pickableSkill(draft.charaId, s.id))
      && !have.has(s.id) && (!query || s.label.toLowerCase().includes(query)));
    list.innerHTML = candidates.length
      ? candidates.slice(0, 300).map((s) => `<li><button type="button" data-action="add-skill" data-skill="${s.id}">
          <img src="${skillIconUrl(s.id)}" alt="" loading="lazy"><span>${escapeHtml(s.label)}</span></button></li>`).join('')
        + (candidates.length > 300 ? `<li class="uc-ed-picker-more">${candidates.length - 300} more — type to narrow down</li>` : '')
      : '<li class="uc-ed-picker-more">No matching skills</li>';
  }

  function renderCharaList() {
    const input = document.getElementById('umaEditorChara');
    const list = document.getElementById('umaEditorCharaList');
    const query = input.value.toLowerCase().trim();
    const matches = ALL_OUTFITS.filter((u) => !query || u.label.toLowerCase().includes(query));
    list.innerHTML = matches.map((u, i) => `<li role="option" data-chara="${u.chara}" data-outfit="${u.outfit ?? ''}"${i === 0 ? ' class="active"' : ''}>
        <img src="${u.icon}" alt="" loading="lazy"><span>${escapeHtml(u.label)}</span></li>`).join('')
      || '<li class="uc-ed-picker-more">No match</li>';
    list.hidden = !charOpen;
    input.setAttribute('aria-expanded', String(charOpen));
  }

  function showError(message) {
    const box = document.getElementById('umaEditorError');
    box.textContent = message ?? '';
    box.hidden = !message;
  }

  // ---- changes ----
  /**
   * Pick a character + costume. The unique skill follows the costume (keeping its level). A new
   * character also brings that costume's default running style and base aptitudes for the
   * current course (like umalator), and drops the old character's evolved skills; switching
   * costume of the same character leaves stats and aptitudes alone.
   */
  function setOutfit(charaId, outfitId) {
    const newCharacter = charaId !== draft.charaId;
    draft.charaId = charaId;
    if (outfitId) draft.outfitId = outfitId;
    else delete draft.outfitId;

    const ownUnique = outfitId && SKILL_IDS.has(uniqueForOutfit(outfitId)) ? uniqueForOutfit(outfitId) : null;
    const next = ownUnique ?? (newCharacter ? defaultUnique(charaId) : null);
    const unique = uniqueEntry();
    if (unique && next) unique.skillId = next;
    else if (!unique && next) skillsOf().unshift({ skillId: next, level: 1, isUnique: true });

    if (newCharacter) {
      draft.skills = skillsOf().filter((s) => s.isUnique || pickableSkill(charaId, String(s.skillId)));
      const outfit = outfitsOf(charaId).find((o) => o.id === outfitId) ?? outfitsOf(charaId)[0];
      if (outfit) {
        draft.strategy = outfit.strategy;
        const apt = outfit.aptitudes; // Sprint Mile Medium Long | Front Pace Late End | Turf Dirt
        draft.strategyAptitude = apt[4 + STRATEGY_ORDER.indexOf(outfit.strategy)];
        if (course) {
          draft.distanceAptitude = apt[course.category - 1];
          draft.surfaceAptitude = apt[8 + course.surface - 1];
        }
      }
    }
    render();
  }

  function closeAptMenus(except = null) {
    for (const menu of dialog.querySelectorAll('.uc-ed-apt-menu')) if (menu !== except) menu.hidden = true;
  }

  // A click on the backdrop (the dialog element itself) closes, but only if the press started
  // there too, so dragging out of a text field while selecting doesn't count.
  let pressedOnBackdrop = false;
  dialog.addEventListener('mousedown', (event) => { pressedOnBackdrop = event.target === dialog; });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !inline) {
      if (pressedOnBackdrop) requestClose();
      pressedOnBackdrop = false;
      return;
    }
    const el = event.target.closest('[data-action]');
    const action = el?.dataset.action;
    if (!event.target.closest('.uc-ed-apt-select')) closeAptMenus();
    if (!event.target.closest('.uc-ed-combo') && charOpen) { charOpen = false; renderCharaList(); }
    if (!action) return;
    showError(null);
    switch (action) {
      case 'cancel': dialog.close(); break; // explicit discard: no question asked
      case 'close': requestClose(); break;
      case 'apt-open': {
        const menu = el.parentElement.querySelector('.uc-ed-apt-menu');
        closeAptMenus(menu);
        menu.hidden = !menu.hidden;
        break;
      }
      case 'apt-set': draft[el.dataset.field] = el.dataset.grade; render(); break;
      case 'open-skill': picker = 'skill'; render(); document.getElementById('umaEditorSkillSearch').focus(); break;
      case 'open-unique': picker = 'unique'; render(); document.getElementById('umaEditorSkillSearch').focus(); break;
      case 'close-picker': picker = null; render(); break;
      case 'add-skill': {
        const id = el.dataset.skill;
        if (picker === 'unique') {
          const unique = uniqueEntry();
          if (unique) unique.skillId = id;
          else skillsOf().unshift({ skillId: id, level: 1, isUnique: true });
          // a costume's unique belongs to that costume: switch the costume to match
          const outfit = outfitForUnique(id);
          if (outfitsOf(draft.charaId).some((o) => o.id === outfit)) draft.outfitId = outfit;
        } else {
          skillsOf().push({ skillId: id, level: 1, isUnique: false });
        }
        picker = null;
        render();
        break;
      }
      case 'remove-skill': {
        const id = el.closest('[data-skill]').dataset.skill;
        draft.skills = skillsOf().filter((s) => s.isUnique || String(s.skillId) !== id);
        render();
        break;
      }
      case 'export': exportUma(); break;
      case 'import': dialog.querySelector('[data-action=import-file]')?.click(); break;
      case 'confirm': confirm(); break;
      case 'confirm-copy': confirm(true); break;
    }
  });

  dialog.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.stat) {
      const field = el.dataset.stat;
      draft[field] = el.value === '' ? '' : Math.round(Number(el.value));
      const glyph = dialog.querySelector(`[data-rank-for="${field}"]`);
      glyph.src = statRankUrl(draft[field]);
      glyph.style.visibility = draft[field] === '' ? 'hidden' : '';
      updateDirtyDot();
      emit();
    } else if (el.id === 'umaEditorNickname') {
      nickname = el.value;
      updateDirtyDot();
    } else if (el.id === 'umaEditorChara') {
      charOpen = true;
      renderCharaList();
    } else if (el.id === 'umaEditorSkillSearch') {
      renderPickerList();
    }
  });

  dialog.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset.action === 'strategy') draft.strategy = el.value;
    if (el.dataset.action === 'unique-level') uniqueEntry().level = Number(el.value);
    if (el.dataset.action === 'import-file') { importFile(el); return; }
    updateDirtyDot();
    emit();
  });

  // Character combobox: open on focus, pick with click or Enter/arrow keys.
  dialog.addEventListener('focusin', (event) => {
    if (event.target.id === 'umaEditorChara') { charOpen = true; event.target.select(); renderCharaList(); }
  });
  dialog.addEventListener('mousedown', (event) => {
    const li = event.target.closest('#umaEditorCharaList [data-chara]');
    if (!li) return;
    event.preventDefault(); // keep focus; the click picks
    charOpen = false;
    setOutfit(Number(li.dataset.chara), li.dataset.outfit ? Number(li.dataset.outfit) : null);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.target.id === 'umaEditorChara') {
      const items = [...dialog.querySelectorAll('#umaEditorCharaList [data-chara]')];
      const active = items.findIndex((li) => li.classList.contains('active'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((li, i) => li.classList.toggle('active', i === next));
        items[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && items[Math.max(active, 0)]) {
        event.preventDefault();
        charOpen = false;
        const item = items[Math.max(active, 0)];
        setOutfit(Number(item.dataset.chara), item.dataset.outfit ? Number(item.dataset.outfit) : null);
      } else if (event.key === 'Escape' && charOpen) {
        event.preventDefault();
        event.stopPropagation();
        charOpen = false;
        renderCharaList();
      }
    } else if (event.key === 'Escape' && (picker || [...dialog.querySelectorAll('.uc-ed-apt-menu')].some((m) => !m.hidden))) {
      // Escape closes the innermost thing first: the skill picker or an aptitude menu, then the editor.
      event.preventDefault();
      event.stopPropagation();
      if (picker) { picker = null; render(); } else closeAptMenus();
    } else if (event.key === 'Escape' && !charOpen && !inline) {
      // Nothing open inside: close the editor, asking first if there are changes. Done here
      // rather than only via the cancel event, which browsers don't always let us stop.
      event.preventDefault();
      requestClose();
    }
  });
  // Escape: the keydown handler above already closes the skill picker / menus first; once
  // nothing is open inside, Escape closes the editor (asking first if there are changes).
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!picker && !charOpen) requestClose();
  });
  // Typing a grade letter on a focused aptitude button picks it (like umalator).
  dialog.addEventListener('keydown', (event) => {
    const button = event.target.closest?.('.uc-ed-apt-current');
    const grade = event.key?.toUpperCase();
    if (button && GRADES.includes(grade)) {
      draft[button.dataset.field] = grade;
      render();
      dialog.querySelector(`.uc-ed-apt-current[data-field="${button.dataset.field}"]`).focus();
    }
  });

  /** The draft as clean runner JSON, or throws with a readable message. */
  function validated() {
    if (draft.charaId == null) throw new Error('Choose a character first');
    for (const [field, label] of STATS) {
      const v = draft[field];
      if (v === '' || !Number.isInteger(v) || v < 1 || v > STAT_MAX) throw new Error(`${label} must be a whole number from 1 to ${STAT_MAX}`);
    }
    const data = structuredClone(draft);
    UmaBuilder.fromJson(data); // the engine's own checks (character, aptitudes, skills, levels)
    return data;
  }

  /** { data, error }: the draft as runner JSON, or why it isn't valid. */
  function validate() {
    try { return { data: validated(), error: null }; } catch (error) { return { data: null, error: error.message }; }
  }

  /** Inline: load a single uma (a runner, a list of runners or a team file; the first uma) from a JSON file. */
  async function importFile(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      // A run may have started (and disabled the editor) while the file was being read.
      if (inline && dialog.closest('fieldset')?.disabled) throw new Error('the optimizer is running; import again when it stops');
      const runner = Array.isArray(json) ? json[0] : Array.isArray(json?.members) ? json.members[0] : json;
      if (!runner || typeof runner !== 'object') throw new Error('no uma in this file');
      UmaBuilder.fromJson(structuredClone(runner));
      draft = inlineDraft(runner);
      picker = null;
      render();
    } catch (error) {
      showError(`Import failed: ${error.message}`);
    }
  }

  function exportUma() {
    let data;
    try { data = validated(); } catch (error) { showError(error.message); return; }
    const name = (nickname.trim() || charaNameOf(data.charaId) || 'uma')
      .replace(/[^\w\- ]+/g, '').trim() || 'uma';
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Confirm (save the changes to this uma) or, with `asCopy`, "Save as copy" (save the edited
   * version as a separate uma for this slot only, leaving the original untouched).
   */
  async function confirm(asCopy = false) {
    let data;
    try { data = validated(); } catch (error) { showError(error.message); return; }
    const buttons = dialog.querySelectorAll('[data-action=confirm], [data-action=confirm-copy]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await onConfirm(target, data, nickname.trim() || null, { asCopy });
      dialog.close();
    } catch (error) {
      showError(error.message);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  return {
    /** Inline: replace the draft and report the resulting state once. Only the unique skill is kept. */
    set(data) {
      silent = true;
      draft = inlineDraft(data);
      picker = null;
      charOpen = false;
      render();
      silent = false;
      emit();
    },
    /** Inline: a copy of the current draft. */
    get: () => structuredClone(draft),
    /** Inline: { data, error } for the current draft. */
    validate,
    /** Set the course ({ surface, category }) that a newly chosen character's aptitude defaults follow. */
    setCourse(raceCourse) { course = raceCourse; },
    /**
     * Edit a copy of `data` (runner JSON). `openTarget` is passed back to onConfirm.
     * `raceCourse` ({ surface, category }) picks which aptitudes a new character's defaults fill in.
     */
    open(openTarget, data, currentNickname = null, raceCourse = null) {
      course = raceCourse;
      isNew = Boolean(openTarget?.isNew);
      target = openTarget;
      draft = structuredClone(data);
      nickname = currentNickname ?? '';
      picker = null;
      charOpen = false;
      snapshot = state();
      render();
      dialog.showModal();
      // Focus the editor itself rather than any field (showModal would pick the first button).
      dialog.tabIndex = -1;
      dialog.focus();
    },
  };
}

/**
 * An uma editor embedded in `container` (no modal): character / costume, stats, aptitudes, style
 * and unique skill. `onChange(draft, error)` runs after every user change. Returns
 * { set(draft), get(), validate() -> { data, error }, setCourse(course) }.
 * @param {{container: HTMLElement, onChange?: (draft: object, error: string|null) => void, draft?: object, course?: object}} options
 */
export function createUmaInlineEditor({ container, onChange, draft = newUmaDraft(), course = null }) {
  const editor = createUmaEditor({ inline: container, onChange });
  editor.setCourse(course);
  editor.set(draft);
  return editor;
}
