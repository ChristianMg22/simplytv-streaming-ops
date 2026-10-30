# Presentation script: technical case + business case

One project, two readings. Open the dashboard at the **Business** section (or press **Tour**), and let the technical sections be the proof.

## 2-minute version (recruiter or first screen)
| Time | Click / show | Say |
|---|---|---|
| 0:00 | Hero | "I built an end-to-end case for streaming operations: 160k feed deliveries and 5,485 incidents. Synthetic data anchored on public Simply.TV milestones, so I can share it." |
| 0:20 | **Business** cards 1–2 | "24.7% of incidents miss their SLA. The biggest lever is schema changes: 22% of incidents but 37% of breaches. And 316 bad deliveries never opened a ticket." |
| 0:50 | Business cards 3–4 + ROI | "The action is to alert on schema changes and flag the riskiest 20% of tickets. With stated assumptions that is about 87 breaches avoided a year. I would prove it with a 90-day pilot and a control group." |
| 1:30 | Lab → Case file | "To go from alert to action I wrote an investigator in Python that reads the logs and writes the ticket for Development or Operations." |
| 1:50 | Close | "Everything is SQL and Python in a public repo, with tests and CI." |

## 5-minute version (technical interview)
1. **Business (60 s):** the four cards, then move the ROI sliders and say the money is an assumption you would replace with the real cost of a breach.
2. **Explorer (45 s):** filter to North America (31.8% breach rate) vs DACH (19.8%). Mention filters recompute in the browser and the link is shareable.
3. **Diagnosis (45 s):** schema drift coincides with schema v3.2 and checksum mismatches; client-detected issues take 13 h to surface vs 0.2 h automatic.
4. **Risk model (75 s):** AUC 0.726 vs 0.690 baseline; then the card *How far can you trust this model?*: bootstrap interval excludes zero, wins in all four time windows, calibration error 1.6%. Say what did not help.
5. **Lab (75 s):** SQL tab (anti-join for silent failures), Python tab (tolerant log parser), *How well does it work?* (53% family accuracy vs 45% baseline, said honestly).
6. **Close (15 s):** 30/60/90-day plan on real data.

## Objections, with honest answers
- **"The data is synthetic."** Yes, by design: real client data is confidential. It is anchored on public milestones, the generator is in the repo and the pipeline is the same one I would point at real logs. Days 1–30 of the plan are exactly that switch, and I expect the numbers to move.
- **"The model only improves AUC by 0.036."** The gain is statistically real and stable, but modest, and I show it rather than hide it. I tried history features, interactions and ensembles and none helped, which tells me the signal is limited by what is known at ticket opening. Its job is triage, not prediction: it flags the top 20% and catches about 40% of breaches.
- **"Where does the money come from?"** From avoided breaches times a cost per breach that I do not know; the sliders make that explicit. The defensible claim is the number of breaches avoided, and only a pilot can confirm it.
- **"Why not a deep model or an LLM?"** Triage needs calibrated probabilities and explanations an ops lead can trust. Logistic regression gave those; I would add an LLM only for free-text ticket summaries, behind the same evaluation.
- **"What would you do first on the job?"** Connect the real logs, rebuild the baseline, and switch alerts on in shadow mode before changing anyone's workflow.
- **"What are the limits of the investigator?"** It reads delivery telemetry, so it separates schema, transport and content problems, but cannot tell mapping, artwork or schedule causes apart without ticket text. Family accuracy is 53%, not 90%.

## Numbers to remember
5,485 incidents · 24.7% breach · schema drift 22% of incidents / 37% of breaches / 41% breach rate · 316 silent bad deliveries · detection 13 h (client) vs 0.2 h (auto) · model AUC 0.726 vs 0.690 · top 20% captures 40% · investigator 53% vs 45%.
