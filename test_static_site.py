"""Checks for the GitHub Pages job snapshot exporter."""

import unittest
from unittest.mock import patch

import server
from export_static_jobs import build_snapshot


class StaticExportTest(unittest.TestCase):
    def test_export_excludes_rate_limited_source_and_reduces_fields(self):
        sources = (("greenhouse", "example", "Example"), ("remotive", "remote-jobs", "Remotive"))
        job = {"id": "example:1", "title": "Design Intern", "url": "https://example.com/job",
               "company": "Example", "summary": "Design experiences", "secret_extra": "not exported"}

        def fake_fetch(*, force):
            self.assertTrue(force)
            self.assertEqual(server.JOB_SOURCES, (sources[0],))
            return {"jobs": [job], "checked_at": "2026-10-30T00:00:00Z", "sources": []}

        with patch.object(server, "JOB_SOURCES", sources):
            result = build_snapshot(fake_fetch)
            self.assertEqual(server.JOB_SOURCES, sources)
        self.assertEqual(result["jobs"][0]["title"], "Design Intern")
        self.assertNotIn("secret_extra", result["jobs"][0])

    def test_empty_feed_does_not_replace_published_site(self):
        with self.assertRaisesRegex(RuntimeError, "No employer jobs"):
            build_snapshot(lambda *, force: {"jobs": [], "checked_at": None, "sources": []})


if __name__ == "__main__":
    unittest.main()
