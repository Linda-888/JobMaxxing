"""Build the public, server-free job snapshot used by GitHub Pages."""

import json
from pathlib import Path

import server


OUTPUT = Path(__file__).resolve().parent / "docs" / "jobs.json"
FIELDS = (
    "id", "company", "source", "title", "location", "department", "job_type",
    "early_career", "workplace", "posted_at", "summary", "eligibility_preview",
    "class_years", "pay", "url",
)


def build_snapshot(fetcher=None):
    """Fetch employer boards, excluding Remotive's rate-limited API."""
    original_sources = server.JOB_SOURCES
    server.JOB_SOURCES = tuple(source for source in original_sources if source[0] != "remotive")
    try:
        payload = (fetcher or server.fetch_jobs)(force=True)
    finally:
        server.JOB_SOURCES = original_sources
    jobs = [{key: job.get(key) for key in FIELDS} for job in payload["jobs"]]
    if not jobs:
        raise RuntimeError("No employer jobs were available; keep the previous Pages deployment.")
    return {
        "checked_at": payload["checked_at"],
        "sources": payload["sources"],
        "jobs": jobs,
    }


if __name__ == "__main__":
    snapshot = build_snapshot()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(snapshot['jobs'])} public employer jobs to {OUTPUT}")
