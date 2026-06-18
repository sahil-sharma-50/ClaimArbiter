/*
  THE canonical flow. Every narrative view on the landing page is a zoom level
  into this one sequence, so they must all read off this file:

    • Hero TransmissionBand  → the live cross-org core, steps 04→05
    • "How it works"         → the full seven-step story
    • ArchitectureDiagram    → the spatial map; its handshake animates step 04

  Change the story here once; all three views stay in sync.
*/

export type FlowOrg = "Insurance Provider" | "Specialist Group" | "Boundary";

export type FlowStep = {
  n: number;
  title: string;
  body: string;
  org: FlowOrg;
  cross?: boolean;
};

export const FLOW: FlowStep[] = [
  {
    n: 1,
    title: "Intake & coverage",
    body: "The claim arrives as documents and photos. Agents extract structured facts and confirm the policy is in force before anything else runs.",
    org: "Insurance Provider",
  },
  {
    n: 2,
    title: "Classify the domain",
    body: "Intake reads the narrative and auto-classifies the claim — property, medical, or legal. There is no category form; the words decide.",
    org: "Insurance Provider",
  },
  {
    n: 3,
    title: "Route to the specialist",
    body: "The Case Coordinator always recruits the matching domain specialist. No score gate — the right expert is brought in for every classified claim.",
    org: "Insurance Provider",
  },
  {
    n: 4,
    title: "Discover & recruit",
    body: "The coordinator looks up the vetted specialist in Band, requests consent, and brings the matched reviewer into the live claim room.",
    org: "Boundary",
    cross: true,
  },
  {
    n: 5,
    title: "Specialist adjudicates",
    body: "The recruited specialist reviews the evidence on their own stack, decides approve or deny against their policy, and writes the rationale.",
    org: "Specialist Group",
  },
  {
    n: 6,
    title: "Relay the recommendation",
    body: "The Case Coordinator relays the specialist's approve-or-deny call and written explanation back to the home org, verbatim.",
    org: "Insurance Provider",
  },
  {
    n: 7,
    title: "Human sign-off",
    body: "A Human Reviewer reads the recommendation and audit trail, then signs the final decision back into Band.",
    org: "Insurance Provider",
  },
];

/*
  Steps 04→05 are the cross-org core: the hero band zooms into this round trip
  (request out, verdict back). Each beat carries the master step number it lives
  in, so the hero's vocabulary matches the seven-step list exactly.
*/
export const HANDSHAKE = [
  { code: "REQ", step: 4, text: "Insurance Provider opens a channel across the org boundary." },
  { code: "ACK", step: 4, text: "The specialist's org grants consent. The trust boundary opens." },
  { code: "JOIN", step: 4, text: "The matched domain specialist joins the live claim room." },
  { code: "RTN", step: 5, text: "An approve-or-deny verdict, with its rationale, transmits back to the Case Coordinator." },
] as const;
