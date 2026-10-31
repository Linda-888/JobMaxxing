"""Checks that resume evidence, rather than shared buzzwords, drives suggestions."""

import importlib.util
import unittest

import semantic_matcher as matcher


def job(job_id, title, summary, department="", kind="Internship"):
    return {"id": job_id, "title": title, "company": "Example", "summary": summary,
            "department": department, "job_type": kind, "early_career": True}


class EvidenceTest(unittest.TestCase):
    def test_contact_and_aspiration_are_not_treated_as_experience(self):
        text = ("Linda Huang\nlinda@example.com\nSeeking a software engineering internship.\n"
                "Built dashboards with SQL to explain customer retention.\n"
                "Projects\nBuilt dashboards with SQL to explain customer retention.")
        self.assertEqual(matcher.resume_evidence(text),
                         ["Built dashboards with SQL to explain customer retention."])

    def test_aspiration_inside_summary_does_not_outweigh_project_evidence(self):
        text = ("Computer science student seeking a software engineering internship.\n"
                "Built a scheduling app with Python and SQL to help students reserve study rooms.\n"
                "Developed backend APIs and automated tests for the project.")
        self.assertEqual(matcher.resume_evidence(text), [
            "Built a scheduling app with Python and SQL to help students reserve study rooms.",
            "Developed backend APIs and automated tests for the project.",
        ])

    def test_empty_or_goal_only_resume_is_not_ranked(self):
        result = matcher.match_resume_to_jobs("Seeking a software engineering internship.",
                                              [job("eng", "Software Engineer Intern", "Build APIs")],
                                              "software engineering")
        self.assertEqual(result["matches"], [])


@unittest.skipUnless(importlib.util.find_spec("fastembed") and matcher.MODEL_CACHE.exists(),
                     "Run after downloading the private semantic model")
class ModelRegressionTest(unittest.TestCase):
    def test_data_work_does_not_become_software_or_customer_support(self):
        jobs = [
            job("data", "Data Analyst Intern", "Analyze product metrics, build dashboards, and explain trends to business partners.", "Analytics"),
            job("software", "Software Engineer Intern", "Develop backend APIs using Python and SQL and write automated tests.", "Engineering"),
            job("support", "Customer Success Intern", "Onboard customers, troubleshoot account issues, and help people use the product.", "Customer Experience"),
        ]
        result = matcher.match_resume_to_jobs(
            "Built dashboards with SQL to track customer retention and explained trends to business partners.", jobs)
        self.assertEqual([item["id"] for item in result["matches"]], ["data"])
        self.assertEqual(result["roles"], ["data analytics"])
        self.assertIn("Built dashboards", result["matches"][0]["reason"])
        self.assertIn("Analyze product metrics", result["matches"][0]["reason"])

    def test_support_experience_matches_support_without_shared_job_title(self):
        jobs = [
            job("support", "Customer Success Associate", "Guide customers through onboarding and troubleshoot account problems.", "Customer Experience", "Full-time"),
            job("data", "Data Analyst", "Build dashboards and analyze SQL metrics for business partners.", "Analytics", "Full-time"),
        ]
        result = matcher.match_resume_to_jobs(
            "Helped customers resolve account problems and led onboarding sessions for new users.", jobs)
        self.assertEqual([item["id"] for item in result["matches"]], ["support"])

    def test_stated_role_is_respected_even_when_tools_overlap(self):
        jobs = [
            job("software", "Software Engineer Intern", "Build product APIs with Python, SQL, and automated tests.", "Engineering"),
            job("data", "Data Analyst Intern", "Analyze product metrics with Python and SQL and build dashboards.", "Analytics"),
        ]
        result = matcher.match_resume_to_jobs(
            "Python and SQL projects. Seeking a software engineering internship.", jobs, "software engineering")
        self.assertEqual([item["id"] for item in result["matches"]], ["software"])

    def test_transferable_coordination_work_matches_operations(self):
        jobs = [
            job("ops", "Operations Intern", "Keep projects on schedule, coordinate teams, and improve workflows.", "Operations"),
            job("eng", "Software Engineer Intern", "Build APIs, write tests, and ship application code.", "Engineering"),
        ]
        result = matcher.match_resume_to_jobs(
            "Coordinated volunteers, scheduled shifts, and tracked event deadlines for a campus food drive.", jobs)
        self.assertEqual([item["id"] for item in result["matches"]], ["ops"])
        self.assertEqual(result["roles"], ["operations"])


if __name__ == "__main__":
    unittest.main()
