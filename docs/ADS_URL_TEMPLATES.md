# Ad URL templates

Campaign, ad set and ad **IDs** are the join key between sessions and ad spend: names change, IDs
do not. Add these URL parameters at the ad / campaign level of each platform.

## Meta (Facebook + Instagram)

Ads Manager → Ad → **URL parameters**:

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}
```

`{{site_source_name}}` resolves to `fb`, `ig`, `msg` or `an`, so Facebook and Instagram placements
can be separated. Meta also appends `fbclid` automatically. The SDK stores it and the worker
builds `fbc` for the Conversions API from it.

## Google Ads

Turn on **auto-tagging** (adds `gclid`, or `wbraid`/`gbraid` on iOS). Account → Settings →
**Final URL suffix**:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&campaign_id={campaignid}&adset_id={adgroupid}&ad_id={creative}&utm_term={keyword}
```

The SDK also understands the `hsa_cam` / `hsa_grp` / `hsa_ad` parameters used by some setups.

## TikTok

Ad → **URL parameters** (TikTok also appends `ttclid` automatically):

```
utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&utm_term=__AID_NAME__&campaign_id=__CAMPAIGN_ID__&adset_id=__AID__&ad_id=__CID__
```

## How attribution is resolved

- **Session (last-touch) attribution**: UTM / click IDs on the landing URL. A direct return within
  30 days inherits the last non-direct touch (the same rule GA uses), so returning visitors who
  convert stay credited to the ad.
- **First touch**: the first touch of the visitor (stored for 400 days).
- A new ad click (a different campaign or click ID) always starts a new session.
- Channels are classified server-side: `paid_social`, `paid_search`, `paid_video`, `paid_other`,
  `organic_social`, `organic_search`, `email`, `referral`, `direct`. A `fbclid` without UTMs is
  counted as `organic_social`, because Meta adds `fbclid` to every outbound link.
