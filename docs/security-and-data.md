# Security, privacy, and data minimisation

**What this is:** the regimes that actually bite for a platform like this, what they require, and the design rules that follow. Researched rather than recalled — sources at the end.

**What this is not:** legal advice. Several judgements below turn on facts nobody has settled yet — whether federal WIOA money touches the program, whether the platform is a subrecipient or a vendor, whether high school ever comes back into scope. Those change the answers. Route this past counsel before signing anything with a board or a district.

---

## Which regimes bite

Four apply now or nearly. Two more switch on under conditions you should decide deliberately rather than discover.

### 1. WIOA / TEGL 39-11 — **applies the moment federal workforce money is involved**

The $20/hour reimbursement is almost certainly WIOA Title I work-experience funding. If so, DOL's Employment and Training Administration guidance on handling PII (TEGL 39-11) reaches anyone handling participant PII in a WIOA-funded program — grantees and their subrecipients. It is the most demanding thing on this list, and the least negotiable.

What it requires that matters here:

- **FIPS 140-2 validated encryption** for PII transmitted by email or stored on removable media. Not "encryption" generally — a NIST-validated cryptographic module.
- **Never email unencrypted sensitive PII to anyone**, explicitly including ETA itself and contractors. That rules out the obvious convenience of emailing a candidate list to a board officer.
- **PII incident reporting within one hour of discovery** under the broader federal guidance this sits in. One hour is not a typo, and it is far tighter than Kansas breach law.
- **ETA may conduct onsite inspections** to confirm compliance.

**The design signal buried in the PIRL:** for Titles I, II and III, the Unique Individual Identifier field **cannot contain a Social Security Number**. The reporting layout itself is built to avoid carrying SSNs. Take the hint.

### 2. FERPA — applies as soon as a college shares anything about a student

Once the college hands the platform a roster, a verification, or a credit award, those are education records.

