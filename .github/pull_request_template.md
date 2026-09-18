<!--
  The sections below are the ones this repository asks for. Delete the guidance
  comments, keep the headings.
-->

## What changed, and why

<!--
  The why is the part that decays slowest. A reader six months from now can see
  what the diff did; what they cannot recover is which alternative was rejected
  and on what grounds.
-->

## Documentation

**Required. A pull request that changes behaviour and not the docs is a pull
request that makes the docs wrong** — and the docs in this repository are the
argument for why the code is shaped as it is, not a description of it, so a
stale one is a claim nobody notices has stopped being true.

Tick every one you touched, or say why none applied:

- [ ] `README.md` — behaviour, configuration, or an environment variable a person sets
- [ ] `docs/security-and-data.md` — anything that changes what is protected, who may see it, or what is retained
- [ ] `docs/product-vision.md` / `docs/regional-report.md` / `docs/user-story.md` — the programme's claims, the measurement path, or the flow somebody walks
- [ ] `SECURITY.md` — reporting, disclosure, or the supported surface
- [ ] `.env.example` — a new variable, a changed default, or a guard that refuses at boot
- [ ] Module docstrings on the files touched — this codebase keeps the reasoning next to the code
- [ ] **No documentation change needed**, because: <!-- say why -->

Specific things that are easy to leave stale, because each one is a fact
written in prose somewhere:

- A **cost parameter, threshold or limit** quoted in `README.md` (the scrypt `N`
  sat wrong there for a release)
- **`EXPECTED_MIGRATION`** in `src/services/health.ts` when a migration is added
- A **route** that moved — `src/routes.ts` funnels them, but prose and operator
  script output do not
- A **count** stated in prose: migrations, tables, fixtures, portals

## Testing

<!--
  The bar in this repository: `tsc --noEmit` + `eslint` + the full unit suite +
  Postgres parity against `TEST_DATABASE_URL` + the browser suite on both
  backends + every migration applied fresh AND as an upgrade over a database
  holding real rows at the previous version.

  Say what you actually ran. "Should pass" is not a result.
-->

- [ ] `npx tsc --noEmit`
- [ ] `npx eslint`
- [ ] `npm test`
- [ ] Postgres parity — `TEST_DATABASE_URL=… npx vitest run src/data/postgres/integration.test.ts`
- [ ] Migrations applied **fresh** and **as an upgrade** over rows at the previous version (if this PR adds one)
- [ ] Browser suite (if this PR touches a page, a Server Action, or the chrome)

**A toast is not an effect.** Read writes back out of Postgres or out of
`/admin/outbox`, never off the screen that caused them. An end-to-end test
passed for a week here while a Server Action silently dropped a parameter,
because the success toast appeared either way.

## Risk

<!--
  What breaks if this is wrong, and how you would know. Call out anything that
  touches credentials, scoping, retention, the seed's destructive path, or the
  anonymous fallback — those fail silently rather than loudly.
-->
