import unittest
from unittest.mock import patch, MagicMock, AsyncMock

from fastapi import HTTPException
from backend.app import main


class SiteAppearanceTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_colors_and_covers_are_rejected_before_storage(self):
        with patch.object(main.auth, 'current_user', return_value={'is_admin': True}), \
                patch.object(main, 'require_admin'), patch.object(main, 'db') as database:
            for payload in ({'hero_text_color': 'red'}, {'hero_accent_color': '#12345z'},
                            {'hero_cover': 'data:image/svg+xml;base64,AAAA'},
                            {'hero_cover': 'data:image/png;base64,AAAA'},
                            {'hero_cover': 'https://example.com/image.png'}):
                with self.subTest(payload=payload), self.assertRaises(HTTPException) as error:
                    await main.update_site_copy(payload, MagicMock(), 'token')
                self.assertEqual(error.exception.status_code, 400)
            database.assert_not_called()

    async def test_appearance_update_preserves_title_and_broadcasts(self):
        import asyncio
        appearance = {'hero_text_color': '#112233', 'hero_accent_color': '#ABCDEF',
                      'hero_cover': ''}
        with patch.object(main.auth, 'current_user', return_value={'is_admin': True}), \
                patch.object(main, 'require_admin'), patch.object(main, 'db') as database, \
                patch.object(main, 'STATE_LOCK', asyncio.Lock()), \
                patch.object(main, 'broadcast', new_callable=AsyncMock) as broadcast:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = {
                'copy': {'hero_title': 'GOD IS HERE'}}
            result = await main.update_site_copy(appearance, MagicMock(), 'token')
            self.assertEqual(result['site_copy'], {'hero_title': 'GOD IS HERE', **appearance})
            broadcast.assert_awaited_once()
