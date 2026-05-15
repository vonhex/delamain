# Contributing to Delamain

Thanks for taking the time to contribute. Here's everything you need to know.

## Before you start

- **Bug fix or small improvement?** Open a PR directly — no need to ask first.
- **New feature or significant change?** Open an issue first to discuss it. Avoids wasted effort if the direction doesn't fit the project.
- **Question or help needed?** Use [GitHub Discussions](https://github.com/vonhex/delamain/discussions) rather than opening an issue.

## Development setup

```bash
git clone https://github.com/vonhex/delamain.git
cd delamain

# Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in LLM_URL, SEARXNG_URL, etc.
python auth.py set-password <yourpassword>
uvicorn main:app --host 0.0.0.0 --port 8888 --ws-ping-interval 0

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

- Frontend dev server: http://localhost:5000
- Backend API: http://localhost:8888
- Health check: http://localhost:8888/health

F5-TTS model weights are required for voice synthesis — see [F5-TTS setup](../docs/f5-tts.md).

## How to contribute

1. Fork the repository and create a branch from `main`
2. Make your changes — keep them focused on one thing per PR
3. Test your changes locally (both the happy path and edge cases)
4. Run the frontend type-checker: `cd frontend && npm run build`
5. Open a pull request against `main` using the PR template

## What makes a good PR

- **Focused** — one logical change per PR; easier to review and revert if needed
- **No scope creep** — don't refactor surrounding code unless it's directly related
- **No unnecessary comments** — code should be self-explanatory; only comment the *why* when it's non-obvious
- **No new dependencies** without a good reason — every added package is a maintenance burden
- **Test the UI** — if you changed the frontend, actually open a browser and use it

## Code style

- **Backend (Python):** Follow existing patterns. Type hints where they add clarity. No docstrings on obvious functions.
- **Frontend (React + Tailwind):** Match the existing component style. Keep components small and single-purpose.
- Formatting is not enforced by CI — just try to match the surrounding code.

## Reporting bugs

Use the **Bug Report** issue template. The more detail you provide (logs, steps to reproduce, hardware, install method), the faster it gets fixed.

## Feature requests

Use the **Feature Request** issue template. Explain the use case, not just the solution — there may be a better way to solve the underlying problem.

## License note

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE) as the rest of the project.
