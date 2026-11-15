"""Educational EVA budgets around existing terrain routes, not astronaut physiology."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from darkstar_navigation.guide_context import capture
from darkstar_navigation.terrain import Coordinate, RouteRequest, RoverProfile, calculate_route

router = APIRouter(prefix="/terrain")


class MarswalkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: Coordinate
    end: Coordinate
    objective: str = Field(min_length=1, max_length=300)
    science_minutes: float = Field(default=30, ge=0, le=1440)
    speed_kmh: float = Field(default=2, gt=0, le=10)
    max_slope_deg: float = Field(default=15, gt=0, le=35)
    duration_limit_minutes: float = Field(default=240, gt=0, le=1440)
    oxygen_kg: float = Field(default=1, gt=0, le=100)
    power_wh: float = Field(default=1000, gt=0, le=100000)
    reserve_fraction: float = Field(default=0.25, ge=0, le=0.9)
    travel_oxygen_kg_h: float = Field(default=0.15, gt=0, le=10)
    science_oxygen_kg_h: float = Field(default=0.1, gt=0, le=10)
    travel_power_w: float = Field(default=250, gt=0, le=10000)
    science_power_w: float = Field(default=200, gt=0, le=10000)


@router.post("/marswalk")
@capture("marswalk")
def marswalk(request: MarswalkRequest):
    if not request.objective.strip():
        raise HTTPException(422, "Enter a science objective.")
    legs = []
    warnings = []
    for label, start, end in (
        ("Outbound", request.start, request.end),
        ("Return", request.end, request.start),
    ):
        try:
            raw = calculate_route(
                RouteRequest(
                    start=start,
                    end=end,
                    max_slope_deg=request.max_slope_deg,
                    rover=RoverProfile(max_slope_deg=request.max_slope_deg),
                    optimization="distance",
                    compare=False,
                )
            )
        except HTTPException as exc:
            raise HTTPException(
                exc.status_code, f"{label} route unavailable: {exc.detail}"
            ) from exc
        # Rover energy output is deliberately excluded: it does not model walking.
        leg = {
            key: raw[key]
            for key in (
                "profile",
                "distance_m",
                "ascent_m",
                "descent_m",
                "dataset",
                "dataset_id",
                "nominal_cell_m",
                "snapping_m",
                "max_terrain_slope_deg",
                "fallback_reason",
            )
        }
        connections = sum(leg["snapping_m"].values())
        leg["budget_distance_m"] = leg["distance_m"] + connections
        leg["travel_minutes"] = leg["budget_distance_m"] / (request.speed_kmh * 1000) * 60
        leg["name"] = label
        legs.append(leg)
        if leg["fallback_reason"]:
            warnings.append(f"{label}: {leg['fallback_reason']}")
    travel_hours = sum(leg["travel_minutes"] for leg in legs) / 60
    science_hours = request.science_minutes / 60
    phases = [
        {
            "name": leg["name"],
            "minutes": leg["travel_minutes"],
            "oxygen_kg": leg["travel_minutes"] / 60 * request.travel_oxygen_kg_h,
            "power_wh": leg["travel_minutes"] / 60 * request.travel_power_w,
        }
        for leg in legs
    ]
    phases.insert(
        1,
        {
            "name": "Science",
            "minutes": request.science_minutes,
            "oxygen_kg": science_hours * request.science_oxygen_kg_h,
            "power_wh": science_hours * request.science_power_w,
        },
    )
    resources = {}
    for key, capacity in (("oxygen_kg", request.oxygen_kg), ("power_wh", request.power_wh)):
        used = sum(phase[key] for phase in phases)
        resources[key] = {
            "used": used,
            "capacity": capacity,
            "reserve": capacity * request.reserve_fraction,
            "required_capacity": used / (1 - request.reserve_fraction),
            "remaining": capacity - used,
            "sufficient": used <= capacity * (1 - request.reserve_fraction),
        }
        if not resources[key]["sufficient"]:
            warnings.append(f"Insufficient {key}: planned use would consume the emergency reserve.")
    total_minutes = (travel_hours + science_hours) * 60
    within_duration = total_minutes <= request.duration_limit_minutes
    if not within_duration:
        warnings.append("Total EVA duration exceeds the configured mission limit.")
    warnings.append(
        "Endpoints snap to DEM cells. Straight-line connection distances are budgeted both ways "
        "but are not terrain-validated; local access must be checked."
    )
    warnings.append(
        "Sub-cell hazards are unresolved. This is not a certified or safe-to-execute EVA."
    )
    return {
        "objective": request.objective.strip(),
        "legs": legs,
        "phases": phases,
        "total_minutes": total_minutes,
        "distance_m": sum(x["distance_m"] for x in legs),
        "budget_distance_m": sum(x["budget_distance_m"] for x in legs),
        "resources": resources,
        "within_duration": within_duration,
        "within_budgets": within_duration and all(x["sufficient"] for x in resources.values()),
        "warnings": warnings,
        "assumptions": request.model_dump(),
    }
