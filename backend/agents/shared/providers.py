"""LLM client factories for AI/ML API and Featherless (OpenAI-compatible)."""

from __future__ import annotations

import os

from langchain_openai import ChatOpenAI

from agents.shared.config import ProviderConfig, get_provider_config


def aiml_llm(config: ProviderConfig | None = None, *, temperature: float = 0) -> ChatOpenAI:
    cfg = config or get_provider_config()
    return ChatOpenAI(
        model=cfg.aiml_model,
        base_url=cfg.aiml_base_url,
        api_key=cfg.aiml_api_key,
        temperature=temperature,
        timeout=60,
    )


def configure_aiml_env(config: ProviderConfig | None = None) -> ProviderConfig:
    """Set OpenAI-compatible env vars for Pydantic AI / CrewAI adapters."""
    cfg = config or get_provider_config()
    os.environ["OPENAI_API_KEY"] = cfg.aiml_api_key
    os.environ["OPENAI_BASE_URL"] = cfg.aiml_base_url
    return cfg


def configure_featherless_env(config: ProviderConfig | None = None) -> ProviderConfig:
    cfg = config or get_provider_config()
    os.environ["OPENAI_API_KEY"] = cfg.featherless_api_key
    os.environ["OPENAI_BASE_URL"] = cfg.featherless_base_url
    # CrewAI calls Featherless through LiteLLM. Featherless can intermittently
    # return an empty completion, which CrewAI surfaces as a hard
    # "Invalid response from LLM call - None or empty" failure. A couple of
    # LiteLLM-level retries smooth over those transient empties before the
    # message is marked permanently failed. suppress_debug_info trims LiteLLM's
    # verbose error banners from the logs.
    try:
        import litellm

        litellm.num_retries = 2
        litellm.suppress_debug_info = True
    except ImportError:
        pass
    return cfg


def featherless_model_name(config: ProviderConfig | None = None) -> str:
    cfg = config or get_provider_config()
    model = cfg.featherless_model
    # CrewAI routes through litellm, which reads the first path segment as the
    # provider. Prefix with the openai provider so it targets the custom
    # (Featherless) base_url, and keep the full model id — including any org
    # prefix like "Qwen/" that Featherless requires (stripping it 404s).
    if model.startswith("openai/"):
        return model
    return f"openai/{model}"


def featherless_vision_client(config: ProviderConfig | None = None):
    """Raw OpenAI client pointed at Featherless for vision completions."""
    from openai import OpenAI

    cfg = config or get_provider_config()
    return OpenAI(api_key=cfg.featherless_api_key, base_url=cfg.featherless_base_url)


def featherless_vision_model_name(config: ProviderConfig | None = None) -> str:
    cfg = config or get_provider_config()
    return cfg.featherless_vision_model
