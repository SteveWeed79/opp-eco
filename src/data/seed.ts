/**
 * Seeded fixtures for the demo.
 *
 * Deliberately covers every state in the machine, including the ones that make
 * the administrator's job visible: applications stalled in the pause, a
 * business waiting on drafting help, a student the board found ineligible, and
 * a market whose subsidy allocation is running down.
 *
 * Institution and workforce board names are real Kansas entities, since this is
 * a pitch aimed at them. Businesses are fictional.
 */

import type {
  Application,
  ApplicationStatus,
  AuditEvent,
  CreditAward,
  InterviewSlot,
  Market,
  Organization,
  Posting,
  Student,
  Track,
  User,
} from "@/domain/types";
import { scoreMatch } from "@/domain/matching";

/** Fixed clock so the demo is deterministic. */
export const DEMO_NOW = new Date("2026-08-08T15:00:00Z");

function daysAgo(n: number): string {
  return new Date(DEMO_NOW.getTime() - n * 86_400_000).toISOString();
}

function daysAhead(n: number, hour = 15): string {
  const d = new Date(DEMO_NOW.getTime() + n * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
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
    stage: "live",
    boardId: "org-sek-works",
    collegeIds: ["org-psu"],
    launchedOn: daysAgo(214),
    subsidyBudget: 240_000,
    subsidyRatePerHour: 20,
    programYear: "PY2026",
  },
  {
    id: "mkt-emporia",
    name: "Flint Hills",
    city: "Emporia",
    counties: ["Lyon", "Chase", "Coffey"],
    stage: "configuring",
    boardId: "org-flinthills-works",
    collegeIds: ["org-esu"],
    launchedOn: null,
    subsidyBudget: 120_000,
    subsidyRatePerHour: 20,
    programYear: "PY2026",
  },
  {
    id: "mkt-gardencity",
    name: "Western Kansas",
    city: "Garden City",
    counties: ["Finney", "Ford", "Seward"],
    stage: "board_committed",
    boardId: "org-westks-works",
    collegeIds: [],
    launchedOn: null,
    subsidyBudget: 90_000,
    subsidyRatePerHour: 20,
    programYear: "PY2026",
  },
  {
    id: "mkt-salina",
    name: "North Central Kansas",
    city: "Salina",
    counties: ["Saline", "Ottawa", "Dickinson"],
    stage: "board_engaged",
    boardId: null,
    collegeIds: [],
    launchedOn: null,
    subsidyBudget: 0,
    subsidyRatePerHour: 20,
    programYear: "PY2026",
  },
  {
    id: "mkt-hays",
    name: "Smoky Hill",
    city: "Hays",
    counties: ["Ellis", "Russell", "Trego"],
    stage: "prospecting",
    boardId: null,
    collegeIds: [],
    launchedOn: null,
    subsidyBudget: 0,
    subsidyRatePerHour: 20,
    programYear: "PY2026",
  },
];

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organizations: Organization[] = [
  // --- Southeast Kansas, live ---
  {
    id: "org-sek-works",
    marketId: "mkt-pittsburg",
    kind: "board",
    name: "Southeast KANSASWORKS",
    county: "Crawford",
    status: "active",
    contactName: "Marcia Delgado",
    contactEmail: "mdelgado@sekworks.example.gov",
    appliedOn: daysAgo(260),
  },
  {
    id: "org-psu",
    marketId: "mkt-pittsburg",
    kind: "college",
    name: "Pittsburg State University",
    county: "Crawford",
    status: "active",
    contactName: "Dr. Ellen Vance",
    contactEmail: "evance@pittstate.example.edu",
    appliedOn: daysAgo(240),
    hoursPerCredit: 45,
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
    id: "org-cityofpittsburg",
    marketId: "mkt-pittsburg",
    kind: "business",
    name: "City of Pittsburg",
    county: "Crawford",
    status: "active",
    contactName: "Janet Whitfield",
    contactEmail: "jwhitfield@pittsburgks.example.gov",
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
    id: "org-flinthills-works",
    marketId: "mkt-emporia",
    kind: "board",
    name: "Flint Hills Workforce Center",
    county: "Lyon",
    status: "active",
    contactName: "Alan Cheng",
    contactEmail: "acheng@fhworks.example.gov",
    appliedOn: daysAgo(64),
  },
  {
    id: "org-esu",
    marketId: "mkt-emporia",
    kind: "college",
    name: "Emporia State University",
    county: "Lyon",
    status: "approved",
    contactName: "Dr. Renee Boyd",
    contactEmail: "rboyd@emporia.example.edu",
    appliedOn: daysAgo(31),
    hoursPerCredit: 40,
  },

  // --- Western Kansas, board committed ---
  {
    id: "org-westks-works",
    marketId: "mkt-gardencity",
    kind: "board",
    name: "Western Kansas Workforce Alliance",
    county: "Finney",
    status: "active",
    contactName: "Sofia Marquez",
    contactEmail: "smarquez@wkworks.example.gov",
    appliedOn: daysAgo(45),
  },
];

