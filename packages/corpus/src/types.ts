export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "TIMEOUT"
  | "RESOURCE_EXHAUSTED"
  | "POLICY_BLOCKED"
  | "SYSTEM_ERROR"
  | "CANCELLED"
  | "REJECTED";

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

export type ExecutionStage =
  | "REPOSITORY"
  | "SANDBOX"
  | "INSTALL"
  | "BUILD"
  | "TEST"
  | "RECEIPT";

export type CertificationLevel =
  | "CANDIDATE"
  | "IMPORTED"
  | "REPRODUCED"
  | "STABLE"
  | "PORTABLE"
  | "GOLD"
  | "QUARANTINED"
  | "RETIRED";

export interface PrvcCase {
  schema_version: "prvc.case/v1";
  case_id: string;
  title: string;
  description?: string;
  suite: string[];
  visibility: "public" | "hidden";
  source: {
    kind: "synthetic" | "imported-unverified" | "swe-polybench-verified" | "bugsjs" | "multi-swe-bench" | "bugswarm";
    upstream_instance_id?: string;
    imported_at?: string;
  };
  licenses: {
    dataset: { expression: string };
    upstream_repository?: { expression: string };
  };
  subject: {
    language: "javascript" | "typescript";
    project_type: "node";
    package_manager: "npm" | "pnpm";
  };
  execution_profile: {
    profile_id: string;
    runtime?: {
      image: string;
      architecture: string;
    };
    limits?: {
      wall_time_seconds: number;
      cpu_time_seconds: number;
      memory_bytes: number;
      pids: number;
    };
    network?: Record<string, unknown>;
    environment?: Record<string, unknown>;
  };
  variants: Record<
    string,
    {
      patches?: string[];
      request: {
        git_ref?: string;
        verification_skill?: {
          name: string;
          version: string;
          digest: string;
        };
      };
    }
  >;
  oracle_ref: string;
  integrity: {
    case_hash_algorithm: "sha256";
    case_hash_canonicalization: "RFC8785";
    sha256?: string;
  };
}

export interface PrvcOracle {
  schema_version: "prvc.oracle/v1";
  case_id: string;
  variants: Record<
    string,
    {
      expected: {
        terminal_status: RunStatus;
        verdict: Verdict;
        reason_code: string;
        stages?: Record<string, { status: string }>;
        tests?: {
          minimum_executed?: number;
          failing_exact?: string[];
          required_passing?: string[];
        };
      };
    }
  >;
  relations?: Array<{
    type: string;
    from?: string;
    to?: string;
    variants?: string[];
  }>;
}

export interface PrvcSuite {
  schema_version: "prvc.suite/v1";
  suite_id: string;
  title: string;
  description?: string;
  cases: string[];
}

export interface PrvcReceiptVector {
  schema_version: "prvc.receipt-vector/v1";
  vector_id: string;
  description: string;
  expected_valid: boolean;
  expected_error?: string;
  receipt: Record<string, unknown>;
}
