"""Prepare a private model and current public-posting vectors at build time."""

import json
from pathlib import Path

from semantic_matcher import build_public_posting_vectors
import server


ROOT = Path(__file__).resolve().parent


if __name__ == "__main__":
    jobs = json.loads((ROOT / "docs" / "jobs.json").read_text(encoding="utf-8"))["jobs"]
    try:
        current = server.fetch_jobs(force=True)["jobs"]
        jobs = list({job["id"]: job for job in [*jobs, *current]}.values())
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"Current feeds unavailable during build ({exc}); using the checked-in snapshot.")
    if not jobs:
        raise RuntimeError("Cannot prepare semantic matching without public job listings.")
    print(f"Prepared semantic vectors for {build_public_posting_vectors(jobs)} public postings.")
