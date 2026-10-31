"""
Airport search helper providing fast IATA code and name matching with major city aliases.
"""
from fli.models import Airport, Airline

# Popular city to IATA code mappings to ensure instant search by city name
CITY_ALIASES = {
    'toronto': ['YYZ', 'YTZ'],
    'vancouver': ['YVR'],
    'montreal': ['YUL'],
    'calgary': ['YYC'],
    'edmonton': ['YEG'],
    'ottawa': ['YOW'],
    'ahmedabad': ['AMD'],
    'delhi': ['DEL'],
    'new delhi': ['DEL'],
    'mumbai': ['BOM'],
    'bombay': ['BOM'],
    'bangalore': ['BLR'],
    'bengaluru': ['BLR'],
    'hyderabad': ['HYD'],
    'chennai': ['MAA'],
    'madras': ['MAA'],
    'kolkata': ['CCU'],
    'calcutta': ['CCU'],
    'amritsar': ['ATQ'],
    'kochi': ['COK'],
    'cochin': ['COK'],
    'goa': ['GOI', 'GOX'],
    'pune': ['PNQ'],
    'jaipur': ['JAI'],
    'lucknow': ['LKO'],
    'chandigarh': ['IXC'],
    'london': ['LHR', 'LGW', 'STN', 'LCY', 'LTN'],
    'new york': ['JFK', 'EWR', 'LGA'],
    'nyc': ['JFK', 'EWR', 'LGA'],
    'los angeles': ['LAX'],
    'san francisco': ['SFO'],
    'chicago': ['ORD', 'MDW'],
    'dubai': ['DXB', 'DWC'],
    'doha': ['DOH'],
    'singapore': ['SIN'],
    'tokyo': ['HND', 'NRT'],
    'paris': ['CDG', 'ORY'],
    'frankfurt': ['FRA'],
    'amsterdam': ['AMS'],
    'sydney': ['SYD'],
    'melbourne': ['MEL'],
    'bangkok': ['BKK', 'DMK'],
    'kuala lumpur': ['KUL'],
    'istanbul': ['IST', 'SAW'],
}

_AIRPORTS_CACHE = None
_AIRLINES_CACHE = None


def _get_airports():
    global _AIRPORTS_CACHE
    if _AIRPORTS_CACHE is None:
        _AIRPORTS_CACHE = [(a.name, a.value) for a in Airport]
    return _AIRPORTS_CACHE


def _get_airlines():
    global _AIRLINES_CACHE
    if _AIRLINES_CACHE is None:
        _AIRLINES_CACHE = [(a.name, a.value) for a in Airline]
    return _AIRLINES_CACHE


def search_airports(query: str, limit: int = 10) -> list[dict]:
    if not query:
        return []
    q = query.strip().lower()
    results = []
    seen = set()

    # 1. Check city aliases first
    for city, codes in CITY_ALIASES.items():
        if q == city or q in city or city in q:
            for code in codes:
                if code not in seen:
                    try:
                        name = Airport[code].value
                        results.append({'code': code, 'name': name, 'city': city.title()})
                        seen.add(code)
                    except KeyError:
                        pass

    # 2. Exact code match
    q_upper = q.upper()
    try:
        name = Airport[q_upper].value
        if q_upper not in seen:
            results.insert(0, {'code': q_upper, 'name': name})
            seen.add(q_upper)
    except KeyError:
        pass

    # 3. Search code prefix / substring and airport names
    for code, name in _get_airports():
        if len(results) >= limit:
            break
        if code in seen:
            continue
        if code.lower().startswith(q) or q in name.lower():
            results.append({'code': code, 'name': name})
            seen.add(code)

    return results[:limit]


def search_airlines(query: str, limit: int = 10) -> list[dict]:
    if not query:
        return []
    q = query.strip().lower()
    results = []
    seen = set()

    for code, name in _get_airlines():
        if len(results) >= limit:
            break
        if code in seen:
            continue
        if code.lower() == q or code.lower().startswith(q) or q in name.lower():
            results.append({'code': code, 'name': name})
            seen.add(code)

    return results[:limit]