- **Directory information** may be disclosed without consent, but only if the institution has designated it as such, given public notice, and offered students a chance to opt out. Each college's designation differs — you cannot assume a field is directory information because another school treats it that way.
- **Everything else needs written consent.** Whose consent depends on which institution holds the record, and this is the part that changed when dual-credit high school students came into scope.

  FERPA rights transfer to the student either at 18 **or on enrolment at a postsecondary institution, at any age**. So for records the *college* holds about a dual-enrolled sixteen-year-old's college coursework, that student is an eligible student and consents for themselves. Records the *high school* holds about the same person remain the parent's until they turn 18.

  A dual-credit work placement can generate both. The practical consequence for the platform: **consent is a property of the record's source institution, not of the student's age**, and a student may need two consents for what looks to them like one activity. Districts commonly require the parental one regardless of what FERPA strictly compels.

  Flagging clearly: this is my reading and it is the kind of question where a district's counsel and the partner college's registrar will have a settled local answer that overrides general reasoning. Confirm before building a consent flow around it — the design conclusion (attach consent to the record's origin) holds either way and is worth adopting now.
- **Redisclosure is the trap.** When an institution shares records with an employer, it should notify the employer that the records are FERPA-covered and may not be passed on without consent. The platform is the thing making that sharing easy, so the platform should carry the notice — an employer who forwards a candidate list to a colleague at another company has created a problem that traces back to your product.

### 3. Kansas Student Data Privacy Act (K.S.A. 72-6312 et seq.)

Aimed principally at K-12 boards — so with dual-credit high school students in scope, **this binds directly** rather than being a courtesy. It was written up here as conditional when the scope was postsecondary-only; it no longer is. Two provisions matter most, and they are what a district will ask about first:

- **Delete personal information when it is no longer required for the purpose it was collected.** That is a retention schedule, and it is a requirement rather than a nicety.
- **No biometric collection, and no device or mechanism assessing a student's psychological or emotional state.** Worth writing into the product principles now, because "engagement scoring" and "readiness assessment" are exactly the features someone will eventually propose.

### 3a. Child labour rules — new, and not a privacy regime

Listed here because it arrived with the same scope change and nothing else in these docs covers it. A **paid** placement for a student under 18 is employment, and federal FLSA plus Kansas rules constrain hours, times of day, and hazardous occupations — tighter under 16 than at 16–17.

This is not something the platform should try to adjudicate, but it is something the platform should **not quietly make easy to get wrong**. A posting that would be lawful for a college sophomore may not be for a dual-enrolled sixteen-year-old on the same worksite, and today nothing in the model distinguishes them. The minimum honest step is that age or minor status becomes a fact the matching and posting layers can see, so the system can decline to suggest a placement it has no business suggesting.

Worth confirming the specifics with someone who does this for a living before encoding any of it.

### 4. Kansas breach notification (K.S.A. 50-7a02)

Applies to anyone conducting business in Kansas and to government agencies. On becoming aware of a breach: a prompt good-faith investigation, then notice to affected Kansas residents as soon as possible if misuse has occurred or is reasonably likely.

**The important detail: the statute covers "unencrypted or unredacted" personal information.** Encryption at rest is a statutory safe harbour, not just a control. That alone justifies encrypting the database.

Note the mismatch: Kansas says "without unreasonable delay"; the federal WIOA guidance says one hour. **Plan to the tighter one.**

### 5. The KORA wrinkle — the one most likely to surprise you

The Kansas Open Records Act reaches private entities under some conditions. The Attorney General's opinions and case law turn on: the extent of public funding, whether the service is one traditionally provided by government, and whether the entity was created by a governmental body. In *State v. Great Plains of Kiowa County*, a private non-profit operating a county hospital was held to have financial records that were public records. The burden of proving an exemption sits with the party withholding.

A platform funded substantially by public workforce dollars, performing intake and case management that a workforce board would otherwise do itself, is not obviously outside that. **Assume some platform records could be requestable**, and design so the answer is easy:

- Keep **program and aggregate data** (placements, credit hours, subsidy deployed, county breakdowns) cleanly separable from **individual PII**. You want to be able to satisfy a records request from the aggregate side without a lawyer reviewing every student record.
- The reporting already derives from an append-only audit log rather than ad hoc queries. That is the right shape for this — it makes "here is what the program did" answerable without exposing "here is who did it."

### 6. State privacy laws — relevant to cookies, covered below

Kansas has no comprehensive consumer privacy law. Twenty states do as of 2026, and your users will not all be Kansans forever.

---

## Cookies: what you can actually use

The direct answer: **you can set a session cookie today with no banner, no consent, and no notice beyond a privacy policy.** What you cannot do is add analytics without giving people a way out.

**No US state requires opt-in consent before setting cookies.** That is the EU regime, and it does not apply here. All twenty states with comprehensive privacy laws use an **opt-out** model.

| Cookie | Consent needed? | Notes |
|---|---|---|
| **Session / authentication** | **No** | Strictly necessary. The `oe_demo_role` cookie and whatever replaces it are in this category |
| CSRF tokens, load balancing, security | No | Strictly necessary |
| Preferences the user set themselves | No | Strictly necessary once they chose it |
| **Analytics** | **Opt-out required** | Not "strictly necessary" — this is the line |
| Advertising, cross-site tracking | Opt-out required, plus more | Triggers "sale/share" provisions in several states |
| **Session replay** | Opt-out required | Also records everything on screen, including other people's PII |

Three things to build in when you get there:

1. **A working opt-out**, not a banner that only offers "accept."
2. **Honour Global Privacy Control.** Twelve states now require businesses to respect the GPC browser signal. It is a request header; ignoring it is the kind of omission that generates an AG letter.
3. **Nothing that records the screen.** Session replay on a page showing a candidate pipeline captures other people's education records. Don't.

**My recommendation: don't add analytics cookies at all.** Use a cookieless, aggregate-only analytics product, or server-side counts derived from your own audit log — which you already have, and which is more trustworthy than a third-party script for the numbers you actually care about. That keeps you out of the entire opt-out regime, removes a third-party script from pages showing student data, and removes a subprocessor from every contract conversation.

The current app sets exactly one cookie, `httpOnly` and `SameSite=Lax`, for the session. That is the right footprint. **Keep it there.**

---

## Data minimisation: the architectural rules

This is the part that is genuinely a design decision rather than a compliance checkbox, and it is where the platform can be structurally safer than its peers rather than merely compliant.

The governing idea: **the platform's job is to move work between four organisations. It does not need to become a copy of any of their systems.** Every field you hold is a field you must secure, retain, delete, disclose on request, and report on if breached.

### Rule 1 — store the determination, not the evidence

The board decides eligibility. The platform stores **that they decided, and what they decided**. It never stores income verification, disability status, justice involvement, veteran status, household composition, or benefits enrolment.

This is already how the model works — `eligibility` is an enum with a date and an actor. **Write it down as a rule**, because the product pressure runs the other way: someone will propose uploading documentation so the board stops chasing paper. The answer is that the board keeps its own records and the platform stores the outcome.

The payoff is not theoretical. Sensitive PII of that kind is what turns a breach from an embarrassment into a federal incident with a one-hour clock.

### Rule 2 — never store an SSN

Not as an identifier, not as a lookup key, not "temporarily during intake." The PIRL itself forbids SSN in the identifier field for Titles I–III. If the board needs to match a participant in their own system, they match on their own key and the platform stores an opaque reference.

### Rule 3 — hold government staff only as role-functional identities

The workforce board's officers are public employees. What the platform needs to do the work is **name, work email, and which organisation they act for**. That is the whole list.

It does not need — and should decline if offered — personal phone numbers, home addresses, employee IDs, HR identifiers, org-chart position, employment status, or anything else that would arrive from a state HR system.

Concretely:
- **Federate identity, never replicate it.** If the board uses SSO, request the minimum claims: subject identifier, email, display name. Do not request directory or profile scopes because they are available.
- **Never hold their credentials.** SSO means you never see a password, which removes an entire class of incident.

  *This is now enforced rather than intended.* Every organisation carries an `identityMode`, and workforce boards are seeded `email_code`: a one-time code to an address on a domain the agency itself declared, and nothing else. **No password is stored for a public employee, and no authenticator seed either** — `user_passwords` simply has no row, and `requiresSecondFactor` answers `false` for the board on purpose. Their second factor is the agency's own mailbox, protected by the agency's own IT controls; issuing them a TOTP seed would be this platform minting a second credential for a government employee, which is the thing the rule exists to prevent.

  Boards defaulted to `federated` for a while, which was the honest destination and, with no adapter shipped, meant a board officer could not use the platform at all. That does not make a pilot safer — it makes it unusable by the agency that determines eligibility, and a rule that blocks the work is a rule somebody suspends under deadline. `federated` remains the mode for an organisation that runs its own IdP, and an address on one is told plainly to sign in there. What did not move is the part that matters: the code can only be sent to the agency's own domain, never to a personal address an officer controls, and the schema still has nowhere to put a password for them.
- **One account is one person, and a board is several accounts.** A workforce board with four officers is four accounts on four work addresses, not one office login four people know. Everything the platform can say about who determined an eligibility rests on `actorUserId` naming an individual, and a shared mailbox breaks that *silently* — the audit entry still looks well-formed, it just means "somebody in that office", which is precisely the answer a WIOA audit cannot use. The schema cannot tell an individual address from a role address, so this is a rule rather than a constraint; what enforces it in practice is that adding a colleague is a supported operation (`addOrganizationMember`) and sharing a login is not.
- **Do not integrate with state HR or personnel systems.** There is no workflow here that needs it, and being connected to one makes you a target for reasons unrelated to your own data.
- Even the officer's name on an interview slot is a choice. It is worth keeping because a student booking a call should know who they are meeting — but note that it is a deliberate inclusion, not an inevitability.

### Rule 4 — every stored field must trace to a decision someone makes on screen

If no screen renders it and no rule branches on it, it should not be in the schema. This sounds obvious and is violated constantly, usually by "we might want it for reporting later." Later is when you add it, with a reason.

Apply this as a review question on every migration: *which decision does this field inform, and who makes it?*

### Rule 5 — disclosure follows the relationship, and is enforced at the data layer

Already built: an employer sees an abbreviated name and no email until a placement is real. The principle generalises — what someone sees is a function of their relationship to the record and how far it has progressed, and it is enforced where the data is read, not in the markup.

The mistake worth naming: masking in the UI while sending the full record to the client is not a control. That bug was in this codebase two weeks ago and the review caught it.

### Rule 6 — retention is a schedule, not an accident

Kansas requires deleting student personal information when it is no longer needed for the purpose collected. Decide the schedule per record type before you have real data:

- Student profile — while enrolled and participating, plus a defined tail
- Application and placement records — long enough for program reporting, then aggregate and purge the PII
- Audit log — long enough for the program's accountability obligations; note that the log intentionally records *who did what*, which is itself personal data
- Uploaded files — shortest of all; resumes and deliverables are the least valuable thing to keep and the most annoying thing to leak

A record with no deletion date is a record you keep forever by default.

### Rule 7 — separate what is program data from what is personal data

Because of KORA, and because it makes reporting cheaper. Aggregates should be derivable without touching individual records. The audit-log-derived reporting already does this; keep it that way rather than adding queries that join across student records for convenience.

---

## Controls

### Already in place

Authorization enforced at the repository layer with tests · one guarded write path · field-level PII disclosure at the data layer · append-only audit enforced by a database trigger · parameterised SQL with an injection test · input validation at every trust boundary · `httpOnly` / `SameSite` session cookie · no analytics, no third-party scripts, no tracking · `noindex` · uploads scanned by a real scanner or refused · no participant PII in any outbound message · consent recorded against the source institution and enforced on disclosure · a retention schedule with a purge that anonymises rather than deletes · sign-on by password or agency mailbox depending on the address, with server-side revocable sessions, an authenticator required of administrators, and no credential of any kind held for a public employee · **the one password anybody else ever chose is spent on first use, enforced on the session rather than on the form that asks for a new one**

| Control | Where | Note |
|---|---|---|
| Nonce-based CSP, `frame-ancestors 'none'` | `src/proxy.ts` | Nonce per request, no allowlist — an allowlist is only as strong as the CDN in it |
| HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | `src/proxy.ts` | HSTS production-only; setting it against localhost pins http out of the developer's own browser |
| Rate limiting on sign-on and mutations | `src/services/rate-limit.ts` | Sign-on is keyed **per address**, with a coarse global backstop behind it; keying only on the session cookie put every signed-out person in one bucket of ten attempts a minute. **Per instance**, so it degrades as functions scale out — swap the store for Redis before real traffic |
| Log redaction | `src/services/logging.ts` | Redacts by key fragment, bounds depth and length, survives cyclic objects |
| Health that names nobody | `src/services/health.ts` | A health report is read by a monitor, a status page and whoever is on call — none of which have the database's access controls, and under FERPA a log holding participant details inherits the handling rules of the data. Every detail is a count, a duration or a setting; the test asserts it against every seeded person |
| Health at two resolutions | `src/app/api/health/route.ts` | An unauthenticated endpoint that answers in detail is reconnaissance: a driver name, a migration filename, an internal scanner's host and port. Anonymous callers get the verdict and nothing else; only an administrator gets the report |
| A scheduled drain, closed by default | `src/app/api/cron/notifications/route.ts` | Sends email, so it is not a read: the secret is compared in constant time, an unset secret refuses everything rather than failing open, and the refusal is a 404 because a 401 confirms the endpoint is worth guessing at |
| Request correlation | `src/proxy.ts` | An `x-request-id` per request, echoed on the response, keeping an upstream id rather than minting a second. An implausible inbound value is replaced rather than escaped — it reaches a log line and a response header, and a newline in it would forge a second entry |
| `npm audit` at high, Dependabot weekly | CI, `.github/dependabot.yml` | Actions are grouped and updated too — a supply-chain path that is easy to forget because it is not in package.json |
| Vulnerability reporting path | `SECURITY.md` | Names cross-tenant access and audit tampering as the findings we most want |
| Upload validation, quarantine, signed retrieval | `src/services/uploads/` | See below |
| Real malware scanning | `src/services/uploads/clamav.ts` | clamd over a socket, spoken directly — no client library in the one place that handles bytes from the internet. Unreachable, timed out or an unrecognised reply all raise and leave the file quarantined; `INSTREAM size limit exceeded. ERROR` is explicitly not a verdict. The EICAR stub is **refused** where a database is configured and writable, because a scanner that passes everything is not a weak scanner |
| Files that survive a restart | `src/services/uploads/postgres-store.ts` | The store follows `DATABASE_URL` like the repositories. A record saying a transcript was accepted, and no transcript, is worse than refusing the upload |
| A purge that reaches the documents | `src/services/retention.ts`, `uploads/access.ts` | Durability created the obligation: a resume outlives the record it was attached to unless something removes it. The sweep runs after the record commits; `canRetrieve` refusing every file of a purged learner is the control, because it does not depend on the sweep having succeeded |
| No participant PII in email | `src/services/notification-privacy.ts`, `templates.ts` | Templates name a **record reference**, never a learner. A denylist strips participant keys at `enqueueNotification` — the `UnitOfWork`, not the renderer, because the Postgres queue persists the payload to a table. `notification-privacy.test.ts` renders every template against every seeded learner and fails on any leak |
| FERPA redisclosure notice | `templates.ts` | On every employer-facing message. The platform is what makes the sharing easy, so it carries the notice |
| Consent, enforced on disclosure | `src/domain/consent.ts` | Attached to the institution whose records it covers. An employer's step up from abbreviated name to contact details requires **both** the placement stage and education-record consent on file; the check runs in both data layers |
| Passwordless sign-on | `src/services/auth.ts`, `src/domain/identity.ts` | A one-time code to a work address. Nothing replayable is stored: the cookie holds a random token and the database its SHA-256, the mailbox holds a code and the database its SHA-256. Codes are emailed directly and **never** enter the notification outbox, which persists every payload and renders it on a screen — that would publish a bearer token per account. Asking for a code never reveals whether an account exists |
| No credential held for a public employee | `src/domain/identity.ts`, seed | Boards are seeded `identityMode: email_code` — a code to a domain the agency declared, no password row, and no second factor issued by us |
| An account belongs to one person | `src/services/access.ts` | Adding a colleague creates their own account on their own work address; the address must be on a domain the organization declared, so an administrator can neither add nor move an account onto a mailbox they read themselves |
| Account recovery is auditable | `src/services/access.ts` | Moving a work address requires a reason, revokes every session and code in flight, records both addresses, and warns the address being left behind |
| Session lifetimes by role | `src/domain/identity.ts` | Absolute *and* idle, tightest where access is widest — 8h/30m for an administrator or board officer, 12h/2h for a college or employer, 24h/4h for a student. Signing out revokes server-side, not just in the browser |
| Anonymous requests refused before anything streams | `src/auth/portal-layout.tsx` | The gate is in each portal's layout, above its `loading.tsx` Suspense boundary. In the page it ran after the response had committed, so a refusal could only be a client-side navigation and anything reading the status code saw `200`. `portal-gate.test.ts` asserts the rule structurally |
| A temporary password cannot become a permanent one | `src/services/auth.ts`, `src/auth/session.ts` | `npm run db:admin` is the only thing that ever stores a password somebody else chose, and it stores it `must_change`. The resolved actor carries the obligation, so both gates turn that session back to the sign-in page — the form that asks for a new password is client state, and a person who types a portal URL never sees it. `portal-gate.test.ts` fails if either gate stops checking |
| No audit row for the bootstrap administrator | `scripts/admin.mjs` | Named rather than hidden. `audit_events` requires a market and an actor and this runs outside the application, so a row claiming the application saw it would be a fabrication. The command logs and prints; who stood up the first administrator is answerable from the host's own records, not from this one |
| Retention schedule | `src/domain/retention.ts` | Four record types with figures and rationales. Purging **anonymises rather than deletes** — the placement survives so reported figures still reconcile — and runs per learner from a computed due list, not as an unattended sweep |

### Uploads

The only place the application accepts arbitrary bytes, so it gets its own note. Everything a client says about a file is treated as a lie: the declared MIME type, the extension, and the filename are all attacker-controlled, and only the bytes are evidence.

- **Allowlist per purpose**, never a denylist — a denylist is a list of the attacks someone already thought of. SVG and HTML are absent from every list because both execute in a browser.
- **Magic-byte verification.** The extension must agree with the actual signature, which is what catches an executable renamed to `.pdf`.
- **Generated storage keys.** A UUID, never derived from the filename — that is what actually defeats traversal. Not a content hash either, which would let someone confirm they hold the same file as a student, and not a sequence, which would let them walk the store.
- **Quarantine before availability.** Files are stored `pending` and only retrievable once a scan clears them. A scanner failure leaves them quarantined, because failing open on a malware check defeats the check. Infected files are deleted rather than kept.
- **Never served inline.** Always `Content-Disposition: attachment`, `nosniff`, and a sandbox CSP. This matters because a `.docx` is only provably a zip, and a zip can contain anything.
- **Signed, expiring URLs *and* an authorization check on every retrieval.** The signature stops key guessing; the check stops a forwarded link being as good as the record. Retrieval follows the record's own disclosure rules — an employer who cannot see a student's email cannot open their resume.
- **Uniform 404s.** "Not yours" and "does not exist" are indistinguishable, so the endpoint cannot be used to confirm which files exist.

The known limitation, stated rather than hidden: a `.docx` signature only proves the file is a zip. Nothing served inline is the mitigation.

### Still buildable

| Control | Why it matters here |
|---|---|
| Object storage for files | Bytes live in Postgres `bytea` today, which is right at the pilot's size and has a ceiling. `FileStore` is the seam an S3 or Blob adapter plugs into |
| An upload surface | The pipeline is complete and nothing calls it. What is missing is the product decision — which documents a placement requires, from whom, at which step |
| Automatic retention sweep | The schedule and the purge exist; running it unattended does not. Deliberate — anonymisation is irreversible and the first unattended run would hit every record at once |
| Directory-information designation per college | Each institution designates its own, and the platform currently gates the same fields for all of them. Needs a per-college setting and a registrar to fill it in |
| Shared-store rate limiting | The current limiter is per instance; a distributed one needs Redis or Vercel KV |
| Branch protection requiring CI | CI reports today but does not block; a red PR is still mergeable |
| Error reporting off the browser | The route error boundary logs client-side, so it reaches a console and not a server. The `digest` it shows is the correlation that works; an endpoint to receive the rest does not exist |

### Policy and procurement, not code

**Turnover.** Nothing removes an account when somebody leaves an agency — a departed officer's account keeps working until an administrator notices. That is the ordinary finding in any access review, and the gap is real: the platform can add a colleague and move an address but cannot yet retire either · **SSO for an agency that wants it** — `federated` is a mode with no adapter behind it, and it is an integration with the agency before it is any code here; a board officer is not blocked meanwhile, they sign in with a code to their agency address · **administrator email change with an audit trail**, which is the account-recovery path a public employee has when their agency address changes and there is no IdP to ask · **encryption at rest** (a statutory safe harbour under Kansas breach law) · **Postgres row-level security** as defence in depth, so an application bug is not automatically a breach · retention and deletion schedules · **incident response with a one-hour clock** if WIOA funds are involved · DPAs with Vercel and the database host · periodic admin access review · penetration test before a government contract

---

## The three things I would decide first

1. **Confirm whether federal WIOA money touches this**, and whether the platform would be a subrecipient or a vendor. It determines whether TEGL 39-11 binds you directly, and that single fact changes encryption requirements, incident timelines, and audit exposure more than anything else on this page.

2. **Commit to never holding eligibility evidence or SSNs**, in writing, as a product principle rather than a current implementation detail. It is the difference between a breach that is embarrassing and one that is reportable to DOL within an hour.

3. **Get a KORA opinion** on whether platform records held on behalf of a workforce board are public records. If they are, you want to know before the first request arrives, not after.

---

## Sources

WIOA and PII handling: [TEGL 39-11 (DOL)](https://www.dol.gov/agencies/eta/advisories/training-and-employment-guidance-letter-no-39-11), [ETA 9170 PIRL](https://www.dol.gov/sites/dolgov/files/ETA/Performance/pdfs/eta_9170_wioa_pirl_final.pdf), [Massachusetts summary of TEGL 39-11](https://www.mass.gov/doc/tegl-39-11-protection-of-personally-identifiable-pii/download)

FERPA: [US Dept of Education, Protecting Student Privacy](https://studentprivacy.ed.gov/frequently-asked-questions), [directory information FAQ](https://studentprivacy.ed.gov/faq/may-educational-agency-or-institution-disclose-directory-information-without-prior-consent), [NACE FERPA primer for employers](https://www.naceweb.org/public-policy-and-legal/legal-issues/882d753f-169b-4a91-a1b7-4c9b4d43a55a)

Kansas: [Student Data Privacy Act, K.S.A. 72-6312 et seq.](https://law.justia.com/codes/kansas/chapter-72/article-63/section-72-6312/), [breach notification, K.S.A. 50-7a02](https://law.justia.com/codes/kansas/chapter-50/article-7a/section-50-7a02/), [Kansas AG on student data privacy](https://www.ag.ks.gov/file-a-complaint/student-data-privacy), [KORA FAQ](https://www.ag.ks.gov/divisions/administration/open-government/kora-faq), [KORA and private entities](https://law-journals-books.vlex.com/vid/87-j-kan-bar-936867816)

Cookies and state privacy: [US state opt-out requirements 2026](https://cookiechimp.com/guides/regulations/us_states_optout_2025_2026), [analytics cookie consent](https://cookiechimp.com/blog/do-analytics-cookies-require-consent), [US cookie consent overview](https://www.cookieyes.com/blog/us-cookie-consent-requirements/)
