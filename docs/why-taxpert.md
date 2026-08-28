# Why Taxpert: Product & Research README

**August 2026**

## Contents
- [What is Taxpert for?](#what-is-taxpert-for)
- [About](#about)
- [Design rationale](#design-rationale)
- [What this release contains](#what-this-release-contains)
- [This release and the future](#this-release-and-the-future)
- [Design principles](#design-principles)
- [Audience, roles, and governance](#audience-roles-and-governance)
- [Roles and governance](#roles-and-governance)
- [Summary of research](#summary-of-research)
- [Scope](#scope)
- [Findings](#findings)
- [Next steps](#next-steps)

## What is Taxpert for?
The Taxpert suite of tools aims to increase the delivery capacity of teams tasked with building and maintaining complex statute-based software, like tax calculators and eligibility determination tools.

It’s the complexity and interconnectedness of tax rules (along with frequent changes) that multiply the difficulty of delivering these kinds of products. It takes whole teams to understand the tax logic, design how it should unfold in the product, code it, present it as a usable experience, and then make sure it’s right before putting it in the hands of the taxpayers who rely on it to be accurate. 

Those delivery teams typically have engineers, designers, and domain experts, all holding a different slice of knowledge about how the system should work, but no one has full understanding across disciplines to validate every aspect of the resulting product.

In the product UI, tax rules are expressed through the text, how the inputs and prompts are phrased for the end user. Without visibility into the system’s inner workings in context of the built experience, it’s difficult to trace what fact an input collects, what rule it implements, what other facts or rules are involved in a calculation or determination, or why the text is phrased in a certain way. It can be a black box. 

Teams compensate with spreadsheets, diagrams, documentation, and role-specific workflows. But those are snapshots and interpretations that themselves create further maintenance burden. Taxpert approaches the problem differently: rather than creating one more job aid, it directly exposes the underlying system facts, rules, and relationships.

Automated testing remains critical and Taxpert doesn’t replace or even address the same need. Taxpert helps cross-functional teams establish whether an implementation is correct in order to identify the scenarios and behaviors for regression testing. It specifically helps teams see why the system does what it does, so they’re able to judge whether a tax rule is implemented accurately or even if one is missing. 

By offering the team a shared reference, it reduces lossy translation between disciplines and various system artifacts. It facilitates delivery for complex statute-based software by putting the rules, behaviors, and annotations in context of the built experience. It makes the black box legible.

## About
Ahead of its pilot season, the IRS Direct File team recognized the need to create a window into its rule implementation for the tax experts testing its accuracy. This tax expert interface was envisioned as a tool for helping teams validate and maintain the many interconnected rulesets in play in that Q&A-style user experience. 

That team took a first step toward that vision, building an internal top-down view of most of the product’s content, annotated with system metadata. That “All Screens” view showed the value to troubleshooting of being able to see in one place the presentation, screen flows, and rule information that could be surfaced. And it yielded learnings about how quickly that information load becomes overwhelming. 

The same use case exists for today’s IRS software products aimed at helping taxpayers with difficult calculations like tax withholding estimation or eligibility for tax credits.  

This document describes the Taxpert tool suite (a portmanteau for the “tax expert” interface). This is internal tooling that builds on previous versions like All Screens and the Tax Withholding Estimator’s Audit Mode. This version provides several new task-focused views and interactions that expand testing support while addressing the information load issue.

This document describes the problem to be solved, this team’s design vision, discovery research, choices made for this release, and possibilities for the future.

## Design rationale
The system is the source of truth. What if anybody on the team could point at it and ask, “What’s this doing and why?”

We believe people rarely start understanding a complex system by reading documentation. They begin with the system itself and with questions.
- “Why is this being shown?” 
- “How did we get this result?” 
- “What else could change if I change this rule or move this screen?”

Our vision for Taxpert has evolved over time and benefitted from research over a period of years, but it has always focused on the notion of inquiry first. We aim to support inquiry via the product experience to help teams easily locate and inspect content, facts, rules, and behaviors. Taxpert is designed as a self-serve tool for people to answer questions while building deeper system understanding as they go.

But beyond just one person’s understanding, we envision Taxpert as a mediator of cross-discipline collaboration, giving domain experts, designers, testers, and engineers a common point of reference and shared language for discussing implementation with precision. That influenced the vision for the tool as one that answers different kinds of questions for different kinds of users.

## What this release contains
To support both top-down and bottom-up inquiry, this release of Taxpert provides two complementary workspaces:
- **Experience Explorer**, for inspecting facts and flow rules through the lens of the product experience, and  
- **Fact Explorer**, for inspecting facts, flow, and connections between them using a graph visualization. 

### Experience Explorer
The Experience Explorer workspace offers three task-focused modes:
- **Product experience mode**, for inspecting a scenario through the same experience end-users have
- **Path mode**, for inspecting a scenario in a flattened, bird’s-eye view
- **Browse All mode**, for examining all contents, static, dynamic, or conditionally hidden

#### Product Experience mode
Product Experience mode allows exploration of the product as an end user. It allows both manual inputs and preset scenarios plus offers inspection tools. This mode is best suited to UI and path exploration, answering questions like:
- “What will the user see?”
- “Why is this item shown?” 
- “What fact is collected and why?”
- “How was this outcome reached?” 

#### Path Mode
Path Mode is similar to the product experience mode but is aimed at a different need: seeing one path, end to end. It provides a bird’s eye view of the scenario that makes tracing a path across screens possible. Path Mode is particularly valuable for designing and testing coherent user experiences, branching logic, spotting missing tests, and testing different year-based rulesets. 

Like the Product Experience mode, it allows both manual inputs and preset scenarios plus offers inspection tools. 

#### Browse All
Browse All reveals the entire product as a visual corpus. A refinement of the “All Screens” view, users can see every piece of content, every question, field, and output in one place with minimal noise and nothing conditionally hidden. This allows discovery, comparison, content consistency and localization QA without requiring time-consuming navigation through every possible scenario.

This mode is most useful for seeing content presentation without needing to first know how to force it to appear in the user experience.

### Fact Explorer
Where Experience Explorer is organized around the user experience, Fact Explorer is organized around the underlying data model.

Fact Explorer is an experimental visualization of the interconnected network of facts, flow elements, and relationships. It’s intended to afford exploration of the underlying rules and system structure and to show how tests expressed in plain language in the user interface connect to underlying facts, and how those facts connect to yet others.

This is an experiment in data visualization because the graph becomes very complex, very quickly, even beyond the first one or two connections. Fact Explorer addresses this with tools for searching, filtering, and narrowing views of the graph, like by section and preset scenario. Users can focus on facts, flow elements, connections, paths, or a combination. Fact Explorer is particularly valuable for understanding structure and rules, tracing derived facts, dependencies, and reasoning about relationships that span multiple sections of the product. We anticipate usability testing and iterating more on the experiments in this workspace because we believe it holds a lot of promise as a tool for understanding how tax rules that build upon each other are handled in the system.

### Inspection tools
Inspection is the primary mechanism allowing users to move naturally from spotting something the product is doing to understanding why it’s doing it.

The inspection tool is an experiment in reducing the information load of system annotation presented through the product UI. It uses a progressive disclosure model to control the sheer volume of what’s valuable to see in that view.

In Experience Explorer, users can click page elements like questions and messages wherever they’re encountered and inspect their associated metadata, like what fact is being written to, how a result was calculated, the conditions under which an item is shown to users, and more. This means testers can more easily investigate behaviors and outcomes in the product and troubleshoot with precision, making it easier to communicate issues to engineering and identify the necessary corrections.

Rather than navigating source code or disconnected documentation, the troubleshooting task remains grounded in the context of the product, right where the issue was first recognized and with added assurance of reliable mapping of presentation element to system fact.

#### Example
While checking the EITC Assistant and clicking through different combinations of responses, a team tester notices that the question “Was your main home in the United States for more than half of the year?” appears on screen in one scenario but not another. They don’t recall every exception in EITC rules off the top of their head, they just want to check the behavior is correct so they can continue with their main QA task. 

Instead of calling on an engineer or searching documentation, they use Taxpert to inspect the question directly. They click to inspect and it tells them about:
- the fact that stores the taxpayer's response to the question
- the conditions under which the question is shown
- the conditional phrasing of the question, including the fact that controls it and that fact’s current value

The tester now knows why the question appeared and under which conditions it remains hidden. This lets them quickly match the behavior to the tax rule without interrupting their task or leaving the product to investigate. What used to require searching through documentation or getting help from engineering is now readily understandable through an inspectable interface.

## This release and the future

### Phase I: Reveal
This MVP release focuses on making the existing system understandable. User research showed that teams struggled most with maintaining a comprehensive mental model of the encoded tax law because of its scale and complexity. Because tax law is expressed as questions and values in the user interface, not recognizable citations, it led to common questions like
- “Why are we asking this question?”
- “What went into this value?”
- “What would change downstream if we moved or changed this flow of questions?”

Revealing relationships between the built experience and the underlying facts provides a foundation for future tooling possibilities. But the first step was to experiment with revealing the existing information in a usable way.

### Phase II: Enrich
We hypothesize that more information can be successfully layered onto the established framework. Future releases may focus on exposing tax law citations, decision records, machine-generated explanations, and other team and contextual knowledge.

### Phase III: Create
A far future explores Taxpert-mediated authoring concepts, workflow management, and change impact support.

## Design principles

### Create shared understanding
People can’t safely change a system they don’t understand and they can’t easily work together without a common understanding of a problem or a common language for naming and describing it. Addressing issues of understanding and shared reference is Taxpert’s top goal.

### Reveal rather than recreate
The information needed to explain system behavior already exists. Rather than representing it in external diagrams, spreadsheets, or documentation, Taxpert seeks to make the system itself inspectable through its product UI.

### Keep investigation in context
Taxpert offers investigation grounded in the product experience because that’s the place where issues in the flow are most commonly discovered and where mapping facts to flow is most challenging.

### One source of truth, multiple perspectives
Designers, domain experts, engineers, testers, and other contributors view the same system through different lenses. Taxpert presents multiple perspectives on the same underlying representation so each discipline can investigate using concepts meaningful to them while collaborating around a shared source of truth.

### Support progressive disclosure
Understanding complex systems develops over time. Taxpert reveals complexity incrementally, allowing users to stop when they have enough information for the task at hand or continue exploring as their questions evolve.

## Audience, roles, and governance
Taxpert is an internal tool built to help IRS teams deliver accurate products for taxpayers. For IRS’s use of this tool suite, the users are expected to be engineers, designers, testers, and domain experts. We believe Taxpert is generalizable beyond that scope, and its audience would change accordingly to be any team using the fact graph and this tooling for delivery.

**Engineers.** Engineers build infrastructure, deploy code, maintain software, optimize performance and ensure software scalability. They create the software end users see as well as the behind-the-scenes complex engine that powers the software. They deploy Taxpert and configure it for team use.

**Designers.** Designers devise the end-to-end product experience, including the tax logic and branching flows. They write content and ensure the visual experience is cohesive. They also manually test tax accuracy and the coherence of the human/system conversation. 

**Domain experts.** In the IRS use case, domain or subject matter experts (SMEs) are most often Treasury and IRS lawyers who participate in design, manual testing, and even code review to ensure the final product is accurate and reliable for taxpayers. There are other domain experts who contribute similarly, including economists, privacy officers, and many more roles. Depending on the use of this tool suite, the domain experts are the people who best know the subject matter.

## Roles and governance
The MVP version of Taxpert has a simple governance structure: Engineering is the governing role. Taxpert doesn’t support individual accounts or logins, and the suite is currently accessed locally. Immediate next plans include making it available in a dev or testing environment for the team. There are no immediate plans to support individual accounts or additional administration roles, but changes to governance may be implied by far future plans like workflow capabilities and authoring.

## Summary of research
This release was supported by research.

Research starting with IRS Direct File and continuing through the most recent release of the IRS Tax Withholding Estimator (TWE) suggests an integrated human-readable inspection layer as broadly useful for IRS fact-graph-based products with similar complexity issues: statute-based logic, high-stakes accuracy validation needs, and individually held system and domain knowledge. Although TWE is smaller and focused on calculation modeling rather than return preparation, building and validating it reproduced many of the same information needs identified when building and validating IRS Direct File.

Participants described essential system and domain knowledge as fragmented across the built interface, team artifacts, external sources, and individual team members. The problem varied by task and role, but it consistently slowed a contributor’s ability to understand what the product was doing, why, and what would happen if they made a change to existing logic. 

These findings informed the scope of this Taxpert release by prioritizing a reusable legibility layer that wraps a product, provides different views aimed at revealing the content within it, tools for inspecting and tracking underlying facts, and a set of scenario-modeling tools for understanding and validating system behavior. Other needs identified during research inform future phases of the roadmap.

Next steps are to usability test and evaluate the effectiveness of this toolset during upcoming update-and-validate cycles.

## Scope
**Goal.** The goal of this research was to learn from the people closest to the work of delivering accurate, usable, IRS fact-graph-based products and to use the pain points, ideas, and insights uncovered to bring greater resolution to product vision, feature definition and prioritization. We used it to make decisions about the contents and form of this release.

Going into this research, we hypothesized that
- the task of validating the TWE involved the same information needs we had observed in foundational research on this problem during IRS Direct File seasons 1 and 2;
- both technical and nontechnical contributors benefit from observability of system rules but may need different presentations of information; and
- human-readable and traceable system rules explicitly tied to the end-user experience being validated represent a key gap in our testing toolsets for these kinds of products

The research supported these hypotheses, refined our understanding of the problem space, and informed feature prioritization for this release.

**Method.** This research took place in fall 2025 to spring 2026 and relied on semi-structured individual and group conversations with current or former IRS and Treasury employees with direct experience building or validating complex statute-based products (3 engineers and 4 tax law subject matter experts/testers). All conversations were held remotely via video conference. Unless otherwise noted, participant quotations throughout this report are drawn from these interviews.

**Limitations.** This round of research didn’t seek to evaluate usability of this release’s toolset or to measure toolset effectiveness.

**Prior related research.** Following IRS Direct File’s first season in 2024, research established the initial vision for a shared, screen-level system artifact for making that complex system more legible teamwide. Group and individual conversations with SMEs, the product team, and the Customer Service Representative (CSR) team that supported IRS Direct File focused on uncovering ways of working and what information was needed across disciplines to jointly build, validate, and support taxpayers through their experience. That research is not included in this summary but is foundational to our understanding of the problem space and to product vision.

## Findings

### Finding 1
**Building and validating statute-based products becomes disproportionately more difficult as systems grow.** 
Participants consistently described this pattern across interviews. The examples that follow illustrate how this challenge manifested in day-to-day work and why existing artifacts were insufficient for supporting shared understanding. 

### Finding 2
**Cross-functional teams lacked a shared way to reason about the system.** 
It was hard and error-prone to discuss and reason together about what the system was doing and why because each discipline had a different piece of the overall puzzle but nothing they could collectively reference and understand.

Participants described difficulty establishing a common language across disciplines.
> “How do you bring the engineering and design languages closer together so were [sic] not introducing more bugs from that translation…. How do we have a discussion in the context of an artifact and have that discussion between Engineering and Design?” — Participant 3 (Engineer)

> “The power of it is we're all able to see the thing. Now we need to see more of it and see it in more ways that are useful to more people.” — Participant 3 (Engineer)

Participants also described a gap in current test processes for readily understanding why facts or rules were implemented a certain way in the built product (a result of scope decisions, usability test findings, tax law citations, IRS procedures, etc.) 
> “XML is not a great place to put like 3 paragraphs of discussion about how a decision was made.” — Participant 6 (Tax domain expert)

### Finding 3
**Different roles needed different kinds of visibility into the same system.** 
Participants described the ways in which it was difficult to understand and reason about complex systems – and those challenges differed across the roles responsible for designing, building, and validating them (engineers, designers, SMEs, testers).

#### Testers
Testers described needing better visibility into both the rules driving the product and the intermediate system state needed to validate it.
- Non-SME testers struggled to validate the built experience because it requires them to recognize and understand domain rules that aren’t directly referenced. 
- Testers could not always identify an underlying fact by name in the UI, which made it impossible to ask about with precision. Even with a complete list of fact names, it was difficult to determine where a given fact was used in the experience. Additionally, it was hard to tell whether facts listed were placeholders, duplicates, had same-sounding names, or weren’t used at all. 
  > “Sometimes it was hard to know where a particular fact would be applied in TWE and where it wouldn’t.” — Participant 5 (Tax domain expert)
- Testers needed visibility into intermediate values, parameters, and hidden system states. 
- Testers needed to save, load, modify, and replay scenarios instead of repeatedly traversing the product from the beginning. 
- Testers found it easier to validate calculations than to validate system behavior (branching logic, dependencies, question visibility). 
  > “Facts are a little easier [than Flow]; what you arrive at is a number, not a webpage.” — Participant 4 (Engineer)

#### Engineers
Engineers focused on understanding relationships across the system and anticipating the downstream effects of changes.
> “[System rule] visualization is desperately valuable and necessary for engineering, and the fact that it brings understanding beyond engineering is a bonus ha-ha” — Participant 4 (Engineer)
- Engineers were cognizant there were “corners for things to hide in” usually related to branching logic and edge cases, but enumerating all possible fact graph combinations is prohibitive. Making the flow linear reduces but does not eliminate hidden failure modes. 
  > “That’s where bugs live, where you can’t see if things interact in a way we didn’t anticipate or test.” — Participant 4 (Engineer)
- Engineers described struggling to reason about interdependent system layers, fact and flow, and how difficult it was to anticipate downstream consequences of changes. Branching logic, “the flow” was particularly difficult.
- New engineers on the team, faced with a huge codebase and incomplete mental model, “were afraid to touch [the fact graph] and flow” — Participant 2 (Engineer). Knowledge was concentrated among people who designed the system (technical and nontechnical), making onboarding and continuity dependent on those individuals.

#### SMEs
SMEs described needing implementation details presented in forms that aligned with how they understood tax rules.
- SMEs struggled to connect logic artifacts like human-readable XML to their understanding of tax rules and to the user experience where the rules are exercised.
- Date-dependent testing scenarios required a VM and system-date workarounds.

### Finding 4
**Limited observability into system behavior slowed validation and reduced testing effectiveness.** 
- The lack of visibility into facts, flow and system behavior creates testing and modification bottlenecks.  
- Engineering participants saw a high level of value in surfacing facts, origin, and relationships in context of a screen/page. 
- The time cost of validation became a major factor for the SMEs testing completeness.
  > When asked how they determined they were done testing the product, one SME tester said “The clock.” — Participant 6 (Tax domain expert)

### Finding 5
**Teams recreated knowledge outside the product because the information they needed wasn’t accessible in context.**
Participants described building their own processes (side-saddle with developers, review console logs) and tools (spreadsheets, XML translations, ad hoc utilities like dependency-chain or completeness checkers) to reconstruct knowledge that exists in the system. These artifacts often became point-in-time snapshots that contributors augmented with the context or format they needed to complete their work.

Testers used translators, spreadsheets, and self-generated artifacts to help them test. Because those artifacts were separate from the product, they also needed to be recreated or updated as the underlying product changed. 

As a result, institutional knowledge accumulated in these external artifacts rather than alongside the system itself. 
> “Just banging the head against the wall until we found out. At a certain point you just had brute force.” — Participant 5 (Tax domain expert)

> “Trying to follow—grepping the XML file to figure out what is the actual path of where something is being used.” — Participant 6 (Tax domain expert)

## Product implications
This research suggests a reusable toolset integrated with IRS fact-graph-based products to support collaboration and efficient, accurate validation. This release responds to many of these findings and future phases will address more. Rather than addressing isolated pain points, the findings point to four complementary capabilities.

### Increase system legibility
Help contributors understand the product by revealing the information already embedded within it.
- Integrate as an inspection layer over the product itself rather than relying on models or snapshots
- Reveal facts, rules, relationships, and rationale in the context of the product experience, making them discoverable, traceable, and understandable across disciplines
- Provide purpose-built views of the product experience, facts, and flow for different contributors

### Support cross-functional collaboration
Build shared understanding across disciplines.
- Enable testers to interpret rules and values without reading code
- Provide shared context and shared representation of logic to facilitate cross-team collaboration

### Improve validation workflows
Reduce the effort required to build, execute, and repeat validation activities.
- Support scenario modeling, saving, loading, and manually exploring different fact patterns
- Enable self-serve configuration of test conditions like date simulation

### Support system evolution
Help teams understand the downstream effects of proposed changes.
- Support modeling and evaluating downstream impacts of proposed changes, flagging flow issues like invalid/unfulfillable conditions
- Identify flow issues such as invalid or unfulfillable conditions before implementation

## Next steps
The current release addresses many of the needs identified in this research, but additional evaluation is needed to understand how well the toolset supports real-world update and validation work.

Recommended research steps include:
- **Evaluative research.** Usability test current interfaces, having participants complete core update and validation tasks.
- **Product fit research.** Study how the toolset supports upcoming tax-year updates efforts for the EITC Assistant and the Tax Withholding Estimator.

Together, these studies will help determine where the current toolset succeeds in supporting real update and validation work and where additional capabilities or refinements are needed.
