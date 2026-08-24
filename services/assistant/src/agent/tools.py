"""Tool schemas the chat loop passes to litellm.completion.

Descriptions here are prompt text: the model reads them, so edit them with the
same care as prompts.py. Dispatch lives in orchestrator.py.
"""

from __future__ import annotations

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "identify_facts",
            "description": (
                "Search the EITC fact dictionary to find relevant fact paths by keyword "
                "or description. Call this first to discover which fact paths are relevant."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Keywords or a fact path to search for "
                            "(e.g. 'filing status', 'qualifying child income', '/eitcEligible')"
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_rag",
            "description": (
                "Search indexed IRS publications (e.g. Publication 596) for relevant text "
                "passages and citations. Use this to ground answers in official IRS guidance. "
                "Skip this tool when the question is purely about fact-graph flow logic "
                "(facts named flowShould*, flowClickedNext*, flowConfirmation*) — those "
                "are internal page-visibility gates not covered by IRS publications."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Natural language query to search IRS publications "
                            "(e.g. 'qualifying child age requirements', 'investment income limit')"
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_final_answer",
            "description": (
                "Deliver your final answer to the SME. This is the ONLY way to end the "
                "conversation — do NOT write the answer as plain text or as any other JSON "
                "shape. Call this exactly once, after you have gathered the facts and any IRS "
                "grounding you need. The backend renders these fields into formatted Markdown, "
                "so supply structured data, not prose paragraphs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "direct_answer": {
                        "type": "string",
                        "description": (
                            "One-sentence direct answer to the SME's question. Required. "
                            "State the outcome and the single most decisive reason."
                        ),
                    },
                    "reasoning_trace": {
                        "type": "array",
                        "description": (
                            "The dependency chain that produced the outcome, most decisive "
                            "first. One entry per relevant fact."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "fact": {
                                    "type": "string",
                                    "description": "Exact fact path, e.g. /eitcEligible/filingStatus",
                                },
                                "value": {
                                    "type": "string",
                                    "description": "Current value of the fact, e.g. 'Single', 'true', or 'Incomplete'",
                                },
                                "complete": {
                                    "type": "boolean",
                                    "description": "Whether the fact's value is complete (resolved) in the fact graph",
                                },
                                "explanation": {
                                    "type": "string",
                                    "description": "Why this fact affects the outcome, in SME terms",
                                },
                            },
                            "required": ["fact", "explanation"],
                        },
                    },
                    "what_would_change": {
                        "type": "array",
                        "description": ("Writable facts an SME could change to flip the outcome."),
                        "items": {
                            "type": "object",
                            "properties": {
                                "fact": {
                                    "type": "string",
                                    "description": "Exact writable fact path",
                                },
                                "from": {
                                    "type": "string",
                                    "description": "Current value",
                                },
                                "to": {
                                    "type": "string",
                                    "description": "Value that would flip the outcome",
                                },
                                "effect": {
                                    "type": "string",
                                    "description": "What changes if this fact is changed",
                                },
                            },
                            "required": ["fact", "effect"],
                        },
                    },
                    "citations": {
                        "type": "array",
                        "description": (
                            "IRS citations supporting the answer, taken from query_rag "
                            "results — e.g. 'IRS Pub. 596, p. 12' or 'IRC § 32(c)(1)(A)'. "
                            "Only include citations you actually retrieved; omit if none apply."
                        ),
                        "items": {"type": "string"},
                    },
                },
                "required": ["direct_answer"],
            },
        },
    },
]
