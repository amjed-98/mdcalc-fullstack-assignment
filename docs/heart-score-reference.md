# HEART Score — reference

This is the source of truth for the scoring logic. The numbers come from the
original Backus et al. validation (2013). If your implementation disagrees
with any row here, your implementation is wrong.

## Inputs

Each input is scored 0, 1, or 2.

### 1. History

| Points | Meaning                     |
| ------ | --------------------------- |
| 0      | Slightly suspicious         |
| 1      | Moderately suspicious       |
| 2      | Highly suspicious           |

### 2. ECG

| Points | Meaning                                         |
| ------ | ----------------------------------------------- |
| 0      | Normal                                          |
| 1      | Non-specific repolarization disturbance         |
| 2      | Significant ST deviation                        |

### 3. Age (years)

| Points | Age       |
| ------ | --------- |
| 0      | < 45      |
| 1      | 45–64     |
| 2      | ≥ 65      |

### 4. Risk factors

Risk factors: hypertension, hypercholesterolemia, diabetes mellitus, obesity
(BMI > 30), current or recent (≤ 90 days) smoker, positive family history
(parent or sibling with CVD before age 65), atherosclerotic disease (prior
MI, PCI/CABG, CVA/TIA, or peripheral arterial disease).

| Points | Criteria                                                              |
| ------ | --------------------------------------------------------------------- |
| 0      | No known risk factors                                                 |
| 1      | 1–2 risk factors                                                      |
| 2      | ≥ 3 risk factors **or** history of atherosclerotic disease            |

### 5. Initial troponin

`x` = upper limit of normal (local assay).

| Points | Value          |
| ------ | -------------- |
| 0      | ≤ 1× normal    |
| 1      | 1–3× normal    |
| 2      | > 3× normal    |

## Bands

| Total | Band     | 6-week MACE risk | Suggested disposition                    |
| ----- | -------- | ---------------- | ---------------------------------------- |
| 0–3   | low      | 0.9–1.7%         | Consider discharge                       |
| 4–6   | moderate | 12–16.6%         | Admit for observation / further workup   |
| 7–10  | high     | 50–65%           | Early invasive strategy                  |

> **Not for clinical use.** This document supports an engineering exercise
> only. Don't use these exact numbers for anything that touches a patient.
