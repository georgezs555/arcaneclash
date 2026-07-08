# Card Art Prompts

Generate each image with any AI image tool (DALL·E, Midjourney, Stable
Diffusion, Bing Image Creator, …), then save it into
`packages/client/src/art/` using the exact **filename** shown (png, jpg, or
webp). Restart `npm run dev` after adding files; each card picks up its art
automatically, and cards without an image keep the procedural placeholder.

**Format tip:** portrait orientation, roughly 3:4 (e.g. 768×1024). The image
fills the whole card, so keep the subject centered and avoid text in the image.

**Consistent style:** append this to every prompt so the set looks coherent:

> anime style, vibrant cel-shaded digital illustration, dramatic fantasy
> lighting, painterly background, trading card game art, portrait
> composition, no text, no watermark

## Neutral minions

| Filename | Prompt (essence of the card) |
| --- | --- |
| `river_skulker.png` | A small nimble lizardfolk rogue crouching low in shallow river reeds at dawn, dagger drawn, mischievous grin — quick and fragile ambusher |
| `stonehide_guard.png` | A squat granite-skinned golem soldier planting a heavy round shield into the ground, immovable stance, protective aura — a stalwart defender |
| `hedge_scholar.png` | A young hedge-wizard apprentice excitedly pulling a glowing book from a satchel, scrolls tumbling out, warm library light — knowledge and card draw |
| `sparkfist_brawler.png` | A wiry street fighter mid-dash with lightning crackling around clenched fists, motion blur behind, eager expression — charges instantly into battle |
| `gravemoss_shambler.png` | A moss-covered shambling corpse-golem with a tiny fiery spirit glowing inside its ribcage, waiting to escape — death releases a small flame |
| `duskwing_harrier.png` | A sleek twilight falcon-woman with twin wing blades, diving twice in one motion, double afterimage — strikes two times |
| `sunforged_acolyte.png` | A serene monk in gilded armor surrounded by a shimmering golden bubble of holy light — protected by a divine shield |
| `boulderfang_alpha.png` | A massive bear-sized wolf with stone spikes along its back standing on a cliff, pack leader posture, imposing bulk — big sturdy beast |
| `warden_of_the_gate.png` | A towering armored sentinel blocking a fortress gate with a massive halberd, torchlight, "none shall pass" stance — high-health taunt wall |
| `stormcaller_veda.png` | A fierce sorceress with wind-whipped hair calling a lightning bolt down from a swirling storm onto a target below — arrives with a thunder strike |
| `ridge_charger.png` | An armored elk-mount thundering downhill at full gallop, dust and rocks flying, lowered antlers — rushes straight into enemies |
| `aegis_colossus.png` | A colossal ancient guardian statue awakening, golden barrier shimmering across its stone body, legendary presence, low camera angle — ultimate shielded protector |

## Neutral spells

| Filename | Prompt |
| --- | --- |
| `ember_bolt.png` | A streaking bolt of orange flame fired from a fingertip across a dark battlefield, sparks trailing — simple direct fire damage |
| `mend_flesh.png` | Soft green-gold healing light knitting a warrior's wound closed, gentle glowing hands, relieved expression — restoring health |
| `battle_hymn.png` | A bard mid-song with radiant musical notes swirling around a growing, empowered knight whose armor glows brighter — a strengthening anthem |
| `chain_sparks.png` | Four small forked lightning arcs jumping unpredictably between multiple silhouetted enemies, chaotic energy — random scattered zaps |
| `cinder_nova.png` | A ring of fire erupting outward from a mage at the center, washing over an enemy battle line, embers everywhere — damage to all enemies |
| `tomes_of_insight.png` | Two enchanted books flying open above a scholar's head, pages streaming glowing glyphs into their eyes — drawing two cards |

## Mage (Merlin)

| Filename | Prompt |
| --- | --- |
| `arcane_dart.png` | A precise needle of violet-blue arcane energy shot from an elderly wizard's staff, clean and surgical — small reliable magic damage |
| `frost_prison.png` | An enemy warrior frozen mid-swing inside a jagged translucent block of blue ice, frost spreading at the base — immobilized by frost |
| `starfall_adept.png` | A young astronomer-mage in star-patterned robes raining tiny meteors across an enemy army, cosmic night sky backdrop — small damage to all enemies on arrival |

## Warlock (Morgana)

| Filename | Prompt |
| --- | --- |
| `gloom_imp.png` | A grinning purple imp bursting from a summoning circle while dark tendrils drain a drop of blood from its summoner's hand — power at a price |
| `soul_tithe.png` | A sorceress offering a wisp of her own glowing life-essence to a floating dark grimoire, which opens with two shining pages — pay life for knowledge |
| `shadow_rend.png` | A claw of solid shadow tearing through a knight's armor while thorns prick the caster's outstretched arm — heavy damage that cuts both ways |

## Paladin (Parcifal)

| Filename | Prompt |
| --- | --- |
| `oath_of_dawn.png` | A kneeling knight receiving a luminous golden barrier from sunrise light breaking over a hill, solemn vow — granting a divine shield |
| `squire_muster.png` | Two eager teenage squires in oversized helmets running onto a battlefield carrying banner and sword, morning light — summoning two small allies |
| `grail_knight.png` | A radiant knight in white-gold armor holding a shining chalice aloft, wrapped in a protective halo — a holy shielded champion |

## Warrior (Lancelot)

| Filename | Prompt |
| --- | --- |
| `rallying_strike.png` | A commander clashing his sword against a soldier's blade to ignite it with red battle-fury, the soldier's eyes lighting up — granting bonus attack |
| `iron_bulwark.png` | Interlocking iron tower shields slamming together into a wall in front of a general reading a dispatch — gaining armor and insight |
| `tourney_champion.png` | A victorious tournament knight raising a lance, fresh plates of armor magnetically assembling onto his body, confetti and banners — arrives armored |

## Priest (Martin)

| Filename | Prompt |
| --- | --- |
| `radiant_light.png` | A column of warm white-gold light descending on a wounded soldier whose wounds close, dust motes glowing — pure restoration |
| `humble_words.png` | A calm friar whispering to a hulking raging berserker whose weapon dissolves into flower petals, fury draining from his face — reducing attack to almost nothing |
| `cloister_healer.png` | A gentle monastery healer with a glowing censer tending a patient on a cot, candlelight, herbs hanging — a sturdy minion that heals on arrival |

## Hunter (Robin Hood)

| Filename | Prompt |
| --- | --- |
| `trusty_hound.png` | An eager scruffy hunting hound sprinting flat-out through forest undergrowth the moment its leash is slipped — attacks the turn it arrives |
| `pack_call.png` | A hooded ranger blowing a bone whistle as two lean grey wolves materialize from mist on either side — summoning a small pack |
| `ambush_volley.png` | Arrows raining from hidden archers in tree canopy onto two surprised enemy soldiers below, dappled forest light — random strikes from ambush |

## Tokens & misc

| Filename | Prompt |
| --- | --- |
| `emberling.png` | A tiny cheerful flame spirit with stubby arms hopping out of a pile of ash, big glowing eyes — a small summoned fire elemental |
| `squire.png` | A single brave young squire in slightly-too-big chainmail holding a practice sword with both hands, determined face |
| `wolf.png` | A lean grey wolf mid-lunge with bared teeth, fast and fragile, misty forest behind |
| `coin.png` | A single ornate gold coin spinning in the air catching magical light, sparkles trailing — a burst of bonus mana |
