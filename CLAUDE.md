## Frontend

- use daisyui components
- Avoid calling `setState` synchronously inside `useEffect`. Never use effects to sync or duplicate state; use derived state/inline computation instead to prevent cascading renders.
- dont create tests for frontend unless explicited

## Branch & PR Workflow

`main` is protected by a ruleset — **all changes must go through a PR**, never commit directly to `main`.

For any code change you ask me to make:

1. **Branch first** — before writing code, create a branch off `main`. Name it by intent:
   `feat/<short-kebab>` for features, `fix/<short-kebab>` for bug fixes, `chore/<short-kebab>` otherwise.
2. **Implement** the change, updating TODO.md as you go.
3. **Commit** with Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`) — this repo uses release-please, so the prefix drives versioning.
4. **Open a PR** against `main` with `gh pr create`, with a clear title and a body summarizing what changed and why.
5. Report the PR URL back to me.

Skip this only for non-code requests (questions, exploration) or when I explicitly say not to.

## Task Tracking

- **Always check TODO.md** before starting work
- **Update TODO.md** as tasks are completed (`[x]`), started (`[~]`), or skipped (`[-]`)
- Keep TODO.md as the single source of truth for project status
