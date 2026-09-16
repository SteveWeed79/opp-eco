/**
 * Seeded fixtures for the demo.
 *
 * Deliberately covers every state in the machine, including the ones that make
 * the administrator's job visible: applications stalled in the pause, a
 * business waiting on drafting help, a student the board found ineligible, and
 * a market whose subsidy allocation is running down.
 *
 * Every organization is fictional. City and county names are real Kansas
 * places, but no institution, workforce board, or business here corresponds to
 * a real entity — nothing in the demo implies anyone has signed on.
 */

import type {
  Application,
  ApplicationStatus,
  AuditEvent,
  ConsentRecord,
  CreditAward,
  FundingCommitment,
  FundingSource,
  InterviewSlot,
  Market,
  MentorshipOffer,
  MentorshipPairing,
  Organization,
  HostOffer,
  Outcome,
  Posting,
  Student,
  TimeEntry,
  Track,
  User,
} from "@/domain/types";
import { clearanceExpiry } from "@/domain/eligibility";
import { hasExited } from "@/domain/outcome";
import { defaultIdentityMode } from "@/domain/identity";
import { isTerminal } from "@/domain/workflow";
import { scoreMatch } from "@/domain/matching";
import { brandAddress } from "@/brand";

/**
 * The demo's clock for *historical* fixtures, anchored once at module load.
 *
 * Every past-dated timestamp derives from this, and dwell times are measured
 * against the same anchor, so "19 days waiting" reads 19 days no matter how
 * long the process has been up. That stability is the point — a demo whose
 * numbers creep upward while nobody touches it is worse than one frozen.
 *
 * Future-dated data cannot use this anchor. Interview slots built as
 * "tomorrow" relative to module load are in the past by the day after, so they
 * are computed per call against real time instead — see `interviewSlotsAt`.
 */
export const DEMO_NOW = new Date();