// ---------------------------------------------------------------------------
// Users — fake sign-on picks one of these
// ---------------------------------------------------------------------------

export const users: User[] = [
  { id: "u-admin", name: "Steve Weed", email: "admin@opportunityecosystem.example" },
  { id: "u-omar", name: "Omar Haddad", email: "haddado@gus.pittstate.example.edu" },
  { id: "u-alex", name: "Alex Miller", email: "amiller@gus.pittstate.example.edu" },
  { id: "u-dana", name: "Dana Reyes", email: "dreyes@apexrobotics.example.com" },
  { id: "u-ellen", name: "Dr. Ellen Vance", email: "evance@pittstate.example.edu" },
  { id: "u-marcia", name: "Marcia Delgado", email: "mdelgado@sekworks.example.gov" },
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

export const students: Student[] = studentSeeds.map((s) => ({
  id: s.id,
  marketId: "mkt-pittsburg",
  userId: s.id === "stu-alex" ? "u-alex" : `u-${s.id}`,
  collegeId: "org-psu",
  name: s.name,
  email: `${s.name.split(" ")[0].toLowerCase()}${s.name.split(" ")[1].toLowerCase()[0]}@gus.pittstate.example.edu`,
  programOfStudy: s.program,
  classStanding: s.standing,
  expectedGraduation: s.grad,
  skills: s.skills,
  interests: s.interests,
  availableHoursPerWeek: s.hours,
  status: s.status,
  eligibility: s.eligibility,
  eligibilityDeterminedOn: s.eligibilityDaysAgo ? daysAgo(s.eligibilityDaysAgo) : null,
  eligibilityExpiresOn: s.eligibilityDaysAgo ? daysAhead(365 - s.eligibilityDaysAgo) : null,
  verifiedOn: s.status === "verified" ? daysAgo(60) : null,
}));

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
    id: "post-city-webdev",
    marketId: "mkt-pittsburg",
    businessId: "org-cityofpittsburg",
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
    id: "post-city-finance",
    marketId: "mkt-pittsburg",
    businessId: "org-cityofpittsburg",
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
// Applications — spread across every state, with realistic dwell times
// ---------------------------------------------------------------------------

interface AppSeed {
  id: string;
  postingId: string;
  studentId: string;
  status: ApplicationStatus;
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
    postingId: "post-city-webdev",
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
  {
    id: "app-9",
    postingId: "post-city-webdev",
    studentId: "stu-tasha",
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
  {
    id: "app-11",
    postingId: "post-apex-swe",
    studentId: "stu-omar",
    status: "shortlisted",
    submittedDaysAgo: 9,
    statusSinceDaysAgo: 2,
  },

  // --- Unsubsidized path: board declined, placement went ahead anyway ---
  {
    id: "app-12",
    postingId: "post-city-webdev",
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
    postingId: "post-city-finance",
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
    postingId: "post-city-finance",
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
    postingId: "post-city-finance",
    studentId: "stu-omar",
    status: "placement_completed",
    submittedDaysAgo: 33,
    statusSinceDaysAgo: 14,
    deliverableSubmitted: true,
    deliverableAccepted: true,
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
    submittedOn: daysAgo(a.submittedDaysAgo),
    statusSince: daysAgo(a.statusSinceDaysAgo),
    matchScore: scoreMatch(student, posting, "Crawford"),
    interviewSlotId: a.interviewSlotId,
    fundingAuthorizedHours: a.fundingHours,
    fundingAuthorizedRate: a.fundingHours ? 20 : undefined,
    hoursLogged: a.hoursLogged,
    hoursApproved: a.hoursApproved,
    deliverableSubmitted: a.deliverableSubmitted,
    deliverableAccepted: a.deliverableAccepted,
    creditAwardId: a.creditAwardId,
  };
});

// ---------------------------------------------------------------------------
// Board interview slots
// ---------------------------------------------------------------------------

export const interviewSlots: InterviewSlot[] = [
  {
    id: "slot-1",
    marketId: "mkt-pittsburg",
    boardId: "org-sek-works",
    startsAt: daysAhead(1, 14),
    durationMinutes: 30,
    officerName: "Marcia Delgado",
    bookedByStudentId: null,
    meetingUrl: null,
  },
  {
    id: "slot-2",
    marketId: "mkt-pittsburg",
    boardId: "org-sek-works",
    startsAt: daysAhead(1, 16),
    durationMinutes: 30,
    officerName: "Marcia Delgado",
    bookedByStudentId: null,
    meetingUrl: null,
  },
  {
    id: "slot-3",
    marketId: "mkt-pittsburg",
    boardId: "org-sek-works",
    startsAt: daysAhead(2, 15),
    durationMinutes: 30,
    officerName: "Wes Trumbull",
    bookedByStudentId: "stu-nina",
    meetingUrl: "https://meet.example.gov/sek-nina",
  },
  {
    id: "slot-4",
    marketId: "mkt-pittsburg",
    boardId: "org-sek-works",
    startsAt: daysAhead(3, 14),
    durationMinutes: 30,
    officerName: "Wes Trumbull",
    bookedByStudentId: null,
    meetingUrl: null,
  },
  {
    id: "slot-5",
    marketId: "mkt-pittsburg",
    boardId: "org-sek-works",
    startsAt: daysAhead(3, 15),
    durationMinutes: 30,
    officerName: "Marcia Delgado",
    bookedByStudentId: null,
    meetingUrl: null,
  },
  {
    id: "slot-6",
    marketId: "mkt-pittsburg",
    boardId: "org-sek-works",
    startsAt: daysAhead(7, 14),
    durationMinutes: 30,
    officerName: "Wes Trumbull",
    bookedByStudentId: null,
    meetingUrl: null,
  },
];

// ---------------------------------------------------------------------------
// Credit awards
// ---------------------------------------------------------------------------

export const creditAwards: CreditAward[] = [
  {
    id: "credit-1",
    marketId: "mkt-pittsburg",
    studentId: "stu-jordan",
    collegeId: "org-psu",
    applicationIds: ["app-19"],
    creditHours: 3,
    totalWorkHours: 268,
    status: "granted",
    courseMapping: "MKT 490 — Internship in Marketing",
    grantedOn: daysAgo(26),
  },
  {
    id: "credit-2",
    marketId: "mkt-pittsburg",
    studentId: "stu-priya",
    collegeId: "org-psu",
    applicationIds: ["app-20"],
    creditHours: 3,
    totalWorkHours: 205,
    status: "granted",
    courseMapping: "MET 480 — Industrial Internship",
    grantedOn: daysAgo(31),
  },
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
  },
];
