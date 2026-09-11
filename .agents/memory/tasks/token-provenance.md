---
name: memory-tasks-token-provenance
description: This repository's entries in the token provenance plan — the plan table itself lives in MCEngine/client-reactjs.
---

# Task: A token that names who minted it — server-expressjs entries

**The plan table is not here.** It lives in `MCEngine/client-reactjs` at
`.agents/memory/tasks/token-provenance.md`, along with the layout defect that shares the plan.

The question asked was whether a token created against an organization still traces back to the
person who created it. Measured, by minting one and looking at what came back:

```
owner_account_id = the org
created_by       = Alice (the user who minted it)
audit entry      = undefined
```

Recorded, and reaching nobody. `publicToken()` omitted the creator, and the `token.created` event
was filed against `subjectType: 'token'` while `GET /orgs/:handle/audit` reads
`subject_type = 'org'` — so it sat in the table, in no trail but the creator's own `/me/audit`.

## Entries

### Task 3 — feat/token-provenance

`publicToken` takes the creator's account and returns `created_by` as `{ id, handle,
display_name }`; the list routes resolve one lookup per **distinct** creator rather than one per
token, since an organization's list is mostly minted by the same one or two admins.
`ApiTokenRecord` and `TOKEN_COLUMNS` gained `created_by`, which the repository had never
selected.

The organization's `token.created` and `token.revoked` events are filed against the organization
now, with the token id in the metadata, so they appear in the trail its admins can actually read.

Three cases, and the audit one was mutated to check it could fail: filing the event back against
the token makes it fail, which is the defect this task was about.

### Task 4 — chore/token-provenance-release

The changelog entry and the state file. `0.0.0` did not move. The panel's task 5 reads
`created_by` and merges after this.
