// "Saved Umas" modal: lists the roster's umas (favorites first). Click an uma to put it in the
// team slot the modal was opened for; each card also has favorite / delete icons. Search,
// import-from-file and close live in the header. Uses the <dialog id="umaPicker"> in index.html.
import { Strategy, UmaBuilder } from './globalsim/index.js';
import { strategyName } from './compare.js';
import { ICONS, escapeHtml, memberInfo, outfitOf, umaChipBody, umaDisplayName } from './team-picker.js';
import { umaPreviewHtml } from './uma-editor.js';

// Aptitude grades, worst to best; a filter keeps umas at or above the chosen grade.
const GRADES = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
const gradeRank = (grade) => GRADES.indexOf(String(grade));

/**
 * The umas in an uploaded file: one runner object, an array of runners, or a team file
 * ({ members: [...] }). Every runner is validated.
 */
export function umasFromFile(json) {
  const runners = Array.isArray(json) ? json : Array.isArray(json?.members) ? json.members : [json];
  if (!runners.length) throw new Error('no umas in this file');
  runners.forEach((runner, i) => {
    if (!runner || typeof runner !== 'object' || Array.isArray(runner)) throw new Error(`entry ${i + 1} is not an uma`);
    try {
      UmaBuilder.fromJson(runner);
    } catch (error) {
      throw new Error(runners.length > 1 ? `uma ${i + 1}: ${error.message}` : error.message);
    }
  });
  return runners;
}

/**
 * Wire the modal. Clicking an uma shows a preview of it; "Use this uma" there runs
 * `onSelect(target, umaId)` (target is whatever was passed to open(), e.g. { slot, index }) and
 * closes the modal. "New uma" closes the modal and runs `onNew(target)`. Returns { open(target) }.
 * With `direct: true`, clicking an uma selects it at once (no preview). Without `onNew` the
 * "New uma" button is hidden; without `onEdit` the cards have no edit button.
 */
