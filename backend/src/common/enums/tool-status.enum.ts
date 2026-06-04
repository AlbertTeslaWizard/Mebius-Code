export enum ToolCallStatus {
  Requested = 'requested',
  PendingApproval = 'pending_approval',
  Approved = 'approved',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Rejected = 'rejected',
}

export enum ApprovalStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum FilePatchStatus {
  Proposed = 'proposed',
  Applied = 'applied',
  Conflicted = 'conflicted',
  Rejected = 'rejected',
  Reverted = 'reverted',
}

export enum CommandRunStatus {
  Pending = 'pending',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Blocked = 'blocked',
}
