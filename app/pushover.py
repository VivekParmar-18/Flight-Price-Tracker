import os
import logging
import requests

logger = logging.getLogger(__name__)
PUSHOVER_URL = 'https://api.pushover.net/1/messages.json'


def _get_setting(db_path: str | None, key: str, env_var: str) -> str:
    val = os.environ.get(env_var, '').strip()
    if not val and db_path:
        try:
            from .db import get_setting
            val = get_setting(db_path, key, '').strip()
        except Exception:
            pass
    return val


def send_pushover(message: str, title: str = 'Flight Price Alert', db_path: str | None = None) -> bool:
    """Send alert via all configured notification channels: Pushover, Discord, Telegram."""
    sent = False

    # 1. Pushover
    token = _get_setting(db_path, 'pushover_token', 'PUSHOVER_TOKEN')
    user = _get_setting(db_path, 'pushover_user', 'PUSHOVER_USER')
    if token and user:
        try:
            resp = requests.post(PUSHOVER_URL, data={
                'token': token,
                'user': user,
                'message': message,
                'title': title,
            }, timeout=10)
            if resp.status_code == 200:
                sent = True
            else:
                logger.error("Pushover error %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.error("Pushover request failed: %s", e)

    # 2. Discord Webhook
    discord_url = _get_setting(db_path, 'discord_webhook_url', 'DISCORD_WEBHOOK_URL')
    if discord_url:
        try:
            resp = requests.post(discord_url, json={
                'embeds': [{
                    'title': title,
                    'description': message,
                    'color': 0x00cfe0,
                }]
            }, timeout=10)
            if resp.status_code in (200, 204):
                sent = True
            else:
                logger.error("Discord webhook error %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.error("Discord request failed: %s", e)

    # 3. Telegram Bot
    tg_token = _get_setting(db_path, 'telegram_bot_token', 'TELEGRAM_BOT_TOKEN')
    tg_chat = _get_setting(db_path, 'telegram_chat_id', 'TELEGRAM_CHAT_ID')
    if tg_token and tg_chat:
        try:
            tg_url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
            resp = requests.post(tg_url, json={
                'chat_id': tg_chat,
                'text': f"*{title}*\n\n{message}",
                'parse_mode': 'Markdown',
            }, timeout=10)
            if resp.status_code == 200:
                sent = True
            else:
                logger.error("Telegram error %s: %s", resp.status_code, resp.text)
        except Exception as e:
            logger.error("Telegram request failed: %s", e)

    return sent
