# Scoring Rubric

Detailed scoring criteria for each of the eight dimensions. Used during step 3 of the workflow.

## Score scale

All scores are on a 1.0 to 5.0 scale in 0.5 increments. 3.0 is a neutral baseline derived from mixed or average evidence, not a default placeholder.

- **1.0** — Significant concern with concrete evidence. Multiple credible sources document serious problems.
- **2.0** — Below average. Multiple weak signals, or a single moderate concern not offset by positives.
- **3.0** — Neutral. Mixed or average evidence, or the company appears typical for its industry and size.
- **4.0** — Above average. Multiple supporting signals from independent sources.
- **5.0** — Strong and well-evidenced across multiple independent sources. Recognized externally.

Use intermediate steps (1.5, 2.5, 3.5, 4.5) when evidence sits between two anchors.

## Insufficient evidence

Flag a dimension as `insufficient_evidence` when:

- Fewer than two independent sources are found for that dimension, or
- The sources found are too generic to support a substantive assessment (for example, only the company's own "about" page), or
- The branch office is too small or new to have a distinct profile and parent-company evidence does not apply.

When flagged, exclude the dimension from the overall score calculation and state in the report that the overall is based on N of 8 dimensions.

## Sourced versus inferred

- **Sourced** — finding is directly supported by one or more independent external sources cited in the source list.
- **Inferred** — finding derived from logical reasoning over indirect signals when no direct source is available. The reasoning chain must be described briefly in the rationale.

A dimension's overall label reflects the dominant evidence type. Mixed evidence defaults to `sourced` if at least half the signals are direct.

---

## Dimension 1: Culture and Values

Measures alignment between stated culture and evidenced culture. Stated values are easy to write on a careers page. Evidenced values show up in employee reviews, press coverage, leadership behavior, and conduct under stress.

**Sources to consult:**
- Glassdoor reviews, especially the "Cons" and recent reviews
- LinkedIn posts from current and former employees
- Press coverage of internal culture, controversies, or layoffs
- The company's stated values (compare against evidence)
- Kununu (DACH) for German-speaking markets

**Score 5.0 signals:** consistent employee testimony across sources, external recognition for culture, transparent handling of past mistakes, leadership behavior that visibly reinforces stated values.

**Score 1.0 signals:** documented gap between stated and lived values, recurring complaints across review platforms about toxic dynamics, public scandals tied to cultural failure, mass departures with culture cited as reason.

**Red flags:** patterns of negative reviews mentioning fear of retaliation, evidence of values used to silence dissent, repeated culture-related departures of senior staff.

---

## Dimension 2: Leadership Quality

Measures competence, transparency, and track record of senior leadership. Both local branch leadership and parent-company senior leaders are relevant.

**Sources to consult:**
- LinkedIn profiles and posts of CEO and relevant department heads
- Public interviews, podcasts, and published articles
- Annual reports and shareholder letters
- Press coverage of strategic decisions and outcomes
- Glassdoor "Senior Leadership" rating
- Tenure of the senior team

**Score 5.0 signals:** stable, credentialed leadership with consistent strategic execution, transparent communication including about setbacks, recognized leadership in the industry, no significant controversies.

**Score 1.0 signals:** rapid leadership turnover, public credibility issues, governance scandals, refusal to address documented problems, regulatory sanctions tied to leadership conduct.

**Red flags:** CEO tenure under 18 months, multiple C-suite departures in a 12-month window, public disputes within leadership, board interventions.

---

## Dimension 3: Work Environment

Measures pace, autonomy, team dynamics, working conditions, and work-life balance.

**Sources to consult:**
- Glassdoor "Work-Life Balance" rating and reviews
- LinkedIn posts mentioning work conditions
- Industry surveys on working hours for the relevant role
- Country-specific employee rights and the company's compliance record
- News on overtime, layoffs, or workplace incidents

**Score 5.0 signals:** strong work-life balance ratings, evidence of genuine flexibility, hybrid or remote options, recognition for employee wellbeing programs, low complaint rate.

**Score 1.0 signals:** documented burnout culture, reports of excessive hours, hostile team dynamics, labor disputes or strikes, regulatory actions on working conditions.

---

## Dimension 4: Career Development

Measures growth opportunities, internal mobility, learning support, and progression paths.

**Sources to consult:**
- Glassdoor "Career Opportunities" rating
- LinkedIn data on tenure and promotion patterns
- Public information on internal mobility, training programs, education support
- Job postings showing internal-only vs external-only roles
- Company-published L&D programs

**Score 5.0 signals:** documented internal promotion patterns, named training programs with external recognition, generous education support, visible career frameworks.

**Score 1.0 signals:** very high turnover at junior levels, no documented development programs, complaints about lack of growth, hiring exclusively external for senior roles.

---

## Dimension 5: Financial Stability

Measures sustainability of the business model and current financial health.

**Sources to consult:**
- Local company register (Brønnøysund, Companies House, Bundesanzeiger, etc.)
- Yahoo Finance or equivalent for listed companies
- Annual report and financial statements
- Press coverage of funding rounds, layoffs, restructuring
- Industry analyst reports

**For private companies in scope countries, prioritize the country's public business register.** Sources are listed in `data_sources_per_country.md`.

**Score 5.0 signals:** consistent multi-year revenue and profit growth, strong balance sheet, no recent layoffs, positive analyst sentiment, diversified revenue.

**Score 1.0 signals:** consecutive years of losses, recent layoffs cited as cost-cutting, debt restructuring, negative auditor's notes, regulatory financial concerns.

**Notes:**
- For very small companies where the public register provides limited data, flag as `insufficient_evidence` rather than guessing.
- For branch offices of large parents, score the parent's financial stability and note this explicitly.

---

## Dimension 6: Mission and Purpose

Measures meaningfulness and clarity of the company's purpose, and whether stated purpose is reflected in actual business activity.

**Sources to consult:**
- Mission and vision statements (compare against actual operations)
- Sustainability and impact reports (CSRD reporting, GRI, SASB)
- ESG ratings (Sustainalytics, MSCI ESG if accessible)
- Customer testimonials and case studies
- B Corp certification, mission-driven certifications

**Score 5.0 signals:** clear purpose visibly driving decisions, third-party validation of mission claims, transparent impact reporting, alignment between mission and revenue sources.

**Score 1.0 signals:** mission as marketing wrapper for unrelated business, controversies that contradict stated purpose, no measurable mission outcomes, withdrawal from mission-aligned commitments.

---

## Dimension 7: Talent Attraction and Retention

Measures the company's ability to attract and keep employees, evidenced by turnover signals, tenure patterns, employer recognitions, and retention practices.

**Sources to consult:**
- LinkedIn tenure data for employees in similar roles
- Glassdoor "Recommend to a Friend" and "Approve of CEO" ratings
- Employer award recognitions: Great Place to Work, Top Employer, Best Workplaces lists
- Public referral programs and rehire rates if disclosed
- Press coverage of hiring announcements vs layoffs

**Score 5.0 signals:** multi-year employer awards (Great Place to Work certified, Top Employer, similar), long average tenure, high "Recommend" rating, active alumni community, low advertised turnover.

**Score 1.0 signals:** short median tenure (under 18 months for non-junior roles), low recommend rate, recurring complaints about retention, public news of mass departures, no employer recognitions despite size.

**Specific check:** if Great Place to Work has the company in its certified list for the country, increase the score by 0.5 unless other evidence contradicts it.

---

## Dimension 8: Diversity and Inclusion

Measures measurable practices, regulatory compliance, and certifications. Statements without measurable evidence count for little.

**Strongest evidence types (in order):**

1. **Åpenhetsloven and Aktivitets- og redegjørelsesplikten reports (Norway)** — these are legally required reports with specific disclosures on equality and human rights due diligence.
2. **CSRD sustainability reporting (EU, from 2024)** — includes mandatory DEI disclosures with specified metrics.
3. **CSDDD (Corporate Sustainability Due Diligence Directive)** reports.
4. **UK Gender Pay Gap Service** — mandatory annual disclosure for UK employers above 250 staff.
5. **GRI and SASB reporting** — voluntary but standardized.
6. **Independent certifications:** EDGE, B Corp, Investors in People, Top Employer, Great Place to Work certification.

**Weaker evidence types:**
- Diversity statements on the careers page
- Anecdotal testimony in employee reviews
- Press releases announcing initiatives without follow-up reporting

**Score 5.0 signals:** measurable, multi-year DEI metrics published with progress against goals, multiple certifications, evidence of accountability (named owner, board oversight), pay gap reporting with closing trend.

**Score 1.0 signals:** documented discrimination cases, sustained pay gap with no remediation, leadership homogeneity at odds with stated commitments, regulatory non-compliance with mandatory DEI disclosures, public complaints with patterns.

**Notes:**
- Mere statements ("we value diversity") without measurement default to score 2.5 if no other evidence.
- Certifications without recent renewal default to score 3.0.
- If the company is below regulatory thresholds and no voluntary reporting exists, this often justifies `insufficient_evidence`.
