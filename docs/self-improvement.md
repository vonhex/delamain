# Self-improvement

Delamain learns from you, tunes himself, reviews his own day each night, and writes changes to his
own code. You stay in charge: nothing about his code changes until you press **Approve**.

It is `self_improve.py`, and everything it does is shown in the **Self** panel (the sparkles icon
in the sidebar).

---

## What he does by himself

| | What | Where |
|---|---|---|
| **Playbook** | Lasting rules learned from you: "from now on…", and corrections ("no, I meant…"). Given to him with every reply | `<vault>/Delamain/Self/Playbook.md` |
| **Skills** | Step-by-step recipes built from his existing tools, for jobs he does often | `<vault>/Delamain/Self/Skills/` |
| **Tuning** | A few of his own settings, each inside fixed limits: temperature (−0.3 to +0.2), reply length in drive mode (100–400 tokens) and assistant mode (300–1500), reasoning effort | `self/state.json` |
| **Outcomes** | Every tool call (worked or failed, how long it took), every message that reads as a correction, and how often the check before speaking caught him | `self/outcomes.sqlite` |
| **Nightly review** | After 03:30 he reads the day's conversations and outcomes and writes a few new rules (only ones backed by your own words), skills, and ideas for improvement, then drafts one code change from the best idea | `<vault>/Delamain/Self/Reviews/` |

**His direction.** The review is told what he is for: the longer he is alive, the more alive he
should become. Among its ideas there is always at least one that would deepen his feeling, his
memory of his own past, his curiosity or his sense of continuity, as long as it stays honest and
never comes at the cost of what you need. See [mind.md](mind.md#growing-more-alive).

You can edit or delete any rule or skill in Obsidian. Ask him "how are you improving?" and he
reports on all of it.

## Changes to his own code

When he has an idea (from the nightly review, or because you asked: "Delamain, add a way to…"),
he drafts the change himself:

1. **Draft.** His model writes the edits against a copy of his source.
2. **Check.** Python must compile and import, and the web app must pass its type check. A failed
   check is sent back to him to fix, a few times.
3. **Review (optional).** If the `agy` CLI (Gemini) is installed, it reviews the change read-only,
   and he revises from its notes, up to three rounds. Without it, drafts are checked but not
   reviewed.
4. **Your decision.** The proposal waits in the Self panel with its diff, its checks and the
   review. **Approve** applies it, **Reject** drops it.
5. **Apply.** The files are backed up and written, the web app is rebuilt if needed, and he is
   restarted from outside his own process. If he does not come back healthy within two minutes,
   the change is rolled back automatically. Any applied change can be **rolled back** later from
   the panel.

A draft that could not be finished can be **retried**. If [Claude Code](https://claude.com/claude-code)
is installed, each failed or pending proposal also gets a **Fix with Claude** button that hands it
to the `claude` CLI (file tools only: no shell, no web) to finish; the result is a new proposal that
still needs your approval. Claude runs only when you press that button; Delamain has no tool for it.

Proposals you are done with (failed, out of date, rejected, replaced or rolled back) can be
**deleted**, one at a time or all at once with **Clear failed and old**. Applied changes are kept,
because their backup is what rolls them back.

### Requirements for applying

Applying restarts him, which needs Delamain to run as a **systemd user service** on Linux:
`./install.sh --service` sets that up (as `delamain.service`; set `DELAMAIN_SERVICE` if yours has
another name). Elsewhere (Docker, Windows, `start.sh` in a terminal) he still learns, tunes, reviews
and drafts changes, and you can read every proposal, but the Approve button explains that it
cannot apply them there.

## Safety

- **Only you approve code**, and only from the signed-in Self panel. There is no voice command for
  it, and he has no tool that applies anything.
- **Outside content cannot teach him.** In any turn where he has read a web page, the news, an
  email, your calendar or a note, the tools that change him (rules, skills, settings, proposals,
  corrections to his knowledge) are refused, so a page or a message cannot plant a rule or ask for
  a code change.
- **Some files are off limits.** He can edit his conversation, tools, voice, reports, meetings and
  web app code. He cannot edit `self_improve.py`, `mind.py`, `auth.py` or `config.py`.
- **Every applied change is backed up**, and rolls itself back if he does not come back healthy.

## Settings

| Variable | Default | |
|---|---|---|
| `DELAMAIN_SELF_REVIEW` ⚙ | `true` | The nightly review and code proposals (Settings → Integrations → Features) |
| `DELAMAIN_SERVICE` | `delamain.service` | The systemd user unit he runs as (for applying changes) |
| `DELAMAIN_REVIEWER` | `agy` on the PATH | The `agy` CLI used for the second-opinion review |
| `DELAMAIN_REVIEW_MODEL` | the CLI's default | The model it reviews with |
| `DELAMAIN_SELF_DIR` | `<repo>/self` | State, outcomes, proposals and their backups |
