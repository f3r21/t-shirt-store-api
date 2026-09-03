# 18. Roles are enforced by a guard today and by CASL tomorrow

Status: superseded by ADR 25
Date: 2026-08-28

`RolesGuard` and `@Roles('manager')` were the seam CASL replaced on 2026-09-01. The code has
neither. The 403 body stays a bare `ForbiddenException`, so the problem mapper takes the title
from the table, as ADR 11 states.
