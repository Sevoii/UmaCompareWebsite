import { raceLabel, memberName, strategyName, meanCi, pairedDifferenceCi, wilsonCi } from './compare.js';
import { skillLabel } from './globalsim/index.js';
import { escapeHtml as esc, portraitUrl } from './team-picker.js';
import { skillIconUrl } from './uma-editor.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const signed = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
const metric = (values, unit = '') => {
  const [mean, half] = meanCi(values);
  return `<strong>${mean.toFixed(2)}${unit}</strong><small>± ${half.toFixed(2)}${unit}</small>`;
};

// The pair of teams the comparison panel shows, per results container (kept across re-renders).
const chosenPairs = new WeakMap();

// ---- where skills activate (per uma), drawn like hakuraku's "Simulator activation positions" ----
// Race phases as fractions of the course: Middle from 1/6, Late from 2/3, Spurt from 5/6.
const PHASES = [['Middle', 1 / 6], ['Late', 2 / 3], ['Spurt', 5 / 6]];
const STRIP_RGB = '244, 114, 182';

/**
 * CSS background for one skill's activation strip: a bin per column, stronger pink where the
 * skill activated more often (sqrt scale, so rare spots still show), plus the phase lines.
 */
function stripBackground(counts) {
  const max = Math.max(...counts, 1);
  const n = counts.length;
  const stops = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && counts[i] === counts[start]) continue; // merge equal neighbours into one stop
    const count = counts[start];
    const alpha = count ? 0.18 + 0.82 * Math.sqrt(count / max) : 0.05;
    stops.push(`rgba(${STRIP_RGB}, ${alpha.toFixed(3)}) ${(100 * start / n).toFixed(3)}% ${(100 * i / n).toFixed(3)}%`);
    start = i;
  }
  const lines = PHASES.map(([, f]) => {
    const at = (100 * f).toFixed(3);
    return `transparent calc(${at}% - 1px), rgba(255, 255, 255, 0.55) calc(${at}% - 1px) ${at}%, transparent ${at}%`;
  }).join(', ');
  return `linear-gradient(to right, ${lines}), linear-gradient(to right, ${stops.join(', ')})`;
}

/** The axis row above a uma's skill strips: 0 m, phase names, course length. */
function axisHtml(courseDistance) {
  return `<li class="uc-skill-axis" aria-hidden="true"><span style="left:0">0m</span>
    ${PHASES.map(([name, f]) => `<span style="left:${(100 * f).toFixed(3)}%">${name}</span>`).join('')}
    <span class="uc-skill-axis-end">${courseDistance}m</span></li>`;
}

