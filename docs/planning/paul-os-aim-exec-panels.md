# AIM Executive Board — Showing Program Progress From Jira

See `mockups/paul-os-aim-exec-board.html`.

## The framing

A Gantt shows **the plan**. Executives don't need more plan — they have the plan, they approved it. What they need is whether the plan is still true, and what to do about it this week.

So the board is five panels, one question each. If a panel doesn't answer a question a director would actually ask out loud, it doesn't ship.

| Panel                  | The question                  | Beats a Gantt because                                                                           |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Milestone confidence   | Which way is the date moving? | A Gantt shows today's date. This shows the date _as recomputed each week_ — drift is the signal |
| Monte Carlo forecast   | Will we make it?              | Replaces one confident date with a probability                                                  |
| Aging work in progress | What needs me today?          | Gantt bars can't tell you an item is abnormally old                                             |
| Dependency matrix      | Who's blocking whom?          | Cross-vertical queues are invisible in a bar chart                                              |
| Cumulative flow        | Where is work piling up?      | Shows a bottleneck forming weeks before it becomes a slip                                       |
| Scope waterfall        | Why did the date move?        | The one honest answer to "I thought we were nearly done"                                        |

## The panels

**1 · Milestone confidence — forecast date, recomputed weekly.**
For each milestone, plot the _forecast completion date as it was computed each week_. A line drifting right for three weeks is a milestone slipping whether or not anyone has said so out loud. Almost nobody builds this and it is the single most politically useful chart on the board, because it removes the moment where a date jumps four weeks in one review with no warning.

**2 · Monte Carlo forecast.** Sample your actual weekly throughput 10,000 times against remaining scope. Output is a distribution, not a date: _50% by 4 Feb, 85% by 27 Feb, 95% by 14 Mar._ Then place the committed date on it — in the mockup, 1 March sits at 88% confidence, which is a far more useful sentence than "on track." Needs nothing but resolved-issue counts per week.

**3 · Aging work in progress.** Every in-flight item plotted by age, against the percentile lines of everything the program has ever finished. Dots above the 85th line are already abnormal; above the 95th they're pathological. This is the most _actionable_ panel — it names the five items to unstick this week, rather than describing the past.

**4 · Cross-vertical dependency matrix.** Open "is blocked by" links between groups. Row = who's waiting, column = who they're waiting on. In the mockup Integration is waiting on Structures fourteen times, which is the kind of fact that reorganises a staffing conversation in one glance. Computed from links, not from opinion.

**5 · Cumulative flow.** Stacked bands of items per state over time. **The width of a band is how much work is sitting in that state** — so a widening band is a bottleneck forming. The mockup shows the in-review band 3.1× wider than six weeks ago: review capacity is the constraint, not build capacity. That conclusion is worth more than any status field.

**6 · Scope waterfall.** Baseline → planned adds → removed → discovered → completed → remaining. In the mockup, discovered work is 2.4× planned additions, which reframes the story from "scope creep" to "we didn't know what was in there" — a different problem with a different fix.

## What this needs from Jira

One thing matters more than the rest: **the changelog, not the current status.** Most Jira reporting is weak because it reads `status` today. Cycle time, aging, cumulative flow, and milestone drift all need _status transitions with timestamps_. That's `expand=changelog` on the issue search, or the equivalent in a warehouse replica.

| Panel                | Needs                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| Milestone confidence | Changelog + a milestone/fixVersion field, snapshotted weekly                   |
| Monte Carlo          | Resolution dates only — the cheapest panel to build                            |
| Aging WIP            | Changelog: first in-progress transition, current state                         |
| Dependency matrix    | Issue links (`blocks` / `is blocked by`) + vertical mapping                    |
| Cumulative flow      | Changelog, all transitions                                                     |
| Scope waterfall      | Issue created dates + a baseline snapshot + the discovered/planned distinction |

**Vertical mapping is the part that will bite you.** Jira components and labels are inconsistently applied everywhere. Expect 20–40% of issues to have no clean vertical, so every panel discloses coverage — _"computed from 847 of 1,204 issues; 357 have no vertical label."_ That's the same honesty rule as the rest of Paul OS, and it also quietly creates pressure to fix the labelling.

## More ideas, if you want a bigger menu

- **Throughput run chart** — items completed per week per vertical; the input to Monte Carlo, useful on its own
- **Reopen rate** — % of items that go done → reopened. A definition-of-done problem, visible nowhere else
- **Blocked-time histogram** — not how long work takes, but how long it _waits_. Usually the majority of cycle time and always a surprise
- **Epic burnup with a scope line** — burndowns hide scope growth; burnups show the target moving
- **WIP per person per vertical** — the overload detector
- **Effort treemap** — resolved points by vertical × epic, for "we shipped a lot — on what?"

I'd hold the board at five or six. Every extra panel costs the audience's attention and buys less than the one before it.

## The two things that make this yours and not a BI dashboard

**1 · Map Jira components onto vehicle zones.** Once each issue carries a vertical, it also carries an AIM anchor. Then the rocket stops being decoration and becomes the spatial index for work: zone brightness = open item count, or aging, or blocked count. Click a zone, get its issues. That's the thing no BI tool will ever do, and it's why the 3D view earns its place.

**2 · Every panel gets an agent that explains its delta.** The chart shows the milestone moved 15 days right. The agent says _why_ — with citations to the specific issues, links, and transitions that caused it. That's the difference between a dashboard and a program analyst, and it's exactly the T1/T2 work in the agent catalog.

Which resolves the tension in wanting to replace Jira: **you measure the program with Jira data first, and those numbers become the scoreboard for the agent programme.** Cycle time, aging, review-queue width — when the agents start working, these are the lines that move. Build the board before the agents, so you have a before.
