import CredentialManager from "../CredentialManager";

/** Both engine settings use the same profile cards and secret controls. */
export function AIModelSettings() {
  return <CredentialManager kind="editing" />;
}
