import json

from conftest import HOBART, NOW, FakeFetcher, fixture

from hellotas_collector.extract import event_from_jsonld, jsonld_event_objects, links_in_text
from hellotas_collector.sources import Context, acs, aisa, ical, jsonld
from hellotas_collector.sources.page import dates_in, is_no_fetch, mentions_upcoming_date


def ctx(pages, **kwargs):
    return Context(fetcher=FakeFetcher(pages), tz=HOBART, now=NOW, **kwargs)


def test_gdg_jsonld_event():
    objs = jsonld_event_objects(fixture("gdg_event.html"))
    ev = event_from_jsonld(objs[0], "https://gdg.community.dev/e/x/", "gdg-hobart", HOBART)
    assert ev.title == "DevFest 2026: Explore AI Powered Development & Digital Analytics"  # &amp; undone
    assert ev.start.isoformat() == "2026-11-19T17:15:00+11:00"
    assert ev.end.isoformat() == "2026-11-19T18:45:00+11:00"
    assert ev.attendance == "in_person" and ev.region == "TAS"
    assert ev.free is True and ev.cost == "Free"


def test_gdg_source_prefers_the_real_banner():
    cfg = {"id": "gdg-hobart", "listing": "https://gdg.community.dev/gdg-hobart/",
           "follow": r"^https://gdg\.community\.dev/events/details/",
           "image_exclude": ["SocialSharingThumbnail"], "page_images": "/v1/gcs/platform-data-goog/events/"}
    event_url = "https://gdg.community.dev/events/details/google-gdg-hobart-presents-devfest-2026/"
    listing = f'<a href="{event_url}">DevFest</a><a href="https://gdg.community.dev/about/">About</a>'
    events = jsonld.collect(cfg, ctx({cfg["listing"]: listing, event_url: fixture("gdg_event.html")}))
    assert len(events) == 1
    assert "/events/" in events[0].images[0]
    assert not any("SocialSharingThumbnail" in u for u in events[0].images)


def test_humanitix_offset_without_colon():
    objs = jsonld_event_objects(fixture("humanitix_event.html"))
    ev = event_from_jsonld(objs[0], "https://events.humanitix.com/ict-awards-night", "x", HOBART)
    assert ev.start.isoformat() == "2026-11-09T17:30:00+11:00"
    assert ev.attendance == "in_person"
    assert "Stanley Burbury" in ev.location_name


def test_eventbrite_itemlist_is_date_only():
    objs = jsonld_event_objects(fixture("eventbrite_listing.html"))
    assert len(objs) >= 5
    ev = event_from_jsonld(objs[0], "https://www.eventbrite.com.au/d/x/", "eb", HOBART)
    assert ev.all_day is True and ev.start.hour == 0


def test_meetup_links_hidden_in_page_data():
    found = links_in_text(fixture("meetup_listing.html"), r"^https://www\.meetup\.com/sectalks-hobart/events/\d+/?$")
    assert found == ["https://www.meetup.com/sectalks-hobart/events/317249458/",
                     "https://www.meetup.com/sectalks-hobart/events/316864389/"]


def test_acs_filters_and_prices():
    cfg = {"id": "acs", "listing": "https://acs.example/list.json", "detail_url": "https://acs.example/detail.html",
           "states": ["TAS"], "exclude_types": ["Short Courses"],
           "exclude_titles": r"(?i)annual general meeting|\bAGM\b", "skip_member_only": True,
           "defaults": {"host": "ACS", "topics": ["careers"]}}
    data = json.loads(fixture("acs_events.json"))
    pages = {cfg["listing"]: json.dumps(data)}
    beyond = next(e for e in data["events"] if e["eventTitle"].startswith("Beyond Graduation"))
    pages[f"{cfg['detail_url']}?eventId={beyond['eventId']}"] = fixture("acs_detail.html")
    events = acs.collect(cfg, ctx(pages))
    titles = [e.title for e in events]
    assert any(t.startswith("How to get a job in IT Support") for t in titles)  # online: kept
    assert not any("Cybersecurity Then and Now" in t for t in titles)  # in person in QLD: dropped
    assert not any("Applied AI" in t for t in titles)  # short course: dropped
    assert not any("Annual General Meeting" in t for t in titles)  # AGM: dropped
    assert not any("Coffee With ACS NT" in t for t in titles)  # members only: dropped
    ev = next(e for e in events if e.title.startswith("Beyond Graduation"))
    assert ev.cost == "Free for ACS members · $15 for non-members"
    assert ev.start.isoformat() == "2026-12-10T18:00:00+11:00"
    assert "Alannah Grech, Student and Graduate Success Manager, for" in ev.description


def test_aisa_page_inside_one_big_form():
    ev = aisa.parse_event_page(fixture("aisa_event.html"), "https://www.aisa.org.au/Event.aspx?EventKey=OB281026",
                               "aisa", HOBART)
    assert ev is not None
    assert ev.title == "AISA Webinar: When Attackers Use AI: How defenders can respond"
    assert ev.start.isoformat() == "2026-11-25T12:00:00+11:00"
    assert ev.end.isoformat() == "2026-11-25T13:00:00+11:00"
    assert ev.online is True and ev.host == "AISA Online Branch"
    assert ev.cost == "Free for AISA members"


