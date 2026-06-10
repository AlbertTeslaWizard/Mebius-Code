export enum PlanStatus {
  PlanningGenerating = 'planning_generating',
  PlanReadyPendingApproval = 'plan_ready_pending_approval',
  PlanCustomizing = 'plan_customizing',
  PlanReview = 'plan_review',
  Approved = 'approved',
  Failed = 'failed',
  Cancelled = 'cancelled',
}
