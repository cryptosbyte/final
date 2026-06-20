// The only user allowed to see and use the email (contact@zakir.today) feature.
export const OWNER_USER_ID = "github:74561974";

export function isOwner(userId: string | null | undefined): boolean {
  return userId === OWNER_USER_ID;
}
