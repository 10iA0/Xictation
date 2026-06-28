"""DeepSeek API 服务：查询单词音标和翻译"""
import os
import json
import httpx

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "").strip() or "deepseek-v4-flash"
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"


class DeepSeekError(Exception):
    """DeepSeek 调用异常"""

    def __init__(self, message: str, balance_insufficient: bool = False, no_key: bool = False):
        super().__init__(message)
        self.message = message
        self.balance_insufficient = balance_insufficient
        self.no_key = no_key


def _resolve_key(user_key: str | None = None) -> str:
    """解析可用的 API Key：优先用户自己的，其次环境变量"""
    key = (user_key or "").strip()
    if key:
        return key
    if DEEPSEEK_API_KEY:
        return DEEPSEEK_API_KEY
    raise DeepSeekError("未配置 DeepSeek API Key，请到「API 设置」中填入自己的 Key", no_key=True)


def _handle_response(response: httpx.Response):
    """处理 DeepSeek 响应，识别余额不足等错误"""
    if response.status_code == 402:
        raise DeepSeekError("DeepSeek API 余额不足，请登录平台充值或更换 API Key", balance_insufficient=True)
    if response.status_code == 401:
        raise DeepSeekError("DeepSeek API Key 无效，请到「API 设置」中检查", no_key=True)
    if response.status_code == 429:
        raise DeepSeekError("DeepSeek API 调用过于频繁，请稍后再试")
    if response.status_code >= 400:
        # 尝试从响应体提取更具体的错误信息
        try:
            data = response.json()
            msg = data.get("error", {}).get("message") or str(data)
        except Exception:
            msg = response.text or f"HTTP {response.status_code}"
        # 兼容部分余额不足的提示
        if "balance" in msg.lower() or "insufficient" in msg.lower() or "余额" in msg:
            raise DeepSeekError(f"DeepSeek API 余额不足：{msg}", balance_insufficient=True)
        raise DeepSeekError(f"DeepSeek 调用失败：{msg}")
    response.raise_for_status()


def lookup_word(word: str, user_key: str | None = None) -> dict:
    """调用 DeepSeek API 获取单词的音标、词性、过去式/过去分词、中文翻译（含多义）"""
    api_key = _resolve_key(user_key)
    prompt = (
        f'请给出英语单词或短语 "{word}" 的音标和中文翻译。'
        f"音标使用 IPA 格式（不含斜杠）。"
        f"如果有多个词性或多个含义，请全部列出。"
        f"如果是动词，请给出过去式和过去分词；如果不是动词则留空。"
        f'请严格以 JSON 格式返回：{{"phonetic": "音标", "pos": "词性(如 verb/noun/adj/adv/prep/conj/pron，多个用逗号分隔)", "past_tense": "过去式或空字符串", "past_participle": "过去分词或空字符串", "translation": "中文翻译，多个含义用分号分隔"}}'
    )

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                DEEPSEEK_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "thinking": {"type": "disabled"},
                },
            )
            _handle_response(response)
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            result = json.loads(content)
            return {
                "phonetic": result.get("phonetic", ""),
                "pos": result.get("pos", ""),
                "past_tense": result.get("past_tense", ""),
                "past_participle": result.get("past_participle", ""),
                "translation": result.get("translation", ""),
            }
    except DeepSeekError:
        raise
    except Exception as e:
        raise DeepSeekError(f"DeepSeek 调用失败：{e}")


def translate_text(text: str, user_key: str | None = None) -> str:
    """调用 DeepSeek API 将英文翻译为中文"""
    api_key = _resolve_key(user_key)
    prompt = (
        f"请将以下英文翻译为中文，只返回翻译结果，不要添加任何解释或额外内容：\n\n{text}"
    )

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                DEEPSEEK_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "thinking": {"type": "disabled"},
                },
            )
            _handle_response(response)
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except DeepSeekError:
        raise
    except Exception as e:
        raise DeepSeekError(f"DeepSeek 调用失败：{e}")


def analyze_phonetics(text: str, user_key: str | None = None) -> list:
    """调用 DeepSeek API 分析句子中的连读和弱读部分

    返回 [{type: "liaison"|"weak", text: "原句中的精确子串"}, ...]
    后端会做确定性过滤：连读后词首字母必须为元音，弱读必须在虚词列表中。
    """
    api_key = _resolve_key(user_key)
    prompt = (
        "你是英语语音学专家。分析下面英文句子中需要标注的连读和弱读。\n\n"
        "连读（liaison）— 严格只标注以下两种，其他一律不算连读：\n"
        "1. 辅音结尾 + 元音开头（C+V）：前词最后一个音是辅音，后词第一个音是元音。例：\"pick it\"(/k/+ɪ)、\"look at\"(/k/+æ)、\"an apple\"。\n"
        "2. 元音结尾 + 元音开头（V+V）：两词首尾都是元音。例：\"see it\"、\"go out\"。\n"
        "判断方法：看后词首字母是否为元音字母(a/e/i/o/u)。后词以辅音字母开头的，一律不是连读。\n"
        "反例（不算连读）：\"from Montana\"(辅+辅)、\"the bills\"(元+辅)、\"about the\"(辅+辅)、\"these days\"(辅+辅)。\n"
        "范围是完整的两个单词（含中间空格）。\n\n"
        "弱读（weak）— 只标注虚词：the, to, of, a, an, and, or, for, at, in, on, from, but, as, by, with。\n"
        "范围是单个单词。\n\n"
        "text 必须是原句精确子串。不要重复标注。无则返回空数组 []。\n\n"
        f"句子：\n{text}\n\n"
        '请严格以 JSON 格式返回：{"items": [{"type": "liaison", "text": "精确子串"}, {"type": "weak", "text": "精确子串"}]}'
    )

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                DEEPSEEK_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "thinking": {"type": "disabled"},
                },
            )
            _handle_response(response)
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            result = json.loads(content)
            items = result.get("items", [])
            return _filter_phonetics(items, text)
    except DeepSeekError:
        raise
    except Exception as e:
        raise DeepSeekError(f"DeepSeek 调用失败：{e}")


# 弱读虚词白名单（冠词/介词/连词/代词，不含助动词）
_WEAK_WORDS = frozenset(
    "the to of a an and or for at in on from but as by with".split()
)


def _filter_phonetics(items: list, original_text: str = "") -> list:
    """对 AI 返回的标注做确定性过滤：
    - liaison：后词首字母必须为元音字母
    - weak：单词必须在虚词白名单中
    """
    valid = []
    for item in items:
        t = (item.get("type") or "").strip()
        txt = (item.get("text") or "").strip()
        if t == "liaison":
            parts = txt.split()
            if len(parts) == 2 and parts[1][:1].lower() in "aeiou":
                valid.append({"type": t, "text": txt})
        elif t == "weak":
            if txt.lower() in _WEAK_WORDS:
                valid.append({"type": t, "text": txt})
    return valid