def test_aisa_collect_dedupes_branches():
    url = "https://www.aisa.org.au/Event.aspx?EventKey=OB281026"
    cfg = {"id": "aisa", "branches": {"Hobart": "https://a.example/hobart", "Online": "https://a.example/online"}}
    pages = {"https://a.example/hobart": fixture("aisa_listing.html"),
             "https://a.example/online": fixture("aisa_listing.html"), url: fixture("aisa_event.html")}
    c = ctx(pages)
    events = aisa.collect(cfg, c)
    assert len(events) == 1
    assert c.fetcher.asked.count(url) == 1


ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:a@test
SUMMARY:Tas ICT careers expo
DTSTART;VALUE=DATE:20261201
DTEND;VALUE=DATE:20261203
URL:https://careerify.example/events/expo
LOCATION:Hobart Function Centre
END:VEVENT
BEGIN:VEVENT
UID:b@test
SUMMARY:Cyber meetup
DTSTART;TZID=Australia/Hobart:20261112T173000
DTEND;TZID=Australia/Hobart:20261112T190000
URL:https://careerify.example/events/cyber
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
"""


def test_ical_all_day_end_is_last_day():
    events = ical.parse_calendar(ICS, "careerify", HOBART)
    expo, cyber = events
    assert expo.all_day and expo.start.isoformat() == "2026-12-01T00:00:00+11:00"
    assert expo.end.isoformat() == "2026-12-02T23:59:00+11:00"  # DTEND is exclusive
    assert cyber.start.isoformat() == "2026-11-12T17:30:00+11:00" and cyber.status == "cancelled"


def test_dates_and_no_fetch_hosts():
    assert (2026, 12, 16) in dates_in("Tuesday, 16th December 2026, 5:00PM")
    assert (2026, 11, 25) in dates_in("When 25/11/2026 12:00 PM")
    assert not mentions_upcoming_date("Held on 16 December 2025.", NOW)
    assert mentions_upcoming_date("Next one: 3 March 2027", NOW)
    assert is_no_fetch("https://www.linkedin.com/posts/someone_activity-123")
    assert not is_no_fetch("https://events.humanitix.com/x")


# -- pages read from their labelled parts (TasICT) ------------------------------------------------------------------

TASICT_FIELDS = {"title": ".event-single__title", "date": ".event-meta__date", "time": ".event-meta__time",
                 "description": ".event-single__content"}
TASICT_CFG = {"id": "tasict", "kind": "html", "trust": "high", "listing": "https://www.tasict.com.au/about/events-2/",
              "follow": r"^https://www\.tasict\.com\.au/event/", "fields": TASICT_FIELDS,
              "defaults": {"host": "TasICT", "topics": ["community", "careers"], "region": "TAS"}}
TASICT_EVENT = "https://www.tasict.com.au/event/tapas-tech-networking-event-hobart/"


def test_times_in():
    from hellotas_collector.sources.page import times_in
    assert times_in("5:30PM - 7:30PM") == [(17, 30), (19, 30)]
    assert times_in("6.30 pm to 11.00 p.m.") == [(18, 30), (23, 0)]
    assert times_in("9am") == [(9, 0)] and times_in("12:15AM") == [(0, 15)] and times_in("12pm") == [(12, 0)]
    assert times_in("Level 13, room 25") == []


def test_tasict_page_is_read_without_its_blocked_registration_site():
    from hellotas_collector.sources import html
    listing = f'<a href="{TASICT_EVENT}">Tech Jobs Showcase</a><a href="https://www.tasict.com.au/about/">About</a>'
    c = ctx({TASICT_CFG["listing"]: listing, TASICT_EVENT: fixture("tasict_event.html")})
    events = html.collect(TASICT_CFG, c)
    assert len(events) == 1
    ev = events[0]
    assert ev.title == "Tech Jobs Showcase – Hobart" and ev.url == TASICT_EVENT
    assert ev.start.isoformat() == "2026-05-14T17:30:00+10:00"  # May: standard time in Hobart
    assert ev.end.isoformat() == "2026-05-14T19:30:00+10:00" and ev.all_day is False
    assert ev.host == "TasICT" and ev.region == "TAS"
    assert ev.description.startswith("Attention Employers")
    assert ev.images == ["https://www-tasict-com-au.assets.ionatahosting.net/uploads/2025/12/Tapas-Tech-Jobs-Showcase-1.png"]
    assert ev.extra["registration"].startswith("https://events.humanitix.com/")
    # Humanitix refuses automated visitors: the page itself was enough, so it was never asked
    assert c.fetcher.asked == [TASICT_CFG["listing"], TASICT_EVENT]


def test_fields_without_a_time_or_a_date():
    from hellotas_collector.fetch import Page
    from hellotas_collector.sources.page import from_fields

    def read(html):
        page = Page(url="https://x.example/e", status=200, content_type="text/html", body=html.encode())
        return from_fields(page, "x", ctx({}), {"title": "h1", "date": ".d", "time": ".t"})
    all_day = read('<h1>Tas Tech Fest</h1><span class="d">Friday, 21st August 2026</span>')
    assert all_day.all_day and all_day.start.isoformat() == "2026-08-21T00:00:00+10:00" and all_day.end is None
    late = read('<h1>Awards night</h1><span class="d">26 June 2026</span><span class="t">10:00PM - 1:00AM</span>')
    assert late.end.isoformat() == "2026-06-27T01:00:00+10:00"  # past midnight is the next day
    assert read('<h1>Date to be announced</h1><span class="d">Coming soon</span>') is None
    assert read('<span class="d">26 June 2026</span>') is None  # no title
