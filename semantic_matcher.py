"""Private, on-server semantic resume matching against public job listings.

Only public posting vectors are written to disk. Resume text and its vectors live
for the duration of the request and are never sent to the model download host.
"""

import gzip
import hashlib
import json
import math
import re
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / ".semantic-assets"
MODEL_NAME = "BAAI/bge-small-en-v1.5"
MODEL_CACHE = ASSETS / "model"
JOB_CACHE = ASSETS / "job-vectors.json.gz"
ROLE_AREAS = (
    ("software engineering", "Software engineering: build applications, APIs, code features, and automated tests."),
    ("data analytics", "Data analytics: analyze datasets, build dashboards, query SQL, and report business insights."),
    ("data science", "Data science: use statistics, experiments, and machine learning to model data."),
    ("product design", "Product design and UX: design digital interfaces, prototypes, and user flows."),
    ("visual design", "Graphic and visual design: create branding, illustrations, and visual assets."),
    ("user research", "User research: interview users, conduct usability studies, and synthesize findings."),
    ("product management", "Product management: define requirements, prioritize features, and plan a roadmap."),
    ("marketing", "Marketing: plan campaigns, create content, and grow customer awareness."),
    ("customer success", "Customer success and support: onboard customers, solve account issues, and help users."),
    ("sales", "Sales and business development: find prospects, develop leads, and close deals."),
    ("education", "Teaching and education: tutor students, teach lessons, and explain concepts."),
    ("operations", "Operations and project coordination: organize schedules, workflows, and delivery."),
    ("cybersecurity", "Cybersecurity: protect systems, investigate threats, and test vulnerabilities."),
    ("finance", "Finance and accounting: manage budgets, financial reports, and accounting records."),
    ("science research", "Scientific research: run experiments, analyze laboratory results, and publish findings."),
    ("writing", "Writing and editorial work: research, write, and edit articles or documentation."),
)
STATED_ROLE_AREAS = {
    "software engineering": "software engineering",
    "software development": "software engineering",
    "data analytics": "data analytics",
    "data science": "data science",
    "product design": "product design",
    "graphic design": "visual design",
    "user research": "user research",
}

_lock = threading.RLock()
_model = None
_posting_vectors = None
_role_vectors = None


def _model_instance():
    global _model
    if _model is None:
        try:
            from fastembed import TextEmbedding
        except ImportError as exc:
            raise RuntimeError("Private semantic matching is not installed on this server.") from exc
        _model = TextEmbedding(model_name=MODEL_NAME, cache_dir=str(MODEL_CACHE), threads=1)
    return _model


def _embed(texts):
    """Serialize model use to keep CPU and memory bounded on a free instance."""
    if not texts:
        return []
    with _lock:
        try:
            return [tuple(float(value) for value in vector)
                    for vector in _model_instance().embed(texts, batch_size=32)]
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError("Private semantic matching is temporarily unavailable.") from exc


def _cosine(left, right):
    # FastEmbed emits unit vectors, but keep this correct for test doubles too.
    dot = sum(a * b for a, b in zip(left, right))
    length = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
    return dot / length if length else 0.0


def posting_texts(job):
    title = re.sub(r"\s+", " ", str(job.get("title") or "")).strip()[:140]
    team = re.sub(r"\s+", " ", str(job.get("department") or "")).strip()[:100]
    summary = re.sub(r"\s+", " ", str(job.get("summary") or "")).strip()[:300]
    return f"{title}. {team}. {summary}".strip(), f"{title}. {team}".strip()


def _posting_key(texts):
    return hashlib.sha256(json.dumps([MODEL_NAME, *texts], ensure_ascii=False).encode()).hexdigest()


def build_public_posting_vectors(jobs):
    """Run during the Render build, never during a visitor's resume request."""
    unique = {_posting_key(posting_texts(job)): posting_texts(job) for job in jobs}
    keys = list(unique)
    full = _embed([unique[key][0] for key in keys])
    titles = _embed([unique[key][1] for key in keys])
    data = {key: [[round(value, 6) for value in full[index]],
                  [round(value, 6) for value in titles[index]]]
            for index, key in enumerate(keys)}
    ASSETS.mkdir(parents=True, exist_ok=True)
    with gzip.open(JOB_CACHE, "wt", encoding="utf-8") as output:
        json.dump({"model": MODEL_NAME, "vectors": data}, output, separators=(",", ":"))
    return len(data)


