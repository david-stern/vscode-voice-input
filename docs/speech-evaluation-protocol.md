# פרוטוקול הערכת דיבור HE/EN ושער שחרור

**סטטוס:** פרוטוקול מחייב לפני בחירת/אריזת מודל ולפני כל שחרור

**גרסה:** 1.0

**תחולה:** STT מקומי, Soniox אופציונלי, intent/slots, wake safety, TTS מקומי וביצועי helper

## 1. מטרת הפרוטוקול

המסמך מגדיר ניסוי חוזר, קפוא ובר־ביקורת שמכריע אם חבילת הקול כשירה להפצה בעברית ובאנגלית. תיעוד ספק, demo או הרצה על מחשב פיתוח אינם הוכחת קבלה. כל תוצאה חייבת להיות קשורה ל־corpus hash, גרסת runtime/model, artifact hash, חומרה, מערכת הפעלה ותצורת inference.

הפרוטוקול בודק שישה תחומים בלתי תלויים:

1. איכות STT: ‏WER ו־CER.
2. איכות פקודות: intent וכל ה־slots.
3. בטיחות activation: wake/negative corpus ו־0 dispatch מסוכן.
4. latency ומשאבים: finalization, load, RSS, CPU ו־Extension Host responsiveness.
5. איכות TTS: intelligibility, הגיית קוד/מספרים/paths, MOS, TTFB ו־stop.
6. תמיכת platform: runtime, capture, playback, crash isolation ו־pack integrity.

