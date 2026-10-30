/* Browser-only relevance rules for the GitHub Pages edition. No hiring prediction. */
const PagesMatcher = (() => {
  const roleSignals = [
    { name: 'software engineering', resume: /\b(?:software engineer(?:ing)?|developer|programmer|computer science)\b/i, job: /\b(?:software|engineer|developer|programmer)\b/i },
    { name: 'product design', resume: /\b(?:product design(?:er)?|ux design|user experience|interaction design)\b/i, job: /\b(?:product design(?:er)?|ux|user experience|interaction design)\b/i },
    { name: 'data', resume: /\b(?:data analy(?:sis|st|tics)|data scien(?:ce|tist)|data engineer(?:ing)?)\b/i, job: /\b(?:data|analytics|analyst)\b/i },
    { name: 'research', resume: /\b(?:research|researcher|research assistant)\b/i, job: /\b(?:research|scientist)\b/i },
    { name: 'marketing', resume: /\b(?:marketing|content strategy|growth marketing)\b/i, job: /\b(?:marketing|content|growth)\b/i },
    { name: 'education', resume: /\b(?:education|teaching|tutoring|learning design)\b/i, job: /\b(?:education|teaching|learning|curriculum)\b/i },
    { name: 'product management', resume: /\b(?:product management|product manager)\b/i, job: /\b(?:product manager|product management|product intern)\b/i },
    { name: 'finance', resume: /\b(?:finance|accounting|financial analysis)\b/i, job: /\b(?:finance|accounting|financial)\b/i },
    { name: 'cybersecurity', resume: /\b(?:cybersecurity|information security|security engineer)\b/i, job: /\b(?:cybersecurity|security engineer|information security)\b/i },
  ];
  const skillSignals = ['Python', 'JavaScript', 'TypeScript', 'Java', 'SQL', 'React', 'Figma', 'Excel',
    'machine learning', 'data analysis', 'user research', 'UX design', 'graphic design',
    'writing', 'customer service', 'project management', 'statistics', 'accessibility', 'HTML', 'CSS'];
  const exactPhrase = (text, phrase) => {
    const clean = value => ` ${String(value || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()} `;
    return clean(text).includes(clean(phrase));
  };

  function signals(text) {
    return {
      roles: roleSignals.filter(item => item.resume.test(text)).map(item => item.name),
      skills: skillSignals.filter(skill => exactPhrase(text, skill)),
    };
  }

  function matchResume(jobs, text) {
    const found = signals(text);
    if (!found.roles.length && !found.skills.length) return { signals: found, matches: [] };
    const student = /\b(?:student|undergraduate|internship|intern|new grad|college|university)\b/i.test(text);
    const matches = [];
    for (const job of jobs) {
      const title = String(job.title || '');
      if (/\b(?:ph\.?d\.?|doctoral|postdoc(?:toral)?)\b/i.test(title)) continue;
      if (student && /\b(?:senior|staff|principal|director|head of|vice president|vp)\b/i.test(title) && job.job_type !== 'Internship') continue;
      const detail = `${job.department || ''} ${job.summary || ''} ${job.eligibility_preview || ''}`;
      let score = 0;
      const reasons = [];
      for (const role of roleSignals.filter(item => found.roles.includes(item.name))) {
        if (role.job.test(title)) { score += 8; reasons.push(`${role.name} in the title`); }
        else if (role.job.test(detail)) { score += 2; reasons.push(`${role.name} in the preview`); }
      }
      const skills = found.skills.filter(skill => exactPhrase(`${title} ${detail}`, skill));
      if (skills.length) { score += Math.min(skills.length, 4) * 2; reasons.push(`${skills.slice(0, 2).join(' and ')} mentioned`); }
      if (!score) continue;
      if (student && job.early_career) score += 3;
      if (student && job.job_type === 'Internship') score += 2;
      matches.push({ job, score, reasons });
    }
    matches.sort((a, b) => b.score - a.score || (Date.parse(b.job.posted_at || '') || 0) -
      (Date.parse(a.job.posted_at || '') || 0));
    return { signals: found, matches: matches.slice(0, 40) };
  }

  function filterJobs(jobs, criteria) {
    const query = String(criteria.query || '').trim().toLowerCase();
    return jobs.filter(job => {
      if (criteria.type && job.job_type !== criteria.type) return false;
      if (criteria.workplace && job.workplace !== criteria.workplace) return false;
      if (criteria.early && !(job.early_career || job.job_type === 'Internship')) return false;
      return !query || `${job.title || ''} ${job.company || ''} ${job.location || ''} ${job.department || ''}`
        .toLowerCase().includes(query);
    }).sort((a, b) => (Date.parse(b.posted_at || '') || 0) - (Date.parse(a.posted_at || '') || 0));
  }
  return { signals, matchResume, filterJobs };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PagesMatcher;
