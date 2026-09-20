"""Two-minute sponsor demo: impact story, grounded explain, ANS identity.

Run from backend/::

    python -m sponsors.demo
    python -m sponsors.demo --gemini   # only if HOKIELENS_GEMINI=1 and GEMINI_API_KEY
"""

from __future__ import annotations

import argparse
import json
import sys

from sponsors import configure_stdio, load_local_env
from sponsors.explain import _load_fixture_analysis, explain_analysis
from sponsors.identity import agent_card_payload, dns_txt_record, public_base_url
from sponsors.impact import story_lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="HokieLens sponsor demo")
    parser.add_argument("--gemini", action="store_true")
    args = parser.parse_args(argv)
    configure_stdio()
    load_local_env()

    print("=== Deloitte x Databricks - schedule impact ===")
    for line in story_lines():
        print(line)

    print()
    print("=== Gemini - grounded explanation (easy fixture) ===")
    analysis = _load_fixture_analysis("easy")
    payload = explain_analysis(analysis, allow_network=args.gemini)
    print(f"source={payload['source']} headline={payload['headline']}")
    for card in payload["cards"]:
        print(f"  {card['title']}: {card['body']}")
    if args.gemini and payload["source"] != "gemini":
        print(f"  (fallback: {payload.get('fallback_reason')})", file=sys.stderr)

    print()
    print("=== GoDaddy ANS - public agent identity ===")
    print(f"protocol card: {public_base_url()}/.well-known/agent-card.json")
    print(dns_txt_record())
    card = agent_card_payload()
    print(json.dumps({"agentDisplayName": card["agentDisplayName"], "version": card["version"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
