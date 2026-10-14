import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException, Request
from backend.app import presence


class PresenceTests(unittest.IsolatedAsyncioTestCase):
    def test_device_detection(self):
        cases = [
            ('Mozilla Android Mobile Chrome/120 Safari/537', 'موبایل', 'Android', 'Chrome'),
            ('Mozilla iPhone Safari/604', 'موبایل', 'iOS', 'Safari'),
            ('Mozilla iPad Safari/604', 'تبلت', 'iPadOS', 'Safari'),
            ('Mozilla Android Chrome/120', 'تبلت', 'Android', 'Chrome'),
            ('Mozilla Windows Chrome/120 Safari/537 Edg/120', 'کامپیوتر', 'Windows', 'Edge'),
            ('Mozilla Macintosh Firefox/120', 'کامپیوتر', 'macOS', 'Firefox'),
            ('', 'نامشخص', 'نامشخص', 'نامشخص'),
        ]
        for ua, device, os, browser in cases:
            with self.subTest(ua=ua):
                self.assertEqual(presence.device_info(ua), dict(device=device, os=os, browser=browser))

    async def test_online_access_and_disconnect(self):
        from backend.app import main
        user = {'id': 1, 'name': '<script>name</script>', 'is_admin': False}
        sockets = [SimpleNamespace(scope={'state': {'user': user}}, headers={'user-agent': ua})
                   for ua in ('Android Mobile Chrome/120', 'Windows Firefox/120')]
        request = Request({'type': 'http', 'state': {'user': dict(user, is_admin=True)}})
        with patch.object(main, 'ADMIN_TOKEN', 'secret'), patch.object(main, 'clients', sockets):
            for token in (None, 'wrong'):
                with self.assertRaises(HTTPException) as error:
                    await main.admin_online(request, token)
                self.assertEqual(error.exception.status_code, 403)
            regular = Request({'type': 'http', 'state': {'user': user}})
            with self.assertRaises(HTTPException):
                await main.admin_online(regular, 'secret')
            result = await main.admin_online(request, 'secret')
            self.assertEqual(len(result['items']), 1)
            self.assertEqual(len(result['items'][0]['connections']), 2)
            self.assertEqual(result['items'][0]['name'], user['name'])
            sockets.pop()
            self.assertEqual(len((await main.admin_online(request, 'secret'))['items'][0]['connections']), 1)
            sockets.clear()
            self.assertEqual(await main.admin_online(request, 'secret'), {'items': []})
