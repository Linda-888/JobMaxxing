const test = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('./docs/matching.js');

const jobs = [
  { id: '1', title: 'Software Engineering Intern', company: 'Example', summary: 'Build with Python and JavaScript.',
    job_type: 'Internship', early_career: true, workplace: 'Remote', location: 'Chicago, IL', posted_at: '2026-10-20T00:00:00Z' },
  { id: '2', title: 'Senior Software Engineer', company: 'Example', summary: 'Build with Python.',
    job_type: 'Full-time', early_career: false, workplace: 'On-site', location: 'Austin, TX', posted_at: '2026-10-21T00:00:00Z' },
  { id: '3', title: 'Marketing Intern', company: 'Example', summary: 'Write campaigns.',
    job_type: 'Internship', early_career: true, workplace: 'Hybrid', location: 'Chicago, IL', posted_at: '2026-10-19T00:00:00Z' },
];

test('resume matching uses evidenced role and skill phrases', () => {
  const result = matcher.matchResume(jobs, 'Undergraduate student seeking a software engineering internship. Python projects.');
  assert.deepEqual(result.signals.roles, ['software engineering']);
  assert.ok(result.signals.skills.includes('Python'));
  assert.equal(result.matches[0].job.id, '1');
  assert.ok(!result.matches.some(match => match.job.id === '2'));
  assert.ok(result.matches[0].reasons.some(reason => reason.includes('software engineering')));
});

test('vague text does not fabricate a job match', () => {
  const result = matcher.matchResume(jobs, 'I am motivated and enjoy doing great work.');
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.signals, { roles: [], skills: [] });
});

test('filters combine search, type, and workplace', () => {
  const result = matcher.filterJobs(jobs, { query: 'Chicago', type: 'Internship', workplace: 'Remote', early: true });
  assert.deepEqual(result.map(job => job.id), ['1']);
});

test('search does not treat a preview word as a matching role', () => {
  const result = matcher.filterJobs(jobs, { query: 'campaigns' });
  assert.deepEqual(result, []);
});
