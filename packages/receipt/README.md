# Receipts

Receipts are canonical RFC 8785 (JCS) payloads hashed with SHA-256 and signed
with a dedicated Ed25519 key. The payment wallet key is never read by this
package or API.

The API refuses to start without `PROOF_RUNNER_RECEIPT_PRIVATE_KEY`. Keep the
key in a secret manager, not in this repository. Publish its corresponding
public key at `GET /api/receipt-keys/:keyId`; clients verify a receipt at
`POST /api/receipts/verify` or locally with this package.

## Rotation

1. Generate a new dedicated Ed25519 key and assign a new immutable key ID.
2. Deploy it as the active key while retaining prior public keys in the
   verifier keyring through `PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS` (a JSON
   array of `{ "keyId", "publicKeyPem" }` objects).
3. Keep old public keys published until every receipt signed with them has
   expired under the product retention policy. Never re-use a key ID.

`signed_receipts` and `normalized_checks` are persisted in SQLite separately
from `raw_logs`; raw-log expiry therefore cannot invalidate an issued receipt.
