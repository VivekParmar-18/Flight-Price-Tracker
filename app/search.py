import logging
from fli.models import (
    Airline, Airport, FlightSearchFilters, FlightSegment,
    MaxStops, PassengerInfo, SeatType, SortBy, TripType,
)
from fli.search import SearchFlights

logger = logging.getLogger(__name__)

_SEAT_MAP = {
    'ECONOMY': SeatType.ECONOMY,
    'PREMIUM_ECONOMY': SeatType.PREMIUM_ECONOMY,
    'BUSINESS': SeatType.BUSINESS,
    'FIRST': SeatType.FIRST,
}


def _airline(code: str) -> Airline | None:
    try:
        return Airline[code.upper()]
    except KeyError:
        logger.warning("Unknown airline code: %s", code)
        return None


def _airport(code: str) -> Airport | None:
    try:
        return Airport[code.upper()]
    except KeyError:
        logger.warning("Unknown airport code: %s", code)
        return None


def search_route(origin: str, destination: str, departure_date: str,
                 adults: int = 1, non_stop_only: bool = False,
                 airlines: list[str] | None = None,
                 seat_type: str = 'ECONOMY',
                 currency: str | None = None) -> dict | None:
    dep = _airport(origin)
    arr = _airport(destination)
    if not dep or not arr:
        return None

    airline_enums = None
    if airlines:
        airline_enums = [a for code in airlines if (a := _airline(code))]
        if not airline_enums:
            airline_enums = None

    filters = FlightSearchFilters(
        trip_type=TripType.ONE_WAY,
        passenger_info=PassengerInfo(adults=adults),
        flight_segments=[
            FlightSegment(
                departure_airport=[[dep, 0]],
                arrival_airport=[[arr, 0]],
                travel_date=departure_date,
            )
        ],
        seat_type=_SEAT_MAP.get(seat_type, SeatType.ECONOMY),
        stops=MaxStops.NON_STOP if non_stop_only else MaxStops.ANY,
        sort_by=SortBy.CHEAPEST,
        airlines=airline_enums,
    )

    try:
        results = SearchFlights().search(filters, currency=currency)
    except Exception as e:
        logger.error("fli search error for %s→%s on %s: %s", origin, destination, departure_date, e)
        return None

    if not results:
        return None

    best = results[0]
    legs = []
    for leg in (best.legs or []):
        legs.append({
            'airline': leg.airline.value if hasattr(leg.airline, 'value') else str(leg.airline),
            'flight_number': leg.flight_number,
            'departure_airport': leg.departure_airport.value if hasattr(leg.departure_airport, 'value') else str(leg.departure_airport),
            'arrival_airport': leg.arrival_airport.value if hasattr(leg.arrival_airport, 'value') else str(leg.arrival_airport),
            'departure_time': str(leg.departure_datetime),
            'arrival_time': str(leg.arrival_datetime),
            'duration': getattr(leg, 'duration', None),
        })

    res_currency = getattr(best, 'currency', None) or currency or 'USD'
    return {
        'price': best.price,
        'currency': res_currency,
        'duration': best.duration,
        'stops': best.stops,
        'legs': legs,
    }
