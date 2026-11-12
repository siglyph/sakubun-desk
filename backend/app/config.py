"""Settings, read from the environment or a .env file at the repository root."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")

HOST = os.getenv("SAKUBUN_HOST", "127.0.0.1")
PORT = int(os.getenv("SAKUBUN_PORT", "8000"))
MODEL = os.getenv("SAKUBUN_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("SAKUBUN_EFFORT", "medium")
# Only needed for an API key that is not tied to one workspace (the API then asks which to bill).
WORKSPACE_ID = os.getenv("ANTHROPIC_WORKSPACE_ID", "").strip()
FRONTEND_DIST = ROOT / "frontend" / "dist"


def ai_configured() -> bool:
    """True when the Anthropic SDK has something to authenticate with."""
    if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("ANTHROPIC_PROFILE"):
        return True
    return (Path.home() / ".config" / "anthropic").is_dir()   # `ant auth login` profile
