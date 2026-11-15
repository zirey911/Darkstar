"""Dated NASA/PDS context. No spatial extrapolation, forecast or safety scoring."""

import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from darkstar_navigation.guide_context import capture
from darkstar_navigation.terrain import Coordinate, distance

router = APIRouter(prefix="/terrain")
REFERENCE = Path(__file__).with_name("environment_reference.json")


class Location(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Literal["Selected location", "Habitat", "Science destination"]
    coordinate: Coordinate


class EnvironmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locations: list[Location] = Field(min_length=1, max_length=2)


@router.post("/environment")
@capture("environment")
def environment(request: EnvironmentRequest):
    try:
        reference = json.loads(REFERENCE.read_text())
        records = reference["records"]
        if not isinstance(records, list) or not records:
            raise ValueError("No reference records")
    except (OSError, ValueError, KeyError):
        raise HTTPException(503, "Historical environmental references unavailable.") from None
    locations = []
    for location in request.locations:
        point = location.coordinate
        locations.append(
            {
                **location.model_dump(),
                "current_conditions": "Unavailable — no measurements or forecast "
                "for this point/time.",
                "historical_local_measurements": "Unavailable — sample positions are not resolved.",
                "reference_distances_km": {
                    record["id"]: round(
                        distance(
                            point.lat,
                            point.lon,
                            record["reference_centre"]["lat"],
                            record["reference_centre"]["lon"],
                        )
                        / 1000,
                        1,
                    )
                    for record in records
                },
            }
        )
    return {
        "locations": locations,
        "references": records,
        "retrieved_on": reference["retrieved_on"],
        "modeled_estimates": "Not provided; no environmental model or interpolation is applied.",
        "warnings": [
            {
                "category": "Temperature",
                "text": "Cold and large temperature changes are thermal "
                "design concerns. Local mission-time air and ground temperatures are unavailable.",
                "source": "https://science.nasa.gov/mars/facts/",
            },
            {
                "category": "Atmosphere",
                "text": "Mars has a thin, mostly CO₂ atmosphere. "
                "Pressurization and breathing support are required; "
                "these data do not validate a suit.",
                "source": "https://science.nasa.gov/mars/facts/",
            },
            {
                "category": "Dust",
                "text": "Dust can affect visibility and equipment. Local storm, "
                "surface dust and contamination conditions are unknown; "
                "optical depth is not toxicity.",
                "source": "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/"
                "MARS/curiosity/atmospheric_opacity.html",
            },
            {
                "category": "Radiation",
                "text": "Ionizing radiation and solar-event exposure require "
                "assessment. No local dose, solar-event warning or shielding model is available.",
                "source": "https://science.nasa.gov/resource/radiation-measurements-on-mars/",
            },
        ],
        "mission_effect": "Environmental assessment incomplete. Budget compliance is not EVA "
        "safety approval. Routes, durations and resource calculations are unchanged.",
    }
