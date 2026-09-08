# French scooter feed investigation

Verified on **8 September 2026** (Europe/Zurich). Public GBFS feeds were sufficient;
no mobile-app reverse engineering, account login, or private API credentials were
needed for the integrated systems.

The initial survey checked 51 French systems from the
[MobilityData GBFS catalog](https://github.com/MobilityData/gbfs/blob/master/systems.csv)
and cross-checked the [French National Access Point](https://transport.data.gouv.fr/datasets?format=gbfs&subtype=scooter).
27 feeds returned available electric standing scooters, covering 25 distinct
cities or operating areas. The repository now includes those feeds in
[`data/french-scooter-feeds.json`](../data/french-scooter-feeds.json).

## Verified availability

This is a snapshot, not a fleet-size promise. Counts below exclude reserved or
disabled vehicles, bicycles, mopeds, missing coordinates, and vehicles outside
the reviewed service-area envelopes. Snapshot: `2026-09-07T23:39:04.510Z`.

| Operator | Working feeds | Available scooters | Battery percentage | Range | Rental links |
| --- | ---: | ---: | --- | --- | --- |
| Bird | 5 | 800 | Yes | Yes | Not supplied |
| Dott | 6 | 4,973 | Yes | Yes | Yes |
| Lime | 2 | 2,418 | Not supplied | Yes | Not supplied |
| Pony | 9 | 2,506 | Yes | Yes | Yes |
| Voi | 5 | 4,565 | Not supplied | Yes | Yes |

Total: **15,262 available scooters**, with **0 failed feeds** in the final catalog check.

| Operator | City / operating area | Available scooters | Public GBFS discovery |
| --- | --- | ---: | --- |
| Bird | Ajaccio | 195 | [Discovery](https://mds.bird.co/gbfs/v2/public/ajaccio/gbfs.json) |
| Bird | Blois | 205 | [Discovery](https://mds.bird.co/gbfs/v2/public/provider/bird/blois-france/gbfs.json) |
| Bird | Châlons-en-Champagne | 95 | [Discovery](https://mds.bird.co/gbfs/v2/public/chalonsenchampagne/gbfs.json) |
| Bird | Laval | 237 | [Discovery](https://mds.bird.co/gbfs/v2/public/laval/gbfs.json) |
| Bird | Vichy | 68 | [Discovery](https://mds.bird.co/gbfs/v2/public/vichy/gbfs.json) |
| Dott | Bordeaux | 933 | [Discovery](https://gbfs.api.ridedott.com/public/v2/bordeaux/gbfs.json) |
| Dott | Bourgoin-Jallieu | 143 | [Discovery](https://gbfs.api.ridedott.com/public/v2/bourgoin-jallieu/gbfs.json) |
| Dott | Lyon | 3,514 | [Discovery](https://gbfs.api.ridedott.com/public/v2/lyon/gbfs.json) |
| Dott | Marne-la-Vallée (SIEMU) | 238 | [Discovery](https://gbfs.api.ridedott.com/public/v2/siemu/gbfs.json) |
| Dott | Tignes | 30 | [Discovery](https://gbfs.api.ridedott.com/public/v2/tignes/gbfs.json) |
| Dott | Versailles Grand Parc | 115 | [Discovery](https://gbfs.api.ridedott.com/public/v2/versailles-grand-parc/gbfs.json) |
| Lime | Lille Métropole | 1,089 | [Discovery](https://data.lime.bike/api/partners/v2/gbfs/lille/gbfs.json) |
| Lime | Marseille | 1,329 | [Discovery](https://data.lime.bike/api/partners/v2/gbfs/marseille/gbfs.json) |
| Pony | Angers | 601 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-angers-gbfs/gbfs.json) |
| Pony | Beauvais | 39 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-beauvais-gbfs/gbfs.json) |
| Pony | Bordeaux | 880 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-bordeaux-gbfs/gbfs.json) |
| Pony | Bourges | 152 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-bourges-gbfs/gbfs.json) |
| Pony | Évry-Courcouronnes | 113 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-evry-gbfs/gbfs.json) |
| Pony | Hérouville-Saint-Clair | 24 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-herouville-gbfs/gbfs.json) |
| Pony | Lorient | 101 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-lorient-gbfs/gbfs.json) |
| Pony | Perpignan | 402 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-perpignan-gbfs/gbfs.json) |
| Pony | Poitiers | 194 | [Discovery](https://proxy.transport.data.gouv.fr/resource/pony-poitiers-gbfs/gbfs.json) |
| Voi | Le Havre | 898 | [Discovery](https://api.voiapp.io/gbfs/fr/6bb6b5dc-1cda-4da7-9216-d3023a0bc54a/v2/336/gbfs.json) |
| Voi | Saint-Quentin-en-Yvelines | 658 | [Discovery](https://api.voiapp.io/gbfs/fr/6bb6b5dc-1cda-4da7-9216-d3023a0bc54a/v2/355/gbfs.json) |
| Voi | Grenoble | 1,154 | [Discovery](https://api.voiapp.io/gbfs/fr/6bb6b5dc-1cda-4da7-9216-d3023a0bc54a/v2/358/gbfs.json) |
| Voi | Grand Paris Seine et Oise | 550 | [Discovery](https://api.voiapp.io/gbfs/fr/6bb6b5dc-1cda-4da7-9216-d3023a0bc54a/v2/422/gbfs.json) |
| Voi | Marseille | 1,305 | [Discovery](https://api.voiapp.io/gbfs/fr/6bb6b5dc-1cda-4da7-9216-d3023a0bc54a/v2/66/gbfs.json) |

## Findings that affect integration

- **Dott:** the [France country entry point](https://gbfs.api.ridedott.com/public/v2/countries/fr/gbfs.json)
  is a flattened list with repeated feed names for multiple cities. Selecting the
  first `free_bike_status` entry would cover only one city. The app uses reviewed
  city-specific discovery documents instead.
- **Pony:** the government proxy now serves **GBFS 3.0**, using unlocalized
  `data.feeds`, `vehicle_status`, `data.vehicles`, `vehicle_id`, and ISO timestamps.
  Other integrated operators use GBFS 2.2/2.3, localized discovery,
  `free_bike_status`, `data.bikes`, and Unix timestamps.
- **Lime and Voi:** the sampled public feeds provide remaining range but no battery
  percentage. The app retains `battery: null`; it does not invent a percentage
  from vehicle range. A positive battery filter excludes unknown batteries.
- **Rental links:** Dott publishes vehicle links; Voi links to its nearest-vehicle
  flow; Pony links to its scanner. Bird and Lime supplied no vehicle rental links
  in these feeds. Only the supplied, provider-validated links are exposed.
- **Feed health:** successful HTTP responses can contain abandoned data. The new
  adapter marks status timestamps older than five minutes stale and rejects
  missing timestamps or data older than fifteen minutes. An unavailable city
  feed does not discard other successful city feeds.
- **Bounds:** geofencing envelopes have conservative padding; Lime's feeds lack
  geofencing, so reviewed metropolitan bounds are used. These are fetch-routing
  envelopes, not legal riding or parking zones. A stray Pony Angers record was
  observed outside its region; records outside the configured service bounds
  are excluded. Changes in service areas need a catalog review.
- **Search:** supported French city names are searchable alongside Swiss address
  results. French street-address geocoding is not included. City names are
  deduplicated when two operators cover the same place.

## Feeds not enabled

| Finding | Evidence / next step |
| --- | --- |
| Dott GPSEO | The catalog's old city discovery returned HTTP 404. The working Voi GPSEO feed is enabled. |
| Dott OL Vallée | Current status returned zero vehicles; keep as a candidate rather than claiming current availability. |
| Central Paris | Sampled Dott, Lime, and Voi feeds returned bicycles and zero available standing scooters. Nearby GPSEO, SIEMU, Versailles and Saint-Quentin-en-Yvelines are separate systems. |
| Other Lime feeds | Nice and Sophia Antipolis returned zero available standing scooters in this sample. |
| Other Pony feeds | Nice, Limoges and Pays Basque returned zero available standing scooters in this sample. |
| Voi V'Lônes | Returned bicycles and zero available standing scooters in this sample. |
| Historical Bird feeds | Bordeaux returned only unavailable/bicycle data with an old timestamp. Castres, Dieppe, Draguignan, Épron, Gap, Hérouville-Saint-Clair, La Roche-sur-Yon, Marseille, Millau, Montluçon, Ouistreham and Sarreguemines returned empty status with timestamp 0. |
| Lime Le Havre | The [official listing](https://transport.data.gouv.fr/datasets/gbfs-le-havre-2) describes a secured feed whose credentials are provided to approved partners. No authenticated access was attempted. Voi Le Havre is enabled. |
| Nantes Micromob | The [municipal dataset](https://transport.data.gouv.fr/datasets/offre-et-temps-reel-du-service-naolib-micromob-de-nantes-metropole-au-format-gbfs) describes station-level bicycle/scooter availability; station counts need a separate representation from individual vehicles. |
| Pony La Roche-sur-Yon | The [official dataset](https://transport.data.gouv.fr/datasets/stations-trottinette-en-libre-service-de-la-roche-sur-yon) describes station availability and reports low endpoint availability. It is not included in the verified individual-vehicle catalog. |

Empty feeds are snapshot observations, not proof that an operator has permanently
left a city. The enabled catalog deliberately contains only positively verified
individual-scooter feeds.

## Source terms

Public accessibility is distinct from a blanket redistribution license.
The [Dott country listing](https://transport.data.gouv.fr/resources/82747?locale=fr)
points to [Dott's API license](https://ridedott.com/api-licence/), which describes
internal application development and restricts commercial benefit and distribution
of API/data. Those terms need review before publicly deploying this Dott integration.

Bird's `system_information` points to its
[GBFS Data License](https://www.bird.co/wp-content/uploads/2019/03/GBFS-Data-License-Agreement-2018-09-25.pdf).
Lime's `system_information` points to [Lime GBFS terms](https://www.li.me/gbfs-terms).
The sampled Pony and Voi system-information documents did not supply a license URL;
consult their individual National Access Point dataset terms. Government proxying
alone should not be treated as a new license. Operator attribution is included in
the map, footer, and API response header.

## Recheck

```sh
npm run check:france
# Machine-readable snapshot without individual vehicle IDs or coordinates:
node scripts/check-french-feeds.mjs --json
```

The checker uses four concurrent systems, follows discovery links within each
reviewed city URL base, verifies status timestamps, and returns a nonzero exit code
on feed failures. It does not modify the catalog or deploy the application.

The application adapter was also exercised against live feeds for Lyon, Marseille,
Bordeaux, Angers and Zürich. Both EUR French tariffs and CHF Swiss tariffs were
preserved where published. No deployment was performed as part of this investigation.
