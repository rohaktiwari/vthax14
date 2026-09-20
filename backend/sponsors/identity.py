"""GoDaddy ANS protocol card and DNS identity for HokieLens.

No outbound calls. Live Registration Authority POST is a separate opt-in CLI
(``python -m sponsors.identity --register --allow-network``) and is dry-run
by default because it needs a human-issued CSR plus an ANS RA URL.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sponsors import configure_stdio

_DIR = Path(__file__).resolve().parent
ANS_DIR = _DIR / "ans"
AGENT_CARD_PATH = ANS_DIR / "agent-card.json"
REGISTRATION_PATH = ANS_DIR / "registration.json"
DEFAULT_PUBLIC_URL = "http://127.0.0.1:8000"
ENV_PUBLIC_URL = "HOKIELENS_PUBLIC_URL"
ENV_ANS_RA_URL = "ANS_RA_URL"


def public_base_url(environ: dict[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    raw = (env.get(ENV_PUBLIC_URL) or "").strip().rstrip("/")
    return raw or DEFAULT_PUBLIC_URL


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _apply_public_url(payload: Any, base: str) -> Any:
    if isinstance(payload, str):
        return payload.replace("__PUBLIC_BASE__", base)
    if isinstance(payload, list):
        return [_apply_public_url(item, base) for item in payload]
    if isinstance(payload, dict):
        return {key: _apply_public_url(value, base) for key, value in payload.items()}
    return payload


def agent_card_payload(environ: dict[str, str] | None = None) -> dict[str, Any]:
    base = public_base_url(environ)
    card = _apply_public_url(_load_json(AGENT_CARD_PATH), base)
    host = urlparse(base).hostname or "127.0.0.1"
    card["agentHost"] = host
    return card


def registration_payload(environ: dict[str, str] | None = None) -> dict[str, Any]:
    base = public_base_url(environ)
    body = _apply_public_url(_load_json(REGISTRATION_PATH), base)
    host = urlparse(base).hostname or "127.0.0.1"
    body["agentHost"] = host
    return body


def dns_txt_record(environ: dict[str, str] | None = None) -> str:
    base = public_base_url(environ)
    host = urlparse(base).hostname or "127.0.0.1"
    card_url = f"{base}/.well-known/agent-card.json"
    return f'_ans.{host}. 300 IN TXT "v=ansv2; name=HokieLens; ver=0.1.0; url={card_url}"'


def _print_identity() -> None:
    card = agent_card_payload()
    print(json.dumps(card, indent=2, sort_keys=True))
    print()
    print(dns_txt_record())


def _register(*, allow_network: bool) -> int:
    """Dry-run (default) prints the ANS registration body without CSRs.

    A live POST requires ANS_RA_URL, PEM CSRs, and --allow-network. This CLI
    never invents certificates.
    """
    body = registration_payload()
    ra = (os.environ.get(ENV_ANS_RA_URL) or "").strip()
    print(json.dumps(body, indent=2, sort_keys=True))
    if not allow_network:
        print("dry-run: not contacting an ANS Registration Authority", file=sys.stderr)
        return 0
    if not ra:
        print("ANS_RA_URL is unset; cannot register", file=sys.stderr)
        return 2
    if not body.get("identityCsrPEM") or not body.get("serverCsrPEM"):
        print(
            "registration.json has no CSRs; generate them with GoDaddy ANS / ACME first",
            file=sys.stderr,
        )
        return 2
    print("live ANS register is a human step; refusing to POST without a CSR workflow")
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="HokieLens ANS identity")
    parser.add_argument("--register", action="store_true", help="print registration body")
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="opt-in; still refuses without CSRs and ANS_RA_URL",
    )
    args = parser.parse_args(argv)
    configure_stdio()
    if args.register:
        return _register(allow_network=args.allow_network)
    _print_identity()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
