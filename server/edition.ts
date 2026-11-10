import product from "../branding/product.json" with { type: "json" };

export interface EditionStatus {
  edition: "oss" | "enterprise";
  customer?: string;
  features: string[];
  expiresAt?: string | null;
  expiresInDays?: number;
  graceEndsAt?: string;
  notice?: string;
}

export function editionStatus(env: NodeJS.ProcessEnv = process.env): EditionStatus {
  const ignored = ["OMB_LICENSE_KEY", "OMB_ENTERPRISE_DIR"].filter(key => env[key] !== undefined);
  return {
    edition: "oss", features: [],
    ...(ignored.length ? { notice: `${ignored.join(", ")} ${ignored.length === 1 ? "has" : "have"} no effect in this distribution.` } : {}),
  };
}

export function editionForMembers(_status: EditionStatus): EditionStatus {
  return { edition: "oss", features: [] };
}

export function editionForSettings(_status: EditionStatus) {
  return { edition: "oss" as const, features: [] as string[] };
}

export function entitled(_feature: string): boolean {
  return false;
}

export function describeEdition(status: EditionStatus): string {
  return `${product.productName} open-source edition${status.notice ? ` (${status.notice})` : ""}`;
}