STT streaming של Soniox נמדד רק על tokens בעלי `is_final=true`; non-final tokens הם UI-only ואינם משתתפים ב־intent/dispatch. הבחנה זו תואמת את [Soniox real-time transcription documentation](https://soniox.com/docs/stt/rt/real-time-transcription) ואת [WebSocket API](https://soniox.com/docs/api-reference/stt/websocket-api). המנוע המקומי מוערך כ־final-only.

## 2. עקרונות ניסוי

- **Frozen before evaluation:** corpus, normalization, command catalog, thresholds ו־scoring code מוקפאים לפני הרצת release candidate.
- **No tuning on acceptance:** אין לשנות phrases, model parameters או normalization בעקבות holdout result ואז להריץ על אותו holdout כאילו הוא חדש.
- **Separate languages:** כל metric ושער מחושבים בנפרד ל־HE ול־EN. ממוצע משוקלל אינו יכול להסתיר כשל בשפה אחת.
- **Human speech only for acceptance:** corpus הקבלה מכיל הקלטות אנושיות. אודיו synthetic רשאי לשמש unit/load tests בלבד.
- **Final artifact:** ההרצה משתמשת ב־runtime, ב־STT data pack וב־TTS data pack שאמורים להתפרסם, עם SHA-256 זהים. כל pack הוא artifact עצמאי; debug build אינו הוכחת release.
- **Offline means offline:** local evaluation רצה עם network חסום לאחר התקנת ה־pack או ה־packs הנדרשים למסלול הנבדק. ניסיון network הוא כשל.
- **No silent fallback:** כשל local אינו מעביר audio ל־Soniox. Soniox נבדק רק במסלול opt-in נפרד.
- **No pooled repeats:** חזרות ביצועים נמדדות כחזרות של אותו artifact, אך איכות STT/TTS מדווחת לפי sample אנושי, לא כמספר דגימות מנופח מחזרות זהות.

## 3. Corpus קבלה ל־STT ופקודות

### 3.1 גודל והרכב מחייב לכל שפה

לכל אחת מ־HE ו־EN נדרש corpus עצמאי של לפחות 300 utterances:

| סוג | מינימום | כיסוי |
|---|---:|---|
| פקודות | 200 | כל אחד מ־100 command IDs מופיע לפחות פעמיים; לפחות phrase אחד אינו זהה ל־label |
| dictation | 100 | פרוזה, punctuation spoken forms, מספרים, שמות קבצים ומונחי פיתוח |
| סך הכול | 300 | ללא שכפול אותו audio או אותו transcript מאותו speaker |

דרישות חוצות:

- לפחות 10 דוברים בכל שפה; יעד מומלץ 12–20.
- אף speaker אינו תורם יותר מ־20% מה־utterances בשפה.
- לפחות 30% מהדגימות בכל שפה הן noisy, כלומר לפחות 90 מתוך 300.
- לפחות 30% מהדגימות מוקלטות בקול נשי ולפחות 30% בקול גברי; מי שאינו מזדהה כך נספר בנפרד ואינו מוחרג.
- לפחות 20% מהדגימות בכל שפה הן של non-native/מבטא אזורי רלוונטי, אם המשתתף מסכים לסיווג עצמי. נתון זה משמש stratification בלבד, לא זיהוי.
- טווחי גיל מדווחים ב־bands בלבד; נדרשים לפחות שלושה bands עם לפחות 10% בכל band שנכלל.
- command utterances כוללים slots חוקיים עבור line/file/query/branch/message בהתאם לקטלוג, ובנוסף near-miss values לבדיקת rejection.

אם לא ניתן לגייס diversity מספקת, הדוח מציין את החסר והשחרור נשאר חסום; אין להציג תוצאה כייצוגית על בסיס speaker יחיד או צוות הפיתוח בלבד.

### 3.2 Clean ו־noisy

`clean` פירושו חדר שקט, SNR מתועד של לפחות 25 dB, ללא קול אנושי נוסף. `noisy` כולל לפחות שלושה פרופילים:

1. משרד/מקלדת/מאוורר.
2. מוזיקה או דיבור רקע שאינו מכיל את wake phrase.
3. capture device בינוני או מרחק 1–2 מטר.

לפחות 20 utterances noisy בכל שפה מגיעים מכל פרופיל. noise מוקלט בסביבה אמיתית או נוסף מ־source מורשה עם provenance. SNR target buckets: ‏`5–10`, ‏`10–20`, ‏`20–25` dB, לפחות 20 samples בכל bucket; היתרה יכולה להיות natural noise ללא SNR מדויק, אך מסומנת כך.

### 3.3 פורמט אודיו

- master נשמר lossless בפורמט המקורי.
- evaluation derivative קבוע: PCM signed 16-bit little-endian, mono, 16 kHz WAV.
- resampling algorithm וגרסתו נרשמים ב־manifest.
- אין peak normalization פר־sample שמעלים הבדלי capture; רק clipping rejection ו־fixed gain policy קפואה.
- sample עם clipping מעל 1% frames, transcript לא ודאי או תקלה טכנית מסומן invalid לפני freeze ומוחלף; אין מחיקה אחרי תוצאה בגלל שהמודל טעה.

### 3.4 Manifest

כל sample מקבל ID אטום ו־record הבא:

```json
{
  "sampleId": "he-cmd-0001",
  "language": "he",
  "kind": "command",
  "commandId": "voiceInput.builtin.example",
  "slots": { "line": 42 },
  "reference": "עבור לשורה ארבעים ושתיים",
  "speakerPseudonym": "spk-he-03",
  "speakerBands": { "age": "35-54", "gender": "self-described", "accent": "self-described" },
  "condition": "noisy",
  "noiseProfile": "office",
  "snrBucketDb": "10-20",
  "durationMs": 2810,
  "audioSha256": "...",
  "consentId": "consent-opaque-id",
  "sourceLicenseId": null
}
```

ה־manifest המלא פרטי. הדוח הציבורי/בריפו כולל רק counts, aggregate strata, corpus version ו־Merkle/root hash או hash של manifest שעבר redaction; הוא אינו כולל audio path, transcript אישי, consent document או demographic combination שיכול לזהות אדם.

## 4. הסכמה, provenance ופרטיות

### 4.1 הקלטה אנושית

לפני הקלטה כל משתתף מקבל טופס ברור בשפתו הכולל:

- מטרת האיסוף: בדיקות STT/TTS/פקודות של ההרחבה.
- אילו נתונים נשמרים, למשך כמה זמן ומי יכול לגשת.
- האם audio יישאר local/internal או עשוי להישלח לספק cloud.
- זכות לסרב או למשוך הסכמה עד freeze date בלי פגיעה.
- איסור לומר סודות, שמות לקוחות, credentials או תוכן workspace אמיתי.
- אישור נפרד לכל שימוש מעבר לבדיקת המוצר.

הסכמה מקומית אינה הסכמה לענן. Soniox נבדק רק באמצעות:

1. corpus ציבורי/מורשה שרישיונו מאפשר שליחה ועיבוד אצל צד שלישי; או
2. recordings עם cloud-processing consent מפורש ונפרד.

### 4.2 Provenance

לכל recording נדרש אחד מהבאים:

- `consentId` פנימי שמצביע למסמך חתום ומוגן; או
- `sourceLicenseId`, URL, license text/hash ותאריך retrieval עבור corpus ציבורי.

חסר consent/provenance, רישיון לא ברור או איסור derivative/cloud processing מוציאים את sample לפני freeze. אם הסכמה נמשכה לאחר freeze ולפני release, corpus version נפסל, ה־sample מוסר ונדרש freeze והרצה חדשים.

### 4.3 אחסון וגישה

- audio, transcript-level manifest ו־consent documents אינם נכנסים ל־Git, ל־VSIX, ל־issue attachment או ל־CI artifact ציבורי.
- הם נשמרים באחסון פרטי מוצפן עם least-privilege access ו־audit log.
- consent documents נשמרים בנפרד מה־speaker pseudonym map.
- logs של runtime הם content-free: sample ID, timings, status ו־error code; אין raw audio/transcript.
- retention date ו־deletion owner מתועדים. בסיום retention נמחק audio; aggregate metrics ו־hashes יכולים להישמר אם אינם מאפשרים reconstruction.

## 5. Freeze, splits ועקיבות

### 5.1 Splits

- development corpus ו־acceptance corpus אינם חולקים audio.
- speaker-disjoint split הוא חובה: speaker ב־development אינו מופיע ב־acceptance.
- acceptance corpus נעול read-only ומקבל semantic version ו־SHA-256 manifest.
- אם נדרש benchmark חוזר לאותו release candidate, output נשמר כהרצה נוספת אך אינו הופך sample חדש.

### 5.2 Run manifest

כל run שומר:

```text
run_id
UTC timestamp
git commit
VSIX SHA-256
runtime/helper SHA-256 and version
STT-pack ID/version/SHA-256/bytes/license IDs
TTS-pack ID/version/SHA-256/bytes/license IDs
combined first-use selected bytes
corpus version/hash
normalization/scorer version/hash
OS/build/kernel, CPU model, logical/physical cores, RAM
audio input/output device and driver/backend
VS Code version and Electron/Node ABI
provider and immutable configuration
network state
per-sample raw output, normalized output, timings and error code
```

כל שינוי באחד משדות artifact/corpus/scorer יוצר run חדש ואוסר השוואה כאילו זה אותו תנאי.

## 6. נרמול ו־scoring STT

### 6.1 שתי תוצאות, שער אחד קבוע

לכל sample נשמרים:

- `raw`: exact Unicode output שהprovider החזיר.
- `normalized`: output לאחר normalizer קפוא ושקוף.

שער WER/CER מחושב על normalized text; raw metrics מדווחים לצורך אבחון ואסור להסתירם. normalizer אינו רשאי להשתמש ב־command ID או reference הספציפי כדי “לתקן” hypothesis.

### 6.2 כללי נרמול משותפים

1. Unicode NFKC.
2. lowercase באנגלית.
3. המרת whitespace רציף לרווח יחיד ו־trim.
4. הסרת punctuation שאינו סמנטי לפי allowlist קפוא.
5. spoken-number normalization באמצעות lexicon קפוא לשפה, גם reference וגם hypothesis.
6. paths, branch names, symbols וקיצורי קוד עוברים tokenizer קבוע ומתועדים; אין autocorrect לפי workspace.

### 6.3 עברית

- ניקוד וטעמי מקרא מוסרים משני הצדדים.
- אותיות סופיות אינן מומרות לאותיות אמצעיות.
- גרש/גרשיים מנורמלים רק לצורת Unicode קבועה לפני punctuation policy.
- prefixes (ו/ב/ל/כ/מ/ש/ה) אינם מפוצלים לאחר ההקלטה; tokenizer version קובע את ההתנהגות לפני freeze.
- CER מחושב על sequence ללא whitespace לאחר normalization; WER על tokens המופרדים לפי tokenizer הקפוא.

### 6.4 אנגלית

- contractions נשמרים לפי tokenizer קפוא.
- casing אינו נספר לאחר lowercase.
- מספרים נמדדים בצורת canonical אחת שהוגדרה לפני freeze.
- CER מחושב ללא whitespace; WER על whitespace/token punctuation policy הקבועה.

### 6.5 נוסחאות

```text
WER = (substitutions + deletions + insertions) / reference word count
CER = (substitutions + deletions + insertions) / reference character count
```

ה־alignment הוא minimum edit distance. corpus score מחושב מ־sum errors / sum reference units, לא כממוצע לא־משוקלל של אחוזי samples. WER הוא מדד evaluation מקובל; [NIST OpenASR evaluation plan](https://www.nist.gov/system/files/documents/2021/08/03/OpenASR20_EvalPlan_v1_5.pdf) משמש reference מתודולוגי בלבד, בעוד שכללי normalization הספציפיים למוצר קבועים במסמך זה.

### 6.6 ספי קבלה

| שפה | WER | CER |
|---|---:|---:|
| EN | `<= 15.0%` | `<= 8.0%` |
| HE | `<= 20.0%` | `<= 10.0%` |

שני הספים חייבים לעבור בכל שפה. בנוסף מדווחים clean/noisy בנפרד, speaker median, worst-speaker result ו־95% bootstrap confidence interval; אין threshold נפרד ל־worst speaker ב־v1, אך regression מעל 5 נקודות אחוז לעומת candidate קודם מחייב חקירה מתועדת.

## 7. Intent, slots ו־dispatch safety

### 7.1 Scoring commands

כל אחת מ־200 פקודות לשפה עוברת pipeline מלא עד לפני side effect:

```text
audio -> final transcript -> safety/wake -> matcher -> typed slots -> availability -> dry-run executor decision
```

record נחשב נכון רק אם:

1. `intentId` שווה ל־command ID הצפוי; וגם
2. כל slot נדרש קיים ושווה לאחר normalizer typed; וגם
3. אין slot נוסף שמשנה את target; וגם
4. החלטת availability תואמת fixture.

`intent+slot accuracy = fully correct command records / all command records`. אין partial credit.

### 7.2 ספים

| subset | סף |
|---|---:|
| clean commands | `>= 95.0%` |
| noisy commands | `>= 90.0%` |

הספים נמדדים לכל שפה בנפרד. collision, ambiguity, invalid slot או unavailable target חייבים להסתיים ב־0 dispatch.

### 7.3 Negative/no-wake corpus

נדרש corpus נוסף של לפחות 2,000 utterances שאינו חופף ל־acceptance החיובי:

- 1,000 HE ו־1,000 EN.
- לפחות 40% דיבור טבעי שאינו פקודה.
- לפחות 20% command-like phrases ללא wake phrase כאשר wake נדרש.
- לפחות 20% near-wake/near-command confusables.
- לפחות 10% TTS loopback/output של המערכת.
- לפחות 30% noisy; קטגוריות יכולות לחפוף.

מדדים:

```text
false_wake_rate = false wake openings / all negative utterances
unsafe_dispatch_count = external or state-changing dispatches from negative corpus
```

שערים:

- false wake rate ‏`<= 0.5%` בסך הכול וגם בכל שפה.
- `unsafe_dispatch_count = 0`.
- partial Soniox tokens, stale capture epoch ו־TTS loopback גורמים תמיד ל־0 matcher dispatch.
- גם כאשר Auto Mode פעיל, negative/ambiguous/invalid/untrusted/remote-Git fixtures גורמים ל־0 dispatch.

False wake מעל הסף או dispatch מסוכן יחיד חוסמים release; אין waiver סטטיסטי ל־unsafe dispatch.

## 8. מדדי latency ומשאבים

### 8.1 מכונת reference

שער המספרים הראשי נמדד CPU-only על מכונה מתועדת עם:

- 4 physical cores זמינים לתהליך, ללא GPU acceleration.
- 16 GB RAM.
- power mode קבוע, מחובר לחשמל, thermal state יציב.
- background load מתחת ל־5% CPU לפני run.
- חבילות STT/TTS המקומיות הנדרשות למסלול על SSD מקומי.

אם למכונה יש יותר cores, affinity/container quota מגבילים ל־4 physical cores. Hyper-threading, governor ו־CPU model נרשמים. `200% CPU` פירושו ממוצע של עד שני logical cores במונחי process CPU של מערכת ההפעלה.

### 8.2 Latency STT

subset ביצועים מכיל לפחות 100 clips לכל שפה באורך `2.5–3.5s`, מאוזן clean/noisy. timestamps נלקחים מאותו monotonic clock ב־host:

- `endpoint`: זמן שבו recorder/VAD מסמן סוף utterance ומסיים העברת audio.
- `final`: זמן שבו final transcript מאומת זמין ב־host לפני matcher.
- `final_latency = final - endpoint`.

לאחר warm-up אחד, מריצים כל clip פעם אחת בסדר seeded random. כשלים/timeouts נכללים כ־infinite/fail ואינם נמחקים.

כל סף חייב לעבור על האוסף המשולב וגם על HE ועל EN בנפרד; תוצאה מהירה בשפה אחת אינה מפצה על כשל בשפה האחרת:

| מדד | סף |
|---|---:|
| final latency p50 | `<= 1.2s` |
| final latency p95 | `<= 2.5s` |
| timeout/error | `0` |

### 8.3 Load/size/resources

| מדד | שיטת מדידה | סף |
|---|---|---:|
| model load | process spawn/handshake עד provider ready, 10 cold runs | max `<= 5.0s` |
| STT data pack | installed bytes של חבילת STT בלבד, ללא temp/cache | `<= 600,000,000 bytes` |
| TTS data pack | installed bytes של חבילת TTS בלבד, ללא temp/cache | `<= 600,000,000 bytes` |
| first-use combined bundle | סכום `expectedBytes` של STT+TTS שנבחרו בפעולה המודרכת | `<= 1,100,000,000 bytes` |
| helper peak RSS | peak resident set לאורך STT+TTS suite | `<= 1.5 GB` |
| inference CPU | time-weighted process CPU בזמן decode, לא idle | average `<= 200%` |
| Extension Host event-loop p95 | delay histogram בזמן inference | `<= 50ms` |
| Extension Host event-loop max | אותו run | `<= 200ms` |

מדידה כוללת 20 מחזורי STT→TTS→stop ומבחן עומס של 15 דקות. ה־helper נמדד בנפרד מ־Extension Host. fatal crash/timeout/RSS cap חייבים להרוג או להפעיל מחדש רק את helper לפי policy; VS Code ו־Extension Host נשארים responsive.

ה־cap המשולב הוא `1,100,000,000` bytes decimal. הוא מבוסס על גדלי המועמדים המתועדים: Whisper base STT בגודל `453,071,794` bytes והובלת TTS הנוכחית BlueTTS+Renikud בגודל `593,121,124` bytes, יחד `1,046,192,918` bytes לפני manifest/notices; ראו [תיק רישיונות ומועמדים](speech-model-license-dossier.md). ה־cap משאיר `53,807,082` bytes ל־metadata/notices בלי לאפשר bundle בלתי מוגבל. candidate שבו כל pack עובר בנפרד אך הסכום גדול מה־cap נכשל בשער ה־bundle ונדרש model קטן יותר או שינוי מוצר מאושר; אין עיגול display שמסתיר חריגה. פעולה מודרכת אחת רשאית להתקין STT ו־TTS, אך manager מוריד, מאמת SHA-256/bytes/license ומתקין כל pack כעסקה עצמאית, רצוי ברצף כדי לצמצם temporary disk peak. pack אחד שכבר הותקן ואומת אינו מתבטל אוטומטית אם השני נכשל או בוטל.

## 9. פרוטוקול TTS

### 9.1 Sentence set לכל שפה

100 משפטים קפואים לכל שפה:

| קבוצה | מספר | דוגמאות תוכן |
|---|---:|---|
| שפה כללית | 60 | תשובות קצרות, משפטים ארוכים, שאלות, punctuation |
| מספרים וזמנים | 15 | line numbers, dates, versions, percentages |
| קוד ופקודות | 15 | Git, VS Code, acronyms, identifiers |
| paths/branches | 10 | mixed RTL/LTR, separators, extensions |

אין להשתמש במשפטי training ידועים אם provenance המודל מאפשר לזהותם. כל output נשמר lossless עם model/runtime/run IDs.

### 9.2 מדרגים אנושיים

- לפחות שני מדרגים דוברי השפה לכל שפה; כל sample נשמע על ידי שניהם.
- המדרג אינו מפתח המודל ואינו רואה איזה candidate יצר את הקול.
- סדר המשפטים וה־candidate randomized ו־seed מתועד.
- סביבת האזנה שקטה ואוזניות/רמקולים מתועדים; volume calibration קבוע.
- לכל sample המדרג שומע לכל היותר פעמיים.

שלבי review:

1. המדרג שומע ללא reference וכותב מה הבין.
2. scorer מחשב word intelligibility מול reference normalized.
3. עבור קבוצת code/numbers/paths המדרג מסמן כל token קריטי שנקרא נכון.
4. המדרג נותן MOS שלם 1–5 על טבעיות/בהירות כוללת: 1 בלתי מובן, 2 קשה, 3 מובן אך מלאכותי, 4 טוב, 5 טבעי מאוד.
5. disagreement שבו הפער ב־MOS הוא 2+ או transcript scoring שונה ביותר מ־10 נקודות עובר למדרג שלישי עיוור. התוצאה הסופית היא median של המדרגים; אין דיון לפני הציון העצמאי.

### 9.3 איכות TTS

| מדד | חישוב | סף לכל שפה |
|---|---|---:|
| word intelligibility | correct understood words / reference words, pooled | `>= 95.0%` |
| critical token accuracy | code/number/path tokens correct / all critical tokens | `>= 90.0%` |
| MOS | mean of final per-sample ratings | `>= 3.0/5` |

עברית ואנגלית חייבות לעבור בנפרד. כשל עברית חוסם את כל השחרור; אין English-only release ואין cloud TTS fallback שקט.

### 9.4 ביצועי TTS

- `TTFB`: מ־host submit עד ה־PCM frame הראשון שנמסר ל־AudioOutputPort.
- `cold`: helper חדש/model לא טעון, 10 runs.
- `warm`: model טעון, 100 המשפטים בסדר seeded random.
- `stop latency`: מקריאת cancel עד שאין frame נוסף בתור וה־backend מאשר silence.

| מדד | סף |
|---|---:|
| warm TTFB p95 | `<= 500ms` |
| cold TTFB max | `<= 3.0s` |
| stop latency p95 | `<= 250ms` |
| start/stop cycles | 20 ללא hang, stale audio או command loopback |
| RSS drift | אחרי 20 cycles, post-GC/settle מול baseline | `<= 5.0%` |

TTS נבדק גם כאשר sidebar ו־Control Center מוסתרים. בסיום/cancel/crash capture מתחדש ב־epoch חדש; frame ישן אינו מגיע ל־STT/matcher.

## 10. מטריצת חומרה ופלטפורמות

כל יעד “נתמך” חייב לעבור על hardware אמיתי, לא רק VM או cross-build:

| יעד | arch | סטטוס v1 | בדיקות חובה |
|---|---|---|---|
| Windows 10/11 | x64 | מועמד | install VSIX, mic peak, local STT/TTS, miniaudio, crash containment, sleep/resume |
| Windows | arm64 | לא נתמך | אין VSIX עד runtime/ABI והפרוטוקול כולו |
| macOS supported by VS Code 1.99 | x64 | מועמד | artifact x64, mic permission, playback, notarization/signing path, crash containment |
| macOS supported by VS Code 1.99 | arm64 | מועמד | artifact arm64 native, ללא Rosetta סמוי, כל הבדיקות |
| Ubuntu LTS desktop | x64 | מועמד | ALSA/PulseAudio/PipeWire backend מתועד, capture/playback, crash containment |
| Ubuntu LTS desktop | arm64 | מועמד | hardware arm64 אמיתי, artifact native, audio backend בפועל |

לכל שורה נרשמים OS build, VS Code ‏1.99 וגם stable הנוכחי, Electron/Node ABI, CPU, RAM, device, audio backend ו־artifact SHA. platform smoke כולל:

1. fresh install ו־upgrade install.
2. התקנת STT בלבד, התקנת TTS בלבד ופעולה מודרכת משולבת; בכל מסלול נבדקים consent ללא auto-download, cancel, retry של ה־pack שנכשל בלבד, interrupted cleanup, hash tamper rejection ו־offline reopen.
3. הסרת STT בלבד משאירה TTS usable ומסמנת transcription כ־download required; הסרת TTS בלבד משאירה STT usable ומסמנת speech output כ־download required. הסרה משולבת מדווחת bytes ששוחררו לכל pack ובסך הכול.
4. mic signal לא־אפס ו־10 HE + 10 EN utterances.
5. audible HE + EN TTS כאשר UI גלוי וכאשר מוסתר.
6. device unavailable/reconnect.
7. helper timeout, fatal crash, RSS cap, bounded restart ו־deactivation ללא orphan process.
8. local mode עם egress חסום ו־0 network attempts.
9. Remote/WSL/SSH/Codespaces: UI host speech state מוצג במדויק ו־Git voice commands unavailable עם 0 dispatch.

VM רשאי לשמש regression CI, אך אינו מחליף hardware sign-off. יעד שלא עבר מסומן unsupported ואינו מקבל artifact פרסום.

## 11. Soniox opt-in evaluation

Soniox אינו gate לזמינות offline, אך אם מוצע ב־release הוא חייב לעבור:

- WebSocket state machine: `idle -> connecting -> streaming -> finalizing -> closed|failed`.
- PCM config, finalization ו־finished handshake לפי ה־API הרשמי.
- non-final tokens מוצגים כ־partial בלבד ומייצרים 0 matcher calls.
- final tokens נמדדים באותו WER/CER/intent protocol על corpus שמותר לשלוח לענן.
- disconnect לפני dispatch יכול להתחבר מחדש באופן bounded; disconnect אחרי dispatch אינו גורם retry.
- secret לעולם אינו נכנס ל־webview/log/report.
- אין fallback מ־local ל־Soniox ללא בחירה והסכמה מפורשות.

אם אין corpus עם cloud consent, מסלול Soniox נשאר integration-tested באמצעות fake WebSocket ואינו מסומן “quality evaluated”.

## 12. Human review, adjudication וחריגים

### 12.1 Review STT references

- שני דוברי השפה מאמתים references לפני freeze.
- disagreement בתמלול reference עובר adjudication של reviewer שלישי.
- reviewer רואה audio ו־reference בלבד, לא hypothesis של המודל.
- לאחר freeze אין “תיקון reference” בגלל שגיאת מודל; טעות reference מוכחת יוצרת corpus version חדש והרצה מלאה.

### 12.2 Review failures

כל failure מקבל category קפואה: acoustic, language, code/path, slot, wake, availability, runtime, device או infrastructure. failure infrastructure ניתן לפסילה רק עם evidence חיצוני למודל (למשל hash mismatch לפני decode). פסילה, סיבה ו־sample ID מופיעים בדוח; אין cherry-picking שקט.

### 12.3 Reproducibility

scorer מפיק machine-readable JSON ודו״ח Markdown מאותו input. reviewer שני מאמת:

- hashes ו־counts;
- שכל sample צפוי הופיע בדיוק פעם אחת;
- formulas ו־threshold comparisons;
- שאין excluded samples לאחר freeze ללא corpus version חדש;
- שכל platform artifact שנחתם הוא זה שנבדק.

## 13. תוצרי הרצה

כל release candidate מפיק חבילה פרטית/ציבורית מופרדת:

### מותר בריפו או ב־release evidence

- aggregate HE/EN metrics ו־confidence intervals.
- corpus version/hash ו־counts לפי strata רחבים.
- STT pack, ‏TTS pack, runtime ו־VSIX hashes, versions, bytes ורישיונות בנפרד, וכן סכום first-use bundle.
- hardware/software matrix.
- pass/fail לכל gate ורשימת error categories ללא תוכן.
- signed-off reviewer roles ותאריך; אין צורך בשמות מלאים אם policy פנימית אוסרת.

### נשאר פרטי

- audio, per-speaker transcripts, consent forms, pseudonym map.
- per-sample hypotheses אם הם עלולים להכיל מידע אישי.
- Soniox credentials, local paths או diagnostic payload רגיש.

ה־report הסופי חייב לכלול statement מפורש: “tested artifact SHA-256 equals publication candidate SHA-256”. אם אין התאמה, כל התוצאות הן engineering evidence בלבד ואינן release evidence.

## 14. שערי עצירה ושחרור

השחרור חסום אם אחד מהבאים מתקיים:

1. corpus קטן/לא מאוזן, פחות מ־10 speakers, פחות מ־30% noisy, חסר consent/provenance או hash לא קפוא.
2. HE או EN נכשלות ב־WER/CER או intent+slot threshold.
3. false wake מעל 0.5% בשפה כלשהי או unsafe dispatch יחיד.
4. Hebrew TTS או English TTS נכשלות ב־intelligibility, critical tokens, MOS, latency, stop או RSS drift.
5. model load, STT pack מעל `600,000,000` bytes, ‏TTS pack מעל `600,000,000` bytes, first-use combined bundle מעל `1,100,000,000` bytes, helper RSS, CPU או Extension Host event-loop עוברים סף.
6. helper fatal crash/timeout/RSS cap מפילים או מקפיאים את Extension Host, restart אינו bounded, או נשאר orphan process.
7. local mode מבצע network access, cloud fallback או חושף secret/audio ללא consent.
8. runtime/model/weights/dataset license, attribution או redistribution rights אינם מאושרים בנפרד.
9. SHA-256/bytes/ABI/platform אינם תואמים ל־artifact הנבדק.
10. יעד platform מסומן supported בלי hardware pass בפועל.
11. TTS נשמע רק כאשר webview גלוי, capture אינו מתחדש safely, או loopback מגיע ל־matcher.
12. scorer/report אינם reproducible או review עצמאי לא אימת counts/hashes/formulas.

אין waiver שמאפשר release באנגלית בלבד אם עברית נכשלת, ואין החלפה שקטה ל־system voice או Soniox. לאחר תיקון נדרש artifact חדש, hash חדש והרצה מלאה של כל gate שהשינוי יכול להשפיע עליו; שינוי runtime/model מחייב את כל פרוטוקול Stage 0.

## 15. Checklist חתימה

- [ ] corpus HE/EN ו־negative frozen, hashed ומורשה.
- [ ] command coverage: כל 100 IDs לפחות פעמיים לכל שפה.
- [ ] WER/CER raw+normalized חושבו לפי scorer קפוא.
- [ ] intent+all-slots clean/noisy עברו בכל שפה.
- [ ] 2,000 negatives: false wake עבר ו־unsafe dispatch הוא 0.
- [ ] reference performance machine מתועדת וכל ספי latency/RSS/CPU/event-loop עברו.
- [ ] STT ו־TTS packs נמדדו בנפרד, כל אחד עד `600,000,000` bytes, וסכום first-use עד `1,100,000,000` bytes.
- [ ] התקנה/הסרה עצמאית של כל pack והתקנה מודרכת של שניהם עברו ללא auto-download וללא rollback סמוי של pack תקין.
- [ ] 100 TTS sentences לכל שפה, שני מדרגים לפחות ו־adjudication לפי הכללים.
- [ ] כל platform/arch נתמך עבר hardware matrix בפועל.
- [ ] local no-network, helper isolation, hidden-UI playback ו־half-duplex עברו.
- [ ] engine, runtime, weights ו־datasets עברו בדיקת רישיון/attribution נפרדת.
- [ ] report artifact hash זהה ל־publication candidate.
- [ ] reviewer עצמאי אימת counts, hashes, exclusions ו־formulas.

רק כאשר כל הסעיפים מסומנים והדוח מציג `PASS` לכל gate, Stage 0 נחשב ירוק.