export function createUmaPicker({ roster, onSelect, onNew, onEdit, direct = false }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('umaPicker');
  const list = $('umaPickerList');
  const search = $('umaPickerSearch');
  const count = $('umaPickerCount');
  const fileInput = $('umaPickerFile');
  const errorBox = $('umaPickerError');
  const filters = { surface: $('umaFilterSurface'), distance: $('umaFilterDistance'), style: $('umaFilterStyle') };
  const searchArea = dialog.querySelector('.uc-modal-search');
  const preview = $('umaPickerPreview');
  const previewFooter = $('umaPickerPreviewFooter');
  const backArrow = $('umaPickerBack');
  backArrow.innerHTML = ICONS.arrowLeft;
  const newButton = $('umaPickerNew');
  newButton.hidden = !onNew;
  let target = null;
  let previewing = null; // id of the uma being previewed, or null on the list
  let listScroll = 0;

  // Surface / Distance: minimum grade ("S", "A or better", ...). Style: running style.
  for (const select of [filters.surface, filters.distance]) {
    select.add(new Option('Any', ''));
    for (const grade of [...GRADES].reverse().slice(0, -1)) {
      select.add(new Option(grade === 'S' ? 'S' : `${grade} or better`, grade));
    }
  }
  filters.style.add(new Option('Any', ''));
  for (const value of Object.values(Strategy)) filters.style.add(new Option(strategyName(value), value));

  /** Whether an uma passes the Surface / Distance / Style filters. */
  function passesFilters(data) {
    const min = (select, field) => !select.value || gradeRank(data[field]) >= gradeRank(select.value);
    return min(filters.surface, 'surfaceAptitude')
      && min(filters.distance, 'distanceAptitude')
      && (!filters.style.value || data.strategy === filters.style.value);
  }
  const filtering = () => Object.values(filters).some((select) => select.value);

  const showError = (message) => {
    errorBox.textContent = message ?? '';
    errorBox.hidden = !message;
  };

  /** Lower-case text a search matches against: nickname, character name, costume and strategy. */
  function haystack(uma) {
    const { name, strategy } = memberInfo(uma.data);
    return [uma.name ?? '', name, outfitOf(uma.data)?.epithet ?? '', strategy].join('\n').toLowerCase();
  }

  function cardHtml(uma) {
    const name = escapeHtml(umaDisplayName(uma.data, uma.name));
    const favoriteLabel = uma.favorite ? 'Unfavorite' : 'Favorite';
    const teams = roster.teamsUsing(uma.id).length;
    return `<article class="uc-member uc-uma-card" data-id="${uma.id}" tabindex="0" aria-label="Select ${name}">
      ${umaChipBody(uma.data, uma.name)}
      <footer class="uc-uma-card-footer">
        <span class="uc-uma-card-usage">${teams ? `In ${teams} saved team${teams === 1 ? '' : 's'}` : ''}</span>
        <span class="uc-uma-card-actions">
          ${onEdit ? `<button type="button" class="uc-icon-button" data-action="edit" title="Edit" aria-label="Edit ${name}">${ICONS.pencil}</button>` : ''}
          <button type="button" class="uc-icon-button uc-star" data-action="favorite" aria-pressed="${Boolean(uma.favorite)}"
            title="${favoriteLabel}" aria-label="${favoriteLabel} ${name}">${ICONS.starOutline}${ICONS.starFill}</button>
          <button type="button" class="uc-icon-button uc-delete" data-action="delete" title="Delete" aria-label="Delete ${name}">${ICONS.trash}</button>
        </span>
      </footer>
    </article>`;
  }

  function render() {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const all = roster.umas({ favoritesFirst: true });
    const shown = all.filter((uma) => {
      if (!passesFilters(uma.data)) return false;
      const text = haystack(uma);
      return terms.every((term) => text.includes(term));
    });
    const noun = (n) => `${n} uma${n === 1 ? '' : 's'}`;
    count.textContent = terms.length || filtering() ? `${shown.length} of ${noun(all.length)}` : noun(all.length);
    if (!all.length) {
      list.innerHTML = '<p class="uc-picker-empty">No saved umas yet. Use <strong>Import from file</strong> to add some, or save a team.</p>';
    } else if (!shown.length) {
      list.innerHTML = '<p class="uc-picker-empty">No umas match your search and filters.</p>';
    } else {
      list.innerHTML = `<div class="uc-uma-grid">${shown.map(cardHtml).join('')}</div>`;
    }
  }

  async function select(id) {
    try {
      await onSelect(target, id);
      dialog.close();
    } catch (error) {
      showList();
      showError(error.message);
    }
  }

  // ---- preview: one uma in detail, before using it ----
  function showPreview(id) {
    const uma = roster.uma(id);
    if (!uma) return;
    previewing = id;
    listScroll = list.scrollTop;
    preview.innerHTML = umaPreviewHtml(uma.data, uma.name);
    $('umaPickerTitle').textContent = umaDisplayName(uma.data, uma.name);
    for (const el of [searchArea, list, newButton, $('umaPickerImport')]) el.hidden = true;
    for (const el of [preview, previewFooter, backArrow]) el.hidden = false;
    preview.scrollTop = 0;
    $('umaPickerSelect').focus();
  }

  /** Back from the preview to the list, as it was (search, filters, scroll position). */
  function showList() {
    previewing = null;
    $('umaPickerTitle').textContent = 'Saved Umas';
    for (const el of [preview, previewFooter, backArrow]) el.hidden = true;
    for (const el of [searchArea, list, $('umaPickerImport')]) el.hidden = false;
    newButton.hidden = !onNew;
    render();
    list.scrollTop = listScroll;
  }

  backArrow.addEventListener('click', showList);
  $('umaPickerPreviewBack').addEventListener('click', showList);
  $('umaPickerSelect').addEventListener('click', () => { if (previewing) select(previewing); });
  // Escape in the preview goes back to the list instead of closing. Handled on keydown: a
  // dialog's cancel event can't always be prevented (browsers ignore that without a recent
  // user gesture), but stopping the key itself always works.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && previewing) {
      event.preventDefault();
      showList();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (previewing) {
      event.preventDefault();
      showList();
    }
  });

  newButton.addEventListener('click', () => {
    dialog.close();
    onNew?.(target);
  });

  list.addEventListener('click', (event) => {
    const card = event.target.closest('.uc-uma-card');
    if (!card) return;
    const id = card.dataset.id;
    const uma = roster.uma(id);
    if (!uma) return;
    const button = event.target.closest('[data-action]');
    showError(null);
    try {
      if (!button) {
        if (direct) select(id); else showPreview(id); // a click anywhere else on the card
      } else if (button.dataset.action === 'favorite') {
        roster.toggleFavoriteUma(id);
      } else if (button.dataset.action === 'edit') {
        listScroll = list.scrollTop;
        dialog.close();
        onEdit(id);
      } else if (button.dataset.action === 'delete') {
        const teams = roster.teamsUsing(id);
        const name = umaDisplayName(uma.data, uma.name);
        const message = teams.length
          ? `Delete "${name}"? It is in ${teams.length} saved team${teams.length === 1 ? '' : 's'}, which will be deleted too.`
          : `Delete "${name}"?`;
        if (confirm(message)) roster.removeUma(id, { cascade: true });
      }
    } catch (error) {
      showError(error.message);
    }
  });

  // Keyboard: Enter or Space on a focused card previews it.
  list.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.classList?.contains('uc-uma-card')) {
      event.preventDefault();
      if (direct) select(event.target.dataset.id); else showPreview(event.target.dataset.id);
    }
  });

  search.addEventListener('input', render);
  for (const select of Object.values(filters)) select.addEventListener('change', render);

  $('umaPickerImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const problems = [];
    for (const file of fileInput.files) {
      try {
        for (const runner of umasFromFile(JSON.parse(await file.text()))) await roster.addUma(runner);
      } catch (error) {
        problems.push(`${file.name}: ${error.message}`);
      }
    }
    fileInput.value = '';
    showError(problems.length ? problems.join('\n') : null);
  });

  $('umaPickerClose').addEventListener('click', () => dialog.close());
  // A click on the dialog element itself (not its contents) is a click on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  roster.onChange(() => {
    if (!dialog.open) return;
    if (previewing && !roster.uma(previewing)) showList(); // previewed uma was deleted
    else if (!previewing) render();
  });

  return {
    resume() {
      showList();
      showError(null);
      dialog.showModal();
      search.focus();
    },
    open(openTarget) {
      target = openTarget;
      if (previewing) showList();
      list.scrollTop = 0;
      search.value = '';
      for (const select of Object.values(filters)) select.value = '';
      showError(null);
      render();
      dialog.showModal();
      search.focus();
    },
  };
}