/** Tooltip text for bin `bin` of a skill's strip. */
function binDetail(tally, k, bins, bin) {
  const start = bin * tally.binSize;
  const end = Math.min(tally.courseDistance, start + tally.binSize);
  const total = bins.counts.reduce((a, b) => a + b, 0);
  const count = bins.counts[bin];
  const lines = [`${start}–${end} m`, `${count.toLocaleString()} activation${count === 1 ? '' : 's'}${total ? ` (${pct(count / total)} of this skill's)` : ''}`];
  const first = bins.firstCounts[bin];
  if (first) {
    lines.push(`First activated here in ${first.toLocaleString()} race${first === 1 ? '' : 's'}:`);
    lines.push(`team won ${pct(bins.firstWins[bin] / first)}, this uma's average place ${(bins.firstPlaces[bin] / first).toFixed(2)}`);
  }
  return lines;
}

/** The win-rate difference panel for teams i and j. */
function pairHtml(tallies, labels, i, j) {
  const a = tallies[i], b = tallies[j];
  if (i === j) return '<p class="uc-result-pair-note">Pick two different teams to compare.</p>';
  const [difference, half] = pairedDifferenceCi(a.wins.map((win, k) => win - b.wins[k]));
  return `<h3>${esc(a.name)} <span>vs</span> ${esc(b.name)}</h3>
    <div class="uc-result-difference">${signed(difference)}% WR Difference<small>95% CI: [${signed(difference - half)}, ${signed(difference + half)}]</small></div>`;
}

/**
 * Render a finished comparison. With two or more teams, a "Compare" panel picks any two of them
 * and shows their paired win-rate difference with its confidence interval (no re-run needed).
 * `labels` names each team's position ("Team 1", ...).
 */
export function renderResults(container, { race, n, poolSize, tallies, labels = tallies.map((_, i) => `Team ${i + 1}`), compact }) {
  const best = Math.max(...tallies.map((t) => t.winCount));
  let [pairA, pairB] = chosenPairs.get(container) ?? [0, 1];
  if (!tallies[pairA] || !tallies[pairB]) [pairA, pairB] = [0, 1];
  const option = (i, selected) => `<option value="${i}"${i === selected ? ' selected' : ''}>${esc(labels[i])}: ${esc(tallies[i].name)}</option>`;
  const pairPanel = tallies.length < 2 ? '' : `<article class="uc-result-pair">
      <div class="uc-result-pair-pick"><span class="uc-result-eyebrow">Paired comparison</span>
        <div class="uc-result-pair-selects">
          <select class="form-select form-select-sm" data-pair="0" aria-label="First team">${tallies.map((_, i) => option(i, pairA)).join('')}</select>
          <span>vs</span>
          <select class="form-select form-select-sm" data-pair="1" aria-label="Second team">${tallies.map((_, i) => option(i, pairB)).join('')}</select>
        </div>
      </div>
      <div class="uc-result-pair-body">${pairHtml(tallies, labels, pairA, pairB)}</div>
    </article>`;
  container.innerHTML = `<div class="uc-results-heading"><div><span class="uc-result-eyebrow">Comparison complete</span>
    <h2>${esc(raceLabel(race))}</h2></div><p>${n.toLocaleString()} trials · ${poolSize.toLocaleString()} opponent teams<br><span>95% confidence intervals · identical race conditions</span></p></div>
    <div class="uc-result-teams">${tallies.map((t, i) => {
      const [low, high] = wilsonCi(t.winCount, n);
      return `<article class="uc-result-team"><header><div><span class="uc-result-eyebrow">${esc(labels[i])}</span><h3>${esc(t.name)}</h3></div>
        ${t.winCount === best && tallies.filter((x) => x.winCount === best).length === 1 ? '<span class="uc-result-badge">Highest win rate</span>' : ''}</header>
        <div class="uc-result-rate">${pct(t.winCount / n)}<span>team win rate</span></div>
        <div class="uc-result-bar" role="img" aria-label="Win rate ${pct(t.winCount / n)}"><span style="width:${100 * t.winCount / n}%"></span></div>
        <div class="uc-result-rate-note"><span>${t.winCount.toLocaleString()} wins / ${n.toLocaleString()} trials</span><span>95% CI: [${pct(low)}, ${pct(high)}]</span></div>
        <div class="uc-result-runners">${t.team.members.map((m, k) => `<section class="uc-result-runner">
          <div class="uc-result-runner-heading"><img src="${portraitUrl(m)}" alt="" onerror="this.style.visibility='hidden'"><div><h4>${esc(memberName(t.team, k))}</h4><span>${esc(strategyName(m.strategy))}</span></div></div>
          <div class="uc-result-metrics"><div><span>Average place</span>${metric(t.places[k])}</div><div><span>Behind winner</span>${metric(t.distances[k], ' m')}</div><div><span>Finish gap</span>${metric(t.times[k], ' s')}</div></div>
          <details class="uc-result-skills"${compact ? '' : ' open'}><summary>Skill activations <span>${(m.skills ?? []).length} skills</span></summary>
            <ul>${t.binCount ? axisHtml(t.courseDistance) : ''}${(m.skills ?? []).map((s) => {
              const id = String(typeof s === 'object' ? s.skillId : s);
              const rate = (t.skillProcs[k].get(id) ?? 0) / n;
              const bins = t.skillBins?.[k]?.get(id);
              const strip = !t.binCount ? ''
                : `<div class="uc-skill-strip" data-team="${i}" data-runner="${k}" data-skill="${esc(id)}" style="background-image:${stripBackground(bins?.counts ?? new Array(t.binCount).fill(0))}"
                    role="img" aria-label="Where ${esc(skillLabel(Number(id)))} activated"></div>`;
              return `<li><img src="${skillIconUrl(id)}" alt=""><span>${esc(skillLabel(Number(id)))}${s.isUnique ? ` <small>Lv ${esc(s.level)}</small>` : ''}</span><strong>${pct(rate)}</strong>${strip}</li>`;
            }).join('')}</ul><small>Activation rate = races where the skill activated at least once.${t.binCount
              ? ` The strip shows where on the course it activated (${t.binSize} m bins, brighter = more often); hover it for details.` : ''}</small>
          </details></section>`).join('')}</div></article>`;
    }).join('')}</div><div class="uc-result-pairs">${pairPanel}</div>`;

  // Changing either team updates just the comparison panel.
  for (const select of container.querySelectorAll('.uc-result-pair select[data-pair]')) {
    select.addEventListener('change', () => {
      const [a, b] = [...container.querySelectorAll('.uc-result-pair select[data-pair]')].map((s) => Number(s.value));
      chosenPairs.set(container, [a, b]);
      container.querySelector('.uc-result-pair-body').innerHTML = pairHtml(tallies, labels, a, b);
    });
  }
  chosenPairs.set(container, [pairA, pairB]);

  // Hovering an activation strip shows that bin's numbers in a small tooltip.
  const tip = document.createElement('div');
  tip.className = 'uc-strip-tip';
  tip.hidden = true;
  container.append(tip);
  container.onmousemove = (event) => {
    const strip = event.target.closest?.('.uc-skill-strip');
    const tally = strip && tallies[Number(strip.dataset.team)];
    const k = strip && Number(strip.dataset.runner);
    const bins = tally?.skillBins?.[k]?.get(strip.dataset.skill);
    if (!bins) { tip.hidden = true; return; }
    const rect = strip.getBoundingClientRect();
    const bin = Math.min(tally.binCount - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * tally.binCount)));
    tip.innerHTML = binDetail(tally, k, bins, bin).map((line, j) => (j ? esc(line) : `<strong>${esc(line)}</strong>`)).join('<br>');
    tip.hidden = false;
    const box = container.getBoundingClientRect();
    tip.style.left = `${Math.min(event.clientX - box.left + 12, box.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${event.clientY - box.top + 16}px`;
  };
  container.onmouseleave = () => { tip.hidden = true; };
}