function daysAgo(n: number): string {
  return new Date(DEMO_NOW.getTime() - n * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export const markets: Market[] = [
  {
    id: "mkt-pittsburg",
    name: "Southeast Kansas",
    city: "Pittsburg",
    counties: ["Crawford", "Cherokee", "Labette", "Neosho"],
    state: "KS",
    stage: "live",
    boardId: "org-sekwp",
    collegeIds: ["org-verdigris"],
    launchedOn: daysAgo(214),
    programYear: "PY2026",
  },
  {
    id: "mkt-emporia",
    name: "Flint Hills",
    city: "Emporia",
    counties: ["Lyon", "Chase", "Coffey"],
    state: "KS",
    stage: "configuring",
    boardId: "org-fhwp",
    collegeIds: ["org-cottonwood"],
    launchedOn: null,
    programYear: "PY2026",
  },
  {
    id: "mkt-hays",
    name: "Smoky Hill",
    city: "Hays",
    counties: ["Ellis", "Russell", "Trego"],
    state: "KS",
    // The board has committed and the college is in conversation, which is
    // why `collegeIds` is still empty — a college joins that list when it
    // commits, not when it takes a meeting.
    stage: "college_engaged",
    boardId: "org-shwp",
    collegeIds: [],
    launchedOn: null,
    programYear: "PY2026",
  },
  {
    /**
     * The outlier.
     *
     * Three university towns prove the model works next to a university.
     * They cannot show whether it travels, because every one of them has the
     * same anchor institution, the same student supply, and roughly the same
     * employer mix. A market a tenth their size, anchored on a technical
     * college campus and a community college rather than a university, is the
     * one that tests replicability — and it is the one that fails first if
     * the model only works where a university is doing half the work.
     *
     * Lincoln County is paired in deliberately: its Make My Move incentives
     * recruit remote workers into the county, which is a different talent
     * problem sitting next to the same employers.
     */
    id: "mkt-beloit",
    name: "North Central",
    city: "Beloit",
    counties: ["Mitchell", "Lincoln", "Cloud"],
    state: "KS",
    stage: "board_engaged",
    boardId: null,
    collegeIds: [],
    launchedOn: null,
    programYear: "PY2026",
  },
];

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/** The fixture shape before identity is filled in below. */
type OrganizationSeed = Omit<Organization, "identityMode" | "emailDomains"> &
  Partial<Pick<Organization, "identityMode" | "emailDomains">>;

/**
 * An organization's work domain, taken from the address it already gave.
 *
 * Derived rather than written out twice: a contact address and a declared work
 * domain that disagree is the kind of fixture error that reads as a login bug.
 * Businesses are left open — a small employer's staff are as likely to be on a
 * shared mailbox as a corporate domain, and locking them out on day one is how
 * a programme loses the employer it just recruited.
 */
function domainsFor(organization: OrganizationSeed): string[] {
  if (organization.kind === "business") return [];
  const at = organization.contactEmail.lastIndexOf("@");
  return at === -1 ? [] : [organization.contactEmail.slice(at + 1).toLowerCase()];
}

export const organizations: Organization[] = ([
  /**
   * The foundation, and the only `nonprofit` in the fixtures.
   *
   * It exists because a fund needs a sponsor and the venture's own structure is
   * a for-profit paired with a nonprofit arm — the arm that pays the barriers no
   * public formula covers. Invented, like every organization here, and placed in
   * the live market because that is where it has something to spend on.
   *
   * It is not vetted and does not need to be: `canTransact` gates posting and
   * mentorship, and sponsoring a fund is neither.
   */
  {
    id: "org-ccln",
    marketId: "mkt-pittsburg",
    kind: "nonprofit",
    name: "Career Connected Learning Foundation",
    county: "Crawford",
    status: "active",
    contactName: "Rosalind Pace",
    contactEmail: "rpace@ccln-foundation.example.org",
    appliedOn: daysAgo(250),
  },

  // --- Southeast Kansas, live ---
  {
    id: "org-sekwp",
    marketId: "mkt-pittsburg",
    kind: "board",
    name: "Southeast Kansas Workforce Partnership",
    county: "Crawford",
    status: "active",
    contactName: "Marcia Delgado",
    contactEmail: "mdelgado@sekwp.example.org",
    appliedOn: daysAgo(260),
  },
  {
    id: "org-verdigris",
    marketId: "mkt-pittsburg",
    kind: "college",
    name: "Verdigris State University",
    county: "Crawford",
    status: "active",
    contactName: "Dr. Ellen Vance",
    contactEmail: "evance@verdigris.example.edu",
    appliedOn: daysAgo(240),
    hoursPerCredit: 45,
    // Seeded so the theming is visible in the demo: switch to the college or
    // student portal and the whole surface takes the school's colour, while
    // admin and board stay on the platform's.
    brandColor: "#1b5e3f",
    accentColor: "#c9a227",
  },
  {
    id: "org-apex",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Apex Robotics",
    county: "Crawford",
    status: "active",
    contactName: "Dana Reyes",
    contactEmail: "dreyes@apexrobotics.example.com",
    appliedOn: daysAgo(180),
  },
  {
    id: "org-cherokee",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Cherokee Valley Manufacturing",
    county: "Cherokee",
    status: "active",
    contactName: "Ray Buchanan",
    contactEmail: "rbuchanan@cvmfg.example.com",
    appliedOn: daysAgo(160),
  },
  {
    id: "org-frontier",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Frontier Health Partners",
    county: "Crawford",
    status: "active",
    contactName: "Priya Raman",
    contactEmail: "praman@frontierhealth.example.com",
    appliedOn: daysAgo(140),
  },
  {
    id: "org-bluestem",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Bluestem Digital",
    county: "Crawford",
    status: "active",
    contactName: "Tom Okafor",
    contactEmail: "tokafor@bluestem.example.com",
    appliedOn: daysAgo(96),
  },
  {
    id: "org-prairieridge",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Prairie Ridge Municipal Utilities",
    county: "Crawford",
    status: "active",
    contactName: "Janet Whitfield",
    contactEmail: "jwhitfield@prairieridgeutilities.example.com",
    appliedOn: daysAgo(120),
  },
  {
    id: "org-heartland",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Heartland Grain Cooperative",
    county: "Labette",
    status: "active",
    contactName: "Curtis Ballard",
    contactEmail: "cballard@heartlandgrain.example.com",
    appliedOn: daysAgo(88),
  },
  // Awaiting admin vetting
  {
    id: "org-girard",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Girard Metalworks",
    county: "Crawford",
    status: "under_review",
    contactName: "Sam Ortega",
    contactEmail: "sortega@girardmetal.example.com",
    appliedOn: daysAgo(9),
  },
  {
    id: "org-prairie",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Prairie State Insurance Group",
    county: "Neosho",
    status: "applied",
    contactName: "Leah Nussbaum",
    contactEmail: "lnussbaum@prairiestate.example.com",
    appliedOn: daysAgo(3),
  },
  {
    id: "org-fourstate",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "Four State Logistics",
    county: "Cherokee",
    status: "info_requested",
    contactName: "Derek Ames",
    contactEmail: "dames@fourstate.example.com",
    appliedOn: daysAgo(16),
  },

  // --- Flint Hills, configuring ---
  {
    id: "org-fhwp",
    marketId: "mkt-emporia",
    kind: "board",
    name: "Flint Hills Workforce Partnership",
    county: "Lyon",
    status: "active",
    contactName: "Alan Cheng",
    contactEmail: "acheng@fhwp.example.org",
    appliedOn: daysAgo(64),
  },
  {
    id: "org-cottonwood",
    marketId: "mkt-emporia",
    kind: "college",
    name: "Cottonwood State University",
    county: "Lyon",
    status: "approved",
    contactName: "Dr. Renee Boyd",
    contactEmail: "rboyd@cottonwood.example.edu",
    appliedOn: daysAgo(31),
    hoursPerCredit: 40,
  },

  // --- Smoky Hill, college engaged ---
  {
    id: "org-shwp",
    marketId: "mkt-hays",
    kind: "board",
    name: "Smoky Hill Workforce Partnership",
    county: "Ellis",
    status: "active",
    contactName: "Sofia Marquez",
    contactEmail: "smarquez@shwp.example.org",
    appliedOn: daysAgo(45),
  },
  {
    // Engaged, not committed: the record exists because the conversation is
    // real, and it sits in the administrator's vetting queue rather than in
    // the market's `collegeIds`.
    id: "org-chalkbluff",
    marketId: "mkt-hays",
    kind: "college",
    name: "Chalk Bluff State University",
    county: "Ellis",
    status: "under_review",
    contactName: "Dr. Owen Radcliffe",
    contactEmail: "oradcliffe@chalkbluff.example.edu",
    appliedOn: daysAgo(12),
    hoursPerCredit: 45,
  },
] as OrganizationSeed[]).map((organization) => ({
  ...organization,
  /**
   * Boards default to `federated`, which is the claim worth seeding rather than
   * defaulting quietly: a government organization is locked to its own identity
   * provider unless somebody deliberately says otherwise. No adapter ships, so
   * under real sign-on the seeded board officer genuinely cannot get in — the
   * correct failure, and one the demo should show rather than paper over.
   */
  identityMode: organization.identityMode ?? defaultIdentityMode(organization.kind),
  emailDomains: organization.emailDomains ?? domainsFor(organization),
}));

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------

/**
 * Four funds in the live market, one each in the two markets standing up, and
 * none in Beloit.
 *
 * The board's wage subsidy is the old `subsidyBudget` — the same $240,000 at
 * the same $20, now a row rather than a field on the market. What is new is
 * everything beside it: a foundation grant against the cost of internship
 * credit, a college fee waiver aimed at the same cost from the other side, and
 * a small transport fund. That layering is the venture's actual service, and
 * until these rows existed the product could not depict it.
 *
 * Beloit has no fund at all, and that is the case worth seeding. Its board is
 * still in conversation, so `boardId` is null and there is nobody to sponsor a
 * wage subsidy — which means every balance on every screen has to cope with a
 * market that has no money yet, rather than dividing by zero.
 */
export const fundingSources: FundingSource[] = [
  {
    id: "fund-sek-wage",
    marketId: "mkt-pittsburg",
    sponsorOrgId: "org-sekwp",
    kind: "workforce",
    purpose: "wage_subsidy",
    programYear: "PY2026",
    name: "PY2026 WIOA wage reimbursement",
    allocated: 240_000,
    ratePerHour: 20,
    status: "active",
    openedOn: daysAgo(214),
    version: 1,
  },
  {
    /**
     * The one that motivated the whole change.
     *
     * The student survey's top barrier is the tuition a student pays to receive
     * credit for work the board is already subsidising. This is the fund that
     * pays it, and before this row there was nowhere to record either the cost
     * or the grant covering it.
     */
    id: "fund-ccln-credit",
    marketId: "mkt-pittsburg",
    sponsorOrgId: "org-ccln",
    kind: "philanthropic",
    purpose: "credit_cost",
    programYear: "PY2026",
    name: "Internship credit assistance",
    allocated: 18_000,
    status: "active",
    openedOn: daysAgo(150),
    version: 1,
  },
  {
    // The same barrier from the institution's side. Two funds rather than one
    // because a college waiving its own fee and a foundation paying it are
    // different money with different reporting, and a model that merged them
    // would have to un-merge them the first time either was audited.
    id: "fund-verdigris-waiver",
    marketId: "mkt-pittsburg",
    sponsorOrgId: "org-verdigris",
    kind: "institutional",
    purpose: "credit_cost",
    programYear: "PY2026",
    name: "Work-based learning fee waiver",
    allocated: 9_000,
    status: "active",
    openedOn: daysAgo(180),
    version: 1,
  },
  {
    // Small, and the most likely thing to run out. In a four-county market
    // getting to the placement is frequently the whole obstacle.
    id: "fund-ccln-transport",
    marketId: "mkt-pittsburg",
    sponsorOrgId: "org-ccln",
    kind: "philanthropic",
    purpose: "transportation",
    programYear: "PY2026",
    name: "Rural transportation assistance",
    allocated: 6_000,
    status: "active",
    openedOn: daysAgo(150),
    version: 1,
  },
  {
    id: "fund-fh-wage",
    marketId: "mkt-emporia",
    sponsorOrgId: "org-fhwp",
    kind: "workforce",
    purpose: "wage_subsidy",
    programYear: "PY2026",
    name: "PY2026 WIOA wage reimbursement",
    allocated: 120_000,
    ratePerHour: 20,
    status: "active",
    openedOn: daysAgo(90),
    version: 1,
  },
  {
    id: "fund-sh-wage",
    marketId: "mkt-hays",
    sponsorOrgId: "org-shwp",
    kind: "workforce",
    purpose: "wage_subsidy",
    programYear: "PY2026",
    name: "PY2026 WIOA wage reimbursement",
    allocated: 110_000,
    ratePerHour: 20,
    status: "active",
    openedOn: daysAgo(60),
    version: 1,
  },
];

// ---------------------------------------------------------------------------
// Users — fake sign-on picks one of these
// ---------------------------------------------------------------------------

const staffUsers: User[] = [
  { id: "u-admin", name: "Steve Weed", email: brandAddress("admin") },
  { id: "u-dana", name: "Dana Reyes", email: "dreyes@apexrobotics.example.com" },
  { id: "u-ellen", name: "Dr. Ellen Vance", email: "evance@verdigris.example.edu" },
  { id: "u-marcia", name: "Marcia Delgado", email: "mdelgado@sekwp.example.org" },
];

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

interface StudentSeed {
  id: string;
  name: string;
  program: string;
  standing: string;
  grad: string;
  skills: string[];
  interests: string[];
  hours: number;
  status: Student["status"];
  eligibility: Student["eligibility"];
  eligibilityDaysAgo?: number;
}

const studentSeeds: StudentSeed[] = [
  {
    id: "stu-alex",
    name: "Alex Miller",
    program: "Computer Science",
    standing: "Junior",
    grad: "2027-05",
    skills: ["JavaScript", "Python", "React", "SQL", "Git"],
    interests: ["Software engineering", "Automation"],
    hours: 20,
    status: "verified",
    eligibility: "eligible",
    eligibilityDaysAgo: 38,
  },
  {
    id: "stu-jordan",
    name: "Jordan Taylor",
    program: "Marketing",
    standing: "Senior",
    grad: "2026-12",
    skills: ["Market research", "Copywriting", "Analytics", "Social media"],
    interests: ["Brand strategy"],
    hours: 15,
    status: "verified",
    eligibility: "eligible",
    eligibilityDaysAgo: 22,
  },
  {
    id: "stu-priya",
    name: "Priya Chandra",
    program: "Mechanical Engineering Technology",
    standing: "Senior",
    grad: "2027-05",
    skills: ["CAD", "SolidWorks", "Manufacturing processes", "Quality control"],
    interests: ["Manufacturing", "Process improvement"],
    hours: 25,
    status: "verified",
    eligibility: "eligible",
    eligibilityDaysAgo: 51,
  },
  {
    id: "stu-marcus",
    name: "Marcus Bell",
    program: "Nursing",
    standing: "Junior",
    grad: "2027-12",
    skills: ["Patient care", "Medical terminology", "EHR systems"],
    interests: ["Rural healthcare"],
    hours: 12,
    status: "verified",
    eligibility: "not_determined",
  },
  {
    id: "stu-hana",
    name: "Hana Whitmore",
    program: "Graphic Design",
    standing: "Sophomore",
    grad: "2028-05",
    skills: ["Illustrator", "Figma", "Branding", "Typography"],
    interests: ["Visual identity"],
    hours: 18,
    status: "verified",
    eligibility: "not_determined",
  },
  {
    id: "stu-derek",
    name: "Derek Olsen",
    program: "Accounting",
    standing: "Senior",
    grad: "2026-12",
    skills: ["Excel", "QuickBooks", "Financial analysis", "Auditing"],
    interests: ["Public accounting"],
    hours: 20,
    status: "verified",
    eligibility: "eligible",
    eligibilityDaysAgo: 12,
  },
  {
    id: "stu-tasha",
    name: "Tasha Boone",
    program: "Information Systems",
    standing: "Junior",
    grad: "2027-05",
    skills: ["SQL", "Data analysis", "Python", "Tableau"],
    interests: ["Data analytics"],
    hours: 22,
    status: "verified",
    eligibility: "not_eligible",
    eligibilityDaysAgo: 30,
  },
  {
    id: "stu-luis",
    name: "Luis Ferreira",
    program: "Construction Management",
    standing: "Senior",
    grad: "2027-05",
    skills: ["Blueprint reading", "Project scheduling", "OSHA 30", "Estimating"],
    interests: ["Commercial construction"],
    hours: 24,
    status: "verified",
    eligibility: "eligible",
    eligibilityDaysAgo: 8,
  },
  {
    id: "stu-nina",
    name: "Nina Kowalski",
    program: "Biology",
    standing: "Senior",
    grad: "2027-05",
    skills: ["Lab techniques", "Data collection", "Scientific writing"],
    interests: ["Environmental science"],
    hours: 16,
    status: "verified",
    eligibility: "not_determined",
  },
  {
    id: "stu-omar",
    name: "Omar Haddad",
    program: "Computer Science",
    standing: "Sophomore",
    grad: "2028-05",
    skills: ["Java", "Python", "Git", "Algorithms"],
    interests: ["Backend development"],
    hours: 14,
    status: "verified",
    eligibility: "not_determined",
  },
  // Awaiting college verification
  {
    id: "stu-riley",
    name: "Riley Chen",
    program: "Communications",
    standing: "Junior",
    grad: "2027-12",
    skills: ["Writing", "Video editing", "Public relations"],
    interests: ["Corporate communications"],
    hours: 18,
    status: "pending_verification",
    eligibility: "not_determined",
  },
  {
    id: "stu-devon",
    name: "Devon Pryor",
    program: "Business Administration",
    standing: "Senior",
    grad: "2026-12",
    skills: ["Excel", "Project management", "Operations"],
    interests: ["Operations management"],
    hours: 20,
    status: "pending_verification",
    eligibility: "not_determined",
  },
  {
    id: "stu-mei",
    name: "Mei Lin",
    program: "Electrical Engineering Technology",
    standing: "Junior",
    grad: "2027-05",
    skills: ["Circuit design", "PLC programming", "Troubleshooting"],
    interests: ["Industrial automation"],
    hours: 20,
    status: "pending_verification",
    eligibility: "not_determined",
  },
  {
    id: "stu-caleb",
    name: "Caleb Ross",
    program: "Finance",
    standing: "Sophomore",
    grad: "2028-05",
    skills: ["Excel", "Financial modeling"],
    interests: ["Corporate finance"],
    hours: 10,
    status: "profile_complete",
    eligibility: "not_determined",
  },
];

/**
 * One derivation for both the student record and the users table, so a
 * session's user id always resolves to a student. Deriving `u-${s.id}` gave
 * `u-stu-omar`, which matched neither.
 */
function userIdForStudent(studentId: string): string {
  return `u-${studentId.replace(/^stu-/, "")}`;
}

export const students: Student[] = studentSeeds.map((s) => ({
  id: s.id,
  marketId: "mkt-pittsburg",
  // Nothing in the seed is old enough for the retention clock to have run out.
  purgedOn: null,
  userId: userIdForStudent(s.id),
  collegeId: "org-verdigris",
  name: s.name,
  email: `${s.name.split(" ")[0].toLowerCase()}${s.name.split(" ")[1].toLowerCase()[0]}@students.verdigris.example.edu`,
  programOfStudy: s.program,
  classStanding: s.standing,
  expectedGraduation: s.grad,
  skills: s.skills,
  interests: s.interests,
  availableHoursPerWeek: s.hours,
  status: s.status,
  eligibility: s.eligibility,
  eligibilityDeterminedOn: s.eligibilityDaysAgo ? daysAgo(s.eligibilityDaysAgo) : null,
  // Computed from the determination by the domain's rule rather than from
  // today, so it is the same expiry the database's own mapper derives.
  eligibilityExpiresOn: clearanceExpiry(
    s.eligibilityDaysAgo ? daysAgo(s.eligibilityDaysAgo) : null,
  ),
  verifiedOn: s.status === "verified" ? daysAgo(60) : null,
}));

/**
 * Staff plus one user per student, derived from the same source as the student
 * records so a session's user id always resolves both ways.
 */
export const users: User[] = [
  ...staffUsers,
  ...students.map((s) => ({ id: s.userId, name: s.name, email: s.email })),
];

/** Resolve the student a signed-in user is, if any. */
export function studentForUser(userId: string): Student | null {
  return students.find((s) => s.userId === userId) ?? null;
}

// ---------------------------------------------------------------------------
// Postings
// ---------------------------------------------------------------------------

export const postings: Posting[] = [
  {
    id: "post-apex-swe",
    marketId: "mkt-pittsburg",
    businessId: "org-apex",
    track: "standard",
    title: "Software Engineering Intern",
    description:
      "Build and test control software for warehouse automation systems alongside our engineering team.",
    county: "Crawford",
    skillsRequired: ["JavaScript", "Python", "Git"],
    skillsPreferred: ["React", "SQL"],
    status: "published",
    openings: 2,
    createdOn: daysAgo(48),
    wagePerHour: 22,
    hoursPerWeek: 15,
    weeks: 14,
    creditHours: 3,
    supervisorName: "Dana Reyes",
  },
  {
    id: "post-apex-qa",
    marketId: "mkt-pittsburg",
    businessId: "org-apex",
    track: "micro",
    title: "Automated test suite audit",
    description:
      "Review our existing test coverage and produce a prioritised gap analysis with recommendations.",
    county: "Crawford",
    skillsRequired: ["Python", "Git"],
    skillsPreferred: ["Algorithms"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(11),
    projectFee: 750,
    estimatedHours: 30,
    deliverable: "Written gap analysis with prioritised recommendations",
    dueWithinDays: 21,
  },
  {
    id: "post-cherokee-mfg",
    marketId: "mkt-pittsburg",
    businessId: "org-cherokee",
    track: "standard",
    title: "Manufacturing Process Intern",
    description:
      "Support continuous improvement projects on the production floor, including time studies and layout analysis.",
    county: "Cherokee",
    skillsRequired: ["CAD", "Manufacturing processes"],
    skillsPreferred: ["SolidWorks", "Quality control"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(40),
    wagePerHour: 21,
    hoursPerWeek: 20,
    weeks: 14,
    creditHours: 3,
    supervisorName: "Ray Buchanan",
  },
  {
    id: "post-frontier-nursing",
    marketId: "mkt-pittsburg",
    businessId: "org-frontier",
    track: "standard",
    title: "Clinical Operations Intern",
    description:
      "Shadow care coordination staff and support patient intake workflow improvements across three rural clinics.",
    county: "Crawford",
    skillsRequired: ["Medical terminology", "Patient care"],
    skillsPreferred: ["EHR systems"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(35),
    wagePerHour: 20,
    hoursPerWeek: 12,
    weeks: 14,
    creditHours: 3,
    supervisorName: "Priya Raman",
  },
  {
    id: "post-bluestem-brand",
    marketId: "mkt-pittsburg",
    businessId: "org-bluestem",
    track: "micro",
    title: "Brand refresh moodboard",
    description:
      "Produce three distinct visual directions for a regional client's brand refresh, with rationale.",
    county: "Crawford",
    skillsRequired: ["Figma", "Branding"],
    skillsPreferred: ["Typography", "Illustrator"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(6),
    projectFee: 500,
    estimatedHours: 20,
    deliverable: "Three visual directions with written rationale",
    dueWithinDays: 14,
  },
  {
    id: "post-bluestem-research",
    marketId: "mkt-pittsburg",
    businessId: "org-bluestem",
    track: "micro",
    title: "Competitor landscape brief",
    description:
      "Research and summarise the regional competitive landscape for a SaaS client entering Kansas.",
    county: "Crawford",
    skillsRequired: ["Market research", "Analytics"],
    skillsPreferred: ["Copywriting"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(19),
    projectFee: 400,
    estimatedHours: 15,
    deliverable: "Competitive landscape brief",
    dueWithinDays: 10,
  },
  {
    id: "post-utilities-webdev",
    marketId: "mkt-pittsburg",
    businessId: "org-prairieridge",
    track: "standard",
    title: "Web Developer Trainee",
    description:
      "Rebuild sections of the city's public services portal and improve accessibility compliance.",
    county: "Crawford",
    skillsRequired: ["JavaScript", "React"],
    skillsPreferred: ["SQL", "Git"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(26),
    wagePerHour: 18,
    hoursPerWeek: 15,
    weeks: 14,
    creditHours: 3,
    supervisorName: "Janet Whitfield",
  },
  {
    id: "post-heartland-data",
    marketId: "mkt-pittsburg",
    businessId: "org-heartland",
    track: "standard",
    title: "Grain Logistics Data Intern",
    description:
      "Analyse rail and truck movement data to identify scheduling inefficiencies across four elevators.",
    county: "Labette",
    skillsRequired: ["SQL", "Data analysis"],
    skillsPreferred: ["Tableau", "Python"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(21),
    wagePerHour: 21,
    hoursPerWeek: 18,
    weeks: 14,
    creditHours: 3,
    supervisorName: "Curtis Ballard",
  },
  {
    id: "post-utilities-billing",
    marketId: "mkt-pittsburg",
    businessId: "org-prairieridge",
    track: "micro",
    title: "Utility billing reconciliation",
    description:
      "Reconcile three months of utility billing exports against the general ledger and document discrepancies.",
    county: "Crawford",
    skillsRequired: ["Excel", "Financial analysis"],
    skillsPreferred: ["Auditing"],
    status: "published",
    openings: 1,
    createdOn: daysAgo(4),
    projectFee: 450,
    estimatedHours: 18,
    deliverable: "Reconciliation workbook and discrepancy memo",
    dueWithinDays: 14,
  },
  // Businesses that asked the college for drafting help
  {
    id: "post-heartland-help",
    marketId: "mkt-pittsburg",
    businessId: "org-heartland",
    track: "standard",
    title: "Agronomy Support Intern",
    description:
      "We know we need help in the field office during harvest but we are not sure how to scope this as an internship.",
    county: "Labette",
    skillsRequired: [],
    skillsPreferred: [],
    status: "help_requested",
    openings: 1,
    createdOn: daysAgo(12),
    wagePerHour: 19,
    hoursPerWeek: 20,
    weeks: 14,
    supervisorName: "Curtis Ballard",
  },
  {
    id: "post-cherokee-help",
    marketId: "mkt-pittsburg",
    businessId: "org-cherokee",
    track: "micro",
    title: "Safety signage refresh",
    description: "Need updated floor signage. Not sure what a good deliverable looks like.",
    county: "Cherokee",
    skillsRequired: [],
    skillsPreferred: [],
    status: "help_requested",
    openings: 1,
    createdOn: daysAgo(5),
    projectFee: 350,
    estimatedHours: 12,
    dueWithinDays: 14,
  },
  {
    id: "post-frontier-review",
    marketId: "mkt-pittsburg",
    businessId: "org-frontier",
    track: "standard",
    title: "Health Informatics Intern",
    description:
      "Support migration of patient scheduling data and build reporting dashboards for clinic leadership.",
    county: "Crawford",
    skillsRequired: ["SQL", "Data analysis"],
    skillsPreferred: ["EHR systems"],
    status: "pending_review",
    openings: 1,
    createdOn: daysAgo(2),
    wagePerHour: 22,
    hoursPerWeek: 16,
    weeks: 14,
    creditHours: 3,
    supervisorName: "Priya Raman",
  },
];

// ---------------------------------------------------------------------------
// Mentorship offers — employers giving time rather than a placement
// ---------------------------------------------------------------------------

/**
 * Covers all three states, including the two an employer's own portal has to
 * handle: a paused offer that needs a way back, and a withdrawn one that must
 * disappear from both the mentor list and the employer's own screen.
 *
 * Spread across three employers on purpose. Every other fixture in this file
 * is anchored on Apex Robotics because that is who the demo signs in as, but a
 * mentor list showing one company would not demonstrate a list at all.
 */
export const mentorshipOffers: MentorshipOffer[] = [
  {
    id: "men-apex-controls",
    marketId: "mkt-pittsburg",
    businessId: "org-apex",
    format: "one_to_one",
    mentorName: "Dana Reyes",
    mentorRole: "Director of Engineering",
    topics: ["Robotics", "PLC programming", "Career planning"],
    description:
      "Monthly hour with a student thinking about controls engineering — what the work is actually like, which classes matter, and what a first job asks for.",
    capacity: 2,
    status: "open",
    createdOn: daysAgo(64),
  },
  {
    id: "men-apex-shadow",
    marketId: "mkt-pittsburg",
    businessId: "org-apex",
    format: "job_shadow",
    mentorName: "Miguel Santos",
    mentorRole: "Automation Technician",
    topics: ["Robotics", "Manufacturing"],
    description:
      "Half a day on the floor watching a cell get commissioned. Steel-toe boots provided.",
    capacity: 4,
    // Paused rather than withdrawn: the shop is mid-installation, and this
    // comes back. The employer portal has to offer a way back.
    status: "paused",
    createdOn: daysAgo(41),
  },
  {
    id: "men-cherokee-shadow",
    marketId: "mkt-pittsburg",
    businessId: "org-cherokee",
    format: "group_session",
    mentorName: "Ray Buchanan",
    mentorRole: "Plant Manager",
    topics: ["Manufacturing", "Quality control"],
    description:
      "Plant tour and Q&A for a class, arranged with the college. Groups of up to fifteen.",
    capacity: 15,
    status: "open",
    createdOn: daysAgo(30),
  },
  {
    id: "men-bluestem-portfolio",
    marketId: "mkt-pittsburg",
    businessId: "org-bluestem",
    format: "portfolio_review",
    mentorName: "Tom Okafor",
    mentorRole: "Creative Director",
    topics: ["Web development", "UX design", "Portfolio"],
    description:
      "An hour going through a student's portfolio the way a hiring manager would, with the notes they would not normally hear.",
    capacity: 3,
    status: "open",
    createdOn: daysAgo(12),
  },
  {
    id: "men-apex-retired",
    marketId: "mkt-pittsburg",
    businessId: "org-apex",
    format: "portfolio_review",
    mentorName: "Karen Liu",
    mentorRole: "Former Quality Lead",
    topics: ["Quality control"],
    description: "Résumé reviews for students heading into quality roles.",
    // Withdrawn because the named mentor left. Present in the fixtures so both
    // surfaces are exercised against a terminal offer that must not render.
    status: "withdrawn",
    capacity: 1,
    createdOn: daysAgo(150),
  },
];

// ---------------------------------------------------------------------------
// Introductions — who the college has actually put in front of a mentor
// ---------------------------------------------------------------------------

/**
 * Three, deliberately covering all three states.
 *
 * One live introduction occupying a place, one that happened, and one that did
 * not — because an employer's declared capacity is only checkable against a
 * mixture, and a surface that renders only the happy state is a surface nobody
 * has looked at with a real market in it.
 */
export const mentorshipPairings: MentorshipPairing[] = [
  {
    id: "pair-1",
    marketId: "mkt-pittsburg",
    offerId: "men-apex-controls",
    businessId: "org-apex",
    studentId: "stu-nina",
    introducedByUserId: "u-ellen",
    introducedOn: daysAgo(12),
    status: "introduced",
  },
  {
    id: "pair-2",
    marketId: "mkt-pittsburg",
    offerId: "men-bluestem-portfolio",
    businessId: "org-bluestem",
    studentId: "stu-hana",
    introducedByUserId: "u-ellen",
    introducedOn: daysAgo(40),
    status: "met",
    outcomeNote: "Hour on her portfolio; she rewrote two case studies after it.",
    outcomeOn: daysAgo(31),
  },
  {
    id: "pair-3",
    marketId: "mkt-pittsburg",
    offerId: "men-cherokee-shadow",
    businessId: "org-cherokee",
    studentId: "stu-marcus",
    introducedByUserId: "u-ellen",
    introducedOn: daysAgo(55),
    status: "declined",
    outcomeNote: "Student took a placement instead and withdrew from the visit.",
    outcomeOn: daysAgo(48),
  },
];

// ---------------------------------------------------------------------------
// Applications — spread across every state, with realistic dwell times
// ---------------------------------------------------------------------------

interface AppSeed {
  id: string;
  postingId: string;
  studentId: string;
  status: ApplicationStatus;
  furthestStatus?: ApplicationStatus;
  submittedDaysAgo: number;
  statusSinceDaysAgo: number;
  fundingHours?: number;
  hoursLogged?: number;
  hoursApproved?: number;
  deliverableSubmitted?: boolean;
  deliverableAccepted?: boolean;
  creditAwardId?: string;
  interviewSlotId?: string;
}

const appSeeds: AppSeed[] = [
  // --- Healthy flow, work underway ---
  {
    id: "app-1",
    postingId: "post-apex-swe",
    studentId: "stu-alex",
    status: "placement_active",
    submittedDaysAgo: 62,
    statusSinceDaysAgo: 34,
    fundingHours: 210,
    hoursLogged: 96,
    hoursApproved: 88,
  },
  {
    id: "app-2",
    postingId: "post-cherokee-mfg",
    studentId: "stu-priya",
    status: "placement_active",
    submittedDaysAgo: 58,
    statusSinceDaysAgo: 30,
    fundingHours: 280,
    hoursLogged: 124,
    hoursApproved: 124,
  },
  {
    id: "app-3",
    postingId: "post-heartland-data",
    studentId: "stu-derek",
    status: "funding_authorized",
    submittedDaysAgo: 24,
    statusSinceDaysAgo: 3,
    fundingHours: 252,
  },

  // --- Stuck in the pause: the administrator's exception queue ---
  {
    id: "app-4",
    postingId: "post-utilities-webdev",
    studentId: "stu-omar",
    status: "mutual_interest",
    submittedDaysAgo: 32,
    statusSinceDaysAgo: 19, // badly stalled — never booked an interview
  },
  {
    id: "app-5",
    postingId: "post-frontier-nursing",
    studentId: "stu-marcus",
    status: "mutual_interest",
    submittedDaysAgo: 21,
    statusSinceDaysAgo: 11,
  },
  {
    id: "app-6",
    postingId: "post-apex-swe",
    studentId: "stu-nina",
    status: "interview_scheduled",
    submittedDaysAgo: 18,
    statusSinceDaysAgo: 5,
    interviewSlotId: "slot-3",
  },
  {
    id: "app-7",
    postingId: "post-heartland-data",
    studentId: "stu-hana",
    status: "interview_completed",
    submittedDaysAgo: 26,
    statusSinceDaysAgo: 8, // board has not recorded a determination
  },
  {
    id: "app-8",
    postingId: "post-cherokee-mfg",
    studentId: "stu-luis",
    status: "cleared",
    submittedDaysAgo: 15,
    statusSinceDaysAgo: 6, // eligible but no funding decision yet
  },

  // --- Business sitting on a review ---
  //
  // Not Tasha: she is the unsubsidized placement on this same posting below,
  // and one student may hold one application per posting — the rule
  // `submitApplication` enforces and the schema's `one_application_per_posting`
  // restates.
  {
    id: "app-9",
    postingId: "post-utilities-webdev",
    studentId: "stu-marcus",
    status: "under_review",
    submittedDaysAgo: 17,
    statusSinceDaysAgo: 14,
  },
  {
    id: "app-10",
    postingId: "post-frontier-nursing",
    studentId: "stu-jordan",
    status: "submitted",
    submittedDaysAgo: 4,
    statusSinceDaysAgo: 4,
  },
  // Jordan rather than Omar for the same reason: Omar's live placement below
  // (`app-27`) is against this posting, and a second application to it is a
  // state neither the app nor the schema will produce.
  {
    id: "app-11",
    postingId: "post-apex-swe",
    studentId: "stu-jordan",
    status: "shortlisted",
    submittedDaysAgo: 9,
    statusSinceDaysAgo: 2,
  },

  // --- Unsubsidized path: board declined, placement went ahead anyway ---
  {
    id: "app-12",
    postingId: "post-utilities-webdev",
    studentId: "stu-tasha",
    status: "unsubsidized",
    submittedDaysAgo: 44,
    statusSinceDaysAgo: 7,
  },

  // --- Micro track, fast turnaround ---
  {
    id: "app-13",
    postingId: "post-bluestem-research",
    studentId: "stu-jordan",
    status: "placement_completed",
    submittedDaysAgo: 18,
    statusSinceDaysAgo: 2,
    deliverableSubmitted: true,
    deliverableAccepted: true,
  },
  {
    id: "app-14",
    postingId: "post-bluestem-brand",
    studentId: "stu-hana",
    status: "placement_active",
    submittedDaysAgo: 5,
    statusSinceDaysAgo: 3,
    deliverableSubmitted: false,
  },
  {
    id: "app-15",
    postingId: "post-apex-qa",
    studentId: "stu-omar",
    status: "mutual_interest",
    submittedDaysAgo: 3,
    statusSinceDaysAgo: 1,
  },
  {
    id: "app-16",
    postingId: "post-utilities-billing",
    studentId: "stu-derek",
    status: "submitted",
    submittedDaysAgo: 2,
    statusSinceDaysAgo: 2,
  },

  // --- Micro-internships already banked toward a credit ---
  {
    id: "app-17",
    postingId: "post-bluestem-research",
    studentId: "stu-hana",
    status: "credit_pending",
    submittedDaysAgo: 70,
    statusSinceDaysAgo: 9,
    deliverableSubmitted: true,
    deliverableAccepted: true,
  },
  {
    id: "app-18",
    postingId: "post-utilities-billing",
    studentId: "stu-hana",
    status: "credit_pending",
    submittedDaysAgo: 55,
    statusSinceDaysAgo: 9,
    deliverableSubmitted: true,
    deliverableAccepted: true,
  },

  // --- Completed and credited ---
  {
    id: "app-19",
    postingId: "post-cherokee-mfg",
    studentId: "stu-jordan",
    status: "credit_granted",
    submittedDaysAgo: 190,
    statusSinceDaysAgo: 26,
    fundingHours: 280,
    hoursLogged: 268,
    hoursApproved: 268,
    creditAwardId: "credit-1",
  },
  {
    id: "app-20",
    postingId: "post-apex-swe",
    studentId: "stu-priya",
    status: "credit_granted",
    submittedDaysAgo: 200,
    statusSinceDaysAgo: 31,
    fundingHours: 210,
    hoursLogged: 205,
    hoursApproved: 205,
    creditAwardId: "credit-2",
  },
  {
    id: "app-21",
    postingId: "post-heartland-data",
    studentId: "stu-luis",
    status: "credit_pending",
    submittedDaysAgo: 180,
    statusSinceDaysAgo: 12,
    fundingHours: 252,
    hoursLogged: 240,
    hoursApproved: 240,
  },

  // --- Micro-internships banked but short of a credit on their own ---
  {
    id: "app-24",
    postingId: "post-bluestem-research",
    studentId: "stu-omar",
    status: "placement_completed",
    submittedDaysAgo: 48,
    statusSinceDaysAgo: 27,
    deliverableSubmitted: true,
    deliverableAccepted: true,
  },
  {
    id: "app-25",
    postingId: "post-utilities-billing",
    studentId: "stu-omar",
    status: "placement_completed",
    submittedDaysAgo: 33,
    statusSinceDaysAgo: 14,
    deliverableSubmitted: true,
    deliverableAccepted: true,
  },

  // --- Finished and closed out. Exercises funnel reporting: a closed
  // application must still count toward every stage it actually reached.
  {
    id: "app-26",
    postingId: "post-apex-swe",
    studentId: "stu-derek",
    status: "closed",
    furthestStatus: "credit_granted",
    submittedDaysAgo: 260,
    statusSinceDaysAgo: 40,
    fundingHours: 210,
    hoursLogged: 198,
    hoursApproved: 198,
    creditAwardId: "credit-3",
  },

  // --- The demo student's own active placement ---
  // Omar is the seeded student account and his story is the pause — app-4 is
  // still waiting on a board interview. But a student stuck on one application
  // is routinely working another, and without this the signed-in student has
  // no placement to log hours against and the timesheet is a feature you can
  // only read about. `post-apex-swe` carries two openings, and the second is
  // this one; the supervisor is the seeded employer account, so logging a week
  // here lands in Dana's approval queue and the round trip is walkable.
  {
    id: "app-27",
    postingId: "post-apex-swe",
    studentId: "stu-omar",
    status: "placement_active",
    submittedDaysAgo: 51,
    statusSinceDaysAgo: 28,
    fundingHours: 210,
    hoursLogged: 64,
    hoursApproved: 44,
  },

  // --- Rejections and withdrawals ---
  {
    id: "app-22",
    postingId: "post-apex-swe",
    studentId: "stu-caleb",
    status: "rejected",
    submittedDaysAgo: 28,
    statusSinceDaysAgo: 22,
  },
  {
    id: "app-23",
    postingId: "post-bluestem-brand",
    studentId: "stu-riley",
    status: "withdrawn",
    submittedDaysAgo: 20,
    statusSinceDaysAgo: 15,
  },
];

function trackOf(postingId: string): Track {
  return postings.find((p) => p.id === postingId)?.track ?? "standard";
}

export const applications: Application[] = appSeeds.map((a) => {
  const posting = postings.find((p) => p.id === a.postingId)!;
  const student = students.find((s) => s.id === a.studentId)!;
  return {
    id: a.id,
    marketId: "mkt-pittsburg",
    postingId: a.postingId,
    studentId: a.studentId,
    track: trackOf(a.postingId),
    status: a.status,
    furthestStatus: a.furthestStatus,
    submittedOn: daysAgo(a.submittedDaysAgo),
    statusSince: daysAgo(a.statusSinceDaysAgo),
    matchScore: scoreMatch(student, posting, "Crawford"),
    interviewSlotId: a.interviewSlotId,
    fundingAuthorizedHours: a.fundingHours,
    fundingAuthorizedRate: a.fundingHours ? 20 : undefined,
    // Zero rather than undefined, for the reason the deliverable flags are
    // false: the columns behind them are NOT NULL DEFAULT 0, and a cache over
    // the time entries that reads as "unknown" on one data layer and "none" on
    // the other is a cache nobody can compare.
    hoursLogged: a.hoursLogged ?? 0,
    hoursApproved: a.hoursApproved ?? 0,
    // Defaulted rather than left undefined: the schema stores both as
    // NOT NULL DEFAULT false, so a fixture that omits them describes a record
    // the database cannot hold — and the two data layers then disagree about
    // the same application.
    deliverableSubmitted: a.deliverableSubmitted ?? false,
    deliverableAccepted: a.deliverableAccepted ?? false,
    creditAwardId: a.creditAwardId,
    version: 1,
  };
});

// ---------------------------------------------------------------------------
// Timesheets
// ---------------------------------------------------------------------------

/**
 * Weekly entries generated from each placement's hour totals rather than
 * written out by hand.
 *
 * `hoursLogged` and `hoursApproved` are a cache over these rows, so a
 * hand-written fixture that summed to 87 against a stated 88 would be a
 * permanently broken invariant sitting in the demo data. Generating means the
 * two cannot disagree — `timesheet.test.ts` checks it for every seeded
 * placement, and that check is only meaningful because the numbers came from
 * one place.
 */
const WEEKLY_TARGET = 20;

/** Plausible week-notes per posting, cycled. Real enough to review. */
const WORK_NOTES: Record<string, string[]> = {
  "post-apex-swe": [
    "Paired on the parts-catalog importer; wrote the CSV validation cases.",
    "Fixed three defects in the order-status view and shipped them.",
    "Shadowed the on-call rotation, documented two runbook gaps.",
    "Built the retry logic for the supplier feed and tested the failure path.",
  ],
  "post-cherokee-mfg": [
    "Ran dimensional checks on the second-shift output, logged four out-of-tolerance parts.",
    "Cross-trained on the press brake setup sheets.",
    "Updated the tooling inventory and flagged two worn dies for replacement.",
    "Assisted the quality lead with the weekly scrap-rate report.",
  ],
  "post-heartland-data": [
    "Cleaned the elevator throughput logs and rebuilt the weekly summary.",
    "Wrote the moisture-reading import and reconciled it against the paper tickets.",
    "Sat with the scale operators to map how the tickets are actually entered.",
    "Charted the load-out delays by hour for the operations meeting.",
  ],
  "post-frontier-care": [
    "Front-desk intake support and appointment reminder calls.",
    "Digitised the referral backlog; escalated the incomplete records.",
    "Observed the care-coordination huddle and took the action notes.",
    "Reorganised the supply room and rebuilt the reorder list.",
  ],
};

function notesFor(postingId: string, index: number): string {
  const pool = WORK_NOTES[postingId] ?? [
    "Placement work as scheduled with the site supervisor.",
  ];
  return pool[index % pool.length];
}

/** Monday of the week containing a date, matching `weekStartingFor`. */
function mondayOf(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

function weekStartingAgo(weeks: number): string {
  return mondayOf(new Date(DEMO_NOW.getTime() - weeks * 7 * 86_400_000));
}

/** Split a total into weekly chunks of at most `WEEKLY_TARGET`. */
function weeklyChunks(total: number): number[] {
  const chunks: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    chunks.push(Math.min(WEEKLY_TARGET, remaining));
    remaining -= WEEKLY_TARGET;
  }
  return chunks;
}

export const timeEntries: TimeEntry[] = applications.flatMap((application) => {
  // Micro-internships are fixed-fee for a deliverable — no timesheet exists to
  // seed, and inventing one would misrepresent what was bought.
  if (application.track !== "standard") return [];

  const approved = application.hoursApproved ?? 0;
  const logged = application.hoursLogged ?? 0;
  if (logged === 0) return [];

  const posting = postings.find((p) => p.id === application.postingId)!;
  const rows: TimeEntry[] = [];

  const push = (
    index: number,
    hours: number,
    status: TimeEntry["status"],
    extra: Partial<TimeEntry> = {},
  ) => {
    const weekStarting = weekStartingAgo(index + 1);
    rows.push({
      id: `te-${application.id}-${index + 1}`,
      marketId: application.marketId,
      applicationId: application.id,
      studentId: application.studentId,
      businessId: posting.businessId,
      weekStarting,
      hours,
      summary: notesFor(posting.id, index),
      status,
      submittedOn: new Date(
        DEMO_NOW.getTime() - (index + 1) * 7 * 86_400_000 + 5 * 86_400_000,
      ).toISOString(),
      version: 1,
      ...extra,
    });
  };

  // Most recent week first: anything still awaiting review is the newest, and
  // the approved history runs backwards from there.
  let index = 0;
  const pending = logged - approved;
  if (pending > 0) {
    push(index++, pending, "submitted");
  }

  for (const hours of weeklyChunks(approved)) {
    push(index++, hours, "approved", {
      reviewedOn: daysAgo(index * 7 - 2),
      reviewedByUserId: "u-dana",
    });
  }

  // One placement carries a sent-back week, so the demo shows all three states
  // and the correction path is visible rather than theoretical. Rejected hours
  // are excluded from both totals by `timesheetTotals`, so this cannot put the
  // generated rows out of step with the cached numbers.
  if (application.id === "app-1") {
    push(index++, 12, "rejected", {
      reviewedOn: daysAgo(index * 7 - 2),
      reviewedByUserId: "u-dana",
      reviewNote:
        "This week duplicates hours already logged for the previous week. Please resubmit with the correct dates.",
    });
  }

  return rows;
});

// ---------------------------------------------------------------------------
// Board interview slots
// ---------------------------------------------------------------------------

interface SlotSeed {
  id: string;
  inDays: number;
  hour: number;
  officerName: string;
  bookedByStudentId: string | null;
  meetingUrl: string | null;
}

const slotSeeds: SlotSeed[] = [
  { id: "slot-1", inDays: 1, hour: 14, officerName: "Marcia Delgado", bookedByStudentId: null, meetingUrl: null },
  { id: "slot-2", inDays: 1, hour: 16, officerName: "Marcia Delgado", bookedByStudentId: null, meetingUrl: null },
  {
    id: "slot-3",
    inDays: 2,
    hour: 15,
    officerName: "Wes Trumbull",
    bookedByStudentId: "stu-nina",
    meetingUrl: "https://meet.example.org/sekwp-nina",
  },
  { id: "slot-4", inDays: 3, hour: 14, officerName: "Wes Trumbull", bookedByStudentId: null, meetingUrl: null },
  { id: "slot-5", inDays: 3, hour: 15, officerName: "Marcia Delgado", bookedByStudentId: null, meetingUrl: null },
  { id: "slot-6", inDays: 7, hour: 14, officerName: "Wes Trumbull", bookedByStudentId: null, meetingUrl: null },
];

/**
 * Board availability, computed against real time on every call rather than
 * against the module-load anchor.
 *
 * Slots are the only forward-dated fixtures, and a demo that offers to book an
 * interview for a date that has already passed undermines the exact screen it
 * exists to show. Everything else stays anchored so the numbers hold still.
 */
/**
 * Bookings made during the session.
 *
 * Slots are regenerated per call so their times stay in the future, which
 * means a booking cannot live on the generated object — it would be discarded
 * on the next render. Overrides are keyed by slot id and applied on the way
 * out.
 */
export const slotOverrides = new Map<string, InterviewSlot>();

/**
 * Slots the board published during this session.
 *
 * Held separately from `slotSeeds` because the two answer to different clocks.
 * A seeded slot is a fixture whose time is regenerated relative to now, so the
 * demonstration never opens on a page of appointments that have already
 * happened. A published slot is a real appointment at the time somebody chose,
 * and moving it forward every render would be the opposite of what they asked
 * for.
 */
export const publishedSlots: InterviewSlot[] = [];

export function interviewSlotsAt(now: Date = new Date()): InterviewSlot[] {
  const seeded = slotSeeds.map((s) => {
    const startsAt = new Date(now.getTime() + s.inDays * 86_400_000);
    startsAt.setUTCHours(s.hour, 0, 0, 0);
    const base: InterviewSlot = {
      id: s.id,
      marketId: "mkt-pittsburg",
      boardId: "org-sekwp",
      startsAt: startsAt.toISOString(),
      durationMinutes: 30,
      officerName: s.officerName,
      bookedByStudentId: s.bookedByStudentId,
      bookedAt: s.bookedByStudentId ? startsAt.toISOString() : null,
      meetingUrl: s.meetingUrl,
      version: 1,
    };
    const override = slotOverrides.get(s.id);
    // The override carries the booking; the time always comes from the clock.
    return override ? { ...override, startsAt: base.startsAt } : base;
  });

  // Published slots take a booking from the same override map, and keep their
  // own time — that is the whole difference between the two lists.
  const published = publishedSlots.map(
    (slot) => slotOverrides.get(slot.id) ?? slot,
  );

  return [...seeded, ...published];
}

// ---------------------------------------------------------------------------
// Credit awards
// ---------------------------------------------------------------------------

export const creditAwards: CreditAward[] = [
  {
    id: "credit-1",
    marketId: "mkt-pittsburg",
    studentId: "stu-jordan",
    collegeId: "org-verdigris",
    applicationIds: ["app-19"],
    creditHours: 3,
    totalWorkHours: 268,
    carriedHours: 0,
    status: "granted",
    courseMapping: "MKT 490 — Internship in Marketing",
    grantedOn: daysAgo(26),
  },
  {
    id: "credit-3",
    marketId: "mkt-pittsburg",
    studentId: "stu-derek",
    collegeId: "org-verdigris",
    applicationIds: ["app-26"],
    creditHours: 3,
    totalWorkHours: 198,
    carriedHours: 0,
    status: "granted",
    courseMapping: "ACCT 480 — Internship in Accounting",
    grantedOn: daysAgo(44),
  },
  {
    id: "credit-2",
    marketId: "mkt-pittsburg",
    studentId: "stu-priya",
    collegeId: "org-verdigris",
    applicationIds: ["app-20"],
    creditHours: 3,
    totalWorkHours: 205,
    carriedHours: 0,
    status: "granted",
    courseMapping: "MET 480 — Industrial Internship",
    grantedOn: daysAgo(31),
  },
];

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Every learner but one, and that omission is the point.
 *
 * `stu-jordan` has no education-record consent on file, so an employer looking
 * at their completed placement sees an abbreviated name and no way to contact
 * them — the gate working, on data the demo actually ships with. A fixture set
 * where every consent is present would demonstrate a control nobody has ever
 * seen refuse anything, which is the same argument that kept the seeded
 * college's colliding brand colours and left the follow-up queue half-worked.
 *
 * All of them are granted by the learner rather than a parent. That is correct
 * for this seed — every student here is enrolled at the college, and FERPA
 * rights transfer on postsecondary enrolment at any age — and it is exactly the
 * assumption that stops holding when a dual-credit high schooler arrives with
 * records their school holds. The grantor is a recorded field for that reason.
 */
export const consents: ConsentRecord[] = students
  .filter((student) => student.id !== "stu-jordan")
  .flatMap((student, index) => {
    const base = {
      marketId: student.marketId,
      studentId: student.id,
      // The college the learner attends: the institution whose records these
      // are, which is what a consent is attached to.
      sourceOrgId: student.collegeId,
      grantedBy: "learner" as const,
      grantedOn: daysAgo(200 - index),
      expiresOn: null,
      status: "granted" as const,
      recordedByUserId: "u-ellen",
      version: 1,
    };
    return [
      {
        ...base,
        id: `consent-e${index + 1}`,
        scope: "education_record" as const,
        note: "Standard release signed at programme intake.",
      },
      {
        ...base,
        id: `consent-w${index + 1}`,
        scope: "workforce_data" as const,
        note: "Agreed to a workforce board eligibility determination.",
      },
    ];
  });

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * Five follow-ups over eight finished experiences, which is the point.
 *
 * The queue ships with work still in it, on the same argument that kept the
 * seeded college's colliding green and gold: a fixture set where every
 * placement has already been measured would demonstrate a follow-up process
 * nobody has ever had to run. What a college actually opens is a list of
 * learners it has not got round to.
 *
 * The results are mixed on purpose too. Jordan took a job in Kansas City, which
 * is the outcome this venture exists to reduce and exactly the one a demo would
 * be tempted to leave out — a measure that only ever reports good news is not a
 * measure. He also carries two observations three weeks apart, so the reporting
 * rule that counts a learner once and takes the most recent has something to
 * be right about.
 */
export const outcomes: Outcome[] = [
  {
    id: "out-1",
    marketId: "mkt-pittsburg",
    studentId: "stu-derek",
    applicationId: "app-26",
    kind: "employed",
    // The host took him on, so this is regional by construction — the host is
    // an employer in this market — and the county is recorded anyway, because
    // the report rolls up by county and "derivable" is not the same as "there".
    employedByHost: true,
    employmentCounty: "Crawford",
    employmentState: "KS",
    assertedInRegion: null,
    observedOn: daysAgo(21),
    recordedOn: daysAgo(20),
    recordedByUserId: "u-ellen",
    source: "college",
    detail: "Apex Controls kept him on as a junior controls technician.",
  },
  {
    id: "out-2",
    marketId: "mkt-pittsburg",
    studentId: "stu-priya",
    applicationId: "app-20",
    kind: "employed",
    employedByHost: false,
    employmentCounty: "Crawford",
    employmentState: "KS",
    assertedInRegion: null,
    observedOn: daysAgo(16),
    recordedOn: daysAgo(15),
    recordedByUserId: "u-ellen",
    source: "college",
    detail: "Application analyst at a hospital in Crawford County.",
  },
  {
    // The first of two about Jordan. Recorded when the honest answer was that
    // he had not landed anywhere — which is a result, not a blank row.
    id: "out-3",
    marketId: "mkt-pittsburg",
    studentId: "stu-jordan",
    applicationId: "app-19",
    kind: "still_seeking",
    employedByHost: false,
    employmentCounty: null,
    employmentState: null,
    assertedInRegion: null,
    observedOn: daysAgo(24),
    recordedOn: daysAgo(24),
    recordedByUserId: "u-ellen",
    source: "college",
  },
  {
    id: "out-4",
    marketId: "mkt-pittsburg",
    studentId: "stu-jordan",
    applicationId: "app-19",
    kind: "employed",
    employedByHost: false,
    // Wyandotte is in Kansas and is not one of this market's counties, which is
    // the case that matters: leaving is not about crossing a state line, and a
    // rule that only checked the state would score this as staying.
    employmentCounty: "Wyandotte",
    employmentState: "KS",
    assertedInRegion: null,
    observedOn: daysAgo(4),
    recordedOn: daysAgo(3),
    recordedByUserId: "u-ellen",
    source: "college",
    detail: "Moved to Kansas City for an agency role.",
  },
  {
    id: "out-5",
    marketId: "mkt-pittsburg",
    studentId: "stu-hana",
    applicationId: "app-17",
    kind: "continued_education",
    employedByHost: false,
    employmentCounty: null,
    employmentState: null,
    assertedInRegion: null,
    observedOn: daysAgo(9),
    recordedOn: daysAgo(8),
    recordedByUserId: "u-ellen",
    source: "college",
    detail: "Enrolled in the bachelor's completion programme.",
  },
  {
    id: "out-6",
    marketId: "mkt-pittsburg",
    studentId: "stu-omar",
    applicationId: "app-24",
    kind: "employed",
    employedByHost: false,
    // The half-answer, which is the commonest thing a follow-up call actually
    // produces: they are working, and the officer did not get as far as where.
    // Seeded deliberately so the administrator's console renders the
    // place-unknown figure on a fresh checkout. A fixture set where every
    // employment has a tidy county would leave the one number that exists to
    // stop a gap being read as a departure showing zero forever, and nobody
    // would ever see the copy that explains it.
    employmentCounty: null,
    employmentState: null,
    assertedInRegion: null,
    observedOn: daysAgo(6),
    recordedOn: daysAgo(5),
    recordedByUserId: "u-ellen",
    source: "college",
    detail: "Working full time. Did not say where — asking again next call.",
  },
];

// ---------------------------------------------------------------------------
// What the hosts did — the one fact only the employer knows
// ---------------------------------------------------------------------------

/**
 * Three answered and the rest outstanding, which is what a real programme looks
 * like a month after a cohort ends.
 *
 * Each of the three answers is a different one, because a fixture set where
 * every employer hired is not a fixture set that tests a conversion figure. And
 * they are deliberately not aligned with "good" and "bad": Apex made Priya no
 * offer and she is working in Crawford County anyway, which is the case that
 * stops anybody reading "no offer" as a failed placement.
 *
 * One is firsthand and two were chased. Neither Cherokee Steel nor the grain
 * co-op has anybody with an account here, so the administrator rang them and
 * wrote down what they said — `source` is what keeps that distinguishable from
 * an employer who replied on its own, and a report that could not tell them
 * apart could not tell a working process from a hand-worked one.
 *
 * What is missing matters as much. Several finished placements have no row at
 * all, which is the administrator's queue on a fresh checkout and the reason a
 * conversion rate is computed over the three that answered rather than over
 * everything that ended. **One of those is the demo employer's own**, left
 * deliberately: an employer who opens this portal has a placement waiting on
 * them, because a feature that only ever renders an empty queue on a fresh
 * checkout is a feature nobody sees.
 */
export const hostOffers: HostOffer[] = [
  {
    id: "hoff-1",
    marketId: "mkt-pittsburg",
    applicationId: "app-26",
    businessId: "org-apex",
    studentId: "stu-derek",
    answer: "accepted",
    recordedByUserId: "u-dana",
    recordedOn: daysAgo(22),
    source: "business",
  },
  {
    // The middle answer, and the only one nobody else could have given. Jordan
    // had a local offer in hand and took a job in Kansas City instead — which
    // `out-4` records the other half of. An area losing people who were offered
    // work has a different problem from one with no work to offer.
    id: "hoff-2",
    marketId: "mkt-pittsburg",
    applicationId: "app-19",
    businessId: "org-cherokee",
    studentId: "stu-jordan",
    answer: "declined",
    recordedByUserId: "u-admin",
    recordedOn: daysAgo(6),
    source: "admin",
    note: "Offered him a maintenance tech role at the start of June. He had already taken something in Kansas City.",
  },
  {
    id: "hoff-3",
    marketId: "mkt-pittsburg",
    applicationId: "app-21",
    businessId: "org-heartland",
    studentId: "stu-luis",
    answer: "none",
    recordedByUserId: "u-admin",
    recordedOn: daysAgo(11),
    source: "admin",
    note: "Seasonal role, and they do not carry it through the winter. Would host again in the spring.",
  },
];

// ---------------------------------------------------------------------------
// Commitments — the ledger against those funds
// ---------------------------------------------------------------------------

/**
 * Derived from the applications rather than written out beside them.
 *
 * Every funded placement in the fixtures already carries
 * `fundingAuthorizedHours` and `fundingAuthorizedRate`, and those two numbers
 * ARE the commitment. Hand-writing a second list of the same figures would
 * create exactly the drift this change exists to remove — a ledger that
 * disagrees with the placements it is supposed to describe — and the first
 * fixture edited would break the invariant silently.
 *
 * The status each one lands in is the honest reading of what happened to the
 * money, and it is not the same as the old "is the application terminal" test:
 *
 *   disbursed   the placement ran and finished, so the money was spent
 *   released    it ended before anyone started, so the money goes back
 *   authorized  it is live, and the money is promised but not yet paid
 *
 * That third case is why a released row is kept rather than deleted. "What did
 * we commit and not spend" is a question a board asks at the end of a program
 * year, and a missing row cannot answer it.
 */
function commitmentStatusFor(application: Application): FundingCommitment["status"] {
  if (hasExited(application)) return "disbursed";
  if (isTerminal(application.status)) return "released";
  return "authorized";
}

const wageCommitments: FundingCommitment[] = applications
  .filter((a) => (a.fundingAuthorizedHours ?? 0) > 0 && (a.fundingAuthorizedRate ?? 0) > 0)
  .map((application, index) => ({
    id: `commit-w${index + 1}`,
    marketId: application.marketId,
    // Every funded placement in the fixtures is in the live market, and the
    // unique index on the schema guarantees that market has exactly one open
    // wage fund — so there is no ambiguity about which one to draw on.
    fundingSourceId: "fund-sek-wage",
    studentId: application.studentId,
    applicationId: application.id,
    amount: (application.fundingAuthorizedHours ?? 0) * (application.fundingAuthorizedRate ?? 0),
    hours: application.fundingAuthorizedHours,
    ratePerHour: application.fundingAuthorizedRate,
    status: commitmentStatusFor(application),
    authorizedOn: application.submittedOn,
    authorizedByUserId: "u-marcia",
    version: 1,
  }));

/**
 * And the draws that are not wage subsidy, which are the point of the change.
 *
 * Three learners whose credit cost or transport is being covered by somebody
 * other than the board. Deliberately a small number against a small fund: the
 * transport pot is $6,000 and two grants have already taken a fifth of it,
 * because a funding screen that never shows a fund under pressure has not been
 * tested against the situation an operator actually manages.
 */
const assistanceCommitments: FundingCommitment[] = [
  {
    id: "commit-a1",
    marketId: "mkt-pittsburg",
    fundingSourceId: "fund-ccln-credit",
    studentId: "stu-omar",
    applicationId: "app-27",
    amount: 1_050,
    status: "authorized",
    authorizedOn: daysAgo(24),
    authorizedByUserId: "u-admin",
    note: "Three credit hours at the in-state rate; he could not take the placement otherwise.",
    version: 1,
  },
  {
    id: "commit-a2",
    marketId: "mkt-pittsburg",
    fundingSourceId: "fund-verdigris-waiver",
    studentId: "stu-hana",
    applicationId: "app-17",
    amount: 700,
    status: "disbursed",
    authorizedOn: daysAgo(60),
    authorizedByUserId: "u-ellen",
    note: "Departmental waiver against the micro-internship credit.",
    version: 1,
  },
  {
    id: "commit-a3",
    marketId: "mkt-pittsburg",
    fundingSourceId: "fund-ccln-transport",
    studentId: "stu-luis",
    applicationId: "app-21",
    amount: 1_200,
    status: "disbursed",
    authorizedOn: daysAgo(120),
    authorizedByUserId: "u-admin",
    note: "Fuel for a 38-mile commute across the county line, one semester.",
    version: 1,
  },
];

export const fundingCommitments: FundingCommitment[] = [
  ...wageCommitments,
  ...assistanceCommitments,
];

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditEvents: AuditEvent[] = [
  {
    id: "evt-1",
    marketId: "mkt-pittsburg",
    at: daysAgo(34),
    actorUserId: "u-dana",
    actorRole: "business",
    entityType: "application",
    entityId: "app-1",
    from: "funding_authorized",
    to: "placement_active",
    viaOverride: false,
  },
  {
    id: "evt-2",
    marketId: "mkt-pittsburg",
    at: daysAgo(38),
    actorUserId: "u-marcia",
    actorRole: "board",
    entityType: "student",
    entityId: "stu-alex",
    from: "interview_completed",
    to: "eligible",
    viaOverride: false,
  },
  {
    id: "evt-3",
    marketId: "mkt-pittsburg",
    at: daysAgo(30),
    actorUserId: "u-marcia",
    actorRole: "board",
    entityType: "student",
    entityId: "stu-tasha",
    from: "interview_completed",
    to: "not_eligible",
    reason: "Does not meet WIOA participant eligibility criteria for this program year",
    viaOverride: false,
  },
  {
    id: "evt-4",
    marketId: "mkt-pittsburg",
    at: daysAgo(26),
    actorUserId: "u-ellen",
    actorRole: "college",
    entityType: "credit",
    entityId: "credit-1",
    from: "pending",
    to: "granted",
    viaOverride: false,
  },
  {
    id: "evt-5",
    marketId: "mkt-pittsburg",
    at: daysAgo(7),
    actorUserId: "u-admin",
    actorRole: "admin",
    entityType: "application",
    entityId: "app-12",
    from: "cleared",
    to: "unsubsidized",
    reason:
      "Board allocation exhausted for this quarter; business agreed to proceed at full cost",
    viaOverride: false,
  },
];
