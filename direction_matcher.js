/* Explainable matching against the fields actually present in the public job feed.
   This is relevance, never a prediction of eligibility or an offer. */
const DirectionMatcher = (() => {
  const activityAreas = {
    build: ['engineering', 'product'], design: ['design', 'product'],
    research: ['research'], analyze: ['data', 'finance'],
    teach: ['education'], grow: ['marketing'], organize: ['business']
  };
  const activityLabels = {
    build: 'building products', design: 'designing experiences',
    research: 'understanding people', analyze: 'working with data',
    teach: 'teaching or helping', grow: 'growing an audience',
    organize: 'planning and operations'
  };
  const meaningfulRoleWords = value => (value.toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) || [])
    .filter(word => !['job', 'jobs', 'role', 'roles', 'work', 'career', 'intern', 'internship',
      'full-time', 'part-time', 'entry', 'level', 'remote', 'looking', 'seeking'].includes(word)).slice(0, 5);
  const hasPhrase = (text, phrase) => {
    const normalized = value => ` ${String(value || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()} `;
    return normalized(text).includes(normalized(phrase));
  };
  const skillPhrases = value => [...new Set(String(value || '').split(/[,;\n]|\band\b/i)
    .map(part => part.trim()).filter(part => part.length >= 2 && part.length <= 50))].slice(0, 8);
  const comparablePay = (job, direction) => job.pay?.currency === 'USD' &&
    job.pay.period === direction.salary_period && Number.isFinite(job.pay.max) && job.pay.max > 0;

  function evaluate(job, profile, direction, helpers) {
    const { categoryTerms, matchesLocation, isSenior, outsideUndergraduateYear } = helpers;
    if (direction.job_type && job.job_type !== direction.job_type) return null;
    if (direction.school_year) {
      if (job.job_type !== 'Internship' || outsideUndergraduateYear(job)) return null;
      if ((job.class_years || []).length && !job.class_years.includes(direction.school_year)) return null;
    }
    const seniorSeeking = /\bsenior\b|\bsr\.?\b|\bstaff\b|\blead\b|\bmanager\b/i.test(profile.role || '');
    if (!seniorSeeking && isSenior(job)) return null;
    if (/\brecruiter\b|talent acquisition|\bsourcer\b/i.test(job.title || '') &&
        !/\brecruit(?:er|ing|ment)?\b|talent acquisition|human resources/i.test(profile.role || '')) return null;
    if (direction.workplace && ['Remote', 'Hybrid', 'On-site'].includes(job.workplace) &&
        job.workplace !== direction.workplace) return null;
    if (direction.salary_min && comparablePay(job, direction) && job.pay.max < direction.salary_min) return null;

    const locationWanted = direction.location_rule !== 'any' && !!(profile.location || '').trim();
    const locationFit = locationWanted ? matchesLocation(job) : null;
    if (locationWanted && direction.location_rule === 'only' && locationFit !== true) return null;

    const title = job.title || '';
    const detail = `${job.department || ''} ${job.summary || ''}`;
    const roleAreas = categoryTerms.filter(area => area.ask.test(profile.role || ''));
    const activityAreasWanted = [...new Set((direction.activities || []).flatMap(activity => activityAreas[activity] || []))];
    const activityCategories = categoryTerms.filter(area => activityAreasWanted.includes(area.name));
    const roleTitle = roleAreas.filter(area => area.title.test(title));
    const roleDetail = roleAreas.filter(area => area.title.test(detail));
    const activityTitle = activityCategories.filter(area => area.title.test(title));
    const activityDetail = activityCategories.filter(area => area.title.test(detail));
    const skillAreas = categoryTerms.filter(area => area.ask.test(profile.skills || ''));
    const skillTitle = skillAreas.filter(area => area.title.test(title));
    const skillDetail = skillAreas.filter(area => area.title.test(detail));
    const uncategorizedRoleWords = roleAreas.length ? [] : meaningfulRoleWords(profile.role || '');
    const wordHits = uncategorizedRoleWords.filter(word => hasPhrase(`${title} ${detail}`, word));
    const skills = skillPhrases(profile.skills).filter(skill =>
      !/^(?:programming|coding|computer science)$/i.test(skill));
    const skillHits = skills.filter(skill => hasPhrase(`${title} ${detail}`, skill));
    const priorities = skillPhrases(profile.priorities);
    const priorityHits = priorities.filter(priority => hasPhrase(`${title} ${detail}`, priority));
    const hasFocus = !!(profile.role || '').trim() || !!(profile.skills || '').trim() ||
      !!(profile.priorities || '').trim() || !!(direction.activities || []).length;
    if (hasFocus && !roleTitle.length && !roleDetail.length && !activityTitle.length &&
        !activityDetail.length && !skillTitle.length && !skillDetail.length &&
        !wordHits.length && !skillHits.length && !priorityHits.length) return null;
    if (roleAreas.length && !roleTitle.length && !roleDetail.length && !wordHits.length &&
        !skillHits.some(skill => skill.length >= 4)) return null;
    if (!hasFocus && !direction.job_type && !direction.school_year && !direction.workplace &&
        !direction.salary_min && !locationWanted) return null;

    const reasons = [];
    const cautions = [];
    let score = roleTitle.length * 35 + roleDetail.length * 11 + activityTitle.length * 20 +
      activityDetail.length * 7 + skillTitle.length * 13 + skillDetail.length * 4 +
      wordHits.length * 9 + skillHits.length * 8 + priorityHits.length * 6;
    if (roleTitle.length) reasons.push(`${roleTitle.slice(0, 2).map(area => area.name).join(' / ')} in the title`);
    else if (roleDetail.length) reasons.push(`${roleDetail[0].name} in the listing preview`);
    else if (wordHits.length) reasons.push(`${wordHits.slice(0, 2).join(' / ')} mentioned`);
    if (activityTitle.length || activityDetail.length) {
      const matched = (direction.activities || []).find(activity =>
        (activityAreas[activity] || []).some(name => [...activityTitle, ...activityDetail].some(area => area.name === name)));
      if (matched) reasons.push(`relates to ${activityLabels[matched]}`);
    }
    if (skillHits.length) reasons.push(`${skillHits.slice(0, 2).join(' and ')} mentioned`);
    else if (skillTitle.length || skillDetail.length) reasons.push(`${skillTitle[0]?.name || skillDetail[0].name} area relates to your experience`);
    else if (skills.length) cautions.push('Skills are not confirmed in the short preview');
    if (priorityHits.length) reasons.push(`${priorityHits.slice(0, 2).join(' and ')} mentioned`);
    else if (priorities.length) cautions.push('Your priorities are not verified in the short preview');
    if (direction.job_type) { reasons.push(`${direction.job_type} listing`); score += 8; }
    if (direction.school_year) {
      if ((job.class_years || []).includes(direction.school_year)) {
        reasons.push(`${direction.school_year} explicitly mentioned`); score += 8;
      } else cautions.push('Student year is not stated');
    }
    if (direction.workplace) {
      if (job.workplace === direction.workplace) { reasons.push(`${direction.workplace} work setup`); score += 7; }
      else cautions.push('Work setup is not stated');
    }
    if (locationWanted) {
      if (locationFit === true) { reasons.push(`location aligns with ${profile.location.trim()}`); score += 24; }
      else { cautions.push(job.location ? `Location differs from ${profile.location.trim()}` : 'Location is not stated'); score -= 12; }
    }
    if (direction.salary_min) {
      if (comparablePay(job, direction)) { reasons.push('published pay range reaches your target'); score += 5; }
      else cautions.push(`Comparable USD/${direction.salary_period} pay is not listed`);
    }
    const posted = Date.parse(job.posted_at || '');
    const daysOld = Number.isFinite(posted) ? Math.max(0, (Date.now() - posted) / 86_400_000) : 0;
    if (daysOld > 365) { score -= 40; cautions.push('Posting date is over a year old; verify it is still open'); }
    else if (daysOld > 180) score -= 15;
    if (job.early_career) score += 4;
    if (!reasons.length) reasons.push('matches your selected search constraints');
    return { job, score, reasons, cautions };
  }

  function matchJobs(jobs, profile, direction, helpers) {
    return jobs.map(job => evaluate(job, profile, direction, helpers)).filter(Boolean)
      .sort((a, b) => b.score - a.score ||
        (Date.parse(b.job.posted_at || '') || 0) - (Date.parse(a.job.posted_at || '') || 0) ||
        a.job.title.localeCompare(b.job.title));
  }
  return { evaluate, matchJobs };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DirectionMatcher;
