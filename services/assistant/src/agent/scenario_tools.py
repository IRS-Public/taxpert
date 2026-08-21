"""LiteLLM tool-calling schema definitions for the scenario-generation agent."""

from __future__ import annotations

SCENARIO_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_scenarios",
            "description": (
                "List every existing scenario file with the dimensions decoded from its "
                "filename (eligibility, filing status, marital, tax year, qualifying-child "
                "count, income). Call this first to find the nearest existing scenario to "
                "clone as a known-good template."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_scenario",
            "description": (
                "Return the raw serialized fact-graph JSON of one existing scenario. Use "
                "the nearest match from list_scenarios as a template: copy it, then mutate "
                "only the values that must change. Preserve every $type wrapper and enum "
                "enumOptionsPath verbatim — that is what keeps the graph loadable."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Exact scenario filename, e.g. 'single_2023_1tp_0qc_17639.json'",
                    }
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "identify_facts",
            "description": (
                "Search the EITC fact dictionary for fact paths by keyword. Returns each "
                "fact's path, type, whether it is writable, and its dependencies. Use this "
                "to find the writable paths to set (a scenario may only set writable facts) "
                "and to discover enum option paths when building a scenario from scratch."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Keywords or a fact path to search for "
                            "(e.g. 'filing status', 'qualifying child age', '/jobsIncomeTotal')"
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
            "name": "search_flow",
            "description": (
                "Keyword search over the Flow XML (the questionnaire pages). Returns flow "
                'snippets mentioning the query, including knockouts (fg-alert knockout="true") '
                "and the facts they gate on. Use this to choose the right disqualifier when the "
                "request asks for a disqualifying scenario."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Keywords to search the flow for "
                            "(e.g. 'investment income', 'knockout age', 'foreign earned income')"
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
                "Search indexed IRS publications for guidance to ground a disqualification "
                "or threshold choice. Optional — skip it for routine scenarios."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language query to search IRS publications",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_scenario",
            "description": (
                "Deliver the finished scenario. This is the ONLY way to end the task. You do "
                "NOT write the whole fact graph: you pick the nearest existing scenario as the "
                "base, and the backend starts from that known-good graph and applies your "
                "overrides on top, then loads it via GraphFactory.fromJSON. Keep overrides "
                "small — only the facts that must differ from the base."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "base_filename": {
                        "type": "string",
                        "description": (
                            "The EXACT filename of the closest existing scenario from "
                            "list_scenarios to start from, e.g. 'dq_mfs_2024_1tp_3qcs_59899.json'. "
                            "Choose one whose filing status and qualifying-child count match the "
                            "request; the backend clones it and applies your overrides."
                        ),
                    },
                    "overrides": {
                        "type": "array",
                        "description": (
                            "Facts to change relative to the base. Often empty when the base "
                            "already matches. Each item sets one writable fact."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Writable fact path, e.g. /jobsIncomeTotal",
                                },
                                "wrapper": {
                                    "type": "object",
                                    "description": (
                                        'A single wrapper: {"$type": <Wrapper>, "item": <value>}. '
                                        "DollarWrapper item is a string like '250000.00'; "
                                        "BooleanWrapper item is true/false; IntWrapper item is an "
                                        'int; EnumWrapper item is {"value": ..., '
                                        '"enumOptionsPath": ...}; CollectionWrapper item is '
                                        '{"items": [<uuid>, ...]}.'
                                    ),
                                },
                            },
                            "required": ["path", "wrapper"],
                        },
                    },
                    "description": {
                        "type": "string",
                        "description": (
                            "One short paragraph describing the scenario in plain language, "
                            "naming any active knockout/disqualifier and the decisive facts."
                        ),
                    },
                    "filename": {
                        "type": "string",
                        "description": (
                            "Output filename following the convention "
                            "[dq_]<fs>[_<marital>]_<year>_1tp_<n>qcs_<income>.json, e.g. "
                            "'dq_mfs_2024_1tp_3qcs_250000.json'. <fs> is one of "
                            "single/hoh/mfs/qss/mfj; include _married/_unmarried only for hoh."
                        ),
                    },
                },
                "required": ["base_filename", "description", "filename"],
            },
        },
    },
]
