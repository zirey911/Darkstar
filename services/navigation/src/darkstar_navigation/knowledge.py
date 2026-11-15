"""Small lexical retrieval over reviewed passages and existing historical references."""

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).parent
STOP = set(
    "the a an is are was were what how would could should do does did we i my me "
    "on in at to for of and or with it this that about mars tell please".split()
)


def tokens(text):
    return set(re.findall(r"[a-z]+", text.lower())) - STOP


def corpus():
    docs = json.loads((ROOT / "knowledge.json").read_text())
    references = json.loads((ROOT / "environment_reference.json").read_text())
    for r in references["records"]:
        docs.append(
            {
                "title": r["title"],
                "url": r["source"],
                "kind": r["kind"],
                "topics": (
                    {
                        "rems": "weather atmosphere temperature pressure ground",
                        "meda": "weather atmosphere temperature pressure Jezero",
                        "mastcam-tau": "dust aerosol optical depth uncertainty",
                        "rad": "radiation ionizing cosmic rays shielding dose",
                    }[r["id"]]
                ),
                "text": json.dumps(
                    {
                        k: r[k]
                        for k in ("site", "date", "coverage", "resolution", "uncertainty", "values")
                    },
                    ensure_ascii=False,
                )
                + " Historical reference only. No current local "
                "measurement, forecast, environmental model or personal exposure estimate. "
                "Snapshot retrieved " + references["retrieved_on"],
            }
        )
    return docs


def retrieve(question, previous="", limit=4):
    docs = corpus()
    query = tokens(question)
    history = tokens(previous)
    terms = [tokens(d["title"] + " " + d["topics"] + " " + d["text"]) for d in docs]

    def score(index):
        words = terms[index]
        return sum(
            (
                5
                if word in query
                and word in tokens(docs[index]["title"] + " " + docs[index]["topics"])
                else 2
                if word in query
                else 0.25
            )
            * math.log(1 + len(docs) / sum(word in t for t in terms))
            for word in (query | history) & words
        )

    ranked = sorted(enumerate(docs), key=lambda pair: score(pair[0]), reverse=True)
    return [
        {"id": f"S{i + 1}", **doc}
        for i, (index, doc) in enumerate(ranked[:limit])
        if score(index) > 0
    ]
