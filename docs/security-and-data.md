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
- **Everything else needs written consent.** The student's own, since anyone at a postsecondary institution is an "eligible student" regardless of age. Your college-only scope makes this materially simpler than the high-school version would.
- **Redisclosure is the trap.** When an institution shares records with an employer, it should notify the employer that the records are FERPA-covered and may not be passed on without consent. The platform is the thing making that sharing easy, so the platform should carry the notice — an employer who forwards a candidate list to a colleague at another company has created a problem that traces back to your product.

### 3. Kansas Student Data Privacy Act (K.S.A. 72-6312 et seq.)

Aimed principally at K-12 boards, so it binds directly only if high school returns to scope. Two provisions are worth honouring regardless, because they are cheap and they are what a district will ask about:

- **Delete personal information when it is no longer required for the purpose it was collected.** That is a retention schedule, and it is a requirement rather than a nicety.
- **No biometric collection, and no device or mechanism assessing a student's psychological or emotional state.** Worth writing into the product principles now, because "engagement scoring" and "readiness assessment" are exactly the features someone will eventually propose.

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

Authorization enforced at the repository layer with tests · one guarded write path · field-level PII disclosure at the data layer · append-only audit enforced by a database trigger · parameterised SQL with an injection test · input validation at every trust boundary · `httpOnly` / `SameSite` session cookie · no analytics, no third-party scripts, no tracking · `noindex`

### Buildable now

| Control | Why it matters here |
|---|---|
| Security headers (CSP, HSTS, frame-ancestors, Referrer-Policy) | The first thing a district IT reviewer scans for |
| Rate limiting on sign-on and every server action | Brute force and enumeration; nothing currently limits either |
| Log redaction helper | `console.error(error)` can serialise a student record today |
| `SECURITY.md` | Public-sector buyers look for a reporting path |
| Upload hardening | Content-type sniffing, size caps, no execution path, signed URLs |
| `npm audit` + Dependabot in CI | Supply chain is the likeliest realistic compromise |

### Policy and procurement, not code

Real authentication with **MFA for admin and board roles specifically** — they see cross-market data and make funding decisions · **encryption at rest** (a statutory safe harbour under Kansas breach law) · **Postgres row-level security** as defence in depth, so an application bug is not automatically a breach · retention and deletion schedules · **incident response with a one-hour clock** if WIOA funds are involved · DPAs with Vercel and the database host · periodic admin access review · penetration test before a government contract

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
