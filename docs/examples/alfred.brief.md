# Independent living platform for elderly people

> *"We're building a platform to help elderly people live independently at home. It covers health monitoring, medication management, emergency response, social connectivity, and home automation — all designed for users with varying tech literacy."*

## Summary

A project team is building a platform that lets elderly people stay home instead of moving to assisted living, combining health monitoring, medication management, emergency response, and social connectivity. The session surfaced a recurring tension between safety and autonomy: the system must monitor without feeling like surveillance, remind without infantilizing, and present health data that users with vision loss or cognitive decline can actually understand. The respondent ended with four unresolved revision requests — most critically, that voice recognition for elderly speech patterns may not be achievable within the six-month pilot timeline.

## Purpose

The core advantage is psychological: "people feel safer staying independent because there's a safety net." But the respondent revised this during confirmation — the safety net isn't just for emergencies. "Someone might hesitate to take a walk alone or cook a meal if they're worried about falling or forgetting medication. The system removes that friction, so they actually *do* more on their own instead of waiting for someone to help." The advantage shifted from catching problems to enabling action.

The earlier framing still holds underneath: staying home means keeping independence, community, and familiar surroundings, while giving family peace of mind through "consistent, automated visibility into health metrics, medication adherence, and emergency capability." Early detection — a fall detected immediately, blood pressure trending up — is "the difference between a small intervention at home and a hospital admission."

Measurement: how many weeks or months longer users stay home instead of moving to assisted living, compared to non-users. The respondent flagged confounding variables as a challenge — "we can't always separate our system from other factors — better health habits, a supportive family nearby, access to in-home care" — but endorsed the pattern comparison as the primary indicator. Early detection and reduced family check-ins are leading indicators, not goals in themselves.

## Goals

1. **Extend independent living duration** — enable users to remain safely at home for measurably longer periods through early detection and reduced dependency on family for routine monitoring.
2. **Build user confidence in daily risk-taking** — shift users from anxiety about capability to trust in safety oversight, so they attempt activities they currently avoid (solo walks, meal preparation, errands).
3. **Reduce family caregiver burden and decision fatigue** — shift family check-ins from logistical coordination to genuine relationship time by moving routine monitoring to the system.
4. **Enable safe autonomy in health decisions** — give users health data and context (readings, targets, multi-day trends) in accessible formats so they recognize patterns and make informed decisions without family interpretation. The respondent drew a sharp line: "The system should *inform* the person, not remind them." And accessibility is integral, not separate: "large text, simple language, maybe audio or visual alerts instead of numbers" — because "without accessibility, the autonomy part breaks down."

The respondent proposed a fifth goal during validation — **build family trust in system reliability** — arguing that family trust enables user confidence. This was not applied before the session ended.

## Stakeholders

**Elderly people** (primary) — anxiety about falls and emergencies when alone; dependency on family to interpret health data; medication reminders that feel "infantilizing or surveillance-like." Emergency detection trust is foundational: "if they don't trust the emergency detection, nothing else works."

**Users with varying tech literacy** (primary) — tech comfort ranges from digitally savvy to "barely use a phone." Cannot assume any baseline. Medication reminders must work for those uncomfortable with technology, and social isolation is a real constraint: users "currently depend on family to arrange social contact."

**Family caregivers** (secondary) — want fewer check-ins but won't reduce them until the system proves itself. Alert reliability is the trust gate: "if the system cries wolf, family stops trusting it and goes back to daily calls." The respondent surfaced a less obvious tension: family "often *likes* being needed" and may experience independence as loss of role. Privacy is user-controlled — "the elderly person should decide what gets shared. Privacy matters even within families. That's a feature, not a bug."

**Healthcare providers** (secondary) — need medication adherence patterns and physiological deviations from the patient's baseline (not absolute normal ranges). HIPAA requires patient opt-in and control over data sharing. The system "can flag patterns but cannot recommend clinical adjustments." Medication reminders are "guidance only, not medical advice" — the respondent called this "non-negotiable" for liability.

**Accessibility specialists** (external) — needed but not on the team. "That's a gap we're managing, not a stakeholder we have."

**Professional caregivers and aides** (secondary) — coordinators of daily support who need shift-level data (medication timing, daily activities). Aides report, don't decide: "the aide is a messenger, not a clinician." High turnover means access must be temporary and expire when someone quits.

**Respondent** — project team member, not a stakeholder role. Speaks closest to healthcare providers' constraints: "medication liability, data handling, what clinicians actually need versus what we think they need."

## Scope

