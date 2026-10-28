# JobMaxxing — What's Out There notes

These are starting notes for our research, not a decision about what to build. The product descriptions below are from general knowledge and may have changed. On October 2, 2026, we also read public Reddit discussions *about* Handshake, LinkedIn, and Indeed (links below); we did not test those products' current behavior. Individual posts are anecdotes, not proof of prevalence or a platform's motives. We should still check the actual sites and talk to classmates.

## The problem I'm looking at

“I think people often cannot find the job that fits them.” That's the part of the job search I want to investigate first. Finding a job can involve searching several sites and deciding which listings are worth the time. The original idea also mentions a priority “to apply” list, applying, and tracking results, but I haven't established that those are the main problem. I want to ask people what “fits” means to them and where their searches break down.

## Who might have this problem?

- Students looking for internships or their first job, who may have little experience and limited time around classes.
- Recent graduates and other job seekers sending many applications.
- People changing fields, who may not know which roles match their background.

These groups might need different things. “People who need employment” is broad; we should ask classmates which group they actually know and can learn from.

## How people handle it now

- Search on a school career site, company career pages, LinkedIn, Indeed, and other boards; save links or browser tabs.
- Keep a spreadsheet, notes app, or email folder for roles, dates, contacts, and application status.
- Reuse a résumé and cover-letter drafts, while editing answers or uploading files on each employer's site.
- Ask friends, alumni, career services, or recruiters for leads and feedback.

Questions to test: How many places does one person search? What do they record? What gets forgotten? Does the tedious part happen before, during, or after applying?

## Existing things to look at together

| Example | What it seems to cover | What to check / possible gap |
| --- | --- | --- |
| Handshake | Student-focused job and internship listings, often tied to a university. | Are the roles relevant to our classmates? What happens when a listing sends them to an outside employer site? |
| Simplify | Job discovery, application form autofill, and application tracking for some job searches. | Which sites and fields does it really support? What still needs manual work? How does it handle accuracy and privacy? |
| Teal | Organizing a job search and tracking applications, with résumé-related tools. | Does it help find good roles, or mainly organize ones the user already found? What is free versus paid? |

Other comparisons worth checking later: LinkedIn and Indeed for discovery and “easy apply”; Huntr for tracking; Jobscan for résumé/job-description comparison. These are leads, not an exhaustive list.

## Complaints and tradeoffs to investigate, not assume

- The same job appears in multiple places or is old, irrelevant, or already filled.
- “Easy apply” can make sending applications fast without making it clear whether they are a good match or were reviewed.
- Re-entering work history on employer sites can be repetitive; autofill can put the wrong answer in the wrong field.
- An application tracker still takes effort if it does not update when a person applies elsewhere.
- Uploading a résumé or giving a browser extension access to job sites raises privacy and trust questions.
- Rejections and silence make it hard to tell which parts of a search are working. More applications do not necessarily mean better outcomes.

Find actual examples of these complaints in conversations, reviews, or forum posts. Record who said it and where; don't present this list as evidence on its own.

## What to do in the browser / with classmates

1. Open Handshake, Simplify, and Teal. For each, write down what a new user can actually do, what requires payment or an account, and what happens when a job is on an employer's own website.
2. Ask two classmates who have applied recently: “Walk me through your last application, from finding the role to following up.” Ask where they got stuck; don't pitch an app yet.
3. Find two or three specific user complaints (with links or screenshots and dates). Look for repeated problems, not only one dramatic story.

## My own words and evidence to add

- My current view of the problem: “I think people often cannot find the job that fits them.”
- What “fits” means to me: _[fill in after talking it through]_
- Who I most want to learn from: _[fill in]_
- My or a classmate's real experience: _[fill in]_
- What surprised me when I checked the existing tools: _[fill in]_
- Links, dates, and exact complaints: _[fill in]_
- What still seems unclear: _[fill in]_

No feature list or build plan yet; first find out which pain is real and how existing tools already address it.

## Three possible matching problems to check

These are possible problems, not findings from interviews yet.

1. **Hard to tell if you qualify.** Listings can use vague titles or long requirements, and a person may not know whether their classes, projects, or experience count.
2. **Hard to tell if you'd actually want the job.** A listing may not clearly show the day-to-day work, pay, location, schedule, or workplace expectations. A skills match is not necessarily a personal fit.
3. **Hard to find relevant, trustworthy openings.** The same role may appear on many sites, and some listings may be old, misleading, or unavailable by the time a person applies. Searching through them takes time.

Interview prompt: “Tell me about a listing you thought was a good match, or one you skipped. What made you decide?” We can compare real stories with these three guesses.

## What people actually reported in public discussions

These are users' accounts on Reddit, **not** verified platform-wide facts or statements made by Handshake, LinkedIn, or Indeed. Some posts are several years old. I grouped them by the problem they describe rather than assuming any one platform is always like this.

