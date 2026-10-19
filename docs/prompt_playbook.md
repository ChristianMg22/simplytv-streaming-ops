# Prompt playbook for feed diagnosis

Three templates I use with an AI assistant when investigating an incident. The shared rule:
**concrete context + real data + output format**, and I always verify the answer against the data
before acting or escalating.

## 1. Diagnosing a faulty delivery
```
Context: linear EPG feed, daily delivery at 03:00 UTC, normally ~20,000 records.
Today 15,800 arrived (79%), status OK, checksum ok, normal latency.
Attached data: last 14 deliveries (date, records, latency, schema_version).
Task: list the 3 most likely causes ordered by probability and, for each one, the SQL query
or command that would confirm or rule it out.
Format: table with columns cause | why it is likely | how to verify it.
Do not give conclusions: only hypotheses with their verification.
```

## 2. Summarizing a long log
```
I am giving you 200 ingestion log lines (format: ts level feed= client= status= records= expected=).
Task: group by feed, count ERROR and WARN, and tell me which feeds changed behavior
compared with the rest of the file. Quote the exact lines that support each claim.
If you cannot assert something from the lines given, say so.
```

## 3. Message to the client
```
Write a 5-line message for a non-technical client (TV operator).
Facts: guide for 12 channels not updated since 02:00 UTC; cause: the provider changed the XML
format; we already fixed the parser; the guide will normalize in 45 min.
Tone: direct, no jargon, no excessive apologies. Include what the client saw, what happened,
what we did and when it will be resolved. Do not promise anything that is not in the facts.
```

## How I verify
- I always ask for the query or command that backs each claim, and I run it myself.
- I check figures against the source (SQL or log), not against the assistant's wording.
- I document the finding and the confirmed root cause so the diagnosis is not repeated.
