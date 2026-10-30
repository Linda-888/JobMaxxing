"""Focused integration test for the local account and onboarding flow."""

import http.cookiejar
import io
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from unittest.mock import patch

import server
from http.server import ThreadingHTTPServer


class LocalFlowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_db = server.DB_PATH
        server.DB_PATH = Path(self.temp.name) / "app.sqlite3"
        server.init_db()
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"
        self.client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.ai_patch = patch.dict(os.environ, {"OPENAI_API_KEY": ""})
        self.ai_patch.start()
        self.local_ai_patch = patch.object(server, "local_model_ready", return_value=False)
        self.local_ai_patch.start()

    def tearDown(self):
        self.local_ai_patch.stop()
        self.ai_patch.stop()
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)
        server.DB_PATH = self.original_db
        self.temp.cleanup()

    def request(self, route, body=None, origin=None):
        data = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if origin:
            headers["Origin"] = origin
        request = Request(self.base + route, data=data, headers=headers)
        try:
            response = self.client.open(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = raw
            return response.status, payload

    def request_multipart(self, route, filename, payload, origin=None):
        boundary = "resume-test-boundary"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"resume\"; filename=\"{filename}\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n").encode() + payload + f"\r\n--{boundary}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if origin:
            headers["Origin"] = origin
        request = Request(self.base + route, data=body, headers=headers)
        try:
            response = self.client.open(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_homepage_names_job_matching_without_claiming_every_job_is_ai_ranked(self):
        status, page = self.request("/")
        self.assertEqual(status, 200)
        html = page.decode("utf-8")
        self.assertIn("<title>JobMaxxing · Find Your Next Move</title>", html)
        self.assertIn('<span class="brand-symbol">J<span>✦</span>', html)
        self.assertIn('id="discover-eyebrow" class="eyebrow-blue">JOB MATCHING', html)
        self.assertIn('id="dashboard-greeting">Find your fit.', html)
        self.assertEqual(html.count('aria-label="Tour this site" title="Tour this site"'), 2)
        self.assertEqual(html.count('class="guide-open-mark" aria-hidden="true">Tour</span>'), 2)
        self.assertNotIn('How it works', html)
        self.assertIn('font-weight="800" letter-spacing="-3" fill="#fff">AI</text>', html)
        self.assertIn('id="guided-chat-icon"', html)
        self.assertIn('id="resume-match-heading">AI resume matching', html)
        self.assertIn('class="side-nav side-nav-resume" data-view="resume"', html)
        self.assertIn('id="discover-open-resume"', html)
        self.assertIn('id="resume-view" class="dashboard-view"', html)
        self.assertIn('id="dashboard-resume-dropzone"', html)
        self.assertIn('id="mini-resume-dropzone"', html)
        self.assertIn('data-view="resume" type="button">⇧<span>Resume</span>', html)
        self.assertIn('id="chat-guide-title">Your AI career guide', html)
        self.assertIn('current public jobs', html)
        self.assertIn('These are possible connections, not eligibility or hiring predictions.', html)
        status, script = self.request("/app.js")
        self.assertEqual(status, 200)
        self.assertIn("'JOB MATCHING'", script.decode("utf-8"))
        self.assertIn("state.publicDemo ? 'Keyword matching' : 'On-device AI'", script.decode("utf-8"))
        self.assertIn("Verify eligibility on the employer posting.", script.decode("utf-8"))

    def test_account_chat_progress_and_private_files(self):
        with patch.object(server, "fetch_jobs", return_value={"jobs": [], "sources": [], "checked_at": server.utc_now()}):
            status, result = self.request("/api/jobs")
        self.assertEqual(status, 200)
        self.assertEqual(result["jobs"], [])
        status, _ = self.request("/data/app.sqlite3")
        self.assertEqual(status, 404)
        status, result = self.request("/api/auth/register", {
            "name": "Test Student", "email": "student@example.test", "password": "unique-test-password-123"
        })
        self.assertEqual(status, 201)
        self.assertEqual(result["stage"], "onboarding")
        self.assertEqual(result["user"]["name"], "Test Student")
        status, result = self.request("/api/onboarding/complete", {})
        self.assertEqual((status, result["stage"]), (200, "discover"))
        status, result = self.request("/api/auth/register", {
            "name": "Another", "email": "student@example.test", "password": "another-long-password"
        })
        self.assertEqual(status, 400)
        self.assertIn("already registered", result["error"])
        for answer in ("Product design internship", "User research and Python", "Chicago or remote"):
            status, result = self.request("/api/chat", {"message": answer})
            self.assertEqual(status, 200)
            self.assertEqual(result["mode"], "preview")
        self.assertEqual(result["progress"], 3)
        status, result = self.request("/api/onboarding/complete", {})
        self.assertEqual((status, result["stage"]), (200, "discover"))
        status, result = self.request("/api/saved", {"job_id": "figma:123", "saved": True})
        self.assertEqual(status, 200)
        status, result = self.request("/api/saved", {"job_id": "lever-palantir:6ed76ce8-4156-4b60-b120-403538bd66cd", "saved": True})
        self.assertEqual(status, 200)
        snapshot = {"id": "figma:456", "title": "Design Intern", "company": "Figma",
                    "url": "https://job-boards.greenhouse.io/figma/jobs/456", "source": "Greenhouse"}
        temporary_cache = {"sources": {"greenhouse:figma": {"jobs": [snapshot]}}, "checked_at": server.utc_now(), "expires": 0}
        with patch.object(server, "job_cache", temporary_cache):
            status, _ = self.request("/api/saved", {"job_id": "figma:456", "saved": True})
        self.assertEqual(status, 200)
        status, result = self.request("/api/session")
        self.assertEqual(result["stage"], "discover")
        self.assertEqual(len(result["messages"]), 6)
        self.assertIn("figma:123", result["saved"])
        self.assertIn("lever-palantir:6ed76ce8-4156-4b60-b120-403538bd66cd", result["saved"])
        self.assertEqual(result["saved_jobs"][0]["url"], snapshot["url"])
        status, _ = self.request("/api/auth/logout", {})
        self.assertEqual(status, 200)
        status, result = self.request("/api/session")
        self.assertIsNone(result["user"])
        status, result = self.request("/api/auth/login", {
            "email": "student@example.test", "password": "unique-test-password-123"
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["stage"], "discover")

    def test_guest_chat_needs_no_account_and_is_not_stored_on_server(self):
        status, result = self.request("/api/guest/chat", {
            "message": "Product design internship", "profile": server.EMPTY_PROFILE, "messages": []
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["mode"], "preview")
        self.assertEqual(result["profile"]["role"], "Product design internship")
        with server.connect_db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 0)
        status, _ = self.request("/api/guest/import", {"guest": {}})
        self.assertEqual(status, 401)
        status, _ = self.request("/api/guest/chat", {"message": "", "profile": server.EMPTY_PROFILE})
        self.assertEqual(status, 400)
        status, result = self.request("/api/recommendations", {"profile": server.EMPTY_PROFILE})
        self.assertEqual(status, 503)
        self.assertIn("not connected", result["error"])

    def test_public_demo_is_guest_only_and_resume_matches_without_ai(self):
        job = {"id": "figma:demo", "title": "Software Engineer Intern", "company": "Figma",
               "summary": "Build software with Python and SQL.", "job_type": "Internship",
               "location": "Remote - United States", "workplace": "Remote", "early_career": True,
               "posted_at": "2026-10-28", "department": "Engineering"}
        resume = b"Computer science student seeking a remote software engineering internship. Python and SQL projects."
        with patch.object(server, "PUBLIC_DEMO", True), \
                patch.object(server, "fetch_jobs", return_value={"jobs": [job]}) as fetch:
            status, session = self.request("/api/session")
            self.assertEqual(status, 200)
            self.assertTrue(session["public_demo"])
            self.assertIsNone(session["user"])
            self.assertFalse(session["ai"])
            status, _ = self.request("/api/auth/register", {"name": "Test", "email": "test@example.test",
                                                              "password": "test-password-123"}, origin=self.base)
            self.assertEqual(status, 404)
            status, _ = self.request("/api/guest/chat", {"message": "I like software engineering.",
                                                        "profile": server.EMPTY_PROFILE, "messages": []})
            self.assertEqual(status, 400)  # Public POST requests need a same-site Origin.
            status, result = self.request("/api/guest/chat", {"message": "I like software engineering.",
                                                             "profile": server.EMPTY_PROFILE, "messages": []}, origin=self.base)
            self.assertEqual(status, 200)
            self.assertEqual(result["mode"], "preview")
            status, result = self.request_multipart("/api/resume-recommendations", "resume.txt", resume,
                                                    origin=self.base)
            self.assertEqual(status, 200)
            self.assertEqual(result["mode"], "keyword")
            self.assertEqual(result["matches"][0]["id"], job["id"])
            self.assertIn("Python", result["signals"]["skills"])
            status, _ = self.request("/api/jobs?refresh=1")
            self.assertEqual(status, 200)
            fetch.assert_called_with(False)

    def test_exploration_path_keeps_interests_open_and_account_choice_persists(self):
        status, guest = self.request("/api/guest/chat", {
            "message": "I like helping people, but have no idea what job I want.",
            "chat_mode": "explore", "profile": server.EMPTY_PROFILE, "messages": []
        })
        self.assertEqual(status, 200)
        self.assertEqual(guest["profile"]["role"], "")
        self.assertIn("explore", guest["reply"].lower())
        self.assertIn("browse", guest["reply"].lower())

        status, registered = self.request("/api/auth/register", {
            "name": "Path Tester", "email": "path@example.test", "password": "test-password-123"
        })
        self.assertEqual(status, 201)
        self.assertEqual(registered["chat_mode"], "")
        status, selected = self.request("/api/chat/mode", {"chat_mode": "explore"})
        self.assertEqual((status, selected["chat_mode"]), (200, "explore"))
        self.assertEqual(selected["messages"], [
            {"role": "user", "content": "I'm still exploring"},
            {"role": "assistant", "content": server.CHAT_PATH_STARTS["explore"][1]}
        ])
        status, repeated = self.request("/api/chat/mode", {"chat_mode": "explore"})
        self.assertEqual((status, repeated["messages"]), (200, []))
        status, result = self.request("/api/chat", {"message": "I like helping people."})
        self.assertEqual(status, 200)
        self.assertEqual(result["profile"]["role"], "")
        status, session = self.request("/api/session")
        self.assertEqual((status, session["chat_mode"]), (200, "explore"))
        self.assertEqual(session["messages"][0:2], selected["messages"])
        self.assertEqual(session["messages"][2]["content"], "I like helping people.")
        status, _ = self.request("/api/chat/mode", {"chat_mode": "invalid"})
        self.assertEqual(status, 400)
        status, session = self.request("/api/session")
        self.assertEqual(session["chat_mode"], "explore")
        status, changed = self.request("/api/chat/mode", {"chat_mode": "directed"})
        self.assertEqual(status, 200)
        self.assertEqual(changed["messages"][0]["content"], "I have a direction")
        status, session = self.request("/api/session")
        self.assertEqual(session["chat_mode"], "directed")
        self.assertEqual(session["messages"][-2:], changed["messages"])

    def test_guest_exploration_choice_follows_signup(self):
        status, _ = self.request("/api/auth/register", {
            "name": "Guest Tester", "email": "guest-path@example.test", "password": "test-password-123"
        })
        self.assertEqual(status, 201)
        status, _ = self.request("/api/guest/import", {"guest": {
            "profile": server.EMPTY_PROFILE, "messages": [], "saved": [], "saved_jobs": [],
            "chat_mode": "explore"
        }})
        self.assertEqual(status, 200)
        status, session = self.request("/api/session")
        self.assertEqual((status, session["chat_mode"]), (200, "explore"))

    def test_existing_account_choice_is_backfilled_once_in_chat_history(self):
        status, _ = self.request("/api/auth/register", {
            "name": "Existing Tester", "email": "existing-path@example.test", "password": "test-password-123"
        })
        self.assertEqual(status, 201)
        with server.connect_db() as db:
            user_id = db.execute("SELECT id FROM users WHERE email=?", ("existing-path@example.test",)).fetchone()["id"]
            db.execute("UPDATE users SET chat_mode='explore' WHERE id=?", (user_id,))
            db.execute("INSERT INTO messages (user_id,role,content,created_at) VALUES (?,?,?,?)",
                       (user_id, "user", "old conversation", server.utc_now()))

        server.init_db()
        status, session = self.request("/api/session")
        self.assertEqual(session["chat_mode"], "explore")
        self.assertEqual([item["content"] for item in session["messages"][-2:]], [
            server.CHAT_PATH_STARTS["explore"][0], server.CHAT_PATH_STARTS["explore"][1]
        ])
        server.init_db()
        status, session = self.request("/api/session")
        self.assertEqual(sum(item["content"] == server.CHAT_PATH_STARTS["explore"][0]
                             for item in session["messages"]), 1)

    def test_exploration_ai_prompt_and_profile_do_not_invent_direction(self):
        response = {"message": {"content": json.dumps({
            "reply": "Helping people matters to you. Which activities have you enjoyed?",
            "profile": {"role": "helping people", "skills": "", "location": "", "priorities": ""}
        })}}
        with patch.object(server, "local_model_ready", return_value=True), \
                patch.object(server, "fetch_json", return_value=response) as fetch:
            status, result = self.request("/api/guest/chat", {
                "message": "I like helping people.", "chat_mode": "explore",
                "profile": server.EMPTY_PROFILE, "messages": []
            })
        self.assertEqual(status, 200)
        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["profile"]["role"], "")
        prompt = json.loads(fetch.call_args.kwargs["data"])["messages"][0]["content"]
        self.assertIn("exploration", prompt.lower())
        self.assertIn("keep role empty", prompt)

    def test_guided_chat_shows_jobs_without_repeated_questions(self):
        profile = dict(server.EMPTY_PROFILE)
        messages = []
        for answer, asks_question in (("I want a job", True), ("internship", False),
                                      ("Product design internship in Chicago", False)):
            status, result = self.request("/api/guest/chat", {
                "message": answer, "profile": profile, "messages": messages
            })
            self.assertEqual((status, result["mode"]), (200, "preview"))
            self.assertEqual("?" in result["reply"], asks_question)
            self.assertIn("browse", result["reply"].lower())
            profile = result["profile"]
            messages.extend(({"role": "user", "content": answer},
                             {"role": "assistant", "content": result["reply"]}))
        self.assertEqual(profile["role"], "internship")
        self.assertNotEqual(profile["skills"], "internship")

        vague_messages = []
        for answer, asks_question in (("Not sure", True), ("idk", False)):
            status, result = self.request("/api/guest/chat", {
                "message": answer, "profile": server.EMPTY_PROFILE, "messages": vague_messages
            })
            self.assertEqual(status, 200)
            self.assertEqual("?" in result["reply"], asks_question)
            self.assertIn("browse", result["reply"].lower())
            vague_messages.extend(({"role": "user", "content": answer},
                                   {"role": "assistant", "content": result["reply"]}))

    def test_local_ai_chat_without_an_api_key(self):
        model_reply = {"message": {"content": json.dumps({
            "reply": "What kind of Python projects have you enjoyed?",
            "profile": {"role": "software internship", "skills": "Python",
                        "location": "remote", "priorities": ""}
        })}}
        profile = {"role": "software internship", "skills": "Python", "location": "remote", "priorities": ""}
        with patch.object(server, "local_model_ready", return_value=True), \
                patch.object(server, "fetch_json", return_value=model_reply) as fetch:
            status, session = self.request("/api/session")
            self.assertEqual((status, session["ai"], session["ai_provider"]), (200, True, "local"))
            status, result = self.request("/api/guest/chat", {
                "message": "I know Python. What should I explore?", "profile": profile, "messages": []
            })
        self.assertEqual(status, 200)
        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["reply"], "What kind of Python projects have you enjoyed?")
        self.assertEqual(result["profile"]["skills"], "Python")
        self.assertEqual(fetch.call_args.args[0], "http://127.0.0.1:11434/api/chat")
        sent = json.loads(fetch.call_args.kwargs["data"])
        self.assertEqual(sent["model"], "qwen2.5:3b")
        self.assertEqual(sent["messages"][-1]["content"], "I know Python. What should I explore?")
        self.assertFalse(sent["stream"])
        self.assertEqual(sent["format"], server.CHAT_SCHEMA)

    def test_model_parse_failure_keeps_chat_and_jobs_usable(self):
        bad_response = json.JSONDecodeError("incomplete model response", "{", 1)
        with patch.object(server, "local_model_ready", return_value=True), \
                patch.object(server, "fetch_json", side_effect=bad_response):
            status, result = self.request("/api/guest/chat", {
                "message": "Design internship", "profile": server.EMPTY_PROFILE, "messages": []
            })
        self.assertEqual(status, 200)
        self.assertEqual((result["mode"], result["ai_provider"]), ("preview", "local"))
        self.assertIn("job list is still updated", result["reply"])
        self.assertEqual(result["profile"]["role"], "Design internship")

        status, _ = self.request("/api/auth/register", {
            "name": "Fallback Student", "email": "fallback@example.test", "password": "unique-test-password-123"
        })
        self.assertEqual(status, 201)
        with patch.object(server, "local_model_ready", return_value=True), \
                patch.object(server, "fetch_json", side_effect=bad_response):
            status, result = self.request("/api/chat", {"message": "Design internship"})
        self.assertEqual(status, 200)
        self.assertEqual(result["mode"], "preview")
        status, session = self.request("/api/session")
        self.assertEqual(len(session["messages"]), 2)

    def test_ai_recommendation_endpoint_accepts_guest_profile(self):
        profile = {"role": "software engineering", "skills": "Python", "location": "Chicago", "priorities": "learning"}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), \
                patch.object(server, "recommend_jobs", return_value={"matches": [{
                    "id": "figma:101", "score": 88, "reason": "Relevant software internship."}]}) as recommend:
            status, result = self.request("/api/recommendations", {"profile": profile})
        self.assertEqual(status, 200)
        self.assertEqual(result["matches"][0]["id"], "figma:101")
        recommend.assert_called_once_with(profile)

    def test_resume_text_reader_accepts_txt_and_docx_and_enforces_limits(self):
        text = "Python, SQL, and statistics student with analytics project experience."
        self.assertEqual(server.resume_text_from_upload("resume.txt", text.encode()), text)
        document = io.BytesIO()
        xml = ("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
               "<w:body><w:p><w:r><w:t>Python analytics projects</w:t></w:r></w:p></w:body></w:document>")
        with zipfile.ZipFile(document, "w") as archive:
            archive.writestr("word/document.xml", xml)
        self.assertIn("Python analytics projects", server.resume_text_from_upload("resume.docx", document.getvalue()))
        with self.assertRaisesRegex(ValueError, "5 MB"):
            server.resume_text_from_upload("resume.txt", b"a" * (server.RESUME_UPLOAD_LIMIT + 1))
        with self.assertRaisesRegex(ValueError, "PDF, DOCX, or TXT"):
            server.resume_text_from_upload("resume.pages", b"not a supported format")

    @unittest.skipUnless(shutil.which("swift"), "macOS Swift/PDFKit is required for PDF extraction")
    def test_resume_pdf_text_reader_uses_builtin_pdfkit(self):
        text = b"Python data analytics internship"
        stream = b"BT /F1 14 Tf 72 720 Td (" + text + b") Tj ET\n"
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
        ]
        parts = [b"%PDF-1.4\n"]
        offsets = [0]
        for number, value in enumerate(objects, 1):
            offsets.append(sum(map(len, parts)))
            parts.append(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
        xref = sum(map(len, parts))
        parts.append(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
        parts.extend(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
        parts.append(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
        extracted = server.resume_text_from_upload("resume.pdf", b"".join(parts))
        self.assertIn("Python data analytics internship", extracted)

    def test_resume_upload_endpoint_reads_multipart_only_for_local_matching(self):
        resume = b"Python, SQL, statistics, and analytics project experience."
        expected = {"matches": [{"id": "notion:101", "score": 84, "reason": "Python and analytics overlap."}]}
        with patch.object(server, "recommend_jobs_from_resume", return_value=expected) as recommend:
            status, result = self.request_multipart("/api/resume-recommendations", "resume.txt", resume,
                                                    origin=self.base)
        self.assertEqual(status, 200)
        self.assertEqual(result, expected)
        recommend.assert_called_once_with(resume.decode())
        status, result = self.request_multipart("/api/resume-recommendations", "resume.txt", resume,
                                                origin="https://outside.example")
        self.assertEqual(status, 400)
        self.assertIn("origin", result["error"])

    def test_resume_job_ranking_extracts_local_signals_and_uses_current_feed(self):
        job = {"id": "notion:101", "title": "Data Analyst Intern", "company": "Notion",
               "location": "Remote", "department": "Analytics", "job_type": "Internship",
               "workplace": "Remote", "summary": "Build Python data pipelines and analyze SQL metrics.",
               "eligibility_preview": "Students enrolled in a degree program.", "early_career": True}
        unrelated_job = {"id": "notion:202", "title": "Visual Designer", "company": "Notion",
                         "location": "New York", "department": "Brand", "job_type": "Full-time",
                         "workplace": "On-site", "summary": "Create visual campaigns and brand assets.",
                         "eligibility_preview": "", "early_career": False}
        phd_job = {"id": "notion:303", "title": "Data Scientist Intern (PhD)", "company": "Notion",
                   "location": "Remote", "department": "Analytics", "job_type": "Internship",
                   "workplace": "Remote", "summary": "Use Python, SQL, and statistics to model user behavior.",
                   "eligibility_preview": "Current doctoral students only.", "early_career": True}
        senior_job = {"id": "notion:404", "title": "Staff Software Engineer", "company": "Notion",
                      "location": "Remote", "department": "Engineering", "job_type": "Full-time",
                      "workplace": "Remote", "summary": "Build software with Python and SQL.",
                      "eligibility_preview": "", "early_career": False}
        abbreviated_senior_job = {"id": "notion:405", "title": "Sr. Software Engineer", "company": "Notion",
                                  "location": "Remote", "department": "Engineering", "job_type": "Full-time",
                                  "workplace": "Remote", "summary": "Build software with Python and SQL.",
                                  "eligibility_preview": "", "early_career": False}
        high_school_job = {"id": "notion:406", "title": "High School Internship, Software Engineering", "company": "Notion",
                           "location": "Remote", "department": "Engineering", "job_type": "Internship",
                           "workplace": "Remote", "summary": "Learn software development with Python.",
                           "eligibility_preview": "High school students only.", "early_career": True}
        resume = "Computer science student interested in software engineering and data analytics. Python, SQL, statistics, and analytics projects."
        model_result = {"message": {"content": json.dumps({
            "roles": ["data analytics internship", "software engineering intern", "chief financial officer"],
            "skills": ["Python", "SQL", "confidential skill"],
        })}}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "configured-but-must-not-be-used"}), \
                patch.object(server, "fetch_jobs", return_value={"jobs": [job, unrelated_job, phd_job, senior_job,
                                                                          abbreviated_senior_job, high_school_job],
                                                                  "checked_at": server.utc_now()}), \
                patch.object(server, "ensure_local_model", return_value=True), \
                patch.object(server, "fetch_json", return_value=model_result) as local_call:
            result = server.recommend_jobs_from_resume(resume)
        self.assertEqual(result["signals"], {"roles": ["data analytics", "software engineering"],
                                             "skills": ["Python", "SQL"]})
        self.assertEqual([match["id"] for match in result["matches"]], ["notion:101"])
        self.assertLess(result["matches"][0]["score"], 98)
        self.assertIn("data analytics", result["matches"][0]["reason"])
        self.assertIn("Python, SQL", result["matches"][0]["reason"])
        self.assertEqual(local_call.call_args.args[0], f"{server.LOCAL_AI_URL}/api/chat")
        payload = json.loads(local_call.call_args.kwargs["data"])
        self.assertEqual(payload["model"], server.LOCAL_AI_MODEL)
        self.assertIn(resume, payload["messages"][1]["content"])
        self.assertEqual(payload["format"], server.RESUME_PROFILE_SCHEMA)

    def test_resume_explicit_internship_and_location_are_respected(self):
        jobs = [
            {"id": "figma:1", "title": "Product Design Intern", "company": "Figma", "location": "San Francisco, CA",
             "job_type": "Internship", "department": "Design", "summary": "Product design projects", "eligibility_preview": ""},
            {"id": "figma:2", "title": "Product Design Intern", "company": "Linear", "location": "London, United Kingdom",
             "job_type": "Internship", "department": "Design", "summary": "Product design projects", "eligibility_preview": ""},
            {"id": "stripe:3", "title": "Product Design Associate", "company": "Stripe", "location": "San Francisco, CA",
             "job_type": "Full-time", "department": "Design", "summary": "Product design projects", "eligibility_preview": ""},
        ]
        signals = {"roles": ["product design"], "skills": ["Figma"]}
        with patch.object(server, "fetch_jobs", return_value={"jobs": jobs}), \
                patch.object(server, "extract_resume_profile", return_value=signals):
            result = server.recommend_jobs_from_resume(
                "Undergraduate student. Figma projects. Seeking a product design internship in San Francisco.")
            broad = server.recommend_jobs_from_resume("Undergraduate student. Figma projects in San Francisco.")
        self.assertEqual([match["id"] for match in result["matches"]], ["figma:1"])
        self.assertEqual(result["preferences"], {"job_type": "Internship", "location": "San Francisco", "workplace": None, "role": "product design"})
        self.assertEqual({match["id"] for match in broad["matches"]}, {"figma:1", "figma:2", "stripe:3"})
        self.assertEqual(broad["preferences"], {"job_type": None, "location": None, "workplace": None, "role": None})
        self.assertFalse(server.resume_location_matches({"location": "London, United Kingdom"}, "United States"))
        self.assertTrue(server.resume_location_matches({"location": "Palo Alto, CA"}, "United States"))
        self.assertEqual(server.resume_search_preferences(
            "Seeking a remote software engineering internship in the United States."),
            {"job_type": "Internship", "location": "United States", "workplace": "Remote", "role": "software engineering"})
        self.assertEqual(server.resume_search_preferences("Looking for internships in software engineering."),
                         {"job_type": "Internship", "location": None, "workplace": None, "role": "software engineering"})

    def test_chat_preserves_explicit_role_when_local_model_misses_it(self):
        message = "I want a software engineering internship in the United States."
        with patch.object(server, "active_ai_provider", return_value="local"), \
                patch.object(server, "local_ai_reply", return_value=("Try LinkedIn.", server.EMPTY_PROFILE)):
            reply, profile, mode, provider = server.career_reply(
                message, server.EMPTY_PROFILE, [{"role": "user", "content": message}])
        self.assertEqual(reply, "Try LinkedIn.")
        self.assertEqual(profile["role"], "software engineering internship")
        self.assertEqual((mode, provider), ("ai", "local"))

    def test_resume_rejects_skills_not_actually_evidenced(self):
        resume = "Undergraduate student seeking a product design internship in San Francisco. Figma and user research projects."
        model = {"message": {"content": json.dumps({"roles": ["product design"], "skills": [
            "Figma", "user research", "San Francisco location preference", "campus project involvement",
            "internship", "United States"]})}}
        with patch.object(server, "ensure_local_model", return_value=True), \
                patch.object(server, "fetch_json", return_value=model):
            signals = server.extract_resume_profile(resume)
        self.assertEqual(signals, {"roles": ["product design"], "skills": ["Figma", "user research"]})

    def test_guest_data_imports_after_optional_registration(self):
        status, _ = self.request("/api/auth/register", {
            "name": "Guest Upgrade", "email": "upgrade@example.test", "password": "unique-test-password-123"
        })
        self.assertEqual(status, 201)
        guest = {"stage": "discover", "profile": {"role": "Design internship", "skills": "Figma",
                 "location": "Chicago", "priorities": "Growth"},
                 "direction": {"activities": ["design", "research"], "job_type": "Internship",
                               "school_year": "freshman", "workplace": "Remote", "location_rule": "prefer",
                               "salary_min": 25, "salary_period": "hour"},
                 "messages": [{"role": "user", "content": "Design internship"},
                              {"role": "assistant", "content": "Tell me more about your skills."}],
                 "saved": ["figma:456"],
                 "saved_jobs": [{"id": "figma:456", "title": "Design Intern", "company": "Figma",
                                  "url": "https://job-boards.greenhouse.io/figma/jobs/456", "source": "Greenhouse"}]}
        status, result = self.request("/api/guest/import", {"guest": guest})
        self.assertEqual(status, 200)
        self.assertEqual(result["imported_saved"], 1)
        status, result = self.request("/api/session")
        self.assertEqual(result["stage"], "discover")
        self.assertEqual(result["profile"]["role"], "Design internship")
        self.assertEqual(result["direction"]["school_year"], "freshman")
        self.assertEqual(result["direction"]["activities"], ["design", "research"])
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(result["saved_jobs"][0]["id"], "figma:456")
        self.request("/api/guest/import", {"guest": guest})
        status, result = self.request("/api/session")
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(result["saved"], ["figma:456"])

    def test_direction_choices_survive_chat_and_login_and_reject_invalid_values(self):
        status, result = self.request("/api/auth/register", {
            "name": "Direction Tester", "email": "direction@example.test", "password": "unique-test-password-123"
        })
        self.assertEqual(status, 201)
        self.assertEqual(result["direction"], server.EMPTY_DIRECTION)
        choices = {"activities": ["build", "analyze"], "job_type": "Internship", "school_year": "sophomore",
                   "workplace": "Remote", "location_rule": "only", "salary_min": 27.5, "salary_period": "hour"}
        status, result = self.request("/api/profile", {"profile": {"role": "Data internship", "skills": "Python",
                   "location": "Chicago", "priorities": "Mentorship"}, "direction": choices})
        self.assertEqual((status, result["direction"]), (200, choices))
        status, _ = self.request("/api/chat", {"message": "I enjoy Python projects."})
        self.assertEqual(status, 200)
        _, session = self.request("/api/session")
        self.assertEqual(session["direction"], choices)
        status, error = self.request("/api/profile", {"profile": session["profile"],
            "direction": {**choices, "job_type": "Full-time"}})
        self.assertEqual(status, 400)
        self.assertIn("School year", error["error"])
        self.request("/api/auth/logout", {})
        status, _ = self.request("/api/auth/login", {"email": "direction@example.test",
                                                   "password": "unique-test-password-123"})
        self.assertEqual(status, 200)
        _, session = self.request("/api/session")
        self.assertEqual(session["direction"], choices)

    def test_import_does_not_replace_existing_account_data(self):
        self.request("/api/auth/register", {"name": "Existing", "email": "existing2@example.test",
                                              "password": "unique-test-password-123"})
        self.request("/api/profile", {"profile": {"role": "Education", "skills": "", "location": "Boston", "priorities": ""}})
        with server.connect_db() as db:
            user_id = db.execute("SELECT id FROM users WHERE email=?", ("existing2@example.test",)).fetchone()[0]
            db.execute("INSERT INTO messages (user_id,role,content,created_at) VALUES (?,?,?,?)",
                       (user_id, "user", "I teach math", server.utc_now()))
        guest = {"stage": "onboarding", "profile": {"role": "Design", "skills": "Figma", "location": "Chicago", "priorities": ""},
                 "messages": [{"role": "user", "content": "Design"}], "saved": [], "saved_jobs": []}
        status, _ = self.request("/api/guest/import", {"guest": guest})
        self.assertEqual(status, 200)
        _, result = self.request("/api/session")
        self.assertEqual(result["profile"]["role"], "Education")
        self.assertEqual(result["profile"]["location"], "Boston")
        self.assertEqual(result["profile"]["skills"], "Figma")
        self.assertEqual(len(result["messages"]), 1)

    def test_existing_guided_prompts_are_translated(self):
        user_id = server.create_user("Existing Student", "existing@example.test", "unique-test-password-123")
        old_text = "你希望在哪里工作？也可以告诉我是否接受远程。"
        with server.connect_db() as db:
            db.execute("INSERT INTO messages (user_id,role,content,created_at) VALUES (?,?,?,?)",
                       (user_id, "assistant", old_text, server.utc_now()))
        server.init_db()
        with server.connect_db() as db:
            updated = db.execute("SELECT content FROM messages WHERE user_id=?", (user_id,)).fetchone()["content"]
        self.assertEqual(updated, server.LEGACY_ASSISTANT_MESSAGES[old_text])


class JobFeedTest(unittest.TestCase):
    def setUp(self):
        self.old_cache = server.job_cache
        server.job_cache = {"sources": {}, "checked_at": None, "expires": 0}
        self.sources = (("greenhouse", "figma", "Figma"), ("lever", "palantir", "Palantir"),
                        ("ashby", "linear", "Linear"))
        self.source_patch = patch.object(server, "JOB_SOURCES", self.sources)
        self.source_patch.start()

    def tearDown(self):
        self.source_patch.stop()
        server.job_cache = self.old_cache

    def test_normalizes_multiple_public_ats(self):
        greenhouse = server.make_job("greenhouse", "figma", "Figma", {
            "id": 42, "title": "Product Design Intern", "absolute_url": "https://job-boards.greenhouse.io/figma/jobs/42",
            "location": {"name": "Remote - US"}, "first_published": "2026-10-14T12:00:00Z", "departments": [],
            "content": "<p>Applicants should be rising sophomores, juniors, or seniors in college.</p>"
        })
        self.assertEqual((greenhouse["id"], greenhouse["job_type"], greenhouse["workplace"]),
                         ("figma:42", "Internship", "Remote"))
        self.assertTrue(greenhouse["early_career"])
        self.assertEqual(greenhouse["class_years"], ["sophomore", "junior", "senior"])
        self.assertIn("rising sophomores", greenhouse["year_evidence"])
        self.assertEqual(greenhouse["eligibility_preview"], greenhouse["year_evidence"])
        self.assertIn("content=true", server.source_url("greenhouse", "figma"))
        lever = server.make_job("lever", "palantir", "Palantir", {
            "id": "6ed76ce8-4156-4b60-b120-403538bd66cd", "text": "Business Analyst",
            "hostedUrl": "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd",
            "createdAt": 1786469891368, "categories": {"location": "Chicago, IL", "team": "Operations", "commitment": "Full-time"},
            "workplaceType": "hybrid", "descriptionPlain": "Work with teams on planning.\n\nAnalyze operational data."
        })
        self.assertEqual((lever["source"], lever["job_type"], lever["workplace"]), ("Lever", "Full-time", "Hybrid"))
        self.assertEqual(lever["summary"], "Work with teams on planning. Analyze operational data.")
        self.assertTrue(lever["posted_at"])
        ashby = server.make_job("ashby", "linear", "Linear", {
            "id": "d3bc1ced-3ce4-4086-a050-555055dbb1ff", "title": "Product Designer",
            "jobUrl": "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff",
            "location": "United States", "employmentType": "FullTime", "isRemote": True
        })
        self.assertEqual((ashby["source"], ashby["job_type"], ashby["workplace"]), ("Ashby", "Full-time", "Remote"))
        self.assertEqual(greenhouse["summary"], "Applicants should be rising sophomores, juniors, or seniors in college.")
        self.assertIsNone(greenhouse["pay"])
        self.assertIn("includeCompensation=true", server.source_url("ashby", "linear"))
        self.assertLessEqual(len(server.job_summary("You will build a useful project with a team. " * 40)), 221)
        self.assertEqual(server.job_summary(None), "")
        self.assertIsNone(server.make_job("greenhouse", "figma", "Figma", {
            "id": 43, "title": "Fake", "absolute_url": "javascript:alert(1)"}))

    def test_comparable_salary_only_uses_published_usd_hourly_or_annual_pay(self):
        hourly = server.parse_usd_pay("$25–$35 /hour")
        self.assertEqual((hourly["period"], hourly["min"], hourly["max"]), ("hour", 25, 35))
        annual = server.parse_usd_pay("$170k - $200k")
        self.assertEqual((annual["period"], annual["min"], annual["max"]), ("year", 170000, 200000))
        self.assertEqual(server.parse_usd_pay("USD 90,000–120,000/year")["max"], 120000)
        for text in ("Competitive", "CAD $100k/year", "C$100k/year", "€80k/year",
                     "$35,3k-$52k", "$1,000 per task", "OTE $100k-$150k",
                     "$120k-$90k", "$25/hour and $5/hour bonus"):
            with self.subTest(text=text):
                self.assertIsNone(server.parse_usd_pay(text))

        lever_item = {"salaryRange": {"min": 30, "max": 45, "currency": "USD", "interval": "per-hour-wage"}}
        self.assertEqual(server.listing_pay("lever", lever_item)["max"], 45)
        lever_item["salaryRange"]["currency"] = "CAD"
        self.assertIsNone(server.listing_pay("lever", lever_item))
        lever_item["salaryRange"].update(currency="USD", interval="month")
        self.assertIsNone(server.listing_pay("lever", lever_item))
        ashby_item = {"shouldDisplayCompensationOnJobPostings": True,
                      "compensation": {"compensationTierSummary": "$95k–$120k"}}
        self.assertEqual(server.listing_pay("ashby", ashby_item)["max"], 120000)
        ashby_item["shouldDisplayCompensationOnJobPostings"] = False
        self.assertIsNone(server.listing_pay("ashby", ashby_item))
        greenhouse_item = {"content": (
            "&lt;p&gt;This internship has the hourly base pay rate stated below. "
            "A housing stipend is separate.&lt;/p&gt;"
            "&lt;div&gt;$46&amp;mdash;$46 USD&lt;/div&gt;")}
        pay = server.listing_pay("greenhouse", greenhouse_item)
        self.assertEqual((pay["period"], pay["min"], pay["max"]), ("hour", 46, 46))
        self.assertIsNone(server.listing_pay("greenhouse", {"content": "<p>Housing stipend: $2,000.</p>"}))
        self.assertIsNone(server.listing_pay("greenhouse", {"content": (
            "<p>Base salary: $100,000-$120,000 per year.</p>"
            "<p>Base salary in another location: $130,000-$150,000 per year.</p>")}))

    def test_job_preview_uses_duties_instead_of_company_intro(self):
        posting = ("<p>Figma is growing our team on a mission to make design accessible to all.</p>"
                   "<p>We are looking for Product Design interns to work with our team.</p>"
                   "<h2>What you'll do at Figma:</h2><ul>"
                   "<li>Design prototypes and high-fidelity visuals for features that ship.</li>"
                   "<li>Collaborate with engineers and researchers.</li></ul>")
        self.assertEqual(server.job_summary(posting, True),
                         "Design prototypes and high-fidelity visuals for features that ship.")
        self.assertEqual(server.job_summary(
            "A World-Changing Company\n\nOur mission is to help.\n\nThe Role\n\n"
            "As an Administrative Business Partner, you will manage travel and expenses."),
            "As an Administrative Business Partner, you will manage travel and expenses.")
        self.assertEqual(server.job_summary("Our mission is to make the world better."), "")

    def test_job_eligibility_preview_uses_explicit_source_requirements(self):
        posting = ("<h2>What we're looking for:</h2><ul>"
                   "<li>Currently pursuing a bachelor's degree in computer science or a related field.</li>"
                   "<li>Experience with Python and SQL.</li></ul>")
        self.assertEqual(server.job_eligibility(posting, True),
                         "Currently pursuing a bachelor's degree in computer science or a related field.")
        self.assertEqual(server.job_eligibility("Benefits include paid leave and health coverage."), "")

    def test_internship_years_need_explicit_undergraduate_wording(self):
        self.assertEqual(server.internship_class_years("Work with senior engineers and junior designers."), ([], ""))
        self.assertEqual(server.internship_class_years("Current 4th year senior PhD student required."), ([], ""))
        self.assertEqual(server.internship_class_years("First-year college student welcome.")[0], ["freshman"])
        self.assertEqual(server.internship_class_years("Rising freshman or sophomore in college.")[0],
                         ["freshman", "sophomore"])

    def test_partial_failure_keeps_other_sources_and_short_cache(self):
        def first_fetch(source):
            if source[1] == "linear":
                raise ValueError("feed unavailable")
            return [{"id": f"{source[1]}:1", "url": f"https://example.com/{source[1]}"}]

        with patch.object(server, "fetch_source", side_effect=first_fetch):
            result = server.fetch_jobs(force=True)
        self.assertEqual(len(result["jobs"]), 2)
        self.assertEqual([source["status"] for source in result["sources"]], ["live", "live", "unavailable"])

        def second_fetch(source):
            if source[1] == "figma":
                raise ValueError("temporary outage")
            return [{"id": f"{source[1]}:1", "url": f"https://example.com/{source[1]}"}]

        with patch.object(server, "fetch_source", side_effect=second_fetch):
            result = server.fetch_jobs(force=True)
        self.assertEqual(len(result["jobs"]), 3)
        self.assertTrue(result["stale"])
        self.assertEqual([source["status"] for source in result["sources"]], ["cached", "live", "live"])

    def test_all_sources_unavailable_is_explicit_error(self):
        with patch.object(server, "fetch_source", side_effect=ValueError("offline")):
            with self.assertRaisesRegex(RuntimeError, "could not verify"):
                server.fetch_jobs(force=True)


class RemotiveFeedTest(unittest.TestCase):
    def test_remote_jobs_are_attributed_and_reused_after_restart(self):
        source = ("remotive", "remote-jobs", "Remotive")
        payload = {"jobs": [{
            "id": 1680495, "url": "https://remotive.com/remote-jobs/design/product-design-intern-1680495",
            "title": "Product Design Intern", "company_name": "Example Studio",
            "category": "Design", "job_type": "internship", "publication_date": "2026-10-15T10:00:00",
            "candidate_required_location": "USA", "salary": "$25/hour",
            "description": "<p>Rising sophomores in college may apply.</p><p>Help research student needs.</p>"
        }]}
        original_cache, original_details = server.job_cache, server.detail_cache
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(server, "REMOTIVE_CACHE_PATH", Path(directory) / "remotive-cache.json"), \
                patch.object(server, "JOB_SOURCES", (source,)), \
                patch.object(server, "fetch_json", return_value=payload) as fetch:
            try:
                server.job_cache = {"sources": {}, "checked_at": None, "expires": 0}
                server.detail_cache = {}
                first = server.fetch_jobs(force=True)
                job = first["jobs"][0]
                self.assertEqual((job["id"], job["source"], job["company"], job["job_type"], job["workplace"]),
                                 ("remotive-remote-jobs:1680495", "Remotive", "Example Studio", "Internship", "Remote"))
                self.assertEqual(job["class_years"], ["sophomore"])
                self.assertEqual(job["summary"], "Rising sophomores in college may apply. Help research student needs.")
                self.assertEqual((job["pay"]["period"], job["pay"]["max"]), ("hour", 25))
                self.assertTrue(job["posted_at"].endswith("+00:00"))
                detail = server.fetch_job_detail(job["id"])
                self.assertEqual(detail["compensation"], "$25/hour")
                self.assertNotIn("<p>", detail["description"])
                self.assertEqual(fetch.call_count, 1)

                refreshed = server.fetch_jobs(force=True)
                self.assertEqual(refreshed["sources"][0]["status"], "recent")
                server.job_cache = {"sources": {}, "checked_at": None, "expires": 0}
                server.detail_cache = {}
                restarted = server.fetch_jobs(force=True)
                self.assertEqual(restarted["sources"][0]["status"], "recent")
                self.assertEqual(server.fetch_job_detail(job["id"])["compensation"], "$25/hour")
                self.assertEqual(fetch.call_count, 1)
            finally:
                server.job_cache, server.detail_cache = original_cache, original_details

    def test_remotive_requires_its_own_posting_url(self):
        item = {"id": 123, "url": "https://example.com/job", "title": "Designer"}
        self.assertIsNone(server.make_job("remotive", "remote-jobs", "Remotive", item))


class RecommendationTest(unittest.TestCase):
    def test_local_ai_keeps_only_profile_details_the_student_stated(self):
        reply = {"message": {"content": json.dumps({
            "reply": "What kind of Python project did you enjoy?",
            "profile": {"role": "software internship", "skills": "Python projects",
                        "location": "San Francisco", "priorities": "project management"}
        })}}
        with patch.object(server, "fetch_json", return_value=reply):
            text, profile = server.local_ai_reply([
                {"role": "user", "content": "I like Python projects and want a software internship."}
            ], server.EMPTY_PROFILE)
        self.assertIn("Python project", text)
        self.assertEqual(profile, {"role": "software internship", "skills": "Python projects",
                                   "location": "", "priorities": ""})

    def test_local_ai_recovers_from_an_empty_structured_reply(self):
        replies = [
            {"message": {"content": json.dumps({"reply": "", "profile": server.EMPTY_PROFILE})}},
            {"message": {"content": "What type of internship interests you most?"}}
        ]
        with patch.object(server, "fetch_json", side_effect=replies) as fetch:
            text, profile = server.local_ai_reply([
                {"role": "user", "content": "I want an internship."}
            ], server.EMPTY_PROFILE)
        self.assertEqual(text, "What type of internship interests you most?")
        self.assertEqual(profile, server.EMPTY_PROFILE)
        self.assertEqual(fetch.call_count, 2)

    def test_ai_ranks_only_current_jobs_and_sends_public_fields(self):
        profile = {"role": "computer science internship", "skills": "Python", "location": "remote", "priorities": "growth"}
        jobs = [
            {"id": "figma:101", "title": "Software Engineering Intern", "company": "Figma",
             "location": "Remote - US", "department": "Engineering", "job_type": "Internship",
             "workplace": "Remote", "summary": "Build design tools with engineers.", "posted_at": "2026-10-15T00:00:00Z",
             "early_career": True, "url": "https://example.com/101"},
            {"id": "stripe:202", "title": "Senior Finance Manager", "company": "Stripe",
             "location": "New York", "department": "Finance", "job_type": "Full-time",
             "workplace": "On-site", "summary": "Lead finance planning.", "posted_at": "2026-10-16T00:00:00Z",
             "early_career": False, "url": "https://example.com/202"},
            {"id": "stripe:303", "title": "High School Internship, Software Engineering", "company": "Stripe",
             "location": "Remote - US", "department": "Engineering", "job_type": "Internship",
             "workplace": "Remote", "summary": "For high school students.", "posted_at": "2026-10-16T00:00:00Z",
             "early_career": True, "url": "https://example.com/303"},
            {"id": "figma:404", "title": "PhD Intern, Software Engineer", "company": "Figma",
             "location": "Remote - US", "department": "Engineering", "job_type": "Internship",
             "workplace": "Remote", "summary": "For doctoral students.", "posted_at": "2026-10-16T00:00:00Z",
             "early_career": True, "url": "https://example.com/404"},
        ]
        selected = server.shortlist_jobs(profile, jobs)
        self.assertEqual([job["id"] for job in selected], ["figma:101"])
        broad_ids = [job["id"] for job in server.shortlist_jobs({**profile, "role": "compu"}, jobs)]
        self.assertEqual(broad_ids[0], "figma:101")
        self.assertNotIn("stripe:303", broad_ids)
        self.assertNotIn("figma:404", broad_ids)
        self.assertEqual([job["id"] for job in server.shortlist_jobs(
            {**profile, "role": "compu internship"}, jobs)], ["figma:101"])
        self.assertIn("figma:404", [job["id"] for job in server.shortlist_jobs(
            {**profile, "role": "PhD software internship"}, jobs)])
        reply = {"output": [{"content": [{"type": "output_text", "text": json.dumps({"matches": [
            {"id": "invented:999", "score": 99, "reason": "Not a real posting"},
            {"id": "figma:101", "score": 92, "reason": "Your Python projects relate to this software internship."},
            {"id": "figma:101", "score": 70, "reason": "Duplicate"}
        ]})}]}]}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), \
                patch.object(server, "fetch_jobs", return_value={"jobs": jobs, "checked_at": "2026-10-16T00:00:00Z"}), \
                patch.object(server, "fetch_json", return_value=reply) as fetch, \
                patch.object(server, "recommendation_cache", {}):
            result = server.recommend_jobs(profile)
            again = server.recommend_jobs(profile)
        self.assertEqual(result, again)
        self.assertEqual(result["matches"], [{"id": "figma:101", "score": 92,
                                               "reason": "Your Python projects relate to this software internship."}])
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(fetch.call_args.args[0], "https://api.openai.com/v1/responses")
        sent = json.loads(fetch.call_args.kwargs["data"])
        self.assertFalse(sent["store"])
        self.assertEqual(sent["text"]["format"]["type"], "json_schema")
        candidates = json.loads(sent["input"][0]["content"])["jobs"]
        self.assertNotIn("url", candidates[0])
        self.assertNotIn("early_career", candidates[0])

    def test_ai_chat_extracts_profile_with_structured_output(self):
        reply = {"output": [{"content": [{"type": "output_text", "text": json.dumps({
            "reply": "你想做哪类软件工作？", "profile": {"role": "software engineering", "skills": "Python",
                                                       "location": "", "priorities": ""}
        })}]}]}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), \
                patch.object(server, "fetch_json", return_value=reply) as fetch:
            text, profile = server.ai_reply([{"role": "user", "content": "我学计算机，用过Python"}], server.EMPTY_PROFILE)
        self.assertEqual(text, "你想做哪类软件工作？")
        self.assertEqual(profile["skills"], "Python")
        sent = json.loads(fetch.call_args.kwargs["data"])
        self.assertFalse(sent["store"])
        self.assertEqual(sent["text"]["format"]["type"], "json_schema")

    def test_local_config_does_not_override_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("OPENAI_API_KEY=fake-from-file\nOPENAI_MODEL=gpt-4o-mini\n", encoding="utf-8")
            with patch.dict(os.environ, {"OPENAI_API_KEY": "already-set", "OPENAI_MODEL": "existing-model"}):
                server.load_local_config(path)
                self.assertEqual(os.environ["OPENAI_API_KEY"], "already-set")
                self.assertEqual(os.environ["OPENAI_MODEL"], "existing-model")


class MigrationTest(unittest.TestCase):
    def test_existing_saved_job_table_gains_snapshot_without_data_loss(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            with sqlite3.connect(path) as db:
                db.execute("CREATE TABLE saved_jobs (user_id INTEGER NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(user_id,job_id))")
                db.execute("INSERT INTO saved_jobs (user_id,job_id) VALUES (1,'figma:123')")
            with patch.object(server, "DB_PATH", path):
                server.init_db()
                with server.connect_db() as db:
                    row = db.execute("SELECT job_id,snapshot_json FROM saved_jobs WHERE user_id=1").fetchone()
                self.assertEqual(row["job_id"], "figma:123")
                self.assertIsNone(row["snapshot_json"])


if __name__ == "__main__":
    unittest.main()
