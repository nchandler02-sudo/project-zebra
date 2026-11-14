# Treat this as unverified

Project Zebra is a teaching game, not a clinical reference. The software is built and tested. The medicine inside it is not yet verified.

**Everything in `data/` was drafted by an AI model and has not been reviewed by a physician.** That covers every diagnosis, drug, answer list, alias, rarity score, teaching point ("pearl"), multiple-choice question, case vignette and clue. Each file carries `review_status: "unreviewed"` where the format allows it.

What that means in practice:

- **Facts may be wrong, outdated or oversimplified.** Some entries rest on case reports. Some may be incorrect.
- **Rarity scores are estimates, not measurements.** They are a plausible guess at how rarely a trained resident would name an answer. They are not survey data.
- **Do not use it to make or justify a clinical decision.** It does not replace guidelines, textbooks, UpToDate-style references, pharmacists or your attendings.
- **If you teach with it, review the content first.** Treat a wrong answer as a prompt to look it up. The `/bank` page lists every item so reviewers can check each one.
- **Question bank sources.** The content was AI-generated from general medical knowledge, and no licensed question-bank text (MKSAP, UWorld, board-prep material or similar) was knowingly included. Do not add any that you do not have the rights to share.

Fixes are very welcome. If you are a clinician and find an error, open an issue or a pull request with the correction and a source. Once a reviewer signs off on an item, set its `review_status` accordingly so others can see what has been checked.

The authors provide the software and content as is, with no warranty of any kind (see `LICENSE`).