def _cached_posting_vectors():
    global _posting_vectors
    with _lock:
        if _posting_vectors is None:
            try:
                with gzip.open(JOB_CACHE, "rt", encoding="utf-8") as source:
                    payload = json.load(source)
                _posting_vectors = payload["vectors"] if payload.get("model") == MODEL_NAME else {}
            except (FileNotFoundError, OSError, ValueError, KeyError, TypeError):
                _posting_vectors = {}
        return _posting_vectors


def _job_vectors(jobs):
    cache = _cached_posting_vectors()
    keyed = [(_posting_key(posting_texts(job)), posting_texts(job)) for job in jobs]
    missing = {key: texts for key, texts in keyed if key not in cache}
    if missing:
        keys = list(missing)
        full = _embed([missing[key][0] for key in keys])
        titles = _embed([missing[key][1] for key in keys])
        with _lock:
            for index, key in enumerate(keys):
                cache[key] = [full[index], titles[index]]
    return [cache[key] for key, _ in keyed]


_CONTACT = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|https?://\S+|\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b", re.I)
_SECTION = re.compile(r"^(?:education|experience|work experience|projects?|skills?|technical skills|activities|awards?|contact|summary|objective)\s*:?$", re.I)
_SEEKING = re.compile(r"\b(?:seeking|looking for|applying for|interested in)\b", re.I)
_SHORT_EVIDENCE = re.compile(r"\b(?:projects?|skills?|coursework|experience|using|with|developed|designed|analyzed|built|research)\b", re.I)


def resume_evidence(resume_text):
    """Pick short work/education statements, excluding contact and goal-only lines."""
    snippets = []
    for raw in re.split(r"\n+|(?<=[.!?])\s+(?=[A-Z])", resume_text):
        line = re.sub(r"^[\s•●*\-–]+", "", raw).strip()
        line = _CONTACT.sub("", line).strip(" ,;-·")
        if _SECTION.fullmatch(line):
            continue
        # A summary can mix a career goal with real experience (for example,
        # "CS student seeking a software internship"). Keep any evidence
        # before the goal, but never let the desired job title count as proof.
        intent = _SEEKING.search(line)
        if intent:
            line = line[:intent.start()].strip(" ,;:-")
            if not line:
                continue
        words = re.findall(r"[A-Za-z][A-Za-z+#.-]*", line)
        if (len(words) < 4 or len(line) < 22) and not (
                len(words) >= 2 and len(line) >= 12 and _SHORT_EVIDENCE.search(line)):
            continue
        line = re.sub(r"\s+", " ", line)[:260].rstrip(" ,;:")
        if line.casefold() not in {item.casefold() for item in snippets}:
            snippets.append(line)
        if len(snippets) == 12:
            break
    return snippets


def _roles(vector, prototypes, minimum=0.65):
    scored = sorted(((_cosine(vector, prototype), name)
                     for (name, _), prototype in zip(ROLE_AREAS, prototypes)), reverse=True)
    if not scored or scored[0][0] < minimum:
        return []
    return [scored[0][1]]


def _clear_role(vector, prototypes):
    scores = sorted((_cosine(vector, prototype) for prototype in prototypes), reverse=True)
    return bool(scores and (scores[0] >= 0.80 or scores[0] - scores[1] >= 0.04))


