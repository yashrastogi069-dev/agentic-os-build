"""LLM cleanup stage — NOT built yet, by design (slow laptop, see RUN_STATE.md).

When llm_cleanup_enabled is flipped to true in config.json, the Ollama-based
clean() from PLAN.md section 3 drops in here (editor system prompt, temperature
0.2, backtick-delimited input, output-length guard). Until then this is a
pass-through and no Ollama install is needed.
"""


def maybe_clean(transcript: str, cfg: dict) -> str:
    if not cfg.get("llm_cleanup_enabled", False):
        return transcript
    print("[cleanup] llm_cleanup_enabled is true but the LLM stage isn't built yet; passing text through")
    return transcript
