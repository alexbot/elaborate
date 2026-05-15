# Recycling center locator app

> *"We're building an app to help residents find nearby recycling drop-off points, check what materials each center accepts, and schedule pickups for large items."*

## Summary

A city recycling coordinator wants to consolidate fragmented recycling information into a single app for residents. The session surfaced a structural contradiction at its center: the coordinator calls accurate material data "the foundation" of the entire app, but no one is budgeted to maintain it post-launch. The project ended with that tension unresolved and explicitly flagged for leadership.

## Purpose

The app replaces a fragmented status quo — residents currently juggle phone calls to the city, online searches, and guesswork about what their local center accepts. The advantage is consolidation: > *"people are more likely to recycle if the path is clear."*

Success means behavior change. The coordinator identified three measurements: completion rates (people who open the app and follow through to drop-off or pickup, not just browse), pickup requests scheduled through the app as a proxy for barrier removal, and support load reduction — fewer calls to the city asking "where do I recycle X?" Call volume was singled out as "the easiest to measure and most honest, since the city tracks it anyway."

The coordinator added a fourth metric during confirmation: material rejection rates — how often residents show up with items a center won't accept despite checking the app. If that number stays high, "either the app's material lists are wrong or out of sync with what centers actually accept. That's a data quality problem we'd need to fix."

## Goals

1. **Maintain accurate material acceptance data across all centers** — The foundational goal, but constrained: not achievable at launch without dedicated staffing. Automated sync and manager self-service help, but the coordinator admitted "I can't monitor all of that solo while doing my other job."
2. **Reduce friction in the recycling decision path** — Make the path from "I have something to recycle" to "I know where to take it" as short as possible.
3. **Enable residents to find centers accepting their specific materials** — Deprioritized from multi-item batch queries to single-item yes/no lookups. "If someone checks 'does this center take glass?' and gets a clear yes or no, that's enough. They'll figure out multi-item matching themselves if the base data is solid."
4. **Make the app accessible to elderly residents** — Direct-dial button to call the center is essential, not buried in help docs. The deeper issue is trust: "older residents often don't trust apps they don't understand. If they can see a center's name, address, and hours clearly — and hit a button to call — that removes the fear."

## Stakeholders

- **Residents seeking to recycle** (primary) — Need to complete the find-verify-act cycle in under two minutes. GPS unreliability in dense urban areas means the app must show multiple options, not claim one is closest. Some won't trust app data and need a phone number to call ahead.
- **City recycling coordinator** (primary, respondent) — Manages data accuracy across 12+ municipal APIs, manually chases centers for updates, reports to leadership on app effectiveness. Currently doing this alongside regular job responsibilities with no dedicated budget for the role.
- **Recycling center staff** (secondary) — Don't interact with residents through the app, but field repetitive "do you take X?" calls. Center managers need a way to update accepted materials when policy changes instead of waiting for quarterly pushes.
- **Local environmental nonprofits** (secondary) — Partners for outreach and distribution. The coordinator hasn't thought deeply about their needs yet: "keep them on the list as partners for outreach, but don't over-design features for them right now."

## Scope

**In scope:**
- Display multiple center options (not just "nearest") to handle GPS limitations in dense areas
- Material acceptance lists per center, checkable before visiting
- Direct phone contact option for residents to verify acceptance with staff
- Center basic info (name, address, hours) displayed clearly for elderly users
- Automated data ingestion and sync from municipal APIs (weekly batch for routine changes)
- Center manager self-service interface to update material lists, with "flag as changed" button for urgent changes (same-day or next-day push)
- Coordinator dashboard to identify stale center data and flag for update
- Simple, accessible navigation design for elderly users
- Pickup request flow: app shows eligibility and a request button; residents provide address, item type, preferred date range; city's truck route system handles scheduling and confirmation
- Shareable link or QR code for nonprofits to promote the app

**Out of scope:**
- Building or operating the city's truck route optimization system — app integrates but does not own scheduling
- Calendar availability or specific date selection for pickups — all managed on the city side
- Over-designed nonprofit features at launch — wait to see what they ask for
- Call volume metrics tracking — deferred; measurement focuses on rejection rates first
- Crowdsourced material validation — "I don't want residents submitting 'this center won't take X even though the app says they do.' That creates noise and liability. Data comes from official sources only."

**Constraints:**
- 12+ municipal APIs with different formats, update schedules, and varying reliability; no single authoritative data source
- 6-month timeline mandated by leadership to demonstrate progress on sustainability goals
- No dedicated staffing budget for post-launch data maintenance; coordinator manages data work alongside regular job
- Coordinator has no capacity to monitor all data work solo

## Uncertainties

**Unresolved tensions:**
- Goal 1 (accurate data) is structurally infeasible under constraint 3 (no staffing budget). The coordinator named three options: budget for a data steward before launch ("the honest path"), launch with incomplete data and prioritize the most-used centers, or delay launch until staffing is resolved. No option was chosen. This is the session's blocking issue.
- The 6-month timeline has no explicit goal committing to it and no success metrics tied to launch readiness — it creates implicit scope pressure without negotiation.

**Assumptions:**
- Data aggregation from fragmented municipal APIs will require ongoing effort due to heterogeneity, unreliability, and format variance
- Technology is tractable; data quality and currency are the constraining factors for success
- Urgent material changes flagged by center managers must propagate to residents same-day or next-day, ahead of the weekly batch sync

**Findings:**
- Post-launch data stewardship — chasing centers for policy changes, validating updates, monitoring drift — requires dedicated staffing, but budget does not exist. The coordinator acknowledged: "I've been saying 'someone needs to own this' without admitting I don't have capacity. That's on me."

**Respondent's closing concern:** The structural contradiction between maintaining accurate data (goal 1) and having no one budgeted to maintain it (constraint 3) must be resolved before building. Either budget for a data steward, or reframe the goal to "establish processes and tooling for centers to maintain their own data" and accept initial imperfection.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 24 |
| Purpose fields | 3/3 |
| Goals | 4 (1 deprioritized) |
| Stakeholders | 4 (1 merged, 1 removed) |
| In-scope items | 10 |
| Out-of-scope items | 5 |
| Constraints | 4 |
| Assumptions | 3 |
| Findings | 1 |
| Agent model | Haiku 4.5 |