**In scope**
- Health monitoring with multi-day trend visualization for pattern recognition
- Medication management with non-intrusive reminders (guidance only, not medical advice)
- Emergency response alerting with high reliability
- Social connectivity: independent video calling, virtual groups, community event reminders
- User-controlled privacy for data sharing with family and providers
- Accessible design for vision loss, hearing loss, motor control issues, cognitive decline
- Data presentation directly to the elderly person, not mediated through family
- Aide access control with temporary, expiring credentials and clear role boundaries
- Aide emergency alert handling: real-time alerts to scheduled/on-call aides; aides respond and report, cannot override user preferences
- Aide medication adherence reporting: aides see gaps, report to family or user, do not administer
- Onboarding/calibration ramp-up period — system runs in parallel with existing routines before family reduces check-ins
- Adaptive notification frequency infrastructure (thresholds deferred to pilot testing)

**Out of scope**
- Clinical recommendations or medication adjustments — liability and role boundary
- Provider-initiated data access — HIPAA requires patient opt-in
- Home automation — respondent reversed an earlier inclusion: "not tied to the core goals. That's a nice-to-have that can come in v2 once the health and safety core is solid"

**Constraints**
- HIPAA compliance and explicit patient consent for data sharing — legal, non-negotiable
- Must support multiple device types (basic phones, tablets, no digital devices) — not all users have smartphones
- Emergency response must work when internet is down — local fallback required (fall detection, local alert, connection retry, manual override)
- Pilot program in six months — real constraint on feature stability
- Accessibility testing with actual users (vision loss, hearing loss, tremor) — non-negotiable, not checklist compliance
- Voice interaction must handle elderly speech patterns (slower, softer, accented) — standard voice recognition doesn't do this well

## Uncertainties

**Unresolved tensions**
- The system must inform without infantilizing. Fewer medication notifications feel non-intrusive but increase missed doses. "We have to be smart about *when* and *how* we remind, not whether." Calibration thresholds are deferred to the pilot, but the adaptive infrastructure must be built now.
- Voice interaction is the primary interface for users who can't use touchscreens, but constraint_006 (elderly voice recognition is hard) conflicts with constraint_004 (six-month pilot). The respondent proposed scoping voice as MVP with basic functionality (wake word, simple commands) and improving post-pilot. This tension is unresolved.
- Aide scheduling integration assumes the system knows aide schedules, but basic-phone aides can't participate in real-time scheduling lookups. The respondent suggested pushing alerts to registered aide contacts instead — simpler but less intelligent routing.

**Assumptions**
- Family behavior change (reducing check-ins) is contingent on demonstrated system trustworthiness, not on the system working objectively — may require a calibration or onboarding phase.
- Independence means "relative needs less logistical coordination, enabling more genuine relationship time" — not "relative stops needing help."
- Onboarding ramp-up where the system runs in parallel with existing routines is an adoption precondition.
- System can route alerts only to aides actually present or on-call — assumes scheduling integration exists.

**Findings**
- No accessibility specialists are embedded on the team; managing accessibility without experts is a known risk.
- Notification frequency calibration mechanism is undefined — the tradeoff between alert fatigue and adherence needs per-person adaptive thresholds, but the algorithm doesn't exist yet.
- Voice interaction must be treated as primary, not optional — the connection between accessibility and feature priority is insufficiently emphasized in current artifacts.
- Accessibility testing with actual elderly users is a shipping prerequisite, not a compliance exercise.
- The system's role is visibility and reminder, not enforcement — medication adherence gaps must be surfaced clearly, but the system does not autonomously enforce adherence.
- Aide messaging pattern: factual statements ("you didn't take your 9am medication, do you want to take it now?"), then the person or family decides.
- Alert fatigue is a real risk — the pilot must test whether conservative defaults or tighter thresholds reduce non-adherence without creating notification burden.
- Notification frequency design gap encompasses both frequency and threshold definition; calibration thresholds are undefined.

**Respondent's closing concerns:** The session ended with four unresolved revision requests: (1) remove home automation from in-scope, defer to v2; (2) add "build family trust in system reliability" as a separate goal; (3) flag the voice/timeline tension as an explicit risk with scoped-down MVP voice; (4) simplify aide scheduling to push-based alerts rather than real-time database lookups.

## Session stats

| Metric | Value |
|---|---|
| Questions asked | 24 |
| Purpose fields | 3/3 |
| Goals | 4 (+ 1 proposed, unapplied) |
| Stakeholders | 6 + respondent |
| In-scope items | 12 |
| Out-of-scope items | 3 |
| Constraints | 6 |
| Assumptions | 4 |
| Findings | 8 |
| Agent model | Haiku 4.5 |
