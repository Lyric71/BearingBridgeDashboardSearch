"""
Export keyword performance (clicks, impressions, cost) from Google Ads.
Account: 557-577-6523 (BBG client account)
Manager: 572-730-1811

Fetches 3 timeframes (yesterday, 7 days, 15 days) and outputs JSON
to data/google_ads_performance.json for the reporting site.
"""
import yaml, warnings, json, os
from collections import defaultdict
from datetime import date, timedelta

warnings.filterwarnings('ignore')
from google.ads.googleads.client import GoogleAdsClient

CUSTOMER_ID = '5575776523'
TIMEFRAMES = [
    {'key': '1d',  'label': 'Yesterday', 'days': 1},
    {'key': '7d',  'label': '7 days',    'days': 7},
    {'key': '15d', 'label': '15 days',   'days': 15},
]

with open('config/credentials.yml') as f:
    creds = yaml.safe_load(f)['google_ads']

client = GoogleAdsClient.load_from_dict({
    'developer_token':   creds['developer_token'],
    'client_id':         creds['client_id'],
    'client_secret':     creds['client_secret'],
    'refresh_token':     creds['refresh_token'],
    'login_customer_id': str(creds['customer_id']),
    'use_proto_plus':    True,
})

ga_svc = client.get_service('GoogleAdsService')


def fetch_timeframe(days, label):
    """Fetch keyword performance for a given number of past days."""
    if days == 1:
        # Yesterday only
        d = (date.today() - timedelta(days=1)).strftime('%Y-%m-%d')
        date_from, date_to = d, d
    else:
        date_from = (date.today() - timedelta(days=days)).strftime('%Y-%m-%d')
        date_to = date.today().strftime('%Y-%m-%d')

    query = f"""
        SELECT
            campaign.name,
            campaign.status,
            ad_group.name,
            ad_group.status,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.cpc_bid_micros,
            ad_group_criterion.status,
            metrics.clicks,
            metrics.impressions,
            metrics.cost_micros,
            metrics.average_cpc
        FROM keyword_view
        WHERE
            ad_group_criterion.status != 'REMOVED'
            AND campaign.status != 'REMOVED'
            AND ad_group.status != 'REMOVED'
            AND segments.date BETWEEN '{date_from}' AND '{date_to}'
        ORDER BY campaign.name, ad_group.name, ad_group_criterion.keyword.text
    """

    print(f"  [{label}] {date_from} to {date_to} ...", end=' ')
    stream = ga_svc.search_stream(customer_id=CUSTOMER_ID, query=query)

    campaigns = defaultdict(lambda: {
        'status': '',
        'ad_groups': defaultdict(lambda: {
            'status': '',
            'keywords': [],
            'totals': {'clicks': 0, 'impressions': 0, 'cost': 0.0},
        }),
        'totals': {'clicks': 0, 'impressions': 0, 'cost': 0.0},
    })
    total_clicks = 0
    total_impressions = 0
    total_cost = 0.0
    total_keywords = 0

    for batch in stream:
        for row in batch.results:
            campaign_name = row.campaign.name
            campaign_status = row.campaign.status.name
            ag_name = row.ad_group.name
            ag_status = row.ad_group.status.name
            kw_text = row.ad_group_criterion.keyword.text
            match_type = row.ad_group_criterion.keyword.match_type.name
            max_cpc = row.ad_group_criterion.cpc_bid_micros / 1_000_000 if row.ad_group_criterion.cpc_bid_micros else 0
            kw_status = row.ad_group_criterion.status.name
            clicks = row.metrics.clicks
            impressions = row.metrics.impressions
            cost = row.metrics.cost_micros / 1_000_000
            avg_cpc = row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0

            camp = campaigns[campaign_name]
            camp['status'] = campaign_status
            ag = camp['ad_groups'][ag_name]
            ag['status'] = ag_status

            ag['keywords'].append({
                'text': kw_text,
                'match_type': match_type,
                'max_cpc': round(max_cpc, 2),
                'status': kw_status,
                'clicks': clicks,
                'impressions': impressions,
                'cost': round(cost, 2),
                'avg_cpc': round(avg_cpc, 2),
            })

            ag['totals']['clicks'] += clicks
            ag['totals']['impressions'] += impressions
            ag['totals']['cost'] += cost
            camp['totals']['clicks'] += clicks
            camp['totals']['impressions'] += impressions
            camp['totals']['cost'] += cost

            total_clicks += clicks
            total_impressions += impressions
            total_cost += cost
            total_keywords += 1

    print(f"{total_keywords} kw, {total_clicks} clicks, HKD {total_cost:.2f}")

    # Build result
    result = {
        'label': label,
        'date_from': date_from,
        'date_to': date_to,
        'days': days,
        'totals': {
            'keywords': total_keywords,
            'clicks': total_clicks,
            'impressions': total_impressions,
            'cost': round(total_cost, 2),
            'avg_cpc': round(total_cost / total_clicks, 2) if total_clicks > 0 else 0,
        },
        'campaigns': [],
    }

    for camp_name in sorted(campaigns.keys()):
        camp = campaigns[camp_name]
        camp_data = {
            'name': camp_name,
            'status': camp['status'],
            'totals': {
                'clicks': camp['totals']['clicks'],
                'impressions': camp['totals']['impressions'],
                'cost': round(camp['totals']['cost'], 2),
                'avg_cpc': round(camp['totals']['cost'] / camp['totals']['clicks'], 2) if camp['totals']['clicks'] > 0 else 0,
            },
            'ad_groups': [],
        }
        for ag_name in sorted(camp['ad_groups'].keys()):
            ag = camp['ad_groups'][ag_name]
            camp_data['ad_groups'].append({
                'name': ag_name,
                'status': ag['status'],
                'totals': {
                    'clicks': ag['totals']['clicks'],
                    'impressions': ag['totals']['impressions'],
                    'cost': round(ag['totals']['cost'], 2),
                    'avg_cpc': round(ag['totals']['cost'] / ag['totals']['clicks'], 2) if ag['totals']['clicks'] > 0 else 0,
                },
                'keywords': sorted(ag['keywords'], key=lambda k: k['clicks'], reverse=True),
            })
        result['campaigns'].append(camp_data)

    return result


# --- Main ---
print("Fetching keyword performance from Google Ads...")

output = {
    'date': str(date.today()),
    'account': '557-577-6523',
    'currency': 'HKD',
    'timeframes': {},
}

for tf in TIMEFRAMES:
    output['timeframes'][tf['key']] = fetch_timeframe(tf['days'], tf['label'])

# Write JSON
output_path = 'data/google_ads_performance.json'
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\nExported to {output_path}")

# Best-effort: also push to Supabase (single source of truth the web app reads).
try:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))  # repo root
    import supabase_rest
    if supabase_rest.configured():
        supabase_rest.upsert('ads_snapshots', [{
            'project_id': 'beyondbordergroup',  # account-level data owned by BBG
            'snapshot_date': output['date'],
            'account': output['account'],
            'currency': output['currency'],
            'data': output['timeframes'],
        }], 'project_id,snapshot_date')
        print("Synced ads snapshot -> Supabase")
    else:
        print("Supabase sync skipped: not configured")
except Exception as e:
    print(f"Supabase sync skipped: {e}")
