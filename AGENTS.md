## Backend

- dont write migrations for the sqlite database, the project is in beta, i will recreate the db file

## Frontend

- use daisyui components
- Avoid calling `setState` synchronously inside `useEffect`. Never use effects to sync or duplicate state; use derived state/inline computation instead to prevent cascading renders.

## Task Tracking

- **Always check TODO.md** before starting work
- **Update TODO.md** as tasks are completed (`[x]`), started (`[~]`), or skipped (`[-]`)
- Keep TODO.md as the single source of truth for project status
