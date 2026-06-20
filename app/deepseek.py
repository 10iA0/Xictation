"""DeepSeek API 服务：查询单词音标和翻译"""
import os
import json
import httpx

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"


def lookup_word(word: str) -> dict:
    """调用 DeepSeek API 获取单词的音标和中文翻译"""
    prompt = (
        f'请给出英语单词或短语 "{word}" 的音标和中文翻译。'
        f"音标使用 IPA 格式（不含斜杠）。"
        f'请严格以 JSON 格式返回：{{"phonetic": "音标", "translation": "翻译"}}'
    )

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                DEEPSEEK_API_URL,
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            result = json.loads(content)
            return {
                "phonetic": result.get("phonetic", ""),
                "translation": result.get("translation", ""),
            }
    except Exception as e:
        return {"phonetic": "", "translation": "", "error": str(e)}


def translate_text(text: str) -> str:
    """调用 DeepSeek API 将英文翻译为中文"""
    prompt = (
        f"请将以下英文翻译为中文，只返回翻译结果，不要添加任何解释或额外内容：\n\n{text}"
    )

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                DEEPSEEK_API_URL,
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return ""
