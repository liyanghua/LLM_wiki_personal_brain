export function proposalActionsDisabled(action: "approve" | "reject" | "edit") {
  return action !== "approve";
}
