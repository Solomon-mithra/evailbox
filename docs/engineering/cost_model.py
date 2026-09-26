"""OBSOLETE historical planning example: old pricing and retired digest assumptions.
Not a forecast for the current product. Offline planning calculator. No credentials, network calls, or mailbox reads.

Run: python3 docs/engineering/cost_model.py
Optional: --config path/to/custom-assumptions.json
The report uses unrounded arithmetic and rounds only for display.
"""

import argparse
import json
import math
from pathlib import Path


def ai_cost(scenario, assumptions, rate=None):
    attempts = scenario["emails"] * scenario["attempt_multiplier"]
    tokens = attempts * scenario["input_tokens_per_attempt"]
    unit_price = assumptions["ai_input_per_million"] if rate is None else rate
    return tokens / 1_000_000 * unit_price + (
        attempts / 1000 * assumptions["ai_optional_surcharge_per_1000_attempts"]
    )


def delivery_cost(users, assumptions):
    recipients = math.ceil(users * assumptions["digest_opt_in_fraction"])
    volume = recipients * assumptions["digests_per_month"]
    if recipients <= assumptions["resend_free_daily"] and volume <= assumptions["resend_free_monthly"]:
        return 0.0
    return assumptions["resend_pro_base"] + max(
        0, volume - assumptions["resend_pro_included"]
    ) / 1000 * assumptions["resend_extra_per_1000"]


def cohort(users, scenario, a):
    gross = users * a["monthly_price"]
    fees = users * (
        a["monthly_price"] * (a["payment_percent"] + a["subscription_billing_percent"])
        + a["payment_fixed"]
    )
    ai = users * ai_cost(scenario, a)
    fixed = a["vercel_pro_base"] + a["supabase_pro_base_one_micro"]
    delivery = delivery_cost(users, a)
    reserve = users * a["other_variable_reserve_per_user"]
    contribution = gross - fees - ai - fixed - delivery - reserve
    return gross, fees, ai, fixed, delivery, reserve, contribution


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("cost-model.json"))
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    a = config["assumptions"]
    price = a["monthly_price"]
    net = price * (1 - a["payment_percent"] - a["subscription_billing_percent"]) - a["payment_fixed"]
    print("# OBSOLETE historical cost worksheet — not current product guidance")
    print("\nUses retired digest assumptions and old pricing. Do not use for launch or customer claims.")
    print(f"\nAs of {config['as_of']}; USD; net after assumed payment + billing fees: ${net:.5f}/user/month.")
    print("\n## AI sensitivity per user per month")
    rates = config["sensitivity_ai_rates"]
    print("\n| Scenario | Emails | Tokens/attempt | Attempts factor | " + " | ".join(f"${r:.3f}/M" for r in rates) + " |")
    print("|---|---:|---:|---:|" + "---:|" * len(rates))
    for s in config["scenarios"]:
        print(f"| {s['name']} | {s['emails']:,} | {s['input_tokens_per_attempt']:,} | {s['attempt_multiplier']:.2f} | " + " | ".join(f"${ai_cost(s, a, r):.4f}" for r in rates) + " |")
    typical = next(s for s in config["scenarios"] if s["name"] == "Planning typical")
    print("\n## Cohorts: every user has the planning-typical workload")
    print("\n| Users | Revenue | Payment + billing | AI | Base hosting + DB | Digests | Variable reserve | Contribution* | Margin* |")
    print("|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for users in config["cohorts"]:
        values = cohort(users, typical, a)
        print(f"| {users:,} | " + " | ".join(f"${v:,.2f}" for v in values) + f" | {values[-1] / values[0]:.1%} |")
    print("\n*Before support, salaries, acquisition, tax, refunds, security reviews and any infrastructure cost above the assumed reserve. Not profit or demonstrated capacity. Base hosting includes its published credits; reserve is additional and is not credited again.")
    break_even = next((n for n in range(1, 100001) if cohort(n, typical, a)[-1] >= 0), None)
    print(f"\nIllustrative contribution break-even: {break_even} paying users." if break_even else "\nNo contribution break-even found through 100,000 paying users under these assumptions.")
    print("\n## Import / repeated-work exposure at 4,000 tokens and 1.10 attempts factor")
    print()
    for count in [100, 1000, 10000, 100000]:
        case = dict(typical, emails=count, input_tokens_per_attempt=4000, attempt_multiplier=1.10)
        print(f"- {count:,} evaluations: ${ai_cost(case, a):.4f} AI; {count * 20 + math.ceil(count / 25) * 5:,} Gmail quota units for initial list + details (profile/history/retries/attachments excluded).")
    print(f"\n## AI allowance compatible with {a['target_contribution_margin_on_gross']:.0%} contribution margin, before fixed costs")
    allowance = net - price * a["target_contribution_margin_on_gross"] - a["other_variable_reserve_per_user"]
    print(f"\nMaximum AI + digest allowance: ${allowance:.5f}/user/month before base-cost allocation and omitted expenses.")
    print()
    for rate in rates:
        unit = ai_cost(dict(typical, emails=1), a, rate)
        count = f"{max(0, math.floor(allowance / unit)):,}" if unit > 0 else "No finite AI-cost limit on"
        print(f"- At ${rate:.3f}/M: {count} evaluations at the planning-typical token/attempt size.")


if __name__ == "__main__":
    main()