def match_resume_to_jobs(resume_text, jobs, target_role=None):
    """Rank by meaning, then require plausible role alignment before suggesting."""
    import numpy as np

    evidence = resume_evidence(resume_text)
    if not evidence or not jobs:
        return {"matches": [], "roles": [], "has_evidence": bool(evidence)}
    document = "Experience and projects: " + " ".join(evidence)[:1600]
    query_texts = [document, *evidence]
    if target_role:
        query_texts.append(f"Work as a {target_role}.")
    queries = _embed(query_texts)
    document_vector = queries[0]
    evidence_vectors = queries[1:1 + len(evidence)]
    target_vector = queries[-1] if target_role else None
    global _role_vectors
    with _lock:
        if _role_vectors is None:
            _role_vectors = _embed([description for _, description in ROLE_AREAS])
        prototypes = _role_vectors
    resume_roles = _roles(document_vector, prototypes)
    resume_role_clear = bool(resume_roles) and _clear_role(document_vector, prototypes)
    target_roles = ([STATED_ROLE_AREAS[target_role.casefold()]] if target_role and
                    target_role.casefold() in STATED_ROLE_AREAS else
                    _roles(target_vector, prototypes, minimum=0.57) if target_vector else [])
    roles = target_roles or resume_roles
    vectors = _job_vectors(jobs)
    posting_matrix = np.asarray([pair[0] for pair in vectors], dtype=np.float32)
    title_matrix = np.asarray([pair[1] for pair in vectors], dtype=np.float32)
    document_array = np.asarray(document_vector, dtype=np.float32)
    posting_similarities = posting_matrix @ document_array
    title_similarities = title_matrix @ document_array
    evidence_similarities = posting_matrix @ np.asarray(evidence_vectors, dtype=np.float32).T
    role_similarities = title_matrix @ np.asarray(prototypes, dtype=np.float32).T
    second_role_scores = np.partition(role_similarities, -2, axis=1)[:, -2]
    target_similarities = title_matrix @ np.asarray(target_vector, dtype=np.float32) if target_vector else None
    ranked = []
    for index, job in enumerate(jobs):
        top_job_role = int(np.argmax(role_similarities[index]))
        top_role_score = float(role_similarities[index, top_job_role])
        job_roles = [ROLE_AREAS[top_job_role][0]] if top_role_score >= 0.60 else []
        job_role_clear = top_role_score >= 0.80 or top_role_score - second_role_scores[index] >= 0.04
        if target_vector:
            if target_roles and job_roles and job_role_clear and not set(target_roles).intersection(job_roles):
                continue
            if not target_roles and target_similarities[index] < 0.59:
                continue
        elif resume_role_clear and job_roles and not set(resume_roles).intersection(job_roles):
            # Strong meaning overlap may still reveal transferable work.
            if posting_similarities[index] < 0.75:
                continue
        best_index = int(np.argmax(evidence_similarities[index]))
        relevance = (0.68 * float(posting_similarities[index]) +
                     0.22 * float(evidence_similarities[index, best_index]) +
                     0.10 * float(title_similarities[index]))
        if job_roles and (set(resume_roles) | set(target_roles)).intersection(job_roles):
            relevance += 0.018
        minimum = 0.56 if target_roles and job_roles and set(target_roles).intersection(job_roles) else 0.61
        if relevance < (max(minimum, 0.63) if not job.get("summary") else minimum):
            continue
        if job.get("early_career"):
            relevance += 0.012
        if job.get("job_type") == "Internship":
            relevance += 0.012
        score = max(40, min(95, round((relevance - 0.40) * 170)))
        snippet = evidence[best_index].rstrip(". ")
        if len(snippet) > 112:
            snippet = snippet[:113].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
        posting = re.sub(r"\s+", " ", str(job.get("summary") or "")).strip().rstrip(". ")
        if len(posting) > 110:
            posting = posting[:111].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
        connection = (f"The posting describes “{posting}.” " if posting else
                      "The posting gives limited detail about the work. ")
        reason = (f"Your resume describes “{snippet}.” {connection}"
                  "If you apply, highlight that experience and check the requirements.")
        ranked.append((score, relevance, str(job.get("posted_at") or ""), job, reason))
    ranked.sort(key=lambda item: (item[1], item[2]), reverse=True)
    seen, company_counts, matches = set(), {}, []
    for score, _, _, job, reason in ranked:
        company = str(job.get("company") or "").casefold()
        key = (company, str(job.get("title") or "").casefold())
        if key in seen or company_counts.get(company, 0) >= 2:
            continue
        matches.append({"id": job["id"], "score": score, "reason": reason})
        seen.add(key)
        company_counts[company] = company_counts.get(company, 0) + 1
        if len(matches) == 8:
            break
    return {"matches": matches, "roles": roles, "has_evidence": True}
