export type AppRole = "sales" | "renewals" | "admin";

export type OpportunityStage =
  | "lead"
  | "qualified"
  | "proposal"
  | "verbal_commit"
  | "closed_won"
  | "closed_lost";

export type OpportunityKind = "new_business" | "renewal";

export interface UserProfile {
  id: string;
  fullName: string | null;
  role: AppRole;
  isActive: boolean;
}

export interface Account {
  id: string;
  name: string;
  ownerUserId: string | null;
  lifecycleStatus: "prospect" | "customer" | "former_customer";
  archivedAt: string | null;
}

export interface Opportunity {
  id: string;
  accountId: string;
  ownerUserId: string | null;
  kind: OpportunityKind;
  stage: OpportunityStage;
  amount: number;
  expectedCloseDate: string | null;
  contractEndDate: string | null;
}
