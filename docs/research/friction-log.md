# API interview: one developer

One remote interview on 2026-10-07 tests who this API serves and the problem it names. P3 is a
front-end developer. The session is a story-based interview ("Tell me about the last time..."),
then the problem statement from `docs/product.md` read aloud ("Does this statement match your
experience?"), then a few minutes trying this API from Swagger UI ("Is this right?"). The README
comes only if asked. Written on 2026-10-06.

It is one of three interviews that day: the front app gets P1 and P2. P4 was dropped because P3
gave enough material. One person, a colleague of the moderator, gives an anecdote, not a pattern
("Limits"). This protocol replaces the usability test this file held before. The file keeps its
name so links survive.

Every method line carries, in brackets, the id of its rule in "Sources", which quotes the course
content of the cohort's PM week and Design week Tuesday. A line with no id is logistics.

## Why this shape

- **A story about a past event, not a task.** An interview generates knowledge about users; a
  usability test assesses a design [UI101-vs]. So the session asks about the last time the
  participant did the job, not about a hypothetical [TUE-past] [OST-story].
- **The problem statement, read aloud.** A problem statement is checked with the people who have
  the problem [PS-validate], and their answers tighten it [PS-refine].
- **The product last, for a few minutes.** Testers try the basic product and judge whether it
  solves the pain [MVP-beta], are asked "Is this right?" [MVP-right], and think aloud
  [CHEAT-thinkaloud]. The interview comes first and does not name the API, so it does not prime
  them [UI101-mix].
- **A developer.** The persona under test is D1, a developer, and a persona starts as a guess
  that interviews test [PERSONA-test].
- **What left with the usability test.** The Single Ease Question, task timings, success rates,
  milestones, cognitive-dimensions questions, the word check, reaction words, and a session with
  the moderator playing the storefront. This file no longer uses them.

## Research goals

Each goal is an assumption from `docs/product.md`, to confirm or reject [UI101-1]
[JTBD-objectives].

1. **Persona** [PERSONA-test], from "Who it is for": D1, the developer who integrates the store.
   D1 reads the contract and Swagger UI, not the code, and decides what the shopper sees from the
   status code and the problem type.
2. **Problem** [PS-validate]: the problem statement under "The problem" in `docs/product.md`.
3. **Product** [MVP-beta]: whether Swagger UI, with the README if asked, answers it.

## Setup

- **When.** P3 on 2026-10-07, 30 minutes, remote, in English.
- **Target.** The deployed store at `https://d1hfx5i8kcs8ag.cloudfront.net/v1`, with Swagger UI
  at `https://d1hfx5i8kcs8ag.cloudfront.net/docs`. Stripe runs in test mode, so no real money
  moves. Every account a participant creates uses a made-up email ending in `@example.com`.
- **Call.** Google Meet in Chrome, not Safari: Safari's voice processing can leave a local
  recorder's microphone track silent. The participant shares their screen while trying the API,
  so the moderator can watch.
- **Recording.** OBS Studio records locally on the moderator's Mac: one macOS Screen Capture
  source on the entire display, plus the microphone and the system audio, to a Hybrid MP4 that
  survives a crash. The fallback is Zoom's local recording, which moves the calls to Zoom. Wispr
  Flow Notetaker writes the transcript, which stands in for a note-taker; it starts with the call,
  because it cannot import a recording later. Files are named by P number and stay out of this
  repository ("What this repository holds").
- **Privacy.** No consent step: the participant is a colleague of the moderator, and the project
  is internal. Every file and note uses the P number only: no name, email or employer. No clip of
  P3 is used, because the video is not published. Quotes go only to the unlisted page for RAVN
  evaluators. This repository holds only de-identified results, such as paraphrased stories,
  verdicts and findings ("What this repository holds" lists them all).
  Recordings, transcripts and session notes stay outside it, and the full recordings and
  transcripts are deleted by 2026-10-23.

## Before the session

- **On 2026-10-06:** pilot this guide once and fix what confused [UI101-3]. Make one test call
  that puts both voices in the OBS recording and in Wispr's transcript, with both of OBS's audio
  meters moving. Otherwise the test call repeats with Zoom's local recording.
- **At 08:30 on 2026-10-07, not with a participant watching:**
  - `GET /v1/products` lists the store's products: 8 on 2026-10-06. A fresh store has none: the
    seed creates roles and categories only in production (`prisma/seed.ts:61-62`), and only a
    manager can create one (README, "Deploy", step 4).
  - The "Servers" box in `/docs` lists `/v1`. If it lists only `http://localhost:3000/v1`, "Try it
    out" fails with "Failed to fetch".
- **Before the call:** Do Not Disturb on; mail, Slack and private tabs closed; the guide
  open, with the probes on an index card beside the screen [UI101-6]. Start OBS, then Wispr.

## The session (30 minutes)

The guide is flexible: skip, reorder or stay longer on a question when the story is rich
[UI101-2]. Talk slowly [UI101-4]. Do not interrupt or rush; acknowledge with "I see", "okay", or
by echoing their words [UI101-5]. Never give an opinion, and avoid yes/no questions
[JTBD-listen] [UI101-leading]. Do not mention the store API or its features before block 5, so
the interview does not prime them [UI101-mix].

| Block | Minutes |
|---|---|
| 1. Start easy | 0-2 |
| 2. Background | 2-4 |
| 3. The stories | 4-16 |
| 4. The problem statement | 16-18 |
| 5. Try the API | 18-27 |
| 6. Close | 27-30 |

### 1. Start easy [JTBD-intro] [UI101-4]

> Thanks for doing this. I'm learning how developers work with other people's APIs. First I'll
> ask about your own experience, then I'll show you something I built and ask what you think. What
> you tell me helps me decide what to change. There are no right or wrong answers.

> To start, tell me a bit about yourself and your work.

### 2. Background [JTBD-guide]

> What kind of projects are you building these days?

### 3. The stories [TUE-past] [OST-story] [JTBD-guide]

> Tell me about the last time you connected an app to an API someone else built. What happened?

Follow-ups, only for what the story has not covered [UI101-2]:

- When did this happen? How long did it take you?
- What did you read first to understand it? [UI101-2]
- And how did you solve it? [VELLO-shape]
- What was going through your mind at that point? [JTBD-probe]

Second story, if the first did not reach a failure [OST-story]:

> Tell me about a time a call to an API like that failed. What did you do?

- How did you work out what went wrong? [UI101-2]
- What did the person using your app see? Only if they bring up the user. [UI101-2]
  [JTBD-listen]
- How did you feel during this experience? [UI101-2]

Probes, from the index card [UI101-6] [JTBD-probe]: "Tell me more about that." "Can you expand on
that?" "Why is that important to you?" "What alternatives did you consider?"

### 4. The problem statement [PS-validate]

Read aloud the problem statement from "The problem" in `docs/product.md`, then paste it in the
chat.

> Does this statement match your experience?

Whatever they answer: "Tell me more about that." [UI101-6]

### 5. Try the API [MVP-beta] [MVP-right] [CHEAT-thinkaloud]

Paste the Swagger link in the chat:

```
Swagger: https://d1hfx5i8kcs8ag.cloudfront.net/docs
```

Give the README, `https://github.com/f3r21/t-shirt-store-api`, only if they ask for it.

> This is a store API I built. It runs in Stripe's test mode, so no real money moves. Please look
> around the docs and try any call you like, and say what you think as you go. If you create an
> account, use a made-up email ending in @example.com.

Watch without explaining. If they go quiet: "What do you think about that?" [UI101-6]

> Is this right for the problem you described earlier? [MVP-right]

Then: "Tell me more about that." [UI101-6]

### 6. Close [JTBD-reflect] [VELLO-shape]

> What was better than you expected, and what was worse?

> Last thing. If an API like this worked perfectly for you, what would it do?

> That's everything. Thank you, this really helps.

## After the session

1. Stop OBS and Wispr. Name the files `P3-2026-10-07`, outside every repository.
2. Within 15 minutes, fill the session notes in the participant's words [STORY-words]. The notes
   stay outside this repository.
3. Paraphrase the notes into "Results", within "What this repository holds".

## What this repository holds

Only de-identified results, under the P number; all of the participant's results may go in. Those
results are the role and context answers, the story and its patterns, the answer to the problem
statement, what the participant did and said while trying the API, the feedback weighed, and the
themes, insights, job stories and verdicts, all in paraphrase. Recordings and transcripts stay
outside this repository, and so do the session notes, because the notes hold the participant's own
words. If the participant later asks, the results are removed from this repository; earlier versions
stay in its history, de-identified. Quotes go only to the unlisted page for RAVN
evaluators, under the P number. No clip goes there, because the video is not published.

## Results

The verdicts are in "Validated by" in `docs/product.md`: the persona and the problem statement
are complicated, and the product is unclear. They come from one participant, P3, so each is an
anecdote, not a pattern [TUE-anecdote]. Every cell is a paraphrase; the participant's own words
stay in the session notes and on the unlisted page [STORY-words].

### Feedback, weighed [MVP-filter]

| Feedback | Participant | Core problem or preference |
|---|---|---|
| Not at ease in Swagger UI; named Postman as another tool | P3 | Preference, not scheduled |

### Limits

One developer in a 23-minute session, a colleague of the moderator. The course asks for five to
eight users per user group [QQ-n], three to four stories before mapping the opportunities
[OST-count], and 60 to 90 minutes per interview [JTBD-length]. Because P3 is a colleague,
social-desirability bias is likely [TUE-saydo]. The shopper behind D1's software is not
interviewed. One interview is an anecdote, not a pattern [TUE-anecdote].

## What changes because of this

The results reach the product page, which links this file [PRD-link]. Each feedback weighed as a
core problem becomes a "Next" item, not code; one that names a missing README line is fixed in
the README instead. A preference is recorded in "Feedback, weighed", not scheduled
[MVP-filter].

- In `docs/product.md`: the verdicts on D1, the problem and the product, in paraphrase; the
  refined problem statement, where a verdict says it changes; and the "Next" items.
- In `docs/qa/risk-register.md`: any new risk, from R10 onward.
- In the README: the missing lines.

On 2026-10-07, the reset item left the "Next" list in `docs/product.md`. It was a Swagger UI
description for `forgot-password`, where P3 stopped. With the specific errors in the served
Swagger, it became "Now" as one change, B1 + B2. The product page holds its scores and
acceptance criteria.

### The blind check before the change

The success measure of B1 + B2 (spec #34). A rehearsal by an agent, not a user. On 2026-10-07 at
20:29 local time (01:29 UTC on 2026-10-08), an agent that had never seen the code read only the
README on GitHub and the deployed `/docs` and `/docs-json`. The deployed image was `d442968`,
deployed on 2026-10-06. It sent five GET requests and nothing that writes. The answers are
quoted as the agent gave them, shortened where marked "[...]".

| Question | Answer, verbatim | Source | Time |
|---|---|---|---|
| What happens after forgot-password, and which call comes next? | "The call answers 202 and the docs say only 'The request is accepted.' The summary says it requests a password reset link, so I expect a mail with a link that carries a reset token. The next call is POST /auth/reset-password with `token` and a new `password` of 8 to 128 characters. It answers 204 when the password is changed and 422 when the token is not valid. The docs do not say how the token reaches you, where it sits in the link, or how long it lasts." | Guess: no text links the two operations | 35 s |
| Which specific errors can POST /orders return, and what is the title for too little stock? | "The docs list status codes, not specific errors. [...] The title for too little stock is not stated. Too little stock is a 409, and it shares that status with an empty cart, so the docs give no way to tell the two apart." | Page for the statuses; the title is not stated | 24 s |
| Can POST /promo-codes answer 'Email already registered'? | "Not stated. [...] The words 'Email already registered' appear nowhere in the README or the API reference [...] So I would expect no, but that is my inference." | Guess | 13 s |

Result before: none of the three is answered from the page alone. The pass rule for the check
after the deploy is all three answered correctly from the page, with no guess.

### The blind check after the change

The same check, after the B1 + B2 deploy. A rehearsal by an agent, not a user. On 2026-10-08
at 05:07 local time (10:07 UTC), an agent that had never seen the code read only the README on
GitHub and the deployed `/docs` and `/docs-json`. The deployed image was `010aeba`, deployed on 2026-10-08. The
agent could not see that from its sources: none of them names the image, and the README still
gave 2026-10-06. It sent twelve GET requests and nothing that writes. Seven of them came from a
browser that showed Swagger UI. The answers are quoted as the agent gave them, shortened where
marked "[...]".

| Question | Answer, verbatim | Source | Time |
|---|---|---|---|
| What happens after forgot-password, and which call comes next? | "`POST /auth/forgot-password` always answers 202, whether or not the address has an account. It sends the reset mail only when the account exists. The next call is `POST /auth/reset-password` with `{"token", "password"}`, where the token comes from that reset mail. Success is 204 with no body. It signs out every device, so the user signs in again, and it sends an email to the account address. An unknown or expired token gives 422. On the deployed instance the mail never arrives, so you cannot finish a reset there." | Page | 50 s |
| Which specific errors can POST /orders return, and what is the title for too little stock? | "Too little stock is a 409 with title `Not enough stock` and type `https://tshirt.store/problems/insufficient-stock`. The other failures with their own type are the four promo code ones on 422: `Promo code unknown`, `Promo code expired`, `Order below the promo code minimum`, `Promo code exhausted`, and the shared 401 `Access token expired`. The untyped ones are 400 `Validation failed`, 401 `Unauthorized`, 409 `Conflict` for an empty cart or a cart that changed during the order, and 500 `Internal server error`. [...]" | Page | 27 s |
| Can POST /promo-codes answer 'Email already registered'? | "No. POST /promo-codes has one 409, title `Conflict` with no type, detail 'Another promo code already uses this code.' 'Email already registered' is the 409 of POST /users, type `email-taken`. The docs say each failure lists only the problems its own operation returns." | Page | 9 s |

Result after: all three are answered correctly from the page, with no guess, so the pass rule
holds.

Two caveats:

- The answer to question 1 joins two stated sentences: the README text "its reset mail" and the
  reset-password text "Send the token from the reset mail". No single sentence names the next
  call. That is the risk `docs/product.md` records. The agent kept the label "page", because
  the join needs no fact the sources leave out.
- This time the agent downloaded the sources before the clocks started, so its times cover
  reading and answering only. They are not comparable one to one with the times before, where
  the README read fell inside question 1.

## Sources

The course content of the cohort's PM week and Design week Tuesday, read on 2026-10-06. Nothing
outside it. Each id names its document by its prefix.

**"User Interviews 101", NN/g** (Design week, Tuesday)

- **[UI101-vs]** An interview is "To generate new knowledge about your users"; a usability test is
  "To assess a design".
- **[UI101-1]** "an interview should have research goals (or research questions)."
- **[UI101-2]** "a few well-designed, open-ended questions", with follow-ups such as "When did this
  happen? How long did it take you?" and "How did you feel during this experience?" "An interview
  guide can be used flexibly".
- **[UI101-3]** "You can pilot your guide with a friend or colleague".
- **[UI101-4]** "Start with questions that are easy to answer, such as Tell me a bit about
  yourself". "Slow down your pace of speech."
- **[UI101-5]** Neutral acknowledgments ("I understand, okay, I see") and "Echoing what the
  participant has said". "Avoid interrupting or rushing participants".
- **[UI101-6]** "Tell me more about that. Can you expand on that? What do you think about that?"
  Probes can be written "on an index card."
- **[UI101-leading]** "If the interviewer asks many leading questions, the validity of the data
  will be compromised."
- **[UI101-mix]** "Your session might begin with a short interview before transitioning to the
  test." The interview "shouldn't prime users to pay more attention to certain things in the
  design."

**"Jobs to be done for Product Managers"** (PM week, Monday)

- **[JTBD-objectives]** "consider what key assumptions you want to validate or invalidate about
  your customers' motivations and challenges."
- **[JTBD-intro]** "a warm introduction, explaining the purpose of the interview, and assuring the
  participant that there are no right or wrong answers."
- **[JTBD-guide]** "starting with background questions, diving into the specific purchase story,
  and ending with reflective questions."
- **[JTBD-probe]** "What was going through your mind at that point?" "What alternatives did you
  consider".
- **[JTBD-listen]** "avoid leading or yes/no questions that can bias the response."
- **[JTBD-reflect]** "What has been better than expected, and what has been worse?"
- **[JTBD-length]** "JTBD interviews typically last 60-90 minutes".

**"The Product Management Problem Statement: How to Get it Right"** (PM week, Monday)

- **[PS-validate]** "Does this statement resonate with their lived experience?"
- **[PS-refine]** "Use that feedback to tighten your language, clarify the pain, and better
  represent the reality of your potential users."

**"How to Create Product Personas + Examples"** (PM week, Monday)

- **[PERSONA-test]** "test your hypotheses later with user surveys/interviews."

**"What is a Minimum Viable Product (MVP)? How to Get Started"** (PM week, Tuesday and
Wednesday)

- **[MVP-beta]** Testers "give the basic technology a try" and "focus on the functionality and the
  ability to solve pain points."

**"Minimum Viable Product (MVP) Example - The Handy Guide"** (PM week, Tuesday and Wednesday)

- **[MVP-right]** "This is the kind of content I want to create. Is this right?"
- **[MVP-filter]** "Does it address a core problem", "or is it a minor typo or personal
  preference?"

**"What is a Product Requirements Document (PRD)?"** (PM week, Tuesday and Wednesday)

- **[PRD-link]** "List or link to the user stories involved. Also link to customer interviews".

**"Opportunity Solution Trees"** (PM week, Thursday)

- **[OST-story]** "A story-based interview might start with a prompt of the form, 'Tell me about a
  time when...'"
- **[OST-count]** "three to four customer stories. This is enough to prevent you from overreacting
  to a single story".

**"User Stories With Examples and a Template", Atlassian** (PM week, Friday)

- **[STORY-words]** "Talk to your users and capture the problem or need in their words."

**"TUESDAY"** (Design week, Tuesday)

- **[TUE-past]** "Good interviewers ask about specific past events ('tell me about the last time
  you hired a dog walker'), not hypotheticals".
- **[TUE-saydo]** "people report what they believe about themselves, which often differs from what
  they actually do." "User Interviews 101" adds "Social-desirability bias".
- **[TUE-anecdote]** "One vivid interview is an anecdote until you see the pattern repeat".

**"UX Research Cheat Sheet", NN/g** (Design week, Tuesday)

- **[CHEAT-thinkaloud]** "If you can do only one activity and aim to improve an existing system, do
  qualitative (think-aloud) usability testing".

**"Qualitative vs. Quantitative UX Research"** (Design week, Tuesday)

- **[QQ-n]** "Our rule of thumb for qualitative research is five to eight users per user group."
  "it's okay to test with a small number of users."

**The course's Vello project** (Design week, Tuesday)

- **[VELLO-shape]** The interview `Vello_Interview_P01.md` asks "And how did you solve it?" and
  closes with "Last thing. If a service like this existed and worked perfectly, what would it
  do?" Its header records Participant, Role, Context, Date, Length, Interviewer and Notes.
