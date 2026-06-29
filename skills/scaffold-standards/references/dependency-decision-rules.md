# Dependency Decision Rules

Use this file before installing or replacing dependencies.

## Package Manager

- Package manager:
- Workspace command pattern:
- Lockfile:

## Approved Dependencies By Business Scenario

| Business Scenario | Trigger | Preferred Dependency | Install Command | Integration Location | Verification |
| --- | --- | --- | --- | --- | --- |
| Data fetching/cache |  |  |  |  |  |
| Forms |  |  |  |  |  |
| Validation |  |  |  |  |  |
| Tables/data grids |  |  |  |  |  |
| Charts |  |  |  |  |  |
| Date/time |  |  |  |  |  |
| Auth/permissions |  |  |  |  |  |
| File upload |  |  |  |  |  |
| Rich text |  |  |  |  |  |
| i18n |  |  |  |  |  |
| Logging/analytics |  |  |  |  |  |
| Payments |  |  |  |  |  |

## Avoid List

| Dependency Or Pattern | Reason | Approved Alternative |
| --- | --- | --- |
|  |  |  |

## Decision Procedure

1. Describe the business capability in one sentence.
2. Search the repository for an existing dependency or internal helper.
3. Match the capability to the table above.
4. If no rule exists, prefer existing scaffold patterns and ask for approval before adding a major dependency.
5. Install with the scaffold's package manager only.
6. Add integration code in the documented location.
7. Run the verification command from the matching row.
