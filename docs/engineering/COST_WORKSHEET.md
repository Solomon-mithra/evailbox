# Cost worksheet (illustrative, not an invoice)

As of 2026-09-25; USD; net after assumed payment + billing fees: $3.54636/user/month.

## AI sensitivity per user per month

| Scenario         | Emails | Tokens/attempt | Attempts factor | $0.042/M | $0.100/M |  $0.250/M |
| ---------------- | -----: | -------------: | --------------: | -------: | -------: | --------: |
| Light            |    300 |          2,000 |            1.05 |  $0.0265 |  $0.0630 |   $0.1575 |
| Planning typical |  1,500 |          4,000 |            1.10 |  $0.2772 |  $0.6600 |   $1.6500 |
| Busy             |  3,000 |          6,000 |            1.15 |  $0.8694 |  $2.0700 |   $5.1750 |
| Heavy            | 10,000 |          8,000 |            1.25 |  $4.2000 | $10.0000 |  $25.0000 |
| Stress           | 30,000 |         12,000 |            1.50 | $22.6800 | $54.0000 | $135.0000 |

## Cohorts: every user has the planning-typical workload

|  Users |    Revenue | Payment + billing |        AI | Base hosting + DB | Digests | Variable reserve | Contribution* | Margin* |
| -----: | ---------: | ----------------: | --------: | ----------------: | ------: | ---------------: | ------------: | ------: |
|      5 |     $19.95 |             $2.22 |     $1.39 |            $45.00 |   $0.00 |            $1.25 |       $-29.90 | -149.9% |
|     10 |     $39.90 |             $4.44 |     $2.77 |            $45.00 |   $0.00 |            $2.50 |       $-14.81 |  -37.1% |
|     25 |     $99.75 |            $11.09 |     $6.93 |            $45.00 |   $0.00 |            $6.25 |        $30.48 |   30.6% |
|    100 |    $399.00 |            $44.36 |    $27.72 |            $45.00 |   $0.00 |           $25.00 |       $256.92 |   64.4% |
|  1,000 |  $3,990.00 |           $443.64 |   $277.20 |            $45.00 |  $20.00 |          $250.00 |     $2,954.16 |   74.0% |
| 10,000 | $39,900.00 |         $4,436.40 | $2,772.00 |            $45.00 | $245.00 |        $2,500.00 |    $29,901.60 |   74.9% |

*Before support, salaries, acquisition, tax, refunds, security reviews and any infrastructure cost above the assumed reserve. Not profit or demonstrated capacity. Base hosting includes its published credits; reserve is additional and is not credited again.

Illustrative contribution break-even: 15 paying users.

## Import / repeated-work exposure at 4,000 tokens and 1.10 attempts factor

- 100 evaluations: $0.0185 AI; 2,020 Gmail quota units for initial list + details (profile/history/retries/attachments excluded).
- 1,000 evaluations: $0.1848 AI; 20,200 Gmail quota units for initial list + details (profile/history/retries/attachments excluded).
- 10,000 evaluations: $1.8480 AI; 202,000 Gmail quota units for initial list + details (profile/history/retries/attachments excluded).
- 100,000 evaluations: $18.4800 AI; 2,020,000 Gmail quota units for initial list + details (profile/history/retries/attachments excluded).

## AI allowance compatible with 70% contribution margin, before fixed costs

Maximum AI + digest allowance: $0.50336/user/month before base-cost allocation and omitted expenses.

- At $0.042/M: 2,723 evaluations at the planning-typical token/attempt size.
- At $0.100/M: 1,144 evaluations at the planning-typical token/attempt size.
- At $0.250/M: 457 evaluations at the planning-typical token/attempt size.
