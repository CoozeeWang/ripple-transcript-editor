"""Transport differences only. All results pass Ripple's existing strict schema."""
import json


def build_request(config, instruction, payload, result_type):
    content = json.dumps(payload, ensure_ascii=False)
    protocol = config.get("protocol", "openai")
    if protocol == "anthropic":
        # A forced tool is used solely as a structured result envelope; never executed.
        return config["base_url"] + "/messages", {
            "x-api-key": config["api_key"], "anthropic-version": "2023-06-01",
        }, {
            "model": config["model"], "max_tokens": 16384,
            "system": instruction,
            "messages": [{"role": "user", "content": content}],
            "tools": [{"name": "ripple_result", "description": "Return the requested editing result.",
                       "input_schema": result_type.model_json_schema()}],
            "tool_choice": {"type": "tool", "name": "ripple_result", "disable_parallel_tool_use": True},
        }
    headers = {"Authorization": f"Bearer {config['api_key']}"} if config.get("api_key") else {}
    body = {"model": config["model"], "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": content}]}
    if protocol == "gemini":
        body["response_format"] = {"type": "json_schema", "json_schema": {
            "name": "ripple_result", "schema": result_type.model_json_schema()}}
    return config["base_url"] + "/chat/completions", headers, body


def parse_result(config, data, result_type):
    from .ai_editing import model_failure
    if not isinstance(data, dict):
        raise TypeError("invalid response")
    if config.get("protocol") == "anthropic":
        if data.get("stop_reason") == "max_tokens":
            raise model_failure(502, "output_limit", "模型输出达到长度上限，请缩小编辑范围后重试")
        if data.get("stop_reason") != "tool_use":
            raise ValueError("incomplete result")
        results = [item for item in data["content"] if isinstance(item, dict) and item.get("type") == "tool_use"]
        if len(results) != 1 or results[0].get("name") != "ripple_result":
            raise ValueError("unexpected result")
        return result_type.model_validate(results[0]["input"])
    choice = data["choices"][0]
    if not isinstance(choice, dict):
        raise TypeError("invalid choice")
    if choice.get("finish_reason") == "length":
        raise model_failure(502, "output_limit", "模型输出达到长度上限，返回内容被截断，请缩小编辑范围后重试")
    if choice.get("finish_reason") != "stop":
        raise ValueError("incomplete result")
    return result_type.model_validate_json(choice["message"]["content"])
