"""Best-effort device labels; never expose raw browser headers."""


def device_info(user_agent):
    ua = (user_agent or '').lower()
    if 'ipad' in ua or ('android' in ua and 'mobile' not in ua):
        device = 'تبلت'
    elif any(value in ua for value in ('iphone', 'ipod', 'mobile', 'android')):
        device = 'موبایل'
    elif any(value in ua for value in ('windows', 'macintosh', 'linux', 'cros')):
        device = 'کامپیوتر'
    else:
        device = 'نامشخص'

    systems = [('android', 'Android'), ('iphone', 'iOS'), ('ipad', 'iPadOS'),
               ('ipod', 'iOS'), ('windows', 'Windows'), ('cros', 'ChromeOS'),
               ('macintosh', 'macOS'), ('linux', 'Linux')]
    browsers = [('edg', 'Edge'), ('opr/', 'Opera'), ('opios/', 'Opera'),
                ('samsungbrowser/', 'Samsung Internet'), ('firefox/', 'Firefox'),
                ('fxios/', 'Firefox'), ('chrome/', 'Chrome'), ('crios/', 'Chrome'),
                ('safari/', 'Safari')]
    return {
        'device': device,
        'os': next((label for marker, label in systems if marker in ua), 'نامشخص'),
        'browser': next((label for marker, label in browsers if marker in ua), 'نامشخص'),
    }


def online_users(sockets):
    users = {}
    for socket in sockets:
        user = socket.scope.get('state', {}).get('user')
        if not user:
            continue
        entry = users.setdefault(user['id'], {
            'id': user['id'], 'name': user['name'], 'connections': [],
        })
        entry['connections'].append(device_info(socket.headers.get('user-agent', '')))
    return sorted(users.values(), key=lambda user: (user['name'].casefold(), user['id']))
