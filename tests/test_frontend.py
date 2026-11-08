"""Next export serving and session boundary regression checks (no database)."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import main, auth


@unittest.skipUnless((main.FRONTEND / 'index.html').is_file(), 'Build the Next.js frontend first')
class FrontendTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_login_and_bundle_are_public_but_room_requires_session(self):
        with patch.object(auth, 'session_user', return_value=None):
            self.assertEqual(self.client.get('/', follow_redirects=False).status_code, 303)
            self.assertEqual(self.client.get('/api/state').status_code, 401)
            page = self.client.get('/login')
            self.assertEqual(page.status_code, 200)
            self.assertIn('/_next/static/', page.text)
            chunk = next((main.FRONTEND / '_next/static').rglob('*.js'))
            path = '/' + str(chunk.relative_to(main.FRONTEND))
            self.assertEqual(self.client.get(path).status_code, 200)
            for path in ('/manifest.webmanifest', '/sw.js', '/offline.html', '/static/icon-192.png', '/static/fonts/Vazirmatn.woff2'):
                self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_room_and_admin_pages_obey_session_permissions(self):
        user = {'id': 1, 'name': 'Test', 'is_admin': False}
        with patch.object(auth, 'session_user', return_value=user):
            page = self.client.get('/')
            self.assertEqual(page.status_code, 200)
            self.assertIn('no-store', page.headers['cache-control'])
            self.assertEqual(self.client.get('/admin/music').status_code, 403)
        with patch.object(auth, 'session_user', return_value={**user, 'is_admin': True}):
            self.assertEqual(self.client.get('/admin/music').status_code, 200)

    def test_frontend_sources_and_private_paths_are_not_public(self):
        with patch.object(auth, 'session_user', return_value=None):
            for path in ('/static/../app/page.tsx', '/_next/../api/state', '/static/index.html'):
                self.assertIn(self.client.get(path, follow_redirects=False).status_code, (303, 401, 404))
