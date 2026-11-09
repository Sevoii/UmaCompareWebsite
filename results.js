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

export function renderResults(container, { race, n, poolSize, tallies, compact }) {
  const best = Math.max(...tallies.map((t) => t.winCount));
  const pairs = [];
  for (let i = 0; i < tallies.length; i++) for (let j = i + 1; j < tallies.length; j++) {
    const a = tallies[i], b = tallies[j];
    const [difference, half] = pairedDifferenceCi(a.wins.map((win, k) => win - b.wins[k]));
    pairs.push(`<article class="uc-result-pair">
      <div><span class="uc-result-eyebrow">Paired comparison</span><h3>${esc(a.name)} <span>vs</span> ${esc(b.name)}</h3></div>
      <div class="uc-result-difference">${signed(difference)}% WR Difference<small>95% CI: [${signed(difference - half)}, ${signed(difference + half)}]</small></div>
    </article>`);
  }
  container.innerHTML = `<div class="uc-results-heading"><div><span class="uc-result-eyebrow">Comparison complete</span>
    <h2>${esc(raceLabel(race))}</h2></div><p>${n.toLocaleString()} trials · ${poolSize.toLocaleString()} opponent teams<br><span>95% confidence intervals · identical race conditions</span></p></div>
    <div class="uc-result-teams">${tallies.map((t, i) => {
      const [low, high] = wilsonCi(t.winCount, n);
      return `<article class="uc-result-team"><header><div><span class="uc-result-eyebrow">Team ${i + 1}</span><h3>${esc(t.name)}</h3></div>
        ${t.winCount === best && tallies.filter((x) => x.winCount === best).length === 1 ? '<span class="uc-result-badge">Highest win rate</span>' : ''}</header>
        <div class="uc-result-rate">${pct(t.winCount / n)}<span>team win rate</span></div>
        <div class="uc-result-bar" role="img" aria-label="Win rate ${pct(t.winCount / n)}"><span style="width:${100 * t.winCount / n}%"></span></div>
        <div class="uc-result-rate-note"><span>${t.winCount.toLocaleString()} wins / ${n.toLocaleString()} trials</span><span>95% CI: [${pct(low)}, ${pct(high)}]</span></div>
        <div class="uc-result-runners">${t.team.members.map((m, k) => `<section class="uc-result-runner">
          <div class="uc-result-runner-heading"><img src="${portraitUrl(m)}" alt="" onerror="this.style.visibility='hidden'"><div><h4>${esc(memberName(t.team, k))}</h4><span>${esc(strategyName(m.strategy))}</span></div></div>
          <div class="uc-result-metrics"><div><span>Average place</span>${metric(t.places[k])}</div><div><span>Behind winner</span>${metric(t.distances[k], ' m')}</div><div><span>Finish gap</span>${metric(t.times[k], ' s')}</div></div>
          <details class="uc-result-skills"${compact ? '' : ' open'}><summary>Skill activations <span>${(m.skills ?? []).length} skills</span></summary>
            <ul>${(m.skills ?? []).map((s) => {
              const id = String(typeof s === 'object' ? s.skillId : s);
              const rate = (t.skillProcs[k].get(id) ?? 0) / n;
              return `<li><img src="${skillIconUrl(id)}" alt=""><span>${esc(skillLabel(Number(id)))}${s.isUnique ? ` <small>Lv ${esc(s.level)}</small>` : ''}</span><strong>${pct(rate)}</strong></li>`;
            }).join('')}</ul><small>Activation rate = races where the skill activated at least once.</small>
          </details></section>`).join('')}</div></article>`;
    }).join('')}</div><div class="uc-result-pairs">${pairs.join('')}</div>`;
}
