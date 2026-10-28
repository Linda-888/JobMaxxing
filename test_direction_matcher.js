// Repeatable check: run `node --test test_direction_matcher.js` from this directory.
// It checks shortlist rules against small, known postings without any live job-feed dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('./direction_matcher.js');

const categories = [
  { name: 'design', ask: /design|hci/i, title: /design/i },
  { name: 'data', ask: /data|analytics/i, title: /data|analyst|analytics/i },
  { name: 'engineering', ask: /software|engineering|python/i, title: /software|engineer|developer/i }
];
const jobs = [
  { id: 'a', title: 'Data Analyst Intern', company: 'A', job_type: 'Internship', workplace: 'Remote',
    location: 'Chicago, IL', class_years: ['sophomore', 'junior'], summary: 'Analyze data with Python.',
    pay: { currency: 'USD', period: 'hour', min: 25, max: 35 }, early_career: true },
  { id: 'b', title: 'Data Intern', company: 'B', job_type: 'Internship', workplace: '',
    location: 'Chicago, IL', class_years: [], summary: 'Work with analytics teams.', pay: null, early_career: true },
  { id: 'c', title: 'Data Science Intern', company: 'C', job_type: 'Internship', workplace: 'Remote',
    location: 'New York, NY', class_years: ['junior'], summary: 'Use Python.',
    pay: { currency: 'USD', period: 'hour', min: 20, max: 22 }, early_career: true },
  { id: 'd', title: 'Senior Data Analyst', company: 'D', job_type: 'Full-time', workplace: 'Remote',
    location: 'Chicago, IL', class_years: [], summary: 'Analyze data with Python.', pay: null },
  { id: 'e', title: 'Product Designer', company: 'E', job_type: 'Full-time', workplace: 'Hybrid',
    location: 'Chicago, IL', class_years: [], summary: 'Design user experiences.', pay: null },
  { id: 'f', title: 'Sr. Event Marketing Manager, Field Programming', company: 'F',
    job_type: 'Full-time', workplace: '', location: 'Chicago, IL', class_years: [],
    summary: 'Plan field events.', pay: null },
  { id: 'g', title: 'Design Recruiter', company: 'G', job_type: 'Full-time', workplace: 'Remote',
    location: 'Chicago, IL', class_years: [], summary: 'Hire designers.', pay: null }
];
const profile = { role: 'Data analytics', skills: 'Python', location: 'Chicago', priorities: 'Mentorship' };
const direction = { activities: ['analyze'], job_type: 'Internship', school_year: 'sophomore',
  workplace: 'Remote', location_rule: 'prefer', salary_min: 25, salary_period: 'hour' };
function matches(selectedProfile = profile, selectedDirection = direction, location = job => job.location.includes('Chicago')) {
  return matcher.matchJobs(jobs, selectedProfile, selectedDirection, {
    categoryTerms: categories, matchesLocation: location,
    isSenior: job => /senior|\bsr\.|manager/i.test(job.title), outsideUndergraduateYear: () => false
  });
}

test('specific direction excludes known conflicts but retains and flags unknown details', () => {
  const result = matches();
  assert.deepEqual(result.map(match => match.job.id), ['a', 'b']);
  assert.match(result[0].reasons.join(' '), /sophomore explicitly mentioned/);
  assert.match(result[0].reasons.join(' '), /Python mentioned/);
  assert.match(result[1].cautions.join(' '), /Student year is not stated/);
  assert.match(result[1].cautions.join(' '), /Work setup is not stated/);
  assert.match(result[1].cautions.join(' '), /Comparable USD\/hour pay is not listed/);
});

test('activities work before a user knows a job title', () => {
  const result = matches({ role: '', skills: '', location: '', priorities: '' },
    { activities: ['design'], job_type: '', school_year: '', workplace: '',
      location_rule: 'any', salary_min: 0, salary_period: 'year' });
  assert.deepEqual(result.map(match => match.job.id), ['e']);
  assert.match(result[0].reasons.join(' '), /designing experiences/);
});

test('a strict location removes postings elsewhere while a preference keeps them as trade-offs', () => {
  const loose = matches(profile, { ...direction, school_year: '', workplace: '', salary_min: 0 });
  assert.ok(loose.some(match => match.job.id === 'c'));
  assert.match(loose.find(match => match.job.id === 'c').cautions.join(' '), /Location differs/);
  const strict = matches(profile, { ...direction, school_year: '', workplace: '', salary_min: 0,
    location_rule: 'only' });
  assert.ok(!strict.some(match => match.job.id === 'c'));
});

test('an empty direction does not pretend every posting is a match', () => {
  assert.deepEqual(matches({ role: '', skills: '', location: '', priorities: '' },
    { activities: [], job_type: '', school_year: '', workplace: '', location_rule: 'prefer',
      salary_min: 0, salary_period: 'year' }), []);
});

test('HCI and programming do not recommend recruiting or senior event-programming roles', () => {
  const result = matches({ role: 'HCI', skills: 'programming', location: '', priorities: '' },
    { activities: [], job_type: '', school_year: '', workplace: '', location_rule: 'any',
      salary_min: 0, salary_period: 'year' });
  assert.deepEqual(result.map(match => match.job.id), ['e']);
});

test('skills separated by “and” are checked individually against the preview', () => {
  const result = matches({ role: '', skills: 'Python and SQL', location: '', priorities: '' },
    { activities: [], job_type: 'Internship', school_year: '', workplace: '', location_rule: 'any',
      salary_min: 0, salary_period: 'year' });
  assert.match(result.find(match => match.job.id === 'a').reasons.join(' '), /Python mentioned/);
});

test('priorities influence matching only when a posting actually mentions them', () => {
  const profileWithOnlyPriority = { role: '', skills: '', location: '', priorities: 'Mentorship' };
  const directionWithNoFilters = { activities: [], job_type: '', school_year: '', workplace: '',
    location_rule: 'prefer', salary_min: 0, salary_period: 'year' };
  const mentorRole = { ...jobs[0], id: 'mentor', summary: 'Mentorship is available with the data team.' };
  const otherRole = { ...jobs[0], id: 'other', summary: 'Analyze public data with Python.' };
  const result = matcher.matchJobs([mentorRole, otherRole], profileWithOnlyPriority, directionWithNoFilters, {
    categoryTerms: categories, matchesLocation: () => null,
    isSenior: () => false, outsideUndergraduateYear: () => false
  });
  assert.deepEqual(result.map(match => match.job.id), ['mentor']);
  assert.match(result[0].reasons.join(' '), /Mentorship mentioned/);
});

test('older postings fall behind otherwise comparable recent ones and carry a warning', () => {
  const recent = { ...jobs[4], id: 'recent', posted_at: new Date().toISOString() };
  const old = { ...jobs[4], id: 'old', posted_at: '2019-01-01T00:00:00Z' };
  const result = matcher.matchJobs([old, recent], { role: 'design', skills: '', location: '', priorities: '' },
    { activities: [], job_type: '', school_year: '', workplace: '', location_rule: 'any',
      salary_min: 0, salary_period: 'year' }, {
      categoryTerms: categories, matchesLocation: () => null,
      isSenior: () => false, outsideUndergraduateYear: () => false
    });
  assert.deepEqual(result.map(match => match.job.id), ['recent', 'old']);
  assert.match(result[1].cautions.join(' '), /over a year old/);
});