1. **The match can be wrong even when the profile or search is specific.** In a [Handshake discussion](https://www.reddit.com/r/highereducation/comments/sity7u/handshake_college_job_search_engine_what_do_you/), one former graduate student said recruiters still sent undergraduate internships despite updated information. Another described a web-development credential prompting a trucking-job message. A recent graduate reported offers outside their location or chosen fields. In an [Indeed discussion](https://www.reddit.com/r/IndeedJobs/comments/1n4gnkm/why_am_i_unable_to_find_any_relevant_jobs/), the original poster wanted basic customer-service roles in e-commerce or retail but got unrelated industries and titles requiring different skills. Their problem wasn't simply a lack of jobs: it was sorting out the right kind.
2. **Old or repeated listings make new opportunities harder to spot.** A [LinkedIn discussion](https://www.reddit.com/r/linkedin/comments/1kajmph/why_do_so_many_jobs_keep_reposting_on_linkedin/) describes the same roles reappearing in searches. A commenter said a “new” listing took them to a company site that said they had already applied. In the [Indeed discussion](https://www.reddit.com/r/IndeedJobs/comments/1n4gnkm/why_am_i_unable_to_find_any_relevant_jobs/), a person said jobs remained on the board after a rejection and another described going through pages of unwanted listings to reach useful ones. A repost alone does **not** establish that a job is fake: another commenter said they had interviewed for a reposted role, and an employer described relisting when the first applicant pool did not work out.
3. **Job labels don't reliably explain the real role.** In the [Indeed discussion](https://www.reddit.com/r/IndeedJobs/comments/1n4gnkm/why_am_i_unable_to_find_any_relevant_jobs/), a person searching for entry-level “CSR” said results also included “customer success” jobs needing different skills. Another commenter said similar release-management work appeared under several different titles, and described a hiring manager admitting that one opening's advertised title attracted the wrong candidates. This makes both searching and deciding whether to apply harder.

Counterexamples matter: in the [Handshake discussion](https://www.reddit.com/r/highereducation/comments/sity7u/handshake_college_job_search_engine_what_do_you/), a staff member said it worked well at their university for vetted internships and entry-level jobs, and another said on-campus opportunities were easier to find there. One person's complaint does not mean a platform never works.

**What people do now:** refine search terms and exclusions, filter for recency, check employer career pages, keep their own lists, or use more than one board. These workarounds also came up in the discussions; whether they help our classmates is still an open question.

**Question for classmates:** “Show me the last search where results didn't fit. Which listings were wrong, and why? Did you miss a role because of its title, requirements, location, or age?” Record their exact examples before drawing a conclusion.

### Which fields did those commenters mention?

- **Indeed:** The original poster was looking for entry-level customer-service representative (CSR) or data-entry work, preferably CSR in e-commerce or retail rather than finance or healthcare. They said “customer success” results required more skills than the basic CSR work they wanted. This is the clearest specific example of a desired field in our sources.
- **Handshake:** One commenter had a multi-device web-development credential but received a trucking-job message. Another recent graduate was looking in nonprofit work, grant writing, or academic advising. A graduate student who received undergraduate internship messages did not specify their discipline in the comment we read.
- **LinkedIn:** The person discussing repeated listings and the commenter who encountered a role they had already applied for did not identify a particular field. Their examples support the repeated-listings issue, not a conclusion about one industry.

The examples span different searches; we should not say all these people were pursuing tech jobs, or that a single field is especially affected.

## Existing matching tools to inspect with my partner

- **Handshake:** Its [profile help page](https://support.joinhandshake.com/hc/en-us/articles/115009543967-Completing-your-Profile-in-Handshake) says a completed profile is used to tailor job and internship recommendations to interests, skills, and experience. The “Looking for” section lets a person specify a job type (such as internship or full-time), desired roles, industries, and locations. This is an official description, not a hands-on test of the recommendations. Compare it with the mismatched-message stories above.
- **LinkedIn:** The official [Skills Match insight](https://www.linkedin.com/help/linkedin/answer/a793433), [how you match up with jobs](https://www.linkedin.com/help/linkedin/answer/a7120158), and [job recommendations](https://www.linkedin.com/help/linkedin/answer/a512279) Help pages appeared in search results. Their snippets say the site compares profile or résumé skills and experience with job qualifications and uses profile details for recommendations. **We did not open these Help pages or test the logged-in feature**, so my partner should verify exactly what a user sees and whether any part requires a paid account.
- **Indeed:** We have [job seekers' discussion](https://www.reddit.com/r/IndeedJobs/comments/1n4gnkm/why_am_i_unable_to_find_any_relevant_jobs/) about results outside their desired field, but we have **not** checked Indeed's official explanation of how its matching or filters work. This remains a comparison to do.

What to look for on each site: Can I choose a field and job type? Can I add skills learned through projects, not only past jobs? Does a job show *why* it fits or doesn't fit? Can I exclude an unwanted industry or location? Do the results match the preferences I entered? Record one example result and the date, without uploading anyone's résumé to a third-party site for this research.

### Cassie.AI (possibly what I meant by “cassy”)

On October 2, 2026, I found [Cassie.AI](https://cassie.ai/) and read its [About page](https://cassie.ai/about). The company says it recommends jobs using a person's **skills, experience, and aspirations**, searches jobs from employer career sites and job boards, and offers career questions, résumé/cover-letter help, interview practice, and skills-gap analysis. It says it learns from preferences. These are the company's descriptions, **not** a test of the quality of its matches or proof of how many jobs are available. We did not sign in or upload a résumé.

For the class comparison: Ask whether Cassie suggests jobs in the person's chosen field and level, whether it explains the match and missing qualifications, and how current or trustworthy the listings are. This means the general idea of AI skill-based matching already has an example; the remaining question is whether real job seekers still have an unmet problem.
